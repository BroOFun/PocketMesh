// Node test runner: module rules, triangulation, exports (written to test/out/),
// glTF validator, ZIP integrity, OBJ round trip, FBX strict parse (python).
// usage: node test/run-tests.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadExport } = require('./load-export.cjs');
const { buildScene, expected, worldPoint, qAxis, qMul } = require('./scenes.cjs');

const OUT = path.join(__dirname, 'out-export');
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail && !cond ? '  -- ' + detail : ''));
}
function writeFiles(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, f.name), typeof f.data === 'string' ? f.data : Buffer.from(f.data));
}

(async () => {
  // ---------------------------------------------------------------- module rules
  let api;
  try {
    const r = loadExport();
    api = r.api;
    const need = ['exportOBJ', 'exportGLTF', 'exportDAE', 'exportFBX', 'makeZip', 'importOBJ'];
    check('module: no imports, prefixed privates, exact exported API', need.every((n) => r.exported.includes(n)) && r.exported.length === need.length, r.exported.join(','));
  } catch (e) {
    check('module: loads as concatenated script', false, e.message);
    process.exit(1);
  }

  // ---------------------------------------------------------------- triangulation
  {
    const tri = api._private._exTriangulate;
    const polys = {
      L: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]],
      E: [[0, 0], [3, 0], [3, 1], [1, 1], [1, 2], [3, 2], [3, 3], [1, 3], [1, 4], [3, 4], [3, 5], [0, 5]],
      star: Array.from({ length: 10 }, (_, i) => { const a = (Math.PI * 2 * i) / 10, r = i % 2 ? 0.4 : 1; return [r * Math.cos(a), r * Math.sin(a)]; }),
      collinear: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]],
      U: [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]],
      comb: [[0, 0], [6, 0], [6, 1], [5, 1], [5, 3], [4, 3], [4, 1], [3, 1], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]],
      spiral: [[0, 0], [5, 0], [5, 5], [1, 5], [1, 2], [3, 2], [3, 3], [2, 3], [2, 4], [4, 4], [4, 1], [0, 1]],
    };
    const q = qMul(qAxis([1, 2, 3], 70), qAxis([0, 1, 0], 25));
    let allOk = true;
    const msgs = [];
    for (const [name, p2] of Object.entries(polys)) {
      for (const embed of ['xy', '3d']) {
        const pts = p2.map(([x, y]) => (embed === 'xy' ? [x, y, 0] : worldPoint({ position: [1, 2, 3], quaternion: q, scale: [1, 1, 1] }, [x, y, 0])));
        const tris = tri(pts);
        const area2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        let polyA = 0;
        for (let i = 0; i < p2.length; i++) { const a = p2[i], b = p2[(i + 1) % p2.length]; polyA += a[0] * b[1] - b[0] * a[1]; }
        let sum = 0, neg = 0, outside = 0;
        const inside = (pt) => { let c = false; for (let i = 0, j = p2.length - 1; i < p2.length; j = i++) { const a = p2[i], b = p2[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
        for (const [i, j, k] of tris) {
          const A = area2(p2[i], p2[j], p2[k]);
          sum += A;
          if (A < -1e-9) neg++;
          if (A > 1e-9 && !inside([(p2[i][0] + p2[j][0] + p2[k][0]) / 3, (p2[i][1] + p2[j][1] + p2[k][1]) / 3])) outside++;
        }
        const ok = tris.length === p2.length - 2 && Math.abs(sum - polyA) < 1e-9 && neg === 0 && outside === 0;
        if (!ok) { allOk = false; msgs.push(`${name}/${embed}: n=${tris.length} sum=${sum} poly=${polyA} neg=${neg} outside=${outside}`); }
      }
    }
    check('triangulation: concave/collinear/3D n-gons -> n-2 CCW tris inside polygon, exact area', allOk, msgs.join('; '));

    // Euler XYZ (R = Rz*Ry*Rx) reconstruction
    const eul = api._private._exQuatToEulerXYZDeg;
    let maxErr = 0;
    const qs = [[0, 0, 0, 1], qAxis([1, 1, 0], 35), qMul(qAxis([0, 0, 1], 30), qAxis([1, 0, 0], 45)), qAxis([0, 1, 0], 90), qAxis([0, 1, 0], -90), qAxis([3, -1, 2], 160)];
    for (const qq of qs) {
      const [x, y, z] = eul(qq).map((d) => (d * Math.PI) / 180);
      const r = qMul(qMul(qAxis([0, 0, 1], (z * 180) / Math.PI), qAxis([0, 1, 0], (y * 180) / Math.PI)), qAxis([1, 0, 0], (x * 180) / Math.PI));
      const dot = Math.abs(r[0] * qq[0] + r[1] * qq[1] + r[2] * qq[2] + r[3] * qq[3]) / Math.hypot(...qq);
      maxErr = Math.max(maxErr, 1 - dot);
    }
    check('FBX euler: Rz*Ry*Rx(deg) reproduces quaternion (incl. gimbal)', maxErr < 1e-9, 'err ' + maxErr);
  }

  // ---------------------------------------------------------------- exports
  const scene = buildScene();
  const exp = expected(scene);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'expected.json'), JSON.stringify(exp, null, 1));
  const combos = {
    A: { yUp: true, applyTransforms: false, triangulate: false, baseName: 'model' },
    B: { yUp: true, applyTransforms: true, triangulate: true, baseName: 'model' },
    C: { yUp: false, applyTransforms: false, triangulate: false, baseName: 'model' },
    D: { yUp: false, applyTransforms: true, triangulate: false, baseName: 'model' },
  };
  const outputs = {};
  for (const [k, o] of Object.entries(combos)) {
    const dir = path.join(OUT, k);
    outputs[k] = {
      obj: api.exportOBJ(scene, o),
      glb: api.exportGLTF(scene, o),
      gltf: api.exportGLTF(scene, Object.assign({}, o, { binary: false })),
      dae: api.exportDAE(scene, o),
      fbx: api.exportFBX(scene, o),
    };
    for (const files of Object.values(outputs[k])) writeFiles(dir, files);
  }
  const A = outputs.A;
  check('exportOBJ returns [obj, mtl, textures...] deduped', A.obj.map((f) => f.name).join(',') === 'model.obj,model.mtl,bricks.png,pixel art.png', A.obj.map((f) => f.name).join(','));
  check('exportGLTF binary -> [model.glb] Uint8Array; binary:false -> [model.gltf] string',
    A.glb.length === 1 && A.glb[0].name === 'model.glb' && A.glb[0].data instanceof Uint8Array && A.gltf.length === 1 && A.gltf[0].name === 'model.gltf' && typeof A.gltf[0].data === 'string');
  check('exportDAE returns dae + textures', A.dae.map((f) => f.name).join(',') === 'model.dae,bricks.png,pixel art.png');
  check('exportFBX returns [model.fbx] Uint8Array', A.fbx.length === 1 && A.fbx[0].name === 'model.fbx' && A.fbx[0].data instanceof Uint8Array);
  {
    const mtl = A.obj[1].data;
    check('MTL: only used materials, default grey for material-less object, Kd linear',
      /newmtl Default\nNs [\d.]+\nKa 1 1 1\nKd 0.8 0.8 0.8/.test(mtl) && !/Unused/.test(mtl) && /newmtl BricksAlt[\s\S]*?map_Kd bricks.png/.test(mtl) && /newmtl Glass[\s\S]*?\nd 0.5\n/.test(mtl));
  }
  {
    const gj = JSON.parse(A.gltf[0].data);
    check('glTF: images embedded as data: URIs in .gltf, buffer data: URI', gj.images.every((i) => i.uri.startsWith('data:image/png;base64,')) && gj.buffers[0].uri.startsWith('data:application/octet-stream;base64,'));
    check('glTF: nearest sampler for pixel texture, linear for bricks; 2 images (deduped)',
      gj.images.length === 2 && gj.textures.length === 2 && gj.samplers.some((s) => s.magFilter === 9728 && s.minFilter === 9728) && gj.samplers.some((s) => s.magFilter === 9729));
    const glass = gj.materials.find((m) => m.name === 'Glass');
    check('glTF: alpha<1 -> BLEND, baseColorFactor has alpha', glass.alphaMode === 'BLEND' && glass.pbrMetallicRoughness.baseColorFactor[3] === 0.5);
    const cyl = gj.meshes.find((m) => m.name === 'Cylinder');
    check('glTF: one primitive per material', cyl.primitives.length === 2 && gj.meshes.find((m) => m.name === 'LShape').primitives.length === 2);
    const nodeL = gj.nodes.find((n) => n.name === 'LShape');
    const q = scene.objects[1].quaternion;
    check('glTF: node TRS conjugated to Y-up (t=(x,z,-y), q=(x,z,-y,w), s=(sx,sz,sy))',
      JSON.stringify(nodeL.translation) === JSON.stringify([3, 0, -0]) || (nodeL.translation[0] === 3 && Math.abs(nodeL.translation[1]) < 1e-12 && Math.abs(nodeL.translation[2]) < 1e-12),
      JSON.stringify(nodeL));
    check('glTF: rotation/scale conjugation', Math.abs(nodeL.rotation[0] - q[0]) < 1e-12 && Math.abs(nodeL.rotation[1] - q[2]) < 1e-12 && Math.abs(nodeL.rotation[2] + q[1]) < 1e-12 && JSON.stringify(nodeL.scale) === '[1.5,2,1]', JSON.stringify(nodeL));
  }

  // ---------------------------------------------------------------- glTF validator
  {
    const validator = require('gltf-validator');
    for (const [k, file] of [['A', 'model.glb'], ['A', 'model.gltf'], ['B', 'model.glb'], ['B', 'model.gltf']]) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(OUT, k, file)));
      const report = await validator.validateBytes(bytes, { uri: file, maxIssues: 200, externalResourceFunction: () => Promise.reject(new Error('no external')) });
      const iss = report.issues;
      const errs = iss.messages.filter((m) => m.severity === 0).map((m) => m.code + ' ' + m.pointer + ' ' + m.message);
      const warns = [...new Set(iss.messages.filter((m) => m.severity === 1).map((m) => m.code))];
      fs.writeFileSync(path.join(OUT, k, file + '.validation.json'), JSON.stringify(report, null, 1));
      check(`gltf-validator ${k}/${file}: 0 errors (warnings: ${iss.numWarnings} ${warns.join(',')}; infos: ${iss.numInfos})`, iss.numErrors === 0, errs.slice(0, 5).join(' | '));
    }
  }

  // ---------------------------------------------------------------- ZIP
  {
    const files = A.obj.concat([{ name: 'ünïcødé/naïve.txt', data: 'héllo' }]);
    const zip = api.makeZip(files);
    const zpath = path.join(OUT, 'test.zip');
    fs.writeFileSync(zpath, Buffer.from(zip));
    let ok = true, msg = '';
    try { execFileSync('python3', ['-m', 'zipfile', '-t', zpath], { stdio: 'pipe' }); } catch (e) { ok = false; msg = String(e.stderr || e.message); }
    check('ZIP: python3 -m zipfile -t', ok, msg);
    let hasUnzip = true;
    try { execFileSync('which', ['unzip'], { stdio: 'pipe' }); } catch (e) { hasUnzip = false; }
    if (hasUnzip) {
      let ok2 = true, m2 = '';
      try { m2 = execFileSync('unzip', ['-t', zpath], { stdio: 'pipe' }).toString(); ok2 = /No errors detected/.test(m2); } catch (e) { ok2 = false; m2 = String(e.stdout || e.message); }
      check('ZIP: unzip -t', ok2, m2);
    }
    const py = `import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps([[i.filename,i.file_size,i.compress_type,i.flag_bits & 0x800] for i in z.infolist()]))\nfor i in z.infolist(): z.read(i)`;
    const info = JSON.parse(execFileSync('python3', ['-c', py, zpath]).toString());
    const want = files.map((f) => [f.name, Buffer.from(typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data).length]);
    check('ZIP: names (UTF-8 flag), sizes, STORE method, contents readable', JSON.stringify(info.map((i) => [i[0], i[1]])) === JSON.stringify(want) && info.every((i) => i[2] === 0 && i[3]), JSON.stringify(info));
  }

  // ---------------------------------------------------------------- OBJ import round trip
  {
    const imp = api.importOBJ(A.obj[0].data);
    const names = imp.objects.map((o) => o.name);
    check('importOBJ: objects split by o', JSON.stringify(names) === JSON.stringify(['Cube', 'LShape', 'Cylinder', 'Mirrored', 'Wire']), names.join(','));
    let maxD = 0, structOk = true, uvOk = true, outward = true;
    const msgs = [];
    for (const src of scene.objects) {
      const io = imp.objects.find((o) => o.name === src.name);
      if (!io) { structOk = false; continue; }
      const m = io.mesh;
      const world = src.mesh.verts.map((p) => worldPoint(src, p));
      if (m.verts.length !== world.length) { structOk = false; msgs.push(src.name + ' verts ' + m.verts.length); }
      for (let i = 0; i < Math.min(world.length, m.verts.length); i++) for (let k = 0; k < 3; k++) maxD = Math.max(maxD, Math.abs(world[i][k] - m.verts[i][k]));
      if (m.faces.length !== src.mesh.faces.length) { structOk = false; msgs.push(src.name + ' faces'); }
      m.faces.forEach((f, fi) => {
        const sf = src.mesh.faces[fi];
        if (!sf || f.v.length !== sf.v.length) { structOk = false; return; }
        // same corner set (winding may be reversed for mirrored objects)
        const key = (v, uv) => v.map((x, k) => x + ':' + uv[k].map((t) => t.toFixed(5)).join(',')).sort().join(' ');
        if (key(f.v, f.uv) !== key(sf.v, sf.uv)) uvOk = false;
      });
      if (m.faces.length) {
        // closed meshes: signed volume (divergence theorem) > 0 iff faces wind outward
        const vol = (verts, faces) => {
          let v = 0;
          for (const f of faces) {
            const p0 = verts[f.v[0]];
            for (let k = 1; k + 1 < f.v.length; k++) {
              const a = verts[f.v[k]], b = verts[f.v[k + 1]];
              v += (p0[0] * (a[1] * b[2] - a[2] * b[1]) - p0[1] * (a[0] * b[2] - a[2] * b[0]) + p0[2] * (a[0] * b[1] - a[1] * b[0])) / 6;
            }
          }
          return v;
        };
        const vImp = vol(m.verts, m.faces);
        const vSrc = vol(src.mesh.verts, src.mesh.faces) * Math.abs(src.scale[0] * src.scale[1] * src.scale[2]);
        if (!(vImp > 0) || Math.abs(vImp - vSrc) > 1e-4 * vSrc) { outward = false; msgs.push(`${src.name} volume ${vImp} vs ${vSrc}`); }
      }
      if (m.smooth !== !!src.mesh.smooth) { structOk = false; msgs.push(src.name + ' smooth'); }
      if (!(m.seams instanceof Set)) structOk = false;
    }
    check('importOBJ round trip: world positions back in Z-up (max err ' + maxD.toExponential(2) + ')', maxD < 2e-6);
    check('importOBJ round trip: n-gons kept, face/vert counts, smooth flag, seams Set', structOk, msgs.join(';'));
    check('importOBJ round trip: per-corner UVs preserved', uvOk);
    check('OBJ export (baked): all faces outward incl. negative-scale object (winding flipped)', outward, msgs.join(';'));
    const wire = imp.objects.find((o) => o.name === 'Wire');
    check('importOBJ: loose edges from l lines', wire && JSON.stringify(wire.mesh.looseEdges) === '[[0,1],[1,2]]', wire && JSON.stringify(wire.mesh.looseEdges));
    const cube = imp.objects.find((o) => o.name === 'Cube');
    check('importOBJ: usemtl -> face.mat slots + materialNames', cube && cube.materialNames.join() === 'Bricks' && imp.objects.find((o) => o.name === 'Cylinder').materialNames.join() === 'Pixel,Metal');
    const misc = api.importOBJ('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\ng grp\nf -4 -3 -2 -1\n');
    check('importOBJ: negative indices, g split, missing vt -> [0,0], Y-up->Z-up', misc.objects.length === 1 && misc.objects[0].name === 'grp' &&
      JSON.stringify(misc.objects[0].mesh.verts[2]) === JSON.stringify([1, -0, 1]) && JSON.stringify(misc.objects[0].mesh.faces[0].uv[0]) === '[0,0]', JSON.stringify(misc));
  }

  // ---------------------------------------------------------------- FBX strict parse (Blender parse_fbx.py logic)
  {
    const files = ['A', 'B', 'C', 'D'].map((k) => path.join(OUT, k, 'model.fbx'));
    let out, ok = true;
    try { out = execFileSync('python3', [path.join(__dirname, 'fbx_check.py'), ...files]).toString(); } catch (e) { ok = false; out = String(e.stdout); }
    const rep = JSON.parse(out);
    fs.writeFileSync(path.join(OUT, 'fbx_check.json'), JSON.stringify(rep, null, 1));
    check('FBX: strict parse (end offsets, 13-byte sentinels, scope length, footer) + structure, A/B/C/D', ok && rep.every((r) => r.ok), rep.map((r) => r.errors.join(',')).join(' | '));
    const a = rep[0];
    check('FBX: GlobalSettings Y-up axes, UnitScaleFactor 100', JSON.stringify(a.settings) === JSON.stringify({ UpAxis: 1, UpAxisSign: 1, FrontAxis: 2, FrontAxisSign: 1, CoordAxis: 0, CoordAxisSign: 1, UnitScaleFactor: 100 }), JSON.stringify(a.settings));
    check('FBX (yUp:false): Z-up axes', rep[2].settings.UpAxis === 2 && rep[2].settings.FrontAxis === 1 && rep[2].settings.FrontAxisSign === -1);
    let mOk = true; const mm = [];
    for (const [name, e] of Object.entries(exp)) {
      const m = a.models[name];
      if (!m) { mOk = false; mm.push('missing ' + name); continue; }
      if (e.faces) {
        if (m.tris !== e.tris || JSON.stringify(m.ngons) !== JSON.stringify(e.ngons)) { mOk = false; mm.push(name + ' ngons'); }
        if (JSON.stringify(m.materials) !== JSON.stringify(e.matNames)) { mOk = false; mm.push(name + ' mats ' + m.materials); }
        if (Math.abs(m.uvRange[1][0] - e.uv.v[0]) > 1e-9 || Math.abs(m.uvRange[1][1] - e.uv.v[1]) > 1e-9) { mOk = false; mm.push(name + ' uv'); }
      } else if (m.type !== 'Null') { mOk = false; mm.push(name + ' not Null'); }
    }
    check('FBX: n-gons kept, material slots in order, UVs unflipped, faceless object -> Null', mOk, mm.join(';'));
    const b = rep[1];
    check('FBX triangulate: all polys are tris', Object.values(b.models).every((m) => !m.ngons || m.ngons.every((n) => n === 3)));
    check('FBX: textures embedded once each, shared bricks texture -> 2 materials', a.textures['bricks.png'] && a.textures['bricks.png'].materials.sort().join() === 'Bricks,BricksAlt' && a.textures['pixel art.png'].materials.join() === 'Pixel', JSON.stringify(a.textures));
  }

  // ---------------------------------------------------------------- edge cases
  {
    const validator = require('gltf-validator');
    const gltfErrors = async (bytes, uri) => {
      const r = await validator.validateBytes(bytes, { uri, maxIssues: 50 });
      return r.issues.messages.filter((m) => m.severity === 0).map((m) => m.code + ' ' + m.pointer);
    };
    // empty / missing scenes
    let threw = null;
    const empties = [];
    for (const sc of [undefined, {}, { objects: [], materials: [] }]) {
      try {
        empties.push(api.exportGLTF(sc)[0].data);
        api.exportGLTF(sc, { binary: false }); api.exportOBJ(sc); api.exportDAE(sc); api.exportFBX(sc);
      } catch (e) { threw = e; }
    }
    const emptyErrs = threw ? [] : await gltfErrors(empties[2], 'empty.glb');
    check('edge: empty/undefined scene exports without throwing; empty GLB valid', !threw && emptyErrs.length === 0, threw ? threw.stack : emptyErrs.join(','));

    // > 65535 vertices -> uint32 indices
    const N = 260;
    const verts = [], faces = [];
    for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) verts.push([x / N, y / N, Math.sin(x / 9) * 0.05]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const a = y * (N + 1) + x;
      faces.push({ v: [a, a + 1, a + N + 2, a + N + 1], uv: [[x / N, y / N], [(x + 1) / N, y / N], [(x + 1) / N, (y + 1) / N], [x / N, (y + 1) / N]], mat: 0 });
    }
    const big = { objects: [{ name: 'Grid', position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], mesh: { verts, faces, looseEdges: [], seams: new Set(), smooth: true }, materials: [] }], materials: [] };
    const t0 = Date.now();
    const bigGlb = api.exportGLTF(big)[0].data;
    const dt = Date.now() - t0;
    const bigJson = JSON.parse(Buffer.from(bigGlb.slice(20, 20 + new DataView(bigGlb.buffer).getUint32(12, true))).toString());
    const bigErrs = await gltfErrors(bigGlb, 'big.glb');
    check(`edge: ${verts.length} verts -> uint32 indices, valid GLB (${dt} ms)`, bigJson.accessors[bigJson.meshes[0].primitives[0].indices].componentType === 5125 && bigErrs.length === 0, bigErrs.join(','));
    const t1 = Date.now();
    api.exportFBX(big); api.exportOBJ(big); api.exportDAE(big);
    check(`edge: FBX+OBJ+DAE of ${faces.length}-quad grid in ${Date.now() - t1} ms (< 5000)`, Date.now() - t1 < 5000);

    // awkward names + degenerate input
    const weird = buildScene();
    weird.objects[0].name = 'My Cube <&"\'> ü';
    weird.objects[1].name = '1st L:shape';
    weird.materials[0].name = 'Brick & Mortar';
    weird.materials[1].name = 'Glass';
    weird.materials[3].name = 'Glass'; // duplicate name -> must be made unique
    weird.objects[2].mesh.faces.push({ v: [0, 1, 999], uv: [], mat: 0 }); // invalid index -> skipped
    weird.objects[2].mesh.faces.push({ v: [0, 0, 1], mat: 0 }); // degenerate + missing uv
    weird.objects[3].position = [NaN, 1, 2];
    const W = path.join(OUT, 'W');
    let wErr = null;
    try {
      writeFiles(W, api.exportDAE(weird, {}));
      writeFiles(W, api.exportGLTF(weird, {}));
      writeFiles(W, api.exportFBX(weird, {}));
      writeFiles(W, api.exportOBJ(weird, {}));
    } catch (e) { wErr = e; }
    const wErrs = wErr ? [] : await gltfErrors(new Uint8Array(fs.readFileSync(path.join(W, 'model.glb'))), 'model.glb');
    const wj = wErr ? null : JSON.parse(Buffer.from(fs.readFileSync(path.join(W, 'model.glb'))).toString('utf8', 20, 20 + fs.readFileSync(path.join(W, 'model.glb')).readUInt32LE(12)));
    check('edge: odd names, duplicate material names, bad indices, NaN transform -> valid GLB, unique material names',
      !wErr && wErrs.length === 0 && new Set(wj.materials.map((m) => m.name)).size === wj.materials.length && wj.nodes[0].name === 'My Cube <&"\'> ü',
      wErr ? wErr.stack : wErrs.join(',') + ' ' + (wj && wj.materials.map((m) => m.name)));
    let fOk = true, fOut = '';
    try { fOut = execFileSync('python3', [path.join(__dirname, 'fbx_check.py'), path.join(W, 'model.fbx')]).toString(); } catch (e) { fOk = false; fOut = String(e.stdout); }
    check('edge: FBX with odd/UTF-8 names parses strictly', fOk && JSON.parse(fOut)[0].models['My Cube <&"\'> ü'], fOut.slice(0, 300));

    // importOBJ: state carried across groups, s/usemtl before o, vt-less faces, comments, CRLF, continuation
    const t = api.importOBJ('# c\r\nmtllib a.mtl\r\nusemtl A\r\ns 1\r\nv 0 0 0\r\nv 1 0 0\r\nv 1 1 0\r\nv 0 1 0\r\no First\r\nf 1 2 \\\r\n 3\r\no Second\r\nf 1//1 3//1 4//1\r\nusemtl B\r\nf 1 2 4\r\ns off\r\no Third\r\nf 2 3 4\r\n');
    const [f1, s2, t3] = t.objects;
    check('importOBJ: usemtl/s state carries across o, continuation lines, CRLF, v//vn',
      t.objects.length === 3 && f1.mesh.faces[0].v.length === 3 && f1.materialNames.join() === 'A' && s2.materialNames.join() === 'A,B' &&
      JSON.stringify(s2.mesh.faces.map((f) => f.mat)) === '[0,1]' && f1.mesh.smooth && s2.mesh.smooth && !t3.mesh.smooth && t3.materialNames.join() === 'B' &&
      s2.mesh.verts.length === 4 && t.mtllib[0] === 'a.mtl', JSON.stringify(t.objects.map((o) => [o.name, o.materialNames, o.mesh.smooth, o.mesh.verts.length])));
  }

  const failed = results.filter((r) => !r.pass);
  fs.writeFileSync(path.join(OUT, 'node-results.json'), JSON.stringify(results, null, 1));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
