// ============================================================================
// app_uv.js — UV editor: 2D view, selection (sticky by location), drag tools,
// unwrap / straighten / align / pack operators, UV layout export
// ============================================================================

const cuv = $('#cuv');
const uctx = cuv.getContext('2d');
const UV = { ox: 0, oy: 0, scale: 300, rot: 0, rc: 1, rs: 0, fitted: false, dirty: true, w: 0, h: 0 };
function setUVRot(r) { UV.rot = r; UV.rc = Math.cos(r); UV.rs = Math.sin(r); uvRequest(); }
// magnetic snap to 0 / 90 / 180 / 270°
function magnet90(r, tolDeg = 7) { const q = Math.PI / 2, k = Math.round(r / q); return Math.abs(r - k * q) < tolDeg * DEG ? k * q : r; }
const CK = (f, c) => f * 4096 + c;
const ckF = (k) => Math.floor(k / 4096), ckC = (k) => k % 4096;

function uvFaces() {
  const o = S.active;
  if (!o) return [];
  const m = o.mesh;
  if (S.mode === 'edit' && o.esel.faces.size) return [...o.esel.faces].filter((i) => i < m.faces.length).sort((a, b) => a - b);
  return [...m.faces.keys()];
}
function uvRequest() { UV.dirty = true; }
function u2s(u, v) { const px = u * UV.scale, py = -v * UV.scale; return [UV.ox + px * UV.rc - py * UV.rs, UV.oy + px * UV.rs + py * UV.rc]; }
function s2u(x, y) { const dx = x - UV.ox, dy = y - UV.oy; const px = dx * UV.rc + dy * UV.rs, py = -dx * UV.rs + dy * UV.rc; return [px / UV.scale, -py / UV.scale]; }
function uvFit() {
  const w = UV.w, hh = UV.h;
  const s = Math.min(w, hh) * 0.8;
  setUVRot(0); UV.scale = s; UV.ox = (w - s) / 2; UV.oy = (hh + s) / 2; UV.fitted = true; uvRequest();
}
function activeTexture() {
  const o = S.active;
  if (!o) return null;
  let slot = 0;
  if (S.mode === 'edit' && o.activeFace >= 0 && o.mesh.faces[o.activeFace]) slot = o.mesh.faces[o.activeFace].mat;
  const mat = matById(o.materials[slot] ?? o.materials[0]);
  if (!mat || !mat.texture || mat.useTexture === false) return null;
  const img = S.images.get(mat.texture);
  return img ? { img, filter: mat.filter } : null;
}
let _checker = null;
function checkerPattern() {
  if (_checker) return _checker;
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = '#2a2e37'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#323743'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
  _checker = uctx.createPattern(c, 'repeat');
  return _checker;
}
// sticky groups: corners at the same vertex and same UV location
function uvCornerMap(faces) {
  const m = S.active.mesh, map = new Map();
  for (const fi of faces) { const f = m.faces[fi]; f.v.forEach((v, c) => { if (!map.has(v)) map.set(v, []); map.get(v).push(CK(fi, c)); }); }
  return map;
}
function uvOf(k) { const f = S.active.mesh.faces[ckF(k)]; return f ? f.uv[ckC(k)] : [0, 0]; }
function stickyGroup(k, cmap) {
  const m = S.active.mesh, f = m.faces[ckF(k)], c = ckC(k);
  const v = f.v[c], u = f.uv[c];
  return (cmap.get(v) || []).filter((k2) => { const u2 = uvOf(k2); return Math.abs(u2[0] - u[0]) < 1e-5 && Math.abs(u2[1] - u[1]) < 1e-5; });
}
function uvSelValid(faces) {
  const fs = new Set(faces);
  for (const k of [...S.uvSel]) if (!fs.has(ckF(k)) || !S.active.mesh.faces[ckF(k)] || ckC(k) >= S.active.mesh.faces[ckF(k)].v.length) S.uvSel.delete(k);
}
function uvDraw() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cuv.clientWidth, hh = cuv.clientHeight;
  if (!w || !hh) return;
  if (cuv.width !== Math.round(w * dpr) || cuv.height !== Math.round(hh * dpr)) { cuv.width = Math.round(w * dpr); cuv.height = Math.round(hh * dpr); UV.dirty = true; }
  if (UV.w !== w || UV.h !== hh) { const first = !UV.w; UV.w = w; UV.h = hh; if (first || !UV.fitted) uvFit(); }
  if (!UV.dirty) return;
  UV.dirty = false;
  const x = uctx;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.fillStyle = '#1c1f25'; x.fillRect(0, 0, w, hh);
  const sc = UV.scale;
  const tex = activeTexture();
  x.save();
  x.translate(UV.ox, UV.oy); x.rotate(UV.rot);
  // in this frame UV (u, v) sits at (u * sc, -v * sc)
  if (tex) {
    x.imageSmoothingEnabled = tex.filter !== 'nearest';
    x.globalAlpha = 0.25;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (i || j) x.drawImage(tex.img.el, i * sc, -(j + 1) * sc, sc, sc);
    x.globalAlpha = 1;
    x.drawImage(tex.img.el, 0, -sc, sc, sc);
  } else { x.fillStyle = checkerPattern(); x.fillRect(0, -sc, sc, sc); }
  x.lineWidth = 1;
  x.strokeStyle = '#ffffff14';
  x.beginPath();
  for (let i = 1; i < 10; i++) { const g = (i / 10) * sc; x.moveTo(g, 0); x.lineTo(g, -sc); x.moveTo(0, -g); x.lineTo(sc, -g); }
  x.stroke();
  x.strokeStyle = '#ffffff55'; x.strokeRect(0, -sc, sc, sc);
  x.restore();
  x.fillStyle = '#9ba2b3'; x.font = '11px ui-monospace, Menlo, monospace';
  { const [ax, ay] = u2s(-0.03, -0.03), [bx, by] = u2s(1.01, -0.03), [cx2, cy2] = u2s(-0.03, 1.0); x.fillText('0', ax - 4, ay + 4); x.fillText('1', bx, by + 4); x.fillText('1', cx2 - 4, cy2 + 4); }
  if (Math.abs(UV.rot) > 1e-6) { x.fillText(`view ${Math.round(((UV.rot / DEG) % 360 + 360) % 360)}°`, 64, hh - 10); }
  const o = S.active;
  const st = $('#uvstats');
  if (!o) { st.textContent = 'No active object'; return; }
  const m = o.mesh, faces = uvFaces();
  uvSelValid(faces);
  st.textContent = `${o.name}\n${faces.length} face${faces.length === 1 ? '' : 's'}${S.mode === 'edit' && o.esel.faces.size ? ' (selected)' : ''}\n${S.uvSel.size} UV selected`;
  // faces
  let stretch = null;
  if (S.uvStretch && typeof uvStretch === 'function') { try { stretch = uvStretch(m, faces); } catch (e) { stretch = null; } }
  faces.forEach((fi, idx) => {
    const f = m.faces[fi];
    const allSel = f.v.every((_, c) => S.uvSel.has(CK(fi, c)));
    if (!stretch && !allSel) return;
    x.beginPath();
    f.uv.forEach((u, c) => { const [px, py] = u2s(u[0], u[1]); c ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.closePath();
    if (stretch) { const s = clamp(stretch[idx] || 0, 0, 1); const hue = 220 - s * 220; x.fillStyle = `hsla(${hue}, 85%, 55%, 0.55)`; x.fill(); }
    if (allSel) { x.fillStyle = '#ff9d3a40'; x.fill(); }
  });
  // edges
  x.lineWidth = 1.2;
  x.strokeStyle = '#e8eaf0d0';
  x.beginPath();
  const selEdges = [];
  for (const fi of faces) {
    const f = m.faces[fi], n = f.v.length;
    for (let c = 0; c < n; c++) {
      const a = f.uv[c], b = f.uv[(c + 1) % n];
      const [ax, ay] = u2s(a[0], a[1]), [bx, by] = u2s(b[0], b[1]);
      if (S.uvSel.has(CK(fi, c)) && S.uvSel.has(CK(fi, (c + 1) % n))) selEdges.push(ax, ay, bx, by);
      else { x.moveTo(ax, ay); x.lineTo(bx, by); }
    }
  }
  x.stroke();
  x.strokeStyle = '#ff9d3a'; x.lineWidth = 1.8;
  x.beginPath();
  for (let i = 0; i < selEdges.length; i += 4) { x.moveTo(selEdges[i], selEdges[i + 1]); x.lineTo(selEdges[i + 2], selEdges[i + 3]); }
  x.stroke();
  // vertices
  const r = 2.6;
  for (const fi of faces) {
    const f = m.faces[fi];
    f.uv.forEach((u, c) => {
      const [px, py] = u2s(u[0], u[1]);
      x.fillStyle = S.uvSel.has(CK(fi, c)) ? '#ff9d3a' : '#0b0c0f';
      x.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  if (UVD && UVD.label) { const [lx, ly] = u2s(UVD.c[0], UVD.c[1]); x.font = '600 14px -apple-system, system-ui, sans-serif'; const w2 = x.measureText(UVD.label).width + 14; x.fillStyle = '#000c'; x.fillRect(lx - w2 / 2, ly - 44, w2, 24); x.fillStyle = '#ffb35c'; x.textAlign = 'center'; x.fillText(UVD.label, lx, ly - 27); x.textAlign = 'start'; }
  if (UV.box) { x.strokeStyle = '#fff'; x.setLineDash([5, 4]); x.strokeRect(UV.box.x0, UV.box.y0, UV.box.x1 - UV.box.x0, UV.box.y1 - UV.box.y0); x.setLineDash([]); }
}

// ---------- selection ----------
function uvPick(x, y, radius) {
  const o = S.active; if (!o) return null;
  const m = o.mesh, faces = uvFaces();
  let best = null;
  for (const fi of faces) m.faces[fi].uv.forEach((u, c) => { const [px, py] = u2s(u[0], u[1]); const d = Math.hypot(px - x, py - y); if (d <= radius && (!best || d < best.d)) best = { d, k: CK(fi, c) }; });
  if (best) return { type: 'corner', k: best.k };
  // face under point
  const [u, v] = s2u(x, y);
  for (let i = faces.length - 1; i >= 0; i--) {
    const f = m.faces[faces[i]];
    let inside = false;
    for (let a = 0, b = f.uv.length - 1; a < f.uv.length; b = a++) {
      const ua = f.uv[a], ub = f.uv[b];
      if ((ua[1] > v) !== (ub[1] > v) && u < ((ub[0] - ua[0]) * (v - ua[1])) / (ub[1] - ua[1] + 1e-30) + ua[0]) inside = !inside;
    }
    if (inside) return { type: 'face', f: faces[i] };
  }
  return null;
}
function uvApplySel(keys, op) {
  if (op === 'set') S.uvSel = new Set(keys);
  else if (op === 'sub') for (const k of keys) S.uvSel.delete(k);
  else for (const k of keys) S.uvSel.add(k);
}
function uvTap(x, y, op) {
  const hit = uvPick(x, y, 24);
  const faces = uvFaces();
  const cmap = uvCornerMap(faces);
  if (!hit) { if (op === 'set') S.uvSel.clear(); }
  else if (hit.type === 'corner') {
    const grp = stickyGroup(hit.k, cmap);
    if (op === 'add' && S.uvSel.has(hit.k)) uvApplySel(grp, 'sub'); else uvApplySel(grp, op);
  } else {
    const f = S.active.mesh.faces[hit.f];
    const keys = []; for (let c = 0; c < f.v.length; c++) keys.push(...stickyGroup(CK(hit.f, c), cmap));
    const already = f.v.every((_, c) => S.uvSel.has(CK(hit.f, c)));
    if (op === 'add' && already) uvApplySel(keys, 'sub'); else uvApplySel(keys, op);
  }
  uvRequest();
}
function uvBoxSelect(b, op) {
  if (!S.active) return;
  const m = S.active.mesh, faces = uvFaces(), keys = [];
  const xa = Math.min(b.x0, b.x1), xb = Math.max(b.x0, b.x1), ya = Math.min(b.y0, b.y1), yb = Math.max(b.y0, b.y1);
  for (const fi of faces) m.faces[fi].uv.forEach((u, c) => { const [px, py] = u2s(u[0], u[1]); if (px >= xa && px <= xb && py >= ya && py <= yb) keys.push(CK(fi, c)); });
  uvApplySel(keys, op);
  uvRequest();
}
function uvSelectAll(kind) {
  const m = S.active?.mesh; if (!m) return;
  const faces = uvFaces(), all = [];
  for (const fi of faces) m.faces[fi].v.forEach((_, c) => all.push(CK(fi, c)));
  if (kind === 'all') S.uvSel = new Set(all);
  else if (kind === 'none') S.uvSel = new Set();
  else if (kind === 'invert') S.uvSel = new Set(all.filter((k) => !S.uvSel.has(k)));
  else if (kind === 'island') {
    if (typeof getUVIslands !== 'function') return;
    const isl = getUVIslands(m, faces);
    const n = new Set(S.uvSel);
    for (const fs of isl) if (fs.some((fi) => m.faces[fi].v.some((_, c) => S.uvSel.has(CK(fi, c))))) for (const fi of fs) m.faces[fi].v.forEach((_, c) => n.add(CK(fi, c)));
    S.uvSel = n;
  }
  uvRequest();
}
// faces whose corners are all selected (or every displayed face when nothing is selected)
function uvSelFaces() {
  const m = S.active.mesh, faces = uvFaces();
  const sel = faces.filter((fi) => m.faces[fi].v.every((_, c) => S.uvSel.has(CK(fi, c))));
  return sel.length ? sel : faces;
}
function uvSelCorners() {
  if (S.uvSel.size) return [...S.uvSel];
  const m = S.active.mesh, all = [];
  for (const fi of uvFaces()) m.faces[fi].v.forEach((_, c) => all.push(CK(fi, c)));
  return all;
}

// ---------- operators ----------
function uvRefresh() { if (S.active) updateGeomUVs(S.active); uvRequest(); }
function uvOp(label, fn, params = {}, schema = null) {
  if (!S.active) { toast('Select an object first', true); return; }
  if (!S.active.mesh.faces.length) { toast('This mesh has no faces to unwrap', true); return; }
  runOp(label, (p) => { const r = fn(p); uvRefresh(); return r; }, params, schema);
}
function uvSelectAllAfter() { const m = S.active.mesh; S.uvSel = new Set(); for (const fi of uvFaces()) m.faces[fi].v.forEach((_, c) => S.uvSel.add(CK(fi, c))); }
function needUVLib(name) { if (typeof window._uvlib_ok === 'undefined' && typeof unwrap !== 'function') { toast('UV tools failed to load', true); return false; } return true; }
function opUnwrap(method) {
  if (!needUVLib()) return;
  const viewMat = () => {
    const o = S.active; o.node.updateMatrixWorld();
    const M = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(o.node.matrixWorld);
    return Array.from(M.elements);
  };
  const defs = {
    conformal: ['Unwrap (Conformal)', (p) => unwrap(S.active.mesh, uvFaces(), { method: 'conformal', margin: p.margin }), { margin: 0.02 }, [{ k: 'margin', label: 'Margin', def: 0.02, min: 0, max: 0.3, step: 0.005 }]],
    min_stretch: ['Unwrap (Minimum Stretch)', (p) => unwrap(S.active.mesh, uvFaces(), { method: 'min_stretch', margin: p.margin, iterations: p.iterations }), { margin: 0.02, iterations: 10 },
      [{ k: 'iterations', label: 'Iterations', def: 10, min: 1, max: 100, int: true }, { k: 'margin', label: 'Margin', def: 0.02, min: 0, max: 0.3, step: 0.005 }]],
    smart: ['Smart UV Project', (p) => smartProject(S.active.mesh, uvFaces(), { angleLimit: p.angleLimit, margin: p.margin, areaWeight: p.areaWeight }), { angleLimit: 66, margin: 0.02, areaWeight: 0 },
      [{ k: 'angleLimit', label: 'Angle Limit (°)', def: 66, min: 1, max: 89, step: 1 }, { k: 'margin', label: 'Island Margin', def: 0.02, min: 0, max: 0.3, step: 0.005 }, { k: 'areaWeight', label: 'Area Weight', def: 0, min: 0, max: 1, step: 0.1 }]],
    lightmap: ['Lightmap Pack', (p) => lightmapPack(S.active.mesh, uvFaces(), { margin: p.margin }), { margin: 0.02 }, [{ k: 'margin', label: 'Margin', def: 0.02, min: 0, max: 0.3, step: 0.005 }]],
    follow: ['Follow Active Quads', (p) => {
      const o = S.active, fs = uvFaces();
      let act = o.activeFace >= 0 && fs.includes(o.activeFace) ? o.activeFace : fs.find((f) => o.mesh.faces[f].v.length === 4);
      if (act === undefined || followActiveQuads(o.mesh, fs, act, { mode: p.mode }) === false) { toast('Needs an active quad face', true); return false; }
    }, { mode: 'length_average' }, [{ k: 'mode', label: 'Edge Length Mode', def: 'length_average', options: [['even', 'Even'], ['length', 'Length'], ['length_average', 'Length Average']] }]],
    cube: ['Cube Projection', (p) => cubeProject(S.active.mesh, uvFaces(), { size: p.size }), { size: 2 }, [{ k: 'size', label: 'Cube Size', def: 2, min: 0.001, step: 0.1 }]],
    cylinder: ['Cylinder Projection', (p) => cylinderProject(S.active.mesh, uvFaces(), { axis: p.axis, radius: p.radius }), { axis: 'z', radius: 1 },
      [{ k: 'axis', label: 'Axis', def: 'z', options: [['x', 'X'], ['y', 'Y'], ['z', 'Z']] }, { k: 'radius', label: 'Radius', def: 1, min: 0.001, step: 0.1 }]],
    sphere: ['Sphere Projection', (p) => sphereProject(S.active.mesh, uvFaces(), { axis: p.axis }), { axis: 'z' }, [{ k: 'axis', label: 'Axis', def: 'z', options: [['x', 'X'], ['y', 'Y'], ['z', 'Z']] }]],
    view: ['Project From View', (p) => projectFromView(S.active.mesh, uvFaces(), { matrix: p.matrix, scaleToBounds: p.scaleToBounds }), { matrix: null, scaleToBounds: true }, [{ k: 'scaleToBounds', label: 'Scale to Bounds', type: 'bool' }]],
    reset: ['Reset UVs', () => resetUVs(S.active.mesh, uvFaces()), {}, null],
  };
  const d = defs[method];
  const params = { ...d[2] };
  if (method === 'view') params.matrix = viewMat();
  uvOp(d[0], (p) => { const r = d[1](p); if (r !== false) uvSelectAllAfter(); return r; }, params, d[3]);
}
function opStraighten(kind) {
  if (!S.active) return;
  const m = S.active.mesh;
  if (kind === 'grid') {
    uvOp('Straighten Grid', () => {
      const fs = uvSelFaces();
      const o = S.active;
      const act = o.activeFace >= 0 && fs.includes(o.activeFace) ? o.activeFace : fs.find((f) => m.faces[f].v.length === 4);
      if (act === undefined) { toast('Straighten Grid needs quad faces', true); return false; }
      const n = straightenGrid(m, fs, act);
      if (!n) { toast('No quad islands to straighten', true); return false; }
      toast(`Straightened ${n} island${n > 1 ? 's' : ''}`);
    });
    return;
  }
  if (kind === 'rotation') { uvOp('Align Rotation', () => alignRotation(m, uvSelFaces())); return; }
  const corners = uvSelCorners();
  // unique locations
  const groups = new Map();
  for (const k of corners) { const u = uvOf(k); const key = u[0].toFixed(6) + ',' + u[1].toFixed(6); if (!groups.has(key)) groups.set(key, { u: u.slice(), ks: [] }); groups.get(key).ks.push(k); }
  const pts = [...groups.values()];
  if (pts.length < 2) { toast('Select two or more UV points', true); return; }
  const labels = { line: 'Straighten', line_x: 'Straighten X', line_y: 'Straighten Y', align_x: 'Align X', align_y: 'Align Y', align_auto: 'Align Auto' };
  uvOp(labels[kind], () => {
    let mu = 0, mv = 0; for (const p of pts) { mu += p.u[0]; mv += p.u[1]; } mu /= pts.length; mv /= pts.length;
    let su = 0, sv = 0; for (const p of pts) { su += Math.abs(p.u[0] - mu); sv += Math.abs(p.u[1] - mv); }
    let A = null, B = null;
    if (kind.startsWith('line')) {
      // endpoints: farthest pair along principal direction
      let cxx = 0, cxy = 0, cyy = 0;
      for (const p of pts) { const dx = p.u[0] - mu, dy = p.u[1] - mv; cxx += dx * dx; cxy += dx * dy; cyy += dy * dy; }
      const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy), dx = Math.cos(ang), dy = Math.sin(ang);
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { const t = (p.u[0] - mu) * dx + (p.u[1] - mv) * dy; if (t < lo) { lo = t; A = p.u.slice(); } if (t > hi) { hi = t; B = p.u.slice(); } }
    }
    for (const p of pts) {
      let n = p.u.slice();
      if (kind === 'align_x' || (kind === 'align_auto' && su <= sv)) n[0] = mu;
      else if (kind === 'align_y' || kind === 'align_auto') n[1] = mv;
      else {
        const ex = B[0] - A[0], ey = B[1] - A[1], l2 = ex * ex + ey * ey;
        if (l2 < 1e-16) continue;
        if (kind === 'line') { const t = ((p.u[0] - A[0]) * ex + (p.u[1] - A[1]) * ey) / l2; n = [A[0] + ex * t, A[1] + ey * t]; }
        else if (kind === 'line_x') { if (Math.abs(ey) > 1e-12) n[0] = A[0] + ex * ((p.u[1] - A[1]) / ey); else n[1] = A[1]; }
        else if (kind === 'line_y') { if (Math.abs(ex) > 1e-12) n[1] = A[1] + ey * ((p.u[0] - A[0]) / ex); else n[0] = A[0]; }
      }
      for (const k of p.ks) { const f = m.faces[ckF(k)]; f.uv[ckC(k)] = [n[0], n[1]]; }
    }
  });
}
function uvCornersTransform(label, fn) {
  if (!S.active) return;
  const corners = uvSelCorners();
  const m = S.active.mesh;
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const k of corners) { const u = uvOf(k); u0 = Math.min(u0, u[0]); v0 = Math.min(v0, u[1]); u1 = Math.max(u1, u[0]); v1 = Math.max(v1, u[1]); }
  const c = [(u0 + u1) / 2, (v0 + v1) / 2], bb = { u0, v0, u1, v1 };
  uvOp(label, () => { for (const k of corners) { const f = m.faces[ckF(k)]; f.uv[ckC(k)] = fn(f.uv[ckC(k)], c, bb); } });
}
function opUVFlip(axis) { uvCornersTransform(axis === 'x' ? 'Flip Horizontally' : 'Flip Vertically', (u, c) => (axis === 'x' ? [2 * c[0] - u[0], u[1]] : [u[0], 2 * c[1] - u[1]])); }
function opUVRot90(dir) {
  if (dir === 2) { uvCornersTransform('Rotate 180°', (u, c) => [2 * c[0] - u[0], 2 * c[1] - u[1]]); return; }
  uvCornersTransform(dir > 0 ? 'Rotate 90° CCW' : 'Rotate 90° CW', (u, c) => { const dx = u[0] - c[0], dy = u[1] - c[1]; return dir > 0 ? [c[0] - dy, c[1] + dx] : [c[0] + dy, c[1] - dx]; });
}
function opUVFit() {
  uvCornersTransform('Fit to UV Square', (u, c, b) => {
    const s = Math.max(b.u1 - b.u0, b.v1 - b.v0) || 1;
    return [(u[0] - b.u0) / s, (u[1] - b.v0) / s];
  });
}
function opUVWeld() {
  if (!S.uvSel.size) { toast('Select UVs to weld', true); return; }
  uvCornersTransform('Weld', (u, c) => [c[0], c[1]]);
}
function opPack() { uvOp('Pack Islands', (p) => packIslands(S.active.mesh, uvSelFaces(), { margin: p.margin, rotate: p.rotate }), { margin: 0.02, rotate: true }, [{ k: 'margin', label: 'Margin', def: 0.02, min: 0, max: 0.3, step: 0.005 }, { k: 'rotate', label: 'Rotate', type: 'bool' }]); }
function opAvgScale() { uvOp('Average Island Scale', () => averageIslandScale(S.active.mesh, uvSelFaces())); }

// ---------- drag tools in the UV view ----------
let UVD = null;
function uvDragStart(x, y) {
  const corners = uvSelCorners();
  if (!corners.length) return false;
  const m = S.active.mesh;
  const start = corners.map((k) => uvOf(k).slice());
  let cu = 0, cv = 0; for (const u of start) { cu += u[0]; cv += u[1]; } cu /= start.length; cv /= start.length;
  UVD = { corners, start, c: [cu, cv], x0: x, y0: y, m };
  return true;
}
function uvDragMove(x, y) {
  if (!UVD) return;
  const { corners, start, c, m } = UVD;
  const [cx, cy] = u2s(c[0], c[1]);
  const tex = activeTexture();
  const px = tex ? 1 / Math.max(tex.img.width, 1) : 1 / 64;
  let fn;
  if (S.uvTool === 'move') {
    const a = s2u(UVD.x0, UVD.y0), b = s2u(x, y);
    let du = b[0] - a[0], dv = b[1] - a[1];
    if (S.snap) { du = snapTo(du, px); dv = snapTo(dv, px); }
    fn = (u) => [u[0] + du, u[1] + dv];
  } else if (S.uvTool === 'rotate') {
    let a = Math.atan2(y - cy, x - cx) - Math.atan2(UVD.y0 - cy, UVD.x0 - cx);
    a = -Math.atan2(Math.sin(a), Math.cos(a));
    if (S.snap) a = snapTo(a / DEG, S.snapRot) * DEG;
    else a = magnet90(a, 6);
    UVD.label = `${(a / DEG).toFixed(1)}°`;
    const ca = Math.cos(a), sa = Math.sin(a);
    fn = (u) => { const dx = u[0] - c[0], dy = u[1] - c[1]; return [c[0] + dx * ca - dy * sa, c[1] + dx * sa + dy * ca]; };
  } else {
    const d0 = Math.hypot(UVD.x0 - cx, UVD.y0 - cy) || 1;
    let f = Math.hypot(x - cx, y - cy) / d0;
    if (S.snap) f = snapTo(f, S.snapScale);
    UVD.label = `×${f.toFixed(2)}`;
    fn = (u) => [c[0] + (u[0] - c[0]) * f, c[1] + (u[1] - c[1]) * f];
  }
  corners.forEach((k, i) => { const f = m.faces[ckF(k)]; f.uv[ckC(k)] = fn(start[i]); });
  uvRefresh();
}
function uvDragEnd() {
  if (!UVD) return;
  UVD = null;
  pushUndo('UV ' + { move: 'Move', rotate: 'Rotate', scale: 'Scale' }[S.uvTool]);
}
function uvDragCancel() {
  if (!UVD) return;
  const {corners, start, m} = UVD;
  corners.forEach((k, i) => { m.faces[ckF(k)].uv[ckC(k)] = start[i]; });
  UVD = null;
  uvRefresh();
}

// ---------- UV layout image ----------
function uvLayoutCanvas(size = 1024) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const m = S.active.mesh, faces = uvFaces();
  x.lineJoin = 'round';
  for (const fi of faces) {
    const f = m.faces[fi];
    x.beginPath();
    f.uv.forEach((u, i) => { const px = u[0] * size, py = (1 - u[1]) * size; i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.closePath();
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.fill();
    x.strokeStyle = '#ffffff'; x.lineWidth = Math.max(1, size / 512); x.stroke();
  }
  return c;
}
