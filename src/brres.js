// Static NW4R BRRES export: MDL0 v11 + tiled RGBA8 TEX0 v3.
// Original implementation; format references and limits: TRACK-AUTHORING.md.
// Uses export.js's geometry preparation (triangulation, transforms, normals).
class _BrWriter {
  constructor() { this.bytes = new Uint8Array(65536); this.view = new DataView(this.bytes.buffer); this.length = 0; this.strings = []; }
  alloc(size, align = 4) {
    const at = Math.ceil(this.length / align) * align, end = at + size;
    if (end > 64 * 1024 * 1024) throw new Error('BRRES exceeds 64 MB. Reduce geometry or texture sizes.');
    if (end > this.bytes.length) { const b = new Uint8Array(Math.max(end, this.bytes.length * 2)); b.set(this.bytes); this.bytes = b; this.view = new DataView(b.buffer); }
    this.length = end; return at;
  }
  u8(at, n) { this.view.setUint8(at, n); }
  u16(at, n) { this.view.setUint16(at, n); }
  u32(at, n) { this.view.setUint32(at, n >>> 0); }
  f32(at, n) { if (!Number.isFinite(n) || Math.abs(n) > 3.4e38) throw new Error('Non-finite geometry in BRRES export'); this.view.setFloat32(at, n); }
  text(at, s) { this.bytes.set(new TextEncoder().encode(s), at); }
  str(at, base, value) { this.strings.push({ at, base, value }); }
  bp(at, reg, value) { this.u8(at, 0x61); this.u32(at + 1, (reg << 24) | (value & 0xffffff)); return at + 5; }
  cp(at, reg, value) { this.u8(at, 0x08); this.u8(at + 1, reg); this.u32(at + 2, value); return at + 6; }
  xf(at, reg, value) { this.u8(at, 0x10); this.u16(at + 1, 0); this.u16(at + 3, reg); this.u32(at + 5, value); return at + 9; }
  finish() {
    const names = new Map();
    for (const { at, base, value } of this.strings) {
      if (!names.has(value)) { const data = new TextEncoder().encode(value), p = this.alloc(4 + data.length + 1); this.u32(p, data.length); this.bytes.set(data, p + 4); names.set(value, p + 4); }
      this.u32(at, names.get(value) - base);
    }
    this.alloc(0, 128); this.u32(8, this.length);
    return this.bytes.slice(0, this.length);
  }
}

// NW4R resource dictionaries use a Patricia tree, with descending bit indices.
// The serialized entry order is also the model resource index order.
function _brDictionary(w, entries) {
  if (!entries.length) return 0;
  const at = w.alloc(24 + 16 * entries.length);
  const nodes = [{ name: '', bit: 65535, left: 0, right: 0 }];
  const bitAt = (name, bit) => ((name.charCodeAt(bit >>> 3) || 0) >>> (bit & 7)) & 1;
  for (const entry of entries) {
    const i = nodes.length, name = entry.name;
    let leaf = nodes[0].left, parent = 0;
    while (nodes[parent].bit > nodes[leaf].bit) { parent = leaf; leaf = bitAt(name, nodes[leaf].bit) ? nodes[leaf].right : nodes[leaf].left; }
    const other = nodes[leaf].name;
    let bit = -1;
    for (let b = Math.max(name.length, other.length) * 8 - 1; b >= 0; b--) if (bitAt(name, b) !== bitAt(other, b)) { bit = b; break; }
    if (bit < 0) throw new Error('Duplicate BRRES resource name: ' + name);
    parent = 0; let child = nodes[0].left;
    while (nodes[parent].bit > nodes[child].bit && nodes[child].bit > bit) { parent = child; child = bitAt(name, nodes[child].bit) ? nodes[child].right : nodes[child].left; }
    const one = bitAt(name, bit);
    nodes.push({ name, bit, left: one ? child : i, right: one ? i : child });
    if (parent !== 0 && bitAt(name, nodes[parent].bit)) nodes[parent].right = i; else nodes[parent].left = i;
  }
  w.u32(at, 24 + 16 * entries.length); w.u32(at + 4, entries.length);
  nodes.forEach((n, i) => {
    const p = at + 8 + i * 16;
    w.u16(p, n.bit); w.u16(p + 4, n.left); w.u16(p + 6, n.right);
    if (i) { w.str(p + 8, at, n.name); entries[i - 1].patch = (target) => w.u32(p + 12, target - at); }
  });
  return at;
}
function _brNames() {
  const seen = new Set();
  return (name) => { const base = String(name || 'resource').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) || 'resource'; let n = base, i = 1; while (seen.has(n)) n = base + '_' + i++; seen.add(n); return n; };
}
function _brBounds(points) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  return [lo, hi];
}
function _brWriteBounds(w, at, bounds) { bounds.flat().forEach((v, i) => w.f32(at + 4 * i, v)); }
function _brSRGB(v) { return Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055))); }

export function encodeWiiRGBA8(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024 || (width & (width - 1)) || (height & (height - 1))) throw new Error('BRRES textures must have power-of-two dimensions up to 1024');
  if (!rgba || rgba.length !== width * height * 4) throw new Error('BRRES needs decoded RGBA texture pixels');
  const data = new Uint8Array(Math.ceil(width / 4) * Math.ceil(height / 4) * 64);
  let block = 0;
  for (let by = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4) {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const src = (Math.min(by + y, height - 1) * width + Math.min(bx + x, width - 1)) * 4, i = (y * 4 + x) * 2;
      data[block + i] = rgba[src + 3]; data[block + i + 1] = rgba[src];
      data[block + 32 + i] = rgba[src + 1]; data[block + 33 + i] = rgba[src + 2];
    }
    block += 64;
  }
  return data;
}

function _brShader(w, mdl, index, textured) {
  const at = w.alloc(512, 32);
  w.u32(at, 512); w.u32(at + 4, mdl - at); w.u32(at + 8, index); w.u8(at + 12, 1);
  for (let i = 0; i < 8; i++) w.u8(at + 16 + i, textured && i === 0 ? 0 : 255);
  let p = at + 32;
  // Identity swizzle tables. KSEL shares registers with the swizzle bits.
  for (let i = 0; i < 8; i++) { p = w.bp(p, 0xfe, 15); p = w.bp(p, 0xf6 + i, i % 2 ? 14 : 4); }
  w.bp(p, 0x27, 0xffffff);
  p = at + 0x80;
  p = w.bp(p, 0xfe, 0xfffff0); p = w.bp(p, 0xf6, 0);
  p = w.bp(p, 0x28, (textured ? 0x40 : 0) | (7 << 15) | (7 << 19));
  // color = texture * raster color, or raster color alone.
  p = w.bp(p, 0xc0, (1 << 19) | (15 << 12) | ((textured ? 8 : 15) << 8) | ((textured ? 10 : 15) << 4) | (textured ? 15 : 10));
  p += 5;
  p = w.bp(p, 0xc1, (1 << 19) | (7 << 13) | ((textured ? 4 : 7) << 10) | ((textured ? 5 : 7) << 7) | ((textured ? 7 : 5) << 4));
  p += 5; w.bp(p, 0x10, 0);
  return at;
}
function _brMaterial(w, mdl, m, index, name, texName) {
  const at = w.alloc(0x418 + (texName ? 0x34 : 0));
  w.u32(at + 4, mdl - at); w.str(at + 8, at, name); w.u32(at + 12, index);
  const blend = m.alphaMode === 'blend' || ((!m.alphaMode || m.alphaMode === 'auto') && m.alpha < 1);
  const cutout = m.alphaMode === 'cutout';
  w.u32(at + 16, blend ? 0x80000000 : 0);
  w.u8(at + 20, texName ? 1 : 0); w.u8(at + 21, 1); w.u8(at + 22, 1);
  w.u32(at + 24, m.doubleSided === false ? 2 : 0);
  w.u8(at + 28, cutout ? 0 : 1); w.u8(at + 29, 255); w.u8(at + 30, 255);
  w.u32(at + 0x2c, texName ? 1 : 0); w.u32(at + 0x30, texName ? 0x418 : 0);
  w.u32(at + 0x1a8, 0xffffffff); // identity SRT for all eight texture matrices
  for (let i = 0; i < 8; i++) {
    const p = at + 0x250 + i * 0x34;
    w.u8(p, 255); w.u8(p + 1, 255); w.u8(p + 3, 1);
    for (let a = 0; a < 3; a++) w.f32(p + 4 + a * 20, 1);
  }
  // Unlit material register color, including tint and opacity. PBR is not a GX shader.
  w.u32(at + 0x3f0, 63);
  m.color.forEach((c, i) => w.u8(at + 0x3f4 + i, _brSRGB(c)));
  w.u8(at + 0x3f7, m.alphaMode === 'opaque' ? 255 : Math.round(m.alpha * 255));
  w.u32(at + 0x3f8, 0xffffffff);
  let sampler = 0;
  if (texName) {
    sampler = at + 0x418;
    w.str(sampler, sampler, texName);
    w.u32(sampler + 0x18, m.wrap === 'extend' ? 0 : 1); w.u32(sampler + 0x1c, m.wrap === 'extend' ? 0 : 1);
    const f = m.filter === 'nearest' ? 0 : 1;
    w.u32(sampler + 0x20, f); w.u32(sampler + 0x24, f);
  }
  const dl = w.alloc(0x180, 32);
  w.u32(at + 0x3c, dl - at);
  let p = dl;
  p = w.bp(p, 0xf3, ((cutout ? 6 : 7) << 16) | (7 << 19) | (cutout ? Math.round((m.alphaCutoff ?? 0.5) * 255) : 0));
  p = w.bp(p, 0x40, 1 | (3 << 1) | (blend ? 0 : 16));
  p = w.bp(p, 0xfe, 0xffe3);
  p = w.bp(p, 0x41, blend ? 1 | (4 << 8) | (5 << 5) : 0);
  w.bp(p, 0x42, 0);
  // Explicit color register initialization avoids dependence on a previous material.
  p = dl + 0x20;
  for (let i = 1; i < 4; i++) { p = w.bp(p, 0xe0 + i * 2, 0xff0ff); for (let j = 0; j < 3; j++) p = w.bp(p, 0xe1 + i * 2, 0xff0ff); }
  p = dl + 0x60;
  for (let i = 0; i < 4; i++) { p = w.bp(p, 0xe0 + i * 2, 0x8ff0ff); p = w.bp(p, 0xe1 + i * 2, 0x8ff0ff); }
  w.bp(dl + 0xa0, 0x25, 0); w.bp(dl + 0xa5, 0x26, 0);
  if (texName) { w.xf(dl + 0xe0, 0x1040, 5 << 7); w.xf(dl + 0xe9, 0x1050, 61); }
  w.u32(at, w.length - at);
  return { at, sampler, blend };
}
function _brBuffer(w, mdl, index, name, values, dimension, kind) {
  const at = w.alloc(kind === 'position' ? 0x40 : kind === 'uv' ? 0x40 : 0x20, 32);
  const data = w.alloc(values.length * dimension * 4, 32);
  w.u32(at + 4, mdl - at); w.u32(at + 8, data - at); w.str(at + 12, at, name);
  w.u32(at + 16, index); w.u32(at + 20, kind === 'normal' ? 0 : 1); w.u32(at + 24, 4);
  w.u8(at + 29, dimension * 4); w.u16(at + 30, values.length);
  if (kind === 'position') _brWriteBounds(w, at + 32, _brBounds(values));
  if (kind === 'uv') for (let a = 0; a < 2; a++) {
    let lo = Infinity, hi = -Infinity;
    for (const v of values) { lo = Math.min(lo, v[a]); hi = Math.max(hi, v[a]); }
    w.f32(at + 32 + a * 4, lo); w.f32(at + 40 + a * 4, hi);
  }
  let p = data; for (const v of values) for (const n of v) { w.f32(p, n); p += 4; }
  w.alloc(0, 32); w.u32(at, w.length - at);
  return at;
}
function _brShape(w, mdl, index, name, count) {
  const at = w.alloc(0x70, 32);
  w.u32(at + 4, mdl - at); // matrix 0 (single rigid root bone)
  const vcdLo = (3 << 9) | (3 << 11), vcdHi = 3, xfSpec = (1 << 2) | (1 << 4);
  w.u32(at + 0xc, vcdLo); w.u32(at + 0x10, vcdHi); w.u32(at + 0x14, xfSpec);
  w.u32(at + 0x30, (1 << 9) | (1 << 10) | (1 << 13));
  w.str(at + 0x38, at, name); w.u32(at + 0x3c, index);
  w.u32(at + 0x40, count); w.u32(at + 0x44, count / 3);
  for (let i = 0x48; i <= 0x62; i += 2) w.u16(at + i, 65535);
  w.u16(at + 0x48, index); w.u16(at + 0x4a, index); w.u16(at + 0x50, index);
  w.u32(at + 0x64, 0x68); // empty used-matrix table for a single-bound shape
  const setup = w.alloc(0xe0, 32);
  w.u32(at + 0x18, 0xe0); w.u32(at + 0x1c, 0xe0); w.u32(at + 0x20, setup - at - 0x18);
  let p = setup + 10;
  p = w.cp(p, 0x50, vcdLo); p = w.cp(p, 0x60, vcdHi); p = w.xf(p, 0x1008, xfSpec); p++;
  p = w.cp(p, 0x70, 1 | (4 << 1) | (4 << 10) | (1 << 21) | (4 << 22) | (1 << 30));
  p = w.cp(p, 0x80, 0); w.cp(p, 0x90, 0);
  const primitive = w.alloc(3 + count * 6, 32);
  w.u8(primitive, 0x90); w.u16(primitive + 1, count);
  p = primitive + 3;
  for (let i = 0; i < count; i++) for (let a = 0; a < 3; a++) { w.u16(p, i); p += 2; }
  w.alloc(0, 32);
  w.u32(at + 0x24, w.length - primitive); w.u32(at + 0x28, w.length - primitive); w.u32(at + 0x2c, primitive - at - 0x24);
  w.u32(at, w.length - at);
  return at;
}

export function exportBRRES(scene, opts = {}) {
  const scale = opts.scale === undefined ? 1 : Number(opts.scale);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 100000) throw new Error('BRRES scale must be greater than zero and at most 100000');
  const prep = _exPrepare(scene, { yUp: true, bake: true });
  const chunks = [], unique = _brNames();
  let triangles = 0;
  for (const ob of prep.objects) {
    const groups = new Map();
    for (const face of ob.faces) {
      for (const tri of _exFaceTris(face)) {
        if (++triangles > 100000) throw new Error('BRRES export is limited to 100,000 triangles. Simplify the model or reduce subdivision.');
        let c = groups.get(face.mat);
        if (!c || c.pos.length + 3 > 60000) { c = { name: unique(ob.name), mat: face.mat, pos: [], normal: [], uv: [] }; groups.set(face.mat, c); chunks.push(c); }
        for (const corner of tri) {
          c.pos.push(face.pts[corner].map((v) => v * scale)); c.normal.push(face.n[corner]);
          c.uv.push([face.uv[corner][0], 1 - face.uv[corner][1]]);
        }
      }
    }
  }
  if (!triangles) throw new Error('BRRES needs at least one face; loose edges and points are not exported');
  if (prep.materials.length > 1024) throw new Error('BRRES supports at most 1024 materials in this exporter');
  const texNames = _brNames(), matNames = _brNames();
  const textures = prep.textures.map((t) => ({ ...t, name: texNames(t.name.replace(/\.[^.]+$/, '')), originalName: t.name }));
  const materialNames = prep.materials.map((m) => matNames(m.name));
  const w = new _BrWriter(); w.alloc(16); w.text(0, 'bres'); w.u16(4, 0xfeff); w.u16(12, 16); w.u16(14, 2 + textures.length);
  const root = w.alloc(8); w.text(root, 'root');
  const categories = [{ name: '3DModels(NW4R)' }]; if (textures.length) categories.push({ name: 'Textures(NW4R)' });
  _brDictionary(w, categories);
  const models = [{ name: 'course' }]; categories[0].patch(_brDictionary(w, models));
  const texEntries = textures.map((t) => ({ name: t.name }));
  if (textures.length) categories[1].patch(_brDictionary(w, texEntries));
  w.u32(root + 4, w.length - root);
  const mdl = w.alloc(0x94, 32); models[0].patch(mdl);
  w.text(mdl, 'MDL0'); w.u32(mdl + 8, 11); w.u32(mdl + 12, -mdl); w.str(mdl + 0x48, mdl, 'course');
  const info = mdl + 0x4c;
  w.u32(info, 0x40); w.u32(info + 4, mdl - info); w.u32(info + 0x10, triangles * 3); w.u32(info + 0x14, triangles); w.u32(info + 0x1c, 1);
  w.u8(info + 0x22, 1); w.u32(info + 0x24, 0x40); w.u32(info + 0x40, 1);
  const bounds = _brBounds(chunks.flatMap((c) => c.pos)); _brWriteBounds(w, info + 0x28, bounds);
  const dict = (slot, entries) => { const p = _brDictionary(w, entries); if (p) w.u32(mdl + 0x10 + slot * 4, p - mdl); };
  const methods = ['NodeTree', 'DrawOpa', 'DrawXlu'].map((name) => ({ name })); dict(0, methods);
  const bones = [{ name: 'course' }]; dict(1, bones);
  const posEntries = chunks.map((c) => ({ name: c.name + '_positions' })); dict(2, posEntries);
  const nrmEntries = chunks.map((c) => ({ name: c.name + '_normals' })); dict(3, nrmEntries);
  const uvEntries = chunks.map((c) => ({ name: c.name + '_uv' })); dict(5, uvEntries);
  const mats = materialNames.map((name) => ({ name })); dict(8, mats);
  const shaders = materialNames.map((name) => ({ name })); dict(9, shaders);
  const shapes = chunks.map((c) => ({ name: c.name })); dict(10, shapes);
  const links = textures.map((t) => ({ name: t.name })); dict(11, links);
  let p = w.alloc(6); methods[0].patch(p); w.u8(p, 2); w.u8(p + 5, 1);
  const bone = w.alloc(0xd0); bones[0].patch(bone);
  w.u32(bone, 0xd0); w.u32(bone + 4, mdl - bone); w.str(bone + 8, bone, 'course'); w.u32(bone + 0x14, 0x11f);
  for (let a = 0; a < 3; a++) { w.f32(bone + 0x20 + a * 4, 1); w.f32(bone + 0x70 + a * 20, 1); w.f32(bone + 0xa0 + a * 20, 1); }
  _brWriteBounds(w, bone + 0x44, bounds);
  const materialData = prep.materials.map((m, i) => {
    const tex = m.texture ? textures.find((t) => t.originalName === m.texture.name) : null;
    const result = _brMaterial(w, mdl, m, i, materialNames[i], tex?.name);
    mats[i].patch(result.at); return { ...result, tex };
  });
  materialData.forEach((m, i) => { const sh = _brShader(w, mdl, i, !!m.tex); shaders[i].patch(sh); w.u32(m.at + 0x28, sh - m.at); });
  for (let i = 0; i < textures.length; i++) {
    const references = materialData.filter((m) => m.tex === textures[i]);
    const at = w.alloc(4 + references.length * 8); links[i].patch(at); w.u32(at, references.length);
    references.forEach((m, j) => { w.u32(at + 4 + j * 8, m.at - at); w.u32(at + 8 + j * 8, m.sampler - at); });
  }
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]; shapes[i].patch(_brShape(w, mdl, i, c.name, c.pos.length));
    posEntries[i].patch(_brBuffer(w, mdl, i, posEntries[i].name, c.pos, 3, 'position'));
    nrmEntries[i].patch(_brBuffer(w, mdl, i, nrmEntries[i].name, c.normal, 3, 'normal'));
    uvEntries[i].patch(_brBuffer(w, mdl, i, uvEntries[i].name, c.uv, 2, 'uv'));
  }
  for (const [method, translucent] of [[methods[1], false], [methods[2], true]]) {
    const draws = chunks.map((c, i) => ({ c, i })).filter(({ c }) => materialData[c.mat].blend === translucent);
    p = w.alloc(draws.length * 8 + 1); method.patch(p);
    for (const { c, i } of draws) { w.u8(p, 4); w.u16(p + 1, c.mat); w.u16(p + 3, i); p += 8; }
    w.u8(p, 1);
  }
  w.alloc(0, 32); w.u32(mdl + 4, w.length - mdl);
  textures.forEach((t, i) => {
    const pixels = encodeWiiRGBA8(t.rgba, t.width, t.height);
    const at = w.alloc(0x40 + pixels.length, 32); texEntries[i].patch(at);
    w.text(at, 'TEX0'); w.u32(at + 4, 0x40 + pixels.length); w.u32(at + 8, 3); w.u32(at + 12, -at);
    w.u32(at + 16, 0x40); w.str(at + 20, at, t.name); w.u16(at + 28, t.width); w.u16(at + 30, t.height);
    w.u32(at + 32, 6); w.u32(at + 36, 1); w.bytes.set(pixels, at + 0x40);
  });
  return [{ name: (opts.baseName || 'course_model') + '.brres', data: w.finish() }];
}
