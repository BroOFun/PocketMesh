// ============================================================================
// app_transform.js — modal transforms (G/R/S, shrink/fatten), gizmo tools,
// parameter modals (inset, loop cut slide), pivot & orientation logic
// ============================================================================

const TF = { active: null };
const _q0 = new THREE.Quaternion();

function hasEditSel() { return S.mode === 'edit' && S.active && S.active.esel.verts.size > 0; }
function hasAnySel() { return S.mode === 'edit' ? hasEditSel() : selectedObjects().length > 0; }

// ---- orientation frames (world-space quaternions) ----
function selectionNormalFrame(o, verts) {
  const m = o.mesh, s = o.esel;
  const nq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(o.node.matrixWorld));
  let n = [0, 0, 0], tangent = null;
  const T = topo(m);
  const faces = verts ? m.faces.map((f, i) => i).filter((i) => m.faces[i].v.every((v) => verts.has(v))) : [...s.faces];
  if (faces.length) {
    for (const fi of faces) { const fn = faceNormalRaw(m, m.faces[fi]); n = vadd(n, fn); }
    const f = m.faces[o.activeFace >= 0 && faces.includes(o.activeFace) ? o.activeFace : faces[0]];
    let best = 0;
    for (let i = 0; i < f.v.length; i++) { const e = vsub(m.verts[f.v[(i + 1) % f.v.length]], m.verts[f.v[i]]); const l = vlen(e); if (l > best) { best = l; tangent = e; } }
  } else {
    const vs = verts || s.verts;
    const N = vertexNormals(m);
    for (const v of vs) n = vadd(n, N[v] || [0, 0, 0]);
    const es = [...(verts ? [] : s.edges)];
    if (es.length) { const [a, b] = ekeySplit(es[0]); tangent = vsub(m.verts[b], m.verts[a]); }
    if (vlen(n) < 1e-9 && tangent) { n = vcross(tangent, Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]); }
  }
  if (vlen(n) < 1e-9) return nq;
  const z = new THREE.Vector3(...vnorm(n)).applyQuaternion(nq).normalize();
  let x = tangent ? new THREE.Vector3(...tangent).applyQuaternion(nq) : new THREE.Vector3(1, 0, 0);
  x.addScaledVector(z, -x.dot(z));
  if (x.lengthSq() < 1e-10) { x = new THREE.Vector3(1, 0, 0); x.addScaledVector(z, -x.dot(z)); if (x.lengthSq() < 1e-10) x.set(0, 1, 0).addScaledVector(z, -z.y); }
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
function orientQuat(kind = S.orient, vertsSubset) {
  if (kind === 'global') return new THREE.Quaternion();
  if (kind === 'view') return camera.quaternion.clone();
  const o = S.active;
  if (!o) return new THREE.Quaternion();
  o.node.updateMatrixWorld();
  const local = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(o.node.matrixWorld));
  if (kind === 'local' || S.mode !== 'edit') return local;
  return selectionNormalFrame(o, vertsSubset);
}

// ---- pivots ----
function worldOfVert(o, i, out = new THREE.Vector3()) { return out.fromArray(o.mesh.verts[i]).applyMatrix4(o.node.matrixWorld); }
function pivotOf(points /* Vector3[] */, kind) {
  if (!points.length) return S.cursor.clone();
  if (kind === 'bounds') { const b = new THREE.Box3().setFromPoints(points); return b.getCenter(new THREE.Vector3()); }
  const c = new THREE.Vector3(); for (const p of points) c.add(p); return c.divideScalar(points.length);
}

// ---- build start state for any transform ----
function tfBuildState(kind) {
  const st = { kind, mode: S.mode, orient: orientQuat() };
  if (S.mode === 'object') {
    const objs = selectedObjects();
    if (!objs.length) return null;
    st.objs = objs.map((o) => { o.node.updateMatrixWorld(); return { o, m0: o.node.matrixWorld.clone() }; });
    const pts = objs.map((o) => o.node.position.clone());
    let piv;
    if (S.pivot === 'cursor') piv = S.cursor.clone();
    else if (S.pivot === 'active' && S.active && S.active.selected) piv = S.active.node.position.clone();
    else piv = pivotOf(pts, S.pivot === 'bounds' ? 'bounds' : 'median');
    st.pivot = piv;
    st.individual = S.pivot === 'individual';
    return st;
  }
  const o = S.active;
  if (!o || !o.esel.verts.size) return null;
  o.node.updateMatrixWorld();
  st.o = o;
  st.M = o.node.matrixWorld.clone();
  st.Minv = st.M.clone().invert();
  const sel = [...o.esel.verts];
  st.P0 = o.mesh.verts.map((p) => p.slice());
  st.items = sel.map((i) => ({ i, w: 1, g: 0 }));
  const wpts = sel.map((i) => worldOfVert(o, i));
  // groups for individual origins
  st.groups = [{ pivot: null, orient: st.orient }];
  if (S.pivot === 'individual') {
    const isl = vertIslands(o.mesh, o.esel.verts);
    const gi = new Map();
    st.groups = isl.map((vs, k) => {
      for (const v of vs) gi.set(v, k);
      const pts = vs.map((v) => worldOfVert(o, v));
      return { pivot: pivotOf(pts, 'median'), orient: S.orient === 'normal' ? selectionNormalFrame(o, new Set(vs)) : st.orient };
    });
    for (const it of st.items) it.g = gi.get(it.i) || 0;
  } else {
    let piv;
    if (S.pivot === 'cursor') piv = S.cursor.clone();
    else if (S.pivot === 'active' && o.activeFace >= 0 && o.mesh.faces[o.activeFace]) piv = new THREE.Vector3(...faceCenter(o.mesh, o.mesh.faces[o.activeFace])).applyMatrix4(st.M);
    else piv = pivotOf(wpts, S.pivot === 'bounds' ? 'bounds' : 'median');
    st.groups[0].pivot = piv;
  }
  st.pivot = st.groups[0].pivot || pivotOf(wpts, 'median');
  // proportional editing weights
  if (S.prop && kind !== 'shrink') {
    const selSet = o.esel.verts;
    const R = Math.max(1e-4, S.propRadius);
    const P = o.mesh.verts;
    for (let i = 0; i < P.length; i++) {
      if (selSet.has(i)) continue;
      const wp = worldOfVert(o, i);
      let dmin = Infinity, gmin = 0;
      for (let k = 0; k < wpts.length; k++) { const d = wp.distanceTo(wpts[k]); if (d < dmin) { dmin = d; gmin = st.items[k].g; } }
      if (dmin >= R) continue;
      const t = dmin / R;
      let w;
      switch (S.propFalloff) {
        case 'linear': w = 1 - t; break;
        case 'sharp': w = (1 - t) * (1 - t); break;
        case 'root': w = Math.sqrt(1 - t); break;
        case 'sphere': w = Math.sqrt(Math.max(0, 1 - t * t)); break;
        case 'constant': w = 1; break;
        default: w = 3 * (1 - t) * (1 - t) - 2 * (1 - t) * (1 - t) * (1 - t); // smooth
      }
      if (w > 1e-4) st.items.push({ i, w, g: gmin });
    }
  }
  if (kind === 'shrink') {
    // per-vertex normals from adjacent selected faces (fallback: all adjacent faces)
    const m = o.mesh, T = topo(m);
    st.vn = new Map();
    for (const it of st.items) {
      let n = [0, 0, 0];
      const fs = T.vertFaces[it.i];
      const selF = fs.filter((f) => o.esel.faces.has(f));
      for (const f of selF.length ? selF : fs) n = vadd(n, faceNormal(m, m.faces[f]));
      st.vn.set(it.i, vnorm(n));
    }
  }
  return st;
}

// ---- apply (T world translation, R world quaternion, Sv scale in orient frame, or shrink distance) ----
const _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4(), _mS = new THREE.Matrix4(), _mR = new THREE.Matrix4(), _mO = new THREE.Matrix4(), _mOi = new THREE.Matrix4();
function composeAbout(pivot, T, R, Sv, O, w = 1, out = new THREE.Matrix4()) {
  const q = w === 1 ? R : new THREE.Quaternion().slerp(R, w);
  const sv = w === 1 ? Sv : new THREE.Vector3(1 + (Sv.x - 1) * w, 1 + (Sv.y - 1) * w, 1 + (Sv.z - 1) * w);
  _mO.makeRotationFromQuaternion(O); _mOi.copy(_mO).transpose();
  _mS.makeScale(sv.x, sv.y, sv.z);
  _mR.makeRotationFromQuaternion(q);
  out.makeTranslation(pivot.x + T.x * w, pivot.y + T.y * w, pivot.z + T.z * w);
  out.multiply(_mR).multiply(_mO).multiply(_mS).multiply(_mOi);
  _mA.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  out.multiply(_mA);
  return out;
}
function tfApplyState(st, d) {
  const T = d.T || new THREE.Vector3(), R = d.R || new THREE.Quaternion(), Sv = d.S || new THREE.Vector3(1, 1, 1);
  if (st.mode === 'object') {
    for (const t of st.objs) {
      const piv = st.individual ? new THREE.Vector3().setFromMatrixPosition(t.m0) : st.pivot;
      const O = st.orient;
      const A = composeAbout(piv, T, R, Sv, st.individual && S.orient === 'local' ? new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(t.m0)) : O);
      A.multiply(t.m0);
      A.decompose(t.o.node.position, t.o.node.quaternion, t.o.node.scale);
    }
    refreshOriginDots();
    for (const t of st.objs) t.o.node.updateMatrixWorld();
    requestRender();
    return;
  }
  const o = st.o, P = o.mesh.verts;
  if (st.kind === 'shrink') {
    const dist = d.dist || 0;
    for (const it of st.items) {
      const n = st.vn.get(it.i);
      P[it.i] = vadd(st.P0[it.i], vscale(n, dist * it.w));
    }
  } else {
    const mats = st.groups.map((g) => {
      const A = composeAbout(g.pivot, T, R, Sv, g.orient);
      return new THREE.Matrix4().multiplyMatrices(st.Minv, A).multiply(st.M);
    });
    const v = new THREE.Vector3();
    for (const it of st.items) {
      const p0 = st.P0[it.i];
      if (it.w === 1) { v.fromArray(p0).applyMatrix4(mats[it.g]); }
      else {
        const g = st.groups[it.g];
        const A = composeAbout(g.pivot, T, R, Sv, g.orient, it.w);
        v.fromArray(p0).applyMatrix4(st.M).applyMatrix4(A).applyMatrix4(st.Minv);
      }
      P[it.i] = [v.x, v.y, v.z];
    }
  }
  updateGeomPositions(o);
}
function tfRestoreState(st) {
  if (st.mode === 'object') { for (const t of st.objs) t.m0.decompose(t.o.node.position, t.o.node.quaternion, t.o.node.scale); refreshOriginDots(); requestRender(); return; }
  const o = st.o;
  o.mesh.verts = st.P0.map((p) => p.slice());
  updateGeomPositions(o);
}

// ---- modal transform ----
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
function tfStart(kind, opts = {}) {
  if (TF.active) tfCancel();
  const st = tfBuildState(kind);
  if (!st) { toast(S.mode === 'edit' ? 'Select some geometry first' : 'Select an object first', true); return false; }
  const pc = toScreen(st.pivot);
  const r = 110;
  TF.active = {
    st, kind, label: opts.label || { move: 'Move', rotate: 'Rotate', scale: 'Scale', shrink: 'Shrink/Fatten' }[kind],
    axis: null, plane: false, alt: false, customAxis: opts.customAxis || null,
    num: '', snap: S.snap,
    start: { x: pc.x + r, y: pc.y }, ptr: { x: pc.x + r, y: pc.y }, accAngle: 0, prevAngle: null,
    onConfirm: opts.onConfirm, onCancel: opts.onCancel, undoLabel: opts.undoLabel || null,
    value: null,
  };
  if (opts.axis !== undefined) TF.active.axis = opts.axis;
  tfShowBar();
  gizmoSync();
  tfUpdate();
  return true;
}
function tfAxisVec(t) {
  if (t.customAxis && t.axis === null) return t.customAxis.clone();
  if (t.axis === null) return null;
  const q = t.alt ? (S.orient === 'global' ? orientQuat('local') : new THREE.Quaternion()) : t.st.orient;
  return AXES[t.axis].clone().applyQuaternion(q).normalize();
}
function tfFrame(t) { return t.alt ? (S.orient === 'global' ? orientQuat('local') : new THREE.Quaternion()) : t.st.orient; }
function rayPlane(x, y, point, normal) {
  const rc = screenRay(x, y);
  const denom = rc.ray.direction.dot(normal);
  if (Math.abs(denom) < 1e-6) return null;
  const t = point.clone().sub(rc.ray.origin).dot(normal) / denom;
  return rc.ray.origin.clone().addScaledVector(rc.ray.direction, t);
}
function worldPerPixel(at) {
  const { h } = viewSize();
  if (camera.isOrthographicCamera) return (ortho.top - ortho.bottom) / h;
  const d = at.clone().sub(camera.position).dot(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
  return (2 * Math.max(d, 1e-4) * Math.tan((CAM.fov * DEG) / 2)) / h;
}
function parseNum(s) {
  if (!s || s === '-' || s === '.' || s === '-.') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}
function snapTo(v, inc) { return inc > 0 ? Math.round(v / inc) * inc : v; }
function tfCompute(t) {
  const st = t.st, piv = st.pivot;
  const pc = toScreen(piv);
  const num = parseNum(t.num);
  const camZ = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
  if (t.kind === 'move') {
    let T = new THREE.Vector3();
    const ax = tfAxisVec(t);
    if (num !== null) {
      if (!ax && t.axis === null) { t.axis = 0; }
      const a = tfAxisVec(t);
      if (t.plane) { const fr = tfFrame(t); const free = [0, 1, 2].filter((k) => k !== t.axis); T = AXES[free[0]].clone().applyQuaternion(fr).multiplyScalar(num); }
      else T = a.multiplyScalar(num);
      t.value = { T, txt: `D ${fmt(num)}` };
      return t.value;
    }
    const sx = pc.x + (t.ptr.x - t.start.x), sy = pc.y + (t.ptr.y - t.start.y);
    if (ax && !t.plane) {
      const s0 = toScreen(piv), s1 = toScreen(piv.clone().add(ax));
      const dx = s1.x - s0.x, dy = s1.y - s0.y, l2 = dx * dx + dy * dy;
      let dist;
      if (l2 < 4) {
        const hit = rayPlane(sx, sy, piv, camZ);
        dist = hit ? hit.sub(piv).dot(ax) : 0;
      } else dist = ((t.ptr.x - t.start.x) * dx + (t.ptr.y - t.start.y) * dy) / l2;
      if (t.snap) dist = snapTo(dist, S.snapMove);
      T = ax.clone().multiplyScalar(dist);
      t.value = { T, txt: `D ${fmt(dist)} along ${'XYZ'[t.axis] ?? 'normal'}` };
    } else {
      let n = camZ;
      if (t.plane && t.axis !== null) n = AXES[t.axis].clone().applyQuaternion(tfFrame(t));
      let hit = rayPlane(sx, sy, piv, n);
      if (!hit || hit.distanceTo(piv) > CAM.dist * 50) hit = rayPlane(sx, sy, piv, camZ) || piv.clone();
      T = hit.sub(piv);
      if (t.snap) {
        const fr = tfFrame(t), inv = fr.clone().invert();
        T.applyQuaternion(inv);
        T.set(snapTo(T.x, S.snapMove), snapTo(T.y, S.snapMove), snapTo(T.z, S.snapMove));
        T.applyQuaternion(fr);
      }
      t.value = { T, txt: `D ${fmt(T.x)}  ${fmt(T.y)}  ${fmt(T.z)}  (${fmt(T.length())})` };
    }
    return t.value;
  }
  if (t.kind === 'rotate') {
    let axis = tfAxisVec(t);
    let ang;
    if (num !== null) ang = num * DEG;
    else {
      const a1 = Math.atan2(t.ptr.y - pc.y, t.ptr.x - pc.x);
      if (t.prevAngle === null) t.prevAngle = Math.atan2(t.start.y - pc.y, t.start.x - pc.x);
      let d = a1 - t.prevAngle; d = Math.atan2(Math.sin(d), Math.cos(d));
      t.accAngle += d; t.prevAngle = a1;
      ang = -t.accAngle;
      if (t.snap) ang = snapTo(ang / DEG, S.snapRot) * DEG;
    }
    if (!axis || t.plane) axis = camZ.clone();
    else if (num === null && axis.dot(camZ) < 0) ang = -ang;
    const R = new THREE.Quaternion().setFromAxisAngle(axis, ang);
    t.value = { R, txt: `Rot ${fmt(ang / DEG, 1)}°${t.axis !== null ? ' ' + 'XYZ'[t.axis] : ''}` };
    return t.value;
  }
  if (t.kind === 'scale') {
    let f;
    if (num !== null) f = num;
    else {
      const v0x = t.start.x - pc.x, v0y = t.start.y - pc.y, v1x = t.ptr.x - pc.x, v1y = t.ptr.y - pc.y;
      const l0 = Math.hypot(v0x, v0y) || 1;
      f = (Math.hypot(v1x, v1y) / l0) * Math.sign(v0x * v1x + v0y * v1y || 1);
      if (t.snap) f = snapTo(f, S.snapScale);
    }
    let Sv;
    if (t.axis === null) Sv = new THREE.Vector3(f, f, f);
    else if (t.plane) Sv = new THREE.Vector3(f, f, f).setComponent(t.axis, 1);
    else Sv = new THREE.Vector3(1, 1, 1).setComponent(t.axis, f);
    if (t.alt) { /* alt frame is applied by swapping orient */ }
    t.value = { S: Sv, txt: `Scale ${fmt(Sv.x)}  ${fmt(Sv.y)}  ${fmt(Sv.z)}` };
    return t.value;
  }
  if (t.kind === 'shrink') {
    let dist;
    if (num !== null) dist = num;
    else { dist = (t.ptr.x - t.start.x) * worldPerPixel(piv); if (t.snap) dist = snapTo(dist, S.snapMove); }
    t.value = { dist, txt: `Shrink/Fatten ${fmt(dist)}` };
    return t.value;
  }
}
function tfUpdate() {
  const t = TF.active;
  if (!t) return;
  const v = tfCompute(t);
  if (t.alt && (t.kind === 'scale')) {
    const saved = t.st.orient; t.st.orient = tfFrame(t); for (const g of t.st.groups || []) g._o = g.orient, g.orient = t.st.orient;
    tfApplyState(t.st, v);
    t.st.orient = saved; for (const g of t.st.groups || []) g.orient = g._o;
  } else tfApplyState(t.st, v);
  const info = $('#tfInfo');
  if (info) info.textContent = v.txt;
}
function tfConfirm() {
  const t = TF.active;
  if (!t) return;
  TF.active = null;
  tfHideBar();
  pushUndo(t.undoLabel || t.label);
  if (t.onConfirm) t.onConfirm();
  onSelectionChanged();
}
function tfCancel() {
  const t = TF.active;
  if (!t) return;
  TF.active = null;
  tfRestoreState(t.st);
  tfHideBar();
  if (t.onCancel) t.onCancel();
  onSelectionChanged();
}
function tfDrag(dx, dy) {
  const t = TF.active;
  if (!t) return;
  t.ptr.x += dx; t.ptr.y += dy;
  if (t.num) { t.num = ''; const n = $('#tfNum'); if (n) n.value = ''; }
  tfUpdate();
}
function tfSetAxis(ax, plane = false) {
  const t = TF.active;
  if (!t) return;
  if (t.axis === ax && t.plane === plane) {
    if (!t.alt) t.alt = true;
    else { t.axis = null; t.alt = false; t.plane = false; }
  } else { t.axis = ax; t.alt = false; t.plane = plane; }
  if (t.kind === 'rotate') { t.accAngle = 0; t.prevAngle = null; t.start = { ...t.ptr }; }
  tfShowBar(true);
  tfUpdate();
}
function tfShowBar(refreshOnly) {
  const t = TF.active, bar = $('#tfbar');
  const num = t.num;
  bar.innerHTML = '';
  const axBtn = (k) => {
    const b = h('button', { class: 'ax' + (t.axis === k ? ' on' : '') + (t.axis === k && t.alt ? ' loc' : ''), 'data-ax': 'xyz'[k], 'aria-label': (t.plane ? 'Exclude ' : 'Constrain to ') + 'XYZ'[k] }, h('span', {}, (t.plane ? '⊘' : '') + 'XYZ'[k]));
    b.addEventListener('click', () => tfSetAxis(k, t.plane && t.axis === k ? true : t.plane));
    return b;
  };
  const plane = h('button', { class: 'chip' + (t.plane ? ' on' : ''), title: 'Plane: lock one axis, move in the other two' }, 'Plane');
  plane.addEventListener('click', () => { t.plane = !t.plane; if (t.axis === null) t.axis = 2; tfShowBar(true); tfUpdate(); });
  const inp = h('input', { class: 'num tfnum', id: 'tfNum', inputmode: 'decimal', placeholder: t.kind === 'rotate' ? 'deg' : 'value', 'aria-label': 'Exact value' });
  inp.value = num;
  inp.addEventListener('input', () => { t.num = inp.value.replace(',', '.'); tfUpdate(); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tfConfirm(); } if (e.key === 'Escape') { e.preventDefault(); tfCancel(); } e.stopPropagation(); });
  const neg = h('button', { class: 'chip', 'aria-label': 'Negate value' }, '±');
  neg.addEventListener('click', () => { t.num = t.num.startsWith('-') ? t.num.slice(1) : '-' + (t.num || ''); inp.value = t.num; tfUpdate(); });
  const snap = h('button', { class: 'chip' + (t.snap ? ' on' : ''), html: icon('magnet'), 'aria-label': 'Snap increments' });
  snap.addEventListener('click', () => { t.snap = !t.snap; tfShowBar(true); tfUpdate(); });
  const cancel = h('button', { class: 'cancel', 'aria-label': 'Cancel' }, 'Cancel');
  cancel.addEventListener('click', tfCancel);
  const ok = h('button', { class: 'ok' }, 'Done');
  ok.addEventListener('click', tfConfirm);
  bar.append(h('div', { class: 'info', id: 'tfInfo' }, ''), h('span', { class: 'title' }, t.label));
  if (t.kind !== 'shrink') bar.append(axBtn(0), axBtn(1), axBtn(2), plane);
  bar.append(inp, neg, snap, h('span', { class: 'grow' }), cancel, ok);
  bar.hidden = false;
  $('#shelf').hidden = true;
  if (!refreshOnly) hint('Drag anywhere to ' + t.label.toLowerCase() + ' · two fingers still orbit/zoom');
  else hint(null);
}
function tfHideBar() {
  $('#tfbar').hidden = true;
  $('#shelf').hidden = false;
  hint(null);
}

// ---- parameter modal: one value driven by horizontal drag (inset, loop cut slide, etc.) ----
const PM = { active: null };
function paramModal({ label, value = 0, min = -Infinity, max = Infinity, perPixel = 0.01, apply, onConfirm, onCancel, extra, undoLabel, hintText }) {
  if (TF.active) tfCancel();
  PM.active = { label, value, min, max, perPixel, apply, onConfirm, onCancel, extra, undoLabel, num: '' };
  pmShowBar();
  apply(value);
  if (hintText) hint(hintText);
}
function pmDrag(dx) {
  const p = PM.active;
  if (!p) return;
  p.value = clamp(p.value + dx * p.perPixel, p.min, p.max);
  if (S.snap && p.snapInc) p.value = snapTo(p.value, p.snapInc);
  p.apply(p.value);
  const n = $('#pmNum'); if (n && document.activeElement !== n) n.value = fmt(p.value);
}
function pmShowBar() {
  const p = PM.active, bar = $('#tfbar');
  bar.innerHTML = '';
  const inp = h('input', { class: 'num tfnum', id: 'pmNum', inputmode: 'decimal', 'aria-label': p.label + ' value' });
  inp.value = fmt(p.value);
  inp.addEventListener('input', () => { const v = parseNum(inp.value.replace(',', '.')); if (v !== null) { p.value = clamp(v, p.min, p.max); p.apply(p.value); } });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pmConfirm(); } if (e.key === 'Escape') { e.preventDefault(); pmCancel(); } e.stopPropagation(); });
  const cancel = h('button', { class: 'cancel' }, 'Cancel'); cancel.addEventListener('click', pmCancel);
  const ok = h('button', { class: 'ok' }, 'Done'); ok.addEventListener('click', pmConfirm);
  bar.append(h('div', { class: 'info', id: 'tfInfo' }, 'Drag left/right to adjust'), h('span', { class: 'title' }, p.label), inp);
  if (p.extra) bar.append(...p.extra());
  bar.append(h('span', { class: 'grow' }), cancel, ok);
  bar.hidden = false;
  $('#shelf').hidden = true;
}
function pmConfirm() {
  const p = PM.active; if (!p) return;
  PM.active = null; tfHideBar();
  if (p.onConfirm) p.onConfirm(p.value);
  pushUndo(p.undoLabel || p.label);
  onSelectionChanged();
}
function pmCancel() {
  const p = PM.active; if (!p) return;
  PM.active = null; tfHideBar();
  if (p.onCancel) p.onCancel();
  onSelectionChanged();
}

// ---- gizmo tools (TransformControls) ----
let GZ = null;
function gizmoSync() {
  const toolMode = { move: 'translate', rotate: 'rotate', scale: 'scale' }[S.tool];
  const show = !!toolMode && !TF.active && !PM.active && hasAnySel() && S.view !== 'uv';
  tc.enabled = show; tc.visible = show;
  if (!show) { requestRender(); return; }
  tc.setMode(toolMode);
  tc.setTranslationSnap(S.snap ? S.snapMove : null);
  tc.setRotationSnap(S.snap ? S.snapRot * DEG : null);
  tc.setScaleSnap(S.snap ? S.snapScale : null);
  if (!tc.dragging) {
    const st = tfBuildState('move');
    if (st) {
      gizmoProxy.position.copy(st.pivot);
      gizmoProxy.quaternion.copy(st.orient);
      gizmoProxy.scale.set(1, 1, 1);
      gizmoProxy.updateMatrixWorld();
    }
  }
  requestRender();
}
tc.addEventListener('mouseDown', () => {
  GZ = { st: tfBuildState({ translate: 'move', rotate: 'rotate', scale: 'scale' }[tc.mode]), p0: gizmoProxy.position.clone(), q0: gizmoProxy.quaternion.clone() };
  if (!GZ.st) GZ = null;
});
tc.addEventListener('objectChange', () => {
  if (!GZ) return;
  const T = gizmoProxy.position.clone().sub(GZ.p0);
  const R = gizmoProxy.quaternion.clone().multiply(GZ.q0.clone().invert());
  const Sv = gizmoProxy.scale.clone();
  GZ.st.orient = GZ.q0.clone();
  tfApplyState(GZ.st, { T, R, S: Sv });
});
tc.addEventListener('mouseUp', () => {
  if (!GZ) return;
  GZ = null;
  pushUndo({ translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[tc.mode]);
  onSelectionChanged();
});
tc.addEventListener('change', requestRender);

// ---- one-shot transforms (mirror, snap selection, numeric panel) ----
function instantTransform(kind, d, label) {
  const st = tfBuildState(kind);
  if (!st) { toast('Nothing selected', true); return; }
  tfApplyState(st, d);
  pushUndo(label);
  onSelectionChanged();
}
function mirrorSel(axis) {
  const Sv = new THREE.Vector3(1, 1, 1).setComponent(axis, -1);
  instantTransform('scale', { S: Sv }, 'Mirror ' + 'XYZ'[axis]);
  if (S.mode === 'edit') { const o = S.active; flipFaces(o.mesh, o.esel.faces.size ? o.esel.faces : new Set()); rebuildObject(o); UNDO.stack[UNDO.idx].snap = snapshot(); }
}
