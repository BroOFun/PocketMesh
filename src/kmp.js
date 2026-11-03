// KMP v2520 (RKMD), big endian. Preserves imported sections byte-for-byte.
// https://mkwiiki.org/wiki/KMP_(File_Format)
const _KP_NAMES = [
  'KTPT',
  'ENPT',
  'ENPH',
  'ITPT',
  'ITPH',
  'CKPT',
  'CKPH',
  'GOBJ',
  'POTI',
  'AREA',
  'CAME',
  'JGPT',
  'CNPT',
  'MSPT',
  'STGI',
];
export function normalizeTrack(data = {}) {
  const scale = Number(data.scale);
  const start =
    data.start &&
    Array.isArray(data.start.position) &&
    data.start.position.length === 3 &&
    data.start.position.every(Number.isFinite)
      ? {
          position: data.start.position.slice(),
          rotation:
            Array.isArray(data.start.rotation) &&
            data.start.rotation.length === 3 &&
            data.start.rotation.every(Number.isFinite)
              ? data.start.rotation.slice()
              : [0, 0, 0],
        }
      : null;
  return {
    scale: Number.isFinite(scale) && scale >= 0.001 && scale <= 100000 ? scale : 1,
    start,
    clearance: Number.isFinite(data.clearance) ? Math.max(0, Math.min(100, data.clearance)) : 0.2,
    template: typeof data.template === 'string' ? data.template : null,
    templateName: typeof data.templateName === 'string' ? data.templateName : '',
  };
}
export function trackToWii(p, scale = 1) {
  return [p[0] * scale, p[2] * scale, -p[1] * scale];
}
export function trackFromWii(p, scale = 1) {
  return [p[0] / scale, -p[2] / scale, p[1] / scale];
}
export function inspectKMP(input) {
  const bytes = input instanceof Uint8Array ? Uint8Array.from(input) : new Uint8Array(input),
    v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (o) => String.fromCharCode(...bytes.slice(o, o + 4));
  if (bytes.length < 16 || text(0) !== 'RKMD') throw new Error('Not a Mario Kart Wii KMP file');
  const count = v.getUint16(8),
    header = v.getUint16(10);
  if (count < 1 || count > 64 || header < 16 + 4 * count || header > bytes.length || v.getUint32(4) !== bytes.length)
    throw new Error('Invalid KMP header or file length');
  const version = v.getUint32(header - count * 4 - 4);
  if (version !== 2520) throw new Error('Only Mario Kart Wii KMP version 2520 is supported');
  const offsets = Array.from({ length: count }, (_, i) => header + v.getUint32(header - count * 4 + i * 4));
  if (new Set(offsets).size !== count || offsets.some((o) => o < header || o + 8 > bytes.length))
    throw new Error('Invalid KMP section offsets');
  const sorted = [...offsets].sort((a, b) => a - b),
    sections = offsets.map((o) => {
      const end = sorted[sorted.indexOf(o) + 1] ?? bytes.length;
      if (end < o + 8) throw new Error('Overlapping KMP sections');
      return {
        name: text(o),
        count: v.getUint16(o + 4),
        extra: v.getUint16(o + 6),
        offset: o,
        bytes: bytes.slice(o, end),
      };
    });
  if (new Set(sections.map((s) => s.name)).size !== sections.length) throw new Error('Duplicate KMP sections');
  const ktpt = sections.find((s) => s.name === 'KTPT');
  let start = null;
  if (ktpt) {
    if (ktpt.bytes.length < 8 + ktpt.count * 28) throw new Error('Truncated KTPT section');
    if (ktpt.count) {
      const o = ktpt.offset + 8;
      start = {
        position: [0, 1, 2].map((i) => v.getFloat32(o + i * 4)),
        rotation: [0, 1, 2].map((i) => v.getFloat32(o + 12 + i * 4)),
      };
      if (![...start.position, ...start.rotation].every(Number.isFinite)) throw new Error('Invalid KTPT coordinates');
    }
  }
  return { bytes, sections, start, version };
}
// Original temporary drive-test scaffold, not a route fitted to the model.
// A linked loop avoids the game dereferencing empty path/checkpoint groups.
function _kpTestSections(start, scale) {
  const p = trackToWii(start.position, scale),
    yaw = (start.rotation[1] * Math.PI) / 180;
  const forward = [Math.sin(yaw), 0, Math.cos(yaw)],
    right = [-Math.cos(yaw), 0, Math.sin(yaw)];
  const radius = 5000,
    center = p.map((v, i) => v + right[i] * radius + forward[i] * 500);
  const radial = [right.map((v) => -v), forward, right, forward.map((v) => -v)];
  const point = (i, r) => center.map((v, j) => v + radial[i][j] * r);
  const sections = _KP_NAMES.map((name) => {
    const count =
      { ENPT: 4, ENPH: 1, ITPT: 4, ITPH: 1, CKPT: 4, CKPH: 1, JGPT: 1, CAME: 2, POTI: 1, STGI: 1 }[name] || 0;
    const stride =
      { ENPT: 20, ENPH: 16, ITPT: 20, ITPH: 16, CKPT: 20, CKPH: 16, JGPT: 28, CAME: 72, POTI: 36, STGI: 12 }[name] || 0;
    const bytes = new Uint8Array(8 + count * stride),
      v = new DataView(bytes.buffer);
    Array.from(name).forEach((c, i) => (bytes[i] = c.charCodeAt(0)));
    v.setUint16(4, count);
    const vector = (o, p) => p.forEach((x, i) => v.setFloat32(o + i * 4, x));
    if (name === 'ENPT' || name === 'ITPT')
      for (let i = 0; i < 4; i++) {
        vector(8 + i * 20, point(i, radius));
        v.setFloat32(20 + i * 20, 10);
      }
    if (['ENPH', 'ITPH', 'CKPH'].includes(name)) {
      bytes[9] = 4;
      bytes.fill(255, 10, 22);
      bytes[10] = bytes[16] = 0;
    }
    if (name === 'CKPT')
      for (let i = 0; i < 4; i++) {
        const l = point(i, radius * 1.9),
          r = point(i, radius * 0.1),
          o = 8 + i * 20;
        [l[0], l[2], r[0], r[2]].forEach((x, j) => v.setFloat32(o + j * 4, x));
        bytes[o + 17] = i === 0 ? 0 : i === 2 ? 1 : 255;
        bytes[o + 18] = i === 0 ? 255 : i - 1;
        bytes[o + 19] = i === 3 ? 255 : i + 1;
      }
    if (name === 'JGPT') {
      vector(
        8,
        p.map((v, i) => (i === 1 ? v + 100 : v)),
      );
      vector(20, start.rotation);
    }
    if (name === 'CAME') {
      bytes[6] = 1; // opening camera 1; goal/selection camera 0
      for (let i = 0; i < 2; i++) {
        const o = 8 + i * 72;
        bytes[o] = i ? 5 : 0;
        bytes[o + 1] = 255;
        bytes[o + 3] = i ? 0 : 255;
        vector(
          o + 12,
          p.map((v, j) => v - forward[j] * 1500 + (j === 1 ? 1000 : 0)),
        );
        v.setFloat32(o + 36, 60);
        v.setFloat32(o + 40, 60);
        vector(o + 44, p);
        vector(o + 56, p);
        v.setFloat32(o + 68, 60);
      }
    }
    if (name === 'POTI') {
      v.setUint16(6, 2);
      v.setUint16(8, 2);
      for (let i = 0; i < 2; i++) {
        vector(
          12 + i * 16,
          p.map((v, j) => v - forward[j] * 1500 + (j === 1 ? 1000 : 0) + right[j] * i * 100),
        );
        v.setUint16(24 + i * 16, 100);
      }
    }
    if (name === 'STGI') {
      bytes[8] = 3;
      bytes[11] = 1;
      v.setUint32(12, 0x00ffffff);
      bytes[16] = 0x32;
    }
    return { name, bytes };
  });
  return sections;
}
export function exportKMP(start, { scale = 1, template = null } = {}) {
  if (
    !start ||
    !start.position ||
    !start.rotation ||
    start.position.length !== 3 ||
    start.rotation.length !== 3 ||
    ![...start.position, ...start.rotation, scale].every(Number.isFinite) ||
    scale <= 0
  )
    throw new Error('Place a start point on the track first');
  if (![...trackToWii(start.position, scale), ...start.rotation].every((n) => Number.isFinite(Math.fround(n))))
    throw new Error('Start coordinates exceed the KMP number range');
  let sections = template
    ? inspectKMP(template).sections.map((s) => ({ name: s.name, bytes: s.bytes.slice() }))
    : _kpTestSections(start, scale);
  let section = sections.find((s) => s.name === 'KTPT');
  if (!section) {
    section = { name: 'KTPT', bytes: new Uint8Array(8) };
    sections.unshift(section);
  }
  if (section.bytes.length < 36 || new DataView(section.bytes.buffer, section.bytes.byteOffset).getUint16(4) === 0) {
    section.bytes = new Uint8Array(36);
    section.bytes.set([75, 84, 80, 84, 0, 1]);
    new DataView(section.bytes.buffer).setInt16(32, -1);
  }
  const kv = new DataView(section.bytes.buffer, section.bytes.byteOffset, section.bytes.byteLength);
  trackToWii(start.position, scale).forEach((n, i) => kv.setFloat32(8 + i * 4, n));
  start.rotation.forEach((n, i) => kv.setFloat32(20 + i * 4, n));
  const header = 16 + sections.length * 4,
    size = header + sections.reduce((n, s) => n + s.bytes.length, 0),
    bytes = new Uint8Array(size),
    v = new DataView(bytes.buffer);
  bytes.set([82, 75, 77, 68]);
  v.setUint32(4, size);
  v.setUint16(8, sections.length);
  v.setUint16(10, header);
  v.setUint32(12, 2520);
  let pos = header;
  sections.forEach((s, i) => {
    v.setUint32(16 + i * 4, pos - header);
    bytes.set(s.bytes, pos);
    pos += s.bytes.length;
  });
  return bytes;
}
