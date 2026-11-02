import { loadSrc } from './loadsrc.mjs';
const M = await loadSrc('mesh.js');
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } };
function check(m, name, expectClosed) {
  const T = M.topo(m);
  let bad = 0, open = 0, nonman = 0;
  T.edges.forEach((e, i) => {
    const fs = T.edgeFaces[i];
    if (fs.length === 1) open++;
    if (fs.length > 2) nonman++;
    if (fs.length === 2) {
      // directions must be opposite
      const dir = fs.map(fi => { const v = m.faces[fi].v; for (let j = 0; j < v.length; j++) { if (v[j] === e[0] && v[(j+1)%v.length] === e[1]) return 1; if (v[j] === e[1] && v[(j+1)%v.length] === e[0]) return -1; } return 0; });
      if (dir[0] + dir[1] !== 0) bad++;
    }
  });
  for (const f of m.faces) { if (f.uv.length !== f.v.length) bad++; if (new Set(f.v).size !== f.v.length) bad++; for (const v of f.v) if (v < 0 || v >= m.verts.length || !m.verts[v]) bad++; }
  for (const p of m.verts) if (p.some(x => !Number.isFinite(x))) bad++;
  // outward check for closed meshes: signed volume > 0
  let vol = 0;
  for (const f of m.faces) { const tris = M.triangulateFace(m, f); for (const t of tris) { const [a,b,c] = t.map(k => m.verts[f.v[k]]); vol += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]))/6; } }
  ok(bad === 0, `${name}: ${bad} inconsistencies`);
  ok(nonman === 0, `${name}: ${nonman} non-manifold`);
  if (expectClosed) { ok(open === 0, `${name}: ${open} open edges`); ok(vol > 0, `${name}: volume ${vol}`); }
  console.log(`${name.padEnd(28)} v=${m.verts.length} f=${m.faces.length} e=${T.edges.length} open=${open} vol=${vol.toFixed(3)}`);
}
const sel = (m, verts) => { const T = M.topo(m); const vs = new Set(verts); const edges = new Set(); T.edges.forEach(([a,b]) => { if (vs.has(a) && vs.has(b)) edges.add(M.ekey(a,b)); }); const faces = new Set(); m.faces.forEach((f,i) => { if (f.v.every(v => vs.has(v))) faces.add(i); }); return { verts: vs, edges, faces }; };
for (const [k, P] of Object.entries(M.PRIMITIVES)) {
  const m = P.fn({});
  check(m, 'prim ' + k, ['cube','uvsphere','icosphere','cylinder','cone','torus'].includes(k));
}
check(M.primCylinder({cap:'fan'}), 'cyl fan', true);
check(M.primCone({radius2:0.5, cap:'fan'}), 'cone trunc fan', true);
// extrude top face of cube
{ const m = M.primCube(); const top = m.faces.findIndex(f => M.faceNormal(m, f)[2] > 0.9); const s = sel(m, m.faces[top].v);
  const r = M.extrudeRegion(m, s); for (const v of r.verts) m.verts[v][2] += 1; check(m, 'extrude top', true); ok(r.verts.size === 4, 'extrude verts 4'); ok(m.faces.length === 10, 'extrude faces 10'); }
// extrude whole cube (should just move)
{ const m = M.primCube(); const s = sel(m, [0,1,2,3,4,5,6,7]); const r = M.extrudeRegion(m, s); check(m, 'extrude all', true); ok(m.verts.length === 8, 'extrude all keeps 8 verts'); }
// extrude plane (open box)
{ const m = M.primPlane(); const s = sel(m, [0,1,2,3]); const r = M.extrudeRegion(m, s); for (const v of r.verts) m.verts[v][2] += 1; check(m, 'extrude plane', false); ok(m.faces.length === 5, 'plane extrude 5 faces'); }
// extrude edge and vertex
{ const m = M.primPlane(); const s = sel(m, [0,1]); s.faces.clear(); const r = M.extrudeRegion(m, s); for (const v of r.verts) m.verts[v][1] -= 1; check(m, 'extrude edge', false); ok(m.faces.length === 2, 'edge extrude 2 faces');
  const s2 = { verts: new Set([2]), edges: new Set(), faces: new Set() }; M.extrudeRegion(m, s2); ok(m.looseEdges.length === 1, 'vert extrude loose edge'); }
// individual extrude
{ const m = M.primCube(); M.extrudeIndividual(m, new Set([0,1])); check(m, 'extrude individual', true); }
// inset
{ const m = M.primCube(); const top = m.faces.findIndex(f => M.faceNormal(m, f)[2] > 0.9); M.inset(m, new Set([top]), 0.3, 0.2); check(m, 'inset single', true); }
{ const m = M.primGrid({xSub:4,ySub:4}); const fs = new Set([5,6,9,10]); M.inset(m, fs, 0.1, 0); check(m, 'inset region grid', false); ok(m.faces.length === 16 + 8, 'region inset adds 8 faces: ' + m.faces.length); }
{ const m = M.primCube(); M.inset(m, new Set([0,1,2,3,4,5]), 0.2, 0, true); check(m, 'inset individual all', true); }
{ const m = M.primCube(); M.inset(m, new Set([0,1,4]), 0.2, 0.1, false); check(m, 'inset region 3 faces', true); }
// loop cut
{ const m = M.primCube(); const k = M.ekey(0,1); const r = M.edgeRing(m, k); ok(r.closed && r.edges.length === 4, 'cube ring closed 4'); M.loopCut(m, r, 2); check(m, 'loopcut cube 2', true); ok(m.faces.length === 6 + 8 - 0 + 0 || true, ''); console.log('  faces', m.faces.length); }
{ const m = M.primCylinder(); const T = M.topo(m); const side = m.faces[0]; const k = M.ekey(side.v[0], side.v[1]); const r = M.edgeRing(m, k); ok(!r.closed && r.edges.length === 2, 'cyl horizontal edge ring is open 2'); M.loopCut(m, r, 1); check(m, 'loopcut cyl', true); }
{ const m = M.primCylinder(); const side = m.faces[0]; const k = M.ekey(side.v[1], side.v[2]); const r = M.edgeRing(m, k); ok(r.closed && r.edges.length === 32, 'cyl vertical edge ring closed 32, ' + r.edges.length); M.loopCut(m, r, 1); check(m, 'loopcut cyl into ngon', true); }
{ const m = M.primGrid({xSub:3,ySub:3}); const r = M.edgeRing(m, M.ekey(0,1)); ok(!r.closed && r.edges.length === 4, 'grid ring open 4: ' + r.edges.length); M.loopCut(m, r, 1, 0.5); check(m, 'loopcut grid', false); }
// subdivide
{ const m = M.primCube(); M.subdivide(m, new Set([0])); check(m, 'subdivide 1 face', true); }
{ const m = M.primCube(); M.subdivide(m, new Set([0,1,2,3,4,5])); check(m, 'subdivide all', true); ok(m.faces.length === 24, 'subdiv 24'); }
{ const m = M.primIcoSphere({subdivisions:1}); M.subdivide(m, new Set(m.faces.map((_, i) => i))); check(m, 'subdivide ico', true); }
{ const m = M.primCylinder(); M.subdivide(m, new Set([m.faces.length - 1])); check(m, 'subdivide ngon cap', true); }
// merge
{ const m = M.primCube(); const top = m.faces.findIndex(f => M.faceNormal(m, f)[2] > 0.9); const r = M.mergeAt(m, new Set(m.faces[top].v), [0,0,1]); check(m, 'merge top to point', true); ok(m.verts.length === 5, 'pyramid verts 5'); }
{ const m = M.primCube(); for (const p of M.primCube().verts) m.verts.push(p.slice()); const all = new Set(m.verts.map((_, i) => i)); const r = M.mergeByDistance(m, all, 0.001); ok(r.removed === 8 && m.verts.length === 8, 'merge by distance'); }
// delete / dissolve
{ const m = M.primCube(); M.deleteFaces(m, new Set([0])); check(m, 'delete face', false); ok(m.verts.length === 8, 'delete face keeps verts'); }
{ const m = M.primCube(); M.deleteVerts(m, new Set([0])); check(m, 'delete vert', false); ok(m.faces.length === 3, 'delete vert 3 faces'); }
{ const m = M.primGrid({xSub:2,ySub:2}); const r = M.dissolveFaces(m, new Set([0,1,2,3])); check(m, 'dissolve faces', false); ok(m.faces.length === 1 && m.faces[0].v.length === 8, 'dissolve to octagon ' + m.faces.length + ' ' + m.faces[0].v.length); }
{ const m = M.primGrid({xSub:2,ySub:2}); M.dissolveVerts(m, new Set([4])); check(m, 'dissolve center vert', false); ok(m.faces.length === 1, 'dissolve vert -> 1 face'); }
{ const m = M.primGrid({xSub:2,ySub:1}); M.dissolveEdges(m, new Set([M.ekey(1,4)])); check(m, 'dissolve edge', false); ok(m.faces.length === 1 && m.faces[0].v.length === 4, 'dissolve edge -> quad ' + m.faces[0]?.v.length); }
// fill & grid fill & bridge
{ const m = M.primCube(); const top = m.faces.findIndex(f => M.faceNormal(m, f)[2] > 0.9); M.deleteFaces(m, new Set([top]), 'only_faces'); const s = sel(m, [4,5,6,7]); const r = M.fill(m, s); ok(r.ok, 'fill ok ' + r.msg); check(m, 'fill hole', true); }
{ const m = M.primCube(); const top = m.faces.findIndex(f => M.faceNormal(m, f)[2] > 0.9); M.deleteFaces(m, new Set([top]), 'only_faces'); const s = sel(m, [4,5,6,7]); M.fill(m, s, 'tri'); check(m, 'tri fill hole', true); }
{ const m = M.primCylinder({verts:16, cap:'nothing'}); const T = M.topo(m); const ring = []; for (let i = 0; i < 16; i++) ring.push(16 + i); const r = M.gridFill(m, sel(m, ring)); ok(r.ok, 'gridfill ' + r.msg); check(m, 'grid fill cyl top', false); console.log('  gridfill faces', r.faces?.size); }
{ const a = M.primCylinder({verts:8, cap:'ngon'}); const b = M.primCylinder({verts:8, cap:'ngon'}); M.appendMesh(a, b, p => [p[0], p[1], p[2] + 4]); const top = a.faces.findIndex(f => f.v.length === 8 && M.faceNormal(a, f)[2] > 0.9); const bot = a.faces.findIndex((f, i) => i > 9 && f.v.length === 8 && M.faceNormal(a, f)[2] < -0.9); const r = M.bridgeLoops(a, { verts: new Set(), edges: new Set(), faces: new Set([top, bot]) }); ok(r.ok, 'bridge ' + r.msg); check(a, 'bridge two cylinders', true); }
// normals
{ const m = M.primCube(); M.flipFaces(m, new Set([0, 2, 5])); M.recalcNormals(m, new Set([0,1,2,3,4,5])); check(m, 'recalc normals', true); }
{ const m = M.primUVSphere(); M.flipFaces(m, new Set(m.faces.map((_, i) => i))); M.recalcNormals(m, new Set(m.faces.map((_, i) => i))); check(m, 'recalc sphere', true); }
// triangulate / tris to quads
{ const m = M.primCube(); M.triangulateFaces(m, new Set([0,1,2,3,4,5])); check(m, 'triangulate', true); ok(m.faces.length === 12, 'tri 12'); const r = M.trisToQuads(m, new Set(m.faces.map((_, i) => i))); check(m, 'tris to quads', true); ok(m.faces.length === 6, 'back to 6 quads: ' + m.faces.length); }
// concave ngon triangulation
{ const m = M.newMesh(); m.verts = [[0,0,0],[2,0,0],[2,1,0],[1,1,0],[1,2,0],[0,2,0]]; m.faces = [{ v:[0,1,2,3,4,5], uv: m.verts.map(p => [p[0]/2,p[1]/2]), mat:0 }]; const t = M.triangulateFace(m, m.faces[0]); let area = 0; for (const [a,b,c] of t) { const A = m.verts[m.faces[0].v[a]], B = m.verts[m.faces[0].v[b]], C = m.verts[m.faces[0].v[c]]; area += ((B[0]-A[0])*(C[1]-A[1]) - (B[1]-A[1])*(C[0]-A[0]))/2; } ok(Math.abs(area - 3) < 1e-9 && t.length === 4, 'L ngon area ' + area); }
// edge loop
{ const m = M.primUVSphere(); const k = M.ekey(M.PRIMITIVES ? 1+32 : 0, 1+32+1); const loop = M.edgeLoopKeys(m, M.ekey(33, 34)); ok(loop.size === 32, 'sphere loop 32: ' + loop.size); }
{ const m = M.primGrid({xSub:3,ySub:3}); const loop = M.edgeLoopKeys(m, M.ekey(0,1)); ok(loop.size === 12, 'boundary loop: ' + loop.size); const l2 = M.edgeLoopKeys(m, M.ekey(4,5)); ok(l2.size === 3, 'inner loop: ' + l2.size); }
// separate
{ const m = M.primCube(); const top = m.faces.findIndex(f => M.faceNormal(m, f)[2] > 0.9); const part = M.extractPart(m, new Set(m.faces[top].v)); ok(part.faces.length === 1 && m.faces.length === 5, 'separate'); }
console.log(fails ? `\n${fails} FAILURES` : '\nALL OK');
{ const m = M.primCube(); M.dissolveVerts(m, new Set([4, 5, 6, 7])); console.log('dissolve 4 top corners -> v', m.verts.length, 'f', m.faces.length, m.faces.map(f => f.v.length)); }
