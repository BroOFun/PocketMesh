// Basic Wavefront material import; image files are selected alongside the MTL.
export function importMTL(text) {
  const materials = [], warnings = [];
  let m = null;
  for (const line of text.split(/\r?\n/)) {
    const parts = line.replace(/\s*#.*$/, '').trim().split(/\s+/), key = parts.shift();
    if (key === 'newmtl') {
      m = { name: parts.join(' '), color: [0.8, 0.8, 0.8], alpha: 1, roughness: 0.5, image: null };
      if (!m.name) throw new Error('MTL material is missing its name');
      materials.push(m);
    } else if (m && key === 'Kd') {
      if (parts.length < 3 || parts.slice(0, 3).some((v) => !Number.isFinite(+v))) throw new Error('Invalid MTL diffuse color');
      m.color = parts.slice(0, 3).map((v) => Math.max(0, Math.min(1, +v)));
    } else if (m && (key === 'd' || key === 'Tr')) {
      const v = Number(parts[0]);
      if (!Number.isFinite(v)) throw new Error('Invalid MTL opacity');
      m.alpha = Math.max(0, Math.min(1, key === 'Tr' ? 1 - v : v));
    } else if (m && key === 'Ns') {
      const v = Number(parts[0]);
      if (Number.isFinite(v)) m.roughness = Math.sqrt(2 / (Math.max(0, v) + 2));
    } else if (m && key === 'map_Kd') {
      if (parts[0]?.startsWith('-')) warnings.push(m.name + ': texture map options are not supported; assign the image in Material.');
      else m.image = parts.join(' ').replace(/^"|"$/g, '');
    } else if (m && /^(map_|bump|disp)/i.test(key)) warnings.push(m.name + ': ' + key + ' is not supported.');
  }
  return { materials, warnings };
}
