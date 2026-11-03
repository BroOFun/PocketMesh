// PocketMesh export / import module.
// Exporters: OBJ(+MTL), glTF 2.0 (.glb / .gltf), COLLADA 1.4.1 (.dae), binary FBX 7.4,
// plus a STORE-only ZIP writer and an OBJ importer.
// Pure, dependency-free JS. No imports. Private top-level helpers are prefixed `_ex`.

// ---------------------------------------------------------------------------
// Options, small utilities
// ---------------------------------------------------------------------------

function _exOpts(opts) {
  const o = opts || {};
  let base = o.baseName == null ? '' : String(o.baseName).trim();
  base = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  return {
    yUp: o.yUp !== false,
    applyTransforms: !!o.applyTransforms,
    triangulate: !!o.triangulate,
    baseName: base || 'model',
    binary: o.binary !== false,
  };
}

function _exNum(x, d) {
  const v = +x;
  return Number.isFinite(v) ? v : (d === undefined ? 0 : d);
}

function _exClamp01(x) {
  const v = _exNum(x, 0);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Compact decimal formatting for text formats (6 decimals, no -0).
function _exF(x) {
  const v = +x;
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? '0' : String(r);
}

function _exUtf8(str) {
  const s = String(str);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } else c = 0xfffd;
    } else if (c >= 0xd800 && c < 0xe000) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

function _exBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return _exUtf8(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data && ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(0);
}

const _EX_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function _exBase64(bytes) {
  const n = bytes.length;
  const parts = [];
  let chunk = '';
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    chunk += _EX_B64[v >> 18] + _EX_B64[(v >> 12) & 63] + _EX_B64[(v >> 6) & 63] + _EX_B64[v & 63];
    if (chunk.length >= 32768) { parts.push(chunk); chunk = ''; }
  }
  if (i < n) {
    const v = (bytes[i] << 16) | ((i + 1 < n ? bytes[i + 1] : 0) << 8);
    chunk += _EX_B64[v >> 18] + _EX_B64[(v >> 12) & 63] + (i + 1 < n ? _EX_B64[(v >> 6) & 63] : '=') + '=';
  }
  parts.push(chunk);
  return parts.join('');
}

function _exCleanName(s, fallback) {
  const t = String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  return t || fallback;
}

function _exUniquer() {
  const used = new Set();
  return function (name) {
    let n = name;
    let k = 1;
    while (used.has(n)) n = name + '.' + String(k++).padStart(3, '0');
    used.add(n);
    return n;
  };
}

function _exXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Math (row-major 4x4 matrices: m[r*4+c])
// ---------------------------------------------------------------------------

const _EX_IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// C: Z-up -> Y-up, rotation -90 deg about X: (x, y, z) -> (x, z, -y)
const _EX_C = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];

function _exQuatNorm(q) {
  const a = Array.isArray(q) ? q : [];
  const x = _exNum(a[0]), y = _exNum(a[1]), z = _exNum(a[2]), w = a[3] == null ? 1 : _exNum(a[3]);
  const l = Math.hypot(x, y, z, w);
  if (!(l > 1e-12)) return [0, 0, 0, 1];
  return [x / l, y / l, z / l, w / l];
}

function _exQuatToMat3(q) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ];
}

function _exCompose(t, q, s) {
  const r = _exQuatToMat3(q);
  return [
    r[0] * s[0], r[1] * s[1], r[2] * s[2], t[0],
    r[3] * s[0], r[4] * s[1], r[5] * s[2], t[1],
    r[6] * s[0], r[7] * s[1], r[8] * s[2], t[2],
    0, 0, 0, 1,
  ];
}

function _exMul4(a, b) {
  const o = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
    }
  }
  return o;
}

function _exXform(m, p) {
  const x = _exNum(p && p[0]), y = _exNum(p && p[1]), z = _exNum(p && p[2]);
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

function _exDet3(m) {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
}

function _exTRS(obj) {
  const p = Array.isArray(obj.position) ? obj.position : [0, 0, 0];
  const s = Array.isArray(obj.scale) ? obj.scale : [1, 1, 1];
  return {
    t: [_exNum(p[0]), _exNum(p[1]), _exNum(p[2])],
    q: _exQuatNorm(obj.quaternion),
    s: [_exNum(s[0], 1), _exNum(s[1], 1), _exNum(s[2], 1)],
  };
}

// Conjugate a TRS by C: M' = C M C^-1.
function _exTRSYUp(trs) {
  const t = trs.t, q = trs.q, s = trs.s;
  return { t: [t[0], t[2], -t[1]], q: [q[0], q[2], -q[1], q[3]], s: [s[0], s[2], s[1]] };
}

// FBX eEulerXYZ: R = Rz * Ry * Rx, degrees.
function _exQuatToEulerXYZDeg(q) {
  const m = _exQuatToMat3(q);
  const m20 = Math.max(-1, Math.min(1, m[6]));
  let x, y, z;
  if (Math.abs(m20) < 0.9999999) {
    y = Math.asin(-m20);
    x = Math.atan2(m[7], m[8]);
    z = Math.atan2(m[3], m[0]);
  } else {
    y = m20 < 0 ? Math.PI / 2 : -Math.PI / 2;
    x = Math.atan2(-m[5], m[4]);
    z = 0;
  }
  const k = 180 / Math.PI;
  return [x * k, y * k, z * k];
}

function _exNewell(pts) {
  let nx = 0, ny = 0, nz = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

function _exNormalize(v, fallback) {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-20) || !Number.isFinite(l)) return fallback ? fallback.slice() : [0, 0, 1];
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Triangulate a polygon (array of 3D points). Returns [[i,j,k], ...] with local indices,
// keeping the polygon's winding. Ear clipping on the projection onto the Newell plane.
function _exTriangulate(pts, normal) {
  const n = pts.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  let N = normal || _exNewell(pts);
  let l = Math.hypot(N[0], N[1], N[2]);
  if (!(l > 0) || !Number.isFinite(l)) {
    const tris = [];
    for (let i = 1; i < n - 1; i++) tris.push([0, i, i + 1]);
    return tris;
  }
  N = [N[0] / l, N[1] / l, N[2] / l];
  if (n === 4) {
    // convex quad (every corner turns left about N): fan split
    let convex = true;
    for (let i = 0; i < 4 && convex; i++) {
      const a = pts[(i + 3) & 3], b = pts[i], c = pts[(i + 1) & 3];
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
      const e2x = c[0] - b[0], e2y = c[1] - b[1], e2z = c[2] - b[2];
      const d = (e1y * e2z - e1z * e2y) * N[0] + (e1z * e2x - e1x * e2z) * N[1] + (e1x * e2y - e1y * e2x) * N[2];
      if (!(d > l * 1e-12)) convex = false;
    }
    if (convex) return [[0, 1, 2], [0, 2, 3]];
  }
  // Orthonormal basis (u, v, N), right-handed so CCW about N stays CCW in 2D.
  const ref = Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [ref[1] * N[2] - ref[2] * N[1], ref[2] * N[0] - ref[0] * N[2], ref[0] * N[1] - ref[1] * N[0]];
  u = _exNormalize(u);
  const v = [N[1] * u[2] - N[2] * u[1], N[2] * u[0] - N[0] * u[2], N[0] * u[1] - N[1] * u[0]];
  const xs = new Float64Array(n), ys = new Float64Array(n);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    xs[i] = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
    ys[i] = p[0] * v[0] + p[1] * v[1] + p[2] * v[2];
    if (xs[i] < minx) minx = xs[i];
    if (xs[i] > maxx) maxx = xs[i];
    if (ys[i] < miny) miny = ys[i];
    if (ys[i] > maxy) maxy = ys[i];
  }
  const diag2 = (maxx - minx) * (maxx - minx) + (maxy - miny) * (maxy - miny);
  const eps = diag2 * 1e-12;
  const cross = (a, b, c) => (xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a]);
  if (n === 4 && cross(0, 1, 2) > eps && cross(1, 2, 3) > eps && cross(2, 3, 0) > eps && cross(3, 0, 1) > eps) {
    return [[0, 1, 2], [0, 2, 3]];
  }
  const same = (a, b) => Math.abs(xs[a] - xs[b]) <= 1e-12 * (1 + Math.abs(xs[a])) && Math.abs(ys[a] - ys[b]) <= 1e-12 * (1 + Math.abs(ys[a]));
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const tris = [];
  while (idx.length > 3) {
    const m = idx.length;
    // reflex / collinear vertices are the only ones that can block an ear
    const reflex = [];
    for (let i = 0; i < m; i++) {
      if (cross(idx[(i + m - 1) % m], idx[i], idx[(i + 1) % m]) <= eps) reflex.push(idx[i]);
    }
    let ear = -1;
    for (let i = 0; i < m && ear < 0; i++) {
      const a = idx[(i + m - 1) % m], b = idx[i], c = idx[(i + 1) % m];
      if (cross(a, b, c) <= eps) continue;
      let ok = true;
      for (let j = 0; j < reflex.length; j++) {
        const p = reflex[j];
        if (p === a || p === b || p === c || same(p, a) || same(p, b) || same(p, c)) continue;
        if (cross(a, b, p) >= -eps && cross(b, c, p) >= -eps && cross(c, a, p) >= -eps) { ok = false; break; }
      }
      if (ok) ear = i;
    }
    if (ear < 0) {
      // Degenerate or self-intersecting input: clip the "most convex" vertex.
      let best = 0, bestv = -Infinity;
      for (let i = 0; i < m; i++) {
        const cr = cross(idx[(i + m - 1) % m], idx[i], idx[(i + 1) % m]);
        if (cr > bestv) { bestv = cr; best = i; }
      }
      ear = best;
    }
    tris.push([idx[(ear + m - 1) % m], idx[ear], idx[(ear + 1) % m]]);
    idx.splice(ear, 1);
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

// ---------------------------------------------------------------------------
// Scene preparation shared by all exporters
// ---------------------------------------------------------------------------

function _exNormTexture(t) {
  if (!t || typeof t !== 'object') return null;
  const bytes = _exBytes(t.bytes);
  if (!bytes.length) return null;
  const name = _exCleanName(t.name, 'texture.png');
  let mime = t.mime;
  if (mime !== 'image/png' && mime !== 'image/jpeg') mime = /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/png';
  return { name, mime, bytes, rgba: t.rgba, filter: t.filter === 'nearest' ? 'nearest' : 'linear', width: t.width | 0, height: t.height | 0 };
}

// Id of a value in `list`, deduplicated with nested numeric Maps (no float->string keys).
function _exId3(map, list, a) {
  let m1 = map.get(a[0]);
  if (!m1) { m1 = new Map(); map.set(a[0], m1); }
  let m2 = m1.get(a[1]);
  if (!m2) { m2 = new Map(); m1.set(a[1], m2); }
  let id = m2.get(a[2]);
  if (id === undefined) { id = list.length; m2.set(a[2], id); list.push(a); }
  return id;
}

function _exId2(map, list, a) {
  let m1 = map.get(a[0]);
  if (!m1) { m1 = new Map(); map.set(a[0], m1); }
  let id = m1.get(a[1]);
  if (id === undefined) { id = list.length; m1.set(a[1], id); list.push(a); }
  return id;
}

// o: { yUp, bake }. Output-space data per object, materials and textures actually used.
function _exPrepare(scene, o) {
  const sc = scene || {};
  const sceneMats = Array.isArray(sc.materials) ? sc.materials : [];
  const objsIn = Array.isArray(sc.objects) ? sc.objects : [];
  const materials = [];
  const textures = [];
  const matByKey = new Map();
  const texByName = new Map();
  const uniqueMatName = _exUniquer();

  function exportMat(sceneIndex) {
    const key = Number.isInteger(sceneIndex) && sceneIndex >= 0 && sceneIndex < sceneMats.length && sceneMats[sceneIndex] ? sceneIndex : -1;
    if (matByKey.has(key)) return matByKey.get(key);
    const s = key >= 0 ? sceneMats[key] : null;
    const c = s && Array.isArray(s.color) ? s.color : [0.8, 0.8, 0.8];
    let tex = s ? _exNormTexture(s.texture) : null;
    if (tex) {
      if (texByName.has(tex.name)) tex = texByName.get(tex.name);
      else { tex.index = textures.length; textures.push(tex); texByName.set(tex.name, tex); }
    }
    const m = {
      name: uniqueMatName(_exCleanName(s && s.name, s ? 'Material' : 'Default')),
      color: [_exClamp01(c[0]), _exClamp01(c[1]), _exClamp01(c[2])],
      alpha: s && s.alpha != null ? _exClamp01(s.alpha) : 1,
      roughness: s && s.roughness != null ? _exClamp01(s.roughness) : 0.5,
      metalness: s && s.metalness != null ? _exClamp01(s.metalness) : 0,
      texture: tex,
      alphaMode: s?.alphaMode || 'auto', alphaCutoff: s?.alphaCutoff == null ? 0.5 : _exClamp01(s.alphaCutoff), doubleSided: s?.doubleSided !== false, wrap: s?.wrap || 'repeat',
      filter: s?.texture?.filter === 'nearest' ? 'nearest' : 'linear',
      index: materials.length,
    };
    materials.push(m);
    matByKey.set(key, m.index);
    return m.index;
  }

  const objects = [];
  for (let oi = 0; oi < objsIn.length; oi++) {
    const obj = objsIn[oi] || {};
    const mesh = obj.mesh || {};
    const trs = _exTRS(obj);
    const world = _exCompose(trs.t, trs.q, trs.s);
    let V, outTRS;
    if (o.bake) {
      V = o.yUp ? _exMul4(_EX_C, world) : world;
      outTRS = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
    } else {
      V = o.yUp ? _EX_C : _EX_IDENT;
      outTRS = o.yUp ? _exTRSYUp(trs) : trs;
    }
    const flip = !!o.bake && _exDet3(world) < 0;
    const vin = Array.isArray(mesh.verts) ? mesh.verts : [];
    const pos = vin.map((p) => _exXform(V, p));
    const nv = pos.length;
    const slotsIn = Array.isArray(obj.materials) ? obj.materials : [];

    const faces = [];
    const usedSlots = new Set();
    const fin = Array.isArray(mesh.faces) ? mesh.faces : [];
    for (const f of fin) {
      if (!f || !Array.isArray(f.v) || f.v.length < 3) continue;
      let ok = true;
      for (const i of f.v) if (!Number.isInteger(i) || i < 0 || i >= nv) { ok = false; break; }
      if (!ok) continue;
      let vi = f.v.slice();
      let uv = vi.map((_, k) => {
        const t = Array.isArray(f.uv) ? f.uv[k] : null;
        return t ? [_exNum(t[0]), _exNum(t[1])] : [0, 0];
      });
      if (flip) { vi.reverse(); uv.reverse(); }
      let slot = -1;
      if (slotsIn.length) slot = Number.isInteger(f.mat) && f.mat >= 0 && f.mat < slotsIn.length ? f.mat : 0;
      usedSlots.add(slot);
      faces.push({ v: vi, uv, slot });
    }

    // Material list for this object (slot order, deduplicated), and per-face indices.
    const slotList = Array.from(usedSlots).sort((a, b) => a - b);
    const matList = [];
    const slotToLocal = new Map();
    for (const s of slotList) {
      const gi = exportMat(s < 0 ? -1 : slotsIn[s]);
      let li = matList.indexOf(gi);
      if (li < 0) { li = matList.length; matList.push(gi); }
      slotToLocal.set(s, li);
    }
    for (const f of faces) {
      f.matLocal = slotToLocal.get(f.slot);
      f.mat = matList[f.matLocal];
    }

    // Normals (output space).
    const smooth = !!mesh.smooth;
    const vnAcc = smooth ? pos.map(() => [0, 0, 0]) : null;
    for (const f of faces) {
      const pts = f.v.map((i) => pos[i]);
      const nw = _exNewell(pts);
      f.pts = pts;
      f.newell = nw;
      f.normal = _exNormalize(nw, o.yUp ? [0, 1, 0] : [0, 0, 1]);
      if (smooth) for (const i of f.v) { const a = vnAcc[i]; a[0] += nw[0]; a[1] += nw[1]; a[2] += nw[2]; }
    }
    const vn = smooth ? vnAcc.map((a) => (Math.hypot(a[0], a[1], a[2]) > 1e-20 ? _exNormalize(a, null) : null)) : null;
    // Unique normals / UVs per object (exact values); corners reference them by integer id.
    const normals = [], uvs = [];
    const nMap = new Map(), uvMap = new Map();
    const vnId = smooth ? new Int32Array(nv).fill(-1) : null;
    for (const f of faces) {
      const len = f.v.length;
      f.n = new Array(len);
      f.nid = new Array(len);
      f.uvid = new Array(len);
      let fid = -1;
      for (let k = 0; k < len; k++) {
        const vi = f.v[k];
        if (smooth && vn[vi]) {
          f.n[k] = vn[vi];
          if (vnId[vi] < 0) vnId[vi] = _exId3(nMap, normals, vn[vi]);
          f.nid[k] = vnId[vi];
        } else {
          f.n[k] = f.normal;
          if (fid < 0) fid = _exId3(nMap, normals, f.normal);
          f.nid[k] = fid;
        }
        f.uvid[k] = _exId2(uvMap, uvs, f.uv[k]);
      }
      f.tris = null;
    }

    const loose = [];
    const le = Array.isArray(mesh.looseEdges) ? mesh.looseEdges : [];
    for (const e of le) {
      if (!e || e.length < 2) continue;
      const a = e[0], b = e[1];
      if (Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a < nv && b < nv && a !== b) loose.push([a, b]);
    }

    objects.push({
      name: _exCleanName(obj.name, 'Object'),
      pos, faces, loose, smooth, matList, normals, uvs,
      trs: outTRS,
      matrix: _exCompose(outTRS.t, outTRS.q, outTRS.s),
    });
  }
  return { objects, materials, textures };
}

function _exFaceTris(f) {
  if (!f.tris) f.tris = _exTriangulate(f.pts, f.newell);
  return f.tris;
}

// Polygons to write for a face: one polygon (corner list) or its triangles.
function _exFacePolys(f, triangulate) {
  if (!triangulate || f.v.length === 3) return [f.v.map((_, k) => k)];
  return _exFaceTris(f);
}

function _exTextureFiles(prep) {
  return prep.textures.map((t) => ({ name: t.name, data: t.bytes }));
}

// ---------------------------------------------------------------------------
// OBJ + MTL
// ---------------------------------------------------------------------------

export function exportOBJ(scene, opts) {
  const o = _exOpts(opts);
  const prep = _exPrepare(scene, { yUp: o.yUp, bake: true });
  const base = o.baseName;
  const out = ['# PocketMesh OBJ export', 'mtllib ' + base + '.mtl'];
  let vOff = 0, vtOff = 0, vnOff = 0;
  for (const ob of prep.objects) {
    out.push('o ' + ob.name);
    for (const p of ob.pos) out.push('v ' + _exF(p[0]) + ' ' + _exF(p[1]) + ' ' + _exF(p[2]));
    for (const t of ob.uvs) out.push('vt ' + _exF(t[0]) + ' ' + _exF(t[1]));
    for (const n of ob.normals) out.push('vn ' + _exF(n[0]) + ' ' + _exF(n[1]) + ' ' + _exF(n[2]));
    out.push(ob.smooth ? 's 1' : 's off');
    let cur = -1;
    for (const f of ob.faces) {
      if (f.mat !== cur) { cur = f.mat; out.push('usemtl ' + prep.materials[cur].name); }
      const refs = f.v.map((vi, k) => (vi + 1 + vOff) + '/' + (f.uvid[k] + 1 + vtOff) + '/' + (f.nid[k] + 1 + vnOff));
      for (const poly of _exFacePolys(f, o.triangulate)) out.push('f ' + poly.map((k) => refs[k]).join(' '));
    }
    for (const e of ob.loose) out.push('l ' + (e[0] + 1 + vOff) + ' ' + (e[1] + 1 + vOff));
    vOff += ob.pos.length; vtOff += ob.uvs.length; vnOff += ob.normals.length;
  }
  out.push('');

  const mtl = ['# PocketMesh MTL export', '# Material count: ' + prep.materials.length];
  for (const m of prep.materials) {
    const ns = Math.min(900, Math.pow((1 - m.roughness) * 30, 2));
    const ka = m.metalness > 0 ? m.metalness : 1;
    mtl.push('', 'newmtl ' + m.name);
    mtl.push('Ns ' + _exF(ns));
    mtl.push('Ka ' + _exF(ka) + ' ' + _exF(ka) + ' ' + _exF(ka));
    mtl.push('Kd ' + m.color.map(_exF).join(' '));
    mtl.push('Ks 0.5 0.5 0.5');
    mtl.push('Ke 0 0 0');
    mtl.push('Ni 1.45');
    mtl.push('d ' + _exF(m.alpha));
    mtl.push('illum 2');
    mtl.push('Pr ' + _exF(m.roughness));
    mtl.push('Pm ' + _exF(m.metalness));
    if (m.texture) mtl.push('map_Kd ' + m.texture.name);
  }
  mtl.push('');
  return [
    { name: base + '.obj', data: out.join('\n') },
    { name: base + '.mtl', data: mtl.join('\n') },
  ].concat(_exTextureFiles(prep));
}

// ---------------------------------------------------------------------------
// OBJ import
// ---------------------------------------------------------------------------

export function importOBJ(text) {
  const src = String(text == null ? '' : text).replace(/\\\r?\n/g, ' ');
  const lines = src.split(/\r\n|\r|\n/);
  const P = [];
  const T = [];
  const objects = [];
  let cur = null;
  const mtllib = [];
  // usemtl and s are file-level state in OBJ: they carry over into following o/g groups.
  let curMat = null;
  let curSmooth = false;

  function newObj(name, fromO) {
    cur = { name: name || 'Object', named: !!fromO, faces: [], lines: [], smooth: false, matNames: [] };
    objects.push(cur);
  }
  function matSlot(o) {
    if (curMat === null) return 0;
    let i = o.matNames.indexOf(curMat);
    if (i < 0) { i = o.matNames.length; o.matNames.push(curMat); }
    return i;
  }
  function ensure() { if (!cur) newObj('Object', false); return cur; }
  function isEmpty(o) { return o.faces.length === 0 && o.lines.length === 0; }
  function resolve(s, len) {
    const i = parseInt(s, 10);
    if (!Number.isFinite(i) || i === 0) return -1;
    const r = i > 0 ? i - 1 : len + i;
    return r >= 0 && r < len ? r : -1;
  }

  for (let raw of lines) {
    const hash = raw.indexOf('#');
    if (hash >= 0) raw = raw.slice(0, hash);
    const line = raw.trim();
    if (!line) continue;
    const sp = line.search(/\s/);
    const key = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
    const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
    const tok = rest ? rest.split(/\s+/) : [];
    if (key === 'v') {
      const x = _exNum(parseFloat(tok[0])), y = _exNum(parseFloat(tok[1])), z = _exNum(parseFloat(tok[2]));
      P.push([x, -z, y]);
    } else if (key === 'vt') {
      T.push([_exNum(parseFloat(tok[0])), _exNum(parseFloat(tok[1]))]);
    } else if (key === 'f' || key === 'fo') {
      const o = ensure();
      const fv = [], fuv = [];
      for (const t of tok) {
        const parts = t.split('/');
        const vi = resolve(parts[0], P.length);
        if (vi < 0) continue;
        const ti = parts.length > 1 && parts[1] !== '' ? resolve(parts[1], T.length) : -1;
        if (fv.length && fv[fv.length - 1] === vi) continue;
        fv.push(vi);
        fuv.push(ti >= 0 ? T[ti].slice() : [0, 0]);
      }
      while (fv.length > 1 && fv[0] === fv[fv.length - 1]) { fv.pop(); fuv.pop(); }
      if (fv.length >= 3) {
        o.faces.push({ v: fv, uv: fuv, mat: matSlot(o) });
        if (curSmooth) o.smooth = true;
      }
    } else if (key === 'l') {
      const o = ensure();
      const idx = tok.map((t) => resolve(t.split('/')[0], P.length)).filter((i) => i >= 0);
      for (let k = 0; k + 1 < idx.length; k++) if (idx[k] !== idx[k + 1]) o.lines.push([idx[k], idx[k + 1]]);
    } else if (key === 'o' || key === 'g') {
      const name = rest || (cur ? cur.name : 'Object');
      if (!cur || !isEmpty(cur)) newObj(name, key === 'o');
      else if (key === 'o' || !cur.named) { cur.name = name; cur.named = cur.named || key === 'o'; }
    } else if (key === 'usemtl') {
      curMat = rest;
    } else if (key === 's') {
      const v = (tok[0] || '').toLowerCase();
      curSmooth = !!v && v !== 'off' && v !== '0';
    } else if (key === 'mtllib') {
      if (rest) mtllib.push(rest);
    }
  }

  const result = [];
  for (const o of objects) {
    if (isEmpty(o)) continue;
    // Local vertex indices keep the file order of the vertices this object uses.
    const used = new Set();
    for (const f of o.faces) for (const i of f.v) used.add(i);
    for (const e of o.lines) { used.add(e[0]); used.add(e[1]); }
    const order = Array.from(used).sort((a, b) => a - b);
    const map = new Map();
    const verts = order.map((gi, li) => { map.set(gi, li); return P[gi].slice(); });
    const loc = (gi) => map.get(gi);
    const faces = o.faces.map((f) => ({ v: f.v.map(loc), uv: f.uv, mat: f.mat }));
    const faceEdges = new Set();
    for (const f of faces) {
      for (let k = 0; k < f.v.length; k++) {
        const a = f.v[k], b = f.v[(k + 1) % f.v.length];
        faceEdges.add(Math.min(a, b) + '_' + Math.max(a, b));
      }
    }
    const looseEdges = [];
    const seen = new Set();
    for (const e of o.lines) {
      const a = loc(e[0]), b = loc(e[1]);
      const k = Math.min(a, b) + '_' + Math.max(a, b);
      if (faceEdges.has(k) || seen.has(k)) continue;
      seen.add(k);
      looseEdges.push([a, b]);
    }
    result.push({
      name: o.name,
      mesh: { verts, faces, looseEdges, seams: new Set(), smooth: o.smooth },
      materialNames: o.matNames.slice(),
    });
  }
  if (!result.length && P.length) {
    result.push({ name: 'Object', mesh: { verts: P.map((p) => p.slice()), faces: [], looseEdges: [], seams: new Set(), smooth: false }, materialNames: [] });
  }
  return { objects: result, mtllib };
}

// ---------------------------------------------------------------------------
// glTF 2.0
// ---------------------------------------------------------------------------

function _exBinBuilder() {
  const chunks = [];
  let len = 0;
  return {
    add(bytes) {
      len = (len + 3) & ~3;
      const off = len;
      chunks.push({ off, bytes });
      len = off + bytes.byteLength;
      return off;
    },
    get length() { return len; },
    finish() {
      const total = (len + 3) & ~3;
      const out = new Uint8Array(total);
      for (const c of chunks) out.set(c.bytes, c.off);
      return out;
    },
  };
}

function _exU8(ta) {
  return new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
}

export function exportGLTF(scene, opts) {
  const o = _exOpts(opts);
  const prep = _exPrepare(scene, { yUp: true, bake: o.applyTransforms });
  const bin = _exBinBuilder();
  const json = {
    asset: { version: '2.0', generator: 'PocketMesh' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [] }],
    nodes: [], meshes: [], materials: [], textures: [], images: [], samplers: [],
    accessors: [], bufferViews: [], buffers: [],
  };

  function view(bytes, target) {
    const off = bin.add(bytes);
    const bv = { buffer: 0, byteOffset: off, byteLength: bytes.byteLength };
    if (target) bv.target = target;
    json.bufferViews.push(bv);
    return json.bufferViews.length - 1;
  }
  function accessor(ta, componentType, type, count, extra) {
    const acc = Object.assign({ bufferView: view(_exU8(ta), extra && extra.target), componentType, count, type }, extra && extra.acc);
    json.accessors.push(acc);
    return json.accessors.length - 1;
  }
  function vec3Accessor(arr, withMinMax) {
    const extra = { target: 34962 };
    if (withMinMax) {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < arr.length; i += 3) {
        for (let k = 0; k < 3; k++) { const v = arr[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
      }
      extra.acc = { min: mn, max: mx };
    }
    return accessor(arr, 5126, 'VEC3', arr.length / 3, extra);
  }
  function indexAccessor(list, vcount) {
    const ta = vcount <= 65535 ? new Uint16Array(list) : new Uint32Array(list);
    return accessor(ta, vcount <= 65535 ? 5123 : 5125, 'SCALAR', list.length, { target: 34963 });
  }

  // Textures / images / samplers
  const texIndex = new Map();
  const samplerIndex = {};
  for (const t of prep.textures) {
    const nearest = t.filter === 'nearest';
    const sk = nearest ? 'n' : 'l';
    if (samplerIndex[sk] === undefined) {
      samplerIndex[sk] = json.samplers.length;
      json.samplers.push(nearest
        ? { magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 }
        : { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
    }
    const img = { name: t.name.replace(/\.[^.]*$/, '') || t.name, mimeType: t.mime };
    if (o.binary) img.bufferView = view(t.bytes, 0);
    else img.uri = 'data:' + t.mime + ';base64,' + _exBase64(t.bytes);
    json.images.push(img);
    json.textures.push({ name: img.name, sampler: samplerIndex[sk], source: json.images.length - 1 });
    texIndex.set(t, json.textures.length - 1);
  }
  for (const m of prep.materials) {
    const pbr = {
      baseColorFactor: [m.color[0], m.color[1], m.color[2], m.alpha],
      metallicFactor: m.metalness,
      roughnessFactor: m.roughness,
    };
    if (m.texture) pbr.baseColorTexture = { index: texIndex.get(m.texture) };
    const gm = { name: m.name, pbrMetallicRoughness: pbr, doubleSided: true };
    if (m.alpha < 1) gm.alphaMode = 'BLEND';
    json.materials.push(gm);
  }

  for (const ob of prep.objects) {
    const node = { name: ob.name };
    const t = ob.trs;
    if (t.t[0] || t.t[1] || t.t[2]) node.translation = t.t.slice();
    if (t.q[0] || t.q[1] || t.q[2] || t.q[3] !== 1) node.rotation = t.q.slice();
    if (t.s[0] !== 1 || t.s[1] !== 1 || t.s[2] !== 1) node.scale = t.s.slice();
    const prims = [];
    for (const gi of ob.matList) {
      // split vertices by unique (position, normal, uv) within the primitive
      const perV = new Array(ob.pos.length);
      const P = [], N = [], UV = [], I = [];
      for (const f of ob.faces) {
        if (f.mat !== gi) continue;
        const ids = f.v.map((vi, k) => {
          const nid = f.nid[k], uid = f.uvid[k];
          let list = perV[vi];
          if (!list) { list = []; perV[vi] = list; }
          for (let j = 0; j < list.length; j += 3) if (list[j] === nid && list[j + 1] === uid) return list[j + 2];
          const id = P.length / 3;
          list.push(nid, uid, id);
          const p = ob.pos[vi], n = ob.normals[nid], uv = ob.uvs[uid];
          P.push(p[0], p[1], p[2]);
          N.push(n[0], n[1], n[2]);
          UV.push(uv[0], 1 - uv[1]);
          return id;
        });
        for (const tri of _exFaceTris(f)) I.push(ids[tri[0]], ids[tri[1]], ids[tri[2]]);
      }
      if (!I.length) continue;
      const nv = P.length / 3;
      // Re-normalize in float32 to keep the validator's unit-length check happy.
      const n32 = new Float32Array(N);
      for (let i = 0; i < n32.length; i += 3) {
        const l = Math.hypot(n32[i], n32[i + 1], n32[i + 2]);
        if (l > 0) { n32[i] /= l; n32[i + 1] /= l; n32[i + 2] /= l; } else { n32[i + 1] = 1; }
      }
      prims.push({
        attributes: {
          POSITION: vec3Accessor(new Float32Array(P), true),
          NORMAL: vec3Accessor(n32, false),
          TEXCOORD_0: accessor(new Float32Array(UV), 5126, 'VEC2', nv, { target: 34962 }),
        },
        indices: indexAccessor(I, nv),
        material: gi,
        mode: 4,
      });
    }
    if (ob.loose.length) {
      const map = new Map();
      const P = [], I = [];
      for (const e of ob.loose) {
        for (const vi of e) {
          let id = map.get(vi);
          if (id === undefined) { id = P.length / 3; map.set(vi, id); const p = ob.pos[vi]; P.push(p[0], p[1], p[2]); }
          I.push(id);
        }
      }
      prims.push({ attributes: { POSITION: vec3Accessor(new Float32Array(P), true) }, indices: indexAccessor(I, P.length / 3), mode: 1 });
    }
    if (prims.length) {
      json.meshes.push({ name: ob.name, primitives: prims });
      node.mesh = json.meshes.length - 1;
    }
    json.nodes.push(node);
    json.scenes[0].nodes.push(json.nodes.length - 1);
  }

  const binBytes = bin.finish();
  if (binBytes.length) {
    const buf = { byteLength: binBytes.length };
    if (!o.binary) buf.uri = 'data:application/octet-stream;base64,' + _exBase64(binBytes);
    json.buffers.push(buf);
  }
  for (const k of ['nodes', 'meshes', 'materials', 'textures', 'images', 'samplers', 'accessors', 'bufferViews', 'buffers']) {
    if (!json[k].length) delete json[k];
  }
  if (!json.scenes[0].nodes.length) delete json.scenes[0].nodes;

  if (!o.binary) return [{ name: o.baseName + '.gltf', data: JSON.stringify(json, null, 1) }];

  const jsonRaw = _exUtf8(JSON.stringify(json));
  const jsonLen = (jsonRaw.length + 3) & ~3;
  const total = 12 + 8 + jsonLen + (binBytes.length ? 8 + binBytes.length : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonRaw, 20);
  for (let i = 20 + jsonRaw.length; i < 20 + jsonLen; i++) out[i] = 0x20;
  if (binBytes.length) {
    const b = 20 + jsonLen;
    dv.setUint32(b, binBytes.length, true);
    dv.setUint32(b + 4, 0x004e4942, true);
    out.set(binBytes, b + 8);
  }
  return [{ name: o.baseName + '.glb', data: out }];
}

// ---------------------------------------------------------------------------
// COLLADA 1.4.1
// ---------------------------------------------------------------------------

function _exDaeIdMaker() {
  const used = new Set();
  return function (name, suffix) {
    let s = String(name).replace(/[^A-Za-z0-9_.-]/g, '_');
    if (!/^[A-Za-z_]/.test(s)) s = '_' + s;
    let id = s + (suffix || '');
    let k = 1;
    while (used.has(id)) id = s + '_' + (k++) + (suffix || '');
    used.add(id);
    return id;
  };
}

// COLLADA 1.4.1 types every `name` attribute as xs:NCName: no spaces/punctuation, no leading digit.
function _exNCName(name) {
  let s = String(name).replace(/[^\p{L}\p{N}._-]/gu, '_');
  if (!/^[\p{L}_]/u.test(s)) s = '_' + s;
  return _exXml(s);
}

export function exportDAE(scene, opts) {
  const o = _exOpts(opts);
  const prep = _exPrepare(scene, { yUp: o.yUp, bake: o.applyTransforms });
  const mkId = _exDaeIdMaker();
  const X = _exNCName;
  const L = [];
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  L.push('<?xml version="1.0" encoding="utf-8"?>');
  L.push('<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">');
  L.push('  <asset>');
  L.push('    <contributor><author>PocketMesh</author><authoring_tool>PocketMesh</authoring_tool></contributor>');
  L.push('    <created>' + now + '</created>');
  L.push('    <modified>' + now + '</modified>');
  L.push('    <unit name="meter" meter="1"/>');
  L.push('    <up_axis>' + (o.yUp ? 'Y_UP' : 'Z_UP') + '</up_axis>');
  L.push('  </asset>');

  const imgId = new Map();
  if (prep.textures.length) {
    L.push('  <library_images>');
    for (const t of prep.textures) {
      const id = mkId(t.name, '-image');
      imgId.set(t, id);
      L.push('    <image id="' + id + '" name="' + X(t.name) + '"><init_from>' + _exXml(encodeURIComponent(t.name)) + '</init_from></image>');
    }
    L.push('  </library_images>');
  }

  const matId = [];
  if (prep.materials.length) {
    const effId = [];
    for (const m of prep.materials) { effId.push(mkId(m.name, '-effect')); matId.push(mkId(m.name, '-material')); }
    L.push('  <library_effects>');
    prep.materials.forEach((m, i) => {
      L.push('    <effect id="' + effId[i] + '">');
      L.push('      <profile_COMMON>');
      let diffuse = '<color sid="diffuse">' + m.color.map(_exF).join(' ') + ' 1</color>';
      if (m.texture) {
        const iid = imgId.get(m.texture);
        const filt = m.texture.filter === 'nearest' ? 'NEAREST' : 'LINEAR';
        const minf = m.texture.filter === 'nearest' ? 'NEAREST' : 'LINEAR_MIPMAP_LINEAR';
        L.push('        <newparam sid="' + iid + '-surface"><surface type="2D"><init_from>' + iid + '</init_from></surface></newparam>');
        L.push('        <newparam sid="' + iid + '-sampler"><sampler2D><source>' + iid + '-surface</source><minfilter>' + minf + '</minfilter><magfilter>' + filt + '</magfilter></sampler2D></newparam>');
        diffuse = '<texture texture="' + iid + '-sampler" texcoord="UVMap"/>';
      }
      L.push('        <technique sid="common">');
      L.push('          <lambert>');
      L.push('            <emission><color sid="emission">0 0 0 1</color></emission>');
      L.push('            <diffuse>' + diffuse + '</diffuse>');
      if (m.alpha < 1) {
        L.push('            <transparent opaque="A_ONE"><color>1 1 1 1</color></transparent>');
        L.push('            <transparency><float sid="transparency">' + _exF(m.alpha) + '</float></transparency>');
      }
      L.push('            <index_of_refraction><float sid="ior">1.45</float></index_of_refraction>');
      L.push('          </lambert>');
      L.push('        </technique>');
      L.push('      </profile_COMMON>');
      L.push('    </effect>');
    });
    L.push('  </library_effects>');
    L.push('  <library_materials>');
    prep.materials.forEach((m, i) => {
      L.push('    <material id="' + matId[i] + '" name="' + X(m.name) + '"><instance_effect url="#' + effId[i] + '"/></material>');
    });
    L.push('  </library_materials>');
  }

  const nodeIds = prep.objects.map((ob) => mkId(ob.name, ''));
  const geomIds = prep.objects.map((ob, i) => (ob.faces.length || ob.loose.length ? mkId(nodeIds[i], '-mesh') : null));
  if (geomIds.some((g) => g)) {
    L.push('  <library_geometries>');
    prep.objects.forEach((ob, oi) => {
      const gid = geomIds[oi];
      if (!gid) return;
      L.push('    <geometry id="' + gid + '" name="' + X(ob.name) + '">');
      L.push('      <mesh>');
      const src = (id, arr, count, params) => {
        L.push('        <source id="' + id + '">');
        L.push('          <float_array id="' + id + '-array" count="' + arr.length + '">' + arr.map(_exF).join(' ') + '</float_array>');
        L.push('          <technique_common><accessor source="#' + id + '-array" count="' + count + '" stride="' + params.length + '">' +
          params.map((p) => '<param name="' + p + '" type="float"/>').join('') + '</accessor></technique_common>');
        L.push('        </source>');
      };
      const posArr = [];
      for (const p of ob.pos) posArr.push(p[0], p[1], p[2]);
      src(gid + '-positions', posArr, ob.pos.length, ['X', 'Y', 'Z']);
      const corner = ob.faces.map((f) => f.v.map((vi, k) => vi + ' ' + f.nid[k] + ' ' + f.uvid[k]));
      if (ob.faces.length) {
        const nArr = [], uvArr = [];
        for (const n of ob.normals) nArr.push(n[0], n[1], n[2]);
        for (const t of ob.uvs) uvArr.push(t[0], t[1]);
        src(gid + '-normals', nArr, ob.normals.length, ['X', 'Y', 'Z']);
        src(gid + '-map-0', uvArr, ob.uvs.length, ['S', 'T']);
      }
      L.push('        <vertices id="' + gid + '-vertices"><input semantic="POSITION" source="#' + gid + '-positions"/></vertices>');
      const inputs = '          <input semantic="VERTEX" source="#' + gid + '-vertices" offset="0"/>\n' +
        '          <input semantic="NORMAL" source="#' + gid + '-normals" offset="1"/>\n' +
        '          <input semantic="TEXCOORD" source="#' + gid + '-map-0" offset="2" set="0"/>';
      for (const gi of ob.matList) {
        const polys = [];
        ob.faces.forEach((f, fi) => {
          if (f.mat !== gi) return;
          for (const poly of _exFacePolys(f, o.triangulate)) polys.push(poly.map((k) => corner[fi][k]));
        });
        if (!polys.length) continue;
        if (o.triangulate) {
          L.push('        <triangles material="' + matId[gi] + '" count="' + polys.length + '">');
          L.push(inputs);
          L.push('          <p>' + polys.map((p) => p.join(' ')).join(' ') + '</p>');
          L.push('        </triangles>');
        } else {
          L.push('        <polylist material="' + matId[gi] + '" count="' + polys.length + '">');
          L.push(inputs);
          L.push('          <vcount>' + polys.map((p) => p.length).join(' ') + '</vcount>');
          L.push('          <p>' + polys.map((p) => p.join(' ')).join(' ') + '</p>');
          L.push('        </polylist>');
        }
      }
      if (ob.loose.length) {
        L.push('        <lines count="' + ob.loose.length + '">');
        L.push('          <input semantic="VERTEX" source="#' + gid + '-vertices" offset="0"/>');
        L.push('          <p>' + ob.loose.map((e) => e[0] + ' ' + e[1]).join(' ') + '</p>');
        L.push('        </lines>');
      }
      L.push('      </mesh>');
      L.push('    </geometry>');
    });
    L.push('  </library_geometries>');
  }

  L.push('  <library_visual_scenes>');
  L.push('    <visual_scene id="Scene" name="Scene">');
  prep.objects.forEach((ob, oi) => {
    L.push('      <node id="' + nodeIds[oi] + '" name="' + X(ob.name) + '" type="NODE">');
    L.push('        <matrix sid="transform">' + ob.matrix.map(_exF).join(' ') + '</matrix>');
    if (geomIds[oi]) {
      L.push('        <instance_geometry url="#' + geomIds[oi] + '" name="' + X(ob.name) + '">');
      if (ob.matList.length) {
        L.push('          <bind_material><technique_common>');
        for (const gi of ob.matList) {
          L.push('            <instance_material symbol="' + matId[gi] + '" target="#' + matId[gi] + '">' +
            '<bind_vertex_input semantic="UVMap" input_semantic="TEXCOORD" input_set="0"/></instance_material>');
        }
        L.push('          </technique_common></bind_material>');
      }
      L.push('        </instance_geometry>');
    }
    L.push('      </node>');
  });
  L.push('    </visual_scene>');
  L.push('  </library_visual_scenes>');
  L.push('  <scene><instance_visual_scene url="#Scene"/></scene>');
  L.push('</COLLADA>');
  L.push('');
  return [{ name: o.baseName + '.dae', data: L.join('\n') }].concat(_exTextureFiles(prep));
}

// ---------------------------------------------------------------------------
// FBX binary 7.4
// ---------------------------------------------------------------------------

function _exFbxN(name, props, children) {
  return { name, props: props || [], children: children || [] };
}
const _exFbx = {
  I: (v) => ({ t: 'I', v: v | 0 }),
  D: (v) => ({ t: 'D', v: _exNum(v) }),
  L: (v) => ({ t: 'L', v }),
  C: (v) => ({ t: 'C', v: v ? 1 : 0 }),
  S: (v) => ({ t: 'S', v: _exUtf8(v) }),
  Sraw: (bytes) => ({ t: 'S', v: bytes }),
  R: (bytes) => ({ t: 'R', v: bytes }),
  d: (arr) => ({ t: 'd', v: arr }),
  i: (arr) => ({ t: 'i', v: arr }),
};

// Object name "Name\x00\x01Class"
function _exFbxName(name, cls) {
  const a = _exUtf8(String(name).replace(/[\x00-\x1f]/g, ' '));
  const b = _exUtf8(cls);
  const out = new Uint8Array(a.length + 2 + b.length);
  out.set(a, 0);
  out[a.length] = 0;
  out[a.length + 1] = 1;
  out.set(b, a.length + 2);
  return _exFbx.Sraw(out);
}

// Properties70 "P" helpers
function _exP(name, type, label, flags, vals) {
  return _exFbxN('P', [_exFbx.S(name), _exFbx.S(type), _exFbx.S(label), _exFbx.S(flags)].concat(vals || []));
}
const _exP70 = {
  int: (n, v) => _exP(n, 'int', 'Integer', '', [_exFbx.I(v)]),
  bool: (n, v) => _exP(n, 'bool', '', '', [_exFbx.I(v ? 1 : 0)]),
  enm: (n, v) => _exP(n, 'enum', '', '', [_exFbx.I(v)]),
  dbl: (n, v) => _exP(n, 'double', 'Number', '', [_exFbx.D(v)]),
  num: (n, v) => _exP(n, 'Number', '', 'A', [_exFbx.D(v)]),
  col: (n, c) => _exP(n, 'Color', '', 'A', c.map(_exFbx.D)),
  colRGB: (n, c) => _exP(n, 'ColorRGB', 'Color', '', c.map(_exFbx.D)),
  vec: (n, c) => _exP(n, 'Vector3D', 'Vector', '', c.map(_exFbx.D)),
  lcl: (n, c) => _exP(n, n, '', 'A', c.map(_exFbx.D)),
  str: (n, s, label) => _exP(n, 'KString', label || '', '', [_exFbx.S(s)]),
  time: (n, v) => _exP(n, 'KTime', 'Time', '', [_exFbx.L(v)]),
  obj: (n) => _exP(n, 'object', '', '', []),
  compound: (n) => _exP(n, 'Compound', '', '', []),
  dateTime: (n, s) => _exP(n, 'DateTime', '', '', [_exFbx.S(s)]),
};

function _exFbxPropSize(p) {
  switch (p.t) {
    case 'Y': return 3;
    case 'C': return 2;
    case 'I': case 'F': return 5;
    case 'D': case 'L': return 9;
    case 'S': case 'R': return 5 + p.v.length;
    case 'f': case 'i': return 13 + p.v.length * 4;
    case 'd': case 'l': return 13 + p.v.length * 8;
    case 'b': return 13 + p.v.length;
  }
  throw new Error('FBX: bad property type ' + p.t);
}

function _exFbxSize(node) {
  node._name = _exUtf8(node.name);
  let s = 13 + node._name.length;
  let pl = 0;
  for (const p of node.props) pl += _exFbxPropSize(p);
  node._pl = pl;
  s += pl;
  if (node.children.length) {
    for (const c of node.children) s += _exFbxSize(c);
    s += 13;
  } else if (!node.props.length) {
    s += 13;
  }
  node._size = s;
  return s;
}

function _exFbxWriteL(dv, off, v) {
  // int64 little endian from a JS number (|v| < 2^53)
  const lo = v >>> 0;
  let hi = Math.floor(v / 4294967296);
  dv.setUint32(off, lo, true);
  dv.setInt32(off + 4, hi | 0, true);
}

function _exFbxWrite(node, u8, dv, off) {
  const start = off;
  dv.setUint32(off, start + node._size, true);
  dv.setUint32(off + 4, node.props.length, true);
  dv.setUint32(off + 8, node._pl, true);
  u8[off + 12] = node._name.length;
  u8.set(node._name, off + 13);
  off += 13 + node._name.length;
  for (const p of node.props) {
    u8[off++] = p.t.charCodeAt(0);
    switch (p.t) {
      case 'Y': dv.setInt16(off, p.v, true); off += 2; break;
      case 'C': u8[off++] = p.v ? 1 : 0; break;
      case 'I': dv.setInt32(off, p.v, true); off += 4; break;
      case 'F': dv.setFloat32(off, p.v, true); off += 4; break;
      case 'D': dv.setFloat64(off, p.v, true); off += 8; break;
      case 'L': _exFbxWriteL(dv, off, p.v); off += 8; break;
      case 'S': case 'R':
        dv.setUint32(off, p.v.length, true); off += 4;
        u8.set(p.v, off); off += p.v.length;
        break;
      default: {
        const n = p.v.length;
        const es = p.t === 'd' || p.t === 'l' ? 8 : p.t === 'b' ? 1 : 4;
        dv.setUint32(off, n, true);
        dv.setUint32(off + 4, 0, true);
        dv.setUint32(off + 8, n * es, true);
        off += 12;
        for (let i = 0; i < n; i++) {
          const v = p.v[i];
          if (p.t === 'd') dv.setFloat64(off, v, true);
          else if (p.t === 'f') dv.setFloat32(off, v, true);
          else if (p.t === 'i') dv.setInt32(off, v, true);
          else if (p.t === 'l') _exFbxWriteL(dv, off, v);
          else u8[off] = v ? 1 : 0;
          off += es;
        }
      }
    }
  }
  if (node.children.length) {
    for (const c of node.children) off = _exFbxWrite(c, u8, dv, off);
    off += 13; // zero sentinel (buffer is zero-initialised)
  } else if (!node.props.length) {
    off += 13;
  }
  if (off !== start + node._size) throw new Error('FBX: size mismatch in ' + node.name);
  return off;
}

const _EX_FBX_FOOTER_ID = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
const _EX_FBX_FOOTER_MAGIC = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];
const _EX_FBX_FILE_ID = [0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1];

function _exFbxSerialize(roots) {
  const head = _exUtf8('Kaydara FBX Binary  ');
  const headLen = head.length + 3 + 4; // + \0 \x1a \0 + version
  let size = headLen;
  for (const r of roots) size += _exFbxSize(r);
  size += 13; // top-level null record
  const footStart = size;
  let afterId = footStart + 16 + 4;
  let pad = ((afterId + 15) & ~15) - afterId;
  if (pad === 0) pad = 16;
  size = afterId + pad + 4 + 120 + 16;
  const u8 = new Uint8Array(size);
  const dv = new DataView(u8.buffer);
  u8.set(head, 0);
  u8[head.length] = 0; u8[head.length + 1] = 0x1a; u8[head.length + 2] = 0;
  dv.setUint32(head.length + 3, 7400, true);
  let off = headLen;
  for (const r of roots) off = _exFbxWrite(r, u8, dv, off);
  off += 13;
  u8.set(_EX_FBX_FOOTER_ID, off);
  off += 16 + 4 + pad;
  dv.setUint32(off, 7400, true);
  off += 4 + 120;
  u8.set(_EX_FBX_FOOTER_MAGIC, off);
  return u8;
}

export function exportFBX(scene, opts) {
  const o = _exOpts(opts);
  const prep = _exPrepare(scene, { yUp: o.yUp, bake: o.applyTransforms });
  const F = _exFbx, N = _exFbxN, P = _exP70;
  const fileName = o.baseName + '.fbx';
  let nextId = 1000000;
  const newId = () => nextId++;

  const objectsNodes = [];
  const conns = [];
  const rootConns = [];
  const counts = { Model: 0, Geometry: 0, Material: 0, Texture: 0, Video: 0 };

  // Videos + textures (shared, embedded)
  const texId = new Map();
  for (const t of prep.textures) {
    const vid = newId(), tid = newId();
    const base = t.name;
    objectsNodes.push(N('Video', [F.L(vid), _exFbxName(base, 'Video'), F.S('Clip')], [
      N('Type', [F.S('Clip')]),
      N('Properties70', [], [P.str('Path', t.name, 'XRefUrl'), P.str('RelPath', t.name, 'XRefUrl')]),
      N('UseMipMap', [F.I(0)]),
      N('Filename', [F.S(t.name)]),
      N('RelativeFilename', [F.S(t.name)]),
      N('Content', [F.R(t.bytes)]),
    ]));
    objectsNodes.push(N('Texture', [F.L(tid), _exFbxName(base, 'Texture'), F.S('')], [
      N('Type', [F.S('TextureVideoClip')]),
      N('Version', [F.I(202)]),
      N('TextureName', [_exFbxName(base, 'Texture')]),
      N('Properties70', [], [P.bool('UseMaterial', 1), P.enm('AlphaSource', 2), P.str('UVSet', 'UVMap')]),
      N('Media', [_exFbxName(base, 'Video')]),
      N('FileName', [F.S(t.name)]),
      N('RelativeFilename', [F.S(t.name)]),
      N('ModelUVTranslation', [F.D(0), F.D(0)]),
      N('ModelUVScaling', [F.D(1), F.D(1)]),
      N('Texture_Alpha_Source', [F.S('None')]),
      N('Cropping', [F.I(0), F.I(0), F.I(0), F.I(0)]),
    ]));
    conns.push(N('C', [F.S('OO'), F.L(vid), F.L(tid)]));
    texId.set(t, tid);
    counts.Video++; counts.Texture++;
  }

  // Materials
  const matIds = prep.materials.map((m) => {
    const id = newId();
    const shin = Math.pow((1 - m.roughness) * 10, 2);
    const transp = m.alpha < 1 ? [1, 1, 1] : [0, 0, 0];
    objectsNodes.push(N('Material', [F.L(id), _exFbxName(m.name, 'Material'), F.S('')], [
      N('Version', [F.I(102)]),
      N('ShadingModel', [F.S('Phong')]),
      N('MultiLayer', [F.I(0)]),
      N('Properties70', [], [
        P.col('EmissiveColor', [0, 0, 0]),
        P.num('EmissiveFactor', 1),
        P.col('AmbientColor', [0, 0, 0]),
        P.num('AmbientFactor', 0),
        P.col('DiffuseColor', m.color),
        P.num('DiffuseFactor', 1),
        P.col('TransparentColor', transp),
        P.num('TransparencyFactor', 1 - m.alpha),
        P.num('Opacity', m.alpha),
        P.col('SpecularColor', [1, 1, 1]),
        P.num('SpecularFactor', 0.25),
        P.num('Shininess', shin),
        P.num('ShininessExponent', shin),
        P.col('ReflectionColor', [1, 1, 1]),
        P.num('ReflectionFactor', m.metalness),
      ]),
    ]));
    if (m.texture) conns.push(N('C', [F.S('OP'), F.L(texId.get(m.texture)), F.L(id), F.S('DiffuseColor')]));
    counts.Material++;
    return id;
  });

  // Models + geometry
  for (const ob of prep.objects) {
    const mid = newId();
    const hasGeo = ob.faces.length > 0;
    const euler = _exQuatToEulerXYZDeg(ob.trs.q);
    objectsNodes.push(N('Model', [F.L(mid), _exFbxName(ob.name, 'Model'), F.S(hasGeo ? 'Mesh' : 'Null')], [
      N('Version', [F.I(232)]),
      N('Properties70', [], [
        P.lcl('Lcl Translation', ob.trs.t),
        P.lcl('Lcl Rotation', euler),
        P.lcl('Lcl Scaling', ob.trs.s),
        P.int('DefaultAttributeIndex', 0),
        P.enm('InheritType', 1),
      ]),
      N('MultiLayer', [F.I(0)]),
      N('MultiTake', [F.I(0)]),
      N('Shading', [F.C(1)]),
      N('Culling', [F.S('CullingOff')]),
    ]));
    rootConns.push(N('C', [F.S('OO'), F.L(mid), F.L(0)]));
    counts.Model++;
    if (!hasGeo) continue;

    const gid = newId();
    const verts = [];
    for (const p of ob.pos) verts.push(p[0], p[1], p[2]);
    const pvi = [], normals = [], uvIdx = [], polyMat = [], smoothing = [];
    const uvs = [];
    for (const t of ob.uvs) uvs.push(t[0], t[1]);
    const nvert = ob.pos.length;
    const edgeSeen = new Set(), edges = [];
    for (const f of ob.faces) {
      for (const poly of _exFacePolys(f, o.triangulate)) {
        const base = pvi.length;
        poly.forEach((k, j) => {
          const vi = f.v[k];
          pvi.push(j === poly.length - 1 ? ~vi : vi);
          const n = f.n[k];
          normals.push(n[0], n[1], n[2]);
          uvIdx.push(f.uvid[k]);
          const vn = f.v[poly[(j + 1) % poly.length]];
          const ek = vi < vn ? vi * nvert + vn : vn * nvert + vi;
          if (!edgeSeen.has(ek)) { edgeSeen.add(ek); edges.push(base + j); }
        });
        polyMat.push(f.matLocal);
        smoothing.push(ob.smooth ? 1 : 0);
      }
    }
    const allSame = ob.matList.length <= 1;
    objectsNodes.push(N('Geometry', [F.L(gid), _exFbxName(ob.name, 'Geometry'), F.S('Mesh')], [
      N('Properties70', [], []),
      N('GeometryVersion', [F.I(124)]),
      N('Vertices', [F.d(verts)]),
      N('PolygonVertexIndex', [F.i(pvi)]),
      N('Edges', [F.i(edges)]),
      N('LayerElementNormal', [F.I(0)], [
        N('Version', [F.I(101)]),
        N('Name', [F.S('')]),
        N('MappingInformationType', [F.S('ByPolygonVertex')]),
        N('ReferenceInformationType', [F.S('Direct')]),
        N('Normals', [F.d(normals)]),
      ]),
      N('LayerElementSmoothing', [F.I(0)], [
        N('Version', [F.I(102)]),
        N('Name', [F.S('')]),
        N('MappingInformationType', [F.S('ByPolygon')]),
        N('ReferenceInformationType', [F.S('Direct')]),
        N('Smoothing', [F.i(smoothing)]),
      ]),
      N('LayerElementUV', [F.I(0)], [
        N('Version', [F.I(101)]),
        N('Name', [F.S('UVMap')]),
        N('MappingInformationType', [F.S('ByPolygonVertex')]),
        N('ReferenceInformationType', [F.S('IndexToDirect')]),
        N('UV', [F.d(uvs)]),
        N('UVIndex', [F.i(uvIdx)]),
      ]),
      N('LayerElementMaterial', [F.I(0)], [
        N('Version', [F.I(101)]),
        N('Name', [F.S('')]),
        N('MappingInformationType', [F.S(allSame ? 'AllSame' : 'ByPolygon')]),
        N('ReferenceInformationType', [F.S('IndexToDirect')]),
        N('Materials', [F.i(allSame ? [0] : polyMat)]),
      ]),
      N('Layer', [F.I(0)], [
        N('Version', [F.I(100)]),
        N('LayerElement', [], [N('Type', [F.S('LayerElementNormal')]), N('TypedIndex', [F.I(0)])]),
        N('LayerElement', [], [N('Type', [F.S('LayerElementSmoothing')]), N('TypedIndex', [F.I(0)])]),
        N('LayerElement', [], [N('Type', [F.S('LayerElementUV')]), N('TypedIndex', [F.I(0)])]),
        N('LayerElement', [], [N('Type', [F.S('LayerElementMaterial')]), N('TypedIndex', [F.I(0)])]),
      ]),
    ]));
    counts.Geometry++;
    conns.push(N('C', [F.S('OO'), F.L(gid), F.L(mid)]));
    for (const gi of ob.matList) conns.push(N('C', [F.S('OO'), F.L(matIds[gi]), F.L(mid)]));
  }

  const d = new Date();
  const two = (x) => String(x).padStart(2, '0');
  const header = N('FBXHeaderExtension', [], [
    N('FBXHeaderVersion', [F.I(1003)]),
    N('FBXVersion', [F.I(7400)]),
    N('EncryptionType', [F.I(0)]),
    N('CreationTimeStamp', [], [
      N('Version', [F.I(1000)]),
      N('Year', [F.I(d.getFullYear())]),
      N('Month', [F.I(d.getMonth() + 1)]),
      N('Day', [F.I(d.getDate())]),
      N('Hour', [F.I(d.getHours())]),
      N('Minute', [F.I(d.getMinutes())]),
      N('Second', [F.I(d.getSeconds())]),
      N('Millisecond', [F.I(d.getMilliseconds())]),
    ]),
    N('Creator', [F.S('PocketMesh FBX Exporter')]),
    N('SceneInfo', [_exFbxName('GlobalInfo', 'SceneInfo'), F.S('UserData')], [
      N('Type', [F.S('UserData')]),
      N('Version', [F.I(100)]),
      N('MetaData', [], [
        N('Version', [F.I(100)]),
        N('Title', [F.S('')]),
        N('Subject', [F.S('')]),
        N('Author', [F.S('')]),
        N('Keywords', [F.S('')]),
        N('Revision', [F.S('')]),
        N('Comment', [F.S('')]),
      ]),
      N('Properties70', [], [
        P.str('DocumentUrl', fileName, 'Url'),
        P.str('SrcDocumentUrl', fileName, 'Url'),
        P.compound('Original'),
        P.str('Original|ApplicationVendor', 'PocketMesh'),
        P.str('Original|ApplicationName', 'PocketMesh'),
        P.str('Original|ApplicationVersion', '1.0'),
        P.dateTime('Original|DateTime_GMT', two(d.getUTCDate()) + '/' + two(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' +
          two(d.getUTCHours()) + ':' + two(d.getUTCMinutes()) + ':' + two(d.getUTCSeconds()) + '.000'),
        P.str('Original|FileName', fileName),
        P.compound('LastSaved'),
        P.str('LastSaved|ApplicationVendor', 'PocketMesh'),
        P.str('LastSaved|ApplicationName', 'PocketMesh'),
        P.str('LastSaved|ApplicationVersion', '1.0'),
        P.dateTime('LastSaved|DateTime_GMT', '01/01/1970 00:00:00.000'),
      ]),
    ]),
  ]);

  const globalSettings = N('GlobalSettings', [], [
    N('Version', [F.I(1000)]),
    N('Properties70', [], [
      P.int('UpAxis', o.yUp ? 1 : 2),
      P.int('UpAxisSign', 1),
      P.int('FrontAxis', o.yUp ? 2 : 1),
      P.int('FrontAxisSign', o.yUp ? 1 : -1),
      P.int('CoordAxis', 0),
      P.int('CoordAxisSign', 1),
      P.int('OriginalUpAxis', o.yUp ? 1 : 2),
      P.int('OriginalUpAxisSign', 1),
      // 1 unit = 100 cm = 1 m (Blender's importer divides by 100 for a metric scene; Unity uses cm base).
      P.dbl('UnitScaleFactor', 100),
      P.dbl('OriginalUnitScaleFactor', 100),
      P.colRGB('AmbientColor', [0, 0, 0]),
      P.str('DefaultCamera', 'Producer Perspective'),
      P.enm('TimeMode', 11),
      P.enm('TimeProtocol', 2),
      P.enm('SnapOnFrameMode', 0),
      P.time('TimeSpanStart', 0),
      P.time('TimeSpanStop', 46186158000),
      P.dbl('CustomFrameRate', 24),
      P.compound('TimeMarker'),
      P.int('CurrentTimeMarker', -1),
    ]),
  ]);

  const docId = newId();
  const documents = N('Documents', [], [
    N('Count', [F.I(1)]),
    N('Document', [F.L(docId), F.S('Scene'), F.S('Scene')], [
      N('Properties70', [], [P.obj('SourceObject'), P.str('ActiveAnimStackName', '')]),
      N('RootNode', [F.L(0)]),
    ]),
  ]);

  const defs = [N('Version', [F.I(100)])];
  let total = 1;
  const typeNodes = [N('ObjectType', [F.S('GlobalSettings')], [N('Count', [F.I(1)])])];
  for (const k of ['Model', 'Geometry', 'Material', 'Texture', 'Video']) {
    if (!counts[k]) continue;
    total += counts[k];
    typeNodes.push(N('ObjectType', [F.S(k)], [N('Count', [F.I(counts[k])])]));
  }
  defs.push(N('Count', [F.I(total)]));
  const definitions = N('Definitions', [], defs.concat(typeNodes));

  const roots = [
    header,
    N('FileId', [F.R(new Uint8Array(_EX_FBX_FILE_ID))]),
    N('CreationTime', [F.S('1970-01-01 10:00:00:000')]),
    N('Creator', [F.S('PocketMesh FBX Exporter')]),
    globalSettings,
    documents,
    N('References', [], []),
    definitions,
    N('Objects', [], objectsNodes),
    N('Connections', [], rootConns.concat(conns)),
    N('Takes', [], [N('Current', [F.S('')])]),
  ];
  return [{ name: fileName, data: _exFbxSerialize(roots) }];
}

// ---------------------------------------------------------------------------
// ZIP (STORE)
// ---------------------------------------------------------------------------

let _exCrcTable = null;

function _exCrc32(bytes) {
  if (!_exCrcTable) {
    _exCrcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _exCrcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = _exCrcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function makeZip(files) {
  const list = Array.isArray(files) ? files : [];
  const d = new Date();
  const year = Math.max(1980, Math.min(2107, d.getFullYear()));
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const entries = [];
  let size = 0;
  for (const f of list) {
    if (!f) continue;
    const name = _exUtf8(String(f.name == null ? 'file' : f.name).replace(/\\/g, '/').replace(/^\/+/, ''));
    const data = _exBytes(f.data);
    entries.push({ name, data, crc: _exCrc32(data), offset: size });
    size += 30 + name.length + data.length;
  }
  const cdStart = size;
  for (const e of entries) size += 46 + e.name.length;
  const cdSize = size - cdStart;
  size += 22;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let p = 0;
  for (const e of entries) {
    dv.setUint32(p, 0x04034b50, true);
    dv.setUint16(p + 4, 10, true);
    dv.setUint16(p + 6, 0x0800, true);
    dv.setUint16(p + 8, 0, true);
    dv.setUint16(p + 10, dosTime, true);
    dv.setUint16(p + 12, dosDate, true);
    dv.setUint32(p + 14, e.crc, true);
    dv.setUint32(p + 18, e.data.length, true);
    dv.setUint32(p + 22, e.data.length, true);
    dv.setUint16(p + 26, e.name.length, true);
    dv.setUint16(p + 28, 0, true);
    out.set(e.name, p + 30);
    out.set(e.data, p + 30 + e.name.length);
    p += 30 + e.name.length + e.data.length;
  }
  for (const e of entries) {
    dv.setUint32(p, 0x02014b50, true);
    dv.setUint16(p + 4, 20, true);
    dv.setUint16(p + 6, 10, true);
    dv.setUint16(p + 8, 0x0800, true);
    dv.setUint16(p + 10, 0, true);
    dv.setUint16(p + 12, dosTime, true);
    dv.setUint16(p + 14, dosDate, true);
    dv.setUint32(p + 16, e.crc, true);
    dv.setUint32(p + 20, e.data.length, true);
    dv.setUint32(p + 24, e.data.length, true);
    dv.setUint16(p + 28, e.name.length, true);
    dv.setUint16(p + 30, 0, true);
    dv.setUint16(p + 32, 0, true);
    dv.setUint16(p + 34, 0, true);
    dv.setUint16(p + 36, 0, true);
    dv.setUint32(p + 38, 0, true);
    dv.setUint32(p + 42, e.offset, true);
    out.set(e.name, p + 46);
    p += 46 + e.name.length;
  }
  dv.setUint32(p, 0x06054b50, true);
  dv.setUint16(p + 4, 0, true);
  dv.setUint16(p + 6, 0, true);
  dv.setUint16(p + 8, entries.length, true);
  dv.setUint16(p + 10, entries.length, true);
  dv.setUint32(p + 12, cdSize, true);
  dv.setUint32(p + 16, cdStart, true);
  dv.setUint16(p + 20, 0, true);
  return out;
}
