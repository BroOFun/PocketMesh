// Mario Kart Wii SZS = Yaz0-compressed U8. Original implementation from the format specs:
// https://mkwiiki.org/wiki/U8_(File_Format), https://mkwiiki.org/wiki/Yaz0_(File_Format)
export const SZS_MAX_SIZE = 128 * 1024 * 1024;
function _szsBytes(input) {
  if (input instanceof Uint8Array) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new Error('Expected archive bytes');
}
function _szsMagic(b, magic) {
  return b.length >= 4 && magic.every((v, i) => b[i] === v);
}
export function decodeYaz0(input) {
  const b = _szsBytes(input);
  if (b.length < 16 || !_szsMagic(b, [89, 97, 122, 48])) throw new Error('Not a Yaz0 stream');
  const size = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4);
  if (size > SZS_MAX_SIZE) throw new Error('Archive exceeds the 128 MiB unpacked limit');
  const out = new Uint8Array(size);
  let src = 16,
    dst = 0;
  const read = () => {
    if (src >= b.length) throw new Error('Truncated Yaz0 stream');
    return b[src++];
  };
  while (dst < size) {
    const bits = read();
    for (let mask = 128; mask && dst < size; mask >>= 1) {
      if (bits & mask) out[dst++] = read();
      else {
        const first = read(),
          second = read(),
          distance = (((first & 15) << 8) | second) + 1;
        const length = first >>> 4 ? (first >>> 4) + 2 : read() + 18;
        if (distance > dst || dst + length > size) throw new Error('Invalid Yaz0 back-reference');
        for (let i = 0; i < length; i++) {
          out[dst] = out[dst - distance];
          dst++;
        }
      }
    }
  }
  return out;
}
export function encodeYaz0(input) {
  const data = _szsBytes(input),
    n = data.length;
  if (n > SZS_MAX_SIZE) throw new Error('Archive exceeds the 128 MiB unpacked limit');
  const out = new Uint8Array(16 + n + Math.ceil(n / 8));
  out.set([89, 97, 122, 48]);
  new DataView(out.buffer).setUint32(4, n);
  const head = new Int32Array(65536).fill(-1),
    previous = new Int32Array(4096).fill(-1);
  const hash = (p) => ((data[p] * 251 + data[p + 1]) * 251 + data[p + 2]) & 65535;
  const insert = (p) => {
    if (p + 2 < n) {
      const h = hash(p);
      previous[p & 4095] = head[h];
      head[h] = p;
    }
  };
  let pos = 0,
    write = 16;
  while (pos < n) {
    const codeAt = write++;
    let code = 0;
    for (let bit = 128; bit && pos < n; bit >>= 1) {
      let best = 0,
        back = 0;
      if (pos + 2 < n) {
        let candidate = head[hash(pos)],
          tries = 0;
        const low = Math.max(0, pos - 4096),
          max = Math.min(273, n - pos);
        while (candidate >= low && candidate < pos && tries++ < 64) {
          if (
            data[candidate] === data[pos] &&
            data[candidate + 1] === data[pos + 1] &&
            data[candidate + 2] === data[pos + 2]
          ) {
            let length = 3;
            while (length < max && data[candidate + length] === data[pos + length]) length++;
            if (length > best) {
              best = length;
              back = pos - candidate - 1;
              if (length === max) break;
            }
          }
          const next = previous[candidate & 4095];
          if (next >= candidate) break;
          candidate = next;
        }
      }
      if (best >= 3) {
        if (best < 18) {
          out[write++] = ((best - 2) << 4) | (back >>> 8);
          out[write++] = back & 255;
        } else {
          out[write++] = back >>> 8;
          out[write++] = back & 255;
          out[write++] = best - 18;
        }
        for (let i = 0; i < best; i++) insert(pos++);
      } else {
        code |= bit;
        out[write++] = data[pos];
        insert(pos++);
      }
    }
    out[codeAt] = code;
  }
  return out.slice(0, write);
}
export function inspectSZS(input) {
  const source = _szsBytes(input);
  if (source.length > (SZS_MAX_SIZE * 9) / 8 + 16) throw new Error('Archive exceeds the supported size limit');
  const original = Uint8Array.from(source),
    compressed = _szsMagic(original, [89, 97, 122, 48]),
    bytes = compressed ? decodeYaz0(original) : original;
  if (bytes.length < 32 || !_szsMagic(bytes, [85, 170, 56, 45]))
    throw new Error('Open a Mario Kart Wii U8/SZS archive. This file is not a U8 archive.');
  if (bytes.length > SZS_MAX_SIZE) throw new Error('Archive exceeds the 128 MiB unpacked limit');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    root = view.getUint32(4),
    headerSize = view.getUint32(8),
    dataOffset = view.getUint32(12),
    headerEnd = root + headerSize;
  if (
    root < 32 ||
    root % 4 ||
    root + 12 > bytes.length ||
    headerEnd > bytes.length ||
    headerEnd > dataOffset ||
    dataOffset > bytes.length
  )
    throw new Error('Invalid U8 header bounds');
  const count = view.getUint32(root + 8);
  if (
    bytes[root] !== 1 ||
    view.getUint32(root + 4) !== 0 ||
    count < 1 ||
    count > 50000 ||
    root + count * 12 >= headerEnd
  )
    throw new Error('Invalid U8 root or node count');
  const strings = root + count * 12,
    nodes = [],
    stack = [],
    paths = new Set();
  const nameAt = (offset) => {
    let start = strings + offset,
      end = start;
    if (start >= headerEnd) throw new Error('Invalid U8 name offset');
    while (end < headerEnd && bytes[end]) end++;
    if (end === headerEnd) throw new Error('Unterminated U8 name');
    return new TextDecoder().decode(bytes.subarray(start, end));
  };
  for (let i = 0; i < count; i++) {
    const at = root + i * 12,
      type = bytes[at],
      nameOffset = view.getUint32(at) & 0xffffff,
      name = nameAt(nameOffset),
      offset = view.getUint32(at + 4),
      size = view.getUint32(at + 8);
    if (type !== 0 && type !== 1) throw new Error('Unsupported U8 node type');
    if (i === 0) {
      if (name !== '' || type !== 1) throw new Error('Invalid U8 root name');
      nodes.push({ id: 0, name: '', path: '', parent: 0, depth: 0, directory: true, end: count });
      stack.push(nodes[0]);
      continue;
    }
    while (stack.length && i >= stack[stack.length - 1].end) stack.pop();
    const parent = stack[stack.length - 1];
    if (
      !parent ||
      !name ||
      name === '..' ||
      /[\/\\\x00]/.test(name) ||
      (name === '.' && (parent.id !== 0 || type !== 1))
    )
      throw new Error('Invalid U8 directory or filename');
    const path = (parent.path ? parent.path + '/' : '') + name;
    if (paths.has(path)) throw new Error('Duplicate U8 path: ' + path);
    paths.add(path);
    const node = { id: i, name, path, parent: parent.id, depth: parent.depth + 1, directory: type === 1 };
    if (type === 1) {
      if (offset !== parent.id || size <= i || size > parent.end) throw new Error('Invalid U8 directory range');
      node.end = size;
      stack.push(node);
    } else {
      if (offset > bytes.length || size > bytes.length - offset || (size && offset < dataOffset))
        throw new Error('File extends outside the U8 archive: ' + path);
      node.offset = offset;
      node.size = size;
    }
    nodes.push(node);
  }
  return { original, bytes, compressed, root, headerEnd, dataOffset, nodes };
}
export function szsEntryBytes(archive, id, changes = new Map()) {
  const node = archive.nodes[id];
  if (!node || node.directory) throw new Error('Select an archive file');
  return changes.has(id) ? _szsBytes(changes.get(id)) : archive.bytes.subarray(node.offset, node.offset + node.size);
}
export function saveSZS(archive, changes = new Map(), { compressed = true } = {}) {
  if (!changes.size && compressed === archive.compressed) return archive.original.slice();
  for (const [id, data] of changes) {
    if (!archive.nodes[id] || archive.nodes[id].directory) throw new Error('Invalid replacement target');
    if (_szsBytes(data).length > SZS_MAX_SIZE) throw new Error('Replacement is too large');
  }
  const align = (n) => Math.ceil(n / 32) * 32,
    dataOffset = align(archive.headerEnd),
    offsets = new Map();
  let size = dataOffset;
  for (const node of archive.nodes)
    if (!node.directory) {
      const data = szsEntryBytes(archive, node.id, changes);
      size = align(size);
      offsets.set(node.id, size);
      size += data.length;
      if (size > SZS_MAX_SIZE) throw new Error('Updated archive exceeds the 128 MiB unpacked limit');
    }
  const bytes = new Uint8Array(align(size));
  bytes.set(archive.bytes.subarray(0, archive.headerEnd));
  const view = new DataView(bytes.buffer);
  view.setUint32(12, dataOffset);
  for (const node of archive.nodes)
    if (!node.directory) {
      const data = szsEntryBytes(archive, node.id, changes),
        offset = offsets.get(node.id),
        at = archive.root + node.id * 12;
      view.setUint32(at + 4, offset);
      view.setUint32(at + 8, data.length);
      bytes.set(data, offset);
    }
  return compressed ? encodeYaz0(bytes) : bytes;
}
export function szsFileType(bytes, name = '') {
  const b = _szsBytes(bytes);
  if (_szsMagic(b, [98, 114, 101, 115])) return 'BRRES';
  if (_szsMagic(b, [82, 75, 77, 68])) return 'KMP';
  if (_szsMagic(b, [89, 97, 122, 48])) return 'Yaz0';
  if (_szsMagic(b, [85, 170, 56, 45])) return 'U8';
  const ext = name.includes('.') ? name.split('.').pop().toUpperCase() : '';
  return ext || 'Binary';
}
