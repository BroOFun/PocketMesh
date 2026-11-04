// ============================================================================
// app_ops.js — operators (with undo + "Adjust Last Operation" panel) and menus
// ============================================================================

const LAST = { op: null };
let showRedoPanel = () => {}, hideRedoPanel = () => {};

function setLastOp(label, params, schema, fn) {
  LAST.op = schema ? { label, params: { ...params }, schema, fn, baseIdx: UNDO.idx - 1, idx: UNDO.idx } : null;
  if (LAST.op) showRedoPanel(); else hideRedoPanel();
}
// run an operator: fn(params) mutates state, returns false on failure
function runOp(label, fn, params = {}, schema = null) {
  if (S.tool === 'knife') knifeCancel();
  if (TF.active) tfConfirm();
  if (PM.active) pmConfirm();
  let ok;
  try { ok = fn(params); } catch (e) { console.error(e); toast(label + ' failed: ' + e.message, true); ok = false; }
  if (ok === false) { if (S.active) rebuildObject(S.active); onSelectionChanged(); return false; }
  pushUndo(label);
  setLastOp(label, params, schema, fn);
  onSelectionChanged();
  return true;
}
function redoLast(params) {
  const op = LAST.op;
  if (!op || UNDO.idx !== op.idx || op.baseIdx < 0) return;
  restore(UNDO.stack[op.baseIdx].snap);
  let ok;
  try { ok = op.fn(params); } catch (e) { console.error(e); ok = false; }
  if (ok === false) toast(op.label + ': those settings did not work', true);
  UNDO.stack[op.idx] = { label: op.label, snap: snapshot() };
  op.params = { ...params };
  onSelectionChanged();
}
function needEdit() {
  if (S.mode !== 'edit' || !S.active) { toast('Switch to Edit Mode first', true); return false; }
  return true;
}
function needSel(kind = 'verts') {
  if (!needEdit()) return false;
  const s = S.active.esel;
  if (!s[kind].size) { toast(kind === 'faces' ? 'Select one or more faces first' : kind === 'edges' ? 'Select edges first' : 'Select some vertices first', true); return false; }
  return true;
}
const om = () => S.active.mesh;
const osel = () => S.active.esel;
function worldToLocalDir(o, dir) {
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(o.node.matrixWorld)).invert();
  return dir.clone().applyQuaternion(q);
}

// ---------- add primitives ----------
const PRIM_NAMES = { plane: 'Plane', cube: 'Cube', circle: 'Circle', uvsphere: 'Sphere', icosphere: 'Icosphere', cylinder: 'Cylinder', cone: 'Cone', torus: 'Torus', grid: 'Grid' };
function primDefaults(type) { const p = {}; for (const f of PRIMITIVES[type].params) p[f.k] = f.def; return p; }
function addPrimitive(type) {
  const schema = PRIMITIVES[type].params;
  runOp('Add ' + PRIMITIVES[type].label, (p) => {
    const mesh = PRIMITIVES[type].fn(p);
    if (S.mode === 'edit' && S.active) {
      const o = S.active;
      o.node.updateMatrixWorld();
      const inv = o.node.matrixWorld.clone().invert();
      const v = new THREE.Vector3();
      const vs = appendMesh(o.mesh, mesh, (q) => { v.set(q[0] + S.cursor.x, q[1] + S.cursor.y, q[2] + S.cursor.z).applyMatrix4(inv); return [v.x, v.y, v.z]; });
      setSelVerts(vs);
      rebuildObject(o);
    } else {
      for (const x of S.objects) x.selected = false;
      const o = createObject(PRIM_NAMES[type], mesh, { pos: S.cursor.toArray() });
      o.selected = true; S.active = o;
    }
  }, primDefaults(type), schema);
}

// ---------- extrude / duplicate ----------
function activateExtrude() {
  if (!needEdit()) return;
  if (S.tool === 'knife') knifeCancel();
  if (TF.active) tfConfirm();
  if (PM.active) pmConfirm();
  closeSheet();
  if (S.view !== '3d') setWorkView('3d');
  S.tool = 'extrude'; S.pendingTap = null; S.multiSelect = false; S.selOp = 'set';
  buildTools(); buildSubbar(); gizmoSync();
  extrudeHint();
}
function extrudeHint() {
  hint(S.extrudeTap ? 'Tap to extrude · drag to orbit' : S.extrudeQuick ? 'Drag selected geometry to extrude · release, then drag again' : 'Select geometry, then Drag extrude · E repeats the next step');
}
function extrudeVerticesOnly() { return S.selectMode === 'vert' && S.extrudeVerticesOnly; }
// Keep pre-extrusion topology, UV selection and tags so cancelled gestures never
// leave duplicate vertices or zero-length edges behind.
function extrudeRollback(o) {
  const mesh = cloneMesh(o.mesh), sel = {verts: new Set(o.esel.verts), edges: new Set(o.esel.edges), faces: new Set(o.esel.faces)};
  const activeFace = o.activeFace, uvSel = new Set(S.uvSel);
  return () => { o.mesh = mesh; o.esel = sel; o.activeFace = activeFace; S.uvSel = uvSel; rebuildObject(o); if (S.tool === 'extrude') extrudeHint(); };
}
function quickExtrudeHit(x, y, radius) {
  if (S.tool !== 'extrude' || S.mode !== 'edit' || S.workspace !== 'model' || !S.extrudeQuick || S.extrudeTap || S.pendingTap || TF.active || PM.active || !S.active) return false;
  const el = pickElement(x, y, radius), sel = S.active.esel;
  return !!el && (el.type === 'vert' ? sel.verts.has(el.i) : el.type === 'edge' ? sel.edges.has(el.key) : sel.faces.has(el.i));
}
function tapExtrudeAt(x, y) {
  if (S.workspace !== 'model' || S.mode !== 'edit' || !S.active || TF.active || PM.active) return;
  const o = S.active, selected = o.esel.verts;
  o.node.updateMatrixWorld(true);
  const inv = o.node.matrixWorld.clone().invert();
  if (Math.abs(o.node.matrixWorld.determinant()) < 1e-12) { toast('Restore a nonzero object scale before extruding', true); return; }
  const center = selected.size ? new THREE.Vector3(...vscale([...selected].reduce((sum, v) => vadd(sum, o.mesh.verts[v]), [0, 0, 0]), 1 / selected.size)).applyMatrix4(o.node.matrixWorld) : S.cursor.clone();
  const view = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
  const target = rayPlane(x, y, center, view);
  if (!target) return;
  let nx = 0, ny = 0;
  for (const key of o.esel.edges) {
    const [a, b] = ekeySplit(key);
    const p = toScreen(new THREE.Vector3(...o.mesh.verts[a]).applyMatrix4(o.node.matrixWorld));
    const q = toScreen(new THREE.Vector3(...o.mesh.verts[b]).applyMatrix4(o.node.matrixWorld));
    const dx = q.x - p.x, dy = q.y - p.y;
    const sign = -dy * (x - (p.x + q.x) / 2) + dx * (y - (p.y + q.y) / 2) >= 0 ? 1 : -1;
    nx -= dy * sign; ny += dx * sign;
  }
  const inverseLinear = new THREE.Matrix3().setFromMatrix4(inv);
  const direction = new THREE.Vector3(nx, -ny, 0).applyQuaternion(camera.quaternion).applyMatrix3(inverseLinear);
  const localView = view.clone().applyMatrix3(inverseLinear).normalize();
  direction.addScaledVector(localView, -direction.dot(localView)).normalize();
  try {
    const next = cloneMesh(o.mesh);
    const r = extrudeToPoint(next, o.esel, target.applyMatrix4(inv).toArray(), {rotate: S.extrudeRotate, rotateSource: S.extrudeRotateSource, direction: direction.toArray(), viewAxis: localView.toArray(), verticesOnly: extrudeVerticesOnly()});
    if (!r) return;
    o.mesh = next;
    if (r.addedVertex) S.selectMode = 'vert';
    setSelVerts(r.verts); rebuildObject(o);
    LAST.op = null; hideRedoPanel(); pushUndo('Tap Extrude'); onModeChanged(); onSelectionChanged();
  } catch (e) { toast(e.message, true); }
}
function opExtrude({verticesOnly = extrudeVerticesOnly(), quick = false} = {}) {
  if (TF.active) tfConfirm();
  if (PM.active) pmConfirm();
  if (!needSel()) return false;
  if (S.tool === 'knife') knifeCancel();
  if (verticesOnly && S.selectMode !== 'vert') setSelectMode('vert');
  const o = S.active;
  const rollback = extrudeRollback(o);
  const selection = verticesOnly ? {verts: new Set(o.esel.verts), edges: new Set(), faces: new Set()} : osel();
  const r = extrudeRegion(o.mesh, selection);
  S.uvSel.clear();
  setSelVerts(r.verts);
  rebuildObject(o);
  let axis = null;
  if (r.hadFaces && vlen(r.normal) > 0.5) axis = new THREE.Vector3(...r.normal).applyMatrix3(new THREE.Matrix3().getNormalMatrix(o.node.matrixWorld)).normalize();
  hideRedoPanel(); LAST.op = null;
  const ok = tfStart('move', { label: verticesOnly ? 'Extrude Vertices' : 'Extrude', customAxis: axis, undoLabel: 'Extrude', quickExtrude: quick,
    next: () => opExtrude({verticesOnly}), onCancel: rollback, onConfirm: () => { if (S.tool === 'extrude') extrudeHint(); } });
  if (!ok) rollback();
  return ok;
}
function opExtrudeIndividual() {
  if (TF.active) tfConfirm();
  if (PM.active) pmConfirm();
  if (!needSel('faces')) return;
  const o = S.active;
  const rollback = extrudeRollback(o);
  const r = extrudeIndividual(o.mesh, new Set(osel().faces));
  S.uvSel.clear();
  setSelVerts(r.verts);
  rebuildObject(o);
  tfStart('shrink', { label: 'Extrude Faces', undoLabel: 'Extrude Individual Faces', next: opExtrudeIndividual, onCancel: rollback });
}
function opExtrudeNormals() {
  if (TF.active) tfConfirm();
  if (PM.active) pmConfirm();
  if (!needSel('faces')) return;
  const o = S.active;
  const rollback = extrudeRollback(o);
  const r = extrudeRegion(o.mesh, osel());
  S.uvSel.clear();
  setSelVerts(r.verts);
  rebuildObject(o);
  tfStart('shrink', { label: 'Extrude Along Normals', undoLabel: 'Extrude Along Normals', next: opExtrudeNormals, onCancel: rollback });
}
function opDuplicate() {
  if (S.mode === 'object') {
    const objs = selectedObjects();
    if (!objs.length) { toast('Select an object first', true); return; }
    for (const x of S.objects) x.selected = false;
    let act = null;
    for (const o of objs) {
      const c = createObject(o.name, cloneMesh(o.mesh), { pos: o.node.position.toArray(), quat: o.node.quaternion.toArray(), scl: o.node.scale.toArray(), materials: o.materials, modifiers: o.modifiers });
      c.selected = true;
      if (o === S.active || !act) act = c;
    }
    S.active = act;
    onSelectionChanged();
    tfStart('move', { label: 'Duplicate', undoLabel: 'Duplicate', onCancel: () => pushUndo('Duplicate') });
    return;
  }
  if (!needSel()) return;
  const o = S.active;
  const r = duplicateSel(o.mesh, osel());
  setSelVerts(r.verts);
  rebuildObject(o);
  tfStart('move', { label: 'Duplicate', undoLabel: 'Duplicate', onCancel: () => pushUndo('Duplicate') });
}

// ---------- inset ----------
function opInset() {
  finishEditorInteraction();
  if (!needSel('faces')) return;
  closeSheet(); S.tool = 'select'; S.pendingTap = null; rulerResetPending();
  buildTools(); buildSubbar(); gizmoSync();
  const o = S.active;
  const faces = new Set(osel().faces);
  const base = cloneMesh(o.mesh);
  const selection = {verts: new Set(o.esel.verts), edges: new Set(o.esel.edges), faces: new Set(o.esel.faces)};
  const activeFace = o.activeFace, uvSel = new Set(S.uvSel);
  const params = { thickness: 0, depth: 0, individual: false };
  const run = () => {
    o.mesh = cloneMesh(base);
    const r = inset(o.mesh, faces, params.thickness, params.depth, params.individual);
    S.uvSel.clear(); setSelFaces(r.faces); rebuildObject(o);
    hint(r.clamped ? 'Inset limited to prevent overlap · reduce the thickness for a wider center' : 'Drag right to inset · Individual toggles per-face');
  };
  const center = new THREE.Vector3(...faceCenter(o.mesh, o.mesh.faces[[...faces][0]])).applyMatrix4(o.node.matrixWorld);
  paramModal({
    label: 'Inset', value: 0, min: 0, max: 1000, perPixel: worldPerPixel(center) * 0.6, undoLabel: 'Inset Faces',
    hintText: 'Drag right to inset · Individual toggles per-face',
    apply: (v) => { params.thickness = v; run(); },
    extra: () => {
      const b = h('button', { class: 'chip' + (params.individual ? ' on' : '') }, 'Individual');
      b.addEventListener('click', () => { params.individual = !params.individual; b.classList.toggle('on', params.individual); run(); });
      return [b];
    },
    onCancel: () => { o.mesh = base; o.esel = selection; o.activeFace = activeFace; S.uvSel = uvSel; rebuildObject(o); },
    onConfirm: () => {
      setTimeout(() => setLastOp('Inset Faces', params, [
        { k: 'thickness', label: 'Thickness', def: 0.1, min: 0, step: 0.01 },
        { k: 'depth', label: 'Depth', def: 0, step: 0.01 },
        { k: 'individual', label: 'Individual', type: 'bool' }],
      (p) => { const r = inset(om(), new Set(faces), p.thickness, p.depth, p.individual); setSelFaces(r.faces); rebuildObject(S.active); }), 0);
    },
  });
}

// ---------- loop cut ----------
function pickEdgeAny(x, y) {
  const sm = S.selectMode; S.selectMode = 'edge';
  const el = pickElement(x, y, 34);
  S.selectMode = sm;
  return el;
}
function opLoopCutStart() {
  if (!needEdit()) return;
  if (S.tool === 'knife') knifeCancel();
  S.pendingTap = 'loopcut';
  hint('Tap an edge to place a loop cut');
}
function loopCutAt(x, y) {
  S.pendingTap = null; hint(null);
  const el = pickEdgeAny(x, y);
  if (!el) { toast('No edge there — tap right on an edge', true); return; }
  const o = S.active, base = cloneMesh(o.mesh), key = el.key;
  const ring0 = edgeRing(base, key);
  if (!ring0 || (!ring0.faces.length && !ring0.closed)) { toast('Loop cut needs quads around that edge', true); }
  const params = { cuts: 1, slide: 0 };
  const run = () => { o.mesh = cloneMesh(base); const r = loopCut(o.mesh, edgeRing(o.mesh, key), params.cuts, params.slide); setSelVerts(r.verts); rebuildObject(o); };
  paramModal({
    label: 'Loop Cut', value: 0, min: -1, max: 1, perPixel: 0.004, undoLabel: 'Loop Cut and Slide',
    hintText: 'Drag to slide the cut · set the number of cuts below',
    apply: (v) => { params.slide = v; run(); },
    extra: () => {
      const lbl = h('span', { class: 'chip', style: { minWidth: '62px', justifyContent: 'center' } }, `${params.cuts} cut${params.cuts > 1 ? 's' : ''}`);
      const minus = h('button', { class: 'chip', 'aria-label': 'Fewer cuts' }, '−');
      const plus = h('button', { class: 'chip', 'aria-label': 'More cuts' }, '+');
      const upd = () => { lbl.textContent = `${params.cuts} cut${params.cuts > 1 ? 's' : ''}`; run(); };
      minus.addEventListener('click', () => { params.cuts = Math.max(1, params.cuts - 1); upd(); });
      plus.addEventListener('click', () => { params.cuts = Math.min(64, params.cuts + 1); upd(); });
      return [minus, lbl, plus];
    },
    onCancel: () => { o.mesh = base; rebuildObject(o); },
    onConfirm: () => {
      setTimeout(() => setLastOp('Loop Cut and Slide', params, [
        { k: 'cuts', label: 'Number of Cuts', def: 1, min: 1, max: 64, int: true },
        { k: 'slide', label: 'Edge Slide', def: 0, min: -1, max: 1, step: 0.05 }],
      (p) => { const r = loopCut(om(), edgeRing(om(), key), p.cuts, p.slide); setSelVerts(r.verts); rebuildObject(S.active); }), 0);
    },
  });
}

// ---------- mesh operators ----------
function opSubdivide() {
  if (!needSel('faces')) return;
  runOp('Subdivide', (p) => {
    let fs = new Set(osel().faces);
    for (let i = 0; i < p.repeat; i++) fs = subdivide(om(), fs).faces;
    setSelFaces(fs); rebuildObject(S.active);
  }, { repeat: 1 }, [{ k: 'repeat', label: 'Repeat', def: 1, min: 1, max: 5, int: true }]);
}
function viewDirLocal() {
  const o = S.active;
  const d = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const l = worldToLocalDir(o, d);
  return [l.x, l.y, l.z];
}
function opFill(mode) {
  if (!needSel()) return;
  runOp(mode === 'tri' ? 'Triangle Fill' : 'Fill', () => {
    const r = fill(om(), osel(), mode, viewDirLocal());
    if (!r.ok) { toast(r.msg, true); return false; }
    if (r.faces) setSelFaces(r.faces); else if (r.verts) setSelVerts(r.verts);
    rebuildObject(S.active);
  });
}
function opGridFill() {
  if (!needSel('edges')) return;
  const base = { span: 0, offset: 0 };
  runOp('Grid Fill', (p) => {
    const r = gridFill(om(), osel(), p.span, p.offset, viewDirLocal());
    if (!r.ok) { toast(r.msg, true); return false; }
    if (!p.span) p.span = r.span;
    setSelFaces(r.faces); rebuildObject(S.active);
  }, base, [{ k: 'span', label: 'Span', def: 1, min: 1, max: 200, int: true }, { k: 'offset', label: 'Offset', def: 0, min: -200, max: 200, int: true }]);
}
function opBridge() {
  if (!needSel()) return;
  runOp('Bridge Edge Loops', (p) => {
    const r = bridgeLoops(om(), osel(), p.twist);
    if (!r.ok) { toast(r.msg, true); return false; }
    setSelFaces(r.faces); rebuildObject(S.active);
  }, { twist: 0 }, [{ k: 'twist', label: 'Twist', def: 0, min: -500, max: 500, int: true }]);
}
function opMerge(kind) {
  if (!needSel()) return;
  const labels = { center: 'Merge at Center', cursor: 'Merge at Cursor', collapse: 'Collapse', distance: 'Merge by Distance' };
  const schema = kind === 'distance' ? [{ k: 'dist', label: 'Merge Distance', def: 0.0001, min: 0, step: 0.001 }] : null;
  runOp(labels[kind], (p) => {
    const o = S.active, m = o.mesh, s = osel();
    let r;
    if (kind === 'center') {
      const c = [0, 0, 0]; for (const v of s.verts) { c[0] += m.verts[v][0]; c[1] += m.verts[v][1]; c[2] += m.verts[v][2]; }
      r = mergeAt(m, s.verts, vscale(c, 1 / s.verts.size));
    } else if (kind === 'cursor') {
      const lc = S.cursor.clone().applyMatrix4(o.node.matrixWorld.clone().invert());
      r = mergeAt(m, s.verts, [lc.x, lc.y, lc.z]);
    } else if (kind === 'collapse') r = mergeCollapse(m, s);
    else { r = mergeByDistance(m, s.verts, p.dist); toast(`Removed ${r.removed} vertices`); }
    if (!r) { toast('Select at least two vertices', true); return false; }
    setSelVerts(r.verts); rebuildObject(o);
  }, { dist: 0.0001 }, schema);
}
function opDelete(kind) {
  if (S.mode === 'object') {
    const objs = selectedObjects();
    if (!objs.length) { toast('Select an object first', true); return; }
    runOp('Delete', () => { for (const o of objs) removeObject(o); S.active = S.objects.find((o) => o.selected) || S.objects[S.objects.length - 1] || null; });
    return;
  }
  if (!needSel()) return;
  const labels = { verts: 'Delete Vertices', edges: 'Delete Edges', faces: 'Delete Faces', only_faces: 'Delete Only Faces', edges_faces: 'Delete Only Edges & Faces', dis_verts: 'Dissolve Vertices', dis_edges: 'Dissolve Edges', dis_faces: 'Dissolve Faces' };
  runOp(labels[kind], () => {
    const o = S.active, m = o.mesh, s = osel();
    switch (kind) {
      case 'verts': deleteVerts(m, s.verts); break;
      case 'edges': if (!s.edges.size) { toast('Select edges first', true); return false; } deleteEdges(m, s.edges); break;
      case 'faces': if (!s.faces.size) { toast('Select faces first', true); return false; } deleteFaces(m, s.faces); break;
      case 'only_faces': if (!s.faces.size) { toast('Select faces first', true); return false; } deleteFaces(m, s.faces, 'only_faces'); break;
      case 'edges_faces': deleteEdgesFaces(m, s.edges, s.faces); break;
      case 'dis_verts': dissolveVerts(m, s.verts); break;
      case 'dis_edges': if (!s.edges.size) { toast('Select edges first', true); return false; } dissolveEdges(m, s.edges); break;
      case 'dis_faces': {
        if (s.faces.size < 2) { toast('Select two or more connected faces', true); return false; }
        const r = dissolveFaces(m, s.faces);
        if (r.failed) toast('Some regions have holes and were skipped');
        o.esel = emptySel(); rebuildObject(o); return;
      }
    }
    o.esel = emptySel();
    rebuildObject(o);
  });
}
function opNormals(kind) {
  if (S.mode === 'object' || kind === 'smooth' || kind === 'flat') {
    const objs = S.mode === 'object' ? selectedObjects() : [S.active];
    if (!objs.length || !objs[0]) { toast('Select an object first', true); return; }
    if (kind === 'smooth' || kind === 'flat') { runOp(kind === 'smooth' ? 'Shade Smooth' : 'Shade Flat', () => { for (const o of objs) { o.mesh.smooth = kind === 'smooth'; rebuildObject(o); } }); return; }
    runOp(kind === 'flip' ? 'Flip Normals' : 'Recalculate Normals', () => {
      for (const o of objs) {
        const all = new Set(o.mesh.faces.keys());
        if (kind === 'flip') flipFaces(o.mesh, all); else recalcNormals(o.mesh, all, kind === 'inside');
        rebuildObject(o);
      }
    });
    return;
  }
  if (!needSel('faces')) return;
  runOp(kind === 'flip' ? 'Flip Normals' : 'Recalculate Normals', () => {
    const fs = osel().faces;
    if (kind === 'flip') flipFaces(om(), fs); else recalcNormals(om(), fs, kind === 'inside');
    rebuildObject(S.active);
  });
}
function opSeam(mark) {
  if (!needSel('edges')) return;
  runOp(mark ? 'Mark Seam' : 'Clear Seam', () => {
    const m = om();
    for (const k of osel().edges) { if (mark) m.seams.add(k); else m.seams.delete(k); }
    rebuildObject(S.active);
  });
}
function opTriangulate() {
  if (!needSel('faces')) return;
  runOp('Triangulate Faces', () => {
    const r = triangulateFaces(om(), osel().faces);
    if (r.skipped) toast(`${r.skipped} invalid face outline${r.skipped > 1 ? 's' : ''} left unchanged · check crossing or duplicate edges`, true);
    else if (!r.changed) toast('Selected faces are already triangles');
    if (!r.changed) return false;
    setSelFaces(r.faces); rebuildObject(S.active);
  });
}
function opTrisToQuads() {
  if (!needSel('faces')) return;
  runOp('Tris to Quads', (p) => { const r = trisToQuads(om(), osel().faces, p.angle); setSelFaces(r.faces); rebuildObject(S.active); },
    { angle: 40 }, [{ k: 'angle', label: 'Max Angle (°)', def: 40, min: 0, max: 180, step: 1 }]);
}

// ---------- selection operators ----------
function opSelect(kind) {
  if (S.mode === 'object') {
    if (kind === 'all') for (const o of S.objects) if (o.visible) o.selected = true;
    if (kind === 'none') for (const o of S.objects) o.selected = false;
    if (kind === 'invert') for (const o of S.objects) if (o.visible) o.selected = !o.selected;
    if (kind === 'all' && !S.active && S.objects.length) S.active = S.objects[0];
    onSelectionChanged();
    return;
  }
  if (!needEdit()) return;
  const o = S.active, m = o.mesh, s = o.esel, T = topo(m);
  switch (kind) {
    case 'all': editSelectAll('select'); return;
    case 'none': editSelectAll('none'); return;
    case 'invert': editSelectAll('invert'); return;
    case 'linked': case 'linked_seam': {
      if (!s.verts.size) { toast('Select something to grow from', true); return; }
      const vs = linkedVerts(m, s.verts, kind === 'linked_seam');
      if (S.selectMode === 'face') { const fs = new Set(); m.faces.forEach((f, i) => { if (f.v.every((v) => vs.has(v))) fs.add(i); }); setSelFaces(fs); }
      else setSelVerts(vs);
      break;
    }
    case 'more': {
      const vs = new Set(s.verts);
      if (S.selectMode === 'face') { const fs = new Set(s.faces); for (const v of s.verts) for (const f of T.vertFaces[v]) fs.add(f); setSelFaces(fs); }
      else { for (const v of s.verts) for (const ei of T.vertEdges[v]) { const [a, b] = T.edges[ei]; vs.add(a); vs.add(b); } setSelVerts(vs); }
      break;
    }
    case 'less': {
      const boundary = new Set();
      for (const v of s.verts) for (const ei of T.vertEdges[v]) { const [a, b] = T.edges[ei]; if (!s.verts.has(a) || !s.verts.has(b)) boundary.add(v); }
      if (S.selectMode === 'face') { const fs = new Set(); for (const fi of s.faces) if (!m.faces[fi].v.some((v) => boundary.has(v))) fs.add(fi); setSelFaces(fs); }
      else setSelVerts(new Set([...s.verts].filter((v) => !boundary.has(v))));
      break;
    }
    case 'boundary': {
      if (!s.faces.size) { toast('Select faces first', true); return; }
      const cnt = new Map();
      for (const fi of s.faces) { const f = m.faces[fi]; for (let j = 0; j < f.v.length; j++) { const k = ekey(f.v[j], f.v[(j + 1) % f.v.length]); cnt.set(k, (cnt.get(k) || 0) + 1); } }
      const es = new Set([...cnt].filter(([, c]) => c === 1).map(([k]) => k));
      S.selectMode = 'edge'; setSelEdges(es);
      break;
    }
    case 'loop': case 'ring': S.pendingTap = kind; hint(kind === 'loop' ? 'Tap an edge to select its loop' : 'Tap an edge to select its ring'); return;
  }
  onSelectionChanged();
}
function loopSelectAt(x, y, kind, op) {
  S.pendingTap = null; hint(null);
  const el = pickEdgeAny(x, y);
  if (!el) { toast('No edge there', true); return; }
  const o = S.active, m = o.mesh;
  const keys = kind === 'ring' ? edgeRingKeys(m, el.key) : edgeLoopKeys(m, el.key);
  if (op === 'set') o.esel = emptySel();
  const s = o.esel;
  if (S.selectMode === 'vert') { const vs = new Set(s.verts); for (const k of keys) { const [a, b] = ekeySplit(k); if (op === 'sub') { vs.delete(a); vs.delete(b); } else { vs.add(a); vs.add(b); } } setSelVerts(vs); }
  else if (S.selectMode === 'edge') { const es = new Set(s.edges); for (const k of keys) op === 'sub' ? es.delete(k) : es.add(k); setSelEdges(es); }
  else {
    // face loop: faces fully bounded by a loop pair — use faces sharing ring/loop edges
    const T = topo(m), fs = new Set(s.faces);
    const ring = kind === 'ring' ? keys : edgeRingKeys(m, el.key);
    for (const k of ring) for (const f of T.edgeFaces[T.edgeIndex.get(k)] || []) if (m.faces[f].v.length === 4) op === 'sub' ? fs.delete(f) : fs.add(f);
    setSelFaces(fs);
  }
  onSelectionChanged();
}

// ---------- snap / cursor ----------
function selectionWorldPoints() {
  if (S.mode === 'edit' && S.active) return [...S.active.esel.verts].map((v) => worldOfVert(S.active, v));
  return selectedObjects().map((o) => o.node.position.clone());
}
function opSnap(kind) {
  const pts = selectionWorldPoints();
  if (kind === 'cursor_sel') { if (!pts.length) { toast('Nothing selected', true); return; } S.cursor.copy(pivotOf(pts, 'median')); refreshOriginDots(); pushUndo('Cursor to Selected'); return; }
  if (kind === 'cursor_origin') { S.cursor.set(0, 0, 0); refreshOriginDots(); pushUndo('Cursor to World Origin'); return; }
  if (kind === 'cursor_active') {
    if (!S.active) return;
    if (S.mode === 'edit' && S.active.activeFace >= 0) S.cursor.copy(new THREE.Vector3(...faceCenter(om(), om().faces[S.active.activeFace])).applyMatrix4(S.active.node.matrixWorld));
    else S.cursor.copy(S.active.node.position);
    refreshOriginDots(); pushUndo('Cursor to Active'); return;
  }
  if (!pts.length) { toast('Nothing selected', true); return; }
  if (kind === 'sel_cursor') {
    const c = pivotOf(pts, 'median');
    instantTransform('move', { T: S.cursor.clone().sub(c) }, 'Selection to Cursor');
    return;
  }
  if (kind === 'sel_grid') {
    const inc = S.mode === 'edit' ? S.snapMove : 1;
    runOp('Selection to Grid', () => {
      if (S.mode === 'edit') {
        const o = S.active, M = o.node.matrixWorld, inv = M.clone().invert();
        for (const v of o.esel.verts) { const w = worldOfVert(o, v); w.set(snapTo(w.x, inc), snapTo(w.y, inc), snapTo(w.z, inc)).applyMatrix4(inv); o.mesh.verts[v] = [w.x, w.y, w.z]; }
        updateGeomPositions(o);
      } else for (const o of selectedObjects()) { const p = o.node.position; p.set(snapTo(p.x, inc), snapTo(p.y, inc), snapTo(p.z, inc)); }
      refreshOriginDots();
    });
  }
}

// ---------- object operators ----------
function bakeMatrix(o, Mold, Mnew) {
  const X = Mnew.clone().invert().multiply(Mold);
  const v = new THREE.Vector3();
  o.mesh.verts = o.mesh.verts.map((p) => { v.fromArray(p).applyMatrix4(X); return [v.x, v.y, v.z]; });
  if (X.determinant() < 0) flipFaces(o.mesh, new Set(o.mesh.faces.keys()));
  Mnew.decompose(o.node.position, o.node.quaternion, o.node.scale);
  rebuildObject(o);
}
function opApply(kind) {
  const objs = selectedObjects();
  if (!objs.length) { toast('Select an object first', true); return; }
  runOp({ loc: 'Apply Location', rot: 'Apply Rotation', scale: 'Apply Scale', all: 'Apply All Transforms', rotscale: 'Apply Rotation & Scale' }[kind], () => {
    for (const o of objs) {
      o.node.updateMatrixWorld();
      const M = o.node.matrix.clone();
      const p = o.node.position.clone(), q = o.node.quaternion.clone(), s = o.node.scale.clone();
      const N = new THREE.Matrix4();
      if (kind === 'all') N.identity();
      else if (kind === 'loc') N.compose(new THREE.Vector3(), q, s);
      else if (kind === 'rot') N.compose(p, new THREE.Quaternion(), s);
      else if (kind === 'scale') N.compose(p, q, new THREE.Vector3(1, 1, 1));
      else N.compose(p, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      if (Math.abs(N.determinant()) < 1e-12) { toast(o.name + ' has a zero scale axis', true); continue; }
      bakeMatrix(o, M, N);
    }
    refreshOriginDots();
  });
}
function opOrigin(kind) {
  const objs = selectedObjects();
  if (!objs.length) { toast('Select an object first', true); return; }
  runOp({ geom: 'Origin to Geometry', cursor: 'Origin to 3D Cursor', geom_to_origin: 'Geometry to Origin' }[kind], () => {
    for (const o of objs) {
      const m = o.mesh;
      if (!m.verts.length) continue;
      const b = meshBounds(m);
      const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      o.node.updateMatrixWorld();
      let local;
      if (kind === 'cursor') { const l = S.cursor.clone().applyMatrix4(o.node.matrixWorld.clone().invert()); local = [l.x, l.y, l.z]; }
      else local = c;
      m.verts = m.verts.map((p) => [p[0] - local[0], p[1] - local[1], p[2] - local[2]]);
      if (kind !== 'geom_to_origin') o.node.position.copy(new THREE.Vector3(...local).applyMatrix4(o.node.matrixWorld));
      rebuildObject(o);
    }
    refreshOriginDots();
  });
}
function opJoin() {
  const objs = selectedObjects();
  const act = S.active;
  if (objs.length < 2 || !act || !act.selected) { toast('Select two or more objects (the active one receives the others)', true); return; }
  runOp('Join', () => {
    act.node.updateMatrixWorld();
    const inv = act.node.matrixWorld.clone().invert();
    for (const o of objs) {
      if (o === act) continue;
      o.node.updateMatrixWorld();
      const X = inv.clone().multiply(o.node.matrixWorld);
      const flip = X.determinant() < 0;
      const slotMap = (o.materials.length ? o.materials : [null]).map((id) => {
        if (id === null) return 0;
        let i = act.materials.indexOf(id);
        if (i < 0) { act.materials.push(id); i = act.materials.length - 1; }
        return i;
      });
      const v = new THREE.Vector3();
      const before = act.mesh.faces.length;
      appendMesh(act.mesh, o.mesh, (p) => { v.fromArray(p).applyMatrix4(X); return [v.x, v.y, v.z]; }, (slot) => slotMap[slot] ?? 0);
      if (flip) flipFaces(act.mesh, new Set([...Array(act.mesh.faces.length - before).keys()].map((i) => i + before)));
      removeObject(o);
    }
    S.active = act; act.selected = true;
    rebuildObject(act);
  });
}
function separateByMaterial(o) {
  const nSlots = o.materials.length;
  const eff = (f) => (f.mat >= 0 && f.mat < nSlots ? f.mat : 0);
  const used = [...new Set(o.mesh.faces.map(eff))].sort((x, y) => x - y);
  if (used.length < 2) return 0;
  let made = 0;
  for (const slot of used.slice(1)) {
    const fs = new Set(); o.mesh.faces.forEach((f, i) => { if (eff(f) === slot) fs.add(i); });
    const part = extractFaces(o.mesh, fs);
    for (const f of part.faces) f.mat = 0;
    const mid = o.materials[slot], mt = matById(mid);
    const c = createObject(mt ? `${o.name}.${mt.name}` : o.name, part, { pos: o.node.position.toArray(), quat: o.node.quaternion.toArray(), scl: o.node.scale.toArray(), materials: mid !== undefined ? [mid] : [], modifiers: o.modifiers });
    c.selected = false; made++;
  }
  const keep = o.materials[used[0]];
  for (const f of o.mesh.faces) f.mat = 0;
  o.materials = keep !== undefined ? [keep] : [];
  o.esel = emptySel();
  rebuildObject(o);
  return made;
}
function separateLoose(o) {
  const isl = looseParts(o.mesh);
  if (isl.length < 2) return 0;
  isl.sort((a, b) => b.length - a.length);
  const key = (p) => p.join(',');
  const sets = isl.slice(1).map((vs) => new Set(vs.map((v) => key(o.mesh.verts[v]))));
  for (const want of sets) {
    const vs = new Set(); o.mesh.verts.forEach((p, i) => { if (want.has(key(p))) vs.add(i); });
    const part = extractPart(o.mesh, vs);
    const c = createObject(o.name, part, { pos: o.node.position.toArray(), quat: o.node.quaternion.toArray(), scl: o.node.scale.toArray(), materials: o.materials, modifiers: o.modifiers });
    c.selected = false;
  }
  o.esel = emptySel();
  rebuildObject(o);
  return sets.length;
}
function opSeparate(kind) {
  const labels = { selected: 'Separate Selection', loose: 'Separate by Loose Parts', material: 'Separate by Material' };
  if (S.mode === 'object') {
    if (kind === 'selected') { toast('Switch to Edit Mode and select the part to separate', true); return; }
    const objs = selectedObjects();
    if (!objs.length) { toast('Select an object first', true); return; }
    runOp(labels[kind], () => {
      let n = 0;
      for (const o of objs) n += kind === 'material' ? separateByMaterial(o) : separateLoose(o);
      if (!n) { toast(kind === 'material' ? 'Each selected object uses only one material' : 'Each selected object is already one piece', true); return false; }
      toast(`Made ${n} new object${n > 1 ? 's' : ''}`);
    });
    return;
  }
  if (!needEdit()) return;
  const o = S.active;
  if (kind === 'selected' && !o.esel.verts.size) { toast('Select the part to separate', true); return; }
  runOp(labels[kind], () => {
    let n;
    if (kind === 'selected') {
      const part = extractPart(o.mesh, new Set(o.esel.verts));
      o.esel = emptySel(); rebuildObject(o);
      const c = createObject(o.name, part, { pos: o.node.position.toArray(), quat: o.node.quaternion.toArray(), scl: o.node.scale.toArray(), materials: o.materials, modifiers: o.modifiers });
      c.selected = false; n = 1;
    } else n = kind === 'material' ? separateByMaterial(o) : separateLoose(o);
    if (!n) { toast(kind === 'material' ? 'This mesh uses only one material' : 'Mesh is already one piece', true); return false; }
    toast(`Made ${n} new object${n > 1 ? 's' : ''}`);
  });
}
function opHide(kind) {
  if (S.mode !== 'object') return;
  runOp(kind === 'hide' ? 'Hide' : 'Reveal', () => {
    if (kind === 'hide') { for (const o of selectedObjects()) { o.visible = false; o.selected = false; o.node.visible = false; } }
    else for (const o of S.objects) if (!o.visible) { o.visible = true; o.selected = true; o.node.visible = true; }
  });
}

// ---------- mode switching ----------
function setMode(mode) {
  if (S.tool === 'knife') knifeCancel();
  if (TF.active) tfConfirm();
  if (PM.active) pmConfirm();
  if (mode === 'edit') {
    if (!S.active) { toast('Select an object to edit', true); return; }
    if (!S.active.visible) { toast('That object is hidden', true); return; }
    S.active.selected = true;
  }
  S.mode = mode;
  for (const o of S.objects) rebuildObject(o);
  S.pendingTap = null; hint(null);
  if (S.active) flushSel();
  pushUndo(mode === 'edit' ? 'Edit Mode' : 'Object Mode');
  refreshAllObjects();
  onModeChanged();
  onSelectionChanged();
}
let onModeChanged = () => {};
