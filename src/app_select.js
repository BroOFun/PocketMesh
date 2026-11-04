// Circle selection paints a swept screen-space brush, so fast pointer events
// cannot leave gaps. A stroke adds/removes; it never toggles the same item twice.
const CIRCLE = {radius: 40, op: 'add', point: null, stroke: null};
function circleActive() { return S.tool === 'circle' && S.workspace === 'model' && !isUVFocused() && !TF.active && !PM.active; }
function circleCursor(point = CIRCLE.point) {
  CIRCLE.point = point;
  const el = $('#circleBrush');
  el.hidden = !circleActive() || !point;
  if (point) Object.assign(el.style, {left: point.x + 'px', top: point.y + 'px', width: CIRCLE.radius * 2 + 'px', height: CIRCLE.radius * 2 + 'px'});
  el.classList.toggle('subtract', (CIRCLE.stroke?.op || CIRCLE.op) === 'sub');
}
function circleRadius(value) {
  if (!Number.isFinite(value)) return;
  CIRCLE.radius = clamp(Math.round(value), 8, 160);
  settingsSet('circleRadius', CIRCLE.radius);
  const input = $('#circleRadius'); if (input) input.value = CIRCLE.radius;
  circleCursor();
}
function circleActivate() {
  if (S.workspace !== 'model') return;
  finishEditorInteraction(); closeSheet(); setEditorFocus('3d');
  S.tool = 'circle'; S.pendingTap = null; G.lastTap = null;
  CIRCLE.op = 'add'; CIRCLE.point = null;
  rulerResetPending(); hideRedoPanel(); buildTools(); buildSubbar(); gizmoSync();
  hint('Drag to paint selection · two fingers navigate · Done to finish');
}
function circleReset() {
  CIRCLE.stroke = null; CIRCLE.point = null;
  if (S.tool === 'circle') { S.tool = 'select'; hint(null); }
  circleCursor();
}
function circleDone() {
  circleEnd(false); circleReset(); hint(null);
  buildTools(); buildSubbar(); gizmoSync();
}
function circleBegin(point, subtract) {
  if (!circleActive() || (S.mode === 'edit' && !S.active)) return;
  scene.updateMatrixWorld(true);
  const objects = S.mode === 'edit' ? [S.active] : S.objects.filter(o => o.visible);
  CIRCLE.stroke = {
    mode: S.mode, selectMode: S.selectMode, op: subtract ? 'sub' : CIRCLE.op,
    before: snapshot(), changed: false, last: point,
    objects: objects.map(o => ({o, mesh: o.mesh, SP: projectMeshVerts(o), T: topo(o.mesh)})),
  };
  circlePaint(point);
}
// Nearest distance between a brush segment and an edge, with its edge parameter.
function circleEdgeHit(a, b, from, to) {
  const dx=b.x-a.x, dy=b.y-a.y, sx=to.x-from.x, sy=to.y-from.y;
  const det=dx*sy-dy*sx;
  if (Math.abs(det)>1e-10) {
    const x=from.x-a.x, y=from.y-a.y, t=(x*sy-y*sx)/det, u=(x*dy-y*dx)/det;
    if (t>=0 && t<=1 && u>=0 && u<=1) return {d:0,t};
  }
  const candidates=[distToSeg(from.x,from.y,a.x,a.y,b.x,b.y),distToSeg(to.x,to.y,a.x,a.y,b.x,b.y),
    {d:distToSeg(a.x,a.y,from.x,from.y,to.x,to.y).d,t:0}, {d:distToSeg(b.x,b.y,from.x,from.y,to.x,to.y).d,t:1}];
  return candidates.reduce((a,b)=>a.d<=b.d?a:b);
}
function circleEdgePoint(o, a, b, t) {
  const project = v => new THREE.Vector4(...v,1).applyMatrix4(o.node.matrixWorld).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  return vlerp(a,b,perspectiveEdgeParameter(t,project(a).w,project(b).w));
}
function circlePaint(point) {
  const stroke=CIRCLE.stroke;
  if (!stroke || !circleActive()) return;
  const from=stroke.last, r=CIRCLE.radius;
  const inside = (x,y) => distToSeg(x,y,from.x,from.y,point.x,point.y).d<=r;
  const change = (set,key) => {
    if (set.has(key) === (stroke.op !== 'sub')) return false;
    stroke.op === 'sub' ? set.delete(key) : set.add(key); return true;
  };
  let changed=false;
  for (const {o,mesh:m,SP,T} of stroke.objects) {
    if (!S.objects.includes(o) || o.mesh!==m) continue;
    const projected = v => ({x:SP[v*4],y:SP[v*4+1]});
    const vertexHit = v => SP[v*4+3] && inside(SP[v*4],SP[v*4+1]) && pointVisible(o,m.verts[v]);
    const edgeHit = ([a,b]) => {
      if (!SP[a*4+3] || !SP[b*4+3]) return false;
      const hit=circleEdgeHit(projected(a),projected(b),from,point);
      return hit.d<=r && pointVisible(o,circleEdgePoint(o,m.verts[a],m.verts[b],hit.t));
    };
    if (stroke.mode==='edit') {
      if (stroke.selectMode==='vert') {
        for (let v=0;v<m.verts.length;v++) if (o.esel.verts.has(v)!==(stroke.op!=='sub') && vertexHit(v)) changed=change(o.esel.verts,v)||changed;
      } else if (stroke.selectMode==='edge') {
        for (const edge of T.edges) if (o.esel.edges.has(ekey(...edge))!==(stroke.op!=='sub') && edgeHit(edge)) changed=change(o.esel.edges,ekey(...edge))||changed;
      } else {
        m.faces.forEach((f,i)=>{
          if (o.esel.faces.has(i)===(stroke.op!=='sub')) return;
          const local=faceCenter(m,f), p=toScreen(new THREE.Vector3(...local).applyMatrix4(o.node.matrixWorld));
          if (p.z>-1 && p.z<1 && inside(p.x,p.y) && pointVisible(o,local)) changed=change(o.esel.faces,i)||changed;
        });
      }
      if (changed) flushSel(o);
    } else {
      if (o.selected === (stroke.op!=='sub')) continue;
      let hit=m.verts.some((_,v)=>vertexHit(v)) || T.edges.some(edgeHit);
      if (!hit && !m.verts.length) { const p=toScreen(o.node.position); hit=p.z>-1&&p.z<1&&inside(p.x,p.y); }
      // Also catch a large face when the entire circle is inside its boundary.
      if (!hit && m.faces.length) hit=screenRay(point.x,point.y).intersectObjects(S.objects.filter(o=>o.visible).map(o=>o.meshNode),false)[0]?.object===o.meshNode;
      if (hit) { o.selected=stroke.op!=='sub'; if (o.selected) S.active=o; changed=true; }
    }
  }
  stroke.changed ||= changed; stroke.last=point; circleCursor(point);
  if (changed) onSelectionChanged();
}
function circleEnd(cancel) {
  const stroke=CIRCLE.stroke; if (!stroke) return;
  CIRCLE.stroke=null;
  if (cancel) {
    for (const old of stroke.before.objects) {
      const o=S.objects.find(o=>o.id===old.id); if (!o) continue;
      o.selected=old.selected; o.esel={verts:new Set(old.esel.verts),edges:new Set(old.esel.edges),faces:new Set(old.esel.faces)}; o.activeFace=old.activeFace;
    }
    S.active=S.objects.find(o=>o.id===stroke.before.active)||null;
    onSelectionChanged();
  } else if (stroke.changed) {
    // Tap selections aren't history steps; keep their exact state for undo.
    if (UNDO.idx>=0) UNDO.stack[UNDO.idx].snap=stroke.before;
    LAST.op=null; hideRedoPanel(); pushUndo('Circle select');
  }
  circleCursor();
}
