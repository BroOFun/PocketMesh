// Node tests for src/uv.js  —  run: node test/uv.test.mjs
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/uv.js', import.meta.url), 'utf8');
if (/^\s*import\s/m.test(src)) throw new Error('uv.js must not contain import lines');
const UV = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

// ---------------------------------------------------------------- harness
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log('  FAIL', msg); } };
const section = name => console.log('\n# ' + name);
const ek = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
const allIdx = m => m.faces.map((_, i) => i);

function mkMesh(verts, faces, seams = []) {
  return { verts, faces: faces.map(v => ({ v, uv: v.map(() => [0, 0]), mat: 0 })), looseEdges: [], seams: new Set(seams), smooth: false };
}

// ---------------------------------------------------------------- test meshes
function cube(cross) {
  const verts = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [3, 0, 4, 7], [1, 2, 6, 5]];
  // cross layout: front in the middle, top/bottom/left/right attached to it, back attached to top
  const seams = cross ? [ek(1, 2), ek(2, 3), ek(3, 0), ek(5, 6), ek(7, 4), ek(2, 6), ek(3, 7)] : [];
  return mkMesh(verts, faces, seams);
}

function uvSphere(S, R, seam = true) {
  const verts = [[0, 0, 1]];
  for (let i = 1; i < R; i++) {
    const th = (Math.PI * i) / R;
    for (let j = 0; j < S; j++) { const ph = (2 * Math.PI * j) / S; verts.push([Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]); }
  }
  verts.push([0, 0, -1]);
  const bot = verts.length - 1, V = (i, j) => 1 + (i - 1) * S + (j % S);
  const faces = [], seams = [];
  for (let j = 0; j < S; j++) faces.push([0, V(1, j), V(1, j + 1)]);
  for (let i = 1; i < R - 1; i++) for (let j = 0; j < S; j++) faces.push([V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1)]);
  for (let j = 0; j < S; j++) faces.push([V(R - 1, j), bot, V(R - 1, j + 1)]);
  if (seam) { seams.push(ek(0, V(1, 0)), ek(V(R - 1, 0), bot)); for (let i = 1; i < R - 1; i++) seams.push(ek(V(i, 0), V(i + 1, 0))); }
  return mkMesh(verts, faces, seams);
}

function cylinder(n, seams = true) {
  const verts = [];
  for (let j = 0; j < n; j++) { const a = (2 * Math.PI * j) / n; verts.push([Math.cos(a), Math.sin(a), -1]); }
  for (let j = 0; j < n; j++) { const a = (2 * Math.PI * j) / n; verts.push([Math.cos(a), Math.sin(a), 1]); }
  const faces = [], s = [];
  for (let j = 0; j < n; j++) { const k = (j + 1) % n; faces.push([j, k, n + k, n + j]); if (seams) s.push(ek(j, k), ek(n + j, n + k)); }
  faces.push(Array.from({ length: n }, (_, j) => n + j));
  faces.push(Array.from({ length: n }, (_, j) => n - 1 - j));
  if (seams) s.push(ek(0, n));
  return mkMesh(verts, faces, s);
}

function bumpyGrid(N = 10) {
  const verts = [], faces = [], id = (i, j) => j * (N + 1) + i;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = (i / N) * 2 - 1, y = (j / N) * 2 - 1;
    verts.push([x, y, 0.3 * Math.exp(-3 * (x * x + y * y))]);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) faces.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
  const m = mkMesh(verts, faces);
  m.gridId = id; m.N = N;
  return m;
}

function bentStrip() {
  const pts = [];
  for (let k = 0; k <= 10; k++) pts.push([k * 0.2, 0]);
  for (let k = 1; k <= 10; k++) pts.push([2, k * 0.2]);
  const verts = [], faces = [];
  for (const [x, z] of pts) verts.push([x, 0, z], [x, 1, z]);
  for (let k = 0; k < pts.length - 1; k++) faces.push([2 * k, 2 * k + 2, 2 * k + 3, 2 * k + 1]);
  return mkMesh(verts, faces);
}

function lShape() {
  return mkMesh([[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]], [[0, 1, 2, 3, 4, 5]]);
}

// ---------------------------------------------------------------- geometry helpers (test side)
function newell(pts) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}
// triangulate a face (local corner triples) via ear clipping on its Newell plane
function triFace(m, f) {
  const P = f.v.map(i => m.verts[i]), n = newell(P), l = Math.hypot(...n) || 1, N = n.map(x => x / l);
  const t = Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = t[0] * N[0] + t[1] * N[1] + t[2] * N[2];
  let T = [t[0] - d * N[0], t[1] - d * N[1], t[2] - d * N[2]]; const tl = Math.hypot(...T); T = T.map(x => x / tl);
  const B = [N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]];
  const q = P.map(p => [p[0] * T[0] + p[1] * T[1] + p[2] * T[2], p[0] * B[0] + p[1] * B[1] + p[2] * B[2]]);
  const cr = (a, b, c) => (q[b][0] - q[a][0]) * (q[c][1] - q[a][1]) - (q[b][1] - q[a][1]) * (q[c][0] - q[a][0]);
  const idx = q.map((_, i) => i), out = [];
  while (idx.length > 3) {
    let done = false;
    for (let k = 0; k < idx.length && !done; k++) {
      const a = idx[(k + idx.length - 1) % idx.length], b = idx[k], c = idx[(k + 1) % idx.length];
      if (cr(a, b, c) <= 1e-14) continue;
      const same = (p, r) => q[p][0] === q[r][0] && q[p][1] === q[r][1];
      if (idx.some(p => p !== a && p !== b && p !== c && !same(p, a) && !same(p, b) && !same(p, c) && cr(a, b, p) >= 0 && cr(b, c, p) >= 0 && cr(c, a, p) >= 0)) continue;
      out.push([a, b, c]); idx.splice(k, 1); done = true;
    }
    if (!done) { out.push([idx[0], idx[1], idx[2]]); idx.splice(1, 1); }
  }
  out.push(idx);
  return out;
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const ang3 = (u, w) => Math.atan2(Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]), u[0] * w[0] + u[1] * w[1] + u[2] * w[2]);
const ang2 = (u, w) => Math.atan2(Math.abs(u[0] * w[1] - u[1] * w[0]), u[0] * w[0] + u[1] * w[1]);
const area2 = (a, b, c) => 0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));

function allFinite(m, fids) { return fids.every(fi => m.faces[fi].uv.length === m.faces[fi].v.length && m.faces[fi].uv.every(t => Number.isFinite(t[0]) && Number.isFinite(t[1]))); }
function inUnit(m, fids, eps = 1e-9) { return fids.every(fi => m.faces[fi].uv.every(t => t[0] >= -eps && t[0] <= 1 + eps && t[1] >= -eps && t[1] <= 1 + eps)); }

// count flipped (negative area) UV triangles; degenerate 3D triangles ignored
function flips(m, fids) {
  let bad = 0;
  for (const fi of fids) {
    const f = m.faces[fi];
    for (const [a, b, c] of triFace(m, f)) {
      const A3 = Math.hypot(...newell([m.verts[f.v[a]], m.verts[f.v[b]], m.verts[f.v[c]]]));
      if (A3 < 1e-12) continue;
      if (area2(f.uv[a], f.uv[b], f.uv[c]) < -1e-12) bad++;
    }
  }
  return bad;
}

// angle distortion in degrees (mean, max) over triangles
function angleDistortion(m, fids) {
  let sum = 0, cnt = 0, mx = 0;
  for (const fi of fids) {
    const f = m.faces[fi];
    for (const t of triFace(m, f)) {
      for (let k = 0; k < 3; k++) {
        const a = t[k], b = t[(k + 1) % 3], c = t[(k + 2) % 3];
        const P = i => m.verts[f.v[i]], U = i => f.uv[i];
        const g3 = ang3(sub3(P(b), P(a)), sub3(P(c), P(a)));
        const g2 = ang2([U(b)[0] - U(a)[0], U(b)[1] - U(a)[1]], [U(c)[0] - U(a)[0], U(c)[1] - U(a)[1]]);
        const d = (Math.abs(g3 - g2) * 180) / Math.PI;
        sum += d; cnt++; mx = Math.max(mx, d);
      }
    }
  }
  return { mean: cnt ? sum / cnt : 0, max: mx };
}

// rasterise all UV triangles on a RES^2 grid; returns overlap ratio (pixels hit >= 2 times / pixels hit)
function overlapRatio(m, fids, RES = 512) {
  const cov = new Uint16Array(RES * RES);
  for (const fi of fids) {
    const f = m.faces[fi];
    for (const [a, b, c] of triFace(m, f)) {
      const A = f.uv[a].map(x => x * RES), B = f.uv[b].map(x => x * RES), C = f.uv[c].map(x => x * RES);
      const ar = area2(A, B, C);
      if (Math.abs(ar) < 1e-12) continue;
      const s = ar > 0 ? 1 : -1;
      const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(RES - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(RES - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const p = [x + 0.5, y + 0.5];
        if (s * area2(A, B, p) > 0 && s * area2(B, C, p) > 0 && s * area2(C, A, p) > 0) cov[y * RES + x]++;
      }
    }
  }
  let hit = 0, over = 0;
  for (const c of cov) { if (c) hit++; if (c > 1) over++; }
  return { ratio: hit ? over / hit : 0, hit, over, fill: hit / (RES * RES) };
}

function islandsCount(m, fids) { return UV.getUVIslands(m, fids).length; }

// common checks after a packing method
function checkPacked(name, m, fids, { flipsOk = false, maxOverlap = 0.005 } = {}) {
  ok(allFinite(m, fids), `${name}: non-finite UVs`);
  ok(inUnit(m, fids), `${name}: UVs outside [0,1]`);
  const ov = overlapRatio(m, fids);
  ok(ov.ratio <= maxOverlap, `${name}: overlap ratio ${ov.ratio.toFixed(5)} (${ov.over} px)`);
  const fl = flips(m, fids);
  if (!flipsOk) ok(fl === 0, `${name}: ${fl} flipped triangles`);
  return { overlap: ov.ratio, fill: ov.fill, flips: fl };
}

// ---------------------------------------------------------------- tests
const fmt = x => (typeof x === 'number' ? x.toFixed(4) : x);
const report = (name, o) => console.log(`  ${name.padEnd(34)} ` + Object.entries(o).map(([k, v]) => `${k}=${fmt(v)}`).join(' '));

section('unwrap (conformal + min_stretch) on test meshes');
for (const method of ['conformal', 'min_stretch']) {
  const cases = [
    ['cube cross seams', cube(true), 1],
    ['cube no seams', cube(false), 1],
    ['uv sphere 32x16', uvSphere(32, 16), 1],
    ['cylinder ngon caps', cylinder(32), 3],
    ['bumpy grid 10x10', bumpyGrid(10), 1],
    ['bent strip', bentStrip(), 1],
    ['L ngon', lShape(), 1],
  ];
  for (const [name, m, isl] of cases) {
    const fids = allIdx(m);
    const t0 = performance.now();
    UV.unwrap(m, fids, { method });
    const dt = performance.now() - t0;
    const r = checkPacked(`${method} ${name}`, m, fids, { flipsOk: name === 'cube no seams' && false });
    const nIsl = islandsCount(m, fids);
    ok(nIsl === isl, `${method} ${name}: islands ${nIsl} != ${isl}`);
    const ad = angleDistortion(m, fids);
    report(`${method} ${name}`, { ms: dt, islands: nIsl, flips: r.flips, overlap: r.overlap, fill: r.fill, angMean: ad.mean, angMax: ad.max });
    if (method === 'conformal' && (name === 'bent strip' || name === 'L ngon' || name === 'cube cross seams')) ok(ad.max < 0.01, `${name}: developable but angle distortion max ${ad.max}`);
    if (method === 'conformal' && name === 'bumpy grid 10x10') ok(ad.mean < 2, `${name}: mean angle distortion ${ad.mean}`);
    if (name === 'cylinder ngon caps') {
      const side = fids.slice(0, 32), adS = angleDistortion(m, side);
      report('  cylinder side only', { angMean: adS.mean, angMax: adS.max });
      if (method === 'conformal') ok(adS.max < 0.01, `cylinder side angle distortion ${adS.max}`);
    }
  }
}

section('unwrap: partial selection leaves other faces untouched; welds');
{
  const m = bumpyGrid(10);
  m.faces.forEach(f => f.uv = f.uv.map(() => [0.123, 0.456]));
  const sel = allIdx(m).filter(i => i % 10 < 5);
  UV.unwrap(m, sel);
  ok(m.faces.every((f, i) => sel.includes(i) || f.uv.every(t => t[0] === 0.123 && t[1] === 0.456)), 'unselected faces changed');
  ok(islandsCount(m, sel) === 1, 'half grid should be one island');
  // every vertex has identical UVs in all selected faces (single island, no seams)
  const seen = new Map(); let maxd = 0;
  for (const fi of sel) m.faces[fi].v.forEach((v, i) => { const t = m.faces[fi].uv[i]; if (seen.has(v)) { const s = seen.get(v); maxd = Math.max(maxd, Math.abs(s[0] - t[0]), Math.abs(s[1] - t[1])); } else seen.set(v, t); });
  ok(maxd === 0, `weld mismatch ${maxd}`);
  report('half grid', { weldErr: maxd });
}

section('smartProject / lightmapPack / cubeProject');
{
  for (const [name, m] of [['cube', cube(false)], ['uv sphere 32x16', uvSphere(32, 16)], ['cylinder', cylinder(32)], ['bumpy grid', bumpyGrid(10)], ['bent strip', bentStrip()], ['L ngon', lShape()]]) {
    const fids = allIdx(m);
    UV.smartProject(m, fids);
    const r = checkPacked(`smart ${name}`, m, fids);
    report(`smart ${name}`, { islands: islandsCount(m, fids), overlap: r.overlap, fill: r.fill });
  }
  const c = cube(false); UV.smartProject(c, allIdx(c));
  ok(islandsCount(c, allIdx(c)) === 6, 'smart cube should give 6 islands');
  const s = uvSphere(32, 16), sf = allIdx(s);
  const t0 = performance.now(); UV.lightmapPack(s, sf); const dt = performance.now() - t0;
  const r = checkPacked('lightmap sphere', s, sf);
  ok(islandsCount(s, sf) === sf.length, 'lightmap: one island per face');
  report('lightmap sphere', { ms: dt, islands: islandsCount(s, sf), overlap: r.overlap, fill: r.fill });
  const lc = cube(true); UV.lightmapPack(lc, allIdx(lc));
  checkPacked('lightmap cube', lc, allIdx(lc));
  ok(islandsCount(lc, allIdx(lc)) === 6, `lightmap cube islands ${islandsCount(lc, allIdx(lc))} != 6`);
  for (const [name, m] of [['cube', cube(false)], ['sphere', uvSphere(32, 16)], ['cylinder', cylinder(32)]]) {
    const fids = allIdx(m); UV.cubeProject(m, fids);
    ok(allFinite(m, fids), `cube proj ${name}: non-finite`);
    ok(flips(m, fids) === 0, `cube proj ${name}: ${flips(m, fids)} flips`);
    if (name === 'cube') ok(inUnit(m, fids) && islandsCount(m, fids) === 6, 'cube proj cube: in unit square, 6 islands');
  }
}

section('cylinder / sphere / view projection, reset');
{
  const m = cylinder(32), fids = allIdx(m);
  UV.cylinderProject(m, fids.slice(0, 32));
  let maxW = 0;
  for (const fi of fids.slice(0, 32)) { const us = m.faces[fi].uv.map(t => t[0]); maxW = Math.max(maxW, Math.max(...us) - Math.min(...us)); }
  ok(maxW < 1 / 32 + 1e-9, `cylinder proj: face u-span ${maxW}`);
  ok(allFinite(m, fids) && flips(m, fids.slice(0, 32)) === 0, 'cylinder proj: finite, no flips on side');
  const s = uvSphere(32, 16), sf = allIdx(s);
  UV.sphereProject(s, sf);
  let maxS = 0;
  for (const fi of sf) { const us = s.faces[fi].uv.map(t => t[0]); maxS = Math.max(maxS, Math.max(...us) - Math.min(...us)); }
  ok(maxS < 1 / 32 + 1e-9, `sphere proj: face u-span ${maxS}`);
  ok(allFinite(s, sf) && flips(s, sf) === 0, `sphere proj: finite & ${flips(s, sf)} flips`);
  report('cyl/sphere proj', { cylSpan: maxW, sphSpan: maxS });
  // project from view: orthographic top view (identity-ish) of the grid
  const g = bumpyGrid(10), gf = allIdx(g);
  UV.projectFromView(g, gf, { matrix: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1], scaleToBounds: false });
  ok(Math.abs(g.faces[0].uv[0][0] - 0.25) < 1e-12 && Math.abs(g.faces[0].uv[0][1] - 0.25) < 1e-12, 'view proj ortho mapping');
  UV.projectFromView(g, gf, { matrix: [0.5, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1] });
  ok(inUnit(g, gf) && flips(g, gf) === 0, 'view proj scaleToBounds in unit square');
  // perspective with a vertex at w=0 must not produce NaN
  const pm = mkMesh([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]]);
  UV.projectFromView(pm, [0], { matrix: [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0] });
  ok(allFinite(pm, [0]), 'view proj w=0 finite');
  const r = mkMesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0]], [[0, 1, 2, 3], [1, 4, 5], [0, 1, 4, 5, 2, 3]]);
  UV.resetUVs(r, [0, 1, 2]);
  ok(JSON.stringify(r.faces[0].uv) === '[[0,0],[1,0],[1,1],[0,1]]', 'reset quad');
  ok(inUnit(r, [1, 2]) && r.faces[1].uv.some(t => t[1] === 1) && flips(r, [0, 1]) === 0, 'reset tri/ngon fill square');
}

section('degenerate input');
{
  const m = mkMesh([[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 0], [3, 3, 3], [3, 3, 3], [3, 3, 3]], [[0, 1, 2], [0, 1, 3], [4, 5, 6], [0, 1, 2, 3]]);
  const fids = allIdx(m);
  for (const fn of ['unwrap', 'smartProject', 'lightmapPack', 'cubeProject', 'cylinderProject', 'sphereProject', 'resetUVs', 'packIslands', 'averageIslandScale', 'alignRotation']) {
    UV[fn](m, fids);
    ok(allFinite(m, fids), `${fn}: degenerate faces produced non-finite UVs`);
  }
  UV.unwrap(m, fids, { method: 'min_stretch' });
  ok(allFinite(m, fids), 'min_stretch degenerate finite');
  ok(UV.uvStretch(m, fids).every(Number.isFinite), 'uvStretch degenerate finite');
  UV.unwrap(m, []); UV.packIslands(m, []);
  ok(UV.getUVIslands(m, []).length === 0, 'empty selection');
}

section('followActiveQuads / straightenGrid on the bumpy grid');
function gridAxisDev(m) {
  // max deviation from axis alignment over all quad edges + weld error per vertex
  let dev = 0, weld = 0; const seen = new Map();
  for (const f of m.faces) {
    for (let i = 0; i < 4; i++) {
      const a = f.uv[i], b = f.uv[(i + 1) % 4];
      dev = Math.max(dev, Math.min(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])));
    }
    f.v.forEach((v, i) => { const t = f.uv[i]; if (seen.has(v)) { const s = seen.get(v); weld = Math.max(weld, Math.abs(s[0] - t[0]), Math.abs(s[1] - t[1])); } else seen.set(v, t); });
  }
  // rows / columns: vertices with the same grid j share v (or u)
  let rowDev = 0;
  const { N, gridId } = m;
  for (let j = 0; j <= N; j++) {
    const vs = [], us = [];
    for (let i = 0; i <= N; i++) { const t = seen.get(gridId(i, j)); vs.push(t[1]); us.push(t[0]); }
    rowDev = Math.max(rowDev, Math.min(Math.max(...vs) - Math.min(...vs), Math.max(...us) - Math.min(...us)));
  }
  return { dev, weld, rowDev };
}
for (const mode of ['length_average', 'even', 'length']) {
  const m = bumpyGrid(10), fids = allIdx(m);
  UV.unwrap(m, fids);
  const act = 45;
  m.faces[act].uv = [[0.4, 0.4], [0.5, 0.4], [0.5, 0.5], [0.4, 0.5]];
  ok(UV.followActiveQuads(m, fids, act, { mode }) === true, 'followActiveQuads returns true');
  const r = gridAxisDev(m);
  ok(allFinite(m, fids), `follow ${mode}: finite`);
  if (mode !== 'length') ok(r.dev < 1e-6 && r.weld < 1e-6 && r.rowDev < 1e-6, `follow ${mode}: axis dev ${r.dev} weld ${r.weld} row ${r.rowDev}`);
  ok(flips(m, fids) === 0, `follow ${mode}: flips`);
  report(`follow ${mode}`, r);
}
{
  const m = mkMesh([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]]);
  ok(UV.followActiveQuads(m, [0], 0) === false, 'follow: tri active -> false');
}
{
  const m = bumpyGrid(10), fids = allIdx(m);
  UV.unwrap(m, fids);
  const b0 = bbox(m, fids);
  const n = UV.straightenGrid(m, fids, -1);
  const r = gridAxisDev(m), b1 = bbox(m, fids);
  ok(n === 1, `straighten returns ${n}`);
  ok(r.dev < 1e-6 && r.weld < 1e-6 && r.rowDev < 1e-6, `straighten: axis dev ${r.dev} weld ${r.weld} row ${r.rowDev}`);
  ok(Math.abs((b0[0] + b0[2]) / 2 - (b1[0] + b1[2]) / 2) < 1e-9 && Math.abs((b0[1] + b0[3]) / 2 - (b1[1] + b1[3]) / 2) < 1e-9, 'straighten keeps bbox center');
  ok(flips(m, fids) === 0, 'straighten flips');
  report('straighten bumpy grid', { islands: n, ...r, w0: b0[2] - b0[0], w1: b1[2] - b1[0] });
  // with seams splitting the grid into 2 islands + a triangle-attached region
  const m2 = bumpyGrid(10);
  for (let j = 0; j < 10; j++) m2.seams.add(ek(m2.gridId(5, j), m2.gridId(5, j + 1)));
  UV.unwrap(m2, allIdx(m2));
  UV.straightenGrid(m2, allIdx(m2), 0);
  ok(UV.straightenGrid(m2, allIdx(m2), 0) === 2, 'straighten 2 islands');
  ok(gridAxisDev(m2).dev < 1e-6, 'straighten 2 islands axis aligned');
  // mixed quads + triangles: triangles stay attached
  const m3 = bumpyGrid(4);
  const q = m3.faces.pop(); m3.faces.push({ v: [q.v[0], q.v[1], q.v[2]], uv: [[0, 0], [0, 0], [0, 0]], mat: 0 }, { v: [q.v[0], q.v[2], q.v[3]], uv: [[0, 0], [0, 0], [0, 0]], mat: 0 });
  UV.unwrap(m3, allIdx(m3));
  const n3 = UV.straightenGrid(m3, allIdx(m3), 0);
  ok(n3 === 1 && UV.getUVIslands(m3, allIdx(m3)).length === 1, `straighten mixed: ${n3} islands, triangles attached = ${UV.getUVIslands(m3, allIdx(m3)).length === 1}`);
  ok(allFinite(m3, allIdx(m3)), 'straighten mixed finite');
}
function bbox(m, fids) {
  let a = [Infinity, Infinity, -Infinity, -Infinity];
  for (const fi of fids) for (const t of m.faces[fi].uv) a = [Math.min(a[0], t[0]), Math.min(a[1], t[1]), Math.max(a[2], t[0]), Math.max(a[3], t[1])];
  return a;
}

section('packIslands / averageIslandScale / alignRotation / getUVIslands / uvStretch');
{
  const m = cube(false), fids = allIdx(m);
  UV.resetUVs(m, fids);              // 6 identical unit squares, all overlapping
  ok(islandsCount(m, fids) === 6, 'reset cube: 6 islands');
  UV.packIslands(m, fids, { margin: 0.02 });
  const r = checkPacked('pack reset cube', m, fids);
  report('pack 6 squares', { overlap: r.overlap, fill: r.fill });
  ok(r.fill > 0.5, `pack efficiency ${r.fill}`);
  // averageIslandScale: island areas proportional to 3D areas
  const g = mkMesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [3, 0, 0], [5, 0, 0], [5, 2, 0], [3, 2, 0]], [[0, 1, 2, 3], [4, 5, 6, 7]]);
  UV.resetUVs(g, [0, 1]);
  g.faces[0].uv = g.faces[0].uv.map(([u, v]) => [u * 0.1 + 0.5, v * 0.1 + 0.5]);
  UV.averageIslandScale(g, [0, 1]);
  const a0 = Math.abs(area(g.faces[0].uv)), a1 = Math.abs(area(g.faces[1].uv));
  ok(Math.abs(a1 / a0 - 4) < 1e-9, `averageIslandScale ratio ${a1 / a0}`);
  const c0 = g.faces[0].uv.reduce((s, t) => [s[0] + t[0] / 4, s[1] + t[1] / 4], [0, 0]);
  ok(Math.abs(c0[0] - 0.55) < 1e-9 && Math.abs(c0[1] - 0.55) < 1e-9, 'averageIslandScale keeps center');
  ok(Math.max(...UV.uvStretch(g, [0, 1])) < 1e-6, 'uvStretch ~0 after averaging');
  g.faces[0].uv = g.faces[0].uv.map(([u, v]) => [u * 3, v]);
  const st = UV.uvStretch(g, [0, 1]);
  ok(st[0] > 0.2 && st.length === 2, `uvStretch detects distortion ${Array.from(st)}`);
  // alignRotation
  const rm = bumpyGrid(4), rf = allIdx(rm);
  UV.unwrap(rm, rf); UV.straightenGrid(rm, rf, 0);
  for (const f of rm.faces) f.uv = f.uv.map(([u, v]) => [u * Math.cos(0.4) - v * Math.sin(0.4), u * Math.sin(0.4) + v * Math.cos(0.4)]);
  UV.alignRotation(rm, rf);
  let dev = 0;
  for (const f of rm.faces) for (let i = 0; i < 4; i++) { const a = f.uv[i], b = f.uv[(i + 1) % 4]; dev = Math.max(dev, Math.min(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))); }
  ok(dev < 1e-9, `alignRotation dev ${dev}`);
  // getUVIslands after unwrap of the cross-seam cube = 1; after cube projection with mixed cube = 6
  const cc = cube(true); UV.unwrap(cc, allIdx(cc));
  ok(islandsCount(cc, allIdx(cc)) === 1, 'cross cube unwrap = 1 island');
  const out = UV.getUVIslands(cc, [5, 2, 99, -1, 2]);
  ok(out.length === 1 && out[0].length === 2 && out[0].includes(5) && out[0].includes(2), 'getUVIslands returns mesh face indices, ignores invalid');
}
function area(uv) { let a = 0; for (let i = 0; i < uv.length; i++) { const p = uv[i], q = uv[(i + 1) % uv.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }

section('performance: unwrap ~20k-face sphere');
{
  const m = uvSphere(200, 100), fids = allIdx(m);
  let t0 = performance.now();
  UV.unwrap(m, fids);
  const dt = performance.now() - t0;
  const r = checkPacked('20k sphere conformal', m, fids);
  const ad = angleDistortion(m, fids);
  report('20k sphere conformal', { faces: fids.length, ms: dt, overlap: r.overlap, flips: r.flips, angMean: ad.mean });
  ok(dt < 3000, `20k unwrap took ${dt.toFixed(0)} ms`);
  const m2 = uvSphere(200, 100, false);
  t0 = performance.now(); UV.unwrap(m2, fids); const dt2 = performance.now() - t0;
  const r2 = checkPacked('20k sphere no seam (auto cut)', m2, fids, { flipsOk: true });
  report('20k sphere no seam (auto cut)', { ms: dt2, overlap: r2.overlap, flips: r2.flips });
  t0 = performance.now(); UV.unwrap(m, fids, { method: 'min_stretch' }); const dt3 = performance.now() - t0;
  const r3 = checkPacked('20k sphere min_stretch', m, fids, { flipsOk: true });
  report('20k sphere min_stretch', { ms: dt3, overlap: r3.overlap, flips: r3.flips });
  t0 = performance.now(); UV.smartProject(m, fids); const dt4 = performance.now() - t0;
  report('20k sphere smartProject', { ms: dt4, ...checkPacked('20k smart', m, fids) });
  t0 = performance.now(); UV.lightmapPack(m, fids); const dt5 = performance.now() - t0;
  report('20k sphere lightmapPack', { ms: dt5, ...checkPacked('20k lightmap', m, fids) });
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
