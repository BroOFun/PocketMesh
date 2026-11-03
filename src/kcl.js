// Mario Kart Wii collision attributes and binary prisms. Format references:
// https://mkwiiki.org/wiki/KCL_(File_Format)
// https://mkwiiki.org/wiki/KCL_flag
// https://github.com/doldecomp/mkw/blob/main/src/field/KCollision.hpp
// Names are format identifiers; unknown/slot-dependent variants are deliberately marked.
const _KC_NAMES = [
  'Road',
  'Slippery Road 1',
  'Weak Off-road',
  'Off-road',
  'Heavy Off-road',
  'Slippery Road 2',
  'Boost Panel',
  'Boost Ramp',
  'Jump Pad',
  'Item Road',
  'Solid Fall',
  'Moving Water',
  'Wall',
  'Invisible Wall',
  'Item Wall',
  'Wall 2',
  'Fall Boundary',
  'Cannon Trigger',
  'Force Recalculation',
  'Half-Pipe Ramp',
  'Player-Only Wall',
  'Moving Road',
  'Sticky Road',
  'Road 2',
  'Sound Trigger',
  'Weak Wall',
  'Effect Trigger',
  'Item State Modifier',
  'Half-Pipe Invisible Wall',
  'Rotating Road',
  'Special Wall',
  'Invisible Wall 2',
];
const _KC_VARIANTS = [
  [
    'Normal',
    'Dirt (slot effects)',
    'Dirt (no particles)',
    'Smooth',
    'Wood',
    'Snow',
    'Metal grate',
    'Interrupted road sound',
  ],
  [
    'White sand',
    'Dirt',
    'Water (unused)',
    'Snow (unused)',
    'Grass (unused)',
    'Yellow sand',
    'Sand (unused)',
    'Dirt (unused)',
  ],
  ['Orange sand', 'Dirt', 'Water', 'Dark grass', 'Light sand', 'Carpet', 'Gravel', 'Gravel impact'],
  ['Sand', 'Dirt', 'Mud', 'Water (unused)', 'Grass', 'Light sand', 'Gravel', 'Carpet'],
  ['Sand (unused)', 'Dirt (unused)', 'Mud', 'Flowers', 'Grass', 'Snow', 'Sand', 'Dirt (unused)'],
  [
    'Ice',
    'Mud (unused)',
    'Water (unused)',
    'Water (unused)',
    'Water (unused)',
    'Water (unused)',
    'Road sound (unused)',
    'Road sound (unused)',
  ],
  ['Standard boost', 'Rotating with casino_roulette'],
  [
    'Double flip',
    'Single flip',
    'Stunt (unused)',
    'Stunt (unused)',
    'Stunt (unused)',
    'Stunt (unused)',
    'Stunt (unused)',
  ],
  [
    'Speed 50 / lift 35',
    'Speed 50 / lift 47',
    'Speed 59 / lift 30',
    'Speed 73 / lift 45 (boost: 100 / 70)',
    'Speed 73 / lift 53 (boost: 100 / 65)',
    'Speed 56 / lift 50',
    'Speed 55 / lift 35',
    'Speed 56 / lift 50 (unused)',
  ],
  ['Unknown', 'Unknown', 'Metal grate usage', 'Wood / grass usage', 'Unknown (unused)', 'Bush usage'],
  ['Sand', 'Underwater sand', 'Tiles', 'Ice', 'Dirt', 'Grass', 'Wood', 'Dark sand'],
  [
    'Downward current',
    'Strong downward current',
    'Forward current',
    'Current without acceleration',
    'Asphalt (unused)',
    'Asphalt (unused)',
    'Road (unused)',
    'Road (unused)',
  ],
  ['Normal', 'Rock', 'Metal', 'Wood', 'Ice', 'Bush', 'Rope', 'Rubber'],
  ['Silent', 'Sparks / voice (unused)', 'Sparks / voice (unused)'],
  ['Unknown', 'Rock usage', 'Metal usage', 'Unknown', 'Unknown (unused)', 'Bush usage'],
  ['Normal', 'Rock', 'Metal', 'Wood', 'Ice', 'Bush (unused)', 'Rope', 'Rubber'],
  ['Air', 'Water', 'Lava', 'Icy water', 'Lava without particles', 'Burning air', 'Quicksand', 'Short fall'],
  Array.from({ length: 8 }, (_, i) => 'CNPT index ' + i),
  ['Standard'],
  ['Standard', 'With boost'],
  [
    'Normal (unused)',
    'Rock (unused)',
    'Metal (unused)',
    'Wood',
    'Ice (unused)',
    'Bush (unused)',
    'Rope (unused)',
    'Silent',
  ],
  [
    'BeltCrossing west / escalator',
    'BeltCrossing east / escalator west',
    'BeltEasy east',
    'BeltEasy west',
    'BeltCurveA clockwise',
    'BeltCurveA counterclockwise',
  ],
  ['Wood', 'Gravel', 'Carpet', 'Dirt', 'Wood sound', 'Road (slot sound)', 'Road', 'Mud'],
  [
    'Low road sound',
    'Carpet',
    'Grass (slot particles)',
    'Mushroom road',
    'Grass',
    'Glass',
    'Dirt',
    'Road (slot sound)',
  ],
  Array.from({ length: 8 }, () => 'Track-slot dependent'),
  ['Standard'],
  [
    'BLIGHT change',
    'BLIGHT change (alternate)',
    'Water splash',
    'starGate activation',
    'Cancel half-pipe',
    'Despawn coins',
    'Unknown (chimneys)',
    'Unknown (unused)',
  ],
  ['Standard'],
  ['Standard'],
  ['Rope', 'Road impact', 'Road', 'Glass', 'Carpet', 'starGate sound (unused)', 'Sand (unused)', 'Dirt (unused)'],
  [
    'Cactus spin-out',
    'Silent lavafall wall',
    'Bouncy (unused)',
    'Silent banner wall',
    'Rainbow Road railing',
    'Mushroom sides',
    'Metal',
    'starGate sides',
  ],
  ['Silent'],
];
export const KCL_TYPES = _KC_NAMES.map((name, id) => ({
  id,
  name,
  variants: Array.from({ length: 8 }, (_, i) => _KC_VARIANTS[id][i] || 'Unknown (unused)'),
  color: [0x06, 0x07, 0x08, 0x13].includes(id)
    ? '#ffbb40'
    : [2, 3, 4].includes(id)
      ? '#8ebd55'
      : [0x0a, 0x10].includes(id)
        ? '#ff5979'
        : [0xc, 0xd, 0xe, 0xf, 0x14, 0x19, 0x1c, 0x1e, 0x1f].includes(id)
          ? '#ae88ed'
          : '#69cbd6',
  note:
    {
      6: 'Variant 1 needs casino_roulette for rotation.',
      7: 'Already trickable: leave the trick bit off.',
      8: 'Already trickable. Variant 3 has the known off-road glitch.',
      11: 'Needs KMP moving-water AREA and route data.',
      16: 'Water/lava effects may need a pocha object; falling needs respawn data.',
      17: 'Requires the corresponding CNPT destination in KMP.',
      18: 'Needs KMP AREA type 4 and valid enemy paths.',
      19: 'Already trickable.',
      21: 'Requires conveyor/escalator objects.',
      24: 'Behavior depends on the replaced track slot.',
      26: 'Some variants need KMP objects or lighting data.',
      29: 'Rotation needs casino_roulette; otherwise ordinary road.',
      30: 'Some sounds need track-specific objects or slots.',
    }[id] || '',
}));
export function decodeKCLFlag(flag) {
  return {
    type: flag & 31,
    variant: (flag >>> 5) & 7,
    blight: (flag >>> 8) & 7,
    depth: (flag >>> 11) & 3,
    trick: !!(flag & 0x2000),
    reject: !!(flag & 0x4000),
    soft: !!(flag & 0x8000),
  };
}
export function encodeKCLFlag(f) {
  for (const [key, max] of [
    ['type', 31],
    ['variant', 7],
    ['blight', 7],
    ['depth', 3],
  ])
    if (!Number.isInteger(f[key] ?? 0) || (f[key] ?? 0) < 0 || (f[key] ?? 0) > max)
      throw new Error('Invalid KCL ' + key);
  return (
    (f.type || 0) |
    ((f.variant || 0) << 5) |
    ((f.blight || 0) << 8) |
    ((f.depth || 0) << 11) |
    (f.trick ? 0x2000 : 0) |
    (f.reject ? 0x4000 : 0) |
    (f.soft ? 0x8000 : 0)
  );
}
export function kclHex(n) {
  return '0x' + (n & 65535).toString(16).toUpperCase().padStart(4, '0');
}
export function kclCatalogCSV() {
  const rows = [['type', 'name', 'variant', 'flag', 'variant_name', 'notes']];
  for (const t of KCL_TYPES)
    for (let v = 0; v < 8; v++) rows.push([kclHex(t.id), t.name, v, kclHex(t.id | (v << 5)), t.variants[v], t.note]);
  return rows.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\r\n');
}
const _kcSub = (a, b) => a.map((v, i) => v - b[i]);
const _kcCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const _kcDot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const _kcUnit = (a) => {
  const n = Math.hypot(...a);
  return n > 1e-12 ? a.map((v) => v / n) : null;
};
export function exportKCL(input, { thickness = 300, radius = 250 } = {}) {
  if (!Array.isArray(input) || !input.length)
    throw new Error('No collision triangles. Enable collision on a visible material.');
  if (input.length > 65535)
    throw new Error('KCL supports at most 65,535 triangles. Reduce subdivision or exclude scenery.');
  if (!Number.isFinite(thickness) || thickness <= 0 || !Number.isFinite(radius) || radius <= 0)
    throw new Error('Invalid KCL collision margin');
  const positions = [],
    normals = [],
    pm = new Map(),
    nm = new Map(),
    prisms = [],
    bounds = [];
  function index(a, list, map) {
    a = a.map(Math.fround);
    const key = a.join(',');
    if (!map.has(key)) {
      if (list.length >= 65536) throw new Error('KCL vector limit exceeded. Simplify the collision mesh.');
      map.set(key, list.length);
      list.push(a);
    }
    return map.get(key);
  }
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  let skipped = 0;
  for (const t of input) {
    if (!t.points || t.points.length !== 3 || !t.points.every((p) => p.length === 3 && p.every(Number.isFinite)))
      throw new Error('Collision geometry contains invalid coordinates');
    if (!Number.isInteger(t.flag) || t.flag < 0 || t.flag > 65535) throw new Error('Invalid 16-bit KCL flag');
    const [a, b, c] = t.points.map((p) => p.map(Math.fround)),
      ab = _kcSub(b, a),
      ac = _kcSub(c, a),
      n = _kcUnit(_kcCross(ab, ac));
    if (!n) {
      skipped++;
      continue;
    }
    const na = _kcUnit(_kcCross(n, ac)),
      nb = _kcUnit(_kcCross(ab, n)),
      nc = _kcUnit(_kcCross(n, _kcSub(b, c)));
    const len = _kcDot(ab, nc);
    if (!Number.isFinite(len) || len < 0.001) {
      skipped++;
      continue;
    }
    prisms.push([len, index(a, positions, pm), ...[n, na, nb, nc].map((v) => index(v, normals, nm)), t.flag]);
    // Conservative prism AABB includes the full backwards extrusion and sphere radius.
    // False positives are safe: the game's prism test does the exact narrow phase.
    const lo = [0, 1, 2].map((i) => Math.min(a[i], b[i], c[i]) - Math.max(0, n[i] * thickness) - radius - 1);
    const hi = [0, 1, 2].map((i) => Math.max(a[i], b[i], c[i]) - Math.min(0, n[i] * thickness) + radius + 1);
    bounds.push([lo, hi]);
    lo.forEach((v, i) => {
      min[i] = Math.min(min[i], v);
      max[i] = Math.max(max[i], hi[i]);
    });
  }
  if (!prisms.length) throw new Error('All collision triangles are degenerate');
  for (let i = 0; i < 3; i++) min[i] = Math.floor(min[i]);
  const shift = Math.max(1, Math.ceil(Math.log2(Math.max(...max.map((v, i) => v - min[i] + 1)))));
  if (shift > 26) throw new Error('Collision bounds are too large. Check export scale and object positions.');
  const size = 2 ** shift,
    words = [0],
    leafPatches = [],
    leaves = new Map();
  let nodes = 1;
  function node(slot, base, ids, lo, width, depth) {
    if (ids.length <= 32 || width <= 512 || depth >= 10 || nodes > 100000) {
      leafPatches.push({ slot, base, key: ids.join(','), ids });
      return;
    }
    const half = width / 2,
      childLists = [],
      childLows = [];
    for (let k = 0; k < 8; k++) {
      const cl = lo.map((v, i) => v + ((k >> i) & 1) * half);
      childLows.push(cl);
      childLists.push(
        ids.filter((id) => bounds[id - 1][0].every((v, i) => v <= cl[i] + half && bounds[id - 1][1][i] >= cl[i])),
      );
    }
    if (childLists.every((ids2) => ids2.length === ids.length)) {
      leafPatches.push({ slot, base, key: ids.join(','), ids });
      return;
    }
    const child = words.length;
    words[slot] = child * 4 - base;
    words.push(0, 0, 0, 0, 0, 0, 0, 0);
    nodes += 8;
    for (let k = 0; k < 8; k++) node(child + k, child * 4, childLists[k], childLows[k], half, depth + 1);
  }
  node(
    0,
    0,
    prisms.map((_, i) => i + 1),
    min,
    size,
    0,
  );
  let treeSize = words.length * 4;
  for (const p of leafPatches)
    if (!leaves.has(p.key)) {
      leaves.set(p.key, { offset: treeSize, ids: p.ids });
      treeSize += 4 + p.ids.length * 2;
    }
  if (treeSize > 64 * 1024 * 1024) throw new Error('Collision octree is too large. Simplify the collision mesh.');
  for (const p of leafPatches) words[p.slot] = ((leaves.get(p.key).offset - p.base) | 0x80000000) >>> 0;
  const posOff = 60,
    normOff = posOff + positions.length * 12,
    prismOff = normOff + normals.length * 12,
    treeOff = prismOff + prisms.length * 16;
  const bytes = new Uint8Array(treeOff + treeSize),
    v = new DataView(bytes.buffer);
  [posOff, normOff, prismOff - 16, treeOff].forEach((n, i) => v.setUint32(i * 4, n));
  v.setFloat32(16, thickness);
  min.forEach((n, i) => v.setFloat32(20 + i * 4, n));
  for (let i = 0; i < 3; i++) v.setUint32(32 + i * 4, ~(size - 1) >>> 0);
  v.setUint32(44, shift);
  v.setUint32(48, 0);
  v.setUint32(52, 0);
  v.setFloat32(56, radius);
  positions.forEach((p, i) => p.forEach((n, j) => v.setFloat32(posOff + i * 12 + j * 4, n)));
  normals.forEach((p, i) => p.forEach((n, j) => v.setFloat32(normOff + i * 12 + j * 4, n)));
  prisms.forEach((p, i) => {
    const o = prismOff + i * 16;
    v.setFloat32(o, p[0]);
    for (let j = 1; j < 7; j++) v.setUint16(o + 2 + j * 2, p[j]);
  });
  words.forEach((n, i) => v.setUint32(treeOff + i * 4, n));
  for (const { offset, ids } of leaves.values()) ids.forEach((n, i) => v.setUint16(treeOff + offset + 2 + i * 2, n)); // leading/trailing zero sentinels
  return { bytes, triangleCount: prisms.length, skipped, nodeCount: nodes };
}
