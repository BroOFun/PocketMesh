// ============================================================================
// app_core.js — renderer, scene objects, overlays, camera, picking, selection, undo
// ============================================================================
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---------- utils ----------
const $ = (s, r = document) => r.querySelector(s);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const DEG = Math.PI / 180;
const fmt = (x, d = 3) => (Math.abs(x) < 1e-9 ? 0 : x).toFixed(d);
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

// ---------- icons ----------
const ICONS = {
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  undo: '<path d="M9 13.5 4.5 9 9 4.5"/><path d="M4.5 9H14a5.5 5.5 0 0 1 0 11h-3"/>',
  redo: '<path d="M15 13.5 19.5 9 15 4.5"/><path d="M19.5 9H10a5.5 5.5 0 0 0 0 11h3"/>',
  vert: '<rect x="5" y="5" width="14" height="14" rx="1.5" stroke-opacity=".45"/><circle cx="5.5" cy="5.5" r="3" fill="currentColor" stroke="none"/>',
  edge: '<rect x="5" y="5" width="14" height="14" rx="1.5" stroke-opacity=".45"/><path d="M5 5v14" stroke-width="3.4"/>',
  face: '<rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor" fill-opacity=".85"/>',
  select: '<path d="M6 3.5 18.5 12l-5.4 1.3L10.2 19z" fill="currentColor" fill-opacity=".18"/>',
  box: '<rect x="3.5" y="4.5" width="15" height="12" rx="1" stroke-dasharray="3 2.4"/><path d="M14 13l7 2.8-3 .9-1 3z" fill="currentColor"/>',
  cursor: '<circle cx="12" cy="12" r="6" stroke-dasharray="3.1 3.1"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  move: '<path d="M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
  rotate: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 3.8v4.6h-4.6"/>',
  scale: '<rect x="3.5" y="10.5" width="10" height="10" rx="1"/><path d="M10 14 20.5 3.5M15 3.5h5.5V9"/>',
  frame: '<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/><circle cx="12" cy="12" r="2.5"/>',
  persp: '<path d="M3 7.5 21 4v16L3 16.5z"/><path d="M3 12h18M9.5 6.3v11.4M15.5 5.2v13.6" stroke-opacity=".5"/>',
  ortho: '<rect x="4" y="4" width="16" height="16"/><path d="M4 12h16M12 4v16" stroke-opacity=".5"/>',
  pan: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.6 0-4-1.2-5.5-3.6L4 13.8a1.5 1.5 0 0 1 2.6-1.5L8 14"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5M10.5 8v5"/>',
  xray: '<rect x="3.5" y="3.5" width="11" height="11" rx="1"/><rect x="9.5" y="9.5" width="11" height="11" rx="1" fill="currentColor" fill-opacity=".25"/>',
  wire: '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="3.5" ry="8"/><path d="M4 12h16"/>',
  solid: '<circle cx="12" cy="12" r="8" fill="currentColor" fill-opacity=".9"/>',
  matprev: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" fill-opacity=".9"/><path d="M4.5 9.5h7.5M4.5 14.5h7.5" stroke-opacity=".6"/>',
  rendered: '<circle cx="12" cy="12" r="8" fill="currentColor" fill-opacity=".28"/><circle cx="9.3" cy="9.3" r="2.6" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z"/><path d="M6 8h4M14 8h4"/>',
  prop: '<circle cx="12" cy="12" r="2.5" fill="currentColor"/><circle cx="12" cy="12" r="6" stroke-opacity=".7"/><circle cx="12" cy="12" r="9.3" stroke-opacity=".4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke-opacity=".35"/><path d="M4 20 20 4"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="M3 12.5l9 5 9-5M3 17l9 5 9-5" stroke-opacity=".6"/>',
  sliders: '<path d="M5 4v16M12 4v16M19 4v16"/><circle cx="5" cy="15" r="2.2" style="fill:var(--chrome)"/><circle cx="12" cy="8" r="2.2" style="fill:var(--chrome)"/><circle cx="19" cy="13" r="2.2" style="fill:var(--chrome)"/>',
  modifiers: '<path d="M14 4a5 5 0 0 0-6 6L3 15a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-3-3z"/>',
  material: '<circle cx="12" cy="12" r="8.5"/><path d="M4.2 14.5c4 1.6 11.6 1.6 15.6 0" stroke-opacity=".55"/><circle cx="9" cy="9" r="2" fill="currentColor"/>',
  export: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M4.5 13v6.5h15V13"/>',
  import: '<path d="M12 3.5V15M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 13v6.5h15V13"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  folder: '<path d="M3.5 6.5a1 1 0 0 1 1-1H10l2 2h7.5a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>',
  file: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/>',
  uv: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h16M12 4v16" stroke-opacity=".4"/><path d="M7 17l4-9 6 3z" fill="currentColor" fill-opacity=".3"/>',
  view3d: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9" stroke-opacity=".55"/>',
  split: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M3.5 12h17"/><path d="M8 8.2 12 6l4 2.2v.3M9 16.5l3-2 3 2" stroke-opacity=".55"/>',
  cube: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  extrude: '<path d="M4 16 12 19.5 20 16 12 12.5z" fill="currentColor" fill-opacity=".3"/><path d="M12 15V3.5M8.5 7 12 3.5 15.5 7"/>',
  inset: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><rect x="8" y="8" width="8" height="8" fill="currentColor" fill-opacity=".35"/><path d="M3.5 3.5 8 8M20.5 3.5 16 8M3.5 20.5 8 16M20.5 20.5 16 16" stroke-opacity=".6"/>',
  loopcut: '<rect x="3.5" y="5" width="17" height="14" rx="1"/><path d="M12 5v14" style="stroke:#ffd84d" stroke-width="2.2"/>',
  subdivide: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/>',
  fill: '<path d="M4 18 12 5l8 13z" fill="currentColor" fill-opacity=".35"/>',
  merge: '<path d="M4.5 4.5 10 10M19.5 4.5 14 10M12 14v6"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/>',
  normals: '<path d="M3 18h18"/><path d="M12 18V5M8.5 8.5 12 5l3.5 3.5"/>',
  seam: '<path d="M4 9 9 4M15 20l5-5" stroke-opacity=".5"/><path d="M5 19 19 5" style="stroke:#ff5a5a" stroke-width="2.2"/>',
  selall: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2.5"/><path d="M8 12l3 3 5-6"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  join: '<path d="M4 4h9v9H4z"/><path d="M11 11h9v9h-9z" fill="currentColor" fill-opacity=".3"/>',
  separate: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1"/><rect x="13" y="13" width="7.5" height="7.5" rx="1" fill="currentColor" fill-opacity=".3"/><path d="M14 4l6 6" stroke-dasharray="2 2"/>',
  origin: '<circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="7.5" stroke-opacity=".5"/>',
  smooth: '<path d="M4 18c2.5-9 13.5-9 16 0"/><path d="M4 20h16" stroke-opacity=".4"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2.5 2"/><path d="M9 7 4 12l5 5z" fill="currentColor" fill-opacity=".3"/><path d="M15 7l5 5-5 5z"/>',
  pack: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><rect x="6" y="6" width="6" height="5" fill="currentColor" fill-opacity=".35"/><rect x="13.5" y="6" width="4.5" height="8" fill="currentColor" fill-opacity=".35"/><rect x="6" y="13" width="6" height="5" fill="currentColor" fill-opacity=".35"/>',
  straighten: '<path d="M4 8c4-3 6 3 8 0s5-3 8 0" stroke-opacity=".45"/><path d="M4 16h16"/><path d="M8 10.5v3M12 10.5v3M16 10.5v3" stroke-opacity=".6"/>',
  rot90: '<path d="M5 12a7 7 0 1 0 7-7H8"/><path d="M10.5 2.5 8 5l2.5 2.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 3.5 3.5L16 13l4.5 4.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.5v.5"/>',
  dots: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  tri: '<path d="M4 19 12 5l8 14z"/><path d="M12 19V5M8 12h8" stroke-opacity=".55"/>',
  grid: '<path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>',
  hide: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke-opacity=".35"/><path d="M4 20 20 4"/>',
  stretch: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M3.5 3.5h8.5v8.5H3.5z" fill="#4b9df6" fill-opacity=".5" stroke="none"/><path d="M12 12h8.5v8.5H12z" fill="#f2506b" fill-opacity=".5" stroke="none"/>',
};
function icon(n) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
}

// ---------- state ----------
const S = {
  objects: [], materials: [], images: new Map(),
  active: null, mode: 'object', selectMode: 'vert', tool: 'select', selOp: 'set',
  pivot: 'median', orient: 'global',
  snap: false, snapMove: 0.1, snapRot: 5, snapScale: 0.1,
  prop: false, propRadius: 1, propFalloff: 'smooth',
  shading: 'solid', xray: false, faceOrient: false, view: '3d',
  cursor: new THREE.Vector3(),
  uvSel: new Set(), uvTool: 'select', uvStretch: false,
};
let _nid = 1, _matNid = 1, _imgNid = 1;
let dirty = true;
const requestRender = () => { dirty = true; };
const emptySel = () => ({ verts: new Set(), edges: new Set(), faces: new Set() });

// ---------- three.js setup ----------
const c3d = $('#c3d');
const renderer = new THREE.WebGLRenderer({ canvas: c3d, antialias: true, alpha: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const persp = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
persp.up.set(0, 0, 1); ortho.up.set(0, 0, 1);
let camera = persp;
scene.add(persp, ortho);

const hemi = new THREE.HemisphereLight(0xf2f4ff, 0x40424a, 1.5);
hemi.position.set(0, 0, 1);
scene.add(hemi);
function makeHeadlight(cam) {
  const l = new THREE.DirectionalLight(0xffffff, 1.5);
  l.position.set(0.35, 0.55, 1);
  l.target.position.set(0, 0, -1);
  cam.add(l, l.target);
  return l;
}
const headP = makeHeadlight(persp), headO = makeHeadlight(ortho);
const sun = new THREE.DirectionalLight(0xfff4e6, 2.2);
sun.position.set(6, -4, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 60 });
scene.add(sun, sun.target);
let envTex = null;
function getEnv() {
  if (!envTex) { const pm = new THREE.PMREMGenerator(renderer); envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }
  return envTex;
}
// ground catcher for rendered mode
const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.28 }));
shadowFloor.receiveShadow = true; shadowFloor.visible = false; shadowFloor.position.z = -0.001;
scene.add(shadowFloor);

// grid + axes on the XY floor
const gridGroup = new THREE.Group();
(function buildGrid() {
  const mk = (size, div, color, opacity) => {
    const g = new THREE.GridHelper(size, div, color, color);
    g.rotation.x = Math.PI / 2;
    g.material.transparent = true; g.material.opacity = opacity; g.material.depthWrite = false;
    return g;
  };
  gridGroup.add(mk(200, 200, 0x7d8494, 0.45), mk(200, 20, 0x9aa1b0, 0.5));
  const ax = (a, b, color) => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
    l.position.z = 0.0005; return l;
  };
  gridGroup.add(ax([-100, 0, 0], [100, 0, 0], 0xe8455f), ax([0, -100, 0], [0, 100, 0], 0x7cc232));
  gridGroup.renderOrder = -1;
  scene.add(gridGroup);
})();

// point sprites (vertices, face dots, origins, 3D cursor)
function pointMaterial(size, { cursor = false, onTop = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { size: { value: size } },
    vertexShader: `attribute vec3 vcol; uniform float size; varying vec3 vC;
      void main(){ vC = vcol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_Position.z -= 0.0012 * gl_Position.w; gl_PointSize = size; }`,
    fragmentShader: cursor
      ? `varying vec3 vC; void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c);
          float ring = smoothstep(0.30, 0.33, r) * (1.0 - smoothstep(0.40, 0.43, r));
          float cross = (abs(c.x) < 0.035 || abs(c.y) < 0.035) && r > 0.18 && r < 0.5 ? 1.0 : 0.0;
          if (ring < 0.05 && cross < 0.5) discard;
          float a = atan(c.y, c.x); float dash = step(0.0, sin(a * 4.0));
          vec3 col = ring > 0.05 ? mix(vec3(1.0), vec3(0.95, 0.2, 0.25), dash) : vec3(0.08);
          gl_FragColor = vec4(col, 1.0); }`
      : `varying vec3 vC; void main(){ vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard; gl_FragColor = vec4(vC, 1.0); }`,
    depthTest: !onTop, depthWrite: false, transparent: false,
  });
}
const DPR = () => renderer.getPixelRatio();
const cursorPts = new THREE.Points(new THREE.BufferGeometry(), pointMaterial(38 * Math.min(window.devicePixelRatio || 1, 2), { cursor: true, onTop: true }));
cursorPts.geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
cursorPts.geometry.setAttribute('vcol', new THREE.Float32BufferAttribute([1, 1, 1], 3));
cursorPts.renderOrder = 10; cursorPts.frustumCulled = false;
scene.add(cursorPts);
const originPts = new THREE.Points(new THREE.BufferGeometry(), pointMaterial(7 * Math.min(window.devicePixelRatio || 1, 2), { onTop: true }));
originPts.frustumCulled = false; originPts.renderOrder = 9;
scene.add(originPts);

// line materials (fat lines so edges read on retina phones)
const lineMats = [];
function lineMaterial(width, depthTest = true) {
  const m = new LineMaterial({ color: 0xffffff, linewidth: width, vertexColors: true, depthTest, transparent: !depthTest });
  m.resolution.set(c3d.clientWidth || 1, c3d.clientHeight || 1);
  lineMats.push(m);
  return m;
}
const LM = { edit: lineMaterial(1.6), editX: lineMaterial(1.6, false), outline: lineMaterial(2.2), wire: lineMaterial(1.2), wireX: lineMaterial(1.2, false), preview: lineMaterial(2.6, false) };

// transform gizmo (Move / Rotate / Scale tools)
const gizmoProxy = new THREE.Object3D();
scene.add(gizmoProxy);
const tc = new TransformControls(camera, c3d);
tc.size = 1.15;
tc.setSpace('local');
tc.attach(gizmoProxy);
tc.visible = false; tc.enabled = false;
scene.add(tc);

// ---------- materials ----------
const DEFAULT_MAT = { id: 0, name: 'Default', color: '#c9ccd2', roughness: 0.55, metalness: 0, alpha: 1, texture: null, filter: 'linear', useTexture: true, tint: false, wrap: 'repeat', shader: 'lit', alphaMode: 'auto', alphaCutoff: 0.5, doubleSided: true };
const threeMatCache = new Map();
const faceOrientMat = new THREE.ShaderMaterial({
  vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'void main(){ gl_FragColor = gl_FrontFacing ? vec4(0.22, 0.45, 0.95, 1.0) : vec4(0.92, 0.2, 0.22, 1.0); }',
  side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});
function matById(id) { return S.materials.find((m) => m.id === id) || null; }
function newMaterial(name = 'Material', color = '#c9ccd2') {
  const m = { id: _matNid++, name: uniqueMatName(name), color, roughness: 0.5, metalness: 0, alpha: 1, texture: null, filter: 'linear', useTexture: true, tint: false, wrap: 'repeat', shader: 'lit', alphaMode: 'auto', alphaCutoff: 0.5, doubleSided: true };
  S.materials.push(m);
  return m;
}
function uniqueMatName(base) {
  let n = base, i = 1;
  while (S.materials.some((m) => m.name === n)) n = `${base}.${String(i++).padStart(3, '0')}`;
  return n;
}
function threeTexFor(imgId, filter, wrap) {
  const img = S.images.get(imgId);
  if (!img) return null;
  // Sampler state belongs to a material, not to the shared source image.
  const near = filter === 'nearest', extend = wrap === 'extend';
  const key = `${near}:${extend}`;
  if (!img.textures) img.textures = new Map();
  if (!img.textures.has(key)) {
    const tex = new THREE.Texture(img.el);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = extend ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.magFilter = near ? THREE.NearestFilter : THREE.LinearFilter;
    tex.minFilter = near ? THREE.NearestMipmapNearestFilter : THREE.LinearMipmapLinearFilter;
    tex.anisotropy = near ? 1 : 4;
    tex.needsUpdate = true;
    img.textures.set(key, tex);
  }
  return img.textures.get(key);
}
function threeMat(mat) {
  let e = threeMatCache.get(mat.id);
  if (!e) {
    const base = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
    e = { solid: new THREE.MeshStandardMaterial({ ...base }), pbr: new THREE.MeshStandardMaterial({ ...base }), unlit: new THREE.MeshBasicMaterial({ ...base }) };
    threeMatCache.set(mat.id, e);
  }
  const xray = S.xray;
  const tex = mat.texture && mat.useTexture !== false ? threeTexFor(mat.texture, mat.filter, mat.wrap) : null;
  const base = tex && !mat.tint ? '#ffffff' : mat.color;
  e.solid.color.set(base);
  e.solid.roughness = 0.62; e.solid.metalness = 0;
  e.pbr.color.set(base); e.unlit.color.set(base); e.unlit.toneMapped = false;
  e.pbr.roughness = mat.roughness; e.pbr.metalness = mat.metalness;
  for (const m of [e.solid, e.pbr, e.unlit]) if (m.map !== tex) { m.map = tex; m.needsUpdate = true; }
  for (const m of [e.solid, e.pbr, e.unlit]) {
    const a = mat.alphaMode === 'opaque' ? 1 : mat.alpha;
    const transparent = xray || mat.alphaMode === 'blend' || (mat.alphaMode !== 'cutout' && mat.alphaMode !== 'opaque' && a < 1);
    const cutoff = mat.alphaMode === 'cutout' ? (mat.alphaCutoff ?? 0.5) : 0;
    if (m.alphaTest !== cutoff) { m.alphaTest = cutoff; m.needsUpdate = true; }
    const side = mat.doubleSided !== false ? THREE.DoubleSide : THREE.FrontSide;
    if (m.side !== side) { m.side = side; m.needsUpdate = true; }
    if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; }
    m.opacity = xray ? 0.32 * a : a;
    m.depthWrite = !transparent;
  }
  return e;
}
function objMaterials(o) {
  if (S.faceOrient) return faceOrientMat;
  const slots = o.materials.length ? o.materials : [0];
  return slots.map((id) => {
    const mat = matById(id) || DEFAULT_MAT;
    const e = threeMat(mat);
    return mat.shader === 'unlit' ? e.unlit : S.shading === 'material' || S.shading === 'rendered' ? e.pbr : e.solid;
  });
}
function refreshMaterials() {
  for (const o of S.objects) o.meshNode.material = objMaterials(o);
  requestRender();
}

// ---------- objects ----------
function uniqueObjName(base) {
  let n = base, i = 1;
  while (S.objects.some((o) => o.name === n)) n = `${base}.${String(i++).padStart(3, '0')}`;
  return n;
}
function createObject(name, mesh, { pos, quat, scl, materials, id, keepName, modifiers } = {}) {
  const o = { id: id || _nid++, name: keepName ? name : uniqueObjName(name), mesh, modifiers: normalizeModifiers(modifiers), materials: materials ? materials.slice() : [], visible: true, selected: false, esel: emptySel(), activeFace: -1 };
  if (id && id >= _nid) _nid = id + 1;
  o.node = new THREE.Group();
  o.node.userData.obj = o;
  if (pos) o.node.position.fromArray(pos);
  if (quat) o.node.quaternion.fromArray(quat);
  if (scl) o.node.scale.fromArray(scl);
  o.meshNode = new THREE.Mesh(new THREE.BufferGeometry(), []);
  o.meshNode.userData.obj = o;
  o.meshNode.castShadow = true; o.meshNode.receiveShadow = true;
  o.node.add(o.meshNode);
  scene.add(o.node);
  S.objects.push(o);
  rebuildObject(o);
  return o;
}
function disposeObject(o) {
  scene.remove(o.node);
  o.meshNode.geometry.dispose();
  for (const k of ['edgeOv', 'vertOv', 'fdotOv', 'fselOv']) if (o[k]) { o[k].geometry.dispose(); }
}
function removeObject(o) {
  disposeObject(o);
  S.objects.splice(S.objects.indexOf(o), 1);
  if (S.active === o) S.active = S.objects.find((x) => x.selected) || null;
}

// ---------- render data ----------
function rebuildObject(o) {
  let m = o.mesh;
  if (!(S.mode === 'edit' && o === S.active)) {
    try { m = evaluateModifiers(o.mesh, o.modifiers); o.modifierError = null; }
    catch (e) {
      // Edits can increase the control mesh beyond the preview budget. Keep it editable.
      if (o.modifierError !== e.message) toast(o.name + ': ' + e.message, true);
      o.modifierError = e.message;
    }
  }
  o.renderMesh = m;
  const nSlots = Math.max(1, o.materials.length);
  const lists = Array.from({ length: nSlots }, () => []);
  for (let fi = 0; fi < m.faces.length; fi++) {
    const f = m.faces[fi];
    const slot = f.mat >= 0 && f.mat < nSlots ? f.mat : 0;
    const L = lists[slot];
    for (const t of triangulateFace(m, f)) L.push(fi, t[0], t[1], t[2]);
  }
  let nTri = 0;
  for (const L of lists) nTri += L.length / 4;
  const cornerV = new Int32Array(nTri * 3), cornerF = new Int32Array(nTri * 3), cornerC = new Int32Array(nTri * 3), triFace = new Int32Array(nTri);
  const geo = new THREE.BufferGeometry();
  let t = 0;
  lists.forEach((L, slot) => {
    const start = t * 3;
    for (let i = 0; i < L.length; i += 4) {
      const fi = L[i], f = m.faces[fi];
      triFace[t] = fi;
      for (let k = 0; k < 3; k++) { const c = L[i + 1 + k]; cornerV[t * 3 + k] = f.v[c]; cornerF[t * 3 + k] = fi; cornerC[t * 3 + k] = c; }
      t++;
    }
    if (t * 3 > start) geo.addGroup(start, t * 3 - start, slot);
  });
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nTri * 9), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nTri * 9), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nTri * 6), 2));
  o.meshNode.geometry.dispose();
  o.meshNode.geometry = geo;
  o.rd = { cornerV, cornerF, cornerC, triFace };
  updateGeomPositions(o, true);
  updateGeomUVs(o, true);
  o.meshNode.material = objMaterials(o);
  o.node.visible = o.visible;
  refreshOverlays(o);
  requestRender();
}
function updateGeomPositions(o, skipOverlays) {
  if (!skipOverlays && S.mode !== 'edit' && o.modifiers.some((m) => m.enabled && m.levels)) { rebuildObject(o); return; }
  const m = o.renderMesh || o.mesh, P = m.verts, { cornerV, cornerF } = o.rd, geo = o.meshNode.geometry;
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
  for (let i = 0; i < cornerV.length; i++) { const p = P[cornerV[i]]; pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; }
  if (m.smooth) {
    const VN = vertexNormals(m);
    for (let i = 0; i < cornerV.length; i++) { const n = VN[cornerV[i]]; nor[i * 3] = n[0]; nor[i * 3 + 1] = n[1]; nor[i * 3 + 2] = n[2]; }
  } else {
    const FN = m.faces.map((f) => faceNormal(m, f));
    for (let i = 0; i < cornerV.length; i++) { const n = FN[cornerF[i]]; nor[i * 3] = n[0]; nor[i * 3 + 1] = n[1]; nor[i * 3 + 2] = n[2]; }
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.needsUpdate = true;
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  if (!skipOverlays) refreshOverlays(o);
  requestRender();
}
function updateGeomUVs(o, fromRebuild = false) {
  if (!fromRebuild && S.mode !== 'edit' && o.modifiers.some((m) => m.enabled && m.levels)) { rebuildObject(o); return; }
  const m = o.renderMesh || o.mesh, { cornerF, cornerC } = o.rd, geo = o.meshNode.geometry;
  const uv = geo.attributes.uv.array;
  for (let i = 0; i < cornerF.length; i++) { const u = m.faces[cornerF[i]].uv[cornerC[i]] || [0, 0]; uv[i * 2] = u[0]; uv[i * 2 + 1] = u[1]; }
  geo.attributes.uv.needsUpdate = true;
  requestRender();
}

// ---------- overlays ----------
const COL = {
  sel: [1, 0.616, 0.227], active: [1, 1, 1], dark: [0.04, 0.045, 0.055], wire: [0.62, 0.65, 0.71], seam: [1, 0.22, 0.25],
  objSel: [0.93, 0.5, 0.12], objAct: [1, 0.72, 0.33], fdot: [0.06, 0.06, 0.07],
};
function setLineGeo(o, key, positions, colors, mat) {
  if (!positions.length) { if (o[key]) o[key].visible = false; return; }
  if (!o[key]) {
    o[key] = new LineSegments2(new LineSegmentsGeometry(), mat);
    o[key].frustumCulled = false;
    o[key].renderOrder = 2;
    o.node.add(o[key]);
  }
  const ov = o[key];
  ov.geometry.dispose();
  ov.geometry = new LineSegmentsGeometry();
  ov.geometry.setPositions(positions);
  ov.geometry.setColors(colors);
  ov.material = mat;
  ov.visible = true;
}
function setPointsGeo(o, key, positions, colors, size, onTop) {
  if (!positions.length) { if (o[key]) o[key].visible = false; return; }
  if (!o[key]) {
    o[key] = new THREE.Points(new THREE.BufferGeometry(), pointMaterial(size * DPR()));
    o[key].frustumCulled = false; o[key].renderOrder = 3;
    o.node.add(o[key]);
  }
  const ov = o[key];
  ov.material.uniforms.size.value = size * DPR();
  ov.material.depthTest = !onTop;
  ov.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  ov.geometry.setAttribute('vcol', new THREE.BufferAttribute(new Float32Array(colors), 3));
  ov.geometry.computeBoundingSphere();
  ov.visible = true;
}
function refreshOverlays(o) {
  const m = o.renderMesh || o.mesh, P = m.verts;
  const editing = S.mode === 'edit' && o === S.active;
  const wire = S.shading === 'wire';
  const seeThrough = S.xray || wire;
  const T = topo(m);
  o.meshNode.visible = !wire;
  if (o.fselOv) o.fselOv.visible = false;
  // edges
  const showEdges = editing || wire || o.selected;
  if (showEdges && T.edges.length) {
    const pos = new Float32Array(T.edges.length * 6), col = new Float32Array(T.edges.length * 6);
    const s = o.esel;
    let base = wire && !o.selected ? COL.wire : o === S.active ? COL.objAct : COL.objSel;
    if (editing) base = seeThrough ? COL.wire : COL.dark;
    T.edges.forEach(([a, b], i) => {
      const pa = P[a], pb = P[b];
      pos.set(pa, i * 6); pos.set(pb, i * 6 + 3);
      let c = base;
      if (editing) {
        const k = a + '_' + b;
        if (S.selectMode === 'vert') {
          const sa = s.verts.has(a), sb = s.verts.has(b);
          if (sa && sb) c = COL.sel;
          else if (m.seams.has(k)) c = COL.seam;
          if ((sa || sb) && !(sa && sb)) {
            col.set(sa ? COL.sel : c, i * 6); col.set(sb ? COL.sel : c, i * 6 + 3);
            return;
          }
        } else if (s.edges.has(k)) c = COL.sel;
        else if (m.seams.has(k)) c = COL.seam;
      }
      col.set(c, i * 6); col.set(c, i * 6 + 3);
    });
    const mat = editing ? (seeThrough ? LM.editX : LM.edit) : wire ? (S.xray ? LM.wireX : LM.wire) : LM.outline;
    setLineGeo(o, 'edgeOv', pos, col, mat);
  } else if (o.edgeOv) o.edgeOv.visible = false;
  // vertices
  const T2 = T;
  if (editing && (S.selectMode === 'vert' || T2.edges.length === 0)) {
    const pos = new Float32Array(P.length * 3), col = new Float32Array(P.length * 3);
    for (let i = 0; i < P.length; i++) {
      pos.set(P[i], i * 3);
      col.set(o.esel.verts.has(i) ? COL.sel : seeThrough ? COL.wire : COL.dark, i * 3);
    }
    setPointsGeo(o, 'vertOv', pos, col, 7, seeThrough);
  } else if (o.vertOv) o.vertOv.visible = false;
  // face dots
  if (editing && S.selectMode === 'face' && seeThrough) {
    const pos = new Float32Array(m.faces.length * 3), col = new Float32Array(m.faces.length * 3);
    m.faces.forEach((f, i) => { pos.set(faceCenter(m, f), i * 3); col.set(o.esel.faces.has(i) ? (i === o.activeFace ? COL.active : COL.sel) : COL.wire, i * 3); });
    setPointsGeo(o, 'fdotOv', pos, col, 6, true);
  } else if (o.fdotOv) o.fdotOv.visible = false;
  // selected face tint
  if (editing && o.esel.faces.size) {
    const tris = [];
    for (const fi of o.esel.faces) {
      const f = m.faces[fi];
      if (!f) continue;
      for (const t of triangulateFace(m, f)) for (const c of t) tris.push(...P[f.v[c]]);
    }
    if (!o.fselOv) {
      o.fselOv = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xff9d3a, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      o.fselOv.renderOrder = 1;
      o.node.add(o.fselOv);
    }
    o.fselOv.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
    o.fselOv.geometry.computeBoundingSphere();
    o.fselOv.material.depthTest = !seeThrough;
    o.fselOv.visible = true;
  }
  requestRender();
}
function refreshOriginDots() {
  const pts = [], cols = [];
  for (const o of S.objects) if (o.selected && o.visible && S.mode === 'object') { pts.push(o.node.position.x, o.node.position.y, o.node.position.z); cols.push(...(o === S.active ? COL.objAct : COL.objSel)); }
  originPts.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  originPts.geometry.setAttribute('vcol', new THREE.Float32BufferAttribute(cols, 3));
  originPts.visible = pts.length > 0;
  cursorPts.position.copy(S.cursor);
  requestRender();
}
function refreshAllObjects() {
  for (const o of S.objects) { o.node.visible = o.visible; o.meshNode.material = objMaterials(o); refreshOverlays(o); }
  refreshOriginDots();
}

// ---------- camera ----------
const CAM = { target: new THREE.Vector3(0, 0, 0), yaw: -0.756, pitch: 0.456, dist: 11.3, ortho: false, autoOrtho: false, fov: 50, anim: null };
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m4 = new THREE.Matrix4();
function camBasis() {
  const cy = Math.cos(CAM.yaw), sy = Math.sin(CAM.yaw), cp = Math.cos(CAM.pitch), sp = Math.sin(CAM.pitch);
  const z = new THREE.Vector3(cp * cy, cp * sy, sp);
  const x = new THREE.Vector3(-sy, cy, 0);
  const y = new THREE.Vector3().crossVectors(z, x);
  return { x, y, z };
}
function viewSize() { return { w: c3d.clientWidth || 1, h: c3d.clientHeight || 1 }; }
function applyCamera() {
  const { x, y, z } = camBasis();
  const { w, h } = viewSize();
  const pos = CAM.target.clone().addScaledVector(z, CAM.dist);
  _m4.makeBasis(x, y, z);
  for (const c of [persp, ortho]) { c.position.copy(pos); c.quaternion.setFromRotationMatrix(_m4); }
  persp.fov = CAM.fov; persp.aspect = w / h;
  persp.near = clamp(CAM.dist * 0.002, 0.0005, 1); persp.far = CAM.dist * 100 + 2000;
  persp.updateProjectionMatrix();
  const hh = CAM.dist * Math.tan((CAM.fov * DEG) / 2);
  ortho.left = -hh * (w / h); ortho.right = hh * (w / h); ortho.top = hh; ortho.bottom = -hh;
  ortho.near = -CAM.dist * 50 - 2000; ortho.far = CAM.dist * 50 + 2000;
  ortho.updateProjectionMatrix();
  camera = CAM.ortho ? ortho : persp;
  tc.camera = camera;
  camera.updateMatrixWorld();
  requestRender();
}
function orbit(dx, dy) {
  CAM.anim = null;
  CAM.yaw -= dx * 0.0085;
  CAM.pitch = clamp(CAM.pitch + dy * 0.0085, -Math.PI / 2, Math.PI / 2);
  if (CAM.autoOrtho) { CAM.ortho = false; CAM.autoOrtho = false; updateViewButtons?.(); }
  applyCamera();
}
function pan(dx, dy) {
  CAM.anim = null;
  const { h } = viewSize();
  const s = (2 * CAM.dist * Math.tan((CAM.fov * DEG) / 2)) / h;
  const { x, y } = camBasis();
  CAM.target.addScaledVector(x, -dx * s).addScaledVector(y, dy * s);
  applyCamera();
}
function zoom(f) { CAM.anim = null; CAM.dist = clamp(CAM.dist * f, 0.01, 20000); applyCamera(); }
function animateCam(to, ms = 220) {
  const from = { yaw: CAM.yaw, pitch: CAM.pitch, dist: CAM.dist, target: CAM.target.clone() };
  if (to.yaw !== undefined) {
    let d = to.yaw - from.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); to.yaw = from.yaw + d;
  }
  const t0 = performance.now();
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  CAM.anim = (now) => {
    let t = reduce ? 1 : clamp((now - t0) / ms, 0, 1);
    const e = 1 - Math.pow(1 - t, 3);
    if (to.yaw !== undefined) CAM.yaw = from.yaw + (to.yaw - from.yaw) * e;
    if (to.pitch !== undefined) CAM.pitch = from.pitch + (to.pitch - from.pitch) * e;
    if (to.dist !== undefined) CAM.dist = from.dist + (to.dist - from.dist) * e;
    if (to.target) CAM.target.lerpVectors(from.target, to.target, e);
    applyCamera();
    if (t >= 1) CAM.anim = null;
  };
}
const VIEWS = {
  front: { yaw: -Math.PI / 2, pitch: 0 }, back: { yaw: Math.PI / 2, pitch: 0 },
  right: { yaw: 0, pitch: 0 }, left: { yaw: Math.PI, pitch: 0 },
  top: { yaw: -Math.PI / 2, pitch: Math.PI / 2 }, bottom: { yaw: -Math.PI / 2, pitch: -Math.PI / 2 },
};
function setView(name) {
  const v = VIEWS[name];
  if (!v) return;
  if (!CAM.ortho || CAM.autoOrtho) { CAM.ortho = true; CAM.autoOrtho = true; }
  animateCam({ ...v });
  updateViewButtons?.();
}
function toggleOrtho() { CAM.ortho = !CAM.ortho; CAM.autoOrtho = false; applyCamera(); updateViewButtons?.(); }
function frameBox(box) {
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.05);
  const { w, h } = viewSize();
  const fov = Math.min(CAM.fov, (2 * Math.atan(Math.tan((CAM.fov * DEG) / 2) * (w / h))) / DEG) * DEG;
  animateCam({ target: c, dist: (r / Math.sin(fov / 2)) * 1.08 });
}
function frameSelected() {
  const box = new THREE.Box3();
  if (S.mode === 'edit' && S.active && S.active.esel.verts.size) {
    const mw = S.active.node.matrixWorld;
    for (const v of S.active.esel.verts) box.expandByPoint(_v1.fromArray(S.active.mesh.verts[v]).applyMatrix4(mw));
  } else {
    const objs = S.objects.filter((o) => o.selected && o.visible);
    for (const o of objs.length ? objs : S.objects.filter((o) => o.visible)) { o.node.updateMatrixWorld(); o.meshNode.geometry.computeBoundingBox(); const b = o.meshNode.geometry.boundingBox.clone().applyMatrix4(o.node.matrixWorld); box.union(b); if (!o.mesh.verts.length) box.expandByPoint(o.node.position); }
  }
  if (box.isEmpty()) box.expandByPoint(S.cursor).expandByScalar(2);
  frameBox(box);
}

// ---------- projection & picking ----------
function toScreen(v /* world Vector3 */) {
  const p = _v2.copy(v).project(camera);
  const { w, h } = viewSize();
  return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, z: p.z };
}
function screenRay(x, y) {
  const { w, h } = viewSize();
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), camera);
  return rc;
}
function projectMeshVerts(o) {
  o.node.updateMatrixWorld();
  const mw = o.node.matrixWorld, P = o.mesh.verts;
  const { w, h } = viewSize();
  const out = new Float32Array(P.length * 4); // x, y, ndcZ, inFront
  const pm = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mw);
  const e = pm.elements;
  for (let i = 0; i < P.length; i++) {
    const [x, y, z] = P[i];
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    const cx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw;
    const cy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw;
    const cz = (e[2] * x + e[6] * y + e[10] * z + e[14]) / cw;
    out[i * 4] = (cx * 0.5 + 0.5) * w; out[i * 4 + 1] = (-cy * 0.5 + 0.5) * h; out[i * 4 + 2] = cz; out[i * 4 + 3] = cw > 0 && cz > -1 && cz < 1 ? 1 : 0;
  }
  return out;
}
// is a local-space point on object o visible (not hidden behind the object's own surface)?
function pointVisible(o, local) {
  if (S.xray || S.shading === 'wire') return true;
  const wp = _v1.fromArray(local).applyMatrix4(o.node.matrixWorld).clone();
  const camPos = camera.position.clone();
  let dir, origin, dist;
  if (camera.isOrthographicCamera) {
    dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    origin = wp.clone().addScaledVector(dir, -1000);
    dist = 1000;
  } else {
    dir = wp.clone().sub(camPos); dist = dir.length(); dir.normalize(); origin = camPos;
  }
  const rc = new THREE.Raycaster(origin, dir, 0, dist * 1.01);
  const hits = rc.intersectObject(o.meshNode, false);
  if (!hits.length) return true;
  return hits[0].distance >= dist - Math.max(1e-4, dist * 0.004);
}
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return { d: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t };
}
function pickElement(x, y, radius = 26) {
  const o = S.active, m = o.mesh;
  const SP = projectMeshVerts(o);
  if (S.selectMode === 'vert') {
    const c = [];
    for (let i = 0; i < m.verts.length; i++) { if (!SP[i * 4 + 3]) continue; const d = Math.hypot(SP[i * 4] - x, SP[i * 4 + 1] - y); if (d <= radius) c.push([d, i]); }
    c.sort((a, b) => a[0] - b[0]);
    for (const [, i] of c.slice(0, 12)) if (pointVisible(o, m.verts[i])) return { type: 'vert', i };
    return null;
  }
  if (S.selectMode === 'edge') {
    const T = topo(m), c = [];
    T.edges.forEach(([a, b], i) => {
      if (!SP[a * 4 + 3] || !SP[b * 4 + 3]) return;
      const r = distToSeg(x, y, SP[a * 4], SP[a * 4 + 1], SP[b * 4], SP[b * 4 + 1]);
      if (r.d <= radius) c.push([r.d, i, r.t]);
    });
    c.sort((p, q) => p[0] - q[0]);
    for (const [, i, t] of c.slice(0, 12)) {
      const [a, b] = T.edges[i];
      const p = vlerp(m.verts[a], m.verts[b], clamp(t, 0.1, 0.9));
      if (pointVisible(o, p)) return { type: 'edge', key: ekey(a, b), a, b };
    }
    return null;
  }
  // face
  if (S.xray || S.shading === 'wire') {
    let best = null;
    m.faces.forEach((f, i) => {
      const c = _v1.fromArray(faceCenter(m, f)).applyMatrix4(o.node.matrixWorld);
      const s = toScreen(c);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= radius * 1.4 && (!best || d < best.d)) best = { d, i };
    });
    return best ? { type: 'face', i: best.i } : null;
  }
  const hits = screenRay(x, y).intersectObject(o.meshNode, false);
  if (hits.length) return { type: 'face', i: o.rd.triFace[hits[0].faceIndex] };
  return null;
}
function pickObject(x, y) {
  const vis = S.objects.filter((o) => o.visible);
  if (S.shading !== 'wire') {
    const hits = screenRay(x, y).intersectObjects(vis.map((o) => o.meshNode), false);
    if (hits.length) return hits[0].object.userData.obj;
  }
  // wire objects / no faces: nearest edge on screen
  let best = null;
  for (const o of vis) {
    const T = topo(o.mesh), SP = projectMeshVerts(o);
    for (const [a, b] of T.edges) {
      if (!SP[a * 4 + 3] || !SP[b * 4 + 3]) continue;
      const r = distToSeg(x, y, SP[a * 4], SP[a * 4 + 1], SP[b * 4], SP[b * 4 + 1]);
      if (r.d < 22 && (!best || r.d < best.d)) best = { d: r.d, o };
    }
    if (!o.mesh.verts.length) { const s = toScreen(o.node.position); const d = Math.hypot(s.x - x, s.y - y); if (d < 22 && (!best || d < best.d)) best = { d, o }; }
  }
  return best ? best.o : null;
}

// ---------- selection ----------
function flushSel(o = S.active) {
  if (!o) return;
  const m = o.mesh, T = topo(m), s = o.esel;
  const nv = m.verts.length, nf = m.faces.length;
  for (const v of [...s.verts]) if (v >= nv) s.verts.delete(v);
  for (const f of [...s.faces]) if (f >= nf) s.faces.delete(f);
  for (const k of [...s.edges]) if (!T.edgeIndex.has(k)) s.edges.delete(k);
  if (S.selectMode === 'vert') {
    s.edges = new Set();
    for (const [a, b] of T.edges) if (s.verts.has(a) && s.verts.has(b)) s.edges.add(a + '_' + b);
    s.faces = new Set();
    m.faces.forEach((f, i) => { if (f.v.every((v) => s.verts.has(v))) s.faces.add(i); });
  } else if (S.selectMode === 'edge') {
    s.verts = new Set();
    for (const k of s.edges) { const [a, b] = ekeySplit(k); s.verts.add(a); s.verts.add(b); }
    s.faces = new Set();
    m.faces.forEach((f, i) => {
      for (let j = 0; j < f.v.length; j++) if (!s.edges.has(ekey(f.v[j], f.v[(j + 1) % f.v.length]))) return;
      s.faces.add(i);
    });
  } else {
    s.verts = new Set(); s.edges = new Set();
    for (const fi of s.faces) { const f = m.faces[fi]; for (let j = 0; j < f.v.length; j++) { s.verts.add(f.v[j]); s.edges.add(ekey(f.v[j], f.v[(j + 1) % f.v.length])); } }
  }
  if (!s.faces.has(o.activeFace)) o.activeFace = s.faces.size ? [...s.faces][s.faces.size - 1] : -1;
}
function setSelVerts(vs, o = S.active) {
  const m = o.mesh, T = topo(m), s = o.esel;
  s.verts = new Set(vs);
  s.edges = new Set(); for (const [a, b] of T.edges) if (s.verts.has(a) && s.verts.has(b)) s.edges.add(a + '_' + b);
  s.faces = new Set(); m.faces.forEach((f, i) => { if (f.v.every((v) => s.verts.has(v))) s.faces.add(i); });
  flushSel(o);
}
function setSelFaces(fs, o = S.active) {
  const m = o.mesh, s = o.esel;
  s.faces = new Set(fs); s.verts = new Set(); s.edges = new Set();
  for (const fi of s.faces) { const f = m.faces[fi]; if (!f) continue; for (let j = 0; j < f.v.length; j++) { s.verts.add(f.v[j]); s.edges.add(ekey(f.v[j], f.v[(j + 1) % f.v.length])); } }
  flushSel(o);
}
function setSelEdges(es, o = S.active) {
  const s = o.esel;
  s.edges = new Set(es); s.verts = new Set();
  for (const k of s.edges) { const [a, b] = ekeySplit(k); s.verts.add(a); s.verts.add(b); }
  const m = o.mesh;
  s.faces = new Set(); m.faces.forEach((f, i) => { for (let j = 0; j < f.v.length; j++) if (!s.edges.has(ekey(f.v[j], f.v[(j + 1) % f.v.length]))) return; s.faces.add(i); });
  flushSel(o);
}
function setSelectMode(mode) {
  if (S.selectMode === mode) return;
  S.selectMode = mode;
  if (S.active) flushSel();
  onSelectionChanged();
}
function editSelectAll(action = 'select') {
  const o = S.active, m = o.mesh, s = o.esel, T = topo(m);
  if (action === 'select') { setSelVerts(new Set(m.verts.keys())); if (S.selectMode === 'face') setSelFaces(new Set(m.faces.keys())); }
  else if (action === 'none') { o.esel = emptySel(); }
  else if (action === 'invert') {
    if (S.selectMode === 'vert') { const n = new Set(); for (let i = 0; i < m.verts.length; i++) if (!s.verts.has(i)) n.add(i); s.verts = n; }
    else if (S.selectMode === 'edge') { const n = new Set(); for (const [a, b] of T.edges) { const k = a + '_' + b; if (!s.edges.has(k)) n.add(k); } s.edges = n; }
    else { const n = new Set(); for (let i = 0; i < m.faces.length; i++) if (!s.faces.has(i)) n.add(i); s.faces = n; }
    flushSel();
  }
  onSelectionChanged();
}
function toggleInSel(el, op) {
  const o = S.active, s = o.esel;
  const apply = (set, k) => {
    if (op === 'set') { set.clear(); set.add(k); }
    else if (op === 'sub') set.delete(k);
    else if (set.has(k)) set.delete(k); else set.add(k);
  };
  if (op === 'set') o.esel = emptySel();
  const s2 = o.esel;
  if (el.type === 'vert') apply(s2.verts, el.i);
  else if (el.type === 'edge') apply(s2.edges, el.key);
  else { apply(s2.faces, el.i); if (s2.faces.has(el.i)) o.activeFace = el.i; }
  flushSel();
}
function selectObject(o, op = 'set') {
  if (op === 'set') for (const x of S.objects) x.selected = false;
  if (!o) { if (op === 'set') S.active = S.active; onSelectionChanged(); return; }
  if (op === 'sub') { o.selected = false; if (S.active === o) S.active = S.objects.find((x) => x.selected) || o; }
  else if (op === 'add' && o.selected && S.active === o) { o.selected = false; }
  else { o.selected = true; S.active = o; }
  onSelectionChanged();
}
function selectedObjects() { return S.objects.filter((o) => o.selected && o.visible); }

// hooks filled in by UI
let onSelectionChanged = () => {};
let updateViewButtons = () => {};

// ---------- undo ----------
const UNDO = { stack: [], idx: -1, max: 60 };
function snapshot() {
  return {
    objects: S.objects.map((o) => ({
      id: o.id, name: o.name, mesh: cloneMesh(o.mesh), pos: o.node.position.toArray(), quat: o.node.quaternion.toArray(), scl: o.node.scale.toArray(),
      modifiers: normalizeModifiers(o.modifiers), materials: o.materials.slice(), visible: o.visible, selected: o.selected,
      esel: { verts: new Set(o.esel.verts), edges: new Set(o.esel.edges), faces: new Set(o.esel.faces) }, activeFace: o.activeFace,
    })),
    materials: S.materials.map((m) => ({ ...m })),
    active: S.active ? S.active.id : null, mode: S.mode, selectMode: S.selectMode,
    cursor: S.cursor.toArray(), uvSel: new Set(S.uvSel),
  };
}
function restore(snap) {
  const keep = new Map(S.objects.map((o) => [o.id, o]));
  const next = [];
  for (const so of snap.objects) {
    let o = keep.get(so.id);
    if (o) {
      keep.delete(so.id);
      o.name = so.name; o.mesh = cloneMesh(so.mesh); o.materials = so.materials.slice();
      o.node.position.fromArray(so.pos); o.node.quaternion.fromArray(so.quat); o.node.scale.fromArray(so.scl);
    } else {
      o = createObject(so.name, cloneMesh(so.mesh), { pos: so.pos, quat: so.quat, scl: so.scl, materials: so.materials, id: so.id, keepName: true });
      S.objects.pop();
    }
    o.modifiers = normalizeModifiers(so.modifiers);
    o.visible = so.visible; o.selected = so.selected; o.activeFace = so.activeFace;
    o.esel = { verts: new Set(so.esel.verts), edges: new Set(so.esel.edges), faces: new Set(so.esel.faces) };
    next.push(o);
  }
  for (const o of keep.values()) disposeObject(o);
  S.objects = next;
  S.materials = snap.materials.map((m) => ({ ...m }));
  S.active = S.objects.find((o) => o.id === snap.active) || null;
  S.mode = snap.mode === 'edit' && S.active ? 'edit' : 'object';
  S.selectMode = snap.selectMode;
  S.cursor.fromArray(snap.cursor);
  S.uvSel = new Set(snap.uvSel);
  for (const o of S.objects) rebuildObject(o);
  refreshOriginDots();
  afterRestore();
}
let afterRestore = () => {};
let onHistoryChanged = () => {};
function pushUndo(label) {
  UNDO.stack.length = UNDO.idx + 1;
  UNDO.stack.push({ label, snap: snapshot() });
  if (UNDO.stack.length > UNDO.max) UNDO.stack.shift();
  UNDO.idx = UNDO.stack.length - 1;
  onHistoryChanged();
}
function undo() {
  if (UNDO.idx <= 0) return false;
  const lbl = UNDO.stack[UNDO.idx].label;
  UNDO.idx--;
  restore(UNDO.stack[UNDO.idx].snap);
  onHistoryChanged(); toast('Undo · ' + lbl);
  return true;
}
function redo() {
  if (UNDO.idx >= UNDO.stack.length - 1) return false;
  UNDO.idx++;
  restore(UNDO.stack[UNDO.idx].snap);
  onHistoryChanged(); toast('Redo · ' + UNDO.stack[UNDO.idx].label);
  return true;
}

// ---------- toast / hint ----------
let _toastT = 0;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('err', !!err); t.hidden = false;
  clearTimeout(_toastT);
  _toastT = setTimeout(() => { t.hidden = true; }, err ? 3200 : 1800);
}
function hint(msg) { const e = $('#hint'); if (msg) { e.textContent = msg; e.hidden = false; } else e.hidden = true; }

// ---------- render loop ----------
let _lastW = 0, _lastH = 0;
function resize() {
  const w = c3d.clientWidth, hgt = c3d.clientHeight;
  if (!w || !hgt) return;
  if (w !== _lastW || hgt !== _lastH) {
    _lastW = w; _lastH = hgt;
    renderer.setSize(w, hgt, false);
    for (const m of lineMats) m.resolution.set(w, hgt);
    applyCamera();
  }
}
function applyShadingEnv() {
  const pbr = S.shading === 'material' || S.shading === 'rendered';
  scene.environment = pbr ? getEnv() : null;
  renderer.toneMapping = pbr ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  hemi.intensity = pbr ? 0.35 : 1.5;
  headP.intensity = headO.intensity = pbr ? 0.5 : 1.5;
  sun.visible = S.shading === 'rendered';
  shadowFloor.visible = S.shading === 'rendered';
  gridGroup.visible = S.shading !== 'rendered';
  for (const m of [...threeMatCache.values()]) { m.solid.needsUpdate = true; m.pbr.needsUpdate = true; m.unlit.needsUpdate = true; }
}
let drawNav = () => {};
function frame(now) {
  requestAnimationFrame(frame);
  if (CAM.anim) CAM.anim(now);
  if ($('#pane3d').offsetParent === null) return;
  resize();
  if (!dirty) return;
  dirty = false;
  renderer.render(scene, camera);
  drawNav();
}
