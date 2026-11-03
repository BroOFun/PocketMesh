// Non-destructive subdivision. Geometry is shared across edges; UVs stay
// face-varying so seams and material boundaries survive evaluation.
export function normalizeModifiers(modifiers = []) {
  return (Array.isArray(modifiers) ? modifiers : []).filter((m) => m && m.type === 'subdivision').slice(0, 1).map((m) => ({
    type: 'subdivision', enabled: m.enabled !== false,
    levels: Math.max(0, Math.min(3, Math.round(Number(m.levels) || 0))),
    method: m.method === 'simple' ? 'simple' : 'catmull-clark',
  }));
}

export function subdivisionSurface(mesh, levels = 1, method = 'catmull-clark') {
  if (!Number.isInteger(levels) || levels < 0 || levels > 3) throw new Error('Subdivision supports levels 0–3');
  let m = mesh;
  for (let level = 0; level < levels; level++) {
    const count = m.faces.reduce((n, f) => n + f.v.length, 0);
    if (count > 100000) throw new Error('Subdivision would exceed 100,000 faces. Lower the level or simplify the mesh.');
    const t = topo(m), fp = m.faces.map((f) => faceCenter(m, f));
    const mid = t.edges.map(([a, b]) => vlerp(m.verts[a], m.verts[b], 0.5));
    const simple = method === 'simple';
    const verts = m.verts.map((p, vi) => {
      if (simple || !t.vertFaces[vi].length) return p.slice();
      const es = t.vertEdges[vi], fs = t.vertFaces[vi];
      // Keep non-manifold junctions fixed; open boundaries use the cubic rule.
      if (es.some((ei) => t.edgeFaces[ei].length > 2 || !t.edgeFaces[ei].length)) return p.slice();
      const boundary = es.filter((ei) => t.edgeFaces[ei].length === 1);
      if (boundary.length === 2) {
        const ns = boundary.map((ei) => m.verts[t.edges[ei].find((v) => v !== vi)]);
        return vadd(vscale(p, 0.75), vscale(vadd(ns[0], ns[1]), 0.125));
      }
      if (boundary.length || fs.length !== es.length) return p.slice();
      const n = fs.length;
      const f = vscale(fs.reduce((a, fi) => vadd(a, fp[fi]), [0, 0, 0]), 1 / n);
      const r = vscale(es.reduce((a, ei) => vadd(a, mid[ei]), [0, 0, 0]), 1 / n);
      return vscale(vadd(vadd(f, vscale(r, 2)), vscale(p, n - 3)), 1 / n);
    });
    const edgeBase = verts.length;
    t.edges.forEach((_, ei) => {
      const fs = t.edgeFaces[ei];
      verts.push(!simple && fs.length === 2 ? vscale(vadd(vscale(mid[ei], 2), vadd(fp[fs[0]], fp[fs[1]])), 0.25) : mid[ei]);
    });
    const faceBase = verts.length;
    verts.push(...fp);
    const faces = [];
    m.faces.forEach((f, fi) => {
      const n = f.v.length, uv = f.v.map((_, i) => f.uv[i] || [0, 0]);
      const center = uv.reduce((a, u) => [a[0] + u[0] / n, a[1] + u[1] / n], [0, 0]);
      for (let i = 0; i < n; i++) {
        const prev = (i + n - 1) % n, next = (i + 1) % n;
        faces.push({ v: [f.v[i], edgeBase + t.edgeIndex.get(ekey(f.v[i], f.v[next])), faceBase + fi, edgeBase + t.edgeIndex.get(ekey(f.v[prev], f.v[i]))],
          uv: [uv[i].slice(), uvlerp(uv[i], uv[next], 0.5), center.slice(), uvlerp(uv[prev], uv[i], 0.5)], mat: f.mat });
      }
    });
    const seams = new Set(), looseEdges = [];
    t.edges.forEach(([a, b], ei) => {
      const v = edgeBase + ei;
      if (m.seams.has(ekey(a, b))) { seams.add(ekey(a, v)); seams.add(ekey(v, b)); }
      if (!t.edgeFaces[ei].length) looseEdges.push([a, v], [v, b]);
    });
    m = { verts, faces, looseEdges, seams, smooth: simple ? m.smooth : true };
  }
  return m;
}

export function evaluateModifiers(mesh, modifiers) {
  let result = mesh;
  for (const m of normalizeModifiers(modifiers)) if (m.enabled) result = subdivisionSurface(result, m.levels, m.method);
  return result;
}
