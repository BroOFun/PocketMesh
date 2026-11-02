"""Validate exported .dae files against the official COLLADA 1.4.1 XSD (bundled with pycollada)
and load them with pycollada as an independent reader.
usage: <python with pycollada+lxml> test/dae_check.py file.dae [...]"""
import json
import os
import sys

import collada
from collada.schema import ColladaValidator
from lxml import etree

HERE = os.path.dirname(os.path.abspath(__file__))
exp = json.load(open(os.path.join(HERE, 'out-export', 'expected.json')))
validator = ColladaValidator()
ok_all = True
for path in sys.argv[1:]:
    errs = []
    doc = etree.parse(path)
    if not validator.validate(doc):
        errs += ['XSD: %s' % e for e in list(validator.COLLADA_SCHEMA_1_4_1_INSTANCE.error_log)[:5]]
    try:
        mesh = collada.Collada(path)
        if os.sep + 'W' + os.sep in path:  # odd-names scene: schema + load only
            raise StopIteration
        names = {}
        for node in mesh.scene.nodes:
            tris = 0
            mats = set()
            for g in node.objects('geometry'):
                for prim in g.primitives():
                    if isinstance(prim, (collada.triangleset.BoundTriangleSet, collada.polylist.BoundPolylist)):
                        tris += len(prim.triangleset()) if hasattr(prim, 'triangleset') else len(prim)
                        mats.add(prim.material.name)
            names[node.id] = (tris, sorted(mats))
        for name, e in exp.items():
            got = names.get(name)
            if got is None:
                errs.append('pycollada: node %s missing' % name)
            elif e['faces'] and (got[0] != e['tris'] or got[1] != sorted(e['matNames'])):
                errs.append('pycollada: %s %r vs tris %d mats %r' % (name, got, e['tris'], e['matNames']))
        if len(mesh.images) != 2:
            errs.append('pycollada: images %d' % len(mesh.images))
    except StopIteration:
        pass
    except Exception as ex:  # noqa
        errs.append('pycollada load failed: %r' % ex)
    ok = not errs
    ok_all = ok_all and ok
    print(('PASS ' if ok else 'FAIL ') + 'COLLADA XSD 1.4.1 + pycollada load: ' + path + ('' if ok else '  -- ' + ' | '.join(errs)))
sys.exit(0 if ok_all else 1)
