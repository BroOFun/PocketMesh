// ============================================================================
// mesh.js — PocketMesh mesh data structure, primitives and modeling operators.
// Pure JS, no imports. Format: src/DATA-FORMAT.md (Z-up, CCW faces, per-corner UVs)
// ============================================================================

// ---------- small vector helpers (arrays [x,y,z]) ----------
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const vnorm = (a) => { const l = vlen(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const vlerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const uvlerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function newMesh() {
  return { verts: [], faces: [], looseEdges: [], seams: new Set(), creases: new Set(), smooth: false };
}
export function ekey(a, b) { return a < b ? a + '_' + b : b + '_' + a; }
export function ekeySplit(k) { const i = k.indexOf('_'); return [+k.slice(0, i), +k.slice(i + 1)]; }

export function cloneMesh(m) {
  return {
    verts: m.verts.map((p) => [p[0], p[1], p[2]]),
    faces: m.faces.map((f) => ({ v: f.v.slice(), uv: f.uv.map((u) => [u[0], u[1]]), mat: f.mat | 0 })),
    looseEdges: m.looseEdges.map((e) => [e[0], e[1]]),
    seams: new Set(m.seams),
    creases: new Set(m.creases || []),
    smooth: !!m.smooth,
  };
}

// Edge attributes share the same remapping rules through topology edits.
function edgeTagSets(m) { return [m.seams, m.creases ||= new Set()]; }

// ---------- topology cache ----------
export function topo(m) {
  if (m._topo) return m._topo;
  const nv = m.verts.length;
  const edgeIndex = new Map();
  const edges = [];
  const edgeFaces = [];
  const vertFaces = Array.from({ length: nv }, () => []);
  const add = (a, b, f) => {
    const k = ekey(a, b);
    let i = edgeIndex.get(k);
    if (i === undefined) { i = edges.length; edgeIndex.set(k, i); edges.push(a < b ? [a, b] : [b, a]); edgeFaces.push([]); }
    if (f >= 0) edgeFaces[i].push(f);
    return i;
  };
  for (let fi = 0; fi < m.faces.length; fi++) {
    const v = m.faces[fi].v, n = v.length;
    for (let i = 0; i < n; i++) { add(v[i], v[(i + 1) % n], fi); vertFaces[v[i]].push(fi); }
  }
  for (const e of m.looseEdges) if (e[0] !== e[1]) add(e[0], e[1], -1);
  const vertEdges = Array.from({ length: nv }, () => []);
  for (let i = 0; i < edges.length; i++) { vertEdges[edges[i][0]].push(i); vertEdges[edges[i][1]].push(i); }
  const t = { edges, edgeIndex, edgeFaces, vertFaces, vertEdges };
  Object.defineProperty(m, '_topo', { value: t, configurable: true, writable: true, enumerable: false });
  return t;
}
export function touch(m) {
  if (m._topo) m._topo = null;
}

// remove loose edges that are duplicates, degenerate or covered by a face; drop stale seams
export function cleanEdges(m) {
  touch(m);
  const faceEdges = new Set();
  for (const f of m.faces) for (let i = 0; i < f.v.length; i++) faceEdges.add(ekey(f.v[i], f.v[(i + 1) % f.v.length]));
  const seen = new Set();
  m.looseEdges = m.looseEdges.filter(([a, b]) => {
    if (a === b) return false;
    const k = ekey(a, b);
    if (faceEdges.has(k) || seen.has(k)) return false;
    seen.add(k); return true;
  });
  for (const tags of edgeTagSets(m)) for (const k of [...tags]) if (!faceEdges.has(k) && !seen.has(k)) tags.delete(k);
  touch(m);
}

// ---------- geometry helpers ----------
export function faceNormal(m, f) {
  const v = f.v, P = m.verts, n = v.length;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = P[v[i]], b = P[v[(i + 1) % n]];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return vnorm([nx, ny, nz]);
}
export function faceNormalRaw(m, f) { // length = 2 * area
  const v = f.v, P = m.verts, n = v.length;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = P[v[i]], b = P[v[(i + 1) % n]];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}
export function faceCenter(m, f) {
  const c = [0, 0, 0];
  for (const i of f.v) { const p = m.verts[i]; c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return vscale(c, 1 / f.v.length);
}
export function faceArea(m, f) { return vlen(faceNormalRaw(m, f)) / 2; }

function _project2D(pts3, n) {
  // project to plane by dropping dominant axis; keep CCW orientation w.r.t. n
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  let i0, i1, s;
  if (az >= ax && az >= ay) { i0 = 0; i1 = 1; s = n[2]; }
  else if (ax >= ay) { i0 = 1; i1 = 2; s = n[0]; }
  else { i0 = 2; i1 = 0; s = n[1]; }
  return pts3.map((p) => (s >= 0 ? [p[i0], p[i1]] : [p[i1], p[i0]]));
}
function _area2(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
export function earClip2D(P) {
  const n = P.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  // make CCW
  let area = 0;
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  if (area < 0) idx.reverse();
  const tris = [];
  let guard = 0;
  const eps = 1e-14 * Math.max(1, Math.abs(area));
  while (idx.length > 3 && guard++ < 10000) {
    let found = false;
    const L = idx.length;
    for (let i = 0; i < L; i++) {
      const a = idx[(i + L - 1) % L], b = idx[i], c = idx[(i + 1) % L];
      if (_area2(P[a], P[b], P[c]) <= eps) continue;
      let ok = true;
      for (const p of idx) {
        if (p === a || p === b || p === c) continue;
        const q = P[p];
        if (_area2(P[a], P[b], q) > eps && _area2(P[b], P[c], q) > eps && _area2(P[c], P[a], q) > eps) { ok = false; break; }
      }
      if (!ok) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      found = true;
      break;
    }
    if (!found) { const L2 = idx.length; tris.push([idx[L2 - 1], idx[0], idx[1]]); idx.splice(0, 1); }
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  if (area < 0) for (const t of tris) { const tmp = t[1]; t[1] = t[2]; t[2] = tmp; }
  return tris;
}
// triangulate a face -> array of [ci, cj, ck] corner indices (winding preserved)
export function triangulateFace(m, f) {
  const n = f.v.length;
  if (n === 3) return [[0, 1, 2]];
  const pts = f.v.map((i) => m.verts[i]);
  const nrm = faceNormalRaw(m, f);
  if (n === 4) {
    // fast path for convex quads: split along shorter diagonal
    const p2 = _project2D(pts, nrm);
    let convex = true;
    for (let i = 0; i < 4; i++) if (_area2(p2[i], p2[(i + 1) % 4], p2[(i + 2) % 4]) <= 0) { convex = false; break; }
    if (convex) {
      const d02 = vlen(vsub(pts[0], pts[2])), d13 = vlen(vsub(pts[1], pts[3]));
      return d02 <= d13 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]];
    }
  }
  if (vlen(nrm) < 1e-14) { const t = []; for (let i = 1; i < n - 1; i++) t.push([0, i, i + 1]); return t; }
  return earClip2D(_project2D(pts, nrm));
}

// vertex normals (area weighted) for smooth shading
export function vertexNormals(m) {
  const N = m.verts.map(() => [0, 0, 0]);
  for (const f of m.faces) {
    const n = faceNormalRaw(m, f);
    for (const v of f.v) { const a = N[v]; a[0] += n[0]; a[1] += n[1]; a[2] += n[2]; }
  }
  return N.map(vnorm);
}

// ---------- primitives (all Z-up, centered at origin, with UVs) ----------
function _face(v, uv, mat = 0) { return { v, uv, mat }; }
function _mesh(verts, faces, looseEdges = [], seams = []) {
  return { verts, faces, looseEdges, seams: new Set(seams), creases: new Set(), smooth: false };
}

export function primPlane({ size = 2 } = {}) {
  const h = size / 2;
  return _mesh([[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]], [_face([0, 1, 2, 3], [[0, 0], [1, 0], [1, 1], [0, 1]])]);
}

export function primGrid({ xSub = 10, ySub = 10, size = 2 } = {}) {
  xSub = Math.max(1, xSub | 0); ySub = Math.max(1, ySub | 0);
  const verts = [], faces = [];
  for (let j = 0; j <= ySub; j++) for (let i = 0; i <= xSub; i++) verts.push([(i / xSub - 0.5) * size, (j / ySub - 0.5) * size, 0]);
  const id = (i, j) => j * (xSub + 1) + i;
  for (let j = 0; j < ySub; j++) for (let i = 0; i < xSub; i++) {
    faces.push(_face([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)],
      [[i / xSub, j / ySub], [(i + 1) / xSub, j / ySub], [(i + 1) / xSub, (j + 1) / ySub], [i / xSub, (j + 1) / ySub]]));
  }
  return _mesh(verts, faces);
}

export function primCube({ size = 2 } = {}) {
  const h = size / 2;
  const verts = [];
  for (let i = 0; i < 8; i++) verts.push([(i & 1 ? 1 : -1) * h, (i & 2 ? 1 : -1) * h, (i & 4 ? 1 : -1) * h]);
  // [verts, right axis, up axis, cell(u,v)] — cross layout, cells of 0.25
  const defs = [
    { v: [0, 4, 6, 2], r: [0, -1, 0], u: [0, 0, 1], c: [0, 0.375] },        // -X left
    { v: [0, 1, 5, 4], r: [1, 0, 0], u: [0, 0, 1], c: [0.25, 0.375] },      // -Y front
    { v: [1, 3, 7, 5], r: [0, 1, 0], u: [0, 0, 1], c: [0.5, 0.375] },       // +X right
    { v: [2, 6, 7, 3], r: [-1, 0, 0], u: [0, 0, 1], c: [0.75, 0.375] },     // +Y back
    { v: [4, 5, 7, 6], r: [1, 0, 0], u: [0, 1, 0], c: [0.25, 0.625] },      // +Z top
    { v: [0, 2, 3, 1], r: [1, 0, 0], u: [0, -1, 0], c: [0.25, 0.125] },     // -Z bottom
  ];
  const faces = defs.map((d) => _face(d.v, d.v.map((vi) => {
    const p = verts[vi];
    return [d.c[0] + (vdot(p, d.r) / size + 0.5) * 0.25, d.c[1] + (vdot(p, d.u) / size + 0.5) * 0.25];
  })));
  // seams: every edge whose two faces are not neighbours in the cross layout
  const adj = new Set(['0-1', '1-2', '2-3', '1-4', '1-5']);
  const m = _mesh(verts, faces);
  const T = topo(m);
  T.edges.forEach((e, i) => {
    const fs = T.edgeFaces[i].slice().sort();
    if (fs.length === 2 && !adj.has(fs[0] + '-' + fs[1])) m.seams.add(ekey(e[0], e[1]));
  });
  return m;
}

export function primCircle({ verts: n = 32, radius = 1, fill = 'nothing' } = {}) {
  n = Math.max(3, n | 0);
  const verts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; verts.push([-Math.sin(a) * radius, Math.cos(a) * radius, 0]); }
  // vertex order goes counter-clockwise seen from +Z
  const uvOf = (i) => { const p = verts[i]; return [p[0] / radius * 0.5 + 0.5, p[1] / radius * 0.5 + 0.5]; };
  const ring = [...Array(n).keys()];
  if (fill === 'ngon') return _mesh(verts, [_face(ring, ring.map(uvOf))]);
  if (fill === 'fan') {
    const c = verts.length; verts.push([0, 0, 0]);
    const faces = ring.map((i) => _face([i, (i + 1) % n, c], [uvOf(i), uvOf((i + 1) % n), [0.5, 0.5]]));
    return _mesh(verts, faces);
  }
  return _mesh(verts, [], ring.map((i) => [i, (i + 1) % n]));
}

export function primUVSphere({ segments = 32, rings = 16, radius = 1 } = {}) {
  segments = Math.max(3, segments | 0); rings = Math.max(3, rings | 0);
  const verts = [[0, 0, radius]];
  for (let j = 1; j < rings; j++) {
    const th = (Math.PI * j) / rings, z = radius * Math.cos(th), r = radius * Math.sin(th);
    for (let i = 0; i < segments; i++) { const ph = (2 * Math.PI * i) / segments; verts.push([r * Math.cos(ph), r * Math.sin(ph), z]); }
  }
  const bottom = verts.length; verts.push([0, 0, -radius]);
  const id = (j, i) => 1 + (j - 1) * segments + (i % segments);
  const faces = [], seams = [];
  for (let i = 0; i < segments; i++) {
    faces.push(_face([0, id(1, i), id(1, i + 1)], [[(i + 0.5) / segments, 1], [i / segments, 1 - 1 / rings], [(i + 1) / segments, 1 - 1 / rings]]));
  }
  for (let j = 1; j < rings - 1; j++) for (let i = 0; i < segments; i++) {
    const v0 = 1 - j / rings, v1 = 1 - (j + 1) / rings;
    faces.push(_face([id(j, i), id(j + 1, i), id(j + 1, i + 1), id(j, i + 1)],
      [[i / segments, v0], [i / segments, v1], [(i + 1) / segments, v1], [(i + 1) / segments, v0]]));
  }
  for (let i = 0; i < segments; i++) {
    const v = 1 / rings;
    faces.push(_face([bottom, id(rings - 1, i + 1), id(rings - 1, i)], [[(i + 0.5) / segments, 0], [(i + 1) / segments, v], [i / segments, v]]));
  }
  seams.push(ekey(0, id(1, 0)), ekey(bottom, id(rings - 1, 0)));
  for (let j = 1; j < rings - 1; j++) seams.push(ekey(id(j, 0), id(j + 1, 0)));
  const m = _mesh(verts, faces, [], seams);
  m.smooth = true;
  return m;
}

export function primIcoSphere({ subdivisions = 2, radius = 1 } = {}) {
  subdivisions = Math.min(6, Math.max(1, subdivisions | 0));
  const t = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(vnorm);
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  // rotate so vertex 0 points to +Z
  const top = V[0];
  const axis = vnorm(vcross(top, [0, 0, 1])), ang = Math.acos(Math.max(-1, Math.min(1, top[2])));
  const rot = (p) => { // Rodrigues
    const c = Math.cos(ang), s = Math.sin(ang), k = axis, d = vdot(k, p), cr = vcross(k, p);
    return [p[0] * c + cr[0] * s + k[0] * d * (1 - c), p[1] * c + cr[1] * s + k[1] * d * (1 - c), p[2] * c + cr[2] * s + k[2] * d * (1 - c)];
  };
  V = V.map(rot);
  for (let s = 1; s < subdivisions; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const k = ekey(a, b);
      if (!cache.has(k)) { cache.set(k, V.length); V.push(vnorm(vadd(V[a], V[b]))); }
      return cache.get(k);
    };
    const NF = [];
    for (const [a, b, c] of F) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); NF.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    F = NF;
  }
  const verts = V.map((p) => vscale(p, radius));
  const sph = (p) => [Math.atan2(p[1], p[0]) / (2 * Math.PI) + 0.5, 0.5 + Math.asin(Math.max(-1, Math.min(1, p[2] / radius))) / Math.PI];
  const faces = F.map((tri) => {
    const uv = tri.map((i) => sph(verts[i]));
    const isPole = tri.map((i) => Math.abs(Math.abs(verts[i][2]) - radius) < 1e-6);
    const us = uv.filter((_, k) => !isPole[k]).map((u) => u[0]);
    if (us.length && Math.max(...us) - Math.min(...us) > 0.5) for (let k = 0; k < 3; k++) if (!isPole[k] && uv[k][0] < 0.5) uv[k][0] += 1;
    for (let k = 0; k < 3; k++) if (isPole[k]) { const o = uv.filter((_, q) => q !== k); uv[k][0] = (o[0][0] + o[1][0]) / 2; }
    return _face(tri, uv);
  });
  const m = _mesh(verts, faces);
  m.smooth = true;
  return m;
}

export function primCylinder({ verts: n = 32, radius = 1, depth = 2, cap = 'ngon' } = {}) {
  return primCone({ verts: n, radius1: radius, radius2: radius, depth, cap });
}

export function primCone({ verts: n = 32, radius1 = 1, radius2 = 0, depth = 2, cap = 'ngon' } = {}) {
  n = Math.max(3, n | 0);
  const h = depth / 2;
  const verts = [], faces = [], seams = [];
  const tip = radius2 <= 1e-9;
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; verts.push([Math.cos(a) * radius1, Math.sin(a) * radius1, -h]); }
  const B = (i) => i % n;
  let T;
  if (tip) { verts.push([0, 0, h]); T = () => n; }
  else { for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; verts.push([Math.cos(a) * radius2, Math.sin(a) * radius2, h]); } T = (i) => n + (i % n); }
  const circ = (cx, cy, r, i) => { const a = (2 * Math.PI * i) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  if (tip) {
    for (let i = 0; i < n; i++) faces.push(_face([B(i), B(i + 1), T(i)], [circ(0.25, 0.5, 0.24, i), circ(0.25, 0.5, 0.24, i + 1), [0.25, 0.5]]));
    seams.push(ekey(B(0), T(0)));
  } else {
    for (let i = 0; i < n; i++) faces.push(_face([B(i), B(i + 1), T(i + 1), T(i)], [[i / n, 0], [(i + 1) / n, 0], [(i + 1) / n, 0.5], [i / n, 0.5]]));
    seams.push(ekey(B(0), T(0)));
  }
  const ringB = [...Array(n).keys()];
  if (cap !== 'nothing') {
    for (let i = 0; i < n; i++) seams.push(ekey(B(i), B(i + 1)));
    if (!tip) for (let i = 0; i < n; i++) seams.push(ekey(T(i), T(i + 1)));
    const bc = tip ? [0.75, 0.5] : [0.25, 0.75], tc = [0.75, 0.75];
    // bottom uv mirrored so it reads correctly from below
    const buv = (i) => { const a = (2 * Math.PI * i) / n; return [bc[0] + Math.cos(a) * 0.24, bc[1] - Math.sin(a) * 0.24]; };
    if (cap === 'ngon') {
      faces.push(_face(ringB.slice().reverse(), ringB.slice().reverse().map(buv)));
      if (!tip) faces.push(_face(ringB.map((i) => T(i)), ringB.map((i) => circ(tc[0], tc[1], 0.24, i))));
    } else {
      const cb = verts.length; verts.push([0, 0, -h]);
      for (let i = 0; i < n; i++) faces.push(_face([B(i + 1), B(i), cb], [buv(i + 1), buv(i), bc.slice()]));
      if (!tip) {
        const ct = verts.length; verts.push([0, 0, h]);
        for (let i = 0; i < n; i++) faces.push(_face([T(i), T(i + 1), ct], [circ(tc[0], tc[1], 0.24, i), circ(tc[0], tc[1], 0.24, i + 1), tc.slice()]));
      }
    }
  }
  return _mesh(verts, faces, [], seams);
}

export function primTorus({ majorSegments = 48, minorSegments = 12, majorRadius = 1, minorRadius = 0.25 } = {}) {
  const M = Math.max(3, majorSegments | 0), N = Math.max(3, minorSegments | 0);
  const verts = [], faces = [], seams = [];
  for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) {
    const ph = (2 * Math.PI * i) / M, th = (2 * Math.PI * j) / N;
    const r = majorRadius + minorRadius * Math.cos(th);
    verts.push([r * Math.cos(ph), r * Math.sin(ph), minorRadius * Math.sin(th)]);
  }
  const id = (i, j) => (i % M) * N + (j % N);
  for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) {
    faces.push(_face([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)],
      [[i / M, j / N], [(i + 1) / M, j / N], [(i + 1) / M, (j + 1) / N], [i / M, (j + 1) / N]]));
  }
  for (let j = 0; j < N; j++) seams.push(ekey(id(0, j), id(0, j + 1)));
  for (let i = 0; i < M; i++) seams.push(ekey(id(i, 0), id(i + 1, 0)));
  const m = _mesh(verts, faces, [], seams);
  m.smooth = true;
  return m;
}

export const PRIMITIVES = {
  plane: { label: 'Plane', fn: primPlane, params: [{ k: 'size', label: 'Size', def: 2, min: 0.001, step: 0.1 }] },
  cube: { label: 'Cube', fn: primCube, params: [{ k: 'size', label: 'Size', def: 2, min: 0.001, step: 0.1 }] },
  circle: { label: 'Circle', fn: primCircle, params: [
    { k: 'verts', label: 'Vertices', def: 32, min: 3, max: 512, int: true },
    { k: 'radius', label: 'Radius', def: 1, min: 0.001, step: 0.1 },
    { k: 'fill', label: 'Fill Type', def: 'nothing', options: [['nothing', 'Nothing'], ['ngon', 'N-Gon'], ['fan', 'Triangle Fan']] }] },
  uvsphere: { label: 'UV Sphere', fn: primUVSphere, params: [
    { k: 'segments', label: 'Segments', def: 32, min: 3, max: 256, int: true },
    { k: 'rings', label: 'Rings', def: 16, min: 3, max: 256, int: true },
    { k: 'radius', label: 'Radius', def: 1, min: 0.001, step: 0.1 }] },
  icosphere: { label: 'Ico Sphere', fn: primIcoSphere, params: [
    { k: 'subdivisions', label: 'Subdivisions', def: 2, min: 1, max: 6, int: true },
    { k: 'radius', label: 'Radius', def: 1, min: 0.001, step: 0.1 }] },
  cylinder: { label: 'Cylinder', fn: primCylinder, params: [
    { k: 'verts', label: 'Vertices', def: 32, min: 3, max: 512, int: true },
    { k: 'radius', label: 'Radius', def: 1, min: 0.001, step: 0.1 },
    { k: 'depth', label: 'Depth', def: 2, min: 0.001, step: 0.1 },
    { k: 'cap', label: 'Cap Fill', def: 'ngon', options: [['nothing', 'Nothing'], ['ngon', 'N-Gon'], ['fan', 'Triangle Fan']] }] },
  cone: { label: 'Cone', fn: primCone, params: [
    { k: 'verts', label: 'Vertices', def: 32, min: 3, max: 512, int: true },
    { k: 'radius1', label: 'Radius 1', def: 1, min: 0, step: 0.1 },
    { k: 'radius2', label: 'Radius 2', def: 0, min: 0, step: 0.1 },
    { k: 'depth', label: 'Depth', def: 2, min: 0.001, step: 0.1 },
    { k: 'cap', label: 'Base Fill', def: 'ngon', options: [['nothing', 'Nothing'], ['ngon', 'N-Gon'], ['fan', 'Triangle Fan']] }] },
  torus: { label: 'Torus', fn: primTorus, params: [
    { k: 'majorSegments', label: 'Major Segments', def: 48, min: 3, max: 256, int: true },
    { k: 'minorSegments', label: 'Minor Segments', def: 12, min: 3, max: 256, int: true },
    { k: 'majorRadius', label: 'Major Radius', def: 1, min: 0.001, step: 0.1 },
    { k: 'minorRadius', label: 'Minor Radius', def: 0.25, min: 0.001, step: 0.05 }] },
  grid: { label: 'Grid', fn: primGrid, params: [
    { k: 'xSub', label: 'X Subdivisions', def: 10, min: 1, max: 256, int: true },
    { k: 'ySub', label: 'Y Subdivisions', def: 10, min: 1, max: 256, int: true },
    { k: 'size', label: 'Size', def: 2, min: 0.001, step: 0.1 }] },
};

// ---------- vertex removal / remapping ----------
export function removeVerts(m, vset) {
  const n = m.verts.length;
  const remap = new Int32Array(n);
  if (!vset || vset.size === 0) { for (let i = 0; i < n; i++) remap[i] = i; return remap; }
  m.faces = m.faces.filter((f) => !f.v.some((v) => vset.has(v)));
  m.looseEdges = m.looseEdges.filter((e) => !vset.has(e[0]) && !vset.has(e[1]));
  let j = 0;
  const nv = [];
  for (let i = 0; i < n; i++) { if (vset.has(i)) remap[i] = -1; else { remap[i] = j++; nv.push(m.verts[i]); } }
  m.verts = nv;
  for (const f of m.faces) f.v = f.v.map((v) => remap[v]);
  m.looseEdges = m.looseEdges.map((e) => [remap[e[0]], remap[e[1]]]);
  for (const tags of edgeTagSets(m)) {
    const next = new Set();
    for (const k of tags) { const [a, b] = ekeySplit(k); if (remap[a] >= 0 && remap[b] >= 0) next.add(ekey(remap[a], remap[b])); }
    tags.clear(); for (const k of next) tags.add(k);
  }
  touch(m);
  return remap;
}
function _usedVerts(m) {
  const used = new Uint8Array(m.verts.length);
  for (const f of m.faces) for (const v of f.v) used[v] = 1;
  for (const e of m.looseEdges) { used[e[0]] = 1; used[e[1]] = 1; }
  return used;
}
function _removeOrphans(m, candidates) {
  const used = _usedVerts(m);
  const rm = new Set();
  for (const v of candidates) if (!used[v]) rm.add(v);
  return removeVerts(m, rm);
}
function _mapSet(set, remap) { const s = new Set(); for (const v of set) { const r = remap[v]; if (r >= 0) s.add(r); } return s; }

// ---------- EXTRUDE ----------
// sel: {verts:Set, edges:Set<key>, faces:Set}; returns {verts:Set} new selection (vertex based) + normal
export function extrudeRegion(m, sel) {
  const T = topo(m);
  const F = sel.faces;
  const newOf = new Map();
  const dup = (v) => { let n = newOf.get(v); if (n === undefined) { n = m.verts.length; m.verts.push(m.verts[v].slice()); newOf.set(v, n); } return n; };
  const newFaces = [];
  const faceEdgeKeys = new Set();
  const normal = [0, 0, 0];
  for (const fi of F) {
    const f = m.faces[fi], n = f.v.length;
    const fn = faceNormalRaw(m, f); normal[0] += fn[0]; normal[1] += fn[1]; normal[2] += fn[2];
    for (let i = 0; i < n; i++) {
      const a = f.v[i], b = f.v[(i + 1) % n], k = ekey(a, b);
      faceEdgeKeys.add(k);
      const fs = T.edgeFaces[T.edgeIndex.get(k)];
      let cnt = 0; for (const g of fs) if (F.has(g)) cnt++;
      if (cnt === 1) {
        const a2 = dup(a), b2 = dup(b);
        newFaces.push(_face([a, b, b2, a2], [f.uv[i].slice(), f.uv[(i + 1) % n].slice(), f.uv[(i + 1) % n].slice(), f.uv[i].slice()], f.mat));
      }
    }
  }
  // seams inside the region follow the moved faces
  const tagAdd = edgeTagSets(m).map((tags) => [tags, [...tags].filter((k) => faceEdgeKeys.has(k)).map(ekeySplit)]);
  for (const fi of F) { const f = m.faces[fi]; f.v = f.v.map(dup); }
  for (const [tags, edges] of tagAdd) for (const [a, b] of edges) tags.add(ekey(newOf.get(a), newOf.get(b)));
  // lone edges
  const edgeVerts = new Set();
  for (const k of sel.edges) {
    const [a, b] = ekeySplit(k); edgeVerts.add(a); edgeVerts.add(b);
    if (faceEdgeKeys.has(k)) continue;
    const ei = T.edgeIndex.get(k); if (ei === undefined) continue;
    const fs = T.edgeFaces[ei];
    let first = a, second = b, ua = [0, 0], ub = [1, 0], mat = 0, wire = true;
    if (fs.length) {
      const f = m.faces[fs[0]], n = f.v.length; mat = f.mat; wire = false;
      for (let i = 0; i < n; i++) {
        if (f.v[i] === a && f.v[(i + 1) % n] === b) { first = b; second = a; }
      }
      ua = f.uv[f.v.indexOf(first)].slice(); ub = f.uv[f.v.indexOf(second)].slice();
    }
    const a2 = dup(first), b2 = dup(second);
    newFaces.push(_face([first, second, b2, a2], wire ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [ua, ub, ub.slice(), ua.slice()], mat));
  }
  for (const fi of F) for (const v of m.faces[fi].v) edgeVerts.add(v);
  for (const v of sel.verts) {
    if (edgeVerts.has(v) || newOf.has(v)) continue;
    const v2 = dup(v);
    m.looseEdges.push([v, v2]);
  }
  for (const f of newFaces) m.faces.push(f);
  touch(m);
  const remap = _removeOrphans(m, [...newOf.keys()]);
  cleanEdges(m);
  const out = new Set();
  for (const v of newOf.values()) if (remap[v] >= 0) out.add(remap[v]);
  return { verts: out, normal: vnorm(normal), hadFaces: F.size > 0 };
}

export function extrudeIndividual(m, F) {
  const out = new Set();
  for (const fi of F) {
    const f = m.faces[fi], n = f.v.length;
    const nv = f.v.map((v) => { m.verts.push(m.verts[v].slice()); return m.verts.length - 1; });
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      m.faces.push(_face([f.v[i], f.v[j], nv[j], nv[i]], [f.uv[i].slice(), f.uv[j].slice(), f.uv[j].slice(), f.uv[i].slice()], f.mat));
    }
    f.v = nv;
    for (const v of nv) out.add(v);
  }
  touch(m);
  return { verts: out };
}

// ---------- DUPLICATE ----------
export function duplicateSel(m, sel) {
  const map = new Map();
  const dup = (v) => { let n = map.get(v); if (n === undefined) { n = m.verts.length; m.verts.push(m.verts[v].slice()); map.set(v, n); } return n; };
  const fl = [...sel.faces];
  const faceEdge = new Set();
  for (const fi of fl) {
    const f = m.faces[fi];
    for (let i = 0; i < f.v.length; i++) faceEdge.add(ekey(f.v[i], f.v[(i + 1) % f.v.length]));
    m.faces.push(_face(f.v.map(dup), f.uv.map((u) => u.slice()), f.mat));
  }
  for (const k of sel.edges) if (!faceEdge.has(k)) { const [a, b] = ekeySplit(k); m.looseEdges.push([dup(a), dup(b)]); }
  for (const v of sel.verts) dup(v);
  for (const tags of edgeTagSets(m)) for (const k of [...tags]) { const [a, b] = ekeySplit(k); if (map.has(a) && map.has(b) && faceEdge.has(k)) tags.add(ekey(map.get(a), map.get(b))); }
  touch(m);
  return { verts: new Set(map.values()) };
}

// ---------- INSET ----------
// First collision of a simple polygon's moving inset boundary. Stop just
// before collapse instead of allowing a large drag to turn a concave n-gon
// inside out. Collinear corners (including knife-created vertices) are kept.
function _insetLimit(points, directions, normal) {
  const p = _project2D(points, normal), d = _project2D(directions, normal);
  const sub = (a,b) => [a[0]-b[0], a[1]-b[1]], cross = (a,b) => a[0]*b[1]-a[1]*b[0];
  let limit = Infinity;
  const roots = (a,b,c) => {
    if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c/b];
    const disc = b*b-4*a*c;
    if (disc < 0) return [];
    const q = -.5*(b + (b < 0 ? -1 : 1)*Math.sqrt(disc));
    return q ? [q/a, c/q] : [-b/(2*a)];
  };
  for (let j=0; j<p.length; j++) {
    const k=(j+1)%p.length, e=sub(p[k],p[j]), de=sub(d[k],d[j]);
    const l2=e[0]*e[0]+e[1]*e[1], shrink=e[0]*de[0]+e[1]*de[1];
    if (shrink < -1e-12) limit=Math.min(limit, -l2/shrink);
    for (let i=0; i<p.length; i++) if (i!==j && i!==k) {
      const v=sub(p[i],p[j]), dv=sub(d[i],d[j]);
      for (const t of roots(cross(de,dv), cross(de,v)+cross(e,dv), cross(e,v))) {
        if (!(t>1e-10 && t<limit)) continue;
        const edge=[e[0]+t*de[0],e[1]+t*de[1]], rel=[v[0]+t*dv[0],v[1]+t*dv[1]];
        const dot=rel[0]*edge[0]+rel[1]*edge[1], len=edge[0]*edge[0]+edge[1]*edge[1];
        if (dot>=-1e-10 && dot<=len+1e-10) limit=t;
      }
    }
  }
  return limit * .999999;
}
function _insetUV(m, face, triangles, point) {
  let best=null, penalty=Infinity;
  for (const tri of triangles) {
    const [a,b,c]=tri.map(i=>m.verts[face.v[i]]), u=vsub(b,a), v=vsub(c,a), q=vsub(point,a);
    const uu=vdot(u,u), uv=vdot(u,v), vv=vdot(v,v), qu=vdot(q,u), qv=vdot(q,v), den=uu*vv-uv*uv;
    if (Math.abs(den)<1e-20) continue;
    const y=(vv*qu-uv*qv)/den, z=(uu*qv-uv*qu)/den, weights=[1-y-z,y,z];
    const cost=weights.reduce((s,w)=>s+Math.max(0,-w),0);
    if (cost<penalty) { penalty=cost; best=[0,1].map(k=>weights.reduce((s,w,i)=>s+w*face.uv[tri[i]][k],0)); }
    if (cost<1e-10) break;
  }
  return best || face.uv[0].slice();
}
export function inset(m, F, thickness, depth = 0, individual = false) {
  F = new Set([...F].filter(fi => m.faces[fi]));
  if (!Number.isFinite(thickness) || !Number.isFinite(depth)) return {faces: F, clamped: false};
  thickness = Math.max(0, thickness);
  if (!thickness && !depth) return {faces: F, clamped: false};
  let clamped = false;
  if (individual) {
    for (const fi of F) clamped = _insetRegion(m, new Set([fi]), thickness, depth) || clamped;
  } else clamped = !!_insetRegion(m, F, thickness, depth);
  touch(m);
  return { faces: new Set(F), clamped };
}
function _insetRegion(m, F, thickness, depth) {
  const single = F.size === 1;
  const T = single ? null : topo(m);
  const P = m.verts;
  const fnorm = new Map();
  for (const fi of F) fnorm.set(fi, faceNormal(m, m.faces[fi]));
  const bnd = []; // {a,b,fi,i}
  for (const fi of F) {
    const f = m.faces[fi], n = f.v.length;
    for (let i = 0; i < n; i++) {
      const a = f.v[i], b = f.v[(i + 1) % n];
      let cnt = 1;
      if (!single) { cnt = 0; for (const g of T.edgeFaces[T.edgeIndex.get(ekey(a, b))]) if (F.has(g)) cnt++; }
      if (cnt === 1) bnd.push({ a, b, fi, i });
    }
  }
  if (!bnd.length) return;
  const inw = new Map(); // v -> [inward vectors]
  const vnormal = new Map();
  const push = (v, d) => { if (!inw.has(v)) inw.set(v, []); inw.get(v).push(d); };
  for (const e of bnd) {
    const n = fnorm.get(e.fi);
    const d = vnorm(vcross(n, vsub(P[e.b], P[e.a])));
    push(e.a, d); push(e.b, d);
  }
  // vertex normals within region (for depth)
  for (const fi of F) for (const v of m.faces[fi].v) {
    const n = fnorm.get(fi);
    const acc = vnormal.get(v) || [0, 0, 0];
    vnormal.set(v, vadd(acc, n));
  }
  const newV = new Map(), directions = new Map();
  for (const [v, list] of inw) {
    let d;
    if (list.length === 2) {
      const s = vadd(list[0], list[1]);
      const l = vlen(s);
      if (l < 1e-6) d = list[0];
      else { d = vscale(s, 2 / (l*l)); }
    } else {
      d = vnorm(list.reduce((acc, x) => vadd(acc, x), [0, 0, 0]));
    }
    directions.set(v, d);
  }
  let clamped = false;
  if (single) {
    const fi = [...F][0], f = m.faces[fi];
    const limit = _insetLimit(f.v.map(v=>P[v]), f.v.map(v=>directions.get(v)), fnorm.get(fi));
    if (thickness > limit) { thickness = limit; clamped = true; }
  }
  const flat = new Map();
  for (const [v, d] of directions) {
    const nn = vnorm(vnormal.get(v) || [0, 0, 1]);
    flat.set(v, vadd(P[v], vscale(d, thickness)));
    const p = vadd(vadd(P[v], vscale(d, thickness)), vscale(nn, depth));
    newV.set(v, P.length); P.push(p);
  }
  // Interpolate UVs on each original face before remapping its corners. This
  // follows the texture on concave faces instead of pulling toward a centroid
  // which may lie outside the n-gon. Depth must not shrink the UVs.
  const origUV = new Map();
  for (const fi of F) {
    const f = m.faces[fi];
    origUV.set(fi, f.uv.map((u) => u.slice()));
    const triangles = triangulateFace(m, f);
    const uv = f.v.map((v,i) => newV.has(v) ? _insetUV(m, f, triangles, flat.get(v)) : f.uv[i].slice());
    f.v = f.v.map(v => newV.get(v) ?? v); f.uv = uv;
  }
  // Move interior vertices only after sampling UVs on the original surface.
  if (depth) for (const [v, n] of vnormal) if (!newV.has(v)) P[v] = vadd(P[v], vscale(vnorm(n), depth));
  for (const e of bnd) {
    const f = m.faces[e.fi], n = f.v.length, ou = origUV.get(e.fi);
    const j = (e.i + 1) % n;
    m.faces.push(_face([e.a, e.b, newV.get(e.b), newV.get(e.a)], [ou[e.i].slice(), ou[j].slice(), f.uv[j].slice(), f.uv[e.i].slice()], f.mat));
  }
  touch(m);
  return clamped;
}

// ---------- EDGE RING / LOOP CUT ----------
export function edgeRing(m, startKey) {
  const T = topo(m);
  const ei0 = T.edgeIndex.get(startKey);
  if (ei0 === undefined) return null;
  const [a0, b0] = ekeySplit(startKey);
  const opp = (fi, s, t) => {
    const v = m.faces[fi].v; const i = v.indexOf(s), j = v.indexOf(t);
    const sp = v[(i + 1) % 4] === t ? v[(i + 3) % 4] : v[(i + 1) % 4];
    const tp = v[(j + 1) % 4] === s ? v[(j + 3) % 4] : v[(j + 1) % 4];
    return [sp, tp];
  };
  const walk = (s, t, f) => {
    const edges = [], faces = [], seen = new Set([startKey]);
    let guard = 0;
    while (f >= 0 && m.faces[f].v.length === 4 && guard++ < 100000) {
      const [ns, nt] = opp(f, s, t);
      const k = ekey(ns, nt);
      faces.push(f);
      if (k === startKey) return { edges, faces, closed: true };
      if (seen.has(k)) return { edges, faces: faces.slice(0, -1), closed: false };
      seen.add(k);
      edges.push([ns, nt]);
      const fs = T.edgeFaces[T.edgeIndex.get(k)];
      let nf = -1; for (const g of fs) if (g !== f) { nf = g; break; }
      if (fs.length > 2) nf = -1;
      s = ns; t = nt; f = nf;
    }
    return { edges, faces, closed: false };
  };
  const fs0 = T.edgeFaces[ei0];
  if (fs0.length > 2) return { edges: [[a0, b0]], faces: [], closed: false };
  const fw = fs0.length ? walk(a0, b0, fs0[0]) : { edges: [], faces: [], closed: false };
  if (fw.closed) return { edges: [[a0, b0], ...fw.edges], faces: fw.faces, closed: true };
  const bw = fs0.length > 1 ? walk(a0, b0, fs0[1]) : { edges: [], faces: [], closed: false };
  // avoid overlap when backward walk revisits forward edges
  const fwKeys = new Set(fw.edges.map(([s, t]) => ekey(s, t)));
  let cut = bw.edges.findIndex(([s, t]) => fwKeys.has(ekey(s, t)));
  const bwE = cut >= 0 ? bw.edges.slice(0, cut) : bw.edges;
  const bwF = cut >= 0 ? bw.faces.slice(0, cut) : bw.faces;
  return { edges: [...bwE.slice().reverse(), [a0, b0], ...fw.edges], faces: [...bwF.slice().reverse(), ...fw.faces], closed: false };
}

export function loopCut(m, ring, cuts = 1, slide = 0) {
  if (!ring || !ring.edges.length) return { verts: new Set() };
  cuts = Math.max(1, cuts | 0);
  const E = ring.edges, Fs = ring.faces, P = m.verts;
  const facs = [];
  for (let k = 1; k <= cuts; k++) facs.push(cuts === 1 ? Math.min(0.999, Math.max(0.001, 0.5 + slide * 0.5)) : k / (cuts + 1));
  const newV = E.map(([s, t]) => facs.map((fc) => { P.push(vlerp(P[s], P[t], fc)); return P.length - 1; }));
  const out = new Set(); for (const arr of newV) for (const v of arr) out.add(v);
  const ringFaceSet = new Set(Fs);
  // split ring faces
  for (let k = 0; k < Fs.length; k++) {
    const fi = Fs[k];
    const e1 = E[k], e2 = E[(k + 1) % E.length], m1 = newV[k], m2 = newV[(k + 1) % E.length];
    const f = m.faces[fi];
    const uvOf = (v) => f.uv[f.v.indexOf(v)];
    const rails = [[e1[0], e2[0], uvOf(e1[0]), uvOf(e2[0])]];
    for (let j = 0; j < cuts; j++) rails.push([m1[j], m2[j], uvlerp(uvOf(e1[0]), uvOf(e1[1]), facs[j]), uvlerp(uvOf(e2[0]), uvOf(e2[1]), facs[j])]);
    rails.push([e1[1], e2[1], uvOf(e1[1]), uvOf(e2[1])]);
    const i1 = f.v.indexOf(e1[0]);
    const forward = f.v[(i1 + 1) % 4] === e1[1];
    const mat = f.mat;
    const nf = [];
    for (let j = 0; j <= cuts; j++) {
      const r0 = rails[j], r1 = rails[j + 1];
      let v = [r0[0], r1[0], r1[1], r0[1]], uv = [r0[2], r1[2], r1[3], r0[3]];
      if (!forward) { v.reverse(); uv.reverse(); }
      nf.push(_face(v, uv.map((u) => u.slice()), mat));
    }
    m.faces[fi] = nf[0];
    for (let j = 1; j < nf.length; j++) m.faces.push(nf[j]);
  }
  // terminal edges: insert new verts into neighbouring non-ring faces
  if (!ring.closed) {
    const terms = [[0, Fs[0]], [E.length - 1, Fs[Fs.length - 1]]];
    const done = new Set();
    for (const [ei, rf] of terms) {
      if (done.has(ei)) continue; done.add(ei);
      const [s, t] = E[ei];
      for (let gi = 0; gi < m.faces.length; gi++) {
        if (ringFaceSet.has(gi)) continue;
        const g = m.faces[gi], n = g.v.length;
        for (let i = 0; i < n; i++) {
          const a = g.v[i], b = g.v[(i + 1) % n];
          if ((a === s && b === t) || (a === t && b === s)) {
            const seq = a === s ? newV[ei].slice() : newV[ei].slice().reverse();
            const fseq = a === s ? facs.slice() : facs.slice().reverse().map((x) => x);
            const ua = g.uv[i], ub = g.uv[(i + 1) % n];
            const insUV = seq.map((_, q) => { const fc = a === s ? fseq[q] : 1 - fseq[q]; return uvlerp(ua, ub, fc); });
            g.v.splice(i + 1, 0, ...seq);
            g.uv.splice(i + 1, 0, ...insUV);
            break;
          }
        }
      }
    }
  }
  // split seams
  E.forEach(([s, t], i) => {
    const k = ekey(s, t);
    for (const tags of edgeTagSets(m)) if (tags.has(k)) { tags.delete(k); const chain = [s, ...newV[i], t]; for (let q = 0; q < chain.length - 1; q++) tags.add(ekey(chain[q], chain[q + 1])); }
  });
  touch(m);
  return { verts: out };
}

// ---------- SUBDIVIDE ----------
export function subdivide(m, F) {
  const P = m.verts;
  const mid = new Map();
  const midOf = (a, b) => { const k = ekey(a, b); let i = mid.get(k); if (i === undefined) { i = P.length; P.push(vlerp(P[a], P[b], 0.5)); mid.set(k, i); } return i; };
  for (const fi of F) { const v = m.faces[fi].v; for (let i = 0; i < v.length; i++) midOf(v[i], v[(i + 1) % v.length]); }
  m.faces.forEach((f, fi) => {
    if (F.has(fi)) return;
    const nv = [], nu = [];
    let changed = false;
    for (let i = 0; i < f.v.length; i++) {
      const j = (i + 1) % f.v.length;
      nv.push(f.v[i]); nu.push(f.uv[i]);
      const k = ekey(f.v[i], f.v[j]);
      if (mid.has(k)) { nv.push(mid.get(k)); nu.push(uvlerp(f.uv[i], f.uv[j], 0.5)); changed = true; }
    }
    if (changed) { f.v = nv; f.uv = nu; }
  });
  const out = new Set();
  const addFace = (fi, face, first) => { if (first) { m.faces[fi] = face; out.add(fi); } else { m.faces.push(face); out.add(m.faces.length - 1); } };
  for (const fi of [...F]) {
    const f = m.faces[fi], n = f.v.length, v = f.v, uv = f.uv;
    const mi = [], mu = [];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; mi.push(mid.get(ekey(v[i], v[j]))); mu.push(uvlerp(uv[i], uv[j], 0.5)); }
    if (n === 3) {
      addFace(fi, _face([v[0], mi[0], mi[2]], [uv[0], mu[0], mu[2]].map((u) => u.slice()), f.mat), true);
      addFace(fi, _face([v[1], mi[1], mi[0]], [uv[1], mu[1], mu[0]].map((u) => u.slice()), f.mat), false);
      addFace(fi, _face([v[2], mi[2], mi[1]], [uv[2], mu[2], mu[1]].map((u) => u.slice()), f.mat), false);
      addFace(fi, _face([mi[0], mi[1], mi[2]], [mu[0], mu[1], mu[2]].map((u) => u.slice()), f.mat), false);
    } else {
      const c = P.length; P.push(faceCenter(m, f));
      const cu = [0, 0]; for (const u of uv) { cu[0] += u[0] / n; cu[1] += u[1] / n; }
      for (let i = 0; i < n; i++) {
        const p = (i + n - 1) % n;
        addFace(fi, _face([v[i], mi[i], c, mi[p]], [uv[i].slice(), mu[i].slice(), cu.slice(), mu[p].slice()], f.mat), i === 0);
      }
    }
  }
  for (const tags of edgeTagSets(m)) for (const k of [...tags]) if (mid.has(k)) { const [a, b] = ekeySplit(k); const c = mid.get(k); tags.delete(k); tags.add(ekey(a, c)); tags.add(ekey(c, b)); }
  // loose edges that got a midpoint
  m.looseEdges = m.looseEdges.flatMap(([a, b]) => { const k = ekey(a, b); return mid.has(k) ? [[a, mid.get(k)], [mid.get(k), b]] : [[a, b]]; });
  touch(m);
  return { faces: out };
}

// ---------- MERGE ----------
// map: Map<old, target>. Applies, drops degenerate faces, removes merged-away verts.
export function applyVertMap(m, map) {
  const tgt = (v) => (map.has(v) ? map.get(v) : v);
  const keep = [];
  const seen = new Set();
  for (const f of m.faces) {
    const nv = [], nu = [];
    for (let i = 0; i < f.v.length; i++) {
      const v = tgt(f.v[i]);
      if (nv.length && nv[nv.length - 1] === v) continue;
      nv.push(v); nu.push(f.uv[i]);
    }
    while (nv.length > 1 && nv[0] === nv[nv.length - 1]) { nv.pop(); nu.pop(); }
    if (new Set(nv).size < 3 || new Set(nv).size !== nv.length) {
      // degenerate (or pinched) faces: keep as loose edges so wires survive
      for (let i = 0; i < nv.length; i++) { const a = nv[i], b = nv[(i + 1) % nv.length]; if (a !== b) m.looseEdges.push([a, b]); }
      continue;
    }
    const sig = nv.slice().sort((a, b) => a - b).join(',');
    if (seen.has(sig)) continue;
    seen.add(sig);
    f.v = nv; f.uv = nu; keep.push(f);
  }
  m.faces = keep;
  m.looseEdges = m.looseEdges.map(([a, b]) => [tgt(a), tgt(b)]);
  for (const tags of edgeTagSets(m)) {
    const next = new Set();
    for (const k of tags) { const [a, b] = ekeySplit(k); const ta = tgt(a), tb = tgt(b); if (ta !== tb) next.add(ekey(ta, tb)); }
    tags.clear(); for (const k of next) tags.add(k);
  }
  touch(m);
  const rm = new Set(); for (const [v, t] of map) if (v !== t) rm.add(v);
  const remap = removeVerts(m, rm);
  cleanEdges(m);
  return remap;
}
export function mergeAt(m, vset, point) {
  const vs = [...vset];
  if (vs.length < 2) return null;
  const target = Math.min(...vs);
  m.verts[target] = point.slice();
  const map = new Map(); for (const v of vs) map.set(v, target);
  const remap = applyVertMap(m, map);
  return { verts: new Set([remap[target]]) };
}
export function mergeCollapse(m, sel) {
  // connected components of selected verts through selected edges
  const parent = new Map(); for (const v of sel.verts) parent.set(v, v);
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const k of sel.edges) { const [a, b] = ekeySplit(k); if (parent.has(a) && parent.has(b)) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); } }
  const groups = new Map();
  for (const v of sel.verts) { const r = find(v); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(v); }
  const map = new Map(); const targets = [];
  for (const g of groups.values()) {
    const c = [0, 0, 0]; for (const v of g) { c[0] += m.verts[v][0]; c[1] += m.verts[v][1]; c[2] += m.verts[v][2]; }
    const t = Math.min(...g); m.verts[t] = vscale(c, 1 / g.length);
    for (const v of g) map.set(v, t);
    targets.push(t);
  }
  const remap = applyVertMap(m, map);
  return { verts: new Set(targets.map((t) => remap[t]).filter((x) => x >= 0)) };
}
export function mergeByDistance(m, vset, dist = 0.0001) {
  const vs = [...vset].sort((a, b) => a - b);
  const cell = Math.max(dist, 1e-9);
  const grid = new Map();
  const key = (p) => Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell) + ',' + Math.floor(p[2] / cell);
  const map = new Map();
  let removed = 0;
  for (const v of vs) {
    const p = m.verts[v];
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++) for (let dy = -1; dy <= 1 && found < 0; dy++) for (let dz = -1; dz <= 1 && found < 0; dz++) {
      const list = grid.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz));
      if (!list) continue;
      for (const u of list) if (vlen(vsub(m.verts[u], p)) <= dist) { found = u; break; }
    }
    if (found >= 0) { map.set(v, found); removed++; }
    else { const k = key(p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(v); }
  }
  if (!removed) return { removed: 0, verts: new Set(vset) };
  const remap = applyVertMap(m, map);
  const out = new Set(); for (const v of vs) { const t = map.has(v) ? map.get(v) : v; if (remap[t] >= 0) out.add(remap[t]); }
  return { removed, verts: out };
}

// ---------- DELETE / DISSOLVE ----------
export function deleteVerts(m, vset) { removeVerts(m, vset); }
export function deleteEdges(m, ekeys) {
  const cand = new Set();
  for (const k of ekeys) { const [a, b] = ekeySplit(k); cand.add(a); cand.add(b); }
  m.faces = m.faces.filter((f) => { for (let i = 0; i < f.v.length; i++) if (ekeys.has(ekey(f.v[i], f.v[(i + 1) % f.v.length]))) return false; return true; });
  m.looseEdges = m.looseEdges.filter(([a, b]) => !ekeys.has(ekey(a, b)));
  touch(m);
  _removeOrphans(m, cand);
  cleanEdges(m);
}
export function deleteFaces(m, fset, mode = 'faces') {
  const cand = new Set();
  const removedEdges = new Set();
  m.faces.forEach((f, fi) => { if (fset.has(fi)) for (let i = 0; i < f.v.length; i++) { cand.add(f.v[i]); removedEdges.add(ekey(f.v[i], f.v[(i + 1) % f.v.length])); } });
  m.faces = m.faces.filter((_, fi) => !fset.has(fi));
  touch(m);
  if (mode === 'only_faces') {
    const T = topo(m);
    for (const k of removedEdges) if (!T.edgeIndex.has(k)) { const [a, b] = ekeySplit(k); m.looseEdges.push([a, b]); }
    cleanEdges(m);
    return;
  }
  _removeOrphans(m, cand);
  cleanEdges(m);
}
export function deleteEdgesFaces(m, ekeys, fset) {
  m.faces = m.faces.filter((f, fi) => {
    if (fset.has(fi)) return false;
    for (let i = 0; i < f.v.length; i++) if (ekeys.has(ekey(f.v[i], f.v[(i + 1) % f.v.length]))) return false;
    return true;
  });
  m.looseEdges = m.looseEdges.filter(([a, b]) => !ekeys.has(ekey(a, b)));
  // keep remaining face boundary edges that were not selected as wires
  touch(m);
  cleanEdges(m);
}

// merge a connected set of faces into one n-gon if it has exactly one boundary loop
function _dissolveRegion(m, region) {
  const dir = new Map(); // a -> {b, fi, i}
  const cnt = new Map();
  for (const fi of region) {
    const f = m.faces[fi], n = f.v.length;
    for (let i = 0; i < n; i++) { const k = ekey(f.v[i], f.v[(i + 1) % n]); cnt.set(k, (cnt.get(k) || 0) + 1); }
  }
  let edgesN = 0;
  for (const fi of region) {
    const f = m.faces[fi], n = f.v.length;
    for (let i = 0; i < n; i++) {
      const a = f.v[i], b = f.v[(i + 1) % n];
      if (cnt.get(ekey(a, b)) === 1) { if (dir.has(a)) return null; dir.set(a, { b, uv: f.uv[i], mat: f.mat }); edgesN++; }
    }
  }
  if (!edgesN) return null;
  const start = dir.keys().next().value;
  const loop = [], uvs = [];
  let cur = start, guard = 0, mat = 0;
  do {
    const d = dir.get(cur); if (!d) return null;
    loop.push(cur); uvs.push(d.uv.slice()); mat = d.mat; cur = d.b;
  } while (cur !== start && guard++ < 100000);
  if (loop.length !== edgesN || loop.length < 3) return null;
  return _face(loop, uvs, mat);
}
function _faceComponents(m, fset, viaEdge) {
  const T = topo(m);
  const seen = new Set(), comps = [];
  for (const f0 of fset) {
    if (seen.has(f0)) continue;
    const comp = [], st = [f0]; seen.add(f0);
    while (st.length) {
      const fi = st.pop(); comp.push(fi);
      const v = m.faces[fi].v;
      for (let i = 0; i < v.length; i++) {
        const k = ekey(v[i], v[(i + 1) % v.length]);
        if (viaEdge && !viaEdge(k)) continue;
        for (const g of T.edgeFaces[T.edgeIndex.get(k)]) if (fset.has(g) && !seen.has(g)) { seen.add(g); st.push(g); }
      }
    }
    comps.push(comp);
  }
  return comps;
}
export function dissolveFaces(m, fset) {
  const comps = _faceComponents(m, fset);
  const remove = new Set(), add = [];
  let failed = 0;
  for (const c of comps) {
    if (c.length < 2) continue;
    const nf = _dissolveRegion(m, c);
    if (!nf) { failed++; continue; }
    for (const fi of c) remove.add(fi);
    add.push(nf);
  }
  const cand = new Set(); for (const fi of remove) for (const v of m.faces[fi].v) cand.add(v);
  m.faces = m.faces.filter((_, fi) => !remove.has(fi));
  const start = m.faces.length;
  for (const f of add) m.faces.push(f);
  touch(m);
  const out = new Set(); for (let i = start; i < m.faces.length; i++) out.add(i);
  // remove interior verts no longer used
  const used = _usedVerts(m);
  const rm = new Set(); for (const v of cand) if (!used[v]) rm.add(v);
  const before = m.faces.length;
  removeVerts(m, rm);
  cleanEdges(m);
  return { faces: out, failed, count: before };
}
export function dissolveEdges(m, ekeys) {
  const T = topo(m);
  // union faces across selected manifold edges
  const fset = new Set();
  for (const k of ekeys) { const ei = T.edgeIndex.get(k); if (ei === undefined) continue; const fs = T.edgeFaces[ei]; if (fs.length === 2) { fset.add(fs[0]); fset.add(fs[1]); } }
  const comps = _faceComponents(m, fset, (k) => ekeys.has(k));
  const remove = new Set(), add = [];
  for (const c of comps) {
    if (c.length < 2) continue;
    const nf = _dissolveRegion(m, c);
    if (!nf) continue;
    for (const fi of c) remove.add(fi);
    add.push(nf);
  }
  const cand = new Set(); for (const fi of remove) for (const v of m.faces[fi].v) cand.add(v);
  const ends = new Set(); for (const k of ekeys) { const [a, b] = ekeySplit(k); ends.add(a); ends.add(b); }
  m.faces = m.faces.filter((_, fi) => !remove.has(fi));
  for (const f of add) m.faces.push(f);
  m.looseEdges = m.looseEdges.filter(([a, b]) => !ekeys.has(ekey(a, b)));
  touch(m);
  // dissolve now 2-valent verts that sat on the dissolved edges
  const T2 = topo(m);
  const chain = new Set();
  for (const v of ends) if (T2.vertEdges[v] && T2.vertEdges[v].length === 2 && T2.vertFaces[v].length > 0) chain.add(v);
  _removeChainVerts(m, chain);
  const used = _usedVerts(m);
  const rm = new Set(); for (const v of cand) if (v < used.length && !used[v]) rm.add(v);
  removeVerts(m, rm);
  cleanEdges(m);
}
function _removeChainVerts(m, vset) {
  if (!vset.size) return;
  for (const f of m.faces) {
    if (!f.v.some((v) => vset.has(v))) continue;
    const nv = [], nu = [];
    f.v.forEach((v, i) => { if (!vset.has(v)) { nv.push(v); nu.push(f.uv[i]); } });
    if (nv.length >= 3) { f.v = nv; f.uv = nu; }
  }
  touch(m);
}
export function dissolveVerts(m, vset) {
  // one vertex at a time on fresh topology, so neighbouring dissolves see each other's results
  const handled = new Set();
  for (const v of [...vset].sort((x, y) => x - y)) {
    const T = topo(m);
    if (v >= m.verts.length) continue;
    const ve = T.vertEdges[v], fs = T.vertFaces[v];
    if (ve.length === 2) {
      if (!fs.length) {
        const [e1, e2] = ve.map((e) => T.edges[e]);
        const a = e1[0] === v ? e1[1] : e1[0], b = e2[0] === v ? e2[1] : e2[0];
        m.looseEdges = m.looseEdges.filter((e) => e[0] !== v && e[1] !== v);
        if (a !== b) m.looseEdges.push([a, b]);
        handled.add(v); touch(m); continue;
      }
      if (!fs.every((fi) => m.faces[fi].v.length > 3)) continue;
      for (const fi of fs) { const f = m.faces[fi]; const i = f.v.indexOf(v); f.v.splice(i, 1); f.uv.splice(i, 1); }
      handled.add(v); touch(m); continue;
    }
    if (fs.length < 2 || ve.some((e) => T.edgeFaces[e].length !== 2)) continue;
    const nf = _dissolveRegion(m, fs);
    if (!nf || nf.v.includes(v)) continue;
    const rmF = new Set(fs);
    m.faces = m.faces.filter((_, i) => !rmF.has(i));
    m.faces.push(nf);
    handled.add(v); touch(m);
  }
  const used = _usedVerts(m);
  removeVerts(m, new Set([...handled].filter((v) => !used[v])));
  cleanEdges(m);
}

// ---------- FILL / GRID FILL / BRIDGE ----------
function _openLoops(m, sel) {
  const T = topo(m);
  const keys = [...sel.edges].filter((k) => { const ei = T.edgeIndex.get(k); return ei !== undefined && T.edgeFaces[ei].length < 2; });
  const adj = new Map();
  const addAdj = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
  for (const k of keys) { const [a, b] = ekeySplit(k); addAdj(a, b); addAdj(b, a); }
  const seen = new Set(), loops = [];
  for (const s of adj.keys()) {
    if (seen.has(s)) continue;
    // component
    const comp = [], st = [s]; seen.add(s);
    while (st.length) { const v = st.pop(); comp.push(v); for (const w of adj.get(v)) if (!seen.has(w)) { seen.add(w); st.push(w); } }
    const deg = (v) => adj.get(v).length;
    if (comp.some((v) => deg(v) > 2)) { loops.push({ bad: true }); continue; }
    const ends = comp.filter((v) => deg(v) === 1);
    const start = ends.length ? ends[0] : comp[0];
    const order = [start];
    let prev = -1, cur = start;
    while (true) {
      const nx = adj.get(cur).find((w) => w !== prev && (order.length < 2 || w !== order[order.length - 2]));
      if (nx === undefined || nx === start) break;
      if (order.includes(nx)) break;
      order.push(nx); prev = cur; cur = nx;
    }
    loops.push({ verts: order, closed: ends.length === 0 });
  }
  return loops;
}
// orient a loop so a new face along it matches neighbouring face windings (or faces the viewer)
function _orientLoop(m, loop, viewDir) {
  const T = topo(m);
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    const ei = T.edgeIndex.get(ekey(a, b));
    if (ei === undefined) continue;
    for (const fi of T.edgeFaces[ei]) {
      const v = m.faces[fi].v, L = v.length;
      for (let j = 0; j < L; j++) {
        if (v[j] === a && v[(j + 1) % L] === b) return loop.slice().reverse();
        if (v[j] === b && v[(j + 1) % L] === a) return loop;
      }
    }
  }
  if (viewDir) {
    const nrm = faceNormalRaw(m, { v: loop });
    if (vdot(nrm, viewDir) > 0) return loop.slice().reverse();
  }
  return loop;
}
function _planarUV(m, vids) {
  const f = { v: vids };
  const n = faceNormal(m, f);
  const ref = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const ax = vnorm(vcross(ref, n)), ay = vcross(n, ax);
  const pts = vids.map((i) => [vdot(m.verts[i], ax), vdot(m.verts[i], ay)]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const s = Math.max(x1 - x0, y1 - y0) || 1;
  return pts.map((p) => [(p[0] - x0) / s, (p[1] - y0) / s]);
}
function _sortVertsPlanar(m, vids) {
  const c = [0, 0, 0]; for (const v of vids) { c[0] += m.verts[v][0]; c[1] += m.verts[v][1]; c[2] += m.verts[v][2]; }
  const cc = vscale(c, 1 / vids.length);
  // normal via covariance (smallest eigenvector by inverse-ish power iteration on trace*I - C)
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const v of vids) { const d = vsub(m.verts[v], cc); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
  const tr = C[0][0] + C[1][1] + C[2][2] + 1e-9;
  const A = C.map((r, i) => r.map((x, j) => (i === j ? tr : 0) - x));
  let n = [0.3, 0.5, 0.8];
  for (let it = 0; it < 50; it++) n = vnorm([vdot(A[0], n), vdot(A[1], n), vdot(A[2], n)]);
  const ref = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const ax = vnorm(vcross(ref, n)), ay = vcross(n, ax);
  return vids.slice().sort((p, q) => {
    const dp = vsub(m.verts[p], cc), dq = vsub(m.verts[q], cc);
    return Math.atan2(vdot(dp, ay), vdot(dp, ax)) - Math.atan2(vdot(dq, ay), vdot(dq, ax));
  });
}
export function fill(m, sel, mode = 'ngon', viewDir = null) {
  const T = topo(m);
  const loops = _openLoops(m, sel);
  const good = loops.filter((l) => !l.bad && l.verts.length >= 3);
  if (!good.length) {
    const vs = [...sel.verts];
    if (vs.length === 2) {
      if (T.edgeIndex.has(ekey(vs[0], vs[1]))) return { ok: false, msg: 'These vertices already share an edge' };
      m.looseEdges.push([vs[0], vs[1]]); touch(m);
      return { ok: true, verts: new Set(vs) };
    }
    if (vs.length >= 3 && sel.edges.size === 0) {
      const loop = _orientLoop(m, _sortVertsPlanar(m, vs), viewDir);
      return _fillLoops(m, [loop], mode);
    }
    if (loops.some((l) => l.bad)) return { ok: false, msg: 'Selected edges branch; select a single open loop' };
    return { ok: false, msg: 'Select an open edge loop, or 2+ vertices' };
  }
  const oriented = good.map((l) => _orientLoop(m, l.verts, viewDir));
  return _fillLoops(m, oriented, mode);
}
function _fillLoops(m, loops, mode) {
  const out = new Set();
  for (const loop of loops) {
    const uv = _planarUV(m, loop);
    if (mode === 'tri' && loop.length > 3) {
      const tris = triangulateFace(m, { v: loop });
      for (const t of tris) { m.faces.push(_face(t.map((c) => loop[c]), t.map((c) => uv[c].slice()))); out.add(m.faces.length - 1); }
    } else { m.faces.push(_face(loop.slice(), uv)); out.add(m.faces.length - 1); }
  }
  touch(m); cleanEdges(m);
  return { ok: true, faces: out };
}

export function gridFill(m, sel, span = 0, offset = 0, viewDir = null) {
  const loops = _openLoops(m, sel).filter((l) => !l.bad);
  if (loops.length !== 1 || !loops[0].closed) return { ok: false, msg: 'Grid Fill needs one closed loop of boundary edges' };
  let loop = _orientLoop(m, loops[0].verts, viewDir);
  const N = loop.length;
  if (N < 4 || N % 2) return { ok: false, msg: `Grid Fill needs an even number of edges (loop has ${N})` };
  const half = N / 2;
  let a = span > 0 ? Math.min(half - 1, Math.max(1, span | 0)) : Math.max(1, Math.round(N / 4));
  if (a >= half) a = half - 1;
  const b = half - a;
  const off = ((offset | 0) % N + N) % N;
  loop = loop.slice(off).concat(loop.slice(0, off));
  const P = m.verts;
  const Bv = (i) => loop[i], Tv = (i) => loop[2 * a + b - i], Lv = (j) => loop[(N - j) % N], Rv = (j) => loop[a + j];
  const grid = [];
  for (let i = 0; i <= a; i++) {
    grid.push([]);
    for (let j = 0; j <= b; j++) {
      if (j === 0) grid[i].push(Bv(i));
      else if (j === b) grid[i].push(Tv(i));
      else if (i === 0) grid[i].push(Lv(j));
      else if (i === a) grid[i].push(Rv(j));
      else {
        const u = i / a, v = j / b;
        const pB = P[Bv(i)], pT = P[Tv(i)], pL = P[Lv(j)], pR = P[Rv(j)];
        const c00 = P[Bv(0)], c10 = P[Bv(a)], c01 = P[Tv(0)], c11 = P[Tv(a)];
        const p = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          p[k] = (1 - v) * pB[k] + v * pT[k] + (1 - u) * pL[k] + u * pR[k]
            - ((1 - u) * (1 - v) * c00[k] + u * (1 - v) * c10[k] + (1 - u) * v * c01[k] + u * v * c11[k]);
        }
        P.push(p); grid[i].push(P.length - 1);
      }
    }
  }
  const out = new Set();
  for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) {
    m.faces.push(_face([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]],
      [[i / a, j / b], [(i + 1) / a, j / b], [(i + 1) / a, (j + 1) / b], [i / a, (j + 1) / b]]));
    out.add(m.faces.length - 1);
  }
  touch(m); cleanEdges(m);
  return { ok: true, faces: out, span: a };
}

export function bridgeLoops(m, sel, twist = 0) {
  let loops;
  if (sel.faces.size === 2) {
    const [f1, f2] = [...sel.faces].map((fi) => m.faces[fi]);
    if (f1.v.some((v) => f2.v.includes(v))) return { ok: false, msg: 'The two faces must not share vertices' };
    const l1 = f1.v.slice(), l2 = f2.v.slice();
    const rm = new Set(sel.faces);
    m.faces = m.faces.filter((_, i) => !rm.has(i));
    touch(m);
    loops = [{ verts: l1, closed: true }, { verts: l2, closed: true }];
  } else {
    loops = _openLoops(m, sel);
    if (loops.some((l) => l.bad)) return { ok: false, msg: 'Selected edges branch; select two edge loops' };
  }
  if (loops.length !== 2) return { ok: false, msg: 'Select exactly two edge loops (or two faces)' };
  let [A, B] = loops;
  if (A.closed !== B.closed) return { ok: false, msg: 'Both loops must be closed, or both open' };
  if (A.verts.length !== B.verts.length) return { ok: false, msg: `Loops need the same vertex count (${A.verts.length} vs ${B.verts.length})` };
  const P = m.verts, n = A.verts.length;
  let a = A.verts, best = null;
  const cands = [];
  if (A.closed) { for (const rev of [false, true]) { const bb = rev ? B.verts.slice().reverse() : B.verts.slice(); for (let o = 0; o < n; o++) cands.push(bb.slice(o).concat(bb.slice(0, o))); } }
  else cands.push(B.verts.slice(), B.verts.slice().reverse());
  // compare relative to centroids so offset loops still align
  const cen = (L) => { const c = [0, 0, 0]; for (const v of L) { c[0] += P[v][0]; c[1] += P[v][1]; c[2] += P[v][2]; } return vscale(c, 1 / L.length); };
  const ca = cen(a), cb = cen(B.verts);
  for (const c of cands) {
    let s = 0; for (let i = 0; i < n; i++) { const d = vsub(vsub(P[a[i]], ca), vsub(P[c[i]], cb)); s += vdot(d, d); }
    if (!best || s < best.s) best = { s, c };
  }
  let b = best.c;
  if (A.closed && twist) { const t = ((twist % n) + n) % n; b = b.slice(t).concat(b.slice(0, t)); }
  // orientation: quads [a_i, a_i+1, b_i+1, b_i] traverse a_i -> a_i+1
  const T = topo(m);
  let flip = null;
  const segs = A.closed ? n : n - 1;
  const dirOf = (x, y) => {
    const ei = T.edgeIndex.get(ekey(x, y)); if (ei === undefined) return 0;
    for (const fi of T.edgeFaces[ei]) { const v = m.faces[fi].v, L = v.length; for (let j = 0; j < L; j++) { if (v[j] === x && v[(j + 1) % L] === y) return 1; if (v[j] === y && v[(j + 1) % L] === x) return -1; } }
    return 0;
  };
  for (let i = 0; i < segs && flip === null; i++) { const d = dirOf(a[i], a[(i + 1) % n]); if (d) flip = d === 1; }
  for (let i = 0; i < segs && flip === null; i++) { const d = dirOf(b[(i + 1) % n], b[i]); if (d) flip = d === 1; }
  if (flip === null) {
    // wire loops: point normals away from the joint centroid
    const c = vscale(vadd(ca, cb), 0.5);
    const q = [a[0], a[1 % n], b[1 % n], b[0]];
    const nr = faceNormalRaw(m, { v: q }), fc = faceCenter(m, { v: q });
    flip = vdot(nr, vsub(fc, c)) < 0;
  }
  const out = new Set();
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    let v = [a[i], a[j], b[j], b[i]];
    let uv = [[i / segs, 0], [(i + 1) / segs, 0], [(i + 1) / segs, 1], [i / segs, 1]];
    if (flip) { v = v.reverse(); uv = uv.reverse(); }
    m.faces.push(_face(v, uv));
    out.add(m.faces.length - 1);
  }
  touch(m); cleanEdges(m);
  return { ok: true, faces: out };
}

// ---------- NORMALS ----------
export function flipFaces(m, fset) {
  for (const fi of fset) { const f = m.faces[fi]; f.v.reverse(); f.uv.reverse(); }
  touch(m);
}
export function recalcNormals(m, fset, inside = false) {
  const T = topo(m);
  const visited = new Set();
  for (const f0 of fset) {
    if (visited.has(f0)) continue;
    const comp = [f0], q = [f0]; visited.add(f0);
    while (q.length) {
      const fi = q.shift(); const f = m.faces[fi], n = f.v.length;
      for (let i = 0; i < n; i++) {
        const a = f.v[i], b = f.v[(i + 1) % n];
        const fs = T.edgeFaces[T.edgeIndex.get(ekey(a, b))];
        if (fs.length !== 2) continue;
        const g = fs[0] === fi ? fs[1] : fs[0];
        if (visited.has(g) || !fset.has(g)) continue;
        const gv = m.faces[g].v, L = gv.length;
        let same = false;
        for (let j = 0; j < L; j++) if (gv[j] === a && gv[(j + 1) % L] === b) { same = true; break; }
        if (same) { m.faces[g].v.reverse(); m.faces[g].uv.reverse(); }
        visited.add(g); comp.push(g); q.push(g);
      }
    }
    // outward test: area-weighted dot(normal, center - centroid)
    const cen = [0, 0, 0]; let wsum = 0;
    for (const fi of comp) { const a = faceArea(m, m.faces[fi]); const c = faceCenter(m, m.faces[fi]); cen[0] += c[0] * a; cen[1] += c[1] * a; cen[2] += c[2] * a; wsum += a; }
    const C = vscale(cen, 1 / (wsum || 1));
    let s = 0;
    for (const fi of comp) { const f = m.faces[fi]; s += vdot(faceNormalRaw(m, f), vsub(faceCenter(m, f), C)); }
    if ((s < 0) !== inside) for (const fi of comp) { m.faces[fi].v.reverse(); m.faces[fi].uv.reverse(); }
  }
  touch(m);
}

// ---------- TRIANGULATE / TRIS TO QUADS ----------
export function triangulateFaces(m, fset) {
  const out = new Set();
  for (const fi of [...fset]) {
    const f = m.faces[fi];
    if (f.v.length <= 3) { out.add(fi); continue; }
    const tris = triangulateFace(m, f);
    const make = (t) => _face(t.map((c) => f.v[c]), t.map((c) => f.uv[c].slice()), f.mat);
    m.faces[fi] = make(tris[0]); out.add(fi);
    for (let i = 1; i < tris.length; i++) { m.faces.push(make(tris[i])); out.add(m.faces.length - 1); }
  }
  touch(m);
  return { faces: out };
}
export function trisToQuads(m, fset, maxAngleDeg = 40) {
  const T = topo(m);
  const cands = [];
  const maxA = (maxAngleDeg * Math.PI) / 180;
  for (let ei = 0; ei < T.edges.length; ei++) {
    const fs = T.edgeFaces[ei];
    if (fs.length !== 2 || !fset.has(fs[0]) || !fset.has(fs[1])) continue;
    const f1 = m.faces[fs[0]], f2 = m.faces[fs[1]];
    if (f1.v.length !== 3 || f2.v.length !== 3 || f1.mat !== f2.mat) continue;
    const [x, y] = T.edges[ei];
    // make f1 traverse a->b
    let i1 = -1; for (let i = 0; i < 3; i++) if ((f1.v[i] === x && f1.v[(i + 1) % 3] === y) || (f1.v[i] === y && f1.v[(i + 1) % 3] === x)) i1 = i;
    const a = f1.v[i1], b = f1.v[(i1 + 1) % 3], c = f1.v[(i1 + 2) % 3];
    const d = f2.v.find((v) => v !== a && v !== b);
    const n1 = faceNormal(m, f1), n2 = faceNormal(m, f2);
    const ang = Math.acos(Math.max(-1, Math.min(1, vdot(n1, n2))));
    if (ang > maxA) continue;
    const quad = [a, d, b, c];
    const qn = faceNormalRaw(m, { v: quad });
    let convex = true, err = ang;
    for (let i = 0; i < 4; i++) {
      const p0 = m.verts[quad[(i + 3) % 4]], p1 = m.verts[quad[i]], p2 = m.verts[quad[(i + 1) % 4]];
      const e1 = vsub(p0, p1), e2 = vsub(p2, p1);
      if (vdot(vcross(e2, e1), qn) <= 0) { convex = false; break; }
      const ca = vdot(vnorm(e1), vnorm(e2));
      err += Math.abs(Math.acos(Math.max(-1, Math.min(1, ca))) - Math.PI / 2);
    }
    if (!convex) continue;
    const uvA = f1.uv[i1], uvB = f1.uv[(i1 + 1) % 3], uvC = f1.uv[(i1 + 2) % 3], uvD = f2.uv[f2.v.indexOf(d)];
    cands.push({ err, f1: fs[0], f2: fs[1], quad, uv: [uvA, uvD, uvB, uvC], mat: f1.mat });
  }
  cands.sort((p, q) => p.err - q.err);
  const used = new Set(), rm = new Set(), add = [];
  for (const c of cands) {
    if (used.has(c.f1) || used.has(c.f2)) continue;
    used.add(c.f1); used.add(c.f2); rm.add(c.f2);
    m.faces[c.f1] = _face(c.quad, c.uv.map((u) => u.slice()), c.mat);
  }
  const keepIdx = [];
  m.faces.forEach((_, i) => { if (!rm.has(i)) keepIdx.push(i); });
  const newIndex = new Map(); keepIdx.forEach((old, i) => newIndex.set(old, i));
  m.faces = keepIdx.map((i) => m.faces[i]);
  touch(m);
  const out = new Set(); for (const fi of fset) if (newIndex.has(fi)) out.add(newIndex.get(fi));
  return { faces: out, merged: rm.size };
}

// ---------- SELECTION HELPERS ----------
export function edgeLoopKeys(m, startKey) {
  const T = topo(m);
  const ei0 = T.edgeIndex.get(startKey);
  if (ei0 === undefined) return new Set();
  const nf0 = T.edgeFaces[ei0].length;
  const kind = nf0 === 0 ? 'wire' : nf0 === 1 ? 'boundary' : 'inner';
  const res = new Set([startKey]);
  const [a, b] = ekeySplit(startKey);
  const step = (prev, cur) => {
    let guard = 0;
    while (guard++ < 200000) {
      const eidx = T.edgeIndex.get(ekey(prev, cur));
      const ve = T.vertEdges[cur];
      let next = -1;
      if (kind === 'inner') {
        if (ve.length !== 4) break;
        const fe = new Set(T.edgeFaces[eidx]);
        if (fe.size !== 2) break;
        for (const e2 of ve) {
          if (e2 === eidx) continue;
          if (T.edgeFaces[e2].some((f) => fe.has(f))) continue;
          const [x, y] = T.edges[e2]; next = x === cur ? y : x;
        }
      } else if (kind === 'boundary') {
        const c = ve.filter((e2) => e2 !== eidx && T.edgeFaces[e2].length === 1);
        if (c.length !== 1) break;
        const [x, y] = T.edges[c[0]]; next = x === cur ? y : x;
      } else {
        const c = ve.filter((e2) => e2 !== eidx);
        if (c.length !== 1 || T.edgeFaces[c[0]].length) break;
        const [x, y] = T.edges[c[0]]; next = x === cur ? y : x;
      }
      if (next < 0) break;
      const k = ekey(cur, next);
      if (res.has(k)) break;
      res.add(k); prev = cur; cur = next;
    }
  };
  step(a, b); step(b, a);
  return res;
}
export function edgeRingKeys(m, startKey) {
  const r = edgeRing(m, startKey);
  return new Set(r ? r.edges.map(([s, t]) => ekey(s, t)) : []);
}
export function linkedVerts(m, vset, delimitSeams = false) {
  const T = topo(m);
  const out = new Set(vset), st = [...vset];
  while (st.length) {
    const v = st.pop();
    for (const ei of T.vertEdges[v]) {
      const [x, y] = T.edges[ei];
      if (delimitSeams && m.seams.has(ekey(x, y))) continue;
      const w = x === v ? y : x;
      if (!out.has(w)) { out.add(w); st.push(w); }
    }
  }
  return out;
}
// connected islands of a vertex set (through edges between selected verts)
export function vertIslands(m, vset) {
  const T = topo(m);
  const seen = new Set(), out = [];
  for (const v0 of vset) {
    if (seen.has(v0)) continue;
    const comp = [], st = [v0]; seen.add(v0);
    while (st.length) {
      const v = st.pop(); comp.push(v);
      for (const ei of T.vertEdges[v]) { const [x, y] = T.edges[ei]; const w = x === v ? y : x; if (vset.has(w) && !seen.has(w)) { seen.add(w); st.push(w); } }
    }
    out.push(comp);
  }
  return out;
}

// ---------- OBJECT-LEVEL HELPERS ----------
export function meshBounds(m) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of m.verts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
  if (!m.verts.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min: mn, max: mx };
}
export function appendMesh(dst, src, xf /* function(p)->p or null */, matOffsetMap /* slot remap fn */) {
  const off = dst.verts.length;
  for (const p of src.verts) dst.verts.push(xf ? xf(p) : p.slice());
  for (const f of src.faces) dst.faces.push(_face(f.v.map((v) => v + off), f.uv.map((u) => u.slice()), matOffsetMap ? matOffsetMap(f.mat) : f.mat));
  for (const [a, b] of src.looseEdges) dst.looseEdges.push([a + off, b + off]);
  for (const name of ['seams', 'creases']) { dst[name] ||= new Set();
    for (const k of (src[name] || [])) { const [a, b] = ekeySplit(k); dst[name].add(ekey(a + off, b + off)); }
  }
  touch(dst);
  const out = new Set(); for (let i = 0; i < src.verts.length; i++) out.add(off + i);
  return out;
}
// split a mesh into the part using vset (faces fully inside) and the rest
export function extractPart(m, vset) {
  const part = newMesh();
  const map = new Map();
  const mp = (v) => { if (!map.has(v)) { map.set(v, part.verts.length); part.verts.push(m.verts[v].slice()); } return map.get(v); };
  const takeF = new Set();
  m.faces.forEach((f, fi) => { if (f.v.every((v) => vset.has(v))) { takeF.add(fi); part.faces.push(_face(f.v.map(mp), f.uv.map((u) => u.slice()), f.mat)); } });
  for (const [a, b] of m.looseEdges) if (vset.has(a) && vset.has(b)) part.looseEdges.push([mp(a), mp(b)]);
  for (const v of vset) mp(v);
  for (const name of ['seams', 'creases']) {
    for (const k of (m[name] || [])) { const [a, b] = ekeySplit(k); if (map.has(a) && map.has(b)) part[name].add(ekey(map.get(a), map.get(b))); }
  }
  part.smooth = m.smooth;
  // remove from source: faces taken, then verts no longer used that are in vset
  m.faces = m.faces.filter((_, fi) => !takeF.has(fi));
  m.looseEdges = m.looseEdges.filter(([a, b]) => !(vset.has(a) && vset.has(b)));
  touch(m);
  const used = _usedVerts(m);
  const rm = new Set(); for (const v of vset) if (!used[v]) rm.add(v);
  removeVerts(m, rm);
  cleanEdges(m);
  return part;
}
// move the given faces into a new mesh (verts copied), removing them from m
export function extractFaces(m, fset) {
  const part = newMesh();
  const map = new Map();
  const mp = (v) => { if (!map.has(v)) { map.set(v, part.verts.length); part.verts.push(m.verts[v].slice()); } return map.get(v); };
  const fe = new Set();
  m.faces.forEach((f, fi) => {
    if (!fset.has(fi)) return;
    part.faces.push(_face(f.v.map(mp), f.uv.map((u) => u.slice()), f.mat));
    for (let i = 0; i < f.v.length; i++) fe.add(ekey(f.v[i], f.v[(i + 1) % f.v.length]));
  });
  for (const name of ['seams', 'creases']) {
    for (const k of (m[name] || [])) if (fe.has(k)) { const [a, b] = ekeySplit(k); part[name].add(ekey(map.get(a), map.get(b))); }
  }
  part.smooth = m.smooth;
  m.faces = m.faces.filter((_, fi) => !fset.has(fi));
  touch(m);
  _removeOrphans(m, [...map.keys()]);
  cleanEdges(m);
  return part;
}
export function looseParts(m) {
  const all = new Set(); for (let i = 0; i < m.verts.length; i++) all.add(i);
  return vertIslands(m, all);
}
