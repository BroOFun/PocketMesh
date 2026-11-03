// Screen-space knife segments, with perspective-correct edge splits. Endpoints
// are on mesh boundaries; visibility is supplied by the viewport. Pure/atomic:
// the input mesh is never changed, including when a cut cannot be made.
const _knCross = (a, b) => a[0] * b[1] - a[1] * b[0];
function _knInside(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : -1;
    if (t >= 0 && t <= 1 && Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < 1e-6) return false;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function knifeCutProjected(mesh, projected, from, to, visible = () => true) {
  const d = [to.x - from.x, to.y - from.y], length = Math.hypot(...d), eps = 1e-8;
  if (!Number.isFinite(length) || length < 1e-5) return null;
  const plans = [];
  mesh.faces.forEach((f, fi) => {
    const poly = f.v.map(v => projected[v]);
    if (poly.some(p => !p || !p.valid || !(p.w > 0))) return;
    const hits = [];
    const add = (a, b, s, t) => {
      if (t < -eps || t > 1 + eps || s < -eps || s > 1 + eps) return;
      t = Math.max(0, Math.min(1, t)); s = Math.max(0, Math.min(1, s));
      if (s < eps) hits.push({t, v: a});
      else if (s > 1 - eps) hits.push({t, v: b});
      else {
        // Canonical orientation gives both sides of a shared edge the same split.
        if (a > b) { [a, b] = [b, a]; s = 1 - s; }
        const wa = projected[a].w, wb = projected[b].w;
        const u = s * wa / ((1 - s) * wb + s * wa);
        hits.push({t, a, b, u, key: ekey(a, b)});
      }
    };
    for (let i = 0; i < f.v.length; i++) {
      const a = f.v[i], b = f.v[(i + 1) % f.v.length], p = projected[a], q = projected[b];
      const e = [q.x - p.x, q.y - p.y], v = [p.x - from.x, p.y - from.y], den = _knCross(d, e);
      if (Math.abs(den) <= 1e-12 * length * Math.max(1, Math.hypot(...e))) {
        if (Math.abs(_knCross(v, d)) / length < 1e-6) {
          add(a, b, 0, (v[0] * d[0] + v[1] * d[1]) / (length * length));
          add(a, b, 1, ((q.x - from.x) * d[0] + (q.y - from.y) * d[1]) / (length * length));
        }
      } else add(a, b, _knCross(v, d) / den, _knCross(v, e) / den);
    }
    hits.sort((a, b) => a.t - b.t || (a.v === undefined) - (b.v === undefined));
    const unique = hits.filter((p, i) => !i || Math.abs(p.t - hits[i - 1].t) * length > 1e-6);
    for (let i = 0; i + 1 < unique.length; i++) {
      const a = unique[i], b = unique[i + 1], t = (a.t + b.t) / 2;
      if (!_knInside({x: from.x + t * d[0], y: from.y + t * d[1]}, poly)) continue;
      const point = hit => hit.v !== undefined ? mesh.verts[hit.v] : vlerp(mesh.verts[hit.a], mesh.verts[hit.b], hit.u);
      if (!visible(fi, point(a), point(b))) continue;
      plans.push({fi, a, b});
    }
  });
  if (!plans.length) return null;
  const result = cloneMesh(mesh), splits = new Map(), edges = new Set();
  const vertex = hit => {
    if (hit.v !== undefined) return hit.v;
    let list = splits.get(hit.key);
    if (!list) splits.set(hit.key, list = []);
    let split = list.find(p => Math.abs(p.u - hit.u) < 1e-10);
    if (!split) {
      split = {u: hit.u, v: result.verts.length}; list.push(split);
      result.verts.push(vlerp(mesh.verts[hit.a], mesh.verts[hit.b], hit.u));
    }
    return split.v;
  };
  for (const plan of plans) { plan.va = vertex(plan.a); plan.vb = vertex(plan.b); }
  for (const list of splits.values()) list.sort((a, b) => a.u - b.u);
  // Insert a shared edge vertex into every adjacent face, interpolating each
  // face's UVs separately so existing UV seams remain intact.
  const expanded = mesh.faces.map(f => {
    const v = [], uv = [];
    for (let i = 0; i < f.v.length; i++) {
      const j = (i + 1) % f.v.length, a = f.v[i], b = f.v[j];
      v.push(a); uv.push(f.uv[i].slice());
      const list = splits.get(ekey(a, b)) || [];
      for (const p of (a < b ? list : [...list].reverse())) {
        v.push(p.v); uv.push(uvlerp(f.uv[i], f.uv[j], a < b ? p.u : 1 - p.u));
      }
    }
    return [{...f, v, uv}];
  });
  for (const {fi, va, vb} of plans) {
    const parts = expanded[fi], idx = parts.findIndex(f => f.v.includes(va) && f.v.includes(vb));
    if (idx < 0) return null;
    const f = parts[idx];
    let a = f.v.indexOf(va), b = f.v.indexOf(vb);
    if (a > b) [a, b] = [b, a];
    if (b - a < 2 || b - a > f.v.length - 2) continue;
    const one = {...f, v: f.v.slice(a, b + 1), uv: f.uv.slice(a, b + 1)};
    const two = {...f, v: f.v.slice(b).concat(f.v.slice(0, a + 1)), uv: f.uv.slice(b).concat(f.uv.slice(0, a + 1))};
    const minArea = faceArea(mesh, mesh.faces[fi]) * 1e-10;
    if (!(faceArea(result, one) > minArea && faceArea(result, two) > minArea)) return null;
    parts.splice(idx, 1, one, two); edges.add(ekey(va, vb));
  }
  if (!edges.size) return null;
  result.faces = expanded.flat();
  const replacements = new Map();
  for (const [key, list] of splits) {
    const [a, b] = ekeySplit(key), chain = [a, ...list.map(p => p.v), b];
    replacements.set(key, chain.slice(1).map((v, i) => ekey(chain[i], v)));
    for (const tags of [result.seams, result.creases]) if (tags.delete(key)) {
      for (let i = 0; i < chain.length - 1; i++) tags.add(ekey(chain[i], chain[i + 1]));
    }
  }
  cleanEdges(result);
  return {mesh: result, edges, replacements};
}
