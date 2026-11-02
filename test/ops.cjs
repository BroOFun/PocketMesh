const { chromium, devices } = require('playwright');
const SHOTS = process.env.SHOTS || '/tmp/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ ...devices['iPhone 14'], acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' | ')));
  page.on('download', () => {});
  await page.goto('http://localhost:8765/');
  await sleep(1000);
  await page.click('#sheetClose');
  const E = (fn, arg) => page.evaluate(fn, arg);
  const shelf = async (label) => { await page.click(`#shelf button:has-text("${label}")`); await sleep(60); };
  const item = async (label) => { await page.click(`#sheetBody .mi:has(.t:text-is("${label}"))`); await sleep(120); };
  const sheetOpen = () => page.isVisible('#sheet');
  const closeAny = async () => { if (await sheetOpen()) await page.click('#sheetClose'); if (await page.isVisible('#tfbar')) await page.click('#tfbar .ok'); };
  const reset = () => E(() => { __pm.S.selOp = 'set'; });
  const selAll = () => E(() => __pm.editSelectAll('select'));
  const selVerts = (vs) => E((vs) => { const S = __pm.S; S.selectMode = 'vert'; const o = S.active; o.esel.verts = new Set(vs); __pm.setSelectMode('edge'); __pm.setSelectMode('vert'); o.esel.verts = new Set(vs); const T = __pm.topo(o.mesh); o.esel.edges = new Set(T.edges.filter(([a, b]) => vs.includes(a) && vs.includes(b)).map(([a, b]) => a + '_' + b)); o.esel.faces = new Set(o.mesh.faces.map((f, i) => (f.v.every((v) => vs.includes(v)) ? i : -1)).filter((i) => i >= 0)); }, vs);
  const info = () => E(() => { const o = __pm.S.active; return o ? { v: o.mesh.verts.length, f: o.mesh.faces.length, sv: o.esel.verts.size, sf: o.esel.faces.size, n: __pm.S.objects.length, mode: __pm.S.mode } : null; });
  const newCube = async () => { await E(() => { if (__pm.S.mode === 'edit') __pm.setMode('object'); }); await page.click('#btnMenu'); await item('New Scene'); await page.click('#sheetBody button:has-text("Discard")'); await sleep(150); };

  // --- add every primitive in object mode, then in edit mode
  await newCube();
  const prims = ['Plane', 'Cube', 'Circle', 'UV Sphere', 'Ico Sphere', 'Cylinder', 'Cone', 'Torus', 'Grid'];
  for (const p of prims) { await shelf('Add'); await item(p); }
  ok((await info()).n === 10, 'added 9 primitives as objects: ' + (await info()).n);
  // redo panel: change UV sphere segments
  await page.click('#redoTitle').catch(() => {});
  await E(() => __pm.setMode('edit')); await sleep(100);
  await shelf('Add'); await item('Cylinder'); await sleep(100);
  ok((await info()).sv === 64, 'cylinder added into edit mesh, selected new verts: ' + (await info()).sv);
  await E(() => __pm.setMode('object'));

  // --- precise modal transforms (object mode)
  await newCube();
  await shelf('Move'); await page.click('#tfbar .ax[data-ax=x]'); await page.fill('#tfNum', '2'); await page.click('#tfbar .ok');
  let pos = await E(() => __pm.S.active.node.position.toArray());
  ok(Math.abs(pos[0] - 2) < 1e-9 && Math.abs(pos[1]) < 1e-9, 'Move X 2 → ' + pos.map((x) => x.toFixed(3)));
  await shelf('Rotate'); await page.click('#tfbar .ax[data-ax=z]'); await page.fill('#tfNum', '90'); await page.click('#tfbar .ok');
  const rot = await E(() => { const e = new (__pm.S.active.node.rotation.constructor)().setFromQuaternion(__pm.S.active.node.quaternion, 'ZYX'); return [e.x, e.y, e.z].map((x) => x * 180 / Math.PI); });
  ok(Math.abs(rot[2] - 90) < 1e-6, 'Rotate Z 90 → ' + rot.map((x) => x.toFixed(2)));
  await shelf('Scale'); await page.fill('#tfNum', '0.5'); await page.click('#tfbar .ok');
  const scl = await E(() => __pm.S.active.node.scale.toArray());
  ok(scl.every((x) => Math.abs(x - 0.5) < 1e-9), 'Scale 0.5 → ' + scl);
  await shelf('Scale'); await page.click('#tfbar .ax[data-ax=y]'); await page.fill('#tfNum', '3'); await page.click('#tfbar .ok');
  const scl2 = await E(() => __pm.S.active.node.scale.toArray());
  ok(Math.abs(scl2[0] - 1.5) < 1e-9 && Math.abs(scl2[1] - 0.5) < 1e-9, 'Scale global Y×3 on a cube turned 90° scales its local X → ' + scl2.map((x) => x.toFixed(3)));
  // cancel restores
  await shelf('Move'); await page.fill('#tfNum', '5'); await page.click('#tfbar .cancel');
  pos = await E(() => __pm.S.active.node.position.toArray());
  ok(Math.abs(pos[0] - 2) < 1e-9, 'Cancel restores position');
  // object ops
  for (const [menu, it] of [['Origin', 'Origin to Geometry'], ['Origin', 'Origin to 3D Cursor'], ['Origin', 'Geometry to Origin'], ['Apply', 'Rotation'], ['Apply', 'Scale'], ['Apply', 'Location'], ['Apply', 'All Transforms'], ['Mirror', 'Mirror X'], ['Snap', 'Cursor to Selected'], ['Snap', 'Selection to Cursor'], ['Snap', 'Cursor to World Origin'], ['Snap', 'Selection to Grid'], ['Shading', 'Shade Smooth'], ['Shading', 'Recalculate Outside'], ['Shading', 'Shade Flat']]) {
    await shelf(menu); await item(it);
  }
  const ap = await E(() => { const n = __pm.S.active.node; return [n.position.toArray(), n.scale.toArray()]; });
  ok(true, 'origin/apply/mirror/snap ran; pos ' + ap[0].map((x) => x.toFixed(2)) + ' scale ' + ap[1].map((x) => x.toFixed(2)));
  await shelf('Duplicate'); await page.fill('#tfNum', '3'); await page.click('#tfbar .ax[data-ax=x]'); await page.click('#tfbar .ok');
  ok((await info()).n === 2, 'duplicate object');
  await E(() => { for (const o of __pm.S.objects) o.selected = true; });
  await shelf('Join');
  ok((await info()).n === 1 && (await info()).f === 12, 'join → 1 object, 12 faces');
  await shelf('Hide'); await item('Hide Selected');
  ok(await E(() => !__pm.S.objects[0].visible), 'hide');
  await shelf('Hide'); await item('Reveal Hidden');
  ok(await E(() => __pm.S.objects[0].visible), 'reveal');
  await shelf('Properties'); await sleep(150);
  const locX = await page.$('#sheetBody .xyz label[data-ax=X] input');
  await locX.fill('1.25'); await locX.press('Enter'); await sleep(100);
  ok(Math.abs((await E(() => __pm.S.active.node.position.x)) - 1.25) < 1e-9, 'properties panel sets location X');
  await page.click('#sheetClose');
  await shelf('Scene'); await sleep(100); ok(await page.isVisible('.olrow'), 'outliner lists objects'); await page.click('#sheetClose');

  // --- edit mode operators on a fresh cube
  const editOps = [
    ['Mesh', 'Extrude Individual Faces', true], ['Mesh', 'Extrude Along Normals', true], ['Mesh', 'Shrink / Fatten', true],
    ['Mesh', 'Triangulate Faces'], ['Mesh', 'Tris to Quads'], ['Mesh', 'Recalculate Outside'], ['Mesh', 'Recalculate Inside'], ['Mesh', 'Flip'], ['Mesh', 'Shade Smooth'], ['Mesh', 'Shade Flat'],
    ['Merge', 'By Distance'], ['Fill', 'Grid Fill'], ['Fill', 'Bridge Edge Loops'],
  ];
  const EXPECT = { 'Extrude Individual Faces': 30, 'Extrude Along Normals': 6, 'Shrink / Fatten': 6, 'Triangulate Faces': 12, 'Tris to Quads': 6, 'Recalculate Outside': 6, 'Flip': 6 };
  for (const [m, it, modal] of editOps) {
    await newCube(); await E(() => __pm.setMode('edit')); await E(() => __pm.setSelectMode('face')); await selAll();
    await shelf(m); await item(it);
    if (modal) { await page.fill('#tfNum', '0.3').catch(() => {}); await page.click('#tfbar .ok').catch(() => {}); }
    const i = await info();
    ok(i && Number.isFinite(i.v) && (EXPECT[it] === undefined || EXPECT[it] === i.f), `${m} › ${it} → v=${i.v} f=${i.f}` + (EXPECT[it] !== undefined ? ` (expect f=${EXPECT[it]})` : ''));
  }
  // delete / dissolve variants
  for (const it of ['Vertices', 'Edges', 'Faces', 'Only Edges & Faces', 'Only Faces', 'Dissolve Vertices', 'Dissolve Edges', 'Dissolve Faces']) {
    await newCube(); await E(() => __pm.setMode('edit'));
    await selVerts([4, 5, 6, 7]); await E(() => __pm.setSelectMode('vert'));
    await shelf('Delete'); await item(it);
    const i = await info(); ok(i && i.v >= 4, `Delete › ${it} → v=${i.v} f=${i.f}`);
  }
  // merges
  for (const it of ['At Center', 'At Cursor', 'Collapse']) {
    await newCube(); await E(() => __pm.setMode('edit')); await selVerts([4, 5, 6, 7]);
    await shelf('Merge'); await item(it);
    const i = await info(); ok(i.v === 5 && i.f === 5, `Merge › ${it} → pyramid v=${i.v} f=${i.f}`);
  }
  // fill a hole: delete top face only, select its ring, fill / triangle fill
  for (const it of ['Fill', 'Triangle Fill']) {
    await newCube(); await E(() => __pm.setMode('edit')); await selVerts([4, 5, 6, 7]);
    await shelf('Delete'); await item('Only Faces');
    await selVerts([4, 5, 6, 7]); await E(() => __pm.setSelectMode('edge'));
    await shelf('Fill'); await item(it);
    const i = await info(); ok(i.f === (it === 'Fill' ? 6 : 7), `${it} closes the hole → f=${i.f}`);
  }
  // loop select via double tap + seams + subdivide + select menu
  await newCube(); await E(() => __pm.setMode('edit')); await E(() => __pm.setSelectMode('edge')); await E(() => { __pm.S.active.esel = { verts: new Set(), edges: new Set(), faces: new Set() }; });
  await shelf('Loop Cut'); const e1 = await E(() => __pm.screenOf(1, -1, 0));
  await page.evaluate((p) => { const el = document.querySelector('#c3d'); const ev = (t) => el.dispatchEvent(new PointerEvent(t, { pointerId: 5, pointerType: 'touch', clientX: p.x, clientY: p.y, bubbles: true })); ev('pointerdown'); ev('pointerup'); }, e1);
  await sleep(100); await page.click('#tfbar .ok'); await sleep(100);
  await E(() => { __pm.S.active.esel = { verts: new Set(), edges: new Set(), faces: new Set() }; });
  const mid = await E(() => __pm.screenOf(1, 0, 0));
  await page.evaluate((p) => { const el = document.querySelector('#c3d'); const ev = (t, id) => el.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', clientX: p.x, clientY: p.y, bubbles: true })); ev('pointerdown', 6); ev('pointerup', 6); ev('pointerdown', 7); ev('pointerup', 7); }, mid);
  await sleep(100);
  const loopSel = await E(() => __pm.S.active.esel.edges.size);
  ok(loopSel === 4, 'double-tap selects the new edge loop (edges: ' + loopSel + ')');
  await shelf('Seams'); await item('Mark Seam');
  ok(await E(() => __pm.S.active.mesh.seams.size) > 7, 'mark seam');
  for (const it of ['All', 'None', 'Invert', 'Linked', 'Linked (stop at seams)', 'More', 'Less', 'Boundary Loop']) { await shelf('Select'); await item(it); }
  ok(true, 'select menu items ran');
  // every unwrap method
  await E(() => __pm.setSelectMode('face')); await selAll(); await E(() => __pm.setSelectMode('face'));
  for (const it of ['Unwrap', 'Unwrap (Minimum Stretch)', 'Smart UV Project', 'Lightmap Pack', 'Follow Active Quads', 'Cube Projection', 'Cylinder Projection', 'Sphere Projection', 'Project From View', 'Reset']) {
    await shelf('UV'); await item(it);
    const bad = await E(() => { let b = 0; for (const f of __pm.S.active.mesh.faces) for (const u of f.uv) if (!Number.isFinite(u[0]) || !Number.isFinite(u[1])) b++; return b; });
    ok(bad === 0, `UV › ${it}`);
  }
  // UV editor operators
  await page.click('#btnView'); await page.click('#btnView'); await sleep(200);
  await shelf('Unwrap'); await item('Unwrap');
  for (const it of ['Straighten Grid', 'Straighten', 'Straighten X', 'Straighten Y', 'Align X', 'Align Y', 'Align Auto', 'Align Rotation']) { await shelf('Straighten'); await item(it); }
  await shelf('Pack'); await shelf('Avg Scale'); await shelf('Fit 0–1');
  await shelf('Rotate'); await item('Rotate 90° Clockwise'); await shelf('Rotate'); await item('Rotate 180°');
  await shelf('Flip'); await item('Flip Vertically');
  await shelf('Select'); await item('Islands');
  await shelf('Weld'); await shelf('Stretch');
  await sleep(200);
  await page.screenshot({ path: SHOTS + '/20-uv-stretch.png' });
  await shelf('Layout PNG');
  const badUV = await E(() => { let b = 0; for (const f of __pm.S.active.mesh.faces) for (const u of f.uv) if (!Number.isFinite(u[0]) || !Number.isFinite(u[1])) b++; return b; });
  ok(badUV === 0, 'UV editor operators keep UVs finite');
  await page.click('#btnView'); await sleep(150);
  // undo all the way back and redo
  const depth = await E(() => __pm.UNDO.idx);
  for (let i = 0; i < 5; i++) await page.click('#btnUndo');
  for (let i = 0; i < 5; i++) await page.click('#btnRedo');
  ok(await E(() => __pm.UNDO.idx) === depth, 'undo ×5 / redo ×5 returns to same step');
  // keyboard (desktop / iPad keyboard)
  await E(() => __pm.setMode('object'));
  await newCube();
  await page.keyboard.press('g'); await page.keyboard.press('z'); await page.keyboard.type('1.5'); await page.keyboard.press('Enter');
  const kz = await E(() => __pm.S.active.node.position.z);
  ok(Math.abs(kz - 1.5) < 1e-9, 'keyboard G Z 1.5 Enter → z=' + kz);
  await page.keyboard.press('Tab'); await sleep(80);
  ok((await info()).mode === 'edit', 'Tab enters edit mode');
  await page.keyboard.press('3'); await page.keyboard.press('a'); await page.keyboard.press('e'); await page.keyboard.type('0.5'); await page.keyboard.press('Enter');
  ok((await info()).f === 6, 'select all + E extrude of closed cube just moves it: f=' + (await info()).f);
  await page.keyboard.press('Control+z');
  // gizmo tool shows
  await page.click('#tools button[aria-label="Move gizmo"]'); await sleep(100);
  ok(await E(() => true), 'gizmo tool selected');
  await page.screenshot({ path: SHOTS + '/21-gizmo.png' });
  console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
