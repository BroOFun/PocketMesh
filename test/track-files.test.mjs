import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadSrc } from './loadsrc.mjs';
const a = await loadSrc('kcl.js', 'kmp.js');
assert.equal(a.KCL_TYPES.length, 32);
assert.ok(a.KCL_TYPES.every((t) => t.variants.length === 8));
for (let flag = 0; flag < 65536; flag++) assert.equal(a.encodeKCLFlag(a.decodeKCLFlag(flag)), flag);
assert.equal(a.encodeKCLFlag({ type: 3, variant: 4, blight: 3, trick: true }), 0x2383);
assert.equal(a.kclCatalogCSV().split('\r\n').length, 257);
assert.throws(() => a.encodeKCLFlag({ type: 32 }), /Invalid/);
const triangles = [];
for (let x = 0; x < 20; x++)
  for (let z = 0; z < 20; z++) {
    const p = [x * 500, 200 + x * 10, z * 500],
      q = [p[0] + 400, p[1] + 8, p[2]],
      r = [p[0], p[1], p[2] + 400];
    triangles.push({ points: [p, r, q], flag: (x + z) % 32 });
  }
const kcl = a.exportKCL(triangles);
assert.equal(kcl.triangleCount, 400);
assert.ok(kcl.nodeCount > 1);
const v = new DataView(kcl.bytes.buffer),
  position = v.getUint32(0),
  normal = v.getUint32(4),
  prism = v.getUint32(8),
  tree = v.getUint32(12);
const vec = (o) => [0, 1, 2].map((i) => v.getFloat32(o + i * 4)),
  cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
function candidates(p) {
  const xyz = p.map((n, i) => Math.trunc(n - v.getFloat32(20 + i * 4)));
  if (xyz.some((n, i) => (n & v.getUint32(32 + i * 4)) !== 0)) return [];
  let base = tree,
    shift = v.getUint32(44),
    index = (xyz[0] >>> shift) | ((xyz[1] >>> shift) << v.getUint32(48)) | ((xyz[2] >>> shift) << v.getUint32(52));
  for (let depth = 0; depth < 32; depth++) {
    const off = v.getUint32(base + index * 4);
    if (off & 0x80000000) {
      const out = [];
      let ptr = base + (off & 0x7fffffff);
      assert.equal(v.getUint16(ptr), 0);
      while (v.getUint16((ptr += 2))) out.push(v.getUint16(ptr));
      return out;
    }
    base += off;
    shift--;
    index = ((xyz[0] >>> shift) & 1) | (((xyz[1] >>> shift) & 1) << 1) | (((xyz[2] >>> shift) & 1) << 2);
  }
  throw new Error('bad tree');
}
triangles.forEach((t, i) => {
  const off = prism + (i + 1) * 16,
    len = v.getFloat32(off),
    p = vec(position + v.getUint16(off + 4) * 12),
    n = vec(normal + v.getUint16(off + 6) * 12),
    e1 = vec(normal + v.getUint16(off + 8) * 12),
    e2 = vec(normal + v.getUint16(off + 10) * 12),
    e3 = vec(normal + v.getUint16(off + 12) * 12);
  assert.equal(v.getUint16(off + 14), t.flag);
  const b = cross(e2, n),
    c = cross(e1, n),
    pts = [p, p.map((x, j) => x + (b[j] * len) / dot(b, e3)), p.map((x, j) => x + (c[j] * len) / dot(c, e3))];
  pts.forEach((p, j) => p.forEach((x, k) => assert.ok(Math.abs(x - t.points[j][k]) < 0.005)));
  const center = [0, 1, 2].map((k) => t.points.reduce((sum, p) => sum + p[k] / 3, 0));
  for (const point of [center, ...t.points, center.map((x, j) => x + n[j] * 249), center.map((x, j) => x - n[j] * 299)])
    assert.ok(candidates(point).includes(i + 1), 'octree must contain nearby prism ' + i);
});
assert.deepEqual(candidates([-1e8, 0, 0]), []);
assert.throws(() => a.exportKCL([]), /No collision/);
assert.throws(
  () =>
    a.exportKCL([
      {
        points: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        flag: 0,
      },
    ]),
  /degenerate/,
);
const start = { position: [12, -34, 5.2], rotation: [0, 90, 0] },
  bytes = a.exportKMP(start, { scale: 100 }),
  parsed = a.inspectKMP(bytes);
assert.equal(parsed.sections.length, 15);
assert.deepEqual(parsed.start, { position: [1200, 520, 3400], rotation: [0, 90, 0] });
assert.deepEqual(a.trackFromWii(parsed.start.position, 100), start.position);
const again = a.exportKMP({ ...start, position: [8, 9, 10] }, { scale: 100, template: bytes }),
  after = a.inspectKMP(again);
for (const s of parsed.sections)
  if (s.name !== 'KTPT') assert.deepEqual(s.bytes, after.sections.find((t) => t.name === s.name).bytes);
assert.throws(() => a.inspectKMP(new Uint8Array(10)), /Not a/);
assert.throws(() => a.exportKMP({ ...start, position: [1e300, 0, 0] }), /number range/);
assert.equal(parsed.sections.find((s) => s.name === 'ENPT').count, 4);
assert.equal(parsed.sections.find((s) => s.name === 'CKPT').count, 4);
const bufferInput = Buffer.from(bytes),
  bufferBefore = Buffer.from(bufferInput);
a.exportKMP({ ...start, position: [1, 2, 3] }, { template: bufferInput });
assert.deepEqual(bufferInput, bufferBefore, 'Buffer input must stay immutable');
const broken = bytes.slice();
new DataView(broken.buffer).setUint32(16, 0xffffffff);
assert.throws(() => a.inspectKMP(broken), /offset/);
// Preserve additional kart points, player index and padding while patching KTPT #0.
const multi = new Uint8Array(bytes.length + 28), mv = new DataView(multi.buffer);
multi.set(bytes.slice(0,112)); multi.set(bytes.slice(84,112),112); multi.set(bytes.slice(112),140);
mv.setUint32(4,multi.length); mv.setUint16(80,2); mv.setInt16(108,7); mv.setUint16(110,0xabcd);
for(let i=1;i<15;i++) mv.setUint32(16+i*4,mv.getUint32(16+i*4)+28);
const multiPatched=a.exportKMP({...start,position:[9,8,7]},{template:multi});
assert.deepEqual(multiPatched.slice(108,140),multi.slice(108,140));
const restored = a.normalizeTrack({ scale: 100, start, template: 'abc' });
start.position[0] = 99;
assert.equal(restored.start.position[0], 12);
fs.mkdirSync('work', { recursive: true });
fs.writeFileSync('work/generated-course.kcl', kcl.bytes);
fs.writeFileSync('work/generated-course.kmp', bytes);
if (process.env.RIISTUDIO_SAMPLES) {
  for (const name of ['luigi_circuit.kmp', 'strobenz.kmp']) {
    const src = fs.readFileSync(process.env.RIISTUDIO_SAMPLES + '/' + name),
      before = a.inspectKMP(src),
      patched = a.inspectKMP(a.exportKMP(start, { scale: 100, template: src }));
    for (const s of before.sections)
      if (s.name !== 'KTPT') assert.deepEqual(s.bytes, patched.sections.find((t) => t.name === s.name).bytes);
  }
}
if (process.env.WIIMM_BIN) {
  const dir = process.env.WIIMM_BIN;
  for (const [tool, file] of [
    ['wkclt', 'kcl'],
    ['wkmpt', 'kmp'],
  ]) {
    const output = execFileSync(
      dir + '/' + tool,
      [tool === 'wkmpt' ? 'cat' : 'dump', 'work/generated-course.' + file],
      { encoding: 'utf8' },
    );
    assert.ok(output.length > 100);
    fs.writeFileSync('work/wiimm-' + file + '.txt', output);
    execFileSync(dir + '/' + tool, ['check', 'work/generated-course.' + file], { encoding: 'utf8' });
  }
  console.log('Independent Wiimm readers accepted KCL and KMP');
}
console.log(
  'Track files: 65,536 flag round trips, 400 prism reconstructions/octree queries, KMP transforms/preservation passed',
);
