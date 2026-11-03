import assert from 'node:assert/strict';
import { loadSrc } from './loadsrc.mjs';
const a = await loadSrc('mesh.js', 'extrude.js', 'kmp.js');
const selection = () => ({ verts: new Set([2, 3]), edges: new Set(['2_3']), faces: new Set() });
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-8, `${a} != ${b}`));
const center = (m, ids) => [0, 1, 2].map((k) => [...ids].reduce((n, i) => n + m.verts[i][k] / ids.size, 0));
let m = a.primPlane();
m.faces[0].mat = 3;
m.seams.add('2_3');
m.creases.add('2_3');
let r = a.extrudeToPoint(m, selection(), [3, 4, 0]);
assert.equal(m.faces.length, 2);
assert.equal(m.faces[1].mat, 3);
near(center(m, r.verts), [3, 4, 0]);
near(m.verts[2], [1, 1, 0]);
near(m.verts[3], [-1, 1, 0]);
let ids = [...r.verts];
near(
  m.verts[ids[1]].map((v, i) => v - m.verts[ids[0]][i]),
  [2, 0, 0],
);
// Blender-style full rotation of the new section, with optional half-turn of source.
for (const rotateSource of [false, true]) {
  m = a.primPlane();
  r = a.extrudeToPoint(m, selection(), [3, 4, 0], { rotate: true, rotateSource, direction: [0, 1, 0] });
  near(center(m, r.verts), [3, 4, 0]);
  ids = [...r.verts];
  near(
    m.verts[ids[1]].map((v, i) => v - m.verts[ids[0]][i]),
    [Math.SQRT2, -Math.SQRT2, 0],
  );
  const theta = rotateSource ? Math.PI / 8 : 0;
  near(m.verts[2], [Math.cos(theta), 1 - Math.sin(theta), 0]);
  assert.ok(
    m.faces.every((f) => a.faceNormal(m, f)[2] > 0.99),
    'upward road winding',
  );
}
// Repeated taps retain the new boundary as the next source, at constant width.
let sel = { verts: r.verts, edges: new Set([a.ekey(...r.verts)]), faces: new Set() };
r = a.extrudeToPoint(m, sel, [5, 7, 0], { rotate: true, rotateSource: true, direction: [1, 1, 0] });
near(center(m, r.verts), [5, 7, 0]);
ids = [...r.verts];
assert.ok(Math.abs(Math.hypot(...m.verts[ids[0]].map((v, i) => v - m.verts[ids[1]][i])) - 2) < 1e-8);
const unchanged = JSON.stringify(m);
assert.equal(a.extrudeToPoint(m, { verts: r.verts, edges: new Set(), faces: new Set() }, [5, 7, 0]), null);
assert.equal(JSON.stringify(m), unchanged);
assert.throws(() => a.extrudeToPoint(m, sel, [NaN, 0, 0]), /target/);
// No selection adds a vertex; a selected vertex starts a wire chain.
m = a.newMesh();
r = a.extrudeToPoint(m, { verts: new Set(), edges: new Set(), faces: new Set() }, [2, 3, 4]);
assert.equal(r.addedVertex, true);
r = a.extrudeToPoint(m, { verts: r.verts, edges: new Set(), faces: new Set() }, [5, 6, 4], { rotate: true });
assert.equal(m.looseEdges.length, 1);
near(center(m, r.verts), [5, 6, 4]);
// A face cap follows the target and remains selected as a face by its vertices.
m = a.primCube();
const f = m.faces[1];
r = a.extrudeToPoint(
  m,
  { verts: new Set(f.v), edges: new Set(f.v.map((v, i) => a.ekey(v, f.v[(i + 1) % f.v.length]))), faces: new Set([1]) },
  [0, 0, 4],
);
near(center(m, r.verts), [0, 0, 4]);
assert.equal(m.faces.length, 10);
// 100x defaults and migration are stable through subsequent save/undo snapshots.
assert.equal(a.normalizeTrack().scale, 100);
assert.equal(a.normalizeTrack({ scale: 1 }).scale, 100);
assert.equal(a.normalizeTrack({ scale: 75 }).scale, 75);
assert.equal(a.normalizeTrack({ scale: 1, scaleVersion: 1 }).scale, 1);
const normalized = a.normalizeTrack({ scale: 1, start: { position: [1, 2, 3], rotation: [0, 90, 0] } });
assert.deepEqual(a.normalizeTrack(normalized), normalized);
assert.deepEqual(
  a.inspectKMP(a.exportKMP(normalized.start, { scale: normalized.scale })).start.position,
  [100, 300, -200],
);
console.log(
  'Tap extrusion: translation, turn/source rotation, width, winding, repeated taps, empty/vertex/face cases; 100x scale migration passed',
);
