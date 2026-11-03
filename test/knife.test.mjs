import assert from 'node:assert/strict';
import {loadSrc} from './loadsrc.mjs';
const {primPlane, primGrid, cloneMesh, knifeCutProjected, topo, ekey, faceArea, faceNormal} = await loadSrc('mesh.js', 'knife.js');
const screen = m => m.verts.map(([x, y]) => ({x: x * 100, y: y * 100, w: 1, valid: true}));
const cut = (m, a, b, visible) => knifeCutProjected(m, screen(m), {x: a[0] * 100, y: a[1] * 100}, {x: b[0] * 100, y: b[1] * 100}, visible);
const area = m => m.faces.reduce((s, f) => s + faceArea(m, f), 0);
const valid = (m, expectedArea = 4) => {
  assert.ok(Math.abs(area(m) - expectedArea) < 1e-9);
  for (const f of m.faces) {
    assert.equal(f.v.length, f.uv.length);
    assert.equal(new Set(f.v).size, f.v.length);
    assert.ok(faceArea(m, f) > 1e-12);
    assert.ok(faceNormal(m, f)[2] > .999);
    assert.ok(f.uv.flat().every(Number.isFinite));
  }
};
const plane = primPlane(), before = cloneMesh(plane);
const diagonal = cut(plane, [-1, -1], [1, 1]);
assert.equal(diagonal.mesh.verts.length, 4, 'Vertex magnets reuse original vertices');
assert.equal(diagonal.mesh.faces.length, 2); assert.deepEqual([...diagonal.edges], ['0_2']);
assert.deepEqual(plane, before, 'Preview never mutates the source'); valid(diagonal.mesh);
const half = cut(plane, [-1, 0], [1, 0]);
assert.equal(half.mesh.verts.length, 6); assert.equal(half.mesh.faces.length, 2); valid(half.mesh);
for (const f of half.mesh.faces) f.v.forEach((v, i) => assert.deepEqual(f.uv[i], [(half.mesh.verts[v][0] + 1) / 2, (half.mesh.verts[v][1] + 1) / 2]));
const grid = primGrid({xSub: 3, ySub: 1});
grid.faces.forEach((f, i) => {f.mat = i; f.uv = f.uv.map(([u, v]) => [u + i * 2, v]);});
const shared = ekey(1, 5); grid.seams.add(shared); grid.creases.add(shared);
const row = cut(grid, [-1, .2], [1, .2]); valid(row.mesh);
assert.equal(row.mesh.faces.length, 6); assert.equal(row.mesh.verts.length, 12, 'Shared edges split only once');
assert.equal(row.mesh.seams.size, 2); assert.equal(row.mesh.creases.size, 2);
assert.ok(!row.mesh.seams.has(shared));
assert.deepEqual(row.mesh.faces.map(f => f.mat), [0, 0, 1, 1, 2, 2]);
const T = topo(row.mesh);
for (const key of row.mesh.seams) assert.equal(T.edgeFaces[T.edgeIndex.get(key)].length, 2, 'No T junction at the seam');
for (const f of row.mesh.faces) f.v.forEach((v, i) => {
  const [x, y] = row.mesh.verts[v];
  assert.ok(Math.abs(f.uv[i][0] - ((x + 1) / 2 + f.mat * 2)) < 1e-12, 'Each side retains its UV island');
  assert.ok(Math.abs(f.uv[i][1] - (y + 1) / 2) < 1e-12);
});
// A second knife segment crosses and splits the first cut, rather than doubling it.
const cross = cut(half.mesh, [0, -1], [0, 1]); valid(cross.mesh);
assert.equal(cross.mesh.faces.length, 4); assert.equal(cross.mesh.verts.length, 9);
assert.equal(cross.replacements.get([...half.edges][0]).length, 2);
assert.equal(cross.mesh.verts.filter(p => Math.hypot(...p) < 1e-10).length, 1);
// Perspective interpolation must use clip W, not linear screen-space distance.
const tilted = primPlane(); tilted.verts.forEach(p => p[2] = p[0] + 3);
const perspective = tilted.verts.map(([x, y, z]) => ({x: x / z * 100, y: y / z * 100, w: z, valid: true}));
const persp = knifeCutProjected(tilted, perspective, {x: -12.5, y: -100}, {x: -12.5, y: 100});
assert.ok(persp);
for (const p of persp.mesh.verts.slice(4)) assert.ok(Math.abs(p[0] / p[2] * 100 + 12.5) < 1e-10, 'Cut stays under the screen line');
for (const f of persp.mesh.faces) f.v.forEach((v, i) => assert.ok(Math.abs(f.uv[i][0] - (persp.mesh.verts[v][0] + 1) / 2) < 1e-12));
// Concave n-gons can have several disjoint intervals under the same knife stroke.
const concave = {verts: [[0,0,0],[3,0,0],[3,3,0],[2,3,0],[2,1,0],[1,1,0],[1,3,0],[0,3,0]], faces: [], looseEdges: [], seams: new Set(), creases: new Set()};
concave.faces = [{v: [0,1,2,3,4,5,6,7], uv: concave.verts.map(p => p.slice(0,2)), mat: 7}];
const concaveCut = cut(concave, [0,2], [3,2]); valid(concaveCut.mesh, 7);
assert.equal(concaveCut.edges.size, 2); assert.equal(concaveCut.mesh.faces.length, 3);
assert.ok(concaveCut.mesh.faces.every(f => f.mat === 7));
const reverse = primPlane(); reverse.faces[0].v.reverse(); reverse.faces[0].uv.reverse();
const reverseCut = cut(reverse, [-1,0], [1,0]);
assert.ok(reverseCut.mesh.faces.every(f => faceNormal(reverseCut.mesh, f)[2] < -.999));
// Occluded faces are excluded by the supplied visibility policy.
assert.equal(cut(plane, [-1,0], [1,0], () => false), null);
assert.equal(cut(plane, [-1,-1], [1,-1]), null, 'Existing boundary is not duplicated');
assert.equal(cut(plane, [-1,-1], [-1,-1]), null);
assert.equal(cut(plane, [-3,0], [-2,0]), null);
assert.equal(cut(plane, [-2,0], [0,2]), null, 'Tangent vertex does not create a face');
// Interior endpoints create real surface vertices, including on hidden render
// diagonals. Their new edges are shared by two faces, never floating wires.
for (const [a,b] of [[[0,0],[.5,.5]], [[-.6,.2],[.5,-.3]], [[-1,0],[.3,.2]], [[-.2,.1],[1,1]]]) {
  const r = cut(plane,a,b); assert.ok(r); valid(r.mesh);
  const topology = topo(r.mesh);
  for (const key of r.edges) assert.equal(topology.edgeFaces[topology.edgeIndex.get(key)].length, 2);
  assert.equal(topology.edgeFaces.filter(fs=>fs.length===1).length, a[0]===-1 && a[1]===0 ? 5 : 4);
  for (const f of r.mesh.faces) f.v.forEach((v,i)=>{
    assert.ok(Math.abs(f.uv[i][0]-(r.mesh.verts[v][0]+1)/2)<1e-10);
    assert.ok(Math.abs(f.uv[i][1]-(r.mesh.verts[v][1]+1)/2)<1e-10);
  });
}
const insideGrid = cut(grid, [-.8,.2], [.8,.2]); valid(insideGrid.mesh);
for (const key of insideGrid.mesh.seams) assert.equal(topo(insideGrid.mesh).edgeFaces[topo(insideGrid.mesh).edgeIndex.get(key)].length,2);
const insideConcave = cut(concave, [.3,.4], [2.7,2.4]); valid(insideConcave.mesh,7);
assert.ok(insideConcave.mesh.faces.every(f=>f.mat===7));
const fromInside = cut(plane, [-.4,.2], [.4,.2]);
const continuing = cut(fromInside.mesh, [.4,.2], [.1,-.4]); valid(continuing.mesh);
const crossingInside = cut(continuing.mesh, [0,-.7], [0,.7]); valid(crossingInside.mesh);
assert.equal(cut(plane, [0,0], [.5,.5], ()=>false),null, 'Hidden face interiors remain untouched');
const perspInside = knifeCutProjected(tilted, perspective, {x:-10,y:3}, {x:15,y:10});
assert.ok(perspInside);
for (const f of perspInside.mesh.faces) f.v.forEach((v,i)=>assert.ok(Math.abs(f.uv[i][0]-(perspInside.mesh.verts[v][0]+1)/2)<1e-10));
// A closed face-interior path and repeated arbitrary strokes retain full area
// and a manifold surface, even when they cross supporting triangles.
let loops=plane;
for (const [a,b] of [[[-.5,-.5],[.5,-.5]], [[.5,-.5],[.5,.5]], [[.5,.5],[-.5,.5]], [[-.5,.5],[-.5,-.5]]]) {
  const r=cut(loops,a,b); assert.ok(r); loops=r.mesh; valid(loops);
  assert.ok(topo(loops).edgeFaces.every(fs=>fs.length<=2));
}
let seed=42;
const rand=()=>((seed=(1664525*seed+1013904223)>>>0)/2**32)*1.8-.9;
for(let i=0;i<40;i++) {
  const a=[rand(),rand()], b=[rand(),rand()], r=cut(plane,a,b); assert.ok(r); valid(r.mesh);
  const total=[...r.edges].reduce((s,key)=>{
    const [a,b]=key.split('_').map(Number), p=r.mesh.verts[a], q=r.mesh.verts[b];
    return s+Math.hypot(p[0]-q[0],p[1]-q[1]);
  },0);
  assert.ok(Math.abs(total-Math.hypot(a[0]-b[0],a[1]-b[1]))<1e-9,'Cut covers exactly the requested stroke');
}
const reverseInterior = cut(reverse,[0,0],[.4,.2]).mesh;
assert.ok(reverseInterior.faces.every(f=>faceNormal(reverseInterior,f)[2]<-.999));
assert.deepEqual(plane, before);
console.log('Knife: vertex reuse, face-interior/edge/cross-face cuts, shared topology, materials, UV seams, creases, perspective, concavity, winding and atomic no-ops passed');
