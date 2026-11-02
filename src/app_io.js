// ============================================================================
// app_io.js — images/textures, project files, autosave (IndexedDB), import/export,
// iOS share sheet / download
// ============================================================================

// ---------- bytes helpers ----------
function b64FromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function bytesFromB64(b64) { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
function canvasBytes(canvas, mime, q) {
  // synchronous: dataURL -> bytes (keeps export/share inside the tap gesture)
  const url = canvas.toDataURL(mime, q);
  return bytesFromB64(url.slice(url.indexOf(',') + 1));
}
function safeFileName(s, fallback = 'model') { const n = String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_'); return n || fallback; }

// ---------- images ----------
function addImageFromCanvas(name, canvas, mime = 'image/png', id) {
  const bytes = canvasBytes(canvas, mime, 0.9);
  const img = { id: id || _imgNid++, name, mime, bytes, el: canvas, width: canvas.width, height: canvas.height, tex: null };
  if (img.id >= _imgNid) _imgNid = img.id + 1;
  S.images.set(img.id, img);
  return img;
}
function uniqueImageName(base, ext) {
  base = safeFileName(base.replace(/\.[a-z0-9]+$/i, ''), 'texture');
  let n = base + ext, i = 1;
  const used = new Set([...S.images.values()].map((x) => x.name));
  while (used.has(n)) n = `${base}_${i++}${ext}`;
  return n;
}
async function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This image format could not be read')); i.src = url; });
    const max = 2048;
    const sc = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.naturalWidth * sc)); c.height = Math.max(1, Math.round(im.naturalHeight * sc));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    const photo = /jpe?g|heic|heif/i.test(file.type) || /\.(jpe?g|heic|heif)$/i.test(file.name);
    const mime = photo ? 'image/jpeg' : 'image/png';
    return addImageFromCanvas(uniqueImageName(file.name || 'texture', photo ? '.jpg' : '.png'), c, mime);
  } finally { URL.revokeObjectURL(url); }
}
function generateTexture(kind, size = 1024) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const n = 8, cell = size / n;
  if (kind === 'checker') {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = (i + j) % 2 ? '#2b2f38' : '#d9dce3'; x.fillRect(i * cell, j * cell, cell, cell); }
  } else if (kind === 'color') {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const hue = ((i * n + j) * 360) / (n * n);
      x.fillStyle = `hsl(${hue}, 70%, ${(i + j) % 2 ? 46 : 62}%)`; x.fillRect(i * cell, j * cell, cell, cell);
    }
    x.strokeStyle = '#ffffffaa'; x.lineWidth = 2;
    for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * cell, 0); x.lineTo(i * cell, size); x.moveTo(0, i * cell); x.lineTo(size, i * cell); x.stroke(); }
  } else {
    // UV grid: checker with cell labels so stretching and flipping are obvious
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = (i + j) % 2 ? '#3a3f4b' : '#c7cbd3'; x.fillRect(i * cell, j * cell, cell, cell); }
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `600 ${Math.round(cell * 0.32)}px -apple-system, system-ui, sans-serif`;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      x.fillStyle = (i + j) % 2 ? '#e8eaee' : '#2a2e37';
      x.fillText(String.fromCharCode(65 + i) + (n - j), i * cell + cell / 2, j * cell + cell / 2);
    }
    x.strokeStyle = '#ff9d3a'; x.lineWidth = Math.max(2, size / 256);
    x.strokeRect(1, 1, size - 2, size - 2);
  }
  const names = { checker: 'Checker', color: 'ColorGrid', uvgrid: 'UVGrid' };
  return addImageFromCanvas(uniqueImageName(names[kind] || 'Texture', '.png'), c, 'image/png');
}
async function imageFromBytes(id, name, mime, bytes) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0);
    const img = { id, name, mime, bytes, el: c, width: c.width, height: c.height, tex: null };
    S.images.set(id, img);
    if (id >= _imgNid) _imgNid = id + 1;
    return img;
  } finally { URL.revokeObjectURL(url); }
}
function pruneImages() {
  const used = new Set(S.materials.map((m) => m.texture).filter(Boolean));
  for (const s of UNDO.stack) for (const m of s.snap.materials) if (m.texture) used.add(m.texture);
  for (const id of [...S.images.keys()]) if (!used.has(id)) { const im = S.images.get(id); if (im.tex) im.tex.dispose(); S.images.delete(id); }
}

// ---------- project (de)serialization ----------
function serializeProject() {
  const used = new Set(S.materials.map((m) => m.texture).filter(Boolean));
  return {
    app: 'PocketMesh', version: 1, saved: new Date().toISOString(),
    objects: S.objects.map((o) => ({
      id: o.id, name: o.name, pos: o.node.position.toArray(), quat: o.node.quaternion.toArray(), scl: o.node.scale.toArray(),
      materials: o.materials, visible: o.visible, selected: o.selected,
      mesh: { verts: o.mesh.verts, faces: o.mesh.faces, looseEdges: o.mesh.looseEdges, seams: [...o.mesh.seams], smooth: o.mesh.smooth },
    })),
    materials: S.materials,
    images: [...S.images.values()].filter((im) => used.has(im.id)).map((im) => ({ id: im.id, name: im.name, mime: im.mime, data: b64FromBytes(im.bytes) })),
    active: S.active ? S.active.id : null,
    cursor: S.cursor.toArray(),
    camera: { target: CAM.target.toArray(), yaw: CAM.yaw, pitch: CAM.pitch, dist: CAM.dist, ortho: CAM.ortho },
    settings: { shading: S.shading, selectMode: S.selectMode, pivot: S.pivot, orient: S.orient },
  };
}
async function loadProject(data) {
  if (!data || data.app !== 'PocketMesh' || !Array.isArray(data.objects)) throw new Error('This file is not a PocketMesh project');
  if (TF.active) tfCancel();
  if (PM.active) pmCancel();
  for (const o of [...S.objects]) disposeObject(o);
  S.objects = []; S.materials = []; S.images.clear();
  S.active = null; S.mode = 'object';
  for (const im of data.images || []) { try { await imageFromBytes(im.id, im.name, im.mime, bytesFromB64(im.data)); } catch (e) { console.warn('image failed', im.name, e); } }
  for (const m of data.materials || []) { S.materials.push({ roughness: 0.5, metalness: 0, alpha: 1, filter: 'linear', texture: null, useTexture: true, tint: false, wrap: 'repeat', ...m }); if (m.id >= _matNid) _matNid = m.id + 1; }
  for (const so of data.objects) {
    const mesh = { verts: so.mesh.verts || [], faces: (so.mesh.faces || []).map((f) => ({ v: f.v, uv: f.uv || f.v.map(() => [0, 0]), mat: f.mat | 0 })), looseEdges: so.mesh.looseEdges || [], seams: new Set(so.mesh.seams || []), smooth: !!so.mesh.smooth };
    const o = createObject(so.name, mesh, { pos: so.pos, quat: so.quat, scl: so.scl, materials: so.materials || [], id: so.id, keepName: true });
    o.visible = so.visible !== false; o.selected = !!so.selected;
  }
  S.active = S.objects.find((o) => o.id === data.active) || S.objects[0] || null;
  if (data.cursor) S.cursor.fromArray(data.cursor);
  if (data.camera) { CAM.target.fromArray(data.camera.target); CAM.yaw = data.camera.yaw; CAM.pitch = data.camera.pitch; CAM.dist = data.camera.dist; CAM.ortho = !!data.camera.ortho; CAM.autoOrtho = false; }
  if (data.settings) { S.shading = data.settings.shading || 'solid'; S.selectMode = data.settings.selectMode || 'vert'; S.pivot = data.settings.pivot || 'median'; S.orient = data.settings.orient || 'global'; }
  S.uvSel = new Set();
  applyShadingEnv();
  applyCamera();
  refreshAllObjects();
  UNDO.stack = []; UNDO.idx = -1;
  pushUndo('Open');
  LAST.op = null; hideRedoPanel();
  onModeChanged();
  onSelectionChanged();
}

// ---------- autosave (IndexedDB; installed home-screen apps keep this storage) ----------
const IDB = { db: null, name: 'pocketmesh', store: 'kv' };
function idbOpen() {
  if (IDB.db) return Promise.resolve(IDB.db);
  return new Promise((res, rej) => {
    let rq;
    try { rq = indexedDB.open(IDB.name, 1); } catch (e) { rej(e); return; }
    rq.onupgradeneeded = () => rq.result.createObjectStore(IDB.store);
    rq.onsuccess = () => { IDB.db = rq.result; res(IDB.db); };
    rq.onerror = () => rej(rq.error);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => { const tx = db.transaction(IDB.store, 'readwrite'); tx.objectStore(IDB.store).put(val, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => { const tx = db.transaction(IDB.store, 'readonly'); const rq = tx.objectStore(IDB.store).get(key); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
}
let _saveT = 0, _saving = false;
function scheduleAutosave() {
  clearTimeout(_saveT);
  _saveT = setTimeout(async () => {
    if (_saving || TF.active || PM.active) { scheduleAutosave(); return; }
    _saving = true;
    try { await idbSet('autosave', JSON.stringify(serializeProject())); } catch (e) { console.warn('autosave failed', e); }
    _saving = false;
  }, 1200);
}
async function loadAutosave() {
  try { const s = await idbGet('autosave'); if (s) { await loadProject(JSON.parse(s)); return true; } } catch (e) { console.warn('autosave load failed', e); }
  return false;
}
function settingsGet(k, d) { try { const v = localStorage.getItem('pm_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
function settingsSet(k, v) { try { localStorage.setItem('pm_' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }

// ---------- share / save a file (must run inside the tap handler) ----------
const MIME = { obj: 'text/plain', mtl: 'text/plain', fbx: 'application/octet-stream', dae: 'model/vnd.collada+xml', glb: 'model/gltf-binary', gltf: 'model/gltf+json', zip: 'application/zip', json: 'application/json', png: 'image/png' };
function shareOrDownload(name, data) {
  const ext = name.split('.').pop().toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  let file = null;
  try { file = new File([blob], name, { type }); } catch (e) { file = null; }
  if (file && navigator.canShare && navigator.share) {
    let ok = false;
    try { ok = navigator.canShare({ files: [file] }); } catch (e) { ok = false; }
    if (ok) {
      navigator.share({ files: [file] }).then(() => toast('Saved ' + name)).catch((e) => { if (e && e.name !== 'AbortError') { downloadBlob(name, blob); } });
      return;
    }
  }
  downloadBlob(name, blob);
}
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast('Saved ' + name);
}
function saveProjectFile() {
  const name = safeFileName(settingsGet('projectName', 'PocketMesh'), 'PocketMesh') + '.pocketmesh.json';
  shareOrDownload(name, JSON.stringify(serializeProject()));
}

// ---------- export ----------
function hexToLinear(hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }
function buildExportScene(selectedOnly) {
  const objs = S.objects.filter((o) => o.visible && (!selectedOnly || o.selected));
  const matIndex = new Map(), mats = [];
  const usedTexNames = new Map();
  const matFor = (id) => {
    if (matIndex.has(id)) return matIndex.get(id);
    const m = matById(id);
    if (!m) return null;
    let texture = null;
    const im = m.texture && m.useTexture !== false ? S.images.get(m.texture) : null;
    if (im) {
      let nm = usedTexNames.get(im.id);
      if (!nm) { nm = im.name; let i = 1; while ([...usedTexNames.values()].includes(nm)) nm = im.name.replace(/(\.[a-z]+)$/i, `_${i++}$1`); usedTexNames.set(im.id, nm); }
      texture = { name: nm, mime: im.mime, bytes: im.bytes, width: im.width, height: im.height, filter: m.filter };
    }
    // an untinted image is the whole base color (as in Blender), so write white for the color factor
    mats.push({ name: m.name, color: texture && !m.tint ? [1, 1, 1] : hexToLinear(m.color), alpha: m.alpha, roughness: m.roughness, metalness: m.metalness, texture });
    matIndex.set(id, mats.length - 1);
    return mats.length - 1;
  };
  const objects = objs.map((o) => ({
    name: o.name,
    position: o.node.position.toArray(), quaternion: o.node.quaternion.toArray(), scale: o.node.scale.toArray(),
    mesh: o.mesh,
    materials: o.materials.map(matFor).filter((x) => x !== null),
  }));
  return { objects, materials: mats };
}
function runExport(fmt, opts) {
  const scene = buildExportScene(opts.selectedOnly);
  if (!scene.objects.length) throw new Error(opts.selectedOnly ? 'No selected objects to export' : 'Nothing to export');
  const eo = { yUp: opts.yUp, applyTransforms: opts.applyTransforms, triangulate: opts.triangulate, baseName: opts.baseName };
  let files;
  if (fmt === 'obj') files = exportOBJ(scene, eo);
  else if (fmt === 'fbx') files = exportFBX(scene, eo);
  else if (fmt === 'dae') files = exportDAE(scene, eo);
  else if (fmt === 'glb') files = exportGLTF(scene, { ...eo, binary: true });
  else files = exportGLTF(scene, { ...eo, binary: false });
  if (files.length === 1 && !opts.zip) return { name: files[0].name, data: files[0].data, count: 1 };
  const zip = makeZip(files);
  return { name: opts.baseName + '_' + fmt + '.zip', data: zip, count: files.length };
}

// ---------- import ----------
function importOBJText(text, fileName) {
  const res = importOBJ(text);
  if (!res.objects.length) throw new Error('No geometry found in that OBJ file');
  const nameToMat = new Map(S.materials.map((m) => [m.name, m.id]));
  for (const x of S.objects) x.selected = false;
  let last = null;
  for (const ob of res.objects) {
    const slots = (ob.materialNames || []).map((nm) => {
      if (!nameToMat.has(nm)) { const m = newMaterial(nm || 'Material'); nameToMat.set(nm, m.id); }
      return nameToMat.get(nm);
    });
    const o = createObject(ob.name || safeFileName(fileName.replace(/\.obj$/i, ''), 'Imported'), ob.mesh, { materials: slots });
    o.selected = true; last = o;
  }
  S.active = last;
  return res.objects.length;
}
