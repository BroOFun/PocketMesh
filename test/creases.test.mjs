import assert from 'node:assert/strict';
import { loadSrc } from './loadsrc.mjs';
const api = await loadSrc('mesh.js', 'modifiers.js', 'export.js');
const {
  primCube,
  primPlane,
  cloneMesh,
  markFaceCreases,
  subdivisionSurface,
  topo,
  ekey,
  exportOBJ,
  removeVerts,
  appendMesh,
  extractFaces,
  duplicateSel,
  subdivide,
  applyVertMap,
} = api;
const plane = primPlane();
assert.deepEqual(subdivisionSurface(plane, 3, 'catmull-clark', 'keep-corners').verts.slice(0, 4), plane.verts);
assert.notDeepEqual(subdivisionSurface(plane, 1).verts[0], plane.verts[0]);
const strip = {
  verts: [
    [0, 0, 0],
    [1, -1, 0],
    [2, 0, 0],
    [0, 2, 0],
    [1, 2, 0],
    [2, 2, 0],
  ],
  faces: [
    [0, 1, 4, 3],
    [1, 2, 5, 4],
  ].map((v) => ({ v, uv: v.map(() => [0, 0]), mat: 0 })),
  looseEdges: [],
  seams: new Set(),
  creases: new Set(),
};
assert.deepEqual(subdivisionSurface(strip, 2, 'catmull-clark', 'keep-boundary').verts.slice(0, 6), strip.verts);
assert.deepEqual(subdivisionSurface(strip, 1, 'catmull-clark', 'keep-corners').verts[1], [1, -0.75, 0]);
const cube = primCube();
assert.equal(markFaceCreases(cube, [0]), 4);
assert.equal(markFaceCreases(cube, [0]), 0);
const creased = subdivisionSurface(cube, 1),
  t = topo(cube);
for (const key of cube.creases) {
  const [a, b] = key.split('_').map(Number),
    p = creased.verts[8 + t.edgeIndex.get(key)];
  assert.deepEqual(
    p,
    cube.verts[a].map((v, k) => (v + cube.verts[b][k]) / 2),
    'crease edge uses midpoint',
  );
}
assert.equal(creased.creases.size, 8);
assert.equal(subdivisionSurface(cube, 3).creases.size, 32);
markFaceCreases(
  cube,
  cube.faces.map((_, i) => i),
);
const sharp = subdivisionSurface(cube, 3);
assert.deepEqual(sharp.verts.slice(0, 8), cube.verts, 'three sharp edges pin cube corners');
const text = exportOBJ({ objects: [{ mesh: sharp }], materials: [] }, { yUp: false })[0].data;
const obj = typeof text === 'string' ? text : new TextDecoder().decode(text);
const normals = obj
  .split('\n')
  .filter((l) => l.startsWith('vn '))
  .map((l) => l.split(' ').slice(1).map(Number));
assert.equal(normals.length, 6, 'OBJ exports six hard normals');
assert.ok(
  normals.every((n) => n.filter((v) => Math.abs(v) > 1e-8).length === 1),
  'exported crease normals remain axis-aligned',
);
const copy = cloneMesh(cube);
markFaceCreases(copy, [0], false);
assert.equal(copy.creases.size, 8);
assert.equal(cube.creases.size, 12);
// Tag remapping after deletion, duplication, splitting, joining, separation and welding.
const sameTags = (m) => {
  assert.deepEqual([...m.creases].sort(), [...m.seams].sort());
  for (const key of m.creases) assert.ok(topo(m).edgeIndex.has(key), 'no stale crease ' + key);
};
const tagged = () => {
  const m = primCube();
  m.seams = new Set(cube.creases);
  m.creases = new Set(cube.creases);
  return m;
};
let m = tagged();
removeVerts(m, new Set([0]));
sameTags(m);
m = tagged();
duplicateSel(m, { faces: new Set([0]), verts: new Set(), edges: new Set() });
sameTags(m);
assert.equal(m.creases.size, 16);
m = tagged();
subdivide(m, new Set([0]));
sameTags(m);
assert.equal(m.creases.size, 16);
m = tagged();
appendMesh(m, tagged());
sameTags(m);
assert.equal(m.creases.size, 24);
const part = extractFaces(m, new Set([0]));
sameTags(m);
sameTags(part);
assert.equal(part.creases.size, 4);
m = tagged();
applyVertMap(m, new Map([[0, 1]]));
sameTags(m);
const old = primCube();
delete old.creases;
assert.equal(cloneMesh(old).creases.size, 0);
assert.equal(subdivisionSurface(old).creases.size, 0);
console.log('Crease geometry, boundary modes, hard normals/export and topology remapping passed');
