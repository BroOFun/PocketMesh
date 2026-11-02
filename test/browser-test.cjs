// Loads every exported file (test/out/{A,B,C}) with three.js r160 loaders in Chromium (Playwright)
// and compares per-object world bounding boxes, triangle counts, UV ranges, materials and textures
// against the source scene. Run node test/run-tests.cjs first.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'out-export');
const exp = JSON.parse(fs.readFileSync(path.join(OUT, 'expected.json'), 'utf8'));

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
</head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

async function load(fmt, dir) {
  if (fmt === 'glb') return (await new GLTFLoader().loadAsync(dir + 'model.glb')).scene;
  if (fmt === 'gltf') return (await new GLTFLoader().loadAsync(dir + 'model.gltf')).scene;
  if (fmt === 'fbx') return await new FBXLoader().loadAsync(dir + 'model.fbx');
  if (fmt === 'dae') return (await new ColladaLoader().loadAsync(dir + 'model.dae')).scene;
  if (fmt === 'obj') {
    const mats = await new MTLLoader().setPath(dir).loadAsync('model.mtl');
    mats.preload();
    return await new OBJLoader().setMaterials(mats).loadAsync(dir + 'model.obj');
  }
}
async function waitImages(root) {
  const maps = [];
  root.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) if (m.map) maps.push(m.map); });
  const t0 = performance.now();
  while (performance.now() - t0 < 8000) {
    if (maps.every((t) => t.image && (t.image.width > 0) && (t.image.complete !== false))) break;
    await new Promise((r) => setTimeout(r, 50));
  }
}
window.summarize = async (fmt, dir, names) => {
  const root = await load(fmt, dir);
  await waitImages(root);
  root.updateMatrixWorld(true);
  const res = {};
  for (const name of names) {
    const obj = root.getObjectByName(name);
    if (!obj) { res[name] = null; continue; }
    const info = { tris: 0, lineSegs: 0, uv: null, materials: [], det: obj.matrixWorld.determinant() };
    const box = new THREE.Box3().setFromObject(obj, true);
    info.bbox = box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() };
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    obj.traverse((o) => {
      const g = o.geometry;
      if (!g) return;
      if (o.isMesh) {
        info.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
        const uv = g.attributes.uv;
        if (uv) for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
        for (const m of [].concat(o.material)) {
          if (info.materials.some((x) => x.name === m.name)) continue;
          info.materials.push({
            name: m.name, type: m.type, color: m.color ? m.color.toArray() : null, opacity: m.opacity, transparent: m.transparent,
            map: m.map ? { w: m.map.image && m.map.image.width, h: m.map.image && m.map.image.height, mag: m.map.magFilter, min: m.map.minFilter } : null,
          });
        }
      } else if (o.isLineSegments) {
        info.lineSegs += (g.index ? g.index.count : g.attributes.position.count) / 2;
      }
    });
    if (umin <= umax) info.uv = { u: [umin, umax], v: [vmin, vmax] };
    res[name] = info;
  }
  return res;
};
window.ready = true;
</script></body></html>`;

function serve() {
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.json': 'application/json' };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/runner.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
      const file = path.join(ROOT, path.normalize(url));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail && !cond ? '  -- ' + detail : ''));
}
const close = (a, b, tol) => a.every((x, i) => Math.abs(x - b[i]) <= tol);

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
  await page.goto(base + '/runner.html');
  await page.waitForFunction(() => window.ready === true);
  const names = Object.keys(exp);
  const cases = [];
  for (const combo of ['A', 'B', 'C', 'D']) for (const fmt of ['glb', 'gltf', 'obj', 'dae', 'fbx']) cases.push([combo, fmt]);
  const all = {};
  for (const [combo, fmt] of cases) {
    logs.length = 0;
    let s;
    try { s = await page.evaluate(([f, d, n]) => window.summarize(f, d, n), [fmt, `/out-export/${combo}/`, names]); } catch (e) { check(`${combo}/${fmt}: loads`, false, e.message.slice(0, 300)); continue; }
    all[combo + '/' + fmt] = s;
    // glTF always Y-up; OBJ/FBX raw coordinates; three's ColladaLoader rotates Z_UP files to Y-up.
    const yUpData = (combo !== 'C' && combo !== 'D') || fmt === 'glb' || fmt === 'gltf' || fmt === 'dae';
    const errs = [];
    for (const name of names) {
      const e = exp[name], g = s[name];
      if (!g) { errs.push(name + ' missing'); continue; }
      const eb = yUpData ? e.bboxY : e.bboxZ;
      if (e.faces) {
        if (!g.bbox || !close(g.bbox.min, eb.min, 1e-4) || !close(g.bbox.max, eb.max, 1e-4)) errs.push(`${name} bbox ${JSON.stringify(g.bbox)} vs ${JSON.stringify(eb)}`);
        if (g.tris !== e.tris) errs.push(`${name} tris ${g.tris} vs ${e.tris}`);
        const ev = fmt === 'glb' || fmt === 'gltf' ? [1 - e.uv.v[1], 1 - e.uv.v[0]] : e.uv.v;
        if (!g.uv || !close(g.uv.u, e.uv.u, 1e-5) || !close(g.uv.v, ev, 1e-5)) errs.push(`${name} uv ${JSON.stringify(g.uv)} vs u${e.uv.u} v${ev}`);
        const gm = g.materials.map((m) => m.name).sort().join();
        if (gm !== e.matNames.slice().sort().join()) errs.push(`${name} materials ${gm} vs ${e.matNames}`);
        for (const tn of e.textured) {
          const m = g.materials.find((x) => x.name === tn);
          if (!m || !m.map || !(m.map.w > 0)) errs.push(`${name} texture missing on ${tn}`);
        }
      } else if (fmt !== 'fbx') {
        if (g.lineSegs !== e.looseEdges) errs.push(`${name} line segments ${g.lineSegs} vs ${e.looseEdges}`);
        if (!g.bbox || !close(g.bbox.min, eb.min, 1e-4) || !close(g.bbox.max, eb.max, 1e-4)) errs.push(`${name} wire bbox ${JSON.stringify(g.bbox)}`);
      }
    }
    const loaderErrors = logs.filter((l) => !/more than 4 vertices|THREE.ColladaLoader: File version 1.4.1|Unknown extension/.test(l));
    check(`three ${combo}/${fmt}: bboxes, tri counts, UV ranges, materials+textures match source`, errs.length === 0, errs.join(' | '));
    if (loaderErrors.length) console.log('   console:', loaderErrors.slice(0, 5).join(' || '));
  }
  // material specifics
  const glb = all['A/glb'];
  if (glb) {
    const pix = glb.Cylinder.materials.find((m) => m.name === 'Pixel');
    check('three GLB: nearest texture -> NearestFilter mag/min', pix && pix.map.mag === 1003 && pix.map.min === 1003, JSON.stringify(pix));
    const glass = glb.LShape.materials.find((m) => m.name === 'Glass');
    check('three GLB: Glass transparent, opacity 0.5, linear color kept', glass && glass.transparent && glass.opacity === 0.5 && close(glass.color, [0.2, 0.5, 0.9], 1e-6), JSON.stringify(glass));
    check('three GLB: unbaked negative scale object keeps det<0 node transform', glb.Mirrored.det < 0);
  }
  const fbx = all['A/fbx'];
  if (fbx) {
    const glass = fbx.LShape.materials.find((m) => m.name === 'Glass');
    check('three FBX: Glass opacity 0.5 transparent; textures decoded from embedded Content', glass && glass.transparent && Math.abs(glass.opacity - 0.5) < 1e-6 && fbx.Cube.materials[0].map && fbx.Cube.materials[0].map.w === 4, JSON.stringify(glass));
  }
  const dae = all['A/dae'];
  if (dae) {
    const glass = dae.LShape.materials.find((m) => m.name === 'Glass');
    check('three DAE: Glass opacity 0.5 transparent', glass && glass.transparent && Math.abs(glass.opacity - 0.5) < 1e-6, JSON.stringify(glass));
  }
  fs.writeFileSync(path.join(OUT, 'browser-results.json'), JSON.stringify({ results, summaries: all }, null, 1));
  await browser.close();
  srv.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
