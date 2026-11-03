import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadSrc } from './loadsrc.mjs';
import { makeU8 } from './szs-fixture.mjs';
const api = await loadSrc('szs.js');
for (const size of [0, 1, 2, 3, 7, 8, 9, 17, 18, 273, 274, 4095, 4096, 4097, 32769, 1048576]) {
  for (const data of [
    new Uint8Array(size).fill(37),
    new Uint8Array(randomBytes(size)),
    Uint8Array.from({ length: size }, (_, i) => i % 197),
  ]) {
    assert.deepEqual(api.decodeYaz0(api.encodeYaz0(data)), data);
  }
}
const known = new Uint8Array([89, 97, 122, 48, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 128, 65, 0x30, 0]);
assert.equal(new TextDecoder().decode(api.decodeYaz0(known)), 'AAAAAA');
for (const b of [
  known.slice(0, 18),
  new Uint8Array(16),
  new Uint8Array([89, 97, 122, 48, 255, 255, 255, 255, ...new Uint8Array(8)]),
])
  assert.throws(() => api.decodeYaz0(b));
const invalid = known.slice();
invalid[16] = 0;
assert.throws(() => api.decodeYaz0(invalid), /back-reference/);
const tooLong = known.slice();
tooLong[18] = 0x40;
assert.throws(() => api.decodeYaz0(tooLong), /back-reference/);
const text = (s) => new TextEncoder().encode(s);
const tree = {
  'course_model.brres': text('original model'),
  'course.kcl': text('original collision'),
  'course.kmp': text('original placement'),
  empty: {},
  assets: {
    'texture.bin': new Uint8Array(randomBytes(16384)),
    'empty.bin': new Uint8Array(),
    nested: { 'data.dat': text('Keep this exactly') },
  },
};
for (const point of [false, true])
  for (const compressed of [false, true]) {
    const raw = makeU8(tree, point),
      source = compressed ? api.encodeYaz0(raw) : raw,
      archive = api.inspectSZS(source);
    const files = archive.nodes.filter((n) => !n.directory),
      id = files.find((n) => n.name === 'course_model.brres').id;
    assert.equal(files.length, 6);
    assert.equal(archive.nodes.filter((n) => n.directory).length, point ? 5 : 4);
    assert.deepEqual(api.saveSZS(archive, new Map(), { compressed }), source);
    for (const replacement of [new Uint8Array(), text('tiny'), new Uint8Array(randomBytes(20003))]) {
      const changes = new Map([[id, replacement]]),
        saved = api.saveSZS(archive, changes),
        again = api.inspectSZS(saved);
      assert.ok(again.compressed);
      assert.deepEqual(
        again.nodes.map((n) => [n.name, n.path, n.parent, n.directory, n.end]),
        archive.nodes.map((n) => [n.name, n.path, n.parent, n.directory, n.end]),
      );
      for (const n of files)
        assert.deepEqual(api.szsEntryBytes(again, n.id), n.id === id ? replacement : api.szsEntryBytes(archive, n.id));
      for (const n of again.nodes.filter((n) => !n.directory)) assert.equal(n.offset % 32, 0);
    }
    assert.throws(() => api.saveSZS(archive, new Map([[0, new Uint8Array()]])), /target/);
    assert.throws(() => api.szsEntryBytes(archive, 0), /file/);
    const bad = raw.slice(),
      v = new DataView(bad.buffer);
    v.setUint32(32 + id * 12 + 4, bad.length + 1);
    assert.throws(() => api.inspectSZS(bad), /outside/);
    v.setUint32(4, 0xfffffff0);
    assert.throws(() => api.inspectSZS(bad), /bounds/);
    const dir = raw.slice();
    dir[32 + 12] = 4;
    assert.throws(() => api.inspectSZS(dir), /node type/);
  }
// Independent reader/writer compatibility, enabled when Wiimm's tools are installed.
if (process.env.WIIMM_BIN) {
  const tool = path.resolve(process.env.WIIMM_BIN, 'wszst'),
    root = path.resolve('work/szs-validation');
  fs.mkdirSync(root, { recursive: true });
  // Wiimm extraction treats a zero-length entry as the remaining data span; the core tests above cover exact zero-length preservation.
  const externalTree = { ...tree, assets: { ...tree.assets } };
  delete externalTree.assets['empty.bin'];
  const archive = api.inspectSZS(makeU8(externalTree)),
    id = archive.nodes.find((n) => n.name === 'course.kcl').id,
    changed = text('replacement collision payload');
  fs.writeFileSync(path.join(root, 'original.szs'), api.encodeYaz0(archive.bytes));
  fs.writeFileSync(path.join(root, 'edited.szs'), api.saveSZS(archive, new Map([[id, changed]])));
  execFileSync(
    tool,
    [
      'extract',
      path.join(root, 'edited.szs'),
      '--dest',
      path.join(root, 'extracted'),
      '--overwrite',
      '--recurse=0',
      '--no-check',
    ],
    { stdio: 'pipe' },
  );
  for (const n of archive.nodes.filter((n) => !n.directory))
    assert.deepEqual(
      new Uint8Array(fs.readFileSync(path.join(root, 'extracted', n.path))),
      n.id === id ? changed : api.szsEntryBytes(archive, n.id),
    );
  execFileSync(
    tool,
    [
      'create',
      path.join(root, 'extracted'),
      '--dest',
      path.join(root, 'wiimm.szs'),
      '--overwrite',
      '--szs',
      '--no-encode',
      '--no-check',
    ],
    { stdio: 'pipe' },
  );
  const external = api.inspectSZS(new Uint8Array(fs.readFileSync(path.join(root, 'wiimm.szs'))));
  for (const n of archive.nodes.filter((n) => !n.directory)) {
    const other = external.nodes.find(
      (o) => !o.directory && o.path.replace(/^\.\//, '') === n.path.replace(/^\.\//, ''),
    );
    assert.ok(other, n.path);
    assert.deepEqual(api.szsEntryBytes(external, other.id), n.id === id ? changed : api.szsEntryBytes(archive, n.id));
  }
  console.log('Wiimm independently extracted our SZS byte-for-byte; its rebuilt Yaz0/U8 archive reopens correctly');
}
console.log(
  'Yaz0 literals/overlap/window boundaries/random payloads, U8 hierarchy/bounds, file replacement/growth/shrink/empty/preservation passed',
);
