#!/usr/bin/env python3
"""Strict binary FBX 7.4 reader mirroring Blender's io_scene_fbx/parse_fbx.py logic
(end-offset checks, 13-byte nested sentinel check, "scope length not reached" check),
plus footer and PocketMesh structure checks. Prints a JSON summary; exit 1 on failure.

usage: fbx_check.py file.fbx [file2.fbx ...]
"""
import array
import json
import struct
import sys
import zlib
from struct import unpack

HEAD_MAGIC = b'Kaydara FBX Binary\x20\x20\x00\x1a\x00'
SENT_LEN = 13
SENT = b'\0' * SENT_LEN
FOOT_ID = bytes.fromhex('fabcab09d0c8d466b176fb831cf7267e')
FOOT_MAGIC = bytes.fromhex('f85a8c6adef5d97eece90ce3758f290b')


def read_uint(read):
    return unpack(b'<I', read(4))[0]


def unpack_array(read, typecode, stride):
    length, encoding, comp_len = unpack(b'<III', read(12))
    data = read(comp_len)
    if encoding == 1:
        data = zlib.decompress(data)
    elif encoding != 0:
        raise IOError('bad array encoding %d' % encoding)
    assert length * stride == len(data), 'array length mismatch'
    return array.array(typecode, data)


READ = {
    ord('Y'): lambda r: unpack(b'<h', r(2))[0],
    ord('C'): lambda r: unpack(b'<c', r(1))[0],
    ord('B'): lambda r: unpack(b'?', r(1))[0],
    ord('I'): lambda r: unpack(b'<i', r(4))[0],
    ord('F'): lambda r: unpack(b'<f', r(4))[0],
    ord('D'): lambda r: unpack(b'<d', r(8))[0],
    ord('L'): lambda r: unpack(b'<q', r(8))[0],
    ord('R'): lambda r: r(read_uint(r)),
    ord('S'): lambda r: r(read_uint(r)),
    ord('b'): lambda r: unpack_array(r, 'b', 1),
    ord('i'): lambda r: unpack_array(r, 'i', 4),
    ord('l'): lambda r: unpack_array(r, 'q', 8),
    ord('f'): lambda r: unpack_array(r, 'f', 4),
    ord('d'): lambda r: unpack_array(r, 'd', 8),
}


class Elem:
    __slots__ = ('id', 'props', 'types', 'elems')

    def __init__(self, id, props, types, elems):
        self.id, self.props, self.types, self.elems = id, props, types, elems

    def find(self, name):
        for e in self.elems:
            if e.id == name:
                return e
        return None

    def all(self, name):
        return [e for e in self.elems if e.id == name]


def read_elem(read, tell):
    end_offset, prop_count, _prop_len, name_len = unpack(b'<IIIB', read(13))
    elem_id = read(name_len) if name_len else b''
    if end_offset == 0:
        return None
    props, types = [], bytearray()
    for _ in range(prop_count):
        t = read(1)[0]
        if t not in READ:
            raise IOError('unknown property type %r in %r' % (chr(t), elem_id))
        props.append(READ[t](read))
        types.append(t)
    pos = tell()
    subtree = []
    if pos < end_offset:
        sub_tree_end = end_offset - SENT_LEN
        while tell() < sub_tree_end:
            subtree.append(read_elem(read, tell))
        if read(SENT_LEN) != SENT:
            raise IOError('failed to read nested block sentinel, expected all bytes to be 0 (%r)' % elem_id)
    if tell() != end_offset:
        raise IOError('scope length not reached, something is wrong (%r)' % elem_id)
    if any(e is None for e in subtree):
        raise IOError('unexpected null record inside %r' % elem_id)
    return Elem(elem_id, props, bytes(types), subtree)


def parse(path):
    with open(path, 'rb') as f:
        data = f.read()
    import io
    f = io.BytesIO(data)
    read, tell = f.read, f.tell
    if read(len(HEAD_MAGIC)) != HEAD_MAGIC:
        raise IOError('Invalid header')
    version = read_uint(read)
    if version != 7400:
        raise IOError('version %d' % version)
    roots = []
    while True:
        start = tell()
        e = read_elem(read, tell)
        if e is None:
            if data[start:start + SENT_LEN] != SENT:
                raise IOError('top-level null record not all zero')
            break
        roots.append(e)
    # footer
    p = tell()
    if data[p:p + 16] != FOOT_ID:
        raise IOError('footer id mismatch')
    p += 16
    if data[p:p + 4] != b'\0' * 4:
        raise IOError('footer zero block')
    p += 4
    pad = ((p + 15) & ~15) - p
    if pad == 0:
        pad = 16
    if data[p:p + pad] != b'\0' * pad:
        raise IOError('footer padding')
    p += pad
    if unpack(b'<I', data[p:p + 4])[0] != version:
        raise IOError('footer version')
    p += 4
    if data[p:p + 120] != b'\0' * 120:
        raise IOError('footer 120 zero bytes')
    p += 120
    if data[p:p + 16] != FOOT_MAGIC:
        raise IOError('footer magic')
    p += 16
    if p != len(data):
        raise IOError('trailing bytes after footer: %d' % (len(data) - p))
    return Elem(b'', [], b'', roots), version


def props70(elem):
    out = {}
    p70 = elem.find(b'Properties70')
    if p70 is None:
        return out
    for p in p70.all(b'P'):
        assert p.id == b'P' and len(p.props) >= 4 and p.types[:4] == b'SSSS', 'bad P record'
        out[p.props[0].decode()] = list(p.props[4:])
    return out


def check(path):
    root, version = parse(path)
    errs = []

    def need(cond, msg):
        if not cond:
            errs.append(msg)

    hdr = root.find(b'FBXHeaderExtension')
    need(hdr is not None, 'no FBXHeaderExtension')
    if hdr:
        need(hdr.find(b'FBXHeaderVersion').props[0] == 1003, 'FBXHeaderVersion')
        need(hdr.find(b'FBXVersion').props[0] == 7400, 'FBXVersion')
        need(hdr.find(b'CreationTimeStamp') is not None, 'CreationTimeStamp')
        need(hdr.find(b'Creator') is not None, 'Creator')
    gs = root.find(b'GlobalSettings')
    need(gs is not None and gs.find(b'Properties70') is not None, 'GlobalSettings/Properties70')
    settings = props70(gs) if gs else {}
    for name in (b'Documents', b'References', b'Definitions', b'Objects', b'Connections', b'Takes'):
        need(root.find(name) is not None, 'missing ' + name.decode())
    objs = root.find(b'Objects')
    ids = {0: ('Root', '', b'')}
    for o in objs.elems:
        need(o.types[:3] == b'LSS', 'object %r props %r' % (o.id, o.types))
        need(b'\x00\x01' in o.props[1], 'object name class separator %r' % o.props[1])
        need(o.props[0] not in ids, 'duplicate id %d' % o.props[0])
        ids[o.props[0]] = (o.id.decode(), o.props[1].split(b'\x00\x01')[0].decode('utf8'), o.props[2])
    conns = root.find(b'Connections').all(b'C')
    children = {}
    for c in conns:
        kind = c.props[0]
        need(kind in (b'OO', b'OP'), 'conn kind')
        need(c.props[1] in ids and c.props[2] in ids, 'dangling connection %r' % (c.props,))
        if kind == b'OP':
            need(len(c.props) == 4 and c.props[3] == b'DiffuseColor', 'OP connection prop')
        children.setdefault(c.props[2], []).append(c.props[1])
    # definitions count consistency
    defs = root.find(b'Definitions')
    counts = {}
    for ot in defs.all(b'ObjectType'):
        counts[ot.props[0].decode()] = ot.find(b'Count').props[0]
    actual = {}
    for o in objs.elems:
        actual[o.id.decode()] = actual.get(o.id.decode(), 0) + 1
    for k, v in actual.items():
        need(counts.get(k) == v, 'Definitions count %s: %r vs %r' % (k, counts.get(k), v))

    models = {}
    for o in objs.all(b'Model'):
        p = props70(o)
        name = ids[o.props[0]][1]
        need(o.find(b'Version').props[0] == 232, 'Model version')
        kids = children.get(o.props[0], [])
        geo = [k for k in kids if ids[k][0] == 'Geometry']
        mats = [ids[k][1] for k in kids if ids[k][0] == 'Material']
        info = {
            'type': o.props[2].decode(), 'T': p['Lcl Translation'], 'R': p['Lcl Rotation'], 'S': p['Lcl Scaling'],
            'materials': mats, 'parentRoot': any(c.props[1] == o.props[0] and c.props[2] == 0 for c in conns),
        }
        if geo:
            g = next(x for x in objs.all(b'Geometry') if x.props[0] == geo[0])
            need(g.find(b'GeometryVersion').props[0] == 124, 'GeometryVersion')
            verts = g.find(b'Vertices').props[0]
            pvi = g.find(b'PolygonVertexIndex').props[0]
            need(g.find(b'Vertices').types == b'd' and g.find(b'PolygonVertexIndex').types == b'i', 'array types')
            nv = len(verts) // 3
            polys, cur = [], []
            for i in pvi:
                if i < 0:
                    cur.append(~i)
                    polys.append(cur)
                    cur = []
                else:
                    cur.append(i)
            need(not cur, 'unterminated polygon')
            need(all(0 <= v < nv for p_ in polys for v in p_), 'vertex index out of range')
            need(all(len(p_) >= 3 for p_ in polys), 'polygon < 3')
            edges = g.find(b'Edges').props[0]
            need(all(0 <= e < len(pvi) for e in edges), 'edge index range')
            ln = g.find(b'LayerElementNormal')
            need(ln.find(b'MappingInformationType').props[0] == b'ByPolygonVertex', 'normal mapping')
            need(ln.find(b'ReferenceInformationType').props[0] == b'Direct', 'normal ref')
            normals = ln.find(b'Normals').props[0]
            need(len(normals) == 3 * len(pvi), 'normals count')
            bad_n = sum(1 for k in range(0, len(normals), 3) if abs((normals[k] ** 2 + normals[k + 1] ** 2 + normals[k + 2] ** 2) - 1) > 1e-6)
            need(bad_n == 0, 'non-unit normals: %d' % bad_n)
            luv = g.find(b'LayerElementUV')
            need(luv.find(b'Name').props[0] == b'UVMap', 'UV name')
            need(luv.find(b'MappingInformationType').props[0] == b'ByPolygonVertex', 'uv mapping')
            need(luv.find(b'ReferenceInformationType').props[0] == b'IndexToDirect', 'uv ref')
            uv = luv.find(b'UV').props[0]
            uvi = luv.find(b'UVIndex').props[0]
            need(len(uvi) == len(pvi) and all(0 <= k < len(uv) // 2 for k in uvi), 'uv index')
            lm = g.find(b'LayerElementMaterial')
            mm = lm.find(b'MappingInformationType').props[0]
            mi = lm.find(b'Materials').props[0]
            if mm == b'ByPolygon':
                need(len(mi) == len(polys), 'material per polygon count')
            else:
                need(mm == b'AllSame' and len(mi) == 1, 'AllSame materials')
            need(all(0 <= k < max(1, len(mats)) for k in mi), 'material index range')
            layer = g.find(b'Layer')
            types = [le.find(b'Type').props[0] for le in layer.all(b'LayerElement')]
            need(b'LayerElementNormal' in types and b'LayerElementUV' in types and b'LayerElementMaterial' in types, 'layer entries')
            us = [uv[k] for k in range(0, len(uv), 2)]
            vs = [uv[k] for k in range(1, len(uv), 2)]
            xs = [verts[k] for k in range(0, len(verts), 3)]
            ys = [verts[k] for k in range(1, len(verts), 3)]
            zs = [verts[k] for k in range(2, len(verts), 3)]
            info.update({
                'verts': nv, 'polys': len(polys), 'ngons': [len(p_) for p_ in polys],
                'tris': sum(len(p_) - 2 for p_ in polys),
                'uvRange': [[min(us), max(us)], [min(vs), max(vs)]],
                'localBBox': [[min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]],
                'matMapping': mm.decode(),
            })
        models[ids[o.props[0]][1]] = info

    textures = {}
    for t in objs.all(b'Texture'):
        kids = children.get(t.props[0], [])
        vids = [k for k in kids if ids[k][0] == 'Video']
        need(len(vids) == 1, 'texture without video')
        v = next(x for x in objs.all(b'Video') if x.props[0] == vids[0])
        content = v.find(b'Content').props[0]
        need(content[:8] == b'\x89PNG\r\n\x1a\n', 'embedded content not PNG')
        need(v.find(b'RelativeFilename').props[0] == t.find(b'RelativeFilename').props[0], 'relative filename mismatch')
        users = [ids[c.props[2]][1] for c in conns if c.props[0] == b'OP' and c.props[1] == t.props[0]]
        textures[t.find(b'RelativeFilename').props[0].decode()] = {'bytes': len(content), 'materials': users}
    materials = {}
    for m in objs.all(b'Material'):
        p = props70(m)
        materials[ids[m.props[0]][1]] = {'DiffuseColor': p.get('DiffuseColor'), 'Opacity': p.get('Opacity', [None])[0],
                                          'TransparencyFactor': p.get('TransparencyFactor', [None])[0]}
    return {
        'file': path, 'ok': not errs, 'errors': errs, 'version': version,
        'settings': {k: settings[k][0] for k in ('UpAxis', 'UpAxisSign', 'FrontAxis', 'FrontAxisSign', 'CoordAxis', 'CoordAxisSign', 'UnitScaleFactor') if k in settings},
        'models': models, 'textures': textures, 'materials': materials,
    }


def main():
    results = []
    ok = True
    for path in sys.argv[1:]:
        try:
            r = check(path)
        except Exception as e:  # noqa
            r = {'file': path, 'ok': False, 'errors': ['parse failed: %s' % e]}
        ok = ok and r['ok']
        results.append(r)
    print(json.dumps(results, default=lambda x: x.decode('utf8', 'replace') if isinstance(x, bytes) else list(x)))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
