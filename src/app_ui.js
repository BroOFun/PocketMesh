// ============================================================================
// app_ui.js — header, tools, shelf, menus, panels, gestures, keyboard, boot
// ============================================================================

const isCoarse = () => window.matchMedia && matchMedia('(pointer: coarse)').matches;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
S.focus = '3d';
S.pendingTap = null;
S.matSlot = 0;
S.showGrid = true;
CAM.viewName = null;

// ---------- sheets ----------
const SHEET = { refresh: null, kind: null };
function openSheet(title, build, { panel = false, kind = null } = {}) {
  $('#sheetTitle').textContent = title;
  const body = $('#sheetBody');
  body.innerHTML = '';
  build(body);
  $('#sheet').hidden = false;
  $('#scrim').hidden = panel;
  SHEET.refresh = panel ? () => { const st = body.scrollTop; body.innerHTML = ''; build(body); body.scrollTop = st; } : null;
  SHEET.kind = kind;
}
function closeSheet() { $('#sheet').hidden = true; $('#scrim').hidden = true; SHEET.refresh = null; SHEET.kind = null; }
function refreshSheet(force = false) {
  if (!SHEET.refresh || $('#sheet').hidden) return;
  const a = document.activeElement;
  if (!force && a && $('#sheet').contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return;
  SHEET.refresh();
}
function menuSheet(title, items) {
  openSheet(title, (body) => {
    const list = h('div', { class: 'menu' });
    for (const it of items) {
      if (!it) continue;
      if (it.group) { list.append(h('div', { class: 'mgrp' }, it.group)); continue; }
      const b = h('button', { class: 'mi' + (it.danger ? ' danger' : '') }, h('span', { html: icon(it.icon || 'dots') }), h('span', {}, h('span', { class: 't' }, it.label), it.desc ? h('span', { class: 'd' }, it.desc) : null), it.key ? h('span', { class: 'k' }, it.key) : h('span'));
      b.addEventListener('click', () => { if (!it.keepOpen) closeSheet(); it.run(b); });
      list.append(b);
    }
    body.append(list);
  });
}
$('#sheetClose').innerHTML = icon('close');
$('#sheetClose').addEventListener('click', closeSheet);
$('#scrim').addEventListener('click', closeSheet);

// ---------- form fields ----------
function evalNum(s) {
  s = String(s).trim().replace(',', '.');
  if (!s) return null;
  if (!/^[0-9+\-*/().\seE]+$/.test(s)) return null;
  try { const v = Function('"use strict";return (' + s + ')')(); return Number.isFinite(v) ? v : null; } catch (e) { return null; }
}
function numInput(value, onCommit, { digits = 4, int = false, min = -Infinity, max = Infinity, label } = {}) {
  const shown = (v) => (int ? String(Math.round(v)) : String(+Number(v).toFixed(digits)));
  const inp = h('input', { class: 'num', type: 'text', inputmode: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': label || 'Value' });
  inp.value = shown(value);
  inp.addEventListener('focus', () => setTimeout(() => inp.select(), 0));
  inp.addEventListener('change', () => {
    let v = evalNum(inp.value);
    if (v === null) { inp.value = shown(value); return; }
    v = clamp(int ? Math.round(v) : v, min, max);
    value = v; inp.value = shown(v);
    onCommit(v);
  });
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
  return inp;
}
function field(label, control) { return h('label', { class: 'field' }, h('span', {}, label), control); }
function xyzField(label, vals, onCommit, opts = {}) {
  const wrap = h('div', { class: 'xyz' });
  ['X', 'Y', 'Z'].forEach((ax, i) => {
    const inp = numInput(vals[i], (v) => { const nv = vals.slice(); nv[i] = v; onCommit(nv, i); }, { ...opts, label: `${label} ${ax}` });
    wrap.append(h('label', { 'data-ax': ax }, inp));
  });
  return h('div', { style: { display: 'grid', gap: '6px' } }, h('span', { class: 'muted' }, label), wrap);
}
function selectInput(value, options, onChange, label) {
  const s = h('select', { 'aria-label': label || 'Choose' });
  for (const [v, l] of options) { const o = h('option', { value: String(v) }, l); if (String(v) === String(value)) o.selected = true; s.append(o); }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function checkInput(label, checked, onChange) {
  const c = h('input', { type: 'checkbox' });
  c.checked = !!checked;
  c.addEventListener('change', () => onChange(c.checked));
  return h('label', { class: 'check' }, c, label);
}
function sliderInput(value, min, max, step, onInput, onCommit) {
  const r = h('input', { type: 'range', min, max, step });
  r.value = value;
  const num = h('span', { class: 'muted', style: { minWidth: '44px', textAlign: 'right', fontFamily: 'var(--mono)' } }, Number(value).toFixed(2));
  r.addEventListener('input', () => { num.textContent = Number(r.value).toFixed(2); onInput(+r.value); });
  r.addEventListener('change', () => onCommit && onCommit(+r.value));
  return h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, r, num);
}
function segButtons(value, options, onChange) {
  const wrap = h('div', { class: 'segrow' });
  for (const [v, l] of options) {
    const b = h('button', { class: v === value ? 'on' : '' }, l);
    b.addEventListener('click', () => { for (const x of wrap.children) x.classList.remove('on'); b.classList.add('on'); onChange(v); });
    wrap.append(b);
  }
  return wrap;
}

// ---------- header ----------
$('#btnMenu').innerHTML = icon('menu');
$('#btnUndo').innerHTML = icon('undo');
$('#btnRedo').innerHTML = icon('redo');
$('#btnUndo').addEventListener('click', () => { if (TF.active) tfCancel(); else if (PM.active) pmCancel(); else undo(); });
$('#btnRedo').addEventListener('click', () => redo());
$('#btnMode').addEventListener('click', () => {
  menuSheet('Mode', [
    { label: 'Object Mode', icon: 'cube', desc: 'Select, arrange and transform whole objects', key: 'Tab', run: () => S.mode !== 'object' && setMode('object') },
    { label: 'Edit Mode', icon: 'edit', desc: 'Model vertices, edges and faces of the active object', key: 'Tab', run: () => S.mode !== 'edit' && setMode('edit') },
  ]);
});
for (const b of document.querySelectorAll('#selModes button')) {
  b.innerHTML = icon(b.dataset.sm);
  b.addEventListener('click', () => setSelectMode(b.dataset.sm));
}
const VIEW_CYCLE = ['3d', 'split', 'uv'];
function setWorkView(v) {
  S.view = v;
  $('#work').className = 'v-' + v + (v === 'split' ? ' split' : '');
  S.focus = v === 'uv' ? 'uv' : '3d';
  $('#btnView').innerHTML = icon(v === '3d' ? 'uv' : v === 'split' ? 'split' : 'view3d');
  $('#btnView').setAttribute('aria-label', v === '3d' ? 'Show UV editor' : v === 'split' ? 'UV editor only' : '3D view only');
  _lastW = 0; UV.w = 0;
  settingsSet('view', v);
  buildShelf(); gizmoSync(); uvRequest(); requestRender();
}
$('#btnView').addEventListener('click', () => setWorkView(VIEW_CYCLE[(VIEW_CYCLE.indexOf(S.view) + 1) % 3]));

// ---------- sub bar (orientation, pivot, snap, proportional, select op) ----------
const ORIENT = [['global', 'Global'], ['local', 'Local'], ['normal', 'Normal'], ['view', 'View']];
const PIVOT = [['median', 'Median Point'], ['bounds', 'Bounding Box'], ['individual', 'Individual Origins'], ['cursor', '3D Cursor'], ['active', 'Active Element']];
function buildSubbar() {
  const bar = $('#sub');
  bar.innerHTML = '';
  if (trackSubbar(bar)) return;
  const chip = (lbl, val, run, opts = {}) => {
    const b = h('button', { class: 'chip' + (opts.on ? ' on' : ''), 'aria-label': opts.aria || lbl }, opts.icon ? h('span', { html: icon(opts.icon), style: { display: 'grid' } }) : null, lbl ? h('span', { class: 'lbl' }, lbl) : null, val ? h('span', {}, val) : null);
    b.addEventListener('click', run);
    return b;
  };
  if (S.tool === 'ruler') {
    bar.append(chip('Ruler', 'Settings', openRuler, {icon:'ruler'}), chip('', 'Snap', () => { S.ruler.snap = !S.ruler.snap; pushUndo('Ruler snap'); buildSubbar(); }, {on:S.ruler.snap,icon:'magnet',aria:'Ruler snapping'}), chip('', S.ruler.unit, openRuler, {aria:'Measurement units'}), chip('', 'Done', rulerDone));
    return;
  }
  if (S.creaseEdit === S.active?.id && S.mode === 'edit') {
    bar.prepend(chip('', 'Mark Creases', () => changeSelectedCreases(true)),
      chip('', 'Remove Creases', () => changeSelectedCreases(false)),
      chip('', 'Done · Preview', finishCreases, {on: true, aria: 'Done editing creases'}));
    return;
  }
  bar.append(chip('Multiselect', S.multiSelect ? 'Done' : '', () => {
    S.multiSelect = !S.multiSelect; S.selOp = S.multiSelect ? 'add' : 'set';
    if (S.multiSelect) { S.tool = 'select'; S.pendingTap = null; buildTools(); gizmoSync(); }
    hint(S.multiSelect ? 'Multiselect · tap objects or mesh elements to add/remove · Done to finish' : null);
    buildSubbar();
  }, { on: S.multiSelect, aria: 'Multiselect' }));
  bar.append(
    chip('Orient', ORIENT.find((x) => x[0] === S.orient)[1], () => menuSheet('Transform Orientation', ORIENT.map(([k, l]) => ({ label: l, icon: k === S.orient ? 'check' : 'dots', desc: { global: 'World X / Y / Z axes', local: "The active object's own axes", normal: 'Aligned to the selection surface (edit mode)', view: 'Aligned to the screen' }[k], run: () => { S.orient = k; settingsSet('orient', k); buildSubbar(); gizmoSync(); } })))),
    chip('Pivot', PIVOT.find((x) => x[0] === S.pivot)[1], () => menuSheet('Pivot Point', PIVOT.map(([k, l]) => ({ label: l, icon: k === S.pivot ? 'check' : 'dots', run: () => { S.pivot = k; settingsSet('pivot', k); buildSubbar(); gizmoSync(); } })))),
    h('span', { class: 'vsep' }),
    chip('', 'Snap', () => { S.snap = !S.snap; settingsSet('snap', S.snap); buildSubbar(); gizmoSync(); }, { on: S.snap, icon: 'magnet', aria: 'Snap to increments' }),
    chip('', 'Proportional', () => { S.prop = !S.prop; buildSubbar(); }, { on: S.prop, icon: 'prop', aria: 'Proportional editing' }),
  );
  if (S.prop) bar.append(chip('R', S.propRadius.toFixed(2), () => openSettings('prop')));
  bar.append(h('span', { class: 'vsep' }));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Selection mode' });
  for (const [k, l] of [['set', 'Set'], ['add', 'Add'], ['sub', 'Sub']]) {
    const b = h('button', { class: S.selOp === k ? 'on' : '', style: { width: '44px', fontSize: '13px', fontWeight: '600' }, 'aria-label': { set: 'Replace selection', add: 'Add to / toggle selection', sub: 'Remove from selection' }[k] }, l);
    b.addEventListener('click', () => { S.selOp = k; S.multiSelect = false; hint(null); buildSubbar(); });
    seg.append(b);
  }
  bar.append(seg, h('span', { class: 'vsep' }), chip('', '', () => openSettings(), { icon: 'sliders', aria: 'Settings' }));
}

// ---------- tool columns ----------
const TOOLS3D = [['select', 'select', 'Tap select'], ['box', 'box', 'Box select'], ['cursor', 'cursor', 'Place 3D cursor'], ['ruler', 'ruler', 'Ruler · Measure'], null, ['move', 'move', 'Move gizmo'], ['rotate', 'rotate', 'Rotate gizmo'], ['scale', 'scale', 'Scale gizmo']];
function buildTools() {
  const col = $('#tools'); col.innerHTML = '';
  for (const t of (S.workspace === 'model' ? TOOLS3D : S.workspace === 'kcl' ? [['select','select','Pick collision material'], null, ...TOOLS3D.slice(5)] : [['place','cursor','Place Start'],['aim','rotate','Aim Start'], null, ...TOOLS3D.slice(5,7)])) {
    if (!t) { col.append(h('hr')); continue; }
    const b = h('button', { class: (S.workspace === 'kmp' && S.tool === 'select' ? TRACKVIEW.action : S.tool) === t[0] ? 'on' : '', html: icon(t[1]), 'aria-label': t[2], title: t[2] });
    b.addEventListener('click', () => { if (S.workspace === 'kmp' && ['place','aim'].includes(t[0])) { trackAction(t[0]); return; } if (S.workspace !== 'model') { trackTool(t[0]); return; } if (t[0] === 'ruler') { rulerActivate(); return; } S.tool = t[0]; S.pendingTap = null; rulerResetPending(); hint(null); buildTools(); buildSubbar(); gizmoSync(); });
    col.append(b);
  }
  const uc = $('#uvtools'); uc.innerHTML = '';
  for (const t of [['select', 'select', 'Tap select · drag to pan'], ['box', 'box', 'Box select'], null, ['move', 'move', 'Drag to move UVs'], ['rotate', 'rotate', 'Drag to rotate UVs'], ['scale', 'scale', 'Drag to scale UVs'], null, ['fit', 'frame', 'Fit view']]) {
    if (!t) { uc.append(h('hr')); continue; }
    const b = h('button', { class: S.uvTool === t[0] ? 'on' : '', html: icon(t[1]), 'aria-label': t[2], title: t[2] });
    b.addEventListener('click', () => { if (t[0] === 'fit') { uvFit(); return; } S.uvTool = t[0]; buildTools(); });
    uc.append(b);
  }
}

// ---------- nav gizmo + view buttons + shading ----------
const nav = $('#nav'), nctx = nav.getContext('2d');
const NAV_AX = [
  { v: [1, 0, 0], c: '#f2506b', l: 'X', view: 'right' }, { v: [-1, 0, 0], c: '#f2506b', view: 'left' },
  { v: [0, 1, 0], c: '#86cf38', l: 'Y', view: 'back' }, { v: [0, -1, 0], c: '#86cf38', view: 'front' },
  { v: [0, 0, 1], c: '#4b9df6', l: 'Z', view: 'top' }, { v: [0, 0, -1], c: '#4b9df6', view: 'bottom' },
];
let navHits = [];
drawNav = function () {
  const W = nav.width, R = W * 0.36, c = W / 2;
  nctx.clearRect(0, 0, W, W);
  nctx.fillStyle = '#ffffff10'; nctx.beginPath(); nctx.arc(c, c, W / 2 - 2, 0, Math.PI * 2); nctx.fill();
  const { x, y, z } = camBasis();
  const pts = NAV_AX.map((a) => {
    const v = new THREE.Vector3(...a.v);
    return { ...a, sx: c + v.dot(x) * R, sy: c - v.dot(y) * R, d: v.dot(z) };
  }).sort((p, q) => p.d - q.d);
  navHits = pts;
  for (const p of pts) {
    if (p.l) { nctx.strokeStyle = p.c; nctx.lineWidth = W * 0.025; nctx.beginPath(); nctx.moveTo(c, c); nctx.lineTo(p.sx, p.sy); nctx.stroke(); }
  }
  for (const p of pts) {
    const r = p.l ? W * 0.095 : W * 0.075;
    nctx.beginPath(); nctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
    if (p.l) { nctx.fillStyle = p.c; nctx.fill(); nctx.fillStyle = '#111'; nctx.font = `700 ${Math.round(W * 0.11)}px -apple-system, system-ui, sans-serif`; nctx.textAlign = 'center'; nctx.textBaseline = 'middle'; nctx.fillText(p.l, p.sx, p.sy + 1); }
    else { nctx.fillStyle = p.c + '55'; nctx.fill(); nctx.strokeStyle = p.c; nctx.lineWidth = W * 0.015; nctx.stroke(); }
  }
  updateStats();
};
(function navInput() {
  let st = null;
  nav.addEventListener('pointerdown', (e) => { e.stopPropagation(); nav.setPointerCapture(e.pointerId); st = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false }; });
  nav.addEventListener('pointermove', (e) => {
    if (!st) return;
    const dx = e.clientX - st.lx, dy = e.clientY - st.ly;
    if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > 5) st.moved = true;
    if (st.moved) { orbit(dx * 1.3, dy * 1.3); CAM.viewName = null; }
    st.lx = e.clientX; st.ly = e.clientY;
  });
  nav.addEventListener('pointerup', (e) => {
    if (st && !st.moved) {
      const r = nav.getBoundingClientRect(), k = nav.width / r.width;
      const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
      let best = null;
      for (const p of navHits) { const d = Math.hypot(p.sx - px, p.sy - py); if (d < nav.width * 0.14 && (!best || p.d > best.p.d - 0.2 && d < best.dist)) best = { p, dist: d }; }
      if (best) {
        let v = best.p.view;
        if (CAM.viewName === v) v = { right: 'left', left: 'right', front: 'back', back: 'front', top: 'bottom', bottom: 'top' }[v];
        setView(v); CAM.viewName = v;
      }
    }
    st = null;
  });
})();
function navDragButton(btn, onDrag) {
  let st = null;
  btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); btn.setPointerCapture(e.pointerId); st = { x: e.clientX, y: e.clientY }; });
  btn.addEventListener('pointermove', (e) => { if (!st) return; onDrag(e.clientX - st.x, e.clientY - st.y); st = { x: e.clientX, y: e.clientY }; });
  btn.addEventListener('pointerup', () => { st = null; });
  btn.addEventListener('pointercancel', () => { st = null; });
}
function buildNavButtons() {
  const nb = $('#navbtns'); nb.innerHTML = '';
  const pan_ = h('button', { class: 'big', html: icon('pan'), 'aria-label': 'Drag to pan the view', title: 'Drag to pan' });
  navDragButton(pan_, (dx, dy) => pan(dx * 1.5, dy * 1.5));
  const zm = h('button', { class: 'big', html: icon('zoom'), 'aria-label': 'Drag up or down to zoom', title: 'Drag to zoom' });
  navDragButton(zm, (dx, dy) => zoom(Math.exp(dy * 0.01)));
  const pr = h('button', { id: 'btnOrtho', html: icon(CAM.ortho ? 'ortho' : 'persp'), 'aria-label': 'Toggle perspective / orthographic' });
  pr.addEventListener('click', () => toggleOrtho());
  const fr = h('button', { html: icon('frame'), 'aria-label': 'Frame selected' });
  fr.addEventListener('click', () => S.workspace === 'kmp' && S.track.start ? trackFocusStart() : frameSelected());
  const xr = h('button', { id: 'btnXray', class: S.xray ? 'on' : '', html: icon('xray'), 'aria-label': 'X-ray: see and select through the mesh' });
  xr.addEventListener('click', () => { S.xray = !S.xray; xr.classList.toggle('on', S.xray); refreshMaterials(); refreshAllObjects(); toast(S.xray ? 'X-ray on' : 'X-ray off'); });
  const sh = h('button', { id: 'btnShade', class: 'shade', html: icon(SHADES.find((x) => x[0] === S.shading)[1]), 'aria-label': 'Viewport shading' });
  sh.addEventListener('click', menuShading);
  nb.append(pan_, zm, pr, fr, xr, sh);
}
updateViewButtons = () => { const b = $('#btnOrtho'); if (b) b.innerHTML = icon(CAM.ortho ? 'ortho' : 'persp'); };
const SHADES = [['wire', 'wire', 'Wireframe', 'Edges only'], ['solid', 'solid', 'Solid', 'Plain colors, fast'], ['material', 'matprev', 'Material Preview', 'Textures and lighting'], ['rendered', 'rendered', 'Rendered', 'Shadows, no grid']];
function menuShading() {
  menuSheet('Viewport Shading', [
    ...SHADES.map(([k, ic, l, d]) => ({ label: l, icon: ic, desc: d + (S.shading === k ? ' · current' : ''), run: () => setShading(k) })),
    { group: 'Overlays' },
    { label: S.xray ? 'X-ray: on' : 'X-ray: off', icon: 'xray', desc: 'See and select through the mesh', run: () => $('#btnXray').click() },
    { label: S.faceOrient ? 'Backface overlay: on' : 'Backface overlay: off', icon: 'normals', desc: 'Subtle red = back · front faces keep their appearance', run: () => setBackfaceOverlay(!S.faceOrient) },
  ]);
}
function setBackfaceOverlay(enabled) {
  S.faceOrient = !!enabled; settingsSet('backfaceOverlay', S.faceOrient);
  refreshAllObjects(); refreshSheet(); requestRender();
}
function buildShadebar() { const b = $('#btnShade'); if (b) b.innerHTML = icon(SHADES.find((x) => x[0] === S.shading)[1]); }
function setShading(k) {
  S.shading = k; settingsSet('shading', k);
  applyShadingEnv(); refreshMaterials(); refreshAllObjects(); buildShadebar(); requestRender();
}

// ---------- stats ----------
let _statsKey = '';
function updateStats() {
  const vn = CAM.viewName ? CAM.viewName[0].toUpperCase() + CAM.viewName.slice(1) : 'User';
  let txt = `<b>${vn} ${CAM.ortho ? 'Orthographic' : 'Perspective'}</b>\n`;
  if (S.mode === 'edit' && S.active) {
    const o = S.active, m = o.mesh, T = topo(m), s = o.esel;
    txt += `${esc(o.name)} · Edit\nV ${s.verts.size}/${m.verts.length} · E ${s.edges.size}/${T.edges.length} · F ${s.faces.size}/${m.faces.length}`;
  } else {
    let v = 0, f = 0, t = 0;
    for (const o of S.objects) if (o.visible) { v += o.mesh.verts.length; f += o.mesh.faces.length; t += o.rd ? o.rd.triFace.length : 0; }
    txt += `${S.active ? esc(S.active.name) : 'Nothing active'}\nObj ${selectedObjects().length}/${S.objects.length} · V ${v} · F ${f} · Tri ${t}`;
  }
  if (txt !== _statsKey) { $('#stats').innerHTML = txt; _statsKey = txt; }
}

// ---------- shelf ----------
function shelfBtn(label, ic, run, sub = false) {
  const b = h('button', { class: sub ? 'sub' : '', html: icon(ic) + `<span>${esc(label)}</span>` });
  b.addEventListener('click', run);
  return b;
}
function buildShelf() {
  const sh = $('#shelf'); sh.innerHTML = '';
  if (buildTrackShelf(sh)) return;
  const g = () => h('span', { class: 'grp' });
  if (S.view === 'uv' || (S.view === 'split' && S.focus === 'uv')) {
    sh.append(
      shelfBtn('Unwrap', 'uv', menuUnwrap, true), shelfBtn('Straighten', 'straighten', menuStraighten, true), shelfBtn('Pack', 'pack', opPack), shelfBtn('Avg Scale', 'scale', opAvgScale), g(),
      shelfBtn('Rotate', 'rot90', () => menuSheet('Rotate UVs', [{ label: 'Rotate 90° Counter-Clockwise', icon: 'rot90', run: () => opUVRot90(1) }, { label: 'Rotate 90° Clockwise', icon: 'rotate', run: () => opUVRot90(-1) }, { label: 'Rotate 180°', icon: 'rotate', run: () => opUVRot90(2) }, { group: 'Free rotation: use the Rotate tool on the left. It clicks to 0 / 90 / 180 / 270°.' }]), true),
      shelfBtn('Flip', 'mirror', () => menuSheet('Flip', [{ label: 'Flip Horizontally', icon: 'mirror', run: () => opUVFlip('x') }, { label: 'Flip Vertically', icon: 'mirror', run: () => opUVFlip('y') }]), true),
      shelfBtn('Fit 0–1', 'frame', opUVFit), shelfBtn('Weld', 'merge', opUVWeld), g(),
      shelfBtn('Select', 'selall', menuUVSelect, true), shelfBtn(S.uvStretch ? 'Stretch On' : 'Stretch', 'stretch', () => { S.uvStretch = !S.uvStretch; uvRequest(); buildShelf(); }),
      shelfBtn('Texture', 'material', openMaterialPanel), shelfBtn('Layout PNG', 'image', exportUVLayout), g(),
      shelfBtn('3D Shelf', 'view3d', () => { S.focus = '3d'; buildShelf(); }),
    );
    return;
  }
  if (S.mode === 'object') {
    sh.append(
      shelfBtn('Add', 'plus', menuAdd, true), shelfBtn('Edit Mode', 'edit', () => setMode('edit')), g(),
      shelfBtn('Move', 'move', () => tfStart('move')), shelfBtn('Rotate', 'rotate', () => tfStart('rotate')), shelfBtn('Scale', 'scale', () => tfStart('scale')), g(),
      shelfBtn('Duplicate', 'duplicate', opDuplicate), shelfBtn('Delete', 'trash', () => opDelete()), shelfBtn('Join', 'join', opJoin),
      shelfBtn('Separate', 'separate', () => menuSheet('Separate', [{ label: 'By Material', icon: 'material', desc: 'One object per material slot', run: () => opSeparate('material') }, { label: 'By Loose Parts', icon: 'separate', desc: 'One object per disconnected piece', run: () => opSeparate('loose') }]), true),
      shelfBtn('Shading', 'smooth', () => menuSheet('Shading', [{ label: 'Shade Smooth', icon: 'smooth', run: () => opNormals('smooth') }, { label: 'Shade Flat', icon: 'cube', run: () => opNormals('flat') }, { group: 'Normals' }, { label: 'Recalculate Outside', icon: 'normals', run: () => opNormals('outside') }, { label: 'Flip Normals', icon: 'normals', run: () => opNormals('flip') }]), true),
      shelfBtn('Origin', 'origin', menuOrigin, true), shelfBtn('Apply', 'check', menuApply, true), shelfBtn('Mirror', 'mirror', menuMirror, true), shelfBtn('Snap', 'magnet', menuSnap, true),
      shelfBtn('Hide', 'hide', () => menuSheet('Visibility', [{ label: 'Hide Selected', icon: 'eyeoff', key: 'H', run: () => opHide('hide') }, { label: 'Reveal Hidden', icon: 'eye', key: 'Alt H', run: () => opHide('reveal') }]), true), g(),
      shelfBtn('Ruler', 'ruler', openRuler), shelfBtn('Modifiers', 'modifiers', openModifiers), shelfBtn('Material', 'material', openMaterialPanel), shelfBtn('Properties', 'sliders', openProps), shelfBtn('Scene', 'layers', openOutliner), shelfBtn('Export', 'export', openExport),
    );
  } else {
    sh.append(
      shelfBtn('Add', 'plus', menuAdd, true), shelfBtn('Select', 'selall', menuSelect, true), g(),
      shelfBtn('Move', 'move', () => tfStart('move')), shelfBtn('Rotate', 'rotate', () => tfStart('rotate')), shelfBtn('Scale', 'scale', () => tfStart('scale')), g(),
      shelfBtn('Extrude', 'extrude', opExtrude), shelfBtn('Inset', 'inset', opInset), shelfBtn('Loop Cut', 'loopcut', opLoopCutStart), shelfBtn('Subdivide', 'subdivide', opSubdivide),
      shelfBtn('Fill', 'fill', menuFill, true), shelfBtn('Merge', 'merge', menuMerge, true), shelfBtn('Delete', 'trash', menuDelete, true), shelfBtn('Duplicate', 'duplicate', opDuplicate),
      shelfBtn('Mesh', 'cube', menuMesh, true), g(),
      shelfBtn('UV', 'uv', menuUVFrom3D, true), shelfBtn('Seams', 'seam', () => menuSheet('UV Seams', [{ label: 'Mark Seam', icon: 'seam', desc: 'Selected edges become cuts for Unwrap', run: () => opSeam(true) }, { label: 'Clear Seam', icon: 'seam', run: () => opSeam(false) }]), true),
      shelfBtn('Snap', 'magnet', menuSnap, true), shelfBtn('Mirror', 'mirror', menuMirror, true), g(),
      shelfBtn('Ruler', 'ruler', openRuler), shelfBtn('Modifiers', 'modifiers', openModifiers), shelfBtn('Material', 'material', openMaterialPanel), shelfBtn('Properties', 'sliders', openProps), shelfBtn('Object Mode', 'cube', () => setMode('object')),
    );
  }
  if (S.view === 'split') sh.append(g(), shelfBtn('UV Shelf', 'uv', () => { S.focus = 'uv'; buildShelf(); }));
}

// ---------- menus ----------
function menuAdd() {
  menuSheet(S.mode === 'edit' ? 'Add to Mesh' : 'Add Mesh', [
    ...Object.entries(PRIMITIVES).map(([k, p]) => ({ label: p.label, icon: k === 'plane' || k === 'grid' ? 'grid' : k === 'circle' ? 'origin' : 'cube', run: () => addPrimitive(k) })),
    { group: 'Added at the 3D cursor. Adjust size and segments in the panel that appears.' },
  ]);
}
function menuSelect() {
  menuSheet('Select', [
    { label: 'All', icon: 'selall', key: 'A', run: () => opSelect('all') },
    { label: 'None', icon: 'close', key: 'Alt A', run: () => opSelect('none') },
    { label: 'Invert', icon: 'selall', key: 'Ctrl I', run: () => opSelect('invert') },
    { group: 'Grow' },
    { label: 'Linked', icon: 'layers', desc: 'Everything connected to the selection', key: 'Ctrl L', run: () => opSelect('linked') },
    { label: 'Linked (stop at seams)', icon: 'seam', run: () => opSelect('linked_seam') },
    { label: 'More', icon: 'plus', key: 'Ctrl +', run: () => opSelect('more') },
    { label: 'Less', icon: 'minus', key: 'Ctrl −', run: () => opSelect('less') },
    { group: 'Pick' },
    { label: 'Edge Loop…', icon: 'loopcut', desc: 'Then tap an edge (or double-tap any edge)', run: () => opSelect('loop') },
    { label: 'Edge Ring…', icon: 'subdivide', desc: 'Then tap an edge', run: () => opSelect('ring') },
    { label: 'Boundary Loop', icon: 'select', desc: 'Outline of the selected faces', run: () => opSelect('boundary') },
  ]);
}
function menuFill() {
  menuSheet('Fill', [
    { label: 'Fill', icon: 'fill', key: 'F', desc: 'Make an n-gon from an open edge loop (or an edge from 2 vertices)', run: () => opFill('ngon') },
    { label: 'Grid Fill', icon: 'grid', desc: 'Fill an even edge loop with a grid of quads', run: opGridFill },
    { label: 'Triangle Fill', icon: 'tri', key: 'Alt F', desc: 'Fill an edge loop with triangles', run: () => opFill('tri') },
    { label: 'Bridge Edge Loops', icon: 'extrude', desc: 'Connect two edge loops (or two faces) with quads', run: opBridge },
  ]);
}
function menuMerge() {
  menuSheet('Merge', [
    { label: 'At Center', icon: 'merge', run: () => opMerge('center') },
    { label: 'At Cursor', icon: 'cursor', run: () => opMerge('cursor') },
    { label: 'Collapse', icon: 'merge', desc: 'Each connected group to its own center', run: () => opMerge('collapse') },
    { label: 'By Distance', icon: 'magnet', desc: 'Weld overlapping vertices', run: () => opMerge('distance') },
  ]);
}
function menuDelete() {
  menuSheet('Delete', [
    { label: 'Vertices', icon: 'trash', key: 'X', run: () => opDelete('verts') },
    { label: 'Edges', icon: 'trash', run: () => opDelete('edges') },
    { label: 'Faces', icon: 'trash', run: () => opDelete('faces') },
    { label: 'Only Edges & Faces', icon: 'trash', run: () => opDelete('edges_faces') },
    { label: 'Only Faces', icon: 'trash', desc: 'Keep the edges as a wire', run: () => opDelete('only_faces') },
    { group: 'Dissolve (remove without leaving holes)' },
    { label: 'Dissolve Vertices', icon: 'minus', run: () => opDelete('dis_verts') },
    { label: 'Dissolve Edges', icon: 'minus', run: () => opDelete('dis_edges') },
    { label: 'Dissolve Faces', icon: 'minus', desc: 'Merge selected faces into one', run: () => opDelete('dis_faces') },
  ]);
}
function menuMesh() {
  menuSheet('Mesh', [
    { group: 'Extrude' },
    { label: 'Extrude Region', icon: 'extrude', key: 'E', run: opExtrude },
    { label: 'Extrude Individual Faces', icon: 'extrude', key: 'Alt E', run: opExtrudeIndividual },
    { label: 'Extrude Along Normals', icon: 'extrude', run: opExtrudeNormals },
    { label: 'Shrink / Fatten', icon: 'normals', key: 'Alt S', desc: 'Move along vertex normals', run: () => tfStart('shrink') },
    { group: 'Faces' },
    { label: 'Triangulate Faces', icon: 'tri', key: 'Ctrl T', run: opTriangulate },
    { label: 'Tris to Quads', icon: 'subdivide', key: 'Alt J', run: opTrisToQuads },
    { group: 'Normals & Shading' },
    { label: 'Recalculate Outside', icon: 'normals', key: 'Shift N', run: () => opNormals('outside') },
    { label: 'Recalculate Inside', icon: 'normals', run: () => opNormals('inside') },
    { label: 'Flip', icon: 'normals', run: () => opNormals('flip') },
    { label: 'Shade Smooth', icon: 'smooth', run: () => opNormals('smooth') },
    { label: 'Shade Flat', icon: 'cube', run: () => opNormals('flat') },
    { group: 'Separate' },
    { label: 'Selection to New Object', icon: 'separate', key: 'P', run: () => opSeparate('selected') },
    { label: 'By Loose Parts', icon: 'separate', run: () => opSeparate('loose') },
    { label: 'By Material', icon: 'material', desc: 'One object per material', run: () => opSeparate('material') },
  ]);
}
const UNWRAP_ITEMS = [
  { label: 'Unwrap', icon: 'uv', desc: 'Conformal (LSCM) flattening, cut at seams', run: () => opUnwrap('conformal') },
  { label: 'Unwrap (Minimum Stretch)', icon: 'uv', desc: 'Conformal, then relaxed to even out area', run: () => opUnwrap('min_stretch') },
  { label: 'Smart UV Project', icon: 'pack', desc: 'Auto-split by angle, no seams needed', run: () => opUnwrap('smart') },
  { label: 'Lightmap Pack', icon: 'grid', desc: 'Every face gets its own space', run: () => opUnwrap('lightmap') },
  { label: 'Follow Active Quads', icon: 'straighten', desc: 'Grid-like UVs from the active quad', run: () => opUnwrap('follow') },
  { group: 'Projections' },
  { label: 'Cube Projection', icon: 'cube', run: () => opUnwrap('cube') },
  { label: 'Cylinder Projection', icon: 'origin', run: () => opUnwrap('cylinder') },
  { label: 'Sphere Projection', icon: 'wire', run: () => opUnwrap('sphere') },
  { label: 'Project From View', icon: 'frame', desc: 'Exactly what you see in the 3D view', run: () => opUnwrap('view') },
  { label: 'Reset', icon: 'subdivide', desc: 'Each face fills the whole texture', run: () => opUnwrap('reset') },
];
function menuUnwrap() { menuSheet('Unwrap', [{ group: 'Applies to the selected faces (or all faces)' }, ...UNWRAP_ITEMS]); }
function menuUVFrom3D() {
  menuSheet('UV', [...UNWRAP_ITEMS,
    { group: 'Seams' },
    { label: 'Mark Seam', icon: 'seam', run: () => opSeam(true) },
    { label: 'Clear Seam', icon: 'seam', run: () => opSeam(false) },
    { group: 'Editor' },
    { label: 'Open UV Editor', icon: 'split', run: () => setWorkView('split') }]);
}
function menuStraighten() {
  menuSheet('Straighten & Align', [
    { label: 'Straighten Grid', icon: 'grid', desc: 'Turn quad islands into a perfectly straight grid', run: () => opStraighten('grid') },
    { label: 'Straighten', icon: 'straighten', desc: 'Line up selected UVs between the two ends', run: () => opStraighten('line') },
    { label: 'Straighten X', icon: 'straighten', run: () => opStraighten('line_x') },
    { label: 'Straighten Y', icon: 'straighten', run: () => opStraighten('line_y') },
    { group: 'Align' },
    { label: 'Align X', icon: 'straighten', desc: 'Same U for all selected', run: () => opStraighten('align_x') },
    { label: 'Align Y', icon: 'straighten', desc: 'Same V for all selected', run: () => opStraighten('align_y') },
    { label: 'Align Auto', icon: 'straighten', run: () => opStraighten('align_auto') },
    { label: 'Align Rotation', icon: 'rotate', desc: 'Rotate islands square to the axes', run: () => opStraighten('rotation') },
  ]);
}
function menuUVSelect() {
  menuSheet('Select UVs', [
    { label: 'All', icon: 'selall', run: () => uvSelectAll('all') },
    { label: 'None', icon: 'close', run: () => uvSelectAll('none') },
    { label: 'Invert', icon: 'selall', run: () => uvSelectAll('invert') },
    { label: 'Islands', icon: 'layers', desc: 'Grow to whole UV islands', run: () => uvSelectAll('island') },
  ]);
}
function menuSnap() {
  menuSheet('Snap', [
    { label: 'Cursor to Selected', icon: 'cursor', run: () => opSnap('cursor_sel') },
    { label: 'Cursor to World Origin', icon: 'cursor', run: () => opSnap('cursor_origin') },
    { label: 'Cursor to Active', icon: 'cursor', run: () => opSnap('cursor_active') },
    { label: 'Selection to Cursor', icon: 'move', run: () => opSnap('sel_cursor') },
    { label: 'Selection to Grid', icon: 'grid', run: () => opSnap('sel_grid') },
  ]);
}
function menuMirror() {
  menuSheet('Mirror', [0, 1, 2].map((a) => ({ label: `Mirror ${'XYZ'[a]}`, icon: 'mirror', desc: 'Around the pivot point, in the current orientation', run: () => mirrorSel(a) })));
}
function menuOrigin() {
  menuSheet('Set Origin', [
    { label: 'Origin to Geometry', icon: 'origin', run: () => opOrigin('geom') },
    { label: 'Origin to 3D Cursor', icon: 'cursor', run: () => opOrigin('cursor') },
    { label: 'Geometry to Origin', icon: 'origin', run: () => opOrigin('geom_to_origin') },
  ]);
}
function menuApply() {
  menuSheet('Apply Transform', [
    { label: 'Location', icon: 'move', run: () => opApply('loc') },
    { label: 'Rotation', icon: 'rotate', run: () => opApply('rot') },
    { label: 'Scale', icon: 'scale', run: () => opApply('scale') },
    { label: 'Rotation & Scale', icon: 'rotate', run: () => opApply('rotscale') },
    { label: 'All Transforms', icon: 'check', run: () => opApply('all') },
  ]);
}
let _newArmed = 0;
function menuFile() {
  menuSheet('PocketMesh', [
    { label: 'New Scene', icon: 'file', desc: 'Start over with a cube', run: confirmNew },
    { label: 'Open Project…', icon: 'folder', desc: 'A .pocketmesh.json file', run: () => $('#fileProj').click() },
    { label: 'Save Project', icon: 'save', desc: 'Save to Files, iCloud Drive, AirDrop…', run: saveProjectFile },
    { group: 'Track workspaces' },
    { label: 'KCL Editor', icon: 'layers', run: () => { setWorkspace('kcl'); openKCL(); } },
    { label: 'KMP Editor', icon: 'cursor', run: () => { setWorkspace('kmp'); openKMP(); } },
    { label: 'SZS Editor…', icon: 'folder', desc: 'Open a track archive and replace its files', run: openSZSEditor },
    { group: 'Exchange' },
    { label: 'BRRES Editor…', icon: 'folder', desc: 'Inspect resources, preview and resize textures', run: openBRRESEditor },
    { label: 'Export Model…', icon: 'export', desc: 'BRRES · OBJ · FBX · DAE · glTF', run: openExport },
    { label: 'Export as BRRES…', icon: 'export', desc: 'Wii model and textures', run: () => { settingsSet('export', { ...settingsGet('export', {}), fmt: 'brres', zip: false }); openExport(); } },
    { label: 'Import OBJ + materials…', desc: 'Select OBJ, MTL and images together', icon: 'import', run: () => $('#fileObj').click() },
    { label: 'Export UV Layout (PNG)', icon: 'image', desc: 'Paint over it in another app', run: exportUVLayout },
    { group: 'Help' },
    { label: 'Gestures & Tips', icon: 'info', run: openHelp },
    { label: 'Settings', icon: 'sliders', run: () => openSettings() },
  ]);
}
$('#btnMenu').addEventListener('click', menuFile);
function confirmNew() {
  openSheet('New Scene', (body) => {
    body.append(h('p', { class: 'muted', style: { margin: '4px 2px' } }, 'This replaces the current scene with a single cube. Save the project first if you want to keep it.'));
    const go = h('button', { class: 'btn primary' }, 'Discard and start new');
    go.addEventListener('click', () => { closeSheet(); newScene(); });
    const sv = h('button', { class: 'btn' }, h('span', { html: icon('save') }), 'Save project first');
    sv.addEventListener('click', saveProjectFile);
    body.append(h('div', { class: 'row' }, go, sv));
  });
}
function newScene() {
  if (TF.active) tfCancel(); if (PM.active) pmCancel();
  for (const o of [...S.objects]) disposeObject(o);
  clearImages(); S.multiSelect = false; S.selOp = 'set';
  S.objects = []; S.materials = []; S.mode = 'object'; S.active = null; S.uvSel = new Set();
  S.track = normalizeTrack();
  S.cursor.set(0, 0, 0); S.ruler = normalizeRuler(); rulerResetPending();
  const mat = newMaterial('Material', '#c9ccd2');
  const o = createObject('Cube', primCube(), { materials: [mat.id] });
  o.selected = true; S.active = o;
  Object.assign(CAM, { target: new THREE.Vector3(), yaw: -0.756, pitch: 0.456, dist: 11.3, ortho: false, autoOrtho: false, viewName: null });
  applyCamera();
  UNDO.stack = []; UNDO.idx = -1;
  pushUndo('New Scene');
  LAST.op = null; hideRedoPanel();
  refreshAllObjects(); onModeChanged(); onSelectionChanged();
}

// ---------- panels ----------
function openProps() { openSheet(S.mode === 'edit' ? 'Item · Edit' : 'Item', buildProps, { panel: true, kind: 'props' }); }
function buildProps(body) {
  const o = S.active;
  if (!o) { body.append(h('p', { class: 'muted' }, 'Select an object to see its transform.')); return; }
  if (S.mode === 'edit') {
    const s = o.esel, m = o.mesh;
    const card = h('div', { class: 'card' }, h('h3', {}, s.verts.size === 1 ? 'Vertex' : 'Median'));
    if (!s.verts.size) card.append(h('p', { class: 'muted', style: { margin: 0 } }, 'Nothing selected.'));
    else {
      const glob = settingsGet('propsGlobal', false);
      const pts = [...s.verts].map((v) => (glob ? worldOfVert(o, v) : new THREE.Vector3(...m.verts[v])));
      const c = pivotOf(pts, 'median');
      card.append(xyzField(glob ? 'Global' : 'Local', [c.x, c.y, c.z], (nv) => {
        const d = new THREE.Vector3(nv[0] - c.x, nv[1] - c.y, nv[2] - c.z);
        if (glob) d.applyMatrix3(new THREE.Matrix3().setFromMatrix4(o.node.matrixWorld).invert());
        for (const v of s.verts) m.verts[v] = [m.verts[v][0] + d.x, m.verts[v][1] + d.y, m.verts[v][2] + d.z];
        updateGeomPositions(o); pushUndo('Move'); onSelectionChanged();
      }));
      card.append(segButtons(glob ? 'g' : 'l', [['l', 'Local'], ['g', 'Global']], (v) => { settingsSet('propsGlobal', v === 'g'); refreshSheet(); }));
    }
    body.append(card);
    body.append(h('div', { class: 'card' }, h('h3', {}, 'Mesh'), checkInput('Shade smooth', m.smooth, (v) => { m.smooth = v; rebuildObject(o); pushUndo(v ? 'Shade Smooth' : 'Shade Flat'); }),
      h('p', { class: 'muted', style: { margin: 0 } }, `${m.verts.length} vertices · ${topo(m).edges.length} edges · ${m.faces.length} faces · ${m.seams.size} seams`)));
    return;
  }
  const n = o.node;
  const nameIn = h('input', { type: 'text', 'aria-label': 'Object name', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' });
  nameIn.value = o.name;
  nameIn.addEventListener('change', () => { const v = nameIn.value.trim(); if (v && v !== o.name) { o.name = S.objects.some((x) => x !== o && x.name === v) ? uniqueObjName(v) : v; pushUndo('Rename'); updateStats(); refreshSheet(); } });
  nameIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') nameIn.blur(); });
  const commit = (label) => { n.updateMatrixWorld(); refreshOriginDots(); pushUndo(label); gizmoSync(); requestRender(); };
  const eul = new THREE.Euler().setFromQuaternion(n.quaternion, 'ZYX');
  const b = meshBounds(o.mesh), dims = [0, 1, 2].map((i) => (b.max[i] - b.min[i]) * Math.abs(n.scale.getComponent(i)));
  body.append(h('div', { class: 'card' }, h('h3', {}, 'Object'), field('Name', nameIn),
    xyzField('Location', n.position.toArray(), (v) => { n.position.fromArray(v); commit('Location'); }),
    xyzField('Rotation (°)', [eul.x / DEG, eul.y / DEG, eul.z / DEG], (v) => { n.quaternion.setFromEuler(new THREE.Euler(v[0] * DEG, v[1] * DEG, v[2] * DEG, 'ZYX')); commit('Rotation'); }, { digits: 2 }),
    xyzField('Scale', n.scale.toArray(), (v) => { n.scale.fromArray(v); commit('Scale'); }),
    xyzField('Dimensions', dims, (v, i) => { const base = b.max[i] - b.min[i]; if (base > 1e-9) { n.scale.setComponent(i, v[i] / base * Math.sign(n.scale.getComponent(i) || 1)); commit('Dimensions'); refreshSheet(); } }),
  ));
  body.append(h('div', { class: 'card' }, h('h3', {}, 'Shading'), checkInput('Shade smooth', o.mesh.smooth, (v) => { o.mesh.smooth = v; rebuildObject(o); pushUndo(v ? 'Shade Smooth' : 'Shade Flat'); }),
    h('p', { class: 'muted', style: { margin: 0 } }, `${o.mesh.verts.length} vertices · ${o.mesh.faces.length} faces`)));
}
function openOutliner() { openSheet('Scene', buildOutliner, { panel: true, kind: 'outliner' }); }
function buildOutliner(body) {
  if (!S.objects.length) { body.append(h('p', { class: 'muted' }, 'The scene is empty. Use Add to create a mesh.')); return; }
  for (const o of S.objects) {
    const eye = h('button', { class: 'ib', html: icon(o.visible ? 'eye' : 'eyeoff'), 'aria-label': o.visible ? 'Hide ' + o.name : 'Show ' + o.name });
    eye.addEventListener('click', (e) => { e.stopPropagation(); o.visible = !o.visible; o.node.visible = o.visible; if (!o.visible) o.selected = false; pushUndo(o.visible ? 'Reveal' : 'Hide'); onSelectionChanged(); });
    const row = h('div', { class: 'olrow' + (o.selected ? ' sel' : '') + (o === S.active ? ' act' : '') }, h('span', { html: icon('cube'), style: { width: '20px', display: 'grid', color: 'var(--fg-dim)' } }), h('span', { class: 'nm' }, o.name), h('span', { class: 'meta' }, `${o.mesh.faces.length}f`), eye);
    row.addEventListener('click', () => { if (S.mode === 'edit' && o !== S.active) setMode('object'); if (o.visible) selectObject(o, S.selOp); });
    body.append(row);
  }
}
function openModifiers() { openSheet('Modifiers', buildModifiers, { panel: true, kind: 'modifiers' }); }
function beginCreases(o) {
  closeSheet();
  if (S.workspace !== 'model') setWorkspace('model');
  if (S.view !== '3d') setWorkView('3d');
  S.active = o; o.selected = true; S.tool = 'select'; S.pendingTap = null;
  setMode('edit'); setSelectMode('face');
  o.esel = emptySel(); o.activeFace = -1;
  S.creaseEdit = o.id; S.multiSelect = true; S.selOp = 'add';
  buildTools(); buildSubbar(); onSelectionChanged();
  hint('Select faces → Mark Creases → Done · Preview. All edges of each selected face will be creased.');
}
function changeSelectedCreases(mark) {
  const o = S.active;
  if (!o || S.mode !== 'edit' || !o.esel.faces.size) { toast('Select one or more faces first', true); return; }
  const count = markFaceCreases(o.mesh, o.esel.faces, mark);
  if (count) { rebuildObject(o); pushUndo(mark ? 'Mark Creases' : 'Remove Creases'); onSelectionChanged(); }
  toast(count ? `${count} edge${count === 1 ? '' : 's'} ${mark ? 'creased' : 'uncreased'}` : 'No crease changes');
}
function finishCreases() {
  S.creaseEdit = null; S.multiSelect = false; S.selOp = 'set'; hint(null);
  setMode('object'); buildSubbar(); openModifiers();
}
function changeModifiers(o, next, label) {
  try {
    evaluateModifiers(o.mesh, next); // Validate the allocation before changing state.
    o.modifiers = normalizeModifiers(next);
    rebuildObject(o); pushUndo(label); onSelectionChanged(); refreshSheet(true);
  } catch (e) { toast(e.message, true); refreshSheet(true); }
}
function buildModifiers(body) {
  const o = S.active;
  if (!o) { body.append(h('p', { class: 'muted' }, 'Select an object to add a modifier.')); return; }
  if (o.modifierError) body.append(h('p', { class: 'muted' }, o.modifierError + ' Showing the original mesh until you lower the level.'));
  const m = o.modifiers[0];
  if (!m) {
    const add = h('button', { class: 'btn primary' }, h('span', { html: icon('plus') }), 'Add Subdivision Surface');
    add.addEventListener('click', () => changeModifiers(o, [{ type: 'subdivision', levels: 1, boundary: 'keep-corners' }], 'Add Subdivision Surface'));
    body.append(add);
  } else {
    const change = (key, value) => changeModifiers(o, [{ ...o.modifiers[0], [key]: value }], 'Subdivision Settings');
    const card = h('div', { class: 'card' }, h('h3', {}, 'Subdivision Surface'),
      field('Method', selectInput(m.method, [['catmull-clark', 'Catmull–Clark'], ['simple', 'Simple']], (v) => change('method', v), 'Subdivision method')),
      field('Levels', selectInput(m.levels, [0, 1, 2, 3].map((v) => [v, String(v)]), (v) => change('levels', +v), 'Subdivision levels')),
      field('Boundary', selectInput(m.boundary, [['smooth', 'Smooth'], ['keep-corners', 'Keep Corners'], ['keep-boundary', 'Keep All Boundary Edges']], (v) => change('boundary', v), 'Subdivision boundary')),
      checkInput('Enabled in Object Mode and exports', m.enabled, (v) => change('enabled', v)));
    const crease = h('button', { class: 'btn' }, 'Add Creases');
    crease.addEventListener('click', () => beginCreases(o));
    const clear = h('button', { class: 'btn', disabled: !o.mesh.creases?.size }, 'Clear All Creases');
    clear.addEventListener('click', () => { o.mesh.creases.clear(); rebuildObject(o); pushUndo('Clear Creases'); onSelectionChanged(); });
    card.append(h('p', {class: 'muted'}, 'Keep Corners fixes boundary vertices touching one face. Keep All Boundary Edges preserves the whole outline. Simple subdivision already preserves the shape.'),
      h('div', {class: 'row'}, crease, clear),
      h('p', {class: 'muted'}, `${o.mesh.creases?.size || 0} creased edges · Add Creases lets you select faces and mark their edges sharp. Magenta edges show creases in Edit Mode.`));
    const apply = h('button', { class: 'btn primary', disabled: S.mode !== 'object' || !m.enabled }, 'Apply to mesh');
    apply.addEventListener('click', () => {
      try { const mesh = evaluateModifiers(o.mesh, o.modifiers); o.mesh = mesh; o.modifiers = []; o.esel = emptySel(); o.activeFace = -1; S.uvSel.clear(); rebuildObject(o); pushUndo('Apply Subdivision'); onSelectionChanged(); }
      catch (e) { toast(e.message, true); }
    });
    const remove = h('button', { class: 'btn danger' }, 'Remove');
    remove.addEventListener('click', () => changeModifiers(o, [], 'Remove Subdivision'));
    card.append(h('div', { class: 'row' }, apply, remove));
    body.append(card);
  }
  body.append(h('p', { class: 'muted' }, 'Edit Mode keeps the original control mesh. Object Mode and exports use the subdivided surface. Apply in Object Mode to edit the new vertices. UV seams and face materials are preserved.'));
}

function openMaterialPanel() { openSheet('Material', buildMaterialPanel, { panel: true, kind: 'material' }); }
const PALETTE = ['#f2f2f2', '#c9ccd2', '#7d828c', '#2b2e35', '#d8402f', '#f08a24', '#f2c230', '#5fb346', '#2f9e8f', '#3b7dd8', '#7a4fd1', '#d14f9a', '#8a5a3b', '#e8c9a0'];
function ensureMaterial(o) {
  if (o.materials.length && matById(o.materials[S.matSlot])) return matById(o.materials[S.matSlot]);
  const m = newMaterial('Material');
  if (!o.materials.length) { o.materials.push(m.id); S.matSlot = 0; } else o.materials[S.matSlot] = m.id;
  rebuildObject(o);
  return m;
}
function buildMaterialPanel(body) {
  const o = S.active;
  if (!o) { body.append(h('p', { class: 'muted' }, 'Select an object to give it a color or an image texture.')); return; }
  if (S.matSlot >= Math.max(1, o.materials.length)) S.matSlot = 0;
  const cur = () => matById(o.materials[S.matSlot]);
  const mtOrNew = () => cur() || ensureMaterial(o);
  const mt = cur();
  const live = () => { refreshMaterials(); uvRequest(); };
  // ---- slots
  const slots = h('div', { class: 'card' }, h('h3', {}, `Material slots · ${esc(o.name)}`));
  if (!o.materials.length) slots.append(h('p', { class: 'muted', style: { margin: 0 } }, 'No material yet. Pick a base color or upload an image below and one is created.'));
  o.materials.forEach((id, i) => {
    const m = matById(id);
    const im = m && m.texture && m.useTexture !== false ? S.images.get(m.texture) : null;
    const sw = h('span', { class: 'swatch', style: { background: im ? `center/cover url(${im.thumb || (im.thumb = im.el.toDataURL('image/jpeg', 0.5))})` : m ? m.color : '#888' } });
    const row = h('div', { class: 'slot' + (i === S.matSlot ? ' on' : '') }, sw, h('span', { style: { flex: 1, fontSize: '16px' } }, m ? m.name : '(empty)'), h('span', { class: 'muted' }, `slot ${i + 1}`));
    row.addEventListener('click', () => { S.matSlot = i; refreshSheet(); });
    slots.append(row);
  });
  const addSlot = h('button', { class: 'btn' }, h('span', { html: icon('plus') }), 'Add slot');
  addSlot.addEventListener('click', () => { const m = newMaterial('Material', o.materials.length ? PALETTE[(o.materials.length * 3 + 4) % PALETTE.length] : '#c9ccd2'); o.materials.push(m.id); S.matSlot = o.materials.length - 1; rebuildObject(o); pushUndo('Add Material Slot'); refreshSheet(); });
  const rmSlot = h('button', { class: 'btn danger', disabled: !o.materials.length }, h('span', { html: icon('minus') }), 'Remove slot');
  rmSlot.addEventListener('click', () => {
    const i = S.matSlot;
    o.materials.splice(i, 1);
    for (const f of o.mesh.faces) { if (f.mat === i) f.mat = 0; else if (f.mat > i) f.mat--; }
    S.matSlot = Math.max(0, i - 1); rebuildObject(o); pushUndo('Remove Material Slot'); refreshSheet();
  });
  slots.append(h('div', { class: 'row' }, addSlot, rmSlot));
  if (S.mode === 'edit' && o.materials.length > 1) {
    const asg = h('button', { class: 'btn primary' }, 'Assign to selected faces');
    asg.addEventListener('click', () => { const s = o.esel; if (!s.faces.size) { toast('Select faces first', true); return; } for (const fi of s.faces) o.mesh.faces[fi].mat = S.matSlot; rebuildObject(o); pushUndo('Assign Material'); toast(`Assigned to ${s.faces.size} face${s.faces.size > 1 ? 's' : ''}`); });
    const sel = h('button', { class: 'btn' }, 'Select its faces');
    sel.addEventListener('click', () => { const fs = new Set(); o.mesh.faces.forEach((f, i) => { if (f.mat === S.matSlot) fs.add(i); }); setSelFaces(fs); onSelectionChanged(); });
    slots.append(h('div', { class: 'row' }, asg, sel));
  } else if (S.mode === 'object' && o.materials.length > 1) slots.append(h('p', { class: 'muted', style: { margin: 0 } }, 'To give faces different materials, go to Edit Mode, select faces, then tap “Assign”.'));
  body.append(slots);
  const importMat = h('button', { class: 'btn' }, 'Import MTL + images…');
  importMat.addEventListener('click', () => $('#fileMat').click());
  body.append(importMat);
  // ---- which material + name
  if (mt) {
    const pick = selectInput(mt.id, [...S.materials.map((m) => [m.id, m.name]), ['__new', '+ New material']], (v) => {
      if (v === '__new') { const m = newMaterial('Material', mt.color); o.materials[S.matSlot] = m.id; }
      else o.materials[S.matSlot] = +v;
      rebuildObject(o); pushUndo('Change Material'); refreshSheet();
    }, 'Material in this slot');
    const nm = h('input', { type: 'text', 'aria-label': 'Material name', autocomplete: 'off', spellcheck: 'false' });
    nm.value = mt.name;
    nm.addEventListener('change', () => { const v = nm.value.trim(); if (v && v !== mt.name) { mt.name = S.materials.some((x) => x !== mt && x.name === v) ? uniqueMatName(v) : v; pushUndo('Rename Material'); refreshSheet(); } });
    nm.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') nm.blur(); });
    body.append(h('div', { class: 'card' }, h('h3', {}, 'Material'), field('Use', pick), field('Name', nm)));
  }
  // ---- base color: color or image texture
  const mode = mt && mt.texture && mt.useTexture !== false ? 'texture' : 'color';
  const base = h('div', { class: 'card' }, h('h3', {}, 'Base Color'));
  base.append(segButtons(mode, [['color', 'Color'], ['texture', 'Image Texture']], (v) => {
    const m = mtOrNew();
    if (v === 'texture') {
      if (m.texture) { m.useTexture = true; live(); pushUndo('Use Image Texture'); refreshSheet(); }
      else { S._texTarget = m.id; $('#fileTex').click(); }
    } else { m.useTexture = false; live(); pushUndo('Use Base Color'); refreshSheet(); }
  }));
  const colorRow = (label, getVal, setVal, undoLabel) => {
    const col = h('input', { type: 'color', 'aria-label': label });
    col.value = getVal();
    const hex = h('input', { type: 'text', 'aria-label': label + ' hex', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', style: { fontFamily: 'var(--mono)' } });
    hex.value = getVal().toUpperCase();
    col.addEventListener('input', () => { setVal(col.value); hex.value = col.value.toUpperCase(); live(); });
    col.addEventListener('change', () => { pushUndo(undoLabel); refreshSheet(); });
    hex.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') hex.blur(); });
    hex.addEventListener('change', () => { let v = hex.value.trim().replace(/^#?/, '#'); if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v.slice(1).split('').map((c) => c + c).join(''); if (/^#[0-9a-f]{6}$/i.test(v)) { setVal(v.toLowerCase()); live(); pushUndo(undoLabel); refreshSheet(); } else hex.value = getVal().toUpperCase(); });
    const pal = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '6px' } });
    for (const c of PALETTE) {
      const b = h('button', { class: 'swatch', 'aria-label': 'Color ' + c, style: { width: '100%', height: '34px', background: c, cursor: 'pointer', outline: getVal().toLowerCase() === c ? '2px solid var(--sel)' : 'none', outlineOffset: '1px' } });
      b.addEventListener('click', () => { setVal(c); live(); pushUndo(undoLabel); refreshSheet(); });
      pal.append(b);
    }
    return [h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, col, hex), pal];
  };
  if (mode === 'color') {
    base.append(...colorRow('Base color', () => (cur() ? cur().color : DEFAULT_MAT.color), (v) => { mtOrNew().color = v; }, 'Base Color'));
    if (mt && mt.texture) base.append(h('p', { class: 'muted', style: { margin: 0 } }, 'This material still has an image; switch to Image Texture to use it again.'));
  } else {
    const im = S.images.get(mt.texture);
    if (im) {
      base.append(h('div', { class: 'texprev' + (mt.filter === 'nearest' ? ' px' : ''), style: { backgroundImage: `url(${im.thumbBig || (im.thumbBig = im.el.toDataURL('image/png'))})` } }),
        h('p', { class: 'muted', style: { margin: 0 } }, `${im.name} · ${im.width}×${im.height}`));
      let maxSize = 512;
      const size = selectInput(maxSize, [64, 128, 256, 512, 1024, 2048].map((n) => [n, n + ' px']), (v) => { maxSize = +v; }, 'Maximum image size');
      const resize = h('button', { class: 'btn' }, 'Downscale image');
      resize.addEventListener('click', () => { try { if (!downscaleMaterialImage(mt, maxSize)) toast('Image is already within that size'); } catch (e) { toast(e.message, true); } });
      base.append(field('Longest side', size), resize, h('p', { class: 'muted' }, 'Keeps proportions and transparency. Creates a smaller copy for this material; Undo restores the original.'));

    }
    base.append(field('Interpolation', segButtons(mt.filter, [['linear', 'Linear'], ['nearest', 'Closest']], (v) => { mt.filter = v; live(); pushUndo('Interpolation'); refreshSheet(); })),
      field('Extension', segButtons(mt.wrap || 'repeat', [['repeat', 'Repeat'], ['extend', 'Extend']], (v) => { mt.wrap = v; live(); pushUndo('Texture Extension'); })),
      checkInput('Tint with a color', mt.tint, (v) => { mt.tint = v; live(); pushUndo('Tint'); refreshSheet(); }));
    if (mt.tint) base.append(...colorRow('Tint color', () => mt.color, (v) => { mt.color = v; }, 'Tint Color'));
  }
  const up = h('button', { class: 'btn primary' }, h('span', { html: icon('image') }), mode === 'texture' ? 'Replace image…' : 'Upload image…');
  up.addEventListener('click', () => { S._texTarget = mtOrNew().id; $('#fileTex').click(); });
  const gen = h('button', { class: 'btn' }, h('span', { html: icon('grid') }), 'Generate…');
  gen.addEventListener('click', () => { const m = mtOrNew(); menuSheet('Generate Texture', [
    { label: 'UV Grid', icon: 'grid', desc: 'Labelled checker, shows stretching and flips', run: () => setGenerated(m, 'uvgrid') },
    { label: 'Color Grid', icon: 'grid', run: () => setGenerated(m, 'color') },
    { label: 'Checker', icon: 'grid', run: () => setGenerated(m, 'checker') },
  ]); });
  const row = h('div', { class: 'row' }, up, gen);
  if (mode === 'texture') { const rm = h('button', { class: 'btn danger' }, 'Remove image'); rm.addEventListener('click', () => { mt.texture = null; mt.useTexture = false; live(); pushUndo('Remove Texture'); refreshSheet(); }); row.append(rm); }
  base.append(row, h('p', { class: 'muted', style: { margin: 0 } }, 'Images come from Photos, the camera or Files. They are mapped with the UVs; use UV → Unwrap to lay them out.'));
  body.append(base);
  // ---- surface
  if (mt) {
    body.append(h('div', { class: 'card' }, h('h3', {}, 'Surface'),
      field('Shader', selectInput(mt.shader || 'lit', [['lit', 'Lit / PBR preview'], ['unlit', 'Unlit · Wii color/texture']], (v) => { mt.shader = v; live(); pushUndo('Shader'); }, 'Material shader')),
      field('Transparency', selectInput(mt.alphaMode || 'auto', [['auto', 'Automatic'], ['opaque', 'Opaque'], ['cutout', 'Alpha cutout'], ['blend', 'Alpha blend']], (v) => { mt.alphaMode = v; live(); pushUndo('Transparency'); refreshSheet(true); }, 'Transparency mode')),
      mt.alphaMode === 'cutout' ? field('Cutout threshold', sliderInput(mt.alphaCutoff ?? 0.5, 0, 1, 0.01, (v) => { mt.alphaCutoff = v; live(); }, () => pushUndo('Cutout Threshold'))) : null,
      checkInput('Double sided', mt.doubleSided !== false, (v) => { mt.doubleSided = v; live(); pushUndo('Material Sides'); }),
      field('Roughness', sliderInput(mt.roughness, 0, 1, 0.01, (v) => { mt.roughness = v; refreshMaterials(); }, () => pushUndo('Roughness'))),
      field('Metallic', sliderInput(mt.metalness, 0, 1, 0.01, (v) => { mt.metalness = v; refreshMaterials(); }, () => pushUndo('Metallic'))),
      field('Alpha', sliderInput(mt.alpha, 0, 1, 0.01, (v) => { mt.alpha = v; refreshMaterials(); }, () => pushUndo('Alpha'))),
      S.shading === 'solid' || S.shading === 'wire' ? h('p', { class: 'muted', style: { margin: 0 } }, 'Roughness and metallic show in Material Preview shading.') : null));
  }
}
function setGenerated(mt, kind) {
  const img = generateTexture(kind);
  mt.texture = img.id; mt.useTexture = true;
  if (S.shading === 'wire') setShading('solid');
  refreshMaterials(); pushUndo('Generate Texture'); uvRequest();
  openMaterialPanel();
}
$('#fileTex').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const mt = matById(S._texTarget);
  if (!mt) return;
  try {
    toast('Loading image…');
    const img = await loadImageFile(f);
    mt.texture = img.id; mt.useTexture = true;
    if (S.shading === 'wire') setShading('solid');
    refreshMaterials(); pushUndo('Set Texture'); uvRequest(); refreshSheet();
    toast('Texture set · ' + img.name);
  } catch (err) { toast(err.message || 'Could not load that image', true); }
});
$('#fileProj').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { const text = await f.text(); await loadProject(JSON.parse(text)); settingsSet('projectName', f.name.replace(/\.pocketmesh\.json$|\.json$/i, '')); toast('Opened ' + f.name); frameSelected(); }
  catch (err) { toast(err.message || 'Could not open that file', true); }
});
$('#fileObj').addEventListener('change', async (e) => {
  const files = [...(e.target.files || [])]; e.target.value = '';
  if (!files.length) return;
  const before = snapshot(), history = UNDO.stack.slice(), historyIndex = UNDO.idx;
  try {
    const objs = files.filter((f) => /\.obj$/i.test(f.name));
    if (!objs.length) throw new Error('Select an OBJ, with optional MTL and image files');
    if (S.mode === 'edit') setMode('object');
    let count = 0;
    for (const f of objs) count += importOBJText(await f.text(), f.name);
    const materials = await importMaterialFiles(files);
    pushUndo('Import OBJ + Materials'); onSelectionChanged(); frameSelected();
    showImportResult(count + ' object(s), ' + materials.count + ' material(s)', materials.warnings);
  } catch (err) { UNDO.stack = history; UNDO.idx = historyIndex; restore(before); onHistoryChanged(); toast(err.message || 'Could not import', true); }
});
$('#fileMat').addEventListener('change', async (e) => {
  const files = [...(e.target.files || [])]; e.target.value = '';
  if (!files.length) return;
  const before = snapshot();
  try {
    if (!files.some((f) => /\.mtl$/i.test(f.name))) throw new Error('Select an MTL and its image files together');
    const result = await importMaterialFiles(files);
    pushUndo('Import Materials'); onSelectionChanged();
    showImportResult(result.count + ' material(s)', result.warnings);
  } catch (e) { restore(before); toast(e.message, true); }
});
function showImportResult(summary, warnings) {
  if (!warnings.length) { toast('Imported ' + summary); return; }
  openSheet('Import results', (body) => {
    body.append(h('p', {}, 'Imported ' + summary), ...warnings.map((w) => h('p', { class: 'muted' }, w)));
  });
}
function exportUVLayout() {
  if (!S.active || !S.active.mesh.faces.length) { toast('Select an object with faces', true); return; }
  const c = uvLayoutCanvas(settingsGet('uvLayoutSize', 1024));
  shareOrDownload(safeFileName(S.active.name) + '_UV.png', new Blob([canvasBytes(c, 'image/png')], { type: 'image/png' }));
}
function openExport() { openSheet('Export', buildExport, { panel: true, kind: 'export' }); }
function buildExport(body) {
  const st = settingsGet('export', { fmt: 'fbx', applyTransforms: false, triangulate: false, yUp: true, zip: false });
  const anySel = selectedObjects().length > 0;
  if (st.selectedOnly === undefined) st.selectedOnly = anySel;
  // BRRES gets its own explicit scope preference. Old exports automatically
  // saved selectedOnly=true, which could silently omit the rest of a track.
  const selectedOnly = st.fmt === 'brres' ? st.brresSelectedOnly === true : st.selectedOnly;
  const save = () => settingsSet('export', st);
  const notes = {
    brres: 'Wii model + textures (course, MDL0 v11). For RiiStudio, BrawlCrate and noclip. A playable track also needs KCL collision, KMP race data and an SZS package.',
    obj: 'Wavefront OBJ + MTL. Comes as a .zip with its textures; tap the zip in Files to unpack it.',
    fbx: 'Binary FBX 7.4 with textures embedded. Opens in Blender, Unity, Unreal, Maya.',
    dae: 'COLLADA 1.4.1. Comes as a .zip with its textures when it has any.',
    glb: 'glTF 2.0 binary, everything in one file. Best for web, AR Quick Look tools, Godot.',
    gltf: 'glTF 2.0 text file with embedded data.',
  };
  const fmts = [['brres', 'BRRES'], ['obj', 'OBJ'], ['fbx', 'FBX'], ['dae', 'DAE'], ['glb', 'GLB'], ['gltf', 'glTF']];
  const card = h('div', { class: 'card' }, h('h3', {}, 'Format'), segButtons(st.fmt, fmts, (v) => { st.fmt = v; save(); refreshSheet(); }), h('p', { class: 'muted', style: { margin: 0 } }, notes[st.fmt]));
  const nameIn = h('input', { type: 'text', 'aria-label': 'File name', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' });
  nameIn.value = st.fmt === 'brres' ? settingsGet('brresName', 'course_model') : settingsGet('exportName', (S.active && S.active.name) || 'model');
  nameIn.addEventListener('change', () => settingsSet(st.fmt === 'brres' ? 'brresName' : 'exportName', nameIn.value));
  nameIn.addEventListener('keydown', (e) => e.stopPropagation());
  const opts = h('div', { class: 'card' }, h('h3', {}, 'Options'), field('File name', nameIn),
    checkInput(`Selected objects only${anySel ? '' : ' (nothing selected)'}`, selectedOnly && anySel, (v) => { if (st.fmt === 'brres') st.brresSelectedOnly = v; else st.selectedOnly = v; save(); refreshSheet(true); }),
    st.fmt === 'brres' ? null : checkInput('Apply object transforms', st.applyTransforms, (v) => { st.applyTransforms = v; save(); }),
    st.fmt === 'brres' ? null : checkInput('Triangulate faces', st.triangulate || st.fmt === 'glb' || st.fmt === 'gltf', (v) => { st.triangulate = v; save(); }),
    st.fmt === 'brres' || st.fmt === 'glb' || st.fmt === 'gltf' ? null : checkInput('Y axis up (most apps expect this)', st.yUp, (v) => { st.yUp = v; save(); }),
    checkInput('Always wrap in a .zip', st.zip, (v) => { st.zip = v; save(); }));
  if (st.fmt === 'brres') opts.append(
    h('p', { class: 'muted', id: 'brresScope' }, `${selectedOnly && anySel ? 'Selected visible objects' : 'All visible objects'}: ${S.objects.filter((o) => o.visible && (!(selectedOnly && anySel) || o.selected)).length}. Includes their assigned materials and image textures together in one BRRES. Color-only materials are included too.`),
    field('Wii units per model unit', numInput(S.track.scale, (v) => { st.scale = v; save(); setTrackScale(v); }, { min: 0.001, max: 100000 })),
    field('Maximum texture size', selectInput(st.textureSize || 512, [64, 128, 256, 512, 1024].map((v) => [v, v + ' px']), (v) => { st.textureSize = +v; save(); }, 'BRRES texture size')),
    h('p', { class: 'muted' }, 'Exports evaluated modifiers, applies transforms and converts Z-up to Wii Y-up. Textures are resized to power-of-two dimensions and embedded as RGBA8. Basic unlit color/texture, cutout and alpha blend are supported; PBR lighting and metallic effects are not exported.'));
  const go = h('button', { class: 'btn primary', style: { height: '46px', fontSize: '17px', justifyContent: 'center' } }, h('span', { html: icon('export') }), st.fmt === 'brres' ? 'Export & Send BRRES…' : 'Export & Save…');
  go.addEventListener('click', () => {
    try {
      const base = safeFileName(nameIn.value, 'model');
      const r = runExport(st.fmt, { selectedOnly: selectedOnly && anySel, applyTransforms: st.applyTransforms, triangulate: st.triangulate, yUp: st.yUp, zip: st.zip, baseName: base, scale: S.track.scale, textureSize: st.textureSize });
      shareOrDownload(r.name, r.data);
      const kb = (r.data.length || r.data.byteLength || 0) / 1024;
      $('#exportInfo').textContent = `${r.name} · ${kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(kb)) + ' KB'}${r.count > 1 ? ` · ${r.count} files inside` : ''}`;
    } catch (err) { console.error(err); toast(err.message || 'Export failed', true); }
  });
  body.append(card, opts, go, h('p', { class: 'muted', id: 'exportInfo', style: { margin: '0 4px' } }, 'The iOS share sheet opens: choose “Save to Files”, AirDrop, or another app.'));
}
function openSettings(focus) {
  openSheet('Settings', (body) => {
    const snap = h('div', { class: 'card' }, h('h3', {}, 'Snap increments'),
      field('Move', numInput(S.snapMove, (v) => { S.snapMove = Math.max(1e-4, v); settingsSet('snapMove', S.snapMove); gizmoSync(); }, { min: 0.0001 })),
      field('Rotate (°)', numInput(S.snapRot, (v) => { S.snapRot = Math.max(0.01, v); settingsSet('snapRot', S.snapRot); gizmoSync(); }, { min: 0.01 })),
      field('Scale', numInput(S.snapScale, (v) => { S.snapScale = Math.max(1e-4, v); settingsSet('snapScale', S.snapScale); gizmoSync(); }, { min: 0.0001 })));
    const prop = h('div', { class: 'card', id: 'setProp' }, h('h3', {}, 'Proportional editing'),
      checkInput('Enabled', S.prop, (v) => { S.prop = v; buildSubbar(); }),
      field('Radius', numInput(S.propRadius, (v) => { S.propRadius = Math.max(0.001, v); settingsSet('propRadius', S.propRadius); buildSubbar(); }, { min: 0.001 })),
      field('Falloff', selectInput(S.propFalloff, [['smooth', 'Smooth'], ['sphere', 'Sphere'], ['root', 'Root'], ['sharp', 'Sharp'], ['linear', 'Linear'], ['constant', 'Constant']], (v) => { S.propFalloff = v; settingsSet('propFalloff', v); }, 'Falloff')));
    const nav = h('div', { class: 'card' }, h('h3', {}, 'Touch navigation'),
      segButtons(S.navStyle, [['modeler', 'Modeling'], ['map', 'Map style']], (v) => { S.navStyle = v; settingsSet('navStyle', v); refreshSheet(); }),
      h('p', { class: 'muted', style: { margin: 0 } }, S.navStyle === 'map'
        ? 'One finger pans. Two fingers: pinch to zoom, twist to turn, slide up or down to tilt. Orbit freely by dragging the axis ball.'
        : 'One finger orbits. Two fingers: drag to pan, pinch to zoom, twist to turn the view.'));
    const view = h('div', { class: 'card' }, h('h3', {}, 'Viewport'),
      checkInput('Show floor grid', S.showGrid, (v) => { S.showGrid = v; gridGroup.visible = v && S.shading !== 'rendered'; settingsSet('grid', v); requestRender(); }),
      checkInput('Backface overlay (subtle red)', S.faceOrient, setBackfaceOverlay),
      field('UV layout size', selectInput(settingsGet('uvLayoutSize', 1024), [[512, '512 px'], [1024, '1024 px'], [2048, '2048 px'], [4096, '4096 px']], (v) => settingsSet('uvLayoutSize', +v), 'UV layout size')));
    body.append(...(focus === 'prop' ? [prop, nav, snap, view] : [nav, snap, prop, view]));
    body.append(h('p', { class: 'muted', style: { margin: '2px 4px' } }, 'PocketMesh 1.0 · works offline · your scene autosaves on this device.'));
  }, { panel: true, kind: 'settings' });
}
function openInstallHint() {
  openSheet('Install PocketMesh', (body) => {
    body.append(h('div', { class: 'welcome' },
      h('div', {}, 'Make it a real app on your Home Screen: it opens full-screen, works offline and keeps your work.'),
      h('div', {}, h('b', {}, '1.'), ' Tap the ', h('b', {}, 'Share'), ' button in Safari (the square with an arrow).'),
      h('div', {}, h('b', {}, '2.'), ' Scroll down and tap ', h('b', {}, 'Add to Home Screen'), ', then ', h('b', {}, 'Add'), '.'),
      h('div', {}, h('b', {}, '3.'), ' Open ', h('b', {}, 'PocketMesh'), ' from your Home Screen.'),
      h('div', { class: 'muted' }, 'Work you do in Safari stays in Safari. Start your models in the installed app.')));
    const go = h('button', { class: 'btn' }, 'Show gestures & tips');
    go.addEventListener('click', openHelp);
    body.append(go);
  });
}
function openHelp() {
  openSheet('Gestures & Tips', (body) => {
    const tip = (a, b) => h('div', {}, h('b', {}, a), ' ', b);
    body.append(h('div', { class: 'welcome' },
      tip('One finger drag', 'orbits the view. Tap selects.'),
      tip('Two fingers', 'drag to pan, pinch to zoom, twist to turn the view. Two-finger tap undoes, three-finger tap redoes.'),
      tip('Map style', 'in Settings makes one finger pan like a maps app.'),
      tip('Axis ball (top right)', 'tap an axis for front, side or top view; tap again for the opposite side.'),
      tip('Move / Rotate / Scale', 'buttons on the bottom shelf start a Blender-style transform: drag anywhere, lock X / Y / Z, type an exact number, then Done.'),
      tip('Gizmo tools', 'on the left show handles you drag directly.'),
      tip('Edit Mode', 'models the active object. Pick vertex, edge or face selection at the top.'),
      tip('Double-tap an edge', 'selects its whole edge loop.'),
      tip('Set / Add / Sub', 'controls whether taps and box selections replace, add to or remove from the selection.'),
      tip('Adjust Last Operation', 'appears bottom-left after adding shapes or using tools: change segments, cuts, margins and more.'),
      tip('Multiselect', 'Hold a vertex, edge, face or object for a moment, then tap to add or remove more. Tap Done in the top bar to finish.'),
      tip('Modifiers', 'The wrench opens Subdivision Surface. Edit the control mesh in Edit Mode; preview and export the smooth result in Object Mode.'),
      tip('Textures', 'Material → Choose image, then UV → Unwrap. Use the UV view (top-right button) to straighten and pack.'),
      tip('UV view', 'pinch to zoom, twist to rotate the view (clicks to 0/90/180/270°). The UV Rotate tool clicks to the same angles.'),
      tip('Keyboard', 'works too: Tab, G R S, X Y Z, E, I, Ctrl R, A, F, M, U, Shift A, Shift D, Ctrl Z.'),
    ));
  }, { kind: 'help' });
}

// ---------- adjust last operation panel ----------
showRedoPanel = () => {
  const op = LAST.op; if (!op) return;
  const panel = $('#redo');
  $('#redoTitle').textContent = op.label;
  const body = $('#redoBody'); body.innerHTML = '';
  for (const f of op.schema) {
    let ctl;
    const set = (v) => { const p = { ...LAST.op.params, [f.k]: v }; redoLast(p); };
    if (f.options) ctl = selectInput(op.params[f.k] ?? f.def, f.options, (v) => set(v), f.label);
    else if (f.type === 'bool') { const c = h('input', { type: 'checkbox' }); c.checked = !!(op.params[f.k] ?? f.def); c.addEventListener('change', () => set(c.checked)); ctl = h('label', { class: 'check', style: { minHeight: '30px' } }, c); }
    else ctl = numInput(op.params[f.k] ?? f.def, (v) => set(v), { int: !!f.int, min: f.min ?? -Infinity, max: f.max ?? Infinity, label: f.label });
    body.append(field(f.label, ctl));
  }
  panel.hidden = false;
};
hideRedoPanel = () => { $('#redo').hidden = true; };

// ---------- hooks ----------
onSelectionChanged = () => {
  trackRefresh();
  for (const o of S.objects) refreshOverlays(o);
  refreshOriginDots();
  updateStats();
  gizmoSync();
  uvRequest();
  refreshSheet();
};
onModeChanged = () => {
  if (S.creaseEdit && (S.mode !== 'edit' || S.active?.id !== S.creaseEdit || S.workspace !== 'model')) { S.creaseEdit = null; S.multiSelect = false; S.selOp = 'set'; hint(null); }
  buildSubbar();
  $('#modeLbl').textContent = S.mode === 'edit' ? 'Edit' : 'Object';
  $('#selModes').hidden = S.workspace !== 'model' || S.mode !== 'edit';
  for (const b of document.querySelectorAll('#selModes button')) b.classList.toggle('on', b.dataset.sm === S.selectMode);
  buildShelf();
  refreshSheet();
};
onHistoryChanged = () => {
  $('#btnUndo').disabled = UNDO.idx <= 0;
  $('#btnRedo').disabled = UNDO.idx >= UNDO.stack.length - 1;
  if (LAST.op && LAST.op.idx !== UNDO.idx) { LAST.op = null; hideRedoPanel(); }
  scheduleAutosave();
};
afterRestore = () => { onModeChanged(); onSelectionChanged(); buildSubbar(); };
const _origSetSelectMode = setSelectMode;
setSelectMode = function (m) { _origSetSelectMode(m); onModeChanged(); };

// ---------- 3D viewport gestures ----------
const G = { p: new Map(), mode: null, maxPointers: 0, t0: 0, moved: false, lastTap: null };
function cancelHold() { clearTimeout(G.holdTimer); G.holdTimer = null; }
function beginHold(e, p) {
  cancelHold();
  if (S.workspace !== 'model' || e.button !== 0 || TF.active || PM.active || S.pendingTap || !['select', 'move', 'rotate', 'scale'].includes(S.tool)) return;
  const object = S.active, mode = S.mode, selectMode = S.selectMode, tool = S.tool;
  G.holdTimer = setTimeout(() => {
    if (G.p.size !== 1 || G.mode !== 'pending' || G.moved || S.active !== object || S.mode !== mode || S.selectMode !== selectMode || TF.active || PM.active || S.pendingTap || S.tool !== tool) return;
    const el = S.mode === 'edit' && S.active ? pickElement(p.x, p.y, e.pointerType === 'mouse' ? 14 : 28) : null;
    const ob = S.mode === 'object' ? pickObject(p.x, p.y) : null;
    if (!el && !ob) return;
    S.selOp = 'add'; S.multiSelect = true; S.tool = 'select'; buildTools();
    if (el) {
      // A hold always adds its target; subsequent taps toggle it.
      const selected = el.type === 'vert' ? object.esel.verts.has(el.i) : el.type === 'edge' ? object.esel.edges.has(el.key) : object.esel.faces.has(el.i);
      if (!selected) toggleInSel(el, 'add');
    } else { ob.selected = true; S.active = ob; }
    G.mode = 'held'; G.lastTap = null;
    buildSubbar(); onSelectionChanged();
    hint('Multiselect · tap to add/remove · Done to finish');
    if (navigator.vibrate) navigator.vibrate(15);
  }, 450);
}
function rel(e, el = c3d) { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function twoInfo() { const [a, b] = [...G.p.values()]; return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) }; }
function twistView(dth) { CAM.anim = null; CAM.yaw += CAM.pitch < -0.01 ? -dth : dth; CAM.viewName = null; applyCamera(); }
c3d.addEventListener('contextmenu', (e) => e.preventDefault());
c3d.addEventListener('pointerdown', (e) => {
  cancelHold();
  S.focus = '3d';
  if (S.view === 'split' && $('#shelf').dataset.focus !== '3d') { $('#shelf').dataset.focus = '3d'; buildShelf(); }
  if (tc.enabled && (tc.dragging || tc.axis)) return;
  if (document.activeElement && document.activeElement.blur && document.activeElement !== document.body) document.activeElement.blur();
  try { c3d.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  const p = rel(e);
  G.p.set(e.pointerId, { x: p.x, y: p.y, x0: p.x, y0: p.y, type: e.pointerType });
  G.maxPointers = Math.max(G.maxPointers, G.p.size);
  if (G.p.size === 1) {
    G.t0 = performance.now(); G.moved = false; G.maxPointers = 1;
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) G.mode = e.shiftKey ? 'pan' : e.ctrlKey ? 'zoom' : 'orbit';
    else if (e.pointerType === 'mouse' && TF.active) G.mode = 'tfclick';
    else G.mode = 'pending';
    if (G.mode === 'pending') beginHold(e, p);
  } else if (G.p.size === 2) {
    if (G.mode === 'box') { $('#boxrect').hidden = true; }
    G.mode = 'two'; G.two = twoInfo(); G.twist = 0; G.twisting = false;
  } else G.mode = 'multi';
});
c3d.addEventListener('pointermove', (e) => {
  const p = rel(e);
  if (!G.p.has(e.pointerId)) {
    if (S.tool === 'ruler' && G.p.size === 0 && !TF.active && !PM.active) { RULER.hover = rulerPick(p.x,p.y,18); requestRender(); }
    // desktop: modal transforms follow the hovering mouse like Blender
    if (e.pointerType === 'mouse' && TF.active && G.p.size === 0) {
      if (G.hover) tfDrag(p.x - G.hover.x, p.y - G.hover.y);
      G.hover = p;
    } else if (e.pointerType === 'mouse' && PM.active && G.p.size === 0) { if (G.hover) pmDrag(p.x - G.hover.x); G.hover = p; }
    return;
  }
  if (tc.dragging) return;
  const pt = G.p.get(e.pointerId);
  const dx = p.x - pt.x, dy = p.y - pt.y;
  pt.x = p.x; pt.y = p.y;
  if (Math.hypot(p.x - pt.x0, p.y - pt.y0) > (e.pointerType === 'mouse' ? 4 : 9)) G.moved = true;
  if (G.moved) { cancelHold(); if (S.tool === 'ruler') RULER.hover = null; }
  if (G.mode === 'two' && G.p.size === 2) {
    const t = twoInfo();
    let dth = Math.atan2(Math.sin(t.ang - G.two.ang), Math.cos(t.ang - G.two.ang));
    G.twist += dth;
    if (!G.twisting && Math.abs(G.twist) > 0.08) { G.twisting = true; dth = G.twist; }
    if (S.navStyle === 'map') {
      // map style: pinch zooms, twist turns, sliding both fingers up/down tilts
      CAM.pitch = clamp(CAM.pitch + (t.my - G.two.my) * 0.008, -Math.PI / 2, Math.PI / 2);
      if (CAM.autoOrtho) { CAM.ortho = false; CAM.autoOrtho = false; updateViewButtons(); }
      applyCamera();
    } else pan(t.mx - G.two.mx, t.my - G.two.my);
    if (G.two.d > 10 && t.d > 10) zoom(G.two.d / t.d);
    if (G.twisting && dth) twistView(dth);
    G.two = t; CAM.viewName = CAM.ortho && CAM.autoOrtho && !G.twisting ? CAM.viewName : null;
    return;
  }
  if (G.mode === 'pending' && G.moved) {
    if (TF.active) G.mode = 'tf';
    else if (PM.active) G.mode = 'pm';
    else if (S.tool === 'box' && !S.pendingTap) { G.mode = 'box'; G.box = { x0: pt.x0, y0: pt.y0 }; }
    else G.mode = S.navStyle === 'map' ? 'pan' : 'orbit';
    if (G.mode === 'tf') tfDrag(p.x - pt.x0, p.y - pt.y0);
    if (G.mode === 'pm') pmDrag(p.x - pt.x0);
    return;
  }
  if (G.mode === 'tfclick') { tfDrag(dx, dy); return; }
  if (G.mode === 'tf') tfDrag(dx, dy);
  else if (G.mode === 'pm') pmDrag(dx);
  else if (G.mode === 'orbit') { orbit(dx, dy); CAM.viewName = null; }
  else if (G.mode === 'pan') pan(dx, dy);
  else if (G.mode === 'zoom') zoom(Math.exp(dy * 0.01));
  else if (G.mode === 'box') {
    const b = $('#boxrect');
    const x0 = Math.min(G.box.x0, p.x), y0 = Math.min(G.box.y0, p.y);
    Object.assign(b.style, { left: x0 + 'px', top: y0 + 'px', width: Math.abs(p.x - G.box.x0) + 'px', height: Math.abs(p.y - G.box.y0) + 'px' });
    b.hidden = false;
    G.box.x1 = p.x; G.box.y1 = p.y;
  }
});
function endPointer(e) {
  cancelHold();
  if (!G.p.has(e.pointerId)) return;
  const pt = G.p.get(e.pointerId);
  G.p.delete(e.pointerId);
  if (G.p.size > 0) { if (G.mode === 'two' && G.p.size === 1) G.mode = 'none'; return; }
  const quick = performance.now() - G.t0 < 320;
  if (e.type === 'pointerup') {
    if (G.maxPointers === 2 && !G.moved && quick && G.mode !== 'box') { if (TF.active) tfCancel(); else if (PM.active) pmCancel(); else undo(); }
    else if (G.maxPointers >= 3 && !G.moved && quick) redo();
    else if (G.mode === 'pending' && !G.moved) handleTap(pt.x, pt.y, pt.type);
    else if (G.mode === 'tfclick' && !G.moved) tfConfirm();
    else if (G.mode === 'box' && G.box && G.box.x1 !== undefined) boxSelect(G.box, S.selOp);
  }
  $('#boxrect').hidden = true;
  G.mode = null; G.maxPointers = 0;
}
c3d.addEventListener('pointerup', endPointer);
c3d.addEventListener('pointercancel', endPointer);
c3d.addEventListener('lostpointercapture', endPointer);
function cancelViewportGesture() { cancelHold(); G.p.clear(); G.mode = null; $('#boxrect').hidden = true; }
window.addEventListener('blur', cancelViewportGesture);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelViewportGesture(); });
c3d.addEventListener('wheel', (e) => { e.preventDefault(); if (e.ctrlKey) zoom(Math.exp(e.deltaY * 0.01)); else zoom(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());

function handleTap(x, y, ptype) {
  if (TF.active || PM.active) return;
  if (S.workspace !== 'model') { trackTap(x,y); return; }
  const radius = ptype === 'mouse' ? 14 : 28;
  if (S.pendingTap === 'loopcut') { loopCutAt(x, y); return; }
  if (S.pendingTap === 'loop' || S.pendingTap === 'ring') { loopSelectAt(x, y, S.pendingTap, S.selOp); return; }
  if (S.tool === 'ruler') { rulerTap(x,y,radius); return; }
  if (S.tool === 'cursor') { placeCursor(x, y); return; }
  const now = performance.now();
  const dbl = !S.multiSelect && G.lastTap && now - G.lastTap.t < 350 && Math.hypot(x - G.lastTap.x, y - G.lastTap.y) < 24;
  G.lastTap = { t: now, x, y };
  if (S.mode === 'edit' && S.active) {
    if (dbl && S.selectMode !== 'vert') { G.lastTap = null; loopSelectAt(x, y, 'loop', S.selOp === 'sub' ? 'sub' : 'add'); return; }
    if (dbl && S.selectMode === 'vert') { const el = pickEdgeAny(x, y); if (el) { G.lastTap = null; loopSelectAt(x, y, 'loop', 'add'); return; } }
    const el = pickElement(x, y, radius);
    if (el) toggleInSel(el, S.selOp);
    else if (S.selOp === 'set') S.active.esel = emptySel();
    onSelectionChanged();
  } else {
    const o = pickObject(x, y);
    if (o) selectObject(o, S.selOp);
    else if (S.selOp === 'set') { for (const x2 of S.objects) x2.selected = false; onSelectionChanged(); }
  }
}
function placeCursor(x, y) {
  const vis = S.objects.filter((o) => o.visible);
  const hits = S.shading !== 'wire' ? screenRay(x, y).intersectObjects(vis.map((o) => o.meshNode), false) : [];
  if (hits.length) S.cursor.copy(hits[0].point);
  else {
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    const p = rayPlane(x, y, S.cursor.clone(), n) || rayPlane(x, y, new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
    if (p) S.cursor.copy(p);
  }
  refreshOriginDots();
  toast(`Cursor ${fmt(S.cursor.x, 2)}, ${fmt(S.cursor.y, 2)}, ${fmt(S.cursor.z, 2)}`);
}
function boxSelect(b, op) {
  const xa = Math.min(b.x0, b.x1), xb = Math.max(b.x0, b.x1), ya = Math.min(b.y0, b.y1), yb = Math.max(b.y0, b.y1);
  const inside = (x, y) => x >= xa && x <= xb && y >= ya && y <= yb;
  if (S.mode === 'edit' && S.active) {
    const o = S.active, m = o.mesh, SP = projectMeshVerts(o);
    const vin = new Set();
    for (let i = 0; i < m.verts.length; i++) if (SP[i * 4 + 3] && inside(SP[i * 4], SP[i * 4 + 1])) vin.add(i);
    const seeAll = S.xray || S.shading === 'wire';
    const vis = (local) => seeAll || pointVisible(o, local);
    if (op === 'set') o.esel = emptySel();
    const s = o.esel;
    if (S.selectMode === 'vert') {
      for (const v of vin) if (vis(m.verts[v])) op === 'sub' ? s.verts.delete(v) : s.verts.add(v);
    } else if (S.selectMode === 'edge') {
      for (const [a, c] of topo(m).edges) if (vin.has(a) && vin.has(c) && vis(vlerp(m.verts[a], m.verts[c], 0.5))) { const k = a + '_' + c; op === 'sub' ? s.edges.delete(k) : s.edges.add(k); }
    } else {
      m.faces.forEach((f, i) => {
        const c = faceCenter(m, f);
        const w = new THREE.Vector3(...c).applyMatrix4(o.node.matrixWorld);
        const sp = toScreen(w);
        if (!inside(sp.x, sp.y)) return;
        if (!seeAll) { const n = vadd(c, vscale(faceNormal(m, f), 1e-4)); if (!pointVisible(o, n) && !pointVisible(o, c)) return; }
        op === 'sub' ? s.faces.delete(i) : s.faces.add(i);
      });
    }
    flushSel();
  } else {
    if (op === 'set') for (const o of S.objects) o.selected = false;
    for (const o of S.objects) {
      if (!o.visible) continue;
      const SP = projectMeshVerts(o);
      let hit = false;
      const n = o.mesh.verts.length, step = Math.max(1, Math.floor(n / 400));
      for (let i = 0; i < n && !hit; i += step) if (SP[i * 4 + 3] && inside(SP[i * 4], SP[i * 4 + 1])) hit = true;
      if (!n) { const s = toScreen(o.node.position); hit = inside(s.x, s.y); }
      if (hit) { o.selected = op !== 'sub'; if (o.selected) S.active = o; }
    }
  }
  onSelectionChanged();
}

// ---------- UV view gestures ----------
const UG = { p: new Map(), mode: null, maxPointers: 0, t0: 0, moved: false };
function uvTwoInfo() { const [a, b] = [...UG.p.values()]; return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) }; }
cuv.addEventListener('contextmenu', (e) => e.preventDefault());
cuv.addEventListener('pointerdown', (e) => {
  if (S.focus !== 'uv') { S.focus = 'uv'; buildShelf(); }
  try { cuv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  const p = rel(e, cuv);
  UG.p.set(e.pointerId, { x: p.x, y: p.y, x0: p.x, y0: p.y, type: e.pointerType });
  UG.maxPointers = Math.max(UG.maxPointers, UG.p.size);
  if (UG.p.size === 1) { UG.t0 = performance.now(); UG.moved = false; UG.maxPointers = 1; UG.mode = e.pointerType === 'mouse' && e.button !== 0 ? 'pan' : 'pending'; }
  else if (UG.p.size === 2) { if (UVD) { uvDragEnd(); } UV.box = null; UG.mode = 'two'; UG.two = uvTwoInfo(); UG.twist = 0; UG.twisting = false; UG.rotRaw = UV.rot; }
});
cuv.addEventListener('pointermove', (e) => {
  if (!UG.p.has(e.pointerId)) return;
  const p = rel(e, cuv), pt = UG.p.get(e.pointerId);
  const dx = p.x - pt.x, dy = p.y - pt.y;
  pt.x = p.x; pt.y = p.y;
  if (Math.hypot(p.x - pt.x0, p.y - pt.y0) > 6) UG.moved = true;
  if (UG.mode === 'two' && UG.p.size === 2) {
    const t = uvTwoInfo();
    // pan with the midpoint, pinch to zoom, twist to rotate the view (snaps to 0/90/180/270°)
    UV.ox += t.mx - UG.two.mx; UV.oy += t.my - UG.two.my;
    const f = UG.two.d > 10 && t.d > 10 ? t.d / UG.two.d : 1;
    let dth = Math.atan2(Math.sin(t.ang - UG.two.ang), Math.cos(t.ang - UG.two.ang));
    UG.twist += dth;
    if (!UG.twisting && Math.abs(UG.twist) > 0.08) { UG.twisting = true; dth = UG.twist; }
    if (!UG.twisting) dth = 0;
    UG.rotRaw += dth;
    const nr = magnet90(UG.rotRaw), applied = nr - UV.rot;
    const c = Math.cos(applied), sn = Math.sin(applied), dx = UV.ox - t.mx, dy = UV.oy - t.my;
    UV.ox = t.mx + (dx * c - dy * sn) * f; UV.oy = t.my + (dx * sn + dy * c) * f;
    UV.scale = clamp(UV.scale * f, 20, 200000);
    setUVRot(nr);
    UG.two = t; uvRequest(); return;
  }
  if (UG.mode === 'pending' && UG.moved) {
    if (S.uvTool === 'box') { UG.mode = 'box'; UV.box = { x0: pt.x0, y0: pt.y0, x1: p.x, y1: p.y }; }
    else if (['move', 'rotate', 'scale'].includes(S.uvTool) && S.active && uvDragStart(pt.x0, pt.y0)) { UG.mode = 'drag'; uvDragMove(p.x, p.y); }
    else UG.mode = 'pan';
    return;
  }
  if (UG.mode === 'pan') { UV.ox += dx; UV.oy += dy; uvRequest(); }
  else if (UG.mode === 'box') { UV.box.x1 = p.x; UV.box.y1 = p.y; uvRequest(); }
  else if (UG.mode === 'drag') uvDragMove(p.x, p.y);
});
function uvEnd(e) {
  if (!UG.p.has(e.pointerId)) return;
  const pt = UG.p.get(e.pointerId);
  UG.p.delete(e.pointerId);
  if (UG.p.size) { if (UG.mode === 'two') UG.mode = 'none'; return; }
  const quick = performance.now() - UG.t0 < 320;
  if (e.type === 'pointerup') {
    if (UG.maxPointers === 2 && !UG.moved && quick) undo();
    else if (UG.maxPointers >= 3 && !UG.moved && quick) redo();
    else if (UG.mode === 'pending' && !UG.moved && S.active) uvTap(pt.x, pt.y, S.selOp);
    else if (UG.mode === 'box' && UV.box) uvBoxSelect(UV.box, S.selOp);
  }
  if (UG.mode === 'drag') uvDragEnd();
  UV.box = null; UG.mode = null; UG.maxPointers = 0; uvRequest();
}
cuv.addEventListener('pointerup', uvEnd);
cuv.addEventListener('pointercancel', uvEnd);
cuv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = rel(e, cuv), f = Math.exp(-e.deltaY * 0.0015);
  UV.ox = p.x + (UV.ox - p.x) * f; UV.oy = p.y + (UV.oy - p.y) * f; UV.scale *= f; uvRequest();
}, { passive: false });

// ---------- keyboard (iPad keyboards, desktop) ----------
document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const k = e.key, ctrl = e.ctrlKey || e.metaKey;
  if (TF.active) {
    const t = TF.active;
    if (k === 'Escape') { tfCancel(); e.preventDefault(); return; }
    if (k === 'Enter') { tfConfirm(); e.preventDefault(); return; }
    if (/^[xyzXYZ]$/.test(k)) { tfSetAxis('xyz'.indexOf(k.toLowerCase()), e.shiftKey); e.preventDefault(); return; }
    if (/^[0-9.\-]$/.test(k) || k === 'Backspace') {
      if (k === 'Backspace') t.num = t.num.slice(0, -1); else if (k === '-') t.num = t.num.startsWith('-') ? t.num.slice(1) : '-' + t.num; else t.num += k;
      const n = $('#tfNum'); if (n) n.value = t.num;
      tfUpdate(); e.preventDefault(); return;
    }
    if (k === 'g' || k === 'r' || k === 's') { const kind = { g: 'move', r: 'rotate', s: 'scale' }[k]; if (kind !== t.kind) { tfCancel(); tfStart(kind); } e.preventDefault(); return; }
    return;
  }
  if (PM.active) { if (k === 'Escape') pmCancel(); if (k === 'Enter') pmConfirm(); return; }
  if (!$('#sheet').hidden && k === 'Escape') { closeSheet(); return; }
  if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (ctrl && k === 'y') { e.preventDefault(); redo(); return; }
  if (e.code && e.code.startsWith('Numpad')) {
    const map = { Numpad1: ctrl ? 'back' : 'front', Numpad3: ctrl ? 'left' : 'right', Numpad7: ctrl ? 'bottom' : 'top' };
    if (map[e.code]) { setView(map[e.code]); CAM.viewName = map[e.code]; e.preventDefault(); return; }
    if (e.code === 'Numpad5') { toggleOrtho(); return; }
    if (e.code === 'NumpadDecimal') { frameSelected(); return; }
  }
  if (S.workspace !== 'model') {
    if (k === 'Home') { S.workspace === 'kmp' && S.track.start ? trackFocusStart() : frameSelected(); return; }
    if (k === 'Escape') { trackTool('select'); return; }
    if (!ctrl && !e.altKey) { const tool = {g:'move',r:'rotate',s:'scale'}[k.toLowerCase()]; if (tool && !(S.workspace === 'kmp' && tool === 'scale')) trackTool(tool); }
    return;
  }
  const edit = S.mode === 'edit';
  const lk = k.toLowerCase();
  if (k === 'Tab') { e.preventDefault(); setMode(edit ? 'object' : 'edit'); return; }
  if (k === 'Home') { frameSelected(); return; }
  if (edit && ['1', '2', '3'].includes(k) && !ctrl) { setSelectMode(['vert', 'edge', 'face'][+k - 1]); return; }
  if (S.view === 'uv' || (S.view === 'split' && S.focus === 'uv')) {
    if (lk === 'a' && !e.altKey) { uvSelectAll('all'); return; }
    if (lk === 'a' && e.altKey) { uvSelectAll('none'); return; }
    if (lk === 'u') { menuUnwrap(); return; }
  }
  if (e.shiftKey && lk === 'a') { menuAdd(); return; }
  if (e.shiftKey && lk === 'd') { opDuplicate(); return; }
  if (e.shiftKey && lk === 's') { menuSnap(); return; }
  if (e.shiftKey && lk === 'n' && edit) { opNormals(ctrl ? 'inside' : 'outside'); return; }
  if (e.altKey && lk === 's' && edit) { tfStart('shrink'); return; }
  if (e.altKey && lk === 'e' && edit) { opExtrudeIndividual(); return; }
  if (e.altKey && lk === 'f' && edit) { opFill('tri'); return; }
  if (e.altKey && lk === 'j' && edit) { opTrisToQuads(); return; }
  if (e.altKey && lk === 'a') { opSelect('none'); return; }
  if (e.altKey && lk === 'h') { opHide('reveal'); return; }
  if (ctrl && lk === 'r' && edit) { e.preventDefault(); opLoopCutStart(); return; }
  if (ctrl && lk === 'i') { e.preventDefault(); opSelect('invert'); return; }
  if (ctrl && lk === 'l' && edit) { e.preventDefault(); opSelect('linked'); return; }
  if (ctrl && lk === 't' && edit) { e.preventDefault(); opTriangulate(); return; }
  if (ctrl && lk === 'j' && !edit) { e.preventDefault(); opJoin(); return; }
  if (ctrl && lk === 'a' && !edit) { e.preventDefault(); menuApply(); return; }
  if (ctrl && (k === '+' || k === '=') && edit) { e.preventDefault(); opSelect('more'); return; }
  if (ctrl && k === '-' && edit) { e.preventDefault(); opSelect('less'); return; }
  if (ctrl || e.altKey) return;
  switch (lk) {
    case 'g': tfStart('move'); break;
    case 'r': tfStart('rotate'); break;
    case 's': tfStart('scale'); break;
    case 'a': opSelect('all'); break;
    case 'x': case 'delete': edit ? menuDelete() : opDelete(); break;
    case 'e': if (edit) opExtrude(); break;
    case 'i': if (edit) opInset(); break;
    case 'f': if (edit) opFill('ngon'); break;
    case 'm': if (edit) menuMerge(); break;
    case 'u': if (edit) menuUVFrom3D(); break;
    case 'p': if (edit) opSeparate('selected'); break;
    case 'n': openProps(); break;
    case 'h': if (!edit) opHide('hide'); break;
    case 'escape': S.pendingTap = null; if (S.tool === 'ruler') { if (RULER.first) rulerResetPending(); else rulerDone(); } hint(null); break;
  }
});

// ---------- boot ----------
function loadSettings() {
  S.orient = settingsGet('orient', 'global');
  S.pivot = settingsGet('pivot', 'median');
  S.snap = settingsGet('snap', false);
  S.snapMove = settingsGet('snapMove', 0.1); S.snapRot = settingsGet('snapRot', 5); S.snapScale = settingsGet('snapScale', 0.1);
  S.propRadius = settingsGet('propRadius', 1); S.propFalloff = settingsGet('propFalloff', 'smooth');
  S.shading = settingsGet('shading', 'solid');
  S.faceOrient = settingsGet('backfaceOverlay', true) !== false;
  S.showGrid = settingsGet('grid', true);
  S.navStyle = settingsGet('navStyle', 'modeler');
}
async function boot() {
  loadSettings();
  buildSubbar(); buildTools(); buildNavButtons(); buildShadebar();
  applyShadingEnv();
  gridGroup.visible = S.showGrid && S.shading !== 'rendered';
  const restored = await loadAutosave();
  if (!restored) newScene();
  setWorkView(settingsGet('view', '3d'));
  onModeChanged(); onSelectionChanged(); onHistoryChanged();
  applyCamera();
  requestAnimationFrame(frame);
  (function uvLoop() { requestAnimationFrame(uvLoop); if (S.view !== '3d') uvDraw(); })();
  window.addEventListener('resize', () => { requestRender(); uvRequest(); });
  c3d.addEventListener('webglcontextlost', (e) => { e.preventDefault(); }, false);
  c3d.addEventListener('webglcontextrestored', () => {
    for (const im of S.images.values()) for (const tex of im.textures?.values() || []) tex.needsUpdate = true;
    envTex = null; applyShadingEnv();
    for (const o of S.objects) rebuildObject(o);
    refreshAllObjects(); requestRender();
  }, false);
  const standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS && !standalone && !settingsGet('installHinted', false)) { settingsSet('installHinted', true); openInstallHint(); }
  else if (!settingsGet('welcomed', false)) { settingsSet('welcomed', true); openHelp(); }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) toast('PocketMesh updated. Close and reopen the app to use the new version.'); });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clearTimeout(_saveT); try { idbSet('autosave', JSON.stringify(serializeProject())); } catch (e) { /* best effort */ } } });
  window.UV_dbg = () => ({ scale: UV.scale, rot: UV.rot / DEG }); window.UV_s = (u, v) => u2s(u, v);
  window.__pm = { setBackfaceOverlay, setShading, SZED, loadSZSEditor, szsApplyProject, szsWorker, inspectSZS, saveSZS, szsEntryBytes, tc, gizmoProxy, trackTool, trackAction, setWorkspace, trackTriangles, TRACKVIEW, trackRefresh, trackSnapStart, trackToWii, exportKMP, inspectKMP, exportKCL, pushUndo, S, CAM, UNDO, RULER, rulerPick, rulerTap, rulerActivate, openRuler, BRED, openBRRESEditor, loadBRRESEditor, saveBRRESEdits, decodeBRRESTexture, inspectBRRES, serializeProject, loadProject, undo, redo, rebuildObject, changeModifiers, downscaleMaterialImage, addImageFromCanvas, importMaterialFiles, editSelectAll, applyCamera, tfAxisVec: () => TF.active && tfAxisVec(TF.active), runExport, tfStart, tfConfirm, setMode, setSelectMode, opExtrude, opUnwrap, primCube, topo, faceCenter, faceNormal,
    screenOf: (x, y, z) => { const o = S.active; const v = new THREE.Vector3(x, y, z); if (o) v.applyMatrix4(o.node.matrixWorld); const s = toScreen(v); const r = c3d.getBoundingClientRect(); return { x: s.x + r.left, y: s.y + r.top }; } };
}
boot();
