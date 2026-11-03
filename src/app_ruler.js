// Ruler: tap two endpoints, with vertex/edge snapping enabled by default.
const RULER = { first: null, hover: null };
function rulerResetPending() { RULER.first = null; RULER.hover = null; requestRender(); }
function rulerActivate() {
  if (TF.active) tfCancel(); if (PM.active) pmCancel();
  S.tool = 'ruler'; S.pendingTap = null; rulerResetPending(); closeSheet();
  buildTools(); buildSubbar(); gizmoSync(); hint('Ruler · tap the first point · drag to orbit');
}
function rulerDone() { S.tool = 'select'; rulerResetPending(); hint(null); buildTools(); buildSubbar(); gizmoSync(); }
function rulerPick(x, y, radius = 18) {
  const objects = S.objects.filter((o) => o.visible), nodes = objects.map((o) => o.meshNode).filter(Boolean);
  scene.updateMatrixWorld(true);
  const { w, h: height } = viewSize(), vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const projected = (point) => {
    const p = new THREE.Vector4(...point, 1).applyMatrix4(vp);
    return { x: (p.x/p.w*.5+.5)*w, y: (-p.y/p.w*.5+.5)*height, w: p.w, z: p.z/p.w, valid: p.w > 0 && p.z/p.w >= -1 && p.z/p.w <= 1 };
  };
  const visible = (candidate) => {
    if (S.xray || S.shading === 'wire') return true;
    const ray = screenRay(candidate.screen.x,candidate.screen.y), hit = ray.intersectObjects(nodes,false)[0];
    return !hit || ray.ray.origin.distanceTo(new THREE.Vector3(...candidate.point)) <= hit.distance + Math.max(.0001,hit.distance*.0001);
  };
  if (S.ruler.snap) {
    const vertices = [], edges = [];
    for (const o of objects) {
      const m = o.renderMesh || o.mesh;
      if (!o.rulerEdges) o.rulerEdges = topo(m).edges;
      const world = m.verts.map((p) => new THREE.Vector3(...p).applyMatrix4(o.node.matrixWorld).toArray()), screen = world.map(projected);
      screen.forEach((p, i) => {
        const distance = Math.hypot(p.x-x,p.y-y);
        if (p.valid && distance <= radius) vertices.push({ point: world[i], screen: p, kind: 'Vertex', distance });
      });
      for (const [ai, bi] of o.rulerEdges) {
        const a = screen[ai], b = screen[bi]; if (!a?.valid || !b?.valid) continue;
        const dx = b.x-a.x, dy = b.y-a.y, len = dx*dx+dy*dy; if (len < .01) continue;
        const t = clamp(((x-a.x)*dx+(y-a.y)*dy)/len,0,1), sx = a.x+t*dx, sy = a.y+t*dy, distance = Math.hypot(x-sx,y-sy);
        if (distance > radius) continue;
        const u = perspectiveEdgeParameter(t,a.w,b.w), point = world[ai].map((v,k) => v+(world[bi][k]-v)*u);
        edges.push({ point, screen: projected(point), kind: 'Edge', distance });
      }
    }
    const order = (a,b) => a.distance-b.distance || a.screen.z-b.screen.z;
    for (const candidates of [vertices,edges]) for (const c of candidates.sort(order)) if (visible(c)) return c;
  }
  const ray = screenRay(x,y), hit = ray.intersectObjects(nodes,false)[0];
  if (hit) return { point: hit.point.toArray(), kind: 'Surface' };
  const point = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-S.cursor.z),new THREE.Vector3());
  return point ? { point: point.toArray(), kind: 'Grid plane' } : null;
}
function rulerTap(x, y, radius) {
  const pick = rulerPick(x,y,radius); if (!pick) { toast('No surface here. Orbit to see the grid.'); return; }
  RULER.hover = pick;
  if (!RULER.first) { RULER.first = pick; hint(pick.kind + ' snapped · tap the second point'); }
  else {
    if (S.ruler.measurements.length >= 200) { toast('Clear a measurement before adding another',true); return; }
    const m = { a: RULER.first.point.slice(), b: pick.point.slice() }; S.ruler.measurements.push(m); RULER.first = null;
    pushUndo('Measure'); hint(formatMeasurement(measurementMeters(m.a,m.b,S.ruler.metersPerUnit),S.ruler.unit) + ' · tap to measure again');
  }
  requestRender();
}
function drawRuler() {
  const canvas = $('#rulerCanvas'), ctx = canvas.getContext('2d'), { w,h: height } = viewSize(), dpr = Math.min(devicePixelRatio || 1,2);
  if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(height*dpr)) { canvas.width = Math.round(w*dpr); canvas.height = Math.round(height*dpr); }
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,height);
  const screen = (p) => { const v = new THREE.Vector3(...p), s = toScreen(v); return s.z >= -1 && s.z <= 1 ? s : null; };
  const dot = (p, color) => { ctx.beginPath(); ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fillStyle = '#171b22'; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); };
  const label = (text,x,y,color) => {
    ctx.font = '600 12px -apple-system, system-ui, sans-serif'; const width = ctx.measureText(text).width+16;
    x = clamp(x-width/2,4,Math.max(4,w-width-4)); y = clamp(y-27,4,height-26);
    ctx.fillStyle = '#131820ed'; ctx.fillRect(x,y,width,23); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(x,y,width,23);
    ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text,x+8,y+12);
  };
  const line = (a,b,preview = false) => {
    const p = screen(a), q = screen(b); if (!p || !q) return;
    const color = preview ? '#8be4fa' : THEME.highlight;
    ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); ctx.strokeStyle = '#10151c'; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(preview ? [5,4] : []); ctx.stroke(); ctx.setLineDash([]);
    dot(p,color); dot(q,color); label(formatMeasurement(measurementMeters(a,b,S.ruler.metersPerUnit),S.ruler.unit),(p.x+q.x)/2,(p.y+q.y)/2,color);
  };
  for (const m of S.ruler.measurements) line(m.a,m.b);
  if (S.tool !== 'ruler') return;
  if (RULER.first && RULER.hover) line(RULER.first.point,RULER.hover.point,true);
  if (RULER.hover) { const p = screen(RULER.hover.point); if (p) { dot(p,'#8be4fa'); label(RULER.hover.kind,p.x,p.y+55,'#8be4fa'); } }
}
function openRuler() {
  openSheet('Ruler · Measurements',(body) => {
    const change = (fn) => { fn(); pushUndo('Ruler settings'); buildSubbar(); requestRender(); refreshSheet(true); };
    body.append(h('p',{class:'muted'},'Tap two points with the ruler. Vertices and edges snap by default; empty space uses the grid at the 3D cursor’s height.'));
    body.append(h('button',{class:'btn primary',onclick:rulerActivate},'New measurement'));
    body.append(field('Display unit',selectInput(S.ruler.unit,[['m','Meters (m)'],['cm','Centimeters (cm)'],['mm','Millimeters (mm)'],['ft','Feet (ft)']],(v) => change(() => S.ruler.unit=v),'Ruler unit')));
    body.append(field('Meters per unit',numInput(S.ruler.metersPerUnit,(v) => change(() => S.ruler.metersPerUnit=v),{min:.000001,max:1000000,digits:6,label:'Meters per modeling unit'})));
    body.append(checkInput('Snap to vertices and edges',S.ruler.snap,(v) => change(() => S.ruler.snap=v)));
    body.append(h('p',{class:'muted'},'Default: 1 modeling unit = 1 meter. For centimeter-based coordinates use 0.01. Measurements store fixed world points; moving a model does not move them.'));
    const card = h('div',{class:'card'},h('h3',{},'Saved measurements'));
    if (!S.ruler.measurements.length) card.append(h('span',{class:'muted'},'No measurements yet.'));
    S.ruler.measurements.forEach((m,i) => card.append(h('div',{class:'row'},h('span',{style:{flex:'1'}},`${i+1}. ${formatMeasurement(measurementMeters(m.a,m.b,S.ruler.metersPerUnit),S.ruler.unit)}`),h('button',{class:'btn','aria-label':`Delete measurement ${i+1}`,onclick:() => change(() => S.ruler.measurements.splice(i,1))},'Delete'))));
    if (S.ruler.measurements.length) card.append(h('button',{class:'btn',onclick:() => change(() => { S.ruler.measurements=[]; rulerResetPending(); })},'Clear measurements'));
    body.append(card);
  },{panel:true,kind:'ruler'});
}
