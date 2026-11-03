// BRRES resource inspection and texture editing. Models and animations stay at their
// original offsets; larger replacement textures are appended and dictionaries retargeted.
// Format references: RiiStudio TextureIO.cpp, noclip rres/brres.ts, Dolphin TextureDecoder.
export const WII_TEXTURE_FORMATS = { 0: 'I4', 1: 'I8', 2: 'IA4', 3: 'IA8', 4: 'RGB565', 5: 'RGB5A3', 6: 'RGBA8', 8: 'C4', 9: 'C8', 10: 'C14X2', 14: 'CMPR' };
const _beBlocks = { 0: [8,8,32], 1: [8,4,32], 2: [8,4,32], 3: [4,4,32], 4: [4,4,32], 5: [4,4,32], 6: [4,4,64], 8: [8,8,32], 9: [8,4,32], 10: [4,4,32], 14: [8,8,32] };
const _beLimit = 128 * 1024 * 1024;
export function wiiTextureLevelSize(width, height, format) {
  const block = _beBlocks[format];
  if (!block) throw new Error('Unsupported Wii texture format: ' + format);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('Texture dimensions must be 1–4096');
  return Math.ceil(width / block[0]) * Math.ceil(height / block[1]) * block[2];
}
function _beMipSize(w, h, format, levels) {
  let size = 0;
  for (let i = 0; i < levels; i++) { size += wiiTextureLevelSize(w, h, format); w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
  return size;
}
export function inspectBRRES(input) {
  const bytes = input instanceof Uint8Array ? Uint8Array.from(input) : new Uint8Array(input).slice();
  if (bytes.length < 32 || bytes.length > _beLimit) throw new Error('BRRES must be between 32 bytes and 128 MiB');
  const v = new DataView(bytes.buffer), text = new TextDecoder();
  let length = bytes.length;
  const range = (p, n) => { if (!Number.isInteger(p) || p < 0 || n < 0 || p > length - n) throw new Error('Truncated or invalid BRRES offset'); };
  const magic = (p) => { range(p, 4); return String.fromCharCode(...bytes.subarray(p, p + 4)); };
  const u32 = (p) => { range(p, 4); return v.getUint32(p); };
  const relative = (p, base) => { range(p, 4); return base + v.getInt32(p); };
  const string = (p) => {
    range(p, 1); let end = p;
    while (end < length && end - p < 4096 && bytes[end]) end++;
    if (end === length || end - p === 4096) throw new Error('Invalid BRRES resource name');
    return text.decode(bytes.subarray(p, end));
  };
  if (magic(0) !== 'bres') throw new Error('Choose an uncompressed .brres file');
  if (v.getUint16(4) !== 0xfeff) throw new Error('Only big-endian Wii BRRES files are supported');
  length = u32(8); if (length < 32 || length > bytes.length) throw new Error('Truncated BRRES file');
  const root = v.getUint16(12); range(root, 8);
  if (magic(root) !== 'root') throw new Error('BRRES root section is missing');
  const rootSize = u32(root + 4); range(root, rootSize);
  if (rootSize < 32) throw new Error('Invalid BRRES root size');
  const dictionary = (p) => {
    range(p, 24); const size = u32(p), count = u32(p + 4);
    if (count > 4096 || size < 24 + 16 * count) throw new Error('Invalid BRRES resource dictionary');
    range(p, size); const entries = [];
    for (let i = 0; i < count; i++) {
      const e = p + 24 + i * 16, offset = relative(e + 12, p); range(offset, 4);
      entries.push({ name: string(relative(e + 8, p)), offset, dictionary: p, pointer: e + 12 });
    }
    return entries;
  };
  const resources = [], groups = dictionary(root + 8);
  for (const group of groups) {
    for (const entry of dictionary(group.offset)) {
      if (resources.length >= 4096) throw new Error('Too many BRRES resources');
      const p = entry.offset, type = magic(p), size = u32(p + 4), version = u32(p + 8);
      if (size < 16) throw new Error('Invalid ' + type + ' section size');
      range(p, size);
      const r = { ...entry, group: group.name, type, size, version };
      if (type === 'TEX0' && [1, 3].includes(version)) {
        if (size < 52) throw new Error('Invalid TEX0 header');
        Object.assign(r, { dataOffset: u32(p + 16), width: v.getUint16(p + 28), height: v.getUint16(p + 30), format: u32(p + 32), mipCount: u32(p + 36), minLOD: v.getFloat32(p + 40), maxLOD: v.getFloat32(p + 44) });
        r.formatName = WII_TEXTURE_FORMATS[r.format] || ('Unknown (' + r.format + ')');
        r.userData = version === 3 && size >= 56 ? u32(p + 52) : 0;
        r.sourcePath = u32(p + 48) ? relative(p + 48, p) : 0;
        if (r.sourcePath) string(r.sourcePath);
        if (r.mipCount < 1 || r.mipCount > 32 || r.width < 1 || r.height < 1 || r.width > 4096 || r.height > 4096) throw new Error('Invalid TEX0 dimensions or mipmap count');
        if (_beBlocks[r.format]) {
          r.encodedSize = _beMipSize(r.width, r.height, r.format, r.mipCount);
          if (r.dataOffset < (version === 3 ? 56 : 52) || r.dataOffset + r.encodedSize > size) throw new Error('Truncated TEX0 pixel data');
          r.editable = !r.userData;
        }
      } else if (type === 'PLT0' && [1, 3].includes(version)) {
        if (size < 32) throw new Error('Invalid PLT0 header');
        Object.assign(r, { dataOffset: u32(p + 16), format: u32(p + 24), entries: v.getUint16(p + 28) });
        if (r.dataOffset < 32 || r.dataOffset + r.entries * 2 > size) throw new Error('Truncated palette');
      } else if (type === 'MDL0' && [8, 9, 10, 11].includes(version)) {
        const slots = version >= 10 ? 13 : 11, info = p + 16 + slots * 4 + (version >= 11 ? 4 : 0) + 4;
        if (info + 24 > p + size) throw new Error('Truncated MDL0 header');
        r.vertices = u32(info + 16); r.polygons = u32(info + 20);
        const materialField = p + 16 + (version >= 10 ? 8 : 6) * 4;
        r.materials = u32(materialField) ? dictionary(relative(materialField, p)).map((x) => x.name) : [];
      }
      resources.push(r);
    }
  }
  // Refuse ambiguous overlaps before allowing any in-place edits.
  const sections = [...new Map(resources.map((r) => [r.offset, r])).values()].sort((a, b) => a.offset - b.offset);
  let end = root + rootSize;
  for (const r of sections) { if (r.offset < end) throw new Error('Overlapping BRRES sections are not supported'); end = r.offset + r.size; }
  return { bytes, version: v.getUint16(6), length, sectionCount: v.getUint16(14), resources, textures: resources.filter((r) => r.type === 'TEX0'), palettes: resources.filter((r) => r.type === 'PLT0') };
}
function _be565(n) { const r = n >> 11, g = (n >> 5) & 63, b = n & 31; return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 255]; }
function _be5a3(n) {
  if (n & 32768) { const r = (n >> 10) & 31, g = (n >> 5) & 31, b = n & 31; return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2), 255]; }
  const a = n >> 12; return [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17, (a << 5) | (a << 2) | (a >> 1)];
}
export function decodeBRRESTexture(archive, texture, palette = null, level = 0) {
  if (!archive.textures.includes(texture)) throw new Error('Texture does not belong to this archive');
  const f = texture.format, block = _beBlocks[f];
  if (!block || !texture.encodedSize) throw new Error('This texture version or format cannot be previewed');
  if (!Number.isInteger(level) || level < 0 || level >= texture.mipCount) throw new Error('Invalid mipmap level');
  let w = texture.width, h = texture.height, offset = texture.offset + texture.dataOffset;
  for (let i = 0; i < level; i++) { offset += wiiTextureLevelSize(w, h, f); w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
  const bytes = archive.bytes, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), rgba = new Uint8Array(w * h * 4);
  let colors;
  if ([8, 9, 10].includes(f)) {
    palette ||= archive.palettes.find((p) => p.name === texture.name);
    if (!palette || !archive.palettes.includes(palette) || ![0, 1, 2].includes(palette.format)) throw new Error('Select the matching palette to preview this indexed texture');
    colors = Array.from({ length: palette.entries }, (_, i) => { const n = view.getUint16(palette.offset + palette.dataOffset + i * 2); return palette.format === 1 ? _be565(n) : palette.format === 2 ? _be5a3(n) : [n & 255, n & 255, n & 255, n >> 8]; });
  }
  const put = (x, y, c) => { if (x < w && y < h) rgba.set(c, (y * w + x) * 4); };
  for (let by = 0; by < h; by += block[1]) for (let bx = 0; bx < w; bx += block[0], offset += block[2]) {
    if (f === 14) {
      for (let sub = 0; sub < 4; sub++) {
        const p = offset + sub * 8, a = view.getUint16(p), b = view.getUint16(p + 2), ca = _be565(a), cb = _be565(b);
        const mix = (wa, wb, denom, alpha) => ca.map((c, k) => k === 3 ? alpha : Math.floor((c * wa + cb[k] * wb) / denom));
        // Wii's CMPR interpolator uses 5/8 and 3/8 weights (Dolphin DXTBlend).
        const cs = [ca, cb, a > b ? mix(5,3,8,255) : mix(1,1,2,255), a > b ? mix(3,5,8,255) : mix(1,1,2,0)];
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) put(bx + (sub % 2) * 4 + x, by + (sub >> 1) * 4 + y, cs[(bytes[p + 4 + y] >> (6 - x * 2)) & 3]);
      }
      continue;
    }
    for (let y = 0; y < block[1]; y++) for (let x = 0; x < block[0]; x++) {
      const i = y * block[0] + x, n = bytes[offset + i]; let c;
      if (f === 0) { const z = ((bytes[offset + (i >> 1)] >> (i % 2 ? 0 : 4)) & 15) * 17; c = [z,z,z,z]; }
      else if (f === 1) c = [n,n,n,n];
      else if (f === 2) { const z = (n & 15) * 17; c = [z,z,z,(n >> 4) * 17]; }
      else if (f === 3) { const z = bytes[offset + i * 2 + 1]; c = [z,z,z,bytes[offset + i * 2]]; }
      else if (f === 4) c = _be565(view.getUint16(offset + i * 2));
      else if (f === 5) c = _be5a3(view.getUint16(offset + i * 2));
      else if (f === 6) c = [bytes[offset + i * 2 + 1],bytes[offset + i * 2 + 32],bytes[offset + i * 2 + 33],bytes[offset + i * 2]];
      else { const index = f === 8 ? (bytes[offset + (i >> 1)] >> (i % 2 ? 0 : 4)) & 15 : f === 9 ? n : view.getUint16(offset + i * 2) & 16383; c = colors[index]; if (!c) throw new Error('Texture references a missing palette entry'); }
      put(bx + x, by + y, c);
    }
  }
  return { width: w, height: h, rgba };
}
export function encodeWiiTexture(rgba, width, height, format = 6) {
  if (![0,1,2,3,4,5,6].includes(format)) throw new Error('Choose an uncompressed output format');
  if (!rgba || rgba.length !== width * height * 4) throw new Error('Invalid RGBA pixels');
  const out = new Uint8Array(wiiTextureLevelSize(width, height, format)), view = new DataView(out.buffer), [bw,bh,bs] = _beBlocks[format];
  let offset = 0;
  for (let by = 0; by < height; by += bh) for (let bx = 0; bx < width; bx += bw, offset += bs) {
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const q = (Math.min(by+y,height-1) * width + Math.min(bx+x,width-1)) * 4, i = y * bw + x;
      const r = rgba[q], g = rgba[q+1], b = rgba[q+2], a = rgba[q+3], intensity = Math.round(.299*r + .587*g + .114*b);
      if (format === 0) out[offset+(i>>1)] |= (intensity >> 4) << (i % 2 ? 0 : 4);
      else if (format === 1) out[offset+i] = intensity;
      else if (format === 2) out[offset+i] = (a & 240) | (intensity >> 4);
      else if (format === 3) { out[offset+i*2] = a; out[offset+i*2+1] = intensity; }
      else if (format === 4) view.setUint16(offset+i*2, ((r>>3)<<11) | ((g>>2)<<5) | (b>>3));
      else if (format === 5) view.setUint16(offset+i*2, a >= 224 ? 32768 | ((r>>3)<<10) | ((g>>3)<<5) | (b>>3) : ((a>>5)<<12) | ((r>>4)<<8) | ((g>>4)<<4) | (b>>4));
      else { out[offset+i*2] = a; out[offset+i*2+1] = r; out[offset+i*2+32] = g; out[offset+i*2+33] = b; }
    }
  }
  return out;
}
export function resizeTexturePixels(image, width, height) {
  if (![width,height].every((n) => Number.isInteger(n) && n >= 1 && n <= 1024 && (n & (n-1)) === 0)) throw new Error('Choose power-of-two dimensions from 1 to 1024');
  if (!image || image.rgba?.length !== image.width * image.height * 4) throw new Error('Invalid source image');
  const rgba = new Uint8Array(width * height * 4), sw = image.width, sh = image.height;
  // Area resampling in premultiplied alpha avoids dark/colored fringes at cutouts.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = x*sw/width, x1 = (x+1)*sw/width, y0 = y*sh/height, y1 = (y+1)*sh/height;
    let a = 0, r = 0, g = 0, b = 0, weight = 0;
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
      const w = (Math.min(x1,sx+1)-Math.max(x0,sx)) * (Math.min(y1,sy+1)-Math.max(y0,sy)), p = (sy*sw+sx)*4, alpha = image.rgba[p+3]*w;
      a += alpha; r += image.rgba[p]*alpha; g += image.rgba[p+1]*alpha; b += image.rgba[p+2]*alpha; weight += w;
    }
    const p = (y*width+x)*4;
    rgba[p] = a ? Math.round(r/a) : 0; rgba[p+1] = a ? Math.round(g/a) : 0; rgba[p+2] = a ? Math.round(b/a) : 0; rgba[p+3] = Math.round(a/weight);
  }
  return { width, height, rgba };
}
export function prepareBRRESTexture(image, width, height, format = 6, mipCount = 1) {
  let current = resizeTexturePixels(image, width, height);
  const maxLevels = 1 + Math.floor(Math.log2(Math.max(width, height)));
  if (!Number.isInteger(mipCount) || mipCount < 1 || mipCount > maxLevels) throw new Error('Invalid mipmap count');
  const data = new Uint8Array(_beMipSize(width, height, format, mipCount)); let offset = 0;
  for (let i = 0; i < mipCount; i++) {
    const encoded = encodeWiiTexture(current.rgba, current.width, current.height, format); data.set(encoded, offset); offset += encoded.length;
    if (i + 1 < mipCount) current = resizeTexturePixels(current, Math.max(1,current.width>>1), Math.max(1,current.height>>1));
  }
  return { width, height, format, mipCount, data };
}
export function saveBRRESEdits(archive, changes) {
  const edits = [...changes.entries()], appended = [], align = (n) => Math.ceil(n/32)*32;
  let length = archive.bytes.length;
  for (const [offset, edit] of edits) {
    const t = archive.textures.find((r) => r.offset === offset);
    if (!t?.editable) throw new Error('This texture has unsupported metadata and is read-only');
    if (![edit.width,edit.height].every((n) => Number.isInteger(n) && n >= 1 && n <= 1024 && (n & (n-1)) === 0) || ![0,1,2,3,4,5,6].includes(edit.format) || !Number.isInteger(edit.mipCount) || edit.mipCount < 1 || edit.mipCount > 1+Math.log2(Math.max(edit.width,edit.height))) throw new Error('Invalid texture edit');
    if (!(edit.data instanceof Uint8Array) || edit.data.length !== _beMipSize(edit.width,edit.height,edit.format,edit.mipCount)) throw new Error('Invalid encoded texture data');
    let target = t.offset, name = null;
    if (edit.data.length > t.encodedSize) {
      target = align(length); name = new TextEncoder().encode(t.name);
      length = align(target + 64 + edit.data.length + 4 + name.length + 1);
    }
    appended.push({ t, edit, target, name });
  }
  if (length > _beLimit) throw new Error('Edited BRRES would exceed 128 MiB');
  const out = new Uint8Array(length); out.set(archive.bytes); const v = new DataView(out.buffer);
  for (const { t, edit, target: p, name } of appended) {
    let dataOffset = t.dataOffset;
    if (name) {
      out.set(archive.bytes.subarray(t.offset,t.offset+52),p); dataOffset = 64;
      v.setUint32(p+4,64+edit.data.length); v.setUint32(p+8,3); v.setInt32(p+12,-p); v.setUint32(p+16,64);
      const n = p + 64 + edit.data.length;
      v.setUint32(n,name.length); out.set(name,n+4); v.setInt32(p+20,n+4-p);
      v.setInt32(p+48,t.sourcePath ? t.sourcePath-p : 0); v.setUint32(p+52,0);
      // All aliases must continue pointing to the same replacement resource.
      for (const alias of archive.textures.filter((x) => x.offset === t.offset)) v.setInt32(alias.pointer,p-alias.dictionary);
    }
    v.setUint32(p+24,0); v.setUint16(p+28,edit.width); v.setUint16(p+30,edit.height); v.setUint32(p+32,edit.format); v.setUint32(p+36,edit.mipCount); v.setFloat32(p+40,0); v.setFloat32(p+44,edit.mipCount-1);
    out.set(edit.data,p+dataOffset);
  }
  if (edits.length) v.setUint32(8,length);
  return out;
}
