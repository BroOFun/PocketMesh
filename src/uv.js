// PocketMesh — uv.js: UV unwrapping, projection and packing algorithms.
// Pure and dependency-free. Public API = `export function`s below; private helpers are
// prefixed `_uv` because all src modules are concatenated into one scope.
// All functions mutate `face.uv` in place for the given faces only.

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Solver settings: sparse Cholesky when the factor stays below maxNnz entries, otherwise
// Jacobi-preconditioned CG (warm-started) with these caps.
const _uvCfg = { direct: true, maxNnz: 4e6, lscmIter: 1500, lscmTol: 1e-7, arapIter: 200, arapTol: 1e-6 };

function _uvFin(x) { return Number.isFinite(x) ? x : 0; }

// Valid, de-duplicated face indices; makes sure each face has a well-formed uv array.
function _uvSel(mesh, faceIdxs) {
  const out = [];
  if (!mesh || !mesh.faces || !faceIdxs) return out;
  const faces = mesh.faces, seen = new Uint8Array(faces.length);
  for (const f of faceIdxs) {
    if (!Number.isInteger(f) || f < 0 || f >= faces.length || seen[f]) continue;
    const face = faces[f];
    if (!face || !face.v || face.v.length < 3) continue;
    seen[f] = 1;
    _uvEnsure(face);
    out.push(f);
  }
  return out;
}

function _uvEnsure(face) {
  const n = face.v.length;
  if (!Array.isArray(face.uv)) face.uv = [];
  const uv = face.uv;
  if (uv.length > n) uv.length = n;
  for (let i = 0; i < n; i++) {
    const t = uv[i];
    if (!t || !(t.length >= 2) || !Number.isFinite(t[0]) || !Number.isFinite(t[1])) uv[i] = [0, 0];
  }
  return uv;
}

function _uvSet(face, i, u, v) { face.uv[i] = [_uvFin(u), _uvFin(v)]; }

// Newell normal (length = 2 * polygon area) into out[0..2].
function _uvNewell(P, vs, out) {
  let nx = 0, ny = 0, nz = 0;
  const n = vs.length;
  for (let i = 0; i < n; i++) {
    const a = P[vs[i]], b = P[vs[(i + 1) % n]];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  out[0] = nx; out[1] = ny; out[2] = nz;
  return out;
}

// Orthonormal tangent frame (t, b) for normal n so that t x b = n (projection keeps CCW).
function _uvBasis(nx, ny, nz, out) {
  let l = Math.hypot(nx, ny, nz);
  if (!(l > 1e-30)) { nx = 0; ny = 0; nz = 1; l = 1; }
  nx /= l; ny /= l; nz /= l;
  // pick the world axis least aligned with n, t = normalize(axis x n) ... then b = n x t
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  let tx, ty, tz;
  if (az >= ax && az >= ay) { tx = 1; ty = 0; tz = 0; }        // mostly Z normal: t ~ +X
  else if (ax >= ay) { tx = 0; ty = 1; tz = 0; }                // mostly X normal: t ~ +Y
  else { tx = -1; ty = 0; tz = 0; }                             // mostly Y normal: t ~ -X
  // Gram-Schmidt
  const d = tx * nx + ty * ny + tz * nz;
  tx -= d * nx; ty -= d * ny; tz -= d * nz;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  out[0] = tx; out[1] = ty; out[2] = tz;
  out[3] = ny * tz - nz * ty; out[4] = nz * tx - nx * tz; out[5] = nx * ty - ny * tx;
  out[6] = nx; out[7] = ny; out[8] = nz;
  return out;
}

// Union-find with path halving.
function _uvFind(p, x) {
  while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; }
  return x;
}
function _uvUnion(p, a, b) {
  a = _uvFind(p, a); b = _uvFind(p, b);
  if (a !== b) { if (a < b) p[b] = a; else p[a] = b; }
}

// ---------------------------------------------------------------------------
// Triangulation (ear clipping on the Newell-plane projection)
// ---------------------------------------------------------------------------

// Keep n-gon UV solving consistent with the model and exported triangles.
function _uvTriangulate(P, vs, out) {
  for (const tri of triangulatePolygon(vs.map(v => P[v]))) out.push(...tri);
}

// ---------------------------------------------------------------------------
// Corner / edge topology of a face selection
// ---------------------------------------------------------------------------
// Corners are numbered globally: corner c of local face k = cStart[k] + i.
// Edge e (one per undirected mesh edge used by the selection) remembers its first two corners.

function _uvSeamTest(mesh) {
  const s = mesh.seams;
  if (!s) return null;
  if (s instanceof Set) return s.size ? s : null;
  if (Array.isArray(s)) return s.length ? new Set(s.map(String)) : null;
  return null;
}

function _uvTopo(mesh, fids) {
  const nf = fids.length, faces = mesh.faces;
  const cStart = new Int32Array(nf + 1);
  for (let k = 0; k < nf; k++) cStart[k + 1] = cStart[k] + faces[fids[k]].v.length;
  const nc = cStart[nf];
  const cVert = new Int32Array(nc), cFace = new Int32Array(nc), cNext = new Int32Array(nc), cEdge = new Int32Array(nc);
  for (let k = 0; k < nf; k++) {
    const vs = faces[fids[k]].v, s = cStart[k], m = vs.length;
    for (let i = 0; i < m; i++) { cVert[s + i] = vs[i]; cFace[s + i] = k; cNext[s + i] = s + ((i + 1) % m); }
  }
  // open-addressing hash on (lo, hi)
  let cap = 16;
  while (cap < nc * 2) cap <<= 1;
  const mask = cap - 1, hLo = new Int32Array(cap).fill(-1), hHi = new Int32Array(cap), hE = new Int32Array(cap);
  const eC1 = new Int32Array(nc), eC2 = new Int32Array(nc).fill(-1), eN = new Int32Array(nc);
  let ne = 0;
  for (let c = 0; c < nc; c++) {
    const a = cVert[c], b = cVert[cNext[c]];
    const lo = a < b ? a : b, hi = a < b ? b : a;
    let h = (Math.imul(lo, 73856093) ^ Math.imul(hi, 19349663)) & mask;
    while (hLo[h] !== -1 && (hLo[h] !== lo || hHi[h] !== hi)) h = (h + 1) & mask;
    let e;
    if (hLo[h] === -1) { hLo[h] = lo; hHi[h] = hi; e = hE[h] = ne++; eC1[e] = c; eN[e] = 1; }
    else { e = hE[h]; if (eN[e] === 1) eC2[e] = c; eN[e]++; }
    cEdge[c] = e;
  }
  const eSeam = new Uint8Array(ne);
  const seams = _uvSeamTest(mesh);
  if (seams) {
    for (let e = 0; e < ne; e++) {
      const c = eC1[e], a = cVert[c], b = cVert[cNext[c]];
      if (seams.has(a < b ? a + '_' + b : b + '_' + a)) eSeam[e] = 1;
    }
  }
  return { nf, nc, ne, fids, cStart, cVert, cFace, cNext, cEdge, eC1, eC2, eN, eSeam };
}

// Manifold edge shared by two different selected faces.
function _uvEdgeShared(T, e) {
  return T.eN[e] === 2 && T.cFace[T.eC1[e]] !== T.cFace[T.eC2[e]];
}

// For shared edge e: matching corner pairs. Returns [p1, q1, p2, q2] where corner p1 (face 1)
// and q1 (face 2) are the same mesh vertex, likewise p2 / q2.
function _uvEdgeCorners(T, e, out) {
  const c1 = T.eC1[e], c2 = T.eC2[e], n1 = T.cNext[c1], n2 = T.cNext[c2];
  out[0] = c1; out[2] = n1;
  if (T.cVert[c2] === T.cVert[c1]) { out[1] = c2; out[3] = n2; } else { out[1] = n2; out[3] = c2; }
  return out;
}

// Face-corner uv accessors via corner index.
function _uvCornerUV(mesh, T, c) {
  const k = T.cFace[c];
  return mesh.faces[T.fids[k]].uv[c - T.cStart[k]];
}

function _uvSameUV(a, b) { return Math.abs(a[0] - b[0]) <= 1e-5 && Math.abs(a[1] - b[1]) <= 1e-5; }

// Islands (arrays of local face indices) from union-find over faces where `joinFn(e)` is true.
function _uvGroupFaces(T, joinFn) {
  const p = new Int32Array(T.nf);
  for (let i = 0; i < T.nf; i++) p[i] = i;
  for (let e = 0; e < T.ne; e++) if (_uvEdgeShared(T, e) && joinFn(e)) _uvUnion(p, T.cFace[T.eC1[e]], T.cFace[T.eC2[e]]);
  const slot = new Int32Array(T.nf).fill(-1), out = [];
  for (let k = 0; k < T.nf; k++) {
    const r = _uvFind(p, k);
    if (slot[r] < 0) { slot[r] = out.length; out.push([]); }
    out[slot[r]].push(k);
  }
  return out;
}

// UV-welded islands: arrays of local face indices.
function _uvUVIslandsLocal(mesh, T) {
  const pr = [0, 0, 0, 0];
  return _uvGroupFaces(T, e => {
    _uvEdgeCorners(T, e, pr);
    return _uvSameUV(_uvCornerUV(mesh, T, pr[0]), _uvCornerUV(mesh, T, pr[1])) &&
      _uvSameUV(_uvCornerUV(mesh, T, pr[2]), _uvCornerUV(mesh, T, pr[3]));
  });
}

export function getUVIslands(mesh, faceIdxs) {
  const fids = _uvSel(mesh, faceIdxs);
  if (!fids.length) return [];
  const T = _uvTopo(mesh, fids);
  return _uvUVIslandsLocal(mesh, T).map(isl => isl.map(k => fids[k]));
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

function _uvArea3(P, vs) {
  const n = _uvNewell(P, vs, [0, 0, 0]);
  return 0.5 * Math.hypot(n[0], n[1], n[2]);
}

// Signed UV area (positive = counter-clockwise).
function _uvAreaUV(uv) {
  let a = 0;
  const n = uv.length;
  for (let i = 0; i < n; i++) { const p = uv[i], q = uv[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return 0.5 * a;
}

export function uvStretch(mesh, faceIdxs) {
  const list = faceIdxs || [];
  const out = new Float32Array(list.length);
  const faces = mesh && mesh.faces ? mesh.faces : [];
  const a3 = new Float64Array(list.length), au = new Float64Array(list.length);
  let t3 = 0, tu = 0;
  for (let i = 0; i < list.length; i++) {
    const f = faces[list[i]];
    if (!f || !f.v || f.v.length < 3) { a3[i] = -1; continue; }
    a3[i] = _uvArea3(mesh.verts, f.v);
    const uv = Array.isArray(f.uv) && f.uv.length === f.v.length && f.uv.every(t => t && Number.isFinite(t[0]) && Number.isFinite(t[1])) ? f.uv : null;
    au[i] = uv ? Math.abs(_uvAreaUV(uv)) : 0;
    t3 += a3[i]; tu += au[i];
  }
  for (let i = 0; i < list.length; i++) {
    if (a3[i] < 0) { out[i] = 0; continue; }
    if (!(a3[i] > 1e-20) || !(au[i] > 1e-20) || !(t3 > 0) || !(tu > 0)) { out[i] = 1; continue; }
    const r = (au[i] / tu) / (a3[i] / t3);
    const s = r >= 1 ? 1 - 1 / r : 1 - r;
    out[i] = Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Simple projections
// ---------------------------------------------------------------------------

export function resetUVs(mesh, faceIdxs) {
  for (const fi of _uvSel(mesh, faceIdxs)) {
    const face = mesh.faces[fi], n = face.v.length;
    if (n === 4) {
      _uvSet(face, 0, 0, 0); _uvSet(face, 1, 1, 0); _uvSet(face, 2, 1, 1); _uvSet(face, 3, 0, 1);
      continue;
    }
    // regular polygon with a horizontal bottom edge, stretched to fill the unit square
    const xs = [], ys = [];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 - Math.PI / n + (2 * Math.PI * i) / n;
      const x = Math.cos(a), y = Math.sin(a);
      xs.push(x); ys.push(y);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const sx = x1 - x0 > 1e-12 ? 1 / (x1 - x0) : 1, sy = y1 - y0 > 1e-12 ? 1 / (y1 - y0) : 1;
    for (let i = 0; i < n; i++) _uvSet(face, i, (xs[i] - x0) * sx, (ys[i] - y0) * sy);
  }
}

export function cubeProject(mesh, faceIdxs, { size = 2 } = {}) {
  const s = Number.isFinite(size) && Math.abs(size) > 1e-12 ? size : 2;
  const P = mesh.verts, nn = [0, 0, 0];
  for (const fi of _uvSel(mesh, faceIdxs)) {
    const face = mesh.faces[fi];
    _uvNewell(P, face.v, nn);
    const ax = Math.abs(nn[0]), ay = Math.abs(nn[1]), az = Math.abs(nn[2]);
    // U x V == dominant normal direction, so projected faces are never mirrored
    let U, V;
    if (az >= ax && az >= ay) { U = [1, 0, 0]; V = nn[2] >= 0 ? [0, 1, 0] : [0, -1, 0]; }
    else if (ax >= ay) { U = nn[0] >= 0 ? [0, 1, 0] : [0, -1, 0]; V = [0, 0, 1]; }
    else { U = nn[1] >= 0 ? [-1, 0, 0] : [1, 0, 0]; V = [0, 0, 1]; }
    face.v.forEach((vi, i) => {
      const p = P[vi];
      _uvSet(face, i, (p[0] * U[0] + p[1] * U[1] + p[2] * U[2]) / s + 0.5,
        (p[0] * V[0] + p[1] * V[1] + p[2] * V[2]) / s + 0.5);
    });
  }
}

function _uvAxisIdx(axis) {
  const a = String(axis || 'z').toLowerCase();
  return a === 'x' ? [1, 2, 0] : a === 'y' ? [2, 0, 1] : [0, 1, 2];
}

// Shared by cylinder/sphere projection: u = angle around the axis (CCW, so outward faces are
// not mirrored), per-face wrap fix (u made continuous, may extend past 1), poles get the
// average u of the face's other corners.
function _uvWrapProject(mesh, faceIdxs, axis, vOf) {
  const [ia, ib, ih] = _uvAxisIdx(axis), P = mesh.verts, TAU = 2 * Math.PI;
  for (const fi of _uvSel(mesh, faceIdxs)) {
    const face = mesh.faces[fi], n = face.v.length;
    const us = new Float64Array(n), vs = new Float64Array(n), pole = new Uint8Array(n);
    let prev = NaN, sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const p = P[face.v[i]], a = p[ia], b = p[ib], h = p[ih];
      const rho = Math.hypot(a, b);
      vs[i] = vOf(rho, h);
      if (!(rho > 1e-9 + 1e-7 * Math.abs(h))) { pole[i] = 1; continue; }
      let u = Math.atan2(b, a) / TAU;
      if (u < 0) u += 1;
      if (prev === prev) { while (u - prev > 0.5) u -= 1; while (u - prev < -0.5) u += 1; }
      us[i] = prev = u; sum += u; cnt++;
    }
    let shift = 0, avg = 0.5;
    if (cnt) { avg = sum / cnt; shift = -Math.floor(avg); avg += shift; }
    for (let i = 0; i < n; i++) _uvSet(face, i, pole[i] ? avg : us[i] + shift, vs[i]);
  }
}

export function cylinderProject(mesh, faceIdxs, { axis = 'z', radius = 1 } = {}) {
  const r = Number.isFinite(radius) && Math.abs(radius) > 1e-12 ? Math.abs(radius) : 1;
  _uvWrapProject(mesh, faceIdxs, axis, (rho, h) => (h / r + 1) / 2);
}

export function sphereProject(mesh, faceIdxs, { axis = 'z' } = {}) {
  _uvWrapProject(mesh, faceIdxs, axis, (rho, h) => {
    const len = Math.hypot(rho, h);
    if (!(len > 1e-20)) return 0.5;
    return 0.5 + Math.asin(Math.max(-1, Math.min(1, h / len))) / Math.PI;
  });
}

export function projectFromView(mesh, faceIdxs, { matrix, scaleToBounds = true } = {}) {
  const m = matrix && matrix.length >= 16 ? Array.from(matrix, _uvFin) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const P = mesh.verts, fids = _uvSel(mesh, faceIdxs);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const fi of fids) {
    const face = mesh.faces[fi];
    face.v.forEach((vi, i) => {
      const p = P[vi], x = p[0], y = p[1], z = p[2];
      let w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (Math.abs(w) < 1e-12) w = w < 0 ? -1e-12 : 1e-12;
      const u = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w) * 0.5 + 0.5;
      const v = ((m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 + 0.5;
      _uvSet(face, i, u, v);
      const t = face.uv[i];
      if (t[0] < u0) u0 = t[0]; if (t[0] > u1) u1 = t[0]; if (t[1] < v0) v0 = t[1]; if (t[1] > v1) v1 = t[1];
    });
  }
  if (!scaleToBounds || !fids.length) return;
  const du = u1 - u0, dv = v1 - v0, sz = Math.max(du, dv);
  const s = sz > 1e-12 ? 1 / sz : 0;
  const ou = (1 - du * s) / 2, ov = (1 - dv * s) / 2;
  for (const fi of fids) {
    const face = mesh.faces[fi];
    for (let i = 0; i < face.uv.length; i++) {
      const t = face.uv[i];
      _uvSet(face, i, s ? (t[0] - u0) * s + ou : 0.5, s ? (t[1] - v0) * s + ov : 0.5);
    }
  }
}

// ---------------------------------------------------------------------------
// Sparse symmetric matrices (CSR over vertices with 2x2 blocks [[a, b], [-b, a]]) + PCG
// ---------------------------------------------------------------------------

// CSR sparsity pattern of the vertex adjacency of triangle list `tris` (diagonal included).
function _uvPattern(n, tris) {
  const nt = tris.length / 3;
  const cnt = new Int32Array(n + 1);
  for (let t = 0; t < nt; t++) { cnt[tris[3 * t]] += 2; cnt[tris[3 * t + 1]] += 2; cnt[tris[3 * t + 2]] += 2; }
  const off = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) off[i + 1] = off[i] + cnt[i] + 1;
  const tmp = new Int32Array(off[n]), fill = new Int32Array(n);
  for (let i = 0; i < n; i++) { tmp[off[i]] = i; fill[i] = 1; }
  for (let t = 0; t < nt; t++) {
    const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2];
    tmp[off[a] + fill[a]++] = b; tmp[off[a] + fill[a]++] = c;
    tmp[off[b] + fill[b]++] = a; tmp[off[b] + fill[b]++] = c;
    tmp[off[c] + fill[c]++] = a; tmp[off[c] + fill[c]++] = b;
  }
  const rowPtr = new Int32Array(n + 1), diag = new Int32Array(n);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const s = off[i], e = off[i] + fill[i];
    // insertion sort the (small) row
    for (let k = s + 1; k < e; k++) {
      const x = tmp[k]; let m = k - 1;
      while (m >= s && tmp[m] > x) { tmp[m + 1] = tmp[m]; m--; }
      tmp[m + 1] = x;
    }
    rowPtr[i] = w;
    for (let k = s; k < e; k++) if (k === s || tmp[k] !== tmp[k - 1]) { if (tmp[k] === i) diag[i] = w; tmp[w++] = tmp[k]; }
  }
  rowPtr[n] = w;
  return { n, rowPtr, col: tmp.slice(0, w), diag };
}

function _uvPos(S, i, j) {
  let lo = S.rowPtr[i], hi = S.rowPtr[i + 1] - 1;
  const col = S.col;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, c = col[m];
    if (c === j) return m;
    if (c < j) lo = m + 1; else hi = m - 1;
  }
  return -1;
}

// y = M x for the block matrix (A = symmetric part, B = antisymmetric coupling, may be null).
function _uvMatVec(S, A, B, xu, xv, yu, yv, pinned) {
  const rp = S.rowPtr, col = S.col, n = S.n;
  for (let i = 0; i < n; i++) {
    if (pinned[i]) { yu[i] = 0; yv[i] = 0; continue; }
    let su = 0, sv = 0;
    const e = rp[i + 1];
    if (B) {
      for (let p = rp[i]; p < e; p++) {
        const j = col[p], a = A[p], b = B[p], u = xu[j], v = xv[j];
        su += a * u + b * v; sv += a * v - b * u;
      }
    } else {
      for (let p = rp[i]; p < e; p++) { const j = col[p], a = A[p]; su += a * xu[j]; sv += a * xv[j]; }
    }
    yu[i] = su; yv[i] = sv;
  }
}

// Jacobi-preconditioned CG on M x = b with pinned vertices held at their current values.
// x (xu, xv) is the warm start and receives the solution. Returns iterations used.
function _uvPCG(S, A, B, bu, bv, xu, xv, pinned, maxIter, relTol) {
  const n = S.n;
  const ru = new Float64Array(n), rv = new Float64Array(n), zu = new Float64Array(n), zv = new Float64Array(n);
  const pu = new Float64Array(n), pv = new Float64Array(n), qu = new Float64Array(n), qv = new Float64Array(n);
  const dinv = new Float64Array(n);
  for (let i = 0; i < n; i++) { const d = A[S.diag[i]]; dinv[i] = pinned[i] || !(d > 0) ? 0 : 1 / d; }
  // r = b - M x (pinned rows zero)
  const xpu = new Float64Array(n), xpv = new Float64Array(n);
  for (let i = 0; i < n; i++) { xpu[i] = xu[i]; xpv[i] = xv[i]; }
  _uvMatVec(S, A, B, xpu, xpv, qu, qv, pinned);
  let rz = 0, bn = 0;
  for (let i = 0; i < n; i++) {
    if (pinned[i]) { ru[i] = rv[i] = 0; continue; }
    ru[i] = (bu ? bu[i] : 0) - qu[i]; rv[i] = (bv ? bv[i] : 0) - qv[i];
    zu[i] = ru[i] * dinv[i]; zv[i] = rv[i] * dinv[i];
    pu[i] = zu[i]; pv[i] = zv[i];
    rz += ru[i] * zu[i] + rv[i] * zv[i];
    bn += ru[i] * ru[i] + rv[i] * rv[i];
  }
  const stop = bn * relTol * relTol;
  let it = 0;
  if (!(bn > 1e-300)) return 0;
  for (; it < maxIter; it++) {
    _uvMatVec(S, A, B, pu, pv, qu, qv, pinned);
    let pq = 0;
    for (let i = 0; i < n; i++) pq += pu[i] * qu[i] + pv[i] * qv[i];
    if (!(pq > 0)) break;
    const al = rz / pq;
    let rr = 0, rzn = 0;
    for (let i = 0; i < n; i++) {
      xu[i] += al * pu[i]; xv[i] += al * pv[i];
      const a = ru[i] - al * qu[i], b = rv[i] - al * qv[i];
      ru[i] = a; rv[i] = b;
      rr += a * a + b * b;
      const za = a * dinv[i], zb = b * dinv[i];
      zu[i] = za; zv[i] = zb;
      rzn += a * za + b * zb;
    }
    if (rr <= stop) { it++; break; }
    const be = rzn / rz;
    rz = rzn;
    if (!(rz > 0)) { it++; break; }
    for (let i = 0; i < n; i++) { pu[i] = zu[i] + be * pu[i]; pv[i] = zv[i] + be * pv[i]; }
  }
  for (let i = 0; i < n; i++) if (!Number.isFinite(xu[i]) || !Number.isFinite(xv[i])) { xu[i] = xpu[i]; xv[i] = xpv[i]; }
  return it;
}

// ---- sparse direct solver: nested dissection + up-looking complex Cholesky (L L^H) ----
// The 2x2-block matrix [[a, b], [-b, a]] is the complex Hermitian matrix c = a - i b acting on
// z = u + i v. Pinned vertices are eliminated. Returns null if the factor would be too large.

function _uvNDOrder(S, inv, X, Y, Z) {
  const n = S.n, rp = S.rowPtr, col = S.col, side = new Uint8Array(n);
  const ids0 = [];
  for (let i = 0; i < n; i++) if (inv[i] >= 0) ids0.push(i);
  const out = new Int32Array(ids0.length);
  let w = 0;
  const rec = (ids, depth) => {
    if (ids.length <= 48 || depth > 60) { for (let k = 0; k < ids.length; k++) out[w++] = ids[k]; return; }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < ids.length; k++) {
      const v = ids[k];
      if (X[v] < x0) x0 = X[v]; if (X[v] > x1) x1 = X[v];
      if (Y[v] < y0) y0 = Y[v]; if (Y[v] > y1) y1 = Y[v];
      if (Z[v] < z0) z0 = Z[v]; if (Z[v] > z1) z1 = Z[v];
    }
    const C = x1 - x0 >= y1 - y0 && x1 - x0 >= z1 - z0 ? X : y1 - y0 >= z1 - z0 ? Y : Z;
    const keys = new Float64Array(ids.length);
    for (let k = 0; k < ids.length; k++) keys[k] = C[ids[k]];
    keys.sort();
    const med = keys[ids.length >> 1];
    let L = [], R = [];
    for (let k = 0; k < ids.length; k++) (C[ids[k]] < med ? L : R).push(ids[k]);
    if (!L.length || !R.length) { const h = ids.length >> 1; L = ids.slice(0, h); R = ids.slice(h); }
    for (const v of L) side[v] = 1;
    const sep = [], RR = [];
    for (const v of R) {
      let s = false;
      for (let p = rp[v]; p < rp[v + 1]; p++) if (side[col[p]] === 1) { s = true; break; }
      (s ? sep : RR).push(v);
    }
    for (const v of L) side[v] = 0;
    rec(L, depth + 1); rec(RR, depth + 1);
    for (const v of sep) out[w++] = v;
  };
  rec(ids0, 0);
  return out;
}

function _uvCholesky(S, A, B, pinned, X, Y, Z, maxNnz) {
  const n0 = S.n, rp = S.rowPtr, col = S.col, inv = new Int32Array(n0).fill(-1);
  let n = 0;
  for (let i = 0; i < n0; i++) if (!pinned[i]) inv[i] = n++;
  if (!n) return null;
  const perm = _uvNDOrder(S, inv, X, Y, Z);
  for (let k = 0; k < n; k++) inv[perm[k]] = k;
  // upper triangle of the permuted matrix, column storage
  const Ap = new Int32Array(n + 1);
  for (let k = 0; k < n; k++) {
    const o = perm[k];
    let c = 0;
    for (let p = rp[o]; p < rp[o + 1]; p++) { const j = inv[col[p]]; if (j >= 0 && j <= k) c++; }
    Ap[k + 1] = Ap[k] + c;
  }
  const Ai = new Int32Array(Ap[n]), Ar = new Float64Array(Ap[n]), Am = new Float64Array(Ap[n]);
  for (let k = 0, w = 0; k < n; k++) {
    const o = perm[k];
    for (let p = rp[o]; p < rp[o + 1]; p++) {
      const j = inv[col[p]];
      if (j >= 0 && j <= k) { Ai[w] = j; Ar[w] = A[p]; Am[w] = B ? B[p] : 0; w++; }
    }
  }
  // elimination tree
  const parent = new Int32Array(n).fill(-1), anc = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) {
    for (let p = Ap[k]; p < Ap[k + 1]; p++) {
      let i = Ai[p];
      while (i !== -1 && i < k) { const nx = anc[i]; anc[i] = k; if (nx === -1) parent[i] = k; i = nx; }
    }
  }
  const s = new Int32Array(n), mark = new Int32Array(n).fill(-1);
  const ereach = k => {
    let top = n;
    mark[k] = k;
    for (let p = Ap[k]; p < Ap[k + 1]; p++) {
      let i = Ai[p];
      if (i > k) continue;
      let len = 0;
      for (; mark[i] !== k; i = parent[i]) { s[len++] = i; mark[i] = k; }
      while (len > 0) s[--top] = s[--len];
    }
    return top;
  };
  // symbolic: column counts
  const Lp = new Int32Array(n + 1), cnt = new Int32Array(n);
  for (let k = 0; k < n; k++) { const top = ereach(k); for (let t = top; t < n; t++) cnt[s[t]]++; cnt[k]++; }
  for (let k = 0; k < n; k++) Lp[k + 1] = Lp[k] + cnt[k];
  if (Lp[n] > maxNnz) return null;
  const Li = new Int32Array(Lp[n]), Lr = new Float64Array(Lp[n]), Lm = new Float64Array(Lp[n]), c = Lp.slice(0, n);
  const xr = new Float64Array(n), xi = new Float64Array(n);
  mark.fill(-1);
  for (let k = 0; k < n; k++) {
    const top = ereach(k);
    for (let p = Ap[k]; p < Ap[k + 1]; p++) { const i = Ai[p]; if (i <= k) { xr[i] = Ar[p]; xi[i] = Am[p]; } }
    let d = xr[k];
    const dk = Math.abs(d);
    xr[k] = xi[k] = 0;
    for (let t = top; t < n; t++) {
      const i = s[t], di = Lr[Lp[i]];
      const yr = xr[i] / di, yi = xi[i] / di;
      xr[i] = xi[i] = 0;
      const e = c[i];
      for (let p = Lp[i] + 1; p < e; p++) {
        const j = Li[p], lr = Lr[p], li = Lm[p];
        xr[j] -= lr * yr - li * yi; xi[j] -= lr * yi + li * yr;
      }
      d -= yr * yr + yi * yi;
      const q = c[i]++;
      Li[q] = k; Lr[q] = yr; Lm[q] = -yi;
    }
    if (!(d > 1e-13 * dk) || !Number.isFinite(d)) d = 1e-13 * dk + 1e-300;
    const q = c[k]++;
    Li[q] = k; Lr[q] = Math.sqrt(d); Lm[q] = 0;
  }
  return { n, n0, perm, inv, Lp, Li, Lr, Lm, S, A, B, pinned };
}

// Solve with pinned vertices held at their current xu/xv values; b may be null (zero).
function _uvCholSolve(F, bu, bv, xu, xv) {
  const { n, perm, Lp, Li, Lr, Lm, S, A, B, pinned } = F, rp = S.rowPtr, col = S.col;
  const zr = new Float64Array(n), zi = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const o = perm[k];
    let r = bu ? bu[o] : 0, m = bv ? bv[o] : 0;
    for (let p = rp[o]; p < rp[o + 1]; p++) {
      const j = col[p];
      if (!pinned[j]) continue;
      const a = A[p], b = B ? B[p] : 0, u = xu[j], v = xv[j];
      r -= a * u + b * v; m -= a * v - b * u;
    }
    zr[k] = r; zi[k] = m;
  }
  for (let i = 0; i < n; i++) {           // L w = b
    const d = Lr[Lp[i]], wr = zr[i] / d, wi = zi[i] / d;
    zr[i] = wr; zi[i] = wi;
    for (let p = Lp[i] + 1; p < Lp[i + 1]; p++) {
      const j = Li[p], lr = Lr[p], li = Lm[p];
      zr[j] -= lr * wr - li * wi; zi[j] -= lr * wi + li * wr;
    }
  }
  for (let i = n - 1; i >= 0; i--) {      // L^H z = w
    let r = zr[i], m = zi[i];
    for (let p = Lp[i] + 1; p < Lp[i + 1]; p++) {
      const j = Li[p], lr = Lr[p], li = Lm[p];
      r -= lr * zr[j] + li * zi[j]; m -= lr * zi[j] - li * zr[j];
    }
    const d = Lr[Lp[i]];
    zr[i] = r / d; zi[i] = m / d;
  }
  for (let k = 0; k < n; k++) {
    const o = perm[k];
    if (Number.isFinite(zr[k]) && Number.isFinite(zi[k])) { xu[o] = zr[k]; xv[o] = zi[k]; }
  }
}

// Symmetric 3x3 eigen-decomposition (Jacobi). m = [a00,a01,a02,a11,a12,a22].
// Returns { val: [l0,l1,l2] descending, vec: [[x,y,z] x3] }.
function _uvEig3(m) {
  const a = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (!(off > 1e-30)) break;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return { val: idx.map(i => a[i][i]), vec: idx.map(i => [v[0][i], v[1][i], v[2][i]]) };
}

// ---------------------------------------------------------------------------
// LSCM + ARAP on one island (vertices X/Y/Z, triangles in face winding order)
// ---------------------------------------------------------------------------

// Per triangle: area A[t] (0 = degenerate, ignored) and the gradients of its barycentric
// functions in the triangle's own CCW 2D frame: G[6t..6t+5] = gx0, gy0, gx1, gy1, gx2, gy2.
function _uvTriGrads(X, Y, Z, tris) {
  const nt = tris.length / 3, A = new Float64Array(nt), G = new Float64Array(6 * nt);
  for (let t = 0; t < nt; t++) {
    const i0 = tris[3 * t], i1 = tris[3 * t + 1], i2 = tris[3 * t + 2];
    const ax = X[i1] - X[i0], ay = Y[i1] - Y[i0], az = Z[i1] - Z[i0];
    const bx = X[i2] - X[i0], by = Y[i2] - Y[i0], bz = Z[i2] - Z[i0];
    const l01 = ax * ax + ay * ay + az * az, l02 = bx * bx + by * by + bz * bz;
    const l12 = (bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2;
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const c = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (!(c > 1e-6 * (l01 + l02 + l12)) || !(l01 > 0)) continue;
    const x1 = Math.sqrt(l01), x2 = (ax * bx + ay * by + az * bz) / x1, y2 = c / x1;
    const inv = 1 / c; // 1 / (2 * area)
    A[t] = 0.5 * c;
    const o = 6 * t;
    G[o] = -y2 * inv; G[o + 1] = (x2 - x1) * inv;
    G[o + 2] = y2 * inv; G[o + 3] = -x2 * inv;
    G[o + 4] = 0; G[o + 5] = x1 * inv;
  }
  return { A, G };
}

// Assemble sum_t A_t * (g_a . g_b) (cotangent Laplacian) and, if wantB, the LSCM coupling
// sum_t A_t * (gy_a gx_b - gx_a gy_b). Degenerate triangles get weak uniform springs instead,
// so vertices that only touch degenerate triangles follow their neighbours (no singular rows)
// while well-shaped meshes are not biased at all.
function _uvAssemble(S, tris, TG, wantB) {
  const nnz = S.col.length, Aa = new Float64Array(nnz), Ab = wantB ? new Float64Array(nnz) : null;
  const { A, G } = TG, nt = tris.length / 3;
  for (let t = 0; t < nt; t++) {
    const ar = A[t];
    if (!(ar > 0)) continue;
    const o = 6 * t;
    for (let a = 0; a < 3; a++) {
      const ia = tris[3 * t + a], gxa = G[o + 2 * a], gya = G[o + 2 * a + 1];
      for (let b = 0; b < 3; b++) {
        const ib = tris[3 * t + b], gxb = G[o + 2 * b], gyb = G[o + 2 * b + 1];
        const p = a === b ? S.diag[ia] : _uvPos(S, ia, ib);
        Aa[p] += ar * (gxa * gxb + gya * gyb);
        if (Ab && a !== b) Ab[p] += ar * (gya * gxb - gxa * gyb);
      }
    }
  }
  let md = 0;
  for (let i = 0; i < S.n; i++) md += Aa[S.diag[i]];
  md = S.n ? md / S.n : 0;
  const eps = md > 0 && Number.isFinite(md) ? md * 1e-4 : 1;
  for (let t = 0; t < nt; t++) {
    if (A[t] > 0) continue;
    for (let a = 0; a < 3; a++) {
      const i = tris[3 * t + a], j = tris[3 * t + (a + 1) % 3];
      if (i === j) continue;
      Aa[_uvPos(S, i, j)] -= eps; Aa[_uvPos(S, j, i)] -= eps;
      Aa[S.diag[i]] += eps; Aa[S.diag[j]] += eps;
    }
  }
  for (let i = 0; i < S.n; i++) if (!(Aa[S.diag[i]] > 0)) Aa[S.diag[i]] = eps;
  return { Aa, Ab };
}

function _uvSignedAreaTris(U, V, tris) {
  let s = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    s += (U[b] - U[a]) * (V[c] - V[a]) - (V[b] - V[a]) * (U[c] - U[a]);
  }
  return 0.5 * s;
}

// Returns { U, V } (Float64Array, length n). method: 'conformal' | 'min_stretch'.
function _uvSolveIsland(n, X, Y, Z, tris, method, iterations) {
  const U = new Float64Array(n), V = new Float64Array(n);
  if (n < 2 || tris.length < 3) return { U, V };
  // --- initial guess: projection onto the island's best plane, pins along the principal axis
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += X[i]; cy += Y[i]; cz += Z[i]; }
  cx /= n; cy /= n; cz /= n;
  const m = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = X[i] - cx, y = Y[i] - cy, z = Z[i] - cz;
    m[0] += x * x; m[1] += x * y; m[2] += x * z; m[3] += y * y; m[4] += y * z; m[5] += z * z;
  }
  const E = _uvEig3(m);
  let Nx = 0, Ny = 0, Nz = 0, Tn = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2];
    const ax = X[i1] - X[i0], ay = Y[i1] - Y[i0], az = Z[i1] - Z[i0];
    const bx = X[i2] - X[i0], by = Y[i2] - Y[i0], bz = Z[i2] - Z[i0];
    const qx = ay * bz - az * by, qy = az * bx - ax * bz, qz = ax * by - ay * bx;
    Nx += qx; Ny += qy; Nz += qz; Tn += Math.hypot(qx, qy, qz);
  }
  let nrm;
  const Nl = Math.hypot(Nx, Ny, Nz);
  if (Nl > 0.5 * Tn && Nl > 0) nrm = [Nx / Nl, Ny / Nl, Nz / Nl];
  else {
    nrm = E.vec[2].slice();
    if (nrm[0] * Nx + nrm[1] * Ny + nrm[2] * Nz < 0) nrm = nrm.map(x => -x);
  }
  const e1 = E.vec[0];
  let a1 = null;
  for (const cand of [e1, E.vec[1], E.vec[2]]) {
    const d = cand[0] * nrm[0] + cand[1] * nrm[1] + cand[2] * nrm[2];
    const v = [cand[0] - d * nrm[0], cand[1] - d * nrm[1], cand[2] - d * nrm[2]];
    const l = Math.hypot(v[0], v[1], v[2]);
    if (l > 1e-6) { a1 = v.map(x => x / l); break; }
  }
  if (!a1) { const B = _uvBasis(nrm[0], nrm[1], nrm[2], new Float64Array(9)); a1 = [B[0], B[1], B[2]]; }
  const a2 = [nrm[1] * a1[2] - nrm[2] * a1[1], nrm[2] * a1[0] - nrm[0] * a1[2], nrm[0] * a1[1] - nrm[1] * a1[0]];
  let pinA = 0, pinB = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = X[i] - cx, y = Y[i] - cy, z = Z[i] - cz;
    U[i] = x * a1[0] + y * a1[1] + z * a1[2];
    V[i] = x * a2[0] + y * a2[1] + z * a2[2];
    const d = x * e1[0] + y * e1[1] + z * e1[2];
    if (d < lo) { lo = d; pinA = i; }
    if (d > hi) { hi = d; pinB = i; }
  }
  if (pinA === pinB) pinB = pinA === 0 ? 1 : 0;
  if (Math.hypot(U[pinB] - U[pinA], V[pinB] - V[pinA]) < 1e-12) {
    const sc = Math.sqrt(Math.max(m[0] + m[3] + m[5], 0) / n) || 1;
    U[pinB] = U[pinA] + sc; V[pinB] = V[pinA];
  }
  // --- LSCM
  const S = _uvPattern(n, tris);
  const TG = _uvTriGrads(X, Y, Z, tris);
  const M = _uvAssemble(S, tris, TG, true);
  const pinned = new Uint8Array(n);
  pinned[pinA] = 1; pinned[pinB] = 1;
  const F = _uvCfg.direct ? _uvCholesky(S, M.Aa, M.Ab, pinned, X, Y, Z, _uvCfg.maxNnz) : null;
  if (F) _uvCholSolve(F, null, null, U, V);
  else _uvPCG(S, M.Aa, M.Ab, null, null, U, V, pinned, _uvCfg.lscmIter, _uvCfg.lscmTol);
  if (_uvSignedAreaTris(U, V, tris) < 0) for (let i = 0; i < n; i++) U[i] = -U[i];
  // --- ARAP refinement (local/global)
  if (method === 'min_stretch' && iterations > 0) _uvARAP(S, tris, TG, U, V, pinA, iterations | 0, X, Y, Z);
  return { U, V };
}

function _uvARAP(S, tris, TG, U, V, pin, iters, X, Y, Z) {
  const n = S.n, nt = tris.length / 3, { A, G } = TG;
  const L = _uvAssemble(S, tris, TG, false).Aa;
  const pinned = new Uint8Array(n);
  pinned[pin] = 1;
  const F = _uvCfg.direct ? _uvCholesky(S, L, null, pinned, X, Y, Z, _uvCfg.maxNnz) : null;
  const bu = new Float64Array(n), bv = new Float64Array(n), pu = new Float64Array(n), pv = new Float64Array(n);
  // flip guard: a global step may not increase the number of inverted triangles; if it does,
  // step back towards the previous iterate (energy still decreases for the fixed rotations)
  const flipped = () => {
    let f = 0;
    for (let t = 0; t < nt; t++) {
      if (!(A[t] > 0)) continue;
      const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2];
      if ((U[b] - U[a]) * (V[c] - V[a]) - (V[b] - V[a]) * (U[c] - U[a]) <= 0) f++;
    }
    return f;
  };
  let allowed = flipped();
  const nIt = Math.min(iters, 100), ramp = Math.max(1, Math.ceil(nIt * 0.6));
  for (let k = 0; k < nIt; k++) {
    const lam = Math.min(1, (k + 1) / ramp);
    pu.set(U); pv.set(V);
    bu.fill(0); bv.fill(0);
    for (let t = 0; t < nt; t++) {
      const ar = A[t];
      if (!(ar > 0)) continue;
      const o = 6 * t;
      let a = 0, b = 0, c = 0, d = 0;
      for (let j = 0; j < 3; j++) {
        const i = tris[3 * t + j], gx = G[o + 2 * j], gy = G[o + 2 * j + 1];
        a += U[i] * gx; b += U[i] * gy; c += V[i] * gx; d += V[i] * gy;
      }
      // closest rotation, times a scale that is relaxed from the current similarity scale
      // towards 1 over the first iterations (homotopy ASAP -> ARAP; avoids violent first steps)
      const th = Math.atan2(c - b, a + d), sc = lam >= 1 ? 1 : Math.pow(Math.max(1e-6, 0.5 * Math.hypot(a + d, c - b)), 1 - lam);
      const co = Math.cos(th) * sc, si = Math.sin(th) * sc;
      for (let j = 0; j < 3; j++) {
        const i = tris[3 * t + j], gx = G[o + 2 * j], gy = G[o + 2 * j + 1];
        bu[i] += ar * (co * gx - si * gy);
        bv[i] += ar * (si * gx + co * gy);
      }
    }
    if (F) _uvCholSolve(F, bu, bv, U, V);
    else _uvPCG(S, L, null, bu, bv, U, V, pinned, _uvCfg.arapIter, _uvCfg.arapTol);
    let f = flipped(), t = 1;
    while (f > allowed && t > 1e-3) {
      t *= 0.5;
      for (let i = 0; i < n; i++) { U[i] = pu[i] + (U[i] - pu[i]) * 0.5; V[i] = pv[i] + (V[i] - pv[i]) * 0.5; }
      f = flipped();
    }
    if (f > allowed) { U.set(pu); V.set(pv); break; }
    allowed = f;
  }
}

// ---------------------------------------------------------------------------
// Island topology for unwrap: UV vertices (corner classes), boundary loops, automatic cuts
// ---------------------------------------------------------------------------

// Corner classes of island `isl` given joinable edges (joinE) minus cut edges. Fills cv[corner]
// with the local vertex id. Returns counts, Euler characteristic, boundary loops, adjacency.
function _uvIslandState(T, isl, joinE, cut, parent, cv, P) {
  const { cStart, cNext, cEdge, eC1, cVert } = T, pr = [0, 0, 0, 0];
  for (const k of isl) for (let c = cStart[k]; c < cStart[k + 1]; c++) parent[c] = c;
  let Ej = 0, Eb = 0;
  for (const k of isl) for (let c = cStart[k]; c < cStart[k + 1]; c++) {
    const e = cEdge[c];
    if (joinE[e] && !cut[e]) {
      if (eC1[e] === c) { Ej++; _uvEdgeCorners(T, e, pr); _uvUnion(parent, pr[0], pr[1]); _uvUnion(parent, pr[2], pr[3]); }
    } else Eb++;
  }
  let n = 0;
  for (const k of isl) for (let c = cStart[k]; c < cStart[k + 1]; c++) if (_uvFind(parent, c) === c) cv[c] = n++;
  for (const k of isl) for (let c = cStart[k]; c < cStart[k + 1]; c++) cv[c] = cv[_uvFind(parent, c)];
  const vertOf = new Int32Array(n), onB = new Uint8Array(n), bp = new Int32Array(n), loopOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) bp[i] = i;
  const deg = new Int32Array(n + 1);
  for (const k of isl) for (let c = cStart[k]; c < cStart[k + 1]; c++) {
    vertOf[cv[c]] = cVert[c];
    const e = cEdge[c], a = cv[c], b = cv[cNext[c]];
    if (joinE[e] && !cut[e]) { if (eC1[e] === c && a !== b) { deg[a]++; deg[b]++; } }
    else { onB[a] = onB[b] = 1; _uvUnion(bp, a, b); }
  }
  let loops = 0;
  for (let i = 0; i < n; i++) if (onB[i]) { const r = _uvFind(bp, i); if (r === i) loops++; loopOf[i] = r; }
  // adjacency (CSR) over interior (joined, uncut) edges, weighted by 3D length
  const adjPtr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) adjPtr[i + 1] = adjPtr[i] + deg[i];
  const m = adjPtr[n], adjV = new Int32Array(m), adjE = new Int32Array(m), adjW = new Float64Array(m), fill = adjPtr.slice(0, n);
  for (const k of isl) for (let c = cStart[k]; c < cStart[k + 1]; c++) {
    const e = cEdge[c];
    if (!joinE[e] || cut[e] || eC1[e] !== c) continue;
    const a = cv[c], b = cv[cNext[c]];
    if (a === b) continue;
    const p = P[cVert[c]], q = P[cVert[cNext[c]]];
    const w = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) + 1e-12;
    adjV[fill[a]] = b; adjE[fill[a]] = e; adjW[fill[a]++] = w;
    adjV[fill[b]] = a; adjE[fill[b]] = e; adjW[fill[b]++] = w;
  }
  return { n, vertOf, onB, loopOf, loops, chi: n - (Ej + Eb) + isl.length, adjPtr, adjV, adjE, adjW };
}

// Multi-source Dijkstra over st's adjacency. Stops at the first popped vertex with isTarget(v);
// without isTarget, `target` is the farthest reached vertex.
function _uvDijkstra(st, sources, isTarget) {
  const n = st.n, dist = new Float64Array(n).fill(Infinity), predV = new Int32Array(n).fill(-1), predE = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n), cap = st.adjV.length + sources.length + 1;
  const hv = new Int32Array(cap), hd = new Float64Array(cap);
  let size = 0, last = -1;
  const push = (v, d) => {
    let i = size++;
    while (i > 0) { const p = (i - 1) >> 1; if (hd[p] <= d) break; hv[i] = hv[p]; hd[i] = hd[p]; i = p; }
    hv[i] = v; hd[i] = d;
  };
  for (const s of sources) { if (dist[s] !== 0) { dist[s] = 0; push(s, 0); } }
  while (size > 0) {
    const v = hv[0], d = hd[0];
    const lv = hv[--size], ld = hd[size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && hd[c + 1] < hd[c]) c++;
      if (hd[c] >= ld) break;
      hv[i] = hv[c]; hd[i] = hd[c]; i = c;
    }
    hv[i] = lv; hd[i] = ld;
    if (done[v] || d > dist[v]) continue;
    done[v] = 1; last = v;
    if (isTarget && isTarget(v)) return { dist, predV, predE, target: v };
    for (let p = st.adjPtr[v]; p < st.adjPtr[v + 1]; p++) {
      const u = st.adjV[p], nd = d + st.adjW[p];
      if (nd < dist[u] && size < cap) { dist[u] = nd; predV[u] = v; predE[u] = st.adjE[p]; push(u, nd); }
    }
  }
  return { dist, predV, predE, target: isTarget ? -1 : last };
}

function _uvCutPath(r, v, cut) {
  let guard = 0;
  while (v >= 0 && r.predE[v] >= 0 && guard++ < 1e7) { cut[r.predE[v]] = 1; v = r.predV[v]; }
}

// Closed island (no boundary): cut a Steiner-like tree through high-curvature vertices
// (e.g. the corners of a cube give a cube net), or a long shortest path (sphere -> meridian).
function _uvCutClosed(T, isl, st, cut, cv, P) {
  const n = st.n, ang = new Float64Array(n), { cStart, cVert, cNext } = T;
  for (const k of isl) {
    const s = cStart[k], m = cStart[k + 1] - s;
    for (let i = 0; i < m; i++) {
      const c = s + i, p = P[cVert[c]], a = P[cVert[s + (i + m - 1) % m]], b = P[cVert[cNext[c]]];
      const ux = a[0] - p[0], uy = a[1] - p[1], uz = a[2] - p[2], wx = b[0] - p[0], wy = b[1] - p[1], wz = b[2] - p[2];
      ang[cv[c]] += Math.atan2(Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx), ux * wx + uy * wy + uz * wz);
    }
  }
  let cand = [];
  for (let i = 0; i < n; i++) { const d = Math.abs(2 * Math.PI - ang[i]); if (d > 0.5) cand.push(i); }
  cand.sort((a, b) => Math.abs(2 * Math.PI - ang[b]) - Math.abs(2 * Math.PI - ang[a]));
  cand = cand.slice(0, 64);
  if (cand.length < 2) {
    const A = _uvDijkstra(st, [0]).target;
    const r = _uvDijkstra(st, [A < 0 ? 0 : A]);
    _uvCutPath(r, r.target, cut);
    return;
  }
  const inTree = new Uint8Array(n), isT = new Uint8Array(n);
  inTree[cand[0]] = 1;
  let remaining = cand.length - 1;
  for (let i = 1; i < cand.length; i++) isT[cand[i]] = 1;
  while (remaining > 0) {
    const srcs = [];
    for (let i = 0; i < n; i++) if (inTree[i]) srcs.push(i);
    const r = _uvDijkstra(st, srcs, v => isT[v] === 1 && !inTree[v]);
    if (r.target < 0) break;
    let v = r.target;
    while (!inTree[v]) {
      inTree[v] = 1;
      if (isT[v]) remaining--;
      const e = r.predE[v];
      if (e < 0) break;
      cut[e] = 1; v = r.predV[v];
    }
  }
}

// Several boundary loops (annulus etc.): connect one loop to the nearest other loop.
function _uvCutJoinLoops(st, cut) {
  let L0 = -1;
  for (let i = 0; i < st.n; i++) if (st.onB[i]) { L0 = st.loopOf[i]; break; }
  if (L0 < 0) return false;
  const srcs = [];
  for (let i = 0; i < st.n; i++) if (st.loopOf[i] === L0) srcs.push(i);
  const r = _uvDijkstra(st, srcs, v => st.onB[v] === 1 && st.loopOf[v] !== L0);
  if (r.target < 0) return false;
  _uvCutPath(r, r.target, cut);
  return true;
}

// Handles / genus: classic cut graph = edges not crossed by a dual spanning tree, pruned of
// dangling branches (Erickson & Har-Peled style).
function _uvCutGenus(T, isl, st, joinE, cut, cv) {
  const { cStart, cEdge, eC1, cNext, cFace } = T, pr = [0, 0, 0, 0];
  const inIsl = new Map();
  isl.forEach((k, i) => inIsl.set(k, i));
  const seen = new Uint8Array(isl.length), tree = new Set(), queue = [isl[0]];
  seen[0] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    for (let c = cStart[k]; c < cStart[k + 1]; c++) {
      const e = cEdge[c];
      if (!joinE[e] || cut[e]) continue;
      _uvEdgeCorners(T, e, pr);
      const o = cFace[pr[0]] === k ? cFace[pr[1]] : cFace[pr[0]], oi = inIsl.get(o);
      if (oi === undefined || seen[oi]) continue;
      seen[oi] = 1; tree.add(e); queue.push(o);
    }
  }
  const n = st.n, deg = new Int32Array(n), cand = [];
  for (const k of isl) for (let c = cStart[k]; c < cStart[k + 1]; c++) {
    const e = cEdge[c], a = cv[c], b = cv[cNext[c]];
    if (joinE[e] && !cut[e]) { if (eC1[e] === c && !tree.has(e)) { cand.push(e, a, b); deg[a]++; deg[b]++; } }
    else { deg[a]++; deg[b]++; }
  }
  const ne = cand.length / 3, ptr = new Int32Array(n + 1);
  for (let i = 0; i < ne; i++) { ptr[cand[3 * i + 1] + 1]++; ptr[cand[3 * i + 2] + 1]++; }
  for (let i = 0; i < n; i++) ptr[i + 1] += ptr[i];
  const lst = new Int32Array(ptr[n]), fill = ptr.slice(0, n), removed = new Uint8Array(ne);
  for (let i = 0; i < ne; i++) { lst[fill[cand[3 * i + 1]]++] = i; lst[fill[cand[3 * i + 2]]++] = i; }
  const stack = [];
  for (let i = 0; i < n; i++) if (deg[i] === 1) stack.push(i);
  while (stack.length) {
    const v = stack.pop();
    if (deg[v] !== 1) continue;
    for (let p = ptr[v]; p < ptr[v + 1]; p++) {
      const i = lst[p];
      if (removed[i]) continue;
      removed[i] = 1;
      const a = cand[3 * i + 1], b = cand[3 * i + 2], o = a === v ? b : a;
      deg[a]--; deg[b]--;
      if (deg[o] === 1) stack.push(o);
      break;
    }
  }
  for (let i = 0; i < ne; i++) if (!removed[i]) cut[cand[3 * i]] = 1;
}

// ---------------------------------------------------------------------------
// Unwrap (LSCM / LSCM + ARAP)
// ---------------------------------------------------------------------------

export function unwrap(mesh, faceIdxs, opts) {
  const o = opts || {};
  const method = o.method === 'min_stretch' ? 'min_stretch' : 'conformal';
  const margin = o.margin === undefined ? 0.02 : o.margin;
  const iterations = o.iterations === undefined ? 10 : Math.max(0, Math.min(100, Number(o.iterations) || 0));
  const fids = _uvSel(mesh, faceIdxs);
  if (!fids.length) return;
  const P = mesh.verts, T = _uvTopo(mesh, fids);
  const joinE = new Uint8Array(T.ne);
  for (let e = 0; e < T.ne; e++) joinE[e] = _uvEdgeShared(T, e) && !T.eSeam[e] ? 1 : 0;
  const islands = _uvGroupFaces(T, e => joinE[e] === 1);
  const cut = new Uint8Array(T.ne), parent = new Int32Array(T.nc), cv = new Int32Array(T.nc);
  for (const isl of islands) _uvUnwrapIsland(mesh, T, isl, joinE, cut, parent, cv, P, method, iterations);
  const isl2 = islands.map(isl => isl.map(k => fids[k]));
  _uvAverageScale(mesh, isl2);
  _uvPack(mesh, isl2, margin, true);
}

function _uvUnwrapIsland(mesh, T, isl, joinE, cut, parent, cv, P, method, iterations) {
  let st = _uvIslandState(T, isl, joinE, cut, parent, cv, P);
  if (st.loops === 0 && st.n > 2) { _uvCutClosed(T, isl, st, cut, cv, P); st = _uvIslandState(T, isl, joinE, cut, parent, cv, P); }
  for (let g = 0; st.loops > 1 && g < 256; g++) {
    if (!_uvCutJoinLoops(st, cut)) break;
    st = _uvIslandState(T, isl, joinE, cut, parent, cv, P);
  }
  if (st.chi < 1 && st.loops >= 1) { _uvCutGenus(T, isl, st, joinE, cut, cv); st = _uvIslandState(T, isl, joinE, cut, parent, cv, P); }
  const n = st.n, X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
  for (let i = 0; i < n; i++) { const p = P[st.vertOf[i]]; X[i] = _uvFin(p[0]); Y[i] = _uvFin(p[1]); Z[i] = _uvFin(p[2]); }
  const tl = [], tmp = [];
  for (const k of isl) {
    const vs = mesh.faces[T.fids[k]].v, s = T.cStart[k];
    tmp.length = 0;
    _uvTriangulate(P, vs, tmp);
    for (let j = 0; j < tmp.length; j++) tl.push(cv[s + tmp[j]]);
  }
  const { U, V } = _uvSolveIsland(n, X, Y, Z, Int32Array.from(tl), method, iterations);
  for (const k of isl) {
    const face = mesh.faces[T.fids[k]], s = T.cStart[k];
    for (let i = 0; i < face.v.length; i++) _uvSet(face, i, U[cv[s + i]], V[cv[s + i]]);
  }
}

// ---------------------------------------------------------------------------
// Island transforms: average scale, packing, alignment
// ---------------------------------------------------------------------------

function _uvBBox(mesh, isl) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const fi of isl) for (const t of mesh.faces[fi].uv) {
    if (t[0] < x0) x0 = t[0]; if (t[0] > x1) x1 = t[0]; if (t[1] < y0) y0 = t[1]; if (t[1] > y1) y1 = t[1];
  }
  if (!(x1 >= x0)) { x0 = x1 = y0 = y1 = 0; }
  return [x0, y0, x1, y1];
}

// Applies uv' = (R * (uv - c)) * s + d to every corner of the island (R = rotation by angle th).
function _uvXform(mesh, isl, cx, cy, th, s, dx, dy) {
  const co = Math.cos(th) * s, si = Math.sin(th) * s;
  for (const fi of isl) {
    const face = mesh.faces[fi];
    for (let i = 0; i < face.uv.length; i++) {
      const x = face.uv[i][0] - cx, y = face.uv[i][1] - cy;
      _uvSet(face, i, co * x - si * y + dx, si * x + co * y + dy);
    }
  }
}

function _uvAverageScale(mesh, islands) {
  const P = mesh.verts, info = [];
  let t3 = 0, tu = 0;
  for (const isl of islands) {
    let a3 = 0, au = 0;
    for (const fi of isl) { const f = mesh.faces[fi]; a3 += _uvArea3(P, f.v); au += Math.abs(_uvAreaUV(f.uv)); }
    info.push([a3, au]);
    if (a3 > 1e-30 && au > 1e-30) { t3 += a3; tu += au; }
  }
  if (!(t3 > 0) || !(tu > 0)) return;
  const k = Math.sqrt(tu / t3);
  islands.forEach((isl, i) => {
    const [a3, au] = info[i];
    if (!(a3 > 1e-30 && au > 1e-30)) return;
    const s = Math.sqrt(a3 / au) * k;
    if (!Number.isFinite(s)) return;
    const b = _uvBBox(mesh, isl), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    _uvXform(mesh, isl, cx, cy, 0, s, cx, cy);
  });
}

export function averageIslandScale(mesh, faceIdxs) {
  _uvAverageScale(mesh, getUVIslands(mesh, faceIdxs));
}

// Convex hull (monotone chain) of flat [x0,y0,x1,y1,...] -> flat hull array (CCW).
function _uvHull(pts) {
  const n = pts.length / 2, idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => pts[2 * a] - pts[2 * b] || pts[2 * a + 1] - pts[2 * b + 1]);
  const cr = (o, a, b) => (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1]) - (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o]);
  const lo = [], up = [];
  for (const i of idx) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
  for (let k = n - 1; k >= 0; k--) { const i = idx[k]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], i) <= 0) up.pop(); up.push(i); }
  lo.pop(); up.pop();
  const h = lo.concat(up), out = [];
  for (const i of h) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

// Angle th such that rotating the points by -th gives the minimum-area bounding box.
function _uvMinAreaAngle(pts) {
  const h = _uvHull(pts), m = h.length / 2;
  if (m < 3) {
    if (m === 2) return Math.atan2(h[3] - h[1], h[2] - h[0]);
    return 0;
  }
  const angles = [];
  if (m <= 1500) for (let i = 0; i < m; i++) { const j = (i + 1) % m; angles.push(Math.atan2(h[2 * j + 1] - h[2 * i + 1], h[2 * j] - h[2 * i])); }
  else for (let i = 0; i < 180; i++) angles.push((i * Math.PI) / 360);
  let best = 0, bestA = Infinity;
  for (const a of angles) {
    const c = Math.cos(a), s = Math.sin(a);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < m; i++) {
      const x = h[2 * i] * c + h[2 * i + 1] * s, y = -h[2 * i] * s + h[2 * i + 1] * c;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const ar = (x1 - x0) * (y1 - y0);
    if (ar < bestA * (1 - 1e-9)) { bestA = ar; best = a; }
  }
  // fold into (-45, 45] so islands are not turned needlessly
  let a = best % (Math.PI / 2);
  if (a > Math.PI / 4) a -= Math.PI / 2;
  if (a <= -Math.PI / 4) a += Math.PI / 2;
  return a;
}

// Shelf packing (next-fit, items pre-sorted by height). Returns flat [x, y, rot] per item or null.
function _uvShelf(W, H, order, s, m, rot) {
  const out = new Float64Array(W.length * 3);
  let x = 0, y = 0, sh = 0;
  for (const i of order) {
    const r = rot[i], w = s * (r ? H[i] : W[i]) + m, h = s * (r ? W[i] : H[i]) + m;
    if (x + w > 1 + 1e-12) { y += sh; x = 0; sh = 0; }
    if (w > 1 + 1e-12 || y + h > 1 + 1e-12) return null;
    out[3 * i] = x; out[3 * i + 1] = y; out[3 * i + 2] = r;
    x += w; if (h > sh) sh = h;
  }
  return out;
}

// Skyline bottom-left packing with optional 90 degree rotation (for modest item counts).
function _uvSkyline(W, H, order, s, m, rotate) {
  const out = new Float64Array(W.length * 3);
  let sky = [[0, 0, 1]]; // [x, y, width]
  for (const i of order) {
    let best = null;
    for (let r = 0; r < (rotate ? 2 : 1); r++) {
      const w = s * (r ? H[i] : W[i]) + m, h = s * (r ? W[i] : H[i]) + m;
      if (w > 1 + 1e-12) continue;
      for (let k = 0; k < sky.length; k++) {
        const x = sky[k][0];
        if (x + w > 1 + 1e-12) break;
        let y = 0;
        for (let j = k; j < sky.length && sky[j][0] < x + w - 1e-12; j++) if (sky[j][1] > y) y = sky[j][1];
        if (y + h > 1 + 1e-12) continue;
        if (!best || y + h < best[1] + best[3] - 1e-12 || (Math.abs(y + h - best[1] - best[3]) <= 1e-12 && x < best[0])) best = [x, y, w, h, r];
      }
    }
    if (!best) return null;
    const [x, y, w, h, r] = best;
    out[3 * i] = x; out[3 * i + 1] = y; out[3 * i + 2] = r;
    const ns = [];
    let ins = false;
    for (const sg of sky) {
      const sx = sg[0], ex = sg[0] + sg[2];
      if (ex <= x + 1e-15 || sx >= x + w - 1e-15) {
        if (!ins && sx >= x + w - 1e-15) { ns.push([x, y + h, w]); ins = true; }
        ns.push(sg); continue;
      }
      if (sx < x) ns.push([sx, sg[1], x - sx]);
      if (!ins) { ns.push([x, y + h, w]); ins = true; }
      if (ex > x + w) ns.push([x + w, sg[1], ex - x - w]);
    }
    if (!ins) ns.push([x, y + h, w]);
    sky = [];
    for (const sg of ns) {
      const last = sky[sky.length - 1];
      if (last && Math.abs(last[1] - sg[1]) < 1e-15) last[2] = sg[0] + sg[2] - last[0];
      else sky.push(sg);
    }
  }
  return out;
}

// Pack explicit islands (arrays of mesh face indices) into the unit square, one common scale.
function _uvPack(mesh, islands, margin, rotate) {
  const N = islands.length;
  if (!N) return;
  let m = Number(margin);
  if (!Number.isFinite(m) || m < 0) m = 0;
  m = Math.min(m, 0.45, 0.25 / Math.sqrt(N));
  const W = new Float64Array(N), H = new Float64Array(N), TH = new Float64Array(N), OX = new Float64Array(N), OY = new Float64Array(N);
  let maxDim = 0;
  islands.forEach((isl, i) => {
    const pts = [];
    for (const fi of isl) for (const t of mesh.faces[fi].uv) pts.push(t[0], t[1]);
    const th = rotate ? _uvMinAreaAngle(pts) : 0, c = Math.cos(th), s = Math.sin(th);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k] * c + pts[k + 1] * s, y = -pts[k] * s + pts[k + 1] * c;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!(x1 >= x0)) { x0 = x1 = y0 = y1 = 0; }
    TH[i] = th; OX[i] = x0; OY[i] = y0; W[i] = x1 - x0; H[i] = y1 - y0;
    maxDim = Math.max(maxDim, W[i], H[i]);
  });
  if (!(maxDim > 0)) maxDim = 1;
  let area = 0;
  for (let i = 0; i < N; i++) { W[i] = Math.max(W[i], maxDim * 1e-9); H[i] = Math.max(H[i], maxDim * 1e-9); area += W[i] * H[i]; }
  // shelf: landscape orientation, tallest first; skyline: biggest first
  const rot = new Uint8Array(N);
  if (rotate) for (let i = 0; i < N; i++) rot[i] = H[i] > W[i] ? 1 : 0;
  const hOf = i => (rot[i] ? W[i] : H[i]);
  const shelfOrder = Array.from({ length: N }, (_, i) => i).sort((a, b) => hOf(b) - hOf(a) || a - b);
  const skyOrder = Array.from({ length: N }, (_, i) => i).sort((a, b) => Math.max(W[b], H[b]) - Math.max(W[a], H[a]) || W[b] * H[b] - W[a] * H[a] || a - b);
  const useSky = N <= 150;
  const tryPack = s => {
    const a = _uvShelf(W, H, shelfOrder, s, m, rot);
    if (!useSky) return a;
    const b = _uvSkyline(W, H, skyOrder, s, m, rotate);
    return b || a;
  };
  let lo = 0, hi = Math.min(1 / Math.sqrt(area), (1 - m) / Math.max(1e-30, Math.min(...[maxDim]))) * 1.0000001;
  hi = Math.max(hi, 1e-12);
  let best = tryPack(hi);
  if (best) lo = hi;
  else {
    best = tryPack(0);
    for (let it = 0; it < 40 && hi - lo > 1e-7 * hi; it++) {
      const mid = 0.5 * (lo + hi), r = tryPack(mid);
      if (r) { lo = mid; best = r; } else hi = mid;
    }
  }
  if (!best) { m = 0; best = tryPack(0) || new Float64Array(N * 3); }
  const s = lo, half = m / 2;
  islands.forEach((isl, i) => {
    const x = best[3 * i], y = best[3 * i + 1], r = best[3 * i + 2];
    const th = TH[i], c = Math.cos(th), sn = Math.sin(th), w = W[i], h = H[i];
    for (const fi of isl) {
      const face = mesh.faces[fi];
      for (let k = 0; k < face.uv.length; k++) {
        const u = face.uv[k][0], v = face.uv[k][1];
        let px = u * c + v * sn - OX[i], py = -u * sn + v * c - OY[i];
        if (r) { const t = px; px = h - py; py = t; }
        _uvSet(face, k, Math.min(1, Math.max(0, x + half + s * px)), Math.min(1, Math.max(0, y + half + s * py)));
      }
    }
    void w;
  });
}

export function packIslands(mesh, faceIdxs, { margin = 0.02, rotate = true } = {}) {
  _uvPack(mesh, getUVIslands(mesh, faceIdxs), margin, rotate !== false);
}

export function alignRotation(mesh, faceIdxs) {
  for (const isl of getUVIslands(mesh, faceIdxs)) {
    let C = 0, S = 0;
    for (const fi of isl) {
      const uv = mesh.faces[fi].uv, n = uv.length;
      for (let i = 0; i < n; i++) {
        const dx = uv[(i + 1) % n][0] - uv[i][0], dy = uv[(i + 1) % n][1] - uv[i][1];
        const l = Math.hypot(dx, dy);
        if (!(l > 1e-12)) continue;
        const a = 4 * Math.atan2(dy, dx);
        C += l * Math.cos(a); S += l * Math.sin(a);
      }
    }
    if (!(Math.hypot(C, S) > 1e-12)) continue;
    const th = Math.atan2(S, C) / 4;
    const b = _uvBBox(mesh, isl), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    _uvXform(mesh, isl, cx, cy, -th, 1, cx, cy);
  }
}

// ---------------------------------------------------------------------------
// Smart UV Project / Lightmap Pack
// ---------------------------------------------------------------------------

export function smartProject(mesh, faceIdxs, { angleLimit = 66, margin = 0.02, areaWeight = 0 } = {}) {
  const fids = _uvSel(mesh, faceIdxs);
  if (!fids.length) return;
  const P = mesh.verts, nf = fids.length, N = new Float64Array(3 * nf), AR = new Float64Array(nf), nn = [0, 0, 0];
  let meanA = 0;
  for (let k = 0; k < nf; k++) {
    _uvNewell(P, mesh.faces[fids[k]].v, nn);
    const l = Math.hypot(nn[0], nn[1], nn[2]);
    AR[k] = l / 2; meanA += AR[k] / nf;
    if (l > 1e-30) { N[3 * k] = nn[0] / l; N[3 * k + 1] = nn[1] / l; N[3 * k + 2] = nn[2] / l; } else N[3 * k + 2] = 1;
  }
  const lim = Math.min(89, Math.max(1, Number.isFinite(angleLimit) ? angleLimit : 66));
  const cosLim = Math.cos((lim * Math.PI) / 180);
  const aw = Math.min(1, Math.max(0, Number(areaWeight) || 0));
  const wOf = k => (1 - aw) + aw * (meanA > 0 ? AR[k] / meanA : 1);
  // greedy projection directions, seeded by the largest uncovered face
  const order = Array.from({ length: nf }, (_, i) => i).sort((a, b) => AR[b] - AR[a] || a - b);
  const covered = new Uint8Array(nf), dirs = [];
  for (const f of order) {
    if (covered[f]) continue;
    let dx = N[3 * f], dy = N[3 * f + 1], dz = N[3 * f + 2];
    for (let it = 0; it < 3; it++) {
      let sx = 0, sy = 0, sz = 0;
      for (let k = 0; k < nf; k++) {
        if (N[3 * k] * dx + N[3 * k + 1] * dy + N[3 * k + 2] * dz < cosLim) continue;
        const w = wOf(k);
        sx += N[3 * k] * w; sy += N[3 * k + 1] * w; sz += N[3 * k + 2] * w;
      }
      const l = Math.hypot(sx, sy, sz);
      if (!(l > 1e-12)) break;
      const ex = sx / l, ey = sy / l, ez = sz / l;
      if (N[3 * f] * ex + N[3 * f + 1] * ey + N[3 * f + 2] * ez < cosLim) break; // keep the seed covered
      dx = ex; dy = ey; dz = ez;
    }
    dirs.push([dx, dy, dz]);
    covered[f] = 1;
    for (let k = 0; k < nf; k++) if (N[3 * k] * dx + N[3 * k + 1] * dy + N[3 * k + 2] * dz >= cosLim) covered[k] = 1;
  }
  const group = new Int32Array(nf);
  for (let k = 0; k < nf; k++) {
    let best = -Infinity;
    dirs.forEach((d, i) => { const s = N[3 * k] * d[0] + N[3 * k + 1] * d[1] + N[3 * k + 2] * d[2]; if (s > best) { best = s; group[k] = i; } });
  }
  const T = _uvTopo(mesh, fids);
  const islands = _uvGroupFaces(T, e => !T.eSeam[e] && group[T.cFace[T.eC1[e]]] === group[T.cFace[T.eC2[e]]]);
  const B = new Float64Array(9);
  for (const isl of islands) {
    let sx = 0, sy = 0, sz = 0;
    for (const k of isl) { sx += N[3 * k] * AR[k]; sy += N[3 * k + 1] * AR[k]; sz += N[3 * k + 2] * AR[k]; }
    let l = Math.hypot(sx, sy, sz);
    let ok = l > 1e-20;
    if (ok) { sx /= l; sy /= l; sz /= l; for (const k of isl) if (N[3 * k] * sx + N[3 * k + 1] * sy + N[3 * k + 2] * sz < 0.05) { ok = false; break; } }
    if (!ok) [sx, sy, sz] = dirs[group[isl[0]]];
    _uvBasis(sx, sy, sz, B);
    for (const k of isl) {
      const face = mesh.faces[fids[k]];
      face.v.forEach((vi, i) => { const p = P[vi]; _uvSet(face, i, p[0] * B[0] + p[1] * B[1] + p[2] * B[2], p[0] * B[3] + p[1] * B[4] + p[2] * B[5]); });
    }
  }
  _uvPack(mesh, islands.map(isl => isl.map(k => fids[k])), margin, true);
}

export function lightmapPack(mesh, faceIdxs, { margin = 0.02 } = {}) {
  const fids = _uvSel(mesh, faceIdxs);
  if (!fids.length) return;
  const P = mesh.verts, nn = [0, 0, 0], B = new Float64Array(9);
  for (const fi of fids) {
    const face = mesh.faces[fi];
    _uvNewell(P, face.v, nn);
    _uvBasis(nn[0], nn[1], nn[2], B);
    face.v.forEach((vi, i) => { const p = P[vi]; _uvSet(face, i, p[0] * B[0] + p[1] * B[1] + p[2] * B[2], p[0] * B[3] + p[1] * B[4] + p[2] * B[5]); });
  }
  _uvPack(mesh, fids.map(f => [f]), margin, true);
}

// ---------------------------------------------------------------------------
// Follow Active Quads / Straighten
// ---------------------------------------------------------------------------

// Average 3D edge length of each quad edge ring (opposite quad edges) -> Float64Array per edge.
function _uvRingAvg(mesh, T, allow) {
  const p = new Int32Array(T.ne), P = mesh.verts;
  for (let e = 0; e < T.ne; e++) p[e] = e;
  for (let k = 0; k < T.nf; k++) {
    if (!allow[k]) continue;
    const s = T.cStart[k];
    _uvUnion(p, T.cEdge[s], T.cEdge[s + 2]);
    _uvUnion(p, T.cEdge[s + 1], T.cEdge[s + 3]);
  }
  const sum = new Float64Array(T.ne), cnt = new Int32Array(T.ne), out = new Float64Array(T.ne);
  const len = new Float64Array(T.ne);
  for (let e = 0; e < T.ne; e++) {
    const c = T.eC1[e], a = P[T.cVert[c]], b = P[T.cVert[T.cNext[c]]];
    len[e] = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const r = _uvFind(p, e);
    sum[r] += len[e]; cnt[r]++;
  }
  for (let e = 0; e < T.ne; e++) { const r = _uvFind(p, e); out[e] = cnt[r] ? sum[r] / cnt[r] : len[e]; }
  return out;
}

// BFS from local quad startK over passable shared edges into allowed quads, extrapolating UVs
// like Blender's Follow Active Quads. Returns the visited local faces (start included).
function _uvFollow(mesh, T, startK, allow, passable, mode, ringAvg) {
  const { cStart, cNext, cEdge, cFace, cVert, fids } = T, P = mesh.verts, pr = [0, 0, 0, 0];
  const visited = new Uint8Array(T.nf), queue = [startK];
  visited[startK] = 1;
  const prevC = c => { const k = cFace[c]; return c === cStart[k] ? cStart[k + 1] - 1 : c - 1; };
  const len = (c1, c2) => { const p = P[cVert[c1]], q = P[cVert[c2]]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
  const uvOf = c => _uvCornerUV(mesh, T, c);
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    for (let c = cStart[k]; c < cStart[k + 1]; c++) {
      const e = cEdge[c];
      if (!_uvEdgeShared(T, e) || !passable(e)) continue;
      _uvEdgeCorners(T, e, pr);
      const sA = c, sB = cNext[c];
      let tA, tB;
      if (pr[0] === sA) { tA = pr[1]; tB = pr[3]; } else if (pr[1] === sA) { tA = pr[0]; tB = pr[2]; }
      else if (pr[2] === sA) { tA = pr[3]; tB = pr[1]; } else { tA = pr[2]; tB = pr[0]; }
      const o = cFace[tA];
      if (o === k || visited[o] || !allow[o] || cFace[tB] !== o) continue;
      const sAo = prevC(sA), sBo = cNext[sB];
      let tAo, tBo, etA;
      if (cNext[tA] === tB) { tAo = prevC(tA); tBo = cNext[tB]; etA = cEdge[tAo]; } else { tAo = cNext[tA]; tBo = prevC(tB); etA = cEdge[tA]; }
      let fac = 1;
      if (mode === 'length') {
        const d1 = len(sAo, sA) + len(sBo, sB), d2 = len(tA, tAo) + len(tB, tBo);
        fac = d1 > 1e-12 ? d2 / d1 : 1;
      } else if (mode === 'length_average') {
        const d1 = ringAvg[cEdge[sAo]], d2 = ringAvg[etA];
        fac = d1 > 1e-12 ? d2 / d1 : 1;
      }
      if (!Number.isFinite(fac)) fac = 1;
      const ua = uvOf(sA), ub = uvOf(sB), uao = uvOf(sAo), ubo = uvOf(sBo);
      const face = mesh.faces[fids[o]], base = cStart[o];
      _uvSet(face, tA - base, ua[0], ua[1]);
      _uvSet(face, tB - base, ub[0], ub[1]);
      _uvSet(face, tAo - base, ua[0] + (ua[0] - uao[0]) * fac, ua[1] + (ua[1] - uao[1]) * fac);
      _uvSet(face, tBo - base, ub[0] + (ub[0] - ubo[0]) * fac, ub[1] + (ub[1] - ubo[1]) * fac);
      visited[o] = 1; queue.push(o);
    }
  }
  return queue;
}

// Make quad (mesh face index fi) an axis-aligned rectangle sized from its current UV edge
// lengths (3D lengths if the UVs are degenerate), keeping corner 0 and the UV winding.
function _uvRectify(mesh, fi, use3D) {
  const face = mesh.faces[fi], q = face.uv, P = mesh.verts;
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let l01 = (d(q[0], q[1]) + d(q[3], q[2])) / 2, l12 = (d(q[1], q[2]) + d(q[0], q[3])) / 2;
  if (use3D || !(l01 > 1e-12) || !(l12 > 1e-12)) {
    const D = (i, j) => { const a = P[face.v[i]], b = P[face.v[j]]; return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
    l01 = (D(0, 1) + D(3, 2)) / 2 || 1; l12 = (D(1, 2) + D(0, 3)) / 2 || 1;
  }
  const ax = q[1][0] - q[0][0], ay = q[1][1] - q[0][1];
  let dx = 1, dy = 0;
  if (Math.abs(ay) > Math.abs(ax)) { dx = 0; dy = Math.sign(ay); } else if (ax < 0) dx = -1;
  const sg = _uvAreaUV(q) < 0 ? -1 : 1, px = -dy * sg, py = dx * sg;
  const x0 = q[0][0], y0 = q[0][1];
  _uvSet(face, 1, x0 + dx * l01, y0 + dy * l01);
  _uvSet(face, 2, x0 + dx * l01 + px * l12, y0 + dy * l01 + py * l12);
  _uvSet(face, 3, x0 + px * l12, y0 + py * l12);
}

export function followActiveQuads(mesh, faceIdxs, activeFace, { mode = 'length_average' } = {}) {
  if (!mesh || !mesh.faces || !Number.isInteger(activeFace) || !mesh.faces[activeFace] || !mesh.faces[activeFace].v || mesh.faces[activeFace].v.length !== 4) return false;
  const fids = _uvSel(mesh, [activeFace].concat(Array.from(faceIdxs || [])));
  const T = _uvTopo(mesh, fids), allow = new Uint8Array(T.nf);
  for (let k = 0; k < T.nf; k++) allow[k] = mesh.faces[fids[k]].v.length === 4 ? 1 : 0;
  const act = mesh.faces[activeFace];
  if (!(Math.abs(_uvAreaUV(act.uv)) > 1e-14)) { // degenerate active UVs: start from its 3D shape
    _uvSet(act, 0, 0, 0); _uvSet(act, 1, 1, 0); _uvSet(act, 2, 1, 1); _uvSet(act, 3, 0, 1);
    _uvRectify(mesh, activeFace, true);
  }
  const md = mode === 'even' || mode === 'length' ? mode : 'length_average';
  const ring = md === 'length_average' ? _uvRingAvg(mesh, T, allow) : null;
  _uvFollow(mesh, T, 0, allow, e => !T.eSeam[e], md, ring);
  return true;
}

export function straightenGrid(mesh, faceIdxs, activeFace) {
  const fids = _uvSel(mesh, faceIdxs);
  if (!fids.length) return 0;
  const T = _uvTopo(mesh, fids), pr = [0, 0, 0, 0];
  const weld = new Uint8Array(T.ne);
  for (let e = 0; e < T.ne; e++) {
    if (!_uvEdgeShared(T, e)) continue;
    _uvEdgeCorners(T, e, pr);
    weld[e] = _uvSameUV(_uvCornerUV(mesh, T, pr[0]), _uvCornerUV(mesh, T, pr[1])) &&
      _uvSameUV(_uvCornerUV(mesh, T, pr[2]), _uvCornerUV(mesh, T, pr[3])) ? 1 : 0;
  }
  const isQuad = new Uint8Array(T.nf);
  for (let k = 0; k < T.nf; k++) isQuad[k] = mesh.faces[fids[k]].v.length === 4 ? 1 : 0;
  const ring = _uvRingAvg(mesh, T, isQuad);
  const orig = fids.map(fi => mesh.faces[fi].uv.map(t => [t[0], t[1]]));
  const actK = fids.indexOf(activeFace);
  // quad components over UV-welded edges (each lies inside one UV island)
  const comps = _uvGroupFaces(T, e => weld[e] === 1 && isQuad[T.cFace[T.eC1[e]]] === 1 && isQuad[T.cFace[T.eC2[e]]] === 1)
    .filter(c => isQuad[c[0]]);
  const allow = new Uint8Array(T.nf), moved = new Uint8Array(T.nf);
  let count = 0;
  for (const comp of comps) {
    const ff = comp.map(k => fids[k]);
    const b0 = _uvBBox(mesh, ff), cx0 = (b0[0] + b0[2]) / 2, cy0 = (b0[1] + b0[3]) / 2;
    let a0 = 0;
    for (const fi of ff) a0 += Math.abs(_uvAreaUV(mesh.faces[fi].uv));
    let start = comp.indexOf(actK) >= 0 ? actK : -1;
    if (start < 0) {
      let bd = Infinity;
      for (const k of comp) {
        const uv = mesh.faces[fids[k]].uv;
        const x = (uv[0][0] + uv[1][0] + uv[2][0] + uv[3][0]) / 4 - cx0, y = (uv[0][1] + uv[1][1] + uv[2][1] + uv[3][1]) / 4 - cy0;
        if (x * x + y * y < bd) { bd = x * x + y * y; start = k; }
      }
    }
    _uvRectify(mesh, fids[start], false);
    for (const k of comp) allow[k] = 1;
    _uvFollow(mesh, T, start, allow, e => weld[e] === 1, 'length_average', ring);
    for (const k of comp) { allow[k] = 0; moved[k] = 1; }
    const b1 = _uvBBox(mesh, ff), cx1 = (b1[0] + b1[2]) / 2, cy1 = (b1[1] + b1[3]) / 2;
    let a1 = 0;
    for (const fi of ff) a1 += Math.abs(_uvAreaUV(mesh.faces[fi].uv));
    let s = a0 > 1e-20 && a1 > 1e-20 ? Math.sqrt(a0 / a1) : 1;
    if (!Number.isFinite(s)) s = 1;
    _uvXform(mesh, ff, cx1, cy1, 0, s, cx0, cy0);
    count++;
  }
  // keep non-quad faces attached: snap corners that matched a moved quad corner, shift the rest
  const map = new Map();
  for (let k = 0; k < T.nf; k++) {
    if (!moved[k]) continue;
    const f = mesh.faces[fids[k]];
    f.v.forEach((v, i) => { let l = map.get(v); if (!l) map.set(v, l = []); l.push(orig[k][i], f.uv[i]); });
  }
  for (let k = 0; k < T.nf; k++) {
    if (moved[k] || isQuad[k]) continue;
    const f = mesh.faces[fids[k]], o = orig[k], hit = new Array(f.v.length).fill(null);
    let dx = 0, dy = 0, n = 0;
    f.v.forEach((v, i) => {
      const l = map.get(v);
      if (!l) return;
      for (let j = 0; j < l.length; j += 2) if (_uvSameUV(l[j], o[i])) { hit[i] = l[j + 1]; dx += l[j + 1][0] - o[i][0]; dy += l[j + 1][1] - o[i][1]; n++; break; }
    });
    if (!n) continue;
    dx /= n; dy /= n;
    for (let i = 0; i < f.v.length; i++) {
      if (hit[i]) _uvSet(f, i, hit[i][0], hit[i][1]); else _uvSet(f, i, o[i][0] + dx, o[i][1] + dy);
    }
  }
  return count;
}
