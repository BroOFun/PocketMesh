"""Import exported files with real Blender (pip `bpy` module) and compare against the source scene.
usage: <venv>/bin/python test/blender-test.py   (run `node test/run-tests.cjs` first)
Checks per object: world-space vertex bbox (Z-up) == source, polygon count (n-gons kept when not
triangulated), material slot names, rendered winding outward (signed volume * det(matrix_world) > 0),
flat/smooth corner normals, UV layer present, textures (FBX embedded images packed)."""
import json
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out-export')
exp = json.load(open(os.path.join(OUT, 'expected.json')))
results = []


def check(name, cond, detail=''):
    results.append({'name': name, 'pass': bool(cond), 'detail': detail})
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond or not detail else '  -- ' + detail))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def signed_volume(ob):
    me = ob.data
    mw = ob.matrix_world
    w = [mw @ v.co for v in me.vertices]
    vol = 0.0
    for p in me.polygons:
        vs = list(p.vertices)
        p0 = w[vs[0]]
        for k in range(1, len(vs) - 1):
            vol += p0.dot(w[vs[k]].cross(w[vs[k + 1]])) / 6.0
    return vol


def do_import(fmt, path, zup=False):
    if fmt == 'fbx':
        bpy.ops.import_scene.fbx(filepath=path)
    elif fmt in ('glb', 'gltf'):
        bpy.ops.import_scene.gltf(filepath=path)
    elif fmt == 'obj':
        if zup:
            bpy.ops.wm.obj_import(filepath=path, forward_axis='Y', up_axis='Z')
        else:
            bpy.ops.wm.obj_import(filepath=path)
    elif fmt == 'dae':
        bpy.ops.wm.collada_import(filepath=path)


def run_case(combo, fmt):
    reset()
    path = os.path.join(OUT, combo, 'model.' + fmt)
    try:
        do_import(fmt, path, zup=(combo in 'CD'))
    except Exception as e:  # noqa
        check('blender %s/%s: import' % (combo, fmt), False, str(e)[:300])
        return
    triangulated = combo == 'B' or fmt in ('glb', 'gltf')
    errs = []
    for name, e in exp.items():
        ob = bpy.data.objects.get(name)
        if ob is None:
            if e['faces'] or fmt != 'fbx':
                errs.append('%s missing (have %s)' % (name, [o.name for o in bpy.data.objects]))
            continue
        if ob.type != 'MESH':
            if e['faces'] or fmt != 'fbx':
                errs.append('%s type %s' % (name, ob.type))
            continue
        me = ob.data
        mw = ob.matrix_world
        w = [mw @ v.co for v in me.vertices]
        mn = [min(p[k] for p in w) for k in range(3)]
        mx = [max(p[k] for p in w) for k in range(3)]
        if any(abs(mn[k] - e['bboxZ']['min'][k]) > 1e-4 or abs(mx[k] - e['bboxZ']['max'][k]) > 1e-4 for k in range(3)):
            errs.append('%s bbox %s %s vs %s' % (name, [round(x, 4) for x in mn], [round(x, 4) for x in mx], e['bboxZ']))
        if not e['faces']:
            if len(me.edges) != e['looseEdges']:
                errs.append('%s loose edges %d' % (name, len(me.edges)))
            continue
        want_polys = e['tris'] if triangulated else e['faces']
        if len(me.polygons) != want_polys:
            errs.append('%s polys %d vs %d' % (name, len(me.polygons), want_polys))
        if not triangulated and sorted(len(p.vertices) for p in me.polygons) != sorted(e['ngons']):
            errs.append('%s ngon sizes' % name)
        mats = sorted(s.material.name for s in ob.material_slots if s.material)
        if mats != sorted(e['matNames']):
            errs.append('%s materials %s vs %s' % (name, mats, e['matNames']))
        vol = signed_volume(ob)
        det = mw.to_3x3().determinant()
        if not (vol * det > 0):
            errs.append('%s winding inward (vol %.4f det %.3f)' % (name, vol, det))
        if not me.uv_layers:
            errs.append('%s no UVs' % name)
        else:
            uv = me.uv_layers[0].data
            vs = [d.uv[1] for d in uv]
            if abs(min(vs) - e['uv']['v'][0]) > 1e-5 or abs(max(vs) - e['uv']['v'][1]) > 1e-5:
                errs.append('%s uv v-range %s vs %s' % (name, (min(vs), max(vs)), e['uv']['v']))
        # normals: flat objects -> corner normal == face normal; smooth cylinder -> side corners differ
        cn = me.corner_normals
        if name in ('Cube', 'LShape', 'Mirrored'):
            bad = 0
            for p in me.polygons:
                for li in p.loop_indices:
                    if (Vector(cn[li].vector) - p.normal).length > 1e-3:
                        bad += 1
            if bad:
                errs.append('%s %d corner normals not flat' % (name, bad))
        if name == 'Cylinder':
            smooth = sum(1 for p in me.polygons for li in p.loop_indices if (Vector(cn[li].vector) - p.normal).length > 0.05)
            if smooth == 0:
                errs.append('Cylinder not smooth')
        for tn in e['textured']:
            m = bpy.data.materials.get(tn)
            imgs = [n.image for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image] if m and m.node_tree else []
            if not imgs or tuple(imgs[0].size) == (0, 0):
                errs.append('%s texture missing on %s' % (name, tn))
            elif fmt in ('fbx', 'glb') and not imgs[0].packed_file:
                errs.append('%s texture on %s not embedded/packed' % (name, tn))
    check('blender %s/%s: world bboxes, polys/n-gons, materials, outward winding, normals, UVs, textures' % (combo, fmt), not errs, ' | '.join(errs[:6]))
    if fmt == 'fbx' and combo == 'A':
        glass = bpy.data.materials.get('Glass')
        bsdf = next(n for n in glass.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        a = bsdf.inputs['Alpha'].default_value
        col = list(bsdf.inputs['Base Color'].default_value)[:3]
        cube = bpy.data.objects['Cube']
        check('blender A/fbx: Glass alpha 0.5, linear base color kept; UV layer "UVMap"; 1 FBX unit = 1 m',
              abs(a - 0.5) < 1e-4 and all(abs(x - y) < 1e-4 for x, y in zip(col, [0.2, 0.5, 0.9])) and cube.data.uv_layers[0].name == 'UVMap'
              and abs(cube.dimensions.x - 2) < 1e-4, 'alpha %s col %s uv %s dims %s' % (a, col, cube.data.uv_layers[0].name, tuple(cube.dimensions)))


# Blender's own FBX parser on our files
sys.path.insert(0, os.path.join(os.path.dirname(bpy.__file__), '%d.%d' % bpy.app.version[:2], 'scripts', 'addons_core'))
try:
    from io_scene_fbx import parse_fbx
    for combo in 'ABCD':
        root, ver = parse_fbx.parse(os.path.join(OUT, combo, 'model.fbx'))
        check('blender parse_fbx.parse %s/model.fbx (version %d, %d top-level elems)' % (combo, ver, len(root.elems)), ver == 7400 and len(root.elems) == 11)
except Exception as e:  # noqa
    check('blender parse_fbx.parse', False, repr(e))

for combo, fmt in [('A', 'fbx'), ('B', 'fbx'), ('C', 'fbx'), ('A', 'glb'), ('A', 'gltf'), ('B', 'glb'), ('A', 'obj'), ('B', 'obj'), ('C', 'obj'), ('D', 'fbx'), ('D', 'obj'), ('A', 'dae')]:
    if fmt == 'dae':
        try:
            bpy.ops.wm.collada_import.get_rna_type()
        except Exception:  # noqa
            print('SKIP blender %s/dae: COLLADA import was removed from Blender %s' % (combo, bpy.app.version_string))
            continue
    run_case(combo, fmt)

json.dump(results, open(os.path.join(OUT, 'blender-results.json'), 'w'), indent=1)
failed = [r for r in results if not r['pass']]
print('\n%d/%d passed' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
