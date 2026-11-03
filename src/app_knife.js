// Knife keeps a private preview mesh. Only Apply changes the project/history;
// cancel, tool changes and editor changes discard the preview safely.
const KNIFE = {object: null, source: null, mesh: null, first: null, hover: null, edges: new Set(), steps: []};
function knifeReset() {
  Object.assign(KNIFE, {object: null, source: null, mesh: null, first: null, hover: null, edges: new Set(), steps: []});
  if (S.tool === 'knife') S.tool = 'select';
  requestRender();
}
function knifeActive() { return S.tool === 'knife' && S.mode === 'edit' && S.workspace === 'model' && KNIFE.object === S.active && KNIFE.source === S.active?.mesh; }
function knifeHint() { hint('Tap a face, edge or vertex · Apply to finish'); }
function knifeActivate() {
  if (knifeActive()) { knifeHint(); return; }
  if (!needEdit() || S.workspace !== 'model') return;
  finishEditorInteraction(); closeSheet(); rulerResetPending();
  Object.assign(KNIFE, {object: S.active, source: S.active.mesh, mesh: cloneMesh(S.active.mesh), first: null, hover: null, edges: new Set(), steps: []});
  S.tool = 'knife'; S.pendingTap = null; G.lastTap = null;
  hideRedoPanel(); buildTools(); buildSubbar(); gizmoSync(); knifeHint(); requestRender();
}
function knifeCancel() {
  knifeReset(); hint(null); buildTools(); buildSubbar(); gizmoSync();
}
function knifeApply() {
  if (!knifeActive()) { knifeCancel(); return; }
  const {object, mesh, edges} = KNIFE;
  knifeReset(); hint(null);
  if (edges.size) runOp('Knife cut', () => {
    object.mesh = mesh;
    S.selectMode = 'edge'; S.uvSel.clear(); object.activeFace = null;
    object.esel = {verts: new Set(), edges: new Set(edges), faces: new Set()};
    flushSel(object); rebuildObject(object);
  });
  onModeChanged(); onSelectionChanged();
}
function knifeUndo() {
  if (!knifeActive()) return;
  const step = KNIFE.steps.pop();
  if (step) Object.assign(KNIFE, step);
  else KNIFE.first = null;
  KNIFE.hover = null; buildSubbar(); knifeHint(); requestRender();
}
function knifeScreen(point) {
  const o = KNIFE.object, p = new THREE.Vector4(...point, 1).applyMatrix4(o.node.matrixWorld).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  const {w, h} = viewSize();
  return {x: (p.x / p.w * .5 + .5) * w, y: (-p.y / p.w * .5 + .5) * h, w: p.w, z: p.z / p.w, valid: p.w > 0 && p.z / p.w > -1 && p.z / p.w < 1};
}
function knifePointVisible(point) {
  const screen = knifeScreen(point);
  if (!screen.valid) return false;
  const world = new THREE.Vector3(...point).applyMatrix4(KNIFE.object.node.matrixWorld);
  const ray = screenRay(screen.x, screen.y);
  const hit = ray.intersectObjects(S.objects.filter(o => o.visible).map(o => o.meshNode).filter(Boolean), false)[0];
  return !hit || ray.ray.origin.distanceTo(world) <= hit.distance + Math.max(1e-5, hit.distance * 1e-6);
}
function knifePick(x, y, radius = 18) {
  if (!knifeActive()) return null;
  scene.updateMatrixWorld(true);
  const m = KNIFE.mesh, projected = m.verts.map(knifeScreen), topology = topo(m), vertices = [], edges = [];
  projected.forEach((p, v) => {
    const distance = Math.hypot(p.x - x, p.y - y);
    if (p.valid && topology.vertFaces[v].length && distance <= radius) vertices.push({point: m.verts[v].slice(), screen: p, kind: 'Vertex', distance});
  });
  topology.edges.forEach(([a, b], i) => {
    const p = projected[a], q = projected[b];
    if (!topology.edgeFaces[i].length || !p.valid || !q.valid) return;
    const closest = distToSeg(x, y, p.x, p.y, q.x, q.y);
    if (closest.d > radius || Math.hypot(q.x - p.x, q.y - p.y) < 1e-5) return;
    const u = perspectiveEdgeParameter(closest.t, p.w, q.w), point = vlerp(m.verts[a], m.verts[b], u);
    edges.push({point, screen: knifeScreen(point), kind: 'Edge', distance: closest.d});
  });
  // Vertex magnets take priority over nearby edges, independent of selection mode.
  for (const list of [vertices, edges]) {
    list.sort((a, b) => a.distance - b.distance || a.screen.z - b.screen.z);
    for (const pick of list) if (knifePointVisible(pick.point)) return pick;
  }
  // Interior face placement uses the rendered surface, including concave
  // n-gons. Preview cuts leave that surface in place until Apply.
  const ray = screenRay(x, y);
  const hit = ray.intersectObjects(S.objects.filter(o => o.visible).map(o => o.meshNode).filter(Boolean), false)[0];
  if (hit?.object === KNIFE.object.meshNode) {
    const point = hit.point.clone().applyMatrix4(KNIFE.object.node.matrixWorld.clone().invert()).toArray();
    return {point, screen: knifeScreen(point), kind: 'Face', distance: 0};
  }
  return null;
}
function knifeTap(x, y, radius) {
  const pick = knifePick(x, y, radius);
  if (!pick) { toast('Knife · tap a visible face, edge or vertex'); return; }
  KNIFE.hover = pick;
  if (!KNIFE.first) { KNIFE.first = pick; requestRender(); return; }
  const from = knifeScreen(KNIFE.first.point), to = knifeScreen(pick.point);
  if (!from.valid || !to.valid) { toast('Bring both cut points into view'); return; }
  const result = knifeCutProjected(KNIFE.mesh, KNIFE.mesh.verts.map(knifeScreen), from, to,
    (_fi, a, b) => [.2, .5, .8].every(t => knifePointVisible(vlerp(a, b, t))));
  if (!result) { toast('No new cut · choose another point on the surface'); requestRender(); return; }
  KNIFE.steps.push({mesh: KNIFE.mesh, first: KNIFE.first, edges: new Set(KNIFE.edges)});
  if (KNIFE.steps.length > UNDO.max) KNIFE.steps.shift();
  KNIFE.mesh = result.mesh;
  for (const [key, children] of result.replacements) if (KNIFE.edges.delete(key)) for (const child of children) KNIFE.edges.add(child);
  for (const key of result.edges) KNIFE.edges.add(key);
  KNIFE.first = pick; buildSubbar(); requestRender();
}
function drawKnife() {
  const canvas = $('#knifeCanvas'), ctx = canvas.getContext('2d'), {w, h} = viewSize(), dpr = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  if (!knifeActive()) return;
  const line = (a, b, preview) => {
    const p = knifeScreen(a), q = knifeScreen(b); if (!p.valid || !q.valid) return;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
    ctx.setLineDash(preview ? [5, 4] : []); ctx.lineWidth = 4; ctx.strokeStyle = '#14171c'; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = preview ? THEME.highlight : THEME.selection; ctx.stroke(); ctx.setLineDash([]);
  };
  for (const key of KNIFE.edges) { const [a, b] = ekeySplit(key); line(KNIFE.mesh.verts[a], KNIFE.mesh.verts[b], false); }
  if (KNIFE.first && KNIFE.hover) line(KNIFE.first.point, KNIFE.hover.point, true);
  for (const pick of [KNIFE.first, KNIFE.hover]) if (pick) {
    const p = knifeScreen(pick.point); if (!p.valid) continue;
    const vertex = pick.kind === 'Vertex';
    ctx.beginPath(); ctx.arc(p.x, p.y, vertex ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = '#151a22'; ctx.fill(); ctx.strokeStyle = vertex ? '#84f0b0' : pick.kind === 'Face' ? '#9edbff' : THEME.highlight; ctx.lineWidth = 2; ctx.stroke();
    if (vertex) { ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fillStyle = '#84f0b0'; ctx.fill(); }
  }
}
