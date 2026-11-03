// Cursor extrusion geometry. The UI supplies a view-plane target and projected
// edge direction; source and destination rotations are independent of the camera.
export function extrudeToPoint(
  mesh,
  selection,
  target,
  { rotate = false, rotateSource = true, direction = null, viewAxis = [0, 0, 1] } = {},
) {
  if (!Array.isArray(target) || target.length !== 3 || !target.every(Number.isFinite))
    throw new Error('Invalid extrusion target');
  const selected = new Set(selection.verts);
  for (const key of selection.edges) for (const v of ekeySplit(key)) selected.add(v);
  for (const fi of selection.faces) for (const v of mesh.faces[fi].v) selected.add(v);
  if (!selected.size) {
    mesh.verts.push(target.slice());
    touch(mesh);
    return { verts: new Set([mesh.verts.length - 1]), addedVertex: true };
  }
  const center = vscale(
    [...selected].reduce((sum, v) => vadd(sum, mesh.verts[v]), [0, 0, 0]),
    1 / selected.size,
  );
  const offset = vsub(target, center);
  if (vlen(offset) < 1e-8) return null;
  let angle = 0,
    axis = [0, 0, 1];
  if (rotate && direction && vlen(direction) > 1e-8) {
    const from = vnorm(direction),
      to = vnorm(offset);
    angle = Math.acos(Math.max(-1, Math.min(1, vdot(from, to))));
    axis = vnorm(vcross(from, to));
    if (vlen(axis) < 1e-8) {
      axis = vnorm(vsub(viewAxis, vscale(from, vdot(viewAxis, from))));
      if (vlen(axis) < 1e-8) axis = vnorm(vcross(from, Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    }
  }
  const turn = (p, a) => {
    if (Math.abs(a) < 1e-10) return p.slice();
    const q = vsub(p, center),
      c = Math.cos(a),
      s = Math.sin(a);
    return vadd(center, vadd(vadd(vscale(q, c), vscale(vcross(axis, q), s)), vscale(axis, vdot(axis, q) * (1 - c))));
  };
  const step = rotateSource ? angle / 2 : angle;
  if (rotateSource && angle) for (const v of selected) mesh.verts[v] = turn(mesh.verts[v], step);
  const result = extrudeRegion(mesh, { ...selection, verts: selected });
  for (const v of result.verts) mesh.verts[v] = vadd(turn(mesh.verts[v], step), offset);
  return result;
}
