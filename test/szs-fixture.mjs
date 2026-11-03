// Small original U8 fixture builder; never contains game assets.
export function makeU8(tree, pointDirectory = true) {
  const nodes = [{ name: '', directory: true, parent: 0 }],
    names = [0];
  function visit(children, parent) {
    for (const [name, value] of Object.entries(children)) {
      const id = nodes.length,
        directory = !(value instanceof Uint8Array);
      const node = { name, directory, parent, nameOffset: names.length };
      names.push(...new TextEncoder().encode(name), 0);
      nodes.push(node);
      if (directory) {
        visit(value, id);
        node.end = nodes.length;
      } else node.bytes = value;
    }
  }
  visit(pointDirectory ? { '.': tree } : tree, 0);
  nodes[0].end = nodes.length;
  nodes[0].nameOffset = 0;
  const align = (n) => Math.ceil(n / 32) * 32,
    headerSize = nodes.length * 12 + names.length;
  let size = align(32 + headerSize);
  for (const node of nodes)
    if (!node.directory) {
      node.offset = size;
      size = align(size + node.bytes.length);
    }
  const b = new Uint8Array(size),
    v = new DataView(b.buffer);
  v.setUint32(0, 0x55aa382d);
  v.setUint32(4, 32);
  v.setUint32(8, headerSize);
  v.setUint32(12, align(32 + headerSize));
  b.set(names, 32 + nodes.length * 12);
  nodes.forEach((n, i) => {
    const at = 32 + i * 12;
    v.setUint32(at, (n.directory ? 0x1000000 : 0) | n.nameOffset);
    v.setUint32(at + 4, n.directory ? n.parent : n.offset);
    v.setUint32(at + 8, n.directory ? n.end : n.bytes.length);
    if (!n.directory) b.set(n.bytes, n.offset);
  });
  return b;
}
