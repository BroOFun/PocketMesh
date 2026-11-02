// Test scenes for the exporters + independent reference math (does not use export.js).
'use strict';
const zlib = require('zlib');

// ---------- tiny valid PNG ----------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePNG(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const p = pixel(x, y);
      raw.set(p, y * (w * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  return new Uint8Array(png);
}

// ---------- quaternion helpers ----------
function qAxis(ax, deg) {
  const l = Math.hypot(ax[0], ax[1], ax[2]);
  const a = (deg * Math.PI) / 360;
  const s = Math.sin(a) / l;
  return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(a)];
}
function qMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
function qRot(q, v) {
  const [x, y, z, w] = q;
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}
function worldPoint(obj, p) {
  const s = [p[0] * obj.scale[0], p[1] * obj.scale[1], p[2] * obj.scale[2]];
  const r = qRot(obj.quaternion, s);
  return [r[0] + obj.position[0], r[1] + obj.position[1], r[2] + obj.position[2]];
}
const toYUp = (p) => [p[0], p[2], -p[1]];

// ---------- meshes ----------
function cubeMesh() {
  const verts = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [3, 0, 4, 7], [1, 2, 6, 5]];
  const faces = quads.map((v, k) => {
    const cx = k % 3, cy = Math.floor(k / 3);
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, w]) => [(cx + u) / 3, (cy + w) / 2]);
    return { v, uv, mat: k === 5 ? 7 : 0 }; // slot 7 out of range -> slot 0
  });
  return { verts, faces, looseEdges: [], seams: new Set(), smooth: false };
}

function lMesh() {
  const outline = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  const n = outline.length;
  const verts = outline.map(([x, y]) => [x, y, 0]).concat(outline.map(([x, y]) => [x, y, 0.5]));
  const faces = [];
  const bottom = [], top = [];
  for (let i = n - 1; i >= 0; i--) bottom.push(i);
  for (let i = 0; i < n; i++) top.push(n + i);
  faces.push({ v: bottom, uv: bottom.map((i) => [verts[i][0] / 2, verts[i][1] / 2]), mat: 0 });
  faces.push({ v: top, uv: top.map((i) => [verts[i][0] / 2, verts[i][1] / 2]), mat: 0 });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push({ v: [i, j, n + j, n + i], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], mat: 1 });
  }
  return { verts, faces, looseEdges: [], seams: new Set(), smooth: false };
}

function cylMesh(segs) {
  const verts = [];
  for (let i = 0; i < segs; i++) { const a = (2 * Math.PI * i) / segs; verts.push([Math.cos(a), Math.sin(a), -1]); }
  for (let i = 0; i < segs; i++) { const a = (2 * Math.PI * i) / segs; verts.push([Math.cos(a), Math.sin(a), 1]); }
  const faces = [];
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    faces.push({ v: [i, j, segs + j, segs + i], uv: [[i / segs, 0], [(i + 1) / segs, 0], [(i + 1) / segs, 1], [i / segs, 1]], mat: 0 });
  }
  const capUV = (i) => [0.5 + 0.5 * verts[i][0], 0.5 + 0.5 * verts[i][1]];
  const top = [], bot = [];
  for (let i = 0; i < segs; i++) top.push(segs + i);
  for (let i = segs - 1; i >= 0; i--) bot.push(i);
  faces.push({ v: top, uv: top.map(capUV), mat: 1 });
  faces.push({ v: bot, uv: bot.map(capUV), mat: 1 });
  return { verts, faces, looseEdges: [], seams: new Set(), smooth: true };
}

function buildScene() {
  const bricks = { name: 'bricks.png', mime: 'image/png', bytes: makePNG(4, 4, (x, y) => ((x + y) & 1 ? [200, 60, 40, 255] : [240, 230, 220, 255])), width: 4, height: 4, filter: 'linear' };
  const pixel = { name: 'pixel art.png', mime: 'image/png', bytes: makePNG(2, 2, (x, y) => [x * 255, y * 255, 128, 255]), width: 2, height: 2, filter: 'nearest' };
  const materials = [
    { name: 'Bricks', color: [0.8, 0.3, 0.2], alpha: 1, roughness: 0.6, metalness: 0, texture: bricks },
    { name: 'Glass', color: [0.2, 0.5, 0.9], alpha: 0.5, roughness: 0.1, metalness: 0, texture: null },
    { name: 'Pixel', color: [1, 1, 1], alpha: 1, roughness: 0.9, metalness: 0, texture: pixel },
    { name: 'Metal', color: [0.9, 0.9, 0.9], alpha: 1, roughness: 0.3, metalness: 1, texture: null },
    { name: 'BricksAlt', color: [1, 1, 1], alpha: 1, roughness: 0.5, metalness: 0, texture: bricks },
    { name: 'Unused', color: [0, 1, 0], alpha: 1, roughness: 0.5, metalness: 0, texture: null },
  ];
  const objects = [
    { name: 'Cube', position: [0, 0, 1], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], mesh: cubeMesh(), materials: [0] },
    { name: 'LShape', position: [3, 0, 0], quaternion: qAxis([1, 1, 0], 35), scale: [1.5, 1, 2], mesh: lMesh(), materials: [1, 4] },
    { name: 'Cylinder', position: [-3, 2, 0], quaternion: qMul(qAxis([0, 0, 1], 30), qAxis([1, 0, 0], 45)), scale: [1, 2, 0.5], mesh: cylMesh(12), materials: [2, 3] },
    { name: 'Mirrored', position: [0, -4, 0.5], quaternion: qAxis([0, 1, 0], 20), scale: [-1, 1.5, 1], mesh: cubeMesh(), materials: [] },
    { name: 'Wire', position: [0, 4, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], mesh: { verts: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], faces: [], looseEdges: [[0, 1], [1, 2]], seams: new Set(), smooth: false }, materials: [] },
  ];
  return { objects, materials };
}

// Reference values per object: world bbox in Z-up and Y-up, triangle count, uv range, materials.
function expected(scene) {
  const out = {};
  for (const o of scene.objects) {
    const wz = o.mesh.verts.map((p) => worldPoint(o, p));
    const bb = (pts) => {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const p of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
      return { min: mn, max: mx };
    };
    let tris = 0, umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    const slots = new Set();
    for (const f of o.mesh.faces) {
      tris += f.v.length - 2;
      for (const [u, v] of f.uv) { umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
      slots.add(o.materials.length ? (f.mat < o.materials.length ? f.mat : 0) : -1);
    }
    const matNames = [...slots].sort((a, b) => a - b).map((s) => (s < 0 ? 'Default' : scene.materials[o.materials[s]].name));
    out[o.name] = {
      bboxZ: bb(wz), bboxY: bb(wz.map(toYUp)), tris, faces: o.mesh.faces.length,
      ngons: o.mesh.faces.map((f) => f.v.length),
      uv: o.mesh.faces.length ? { u: [umin, umax], v: [vmin, vmax] } : null,
      matNames, looseEdges: o.mesh.looseEdges.length, verts: o.mesh.verts.length,
      textured: matNames.filter((n) => { const m = scene.materials.find((x) => x.name === n); return m && m.texture; }),
    };
  }
  return out;
}

module.exports = { buildScene, expected, makePNG, worldPoint, toYUp, qAxis, qMul };
