const { chromium, devices } = require('playwright');
const fs = require('fs');
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
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
  await page.goto('http://localhost:8765/');
  await sleep(1200);
  await page.click('#sheetClose');
  const drag = (sel, pts, id = 11) => page.evaluate(({ sel, pts, id }) => {
    const el = document.querySelector(sel);
    const ev = (type, p) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: p.x, clientY: p.y, bubbles: true, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    ev('pointerdown', pts[0]); for (const p of pts.slice(1)) ev('pointermove', p); ev('pointerup', pts[pts.length - 1]);
  }, { sel, pts, id });
  const tap = (p) => drag('#c3d', [p]);
  const st = () => page.evaluate(() => { const S = __pm.S, o = S.active; return { mode: S.mode, v: o.mesh.verts.length, f: o.mesh.faces.length, sv: o.esel.verts.size, sf: o.esel.faces.size, se: o.esel.edges.size, tf: !!document.querySelector('#tfbar:not([hidden])') }; });
  const shelf = (label) => page.click(`#shelf button:has-text("${label}")`);
  const menuItem = (label) => page.click(`#sheetBody .mi:has(.t:text-is("${label}"))`);
  await shelf('Edit Mode'); await sleep(200);
  ok((await st()).mode === 'edit', 'entered edit mode');
  await page.click('#selModes button[data-sm=face]');
  await page.evaluate(() => { __pm.S.active.esel = { verts: new Set(), edges: new Set(), faces: new Set() }; });
  const top = await page.evaluate(() => __pm.screenOf(0, 0, 1));
  await tap(top); await sleep(100);
  let s = await st();
  ok(s.sf === 1, 'tap selected top face (faces selected: ' + s.sf + ')');
  await shelf('Extrude'); await sleep(100);
  ok((await st()).tf, 'extrude started modal move');
  await drag('#c3d', [{ x: 200, y: 500 }, { x: 200, y: 470 }, { x: 200, y: 420 }]);
  const info = await page.textContent('#tfInfo');
  await page.click('#tfbar .ok'); await sleep(100);
  s = await st();
  ok(s.v === 12 && s.f === 10 && !s.tf, `extrude result v=${s.v} f=${s.f} (info: ${info})`);
  const zTop = await page.evaluate(() => { const o = __pm.S.active; const f = o.mesh.faces[[...o.esel.faces][0]]; return Math.min(...f.v.map((v) => o.mesh.verts[v][2])); });
  ok(zTop > 1.05, 'extruded face moved up along normal, z=' + zTop.toFixed(3));
  await page.screenshot({ path: SHOTS + '/10-extrude.png' });
  await shelf('Inset'); await sleep(100);
  await drag('#c3d', [{ x: 150, y: 500 }, { x: 190, y: 500 }, { x: 230, y: 500 }]);
  await page.click('#tfbar .ok'); await sleep(100);
  s = await st();
  ok(s.f === 14 && s.sf === 1, `inset result f=${s.f} sel=${s.sf}`);
  ok(await page.isVisible('#redo'), 'adjust-last-operation panel shows after inset');
  // redo panel: change thickness
  await page.click('#redoTitle');
  const th = await page.$('#redoBody input');
  await th.fill('0.3'); await th.press('Enter'); await sleep(150);
  s = await st();
  ok(s.f === 14, 'redo panel re-ran inset with thickness 0.3');
  await page.screenshot({ path: SHOTS + '/11-inset.png' });
  // loop cut on the front vertical edge
  await shelf('Loop Cut'); await sleep(100);
  const edge = await page.evaluate(() => __pm.screenOf(1, -1, 0));
  await tap(edge); await sleep(150);
  ok((await st()).tf, 'loop cut modal opened');
  await page.click('#tfbar .ok'); await sleep(100);
  s = await st();
  ok(s.f === 18, `loop cut added 4 faces f=${s.f}`);
  await page.screenshot({ path: SHOTS + '/12-loopcut.png' });
  // select all + subdivide
  await shelf('Select'); await menuItem('All'); await sleep(100);
  s = await st();
  ok(s.sf === s.f, 'select all faces');
  await shelf('Subdivide'); await sleep(150);
  s = await st();
  ok(s.f > 18, `subdivide f=${s.f}`);
  await page.click('#btnUndo'); await sleep(150);
  s = await st();
  ok(s.f === 18, `undo subdivide f=${s.f}`);
  // unwrap
  await shelf('UV'); await menuItem('Smart UV Project'); await sleep(300);
  const uvOk = await page.evaluate(() => { const m = __pm.S.active.mesh; let bad = 0, n = 0; for (const f of m.faces) for (const u of f.uv) { n++; if (!Number.isFinite(u[0]) || !Number.isFinite(u[1]) || u[0] < -1e-6 || u[0] > 1 + 1e-6 || u[1] < -1e-6 || u[1] > 1 + 1e-6) bad++; } return { bad, n }; });
  ok(uvOk.bad === 0, `smart project UVs valid (${uvOk.n} corners, ${uvOk.bad} bad)`);
  await page.click('#btnView'); await sleep(400);
  await page.screenshot({ path: SHOTS + '/13-split.png' });
  // Unwrap conformal with seams: mark seams on cube? just run it
  await shelf('UV'); await menuItem('Unwrap'); await sleep(400);
  const uv2 = await page.evaluate(() => { const m = __pm.S.active.mesh; let bad = 0; for (const f of m.faces) for (const u of f.uv) if (!Number.isFinite(u[0]) || !Number.isFinite(u[1])) bad++; return bad; });
  ok(uv2 === 0, 'conformal unwrap finite');
  // material + generated texture
  await shelf('Material'); await sleep(150);

  await page.click('#sheetBody button:has-text("Generate")'); await sleep(100);
  await menuItem('UV Grid'); await sleep(400);
  ok(await page.evaluate(() => __pm.S.materials.some((m) => m.texture) && !!__pm.S.active.meshNode.material[0].map), 'generated texture shows on the mesh');
  await page.click('#sheetClose');
  await page.screenshot({ path: SHOTS + '/14-textured.png' });
  // UV-only view, straighten grid on selected
  await page.click('#btnView'); await sleep(300);
  await page.click('#shelf button:has-text("Straighten")'); await menuItem('Straighten Grid'); await sleep(300);
  await page.screenshot({ path: SHOTS + '/15-uv.png' });
  await page.click('#btnView'); await sleep(300);
  // back to object mode and export each format
  await page.evaluate(() => __pm.setMode('object')); await sleep(150);
  const sizes = {};
  for (const fmt of ['OBJ', 'FBX', 'DAE', 'GLB', 'glTF']) {
    await page.click('#btnMenu'); await menuItem('Export Model…'); await sleep(150);
    await page.click(`#sheetBody .segrow button:text-is("${fmt}")`); await sleep(100);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#sheetBody button:has-text("Export & Save")')]);
    const p = SHOTS + '/' + dl.suggestedFilename();
    await dl.saveAs(p);
    sizes[fmt] = dl.suggestedFilename() + ' ' + fs.statSync(p).size;
    await page.click('#sheetClose');
  }
  ok(Object.keys(sizes).length === 5, 'exported: ' + JSON.stringify(sizes));
  // gestures: pinch zoom changes distance, two-finger tap undoes
  const d0 = await page.evaluate(() => __pm.CAM.dist);
  await page.evaluate(() => {
    const el = document.querySelector('#c3d');
    const ev = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
    ev('pointerdown', 1, 150, 400); ev('pointerdown', 2, 250, 400);
    for (let i = 1; i <= 10; i++) { ev('pointermove', 1, 150 - i * 5, 400); ev('pointermove', 2, 250 + i * 5, 400); }
    ev('pointerup', 1, 100, 400); ev('pointerup', 2, 300, 400);
  });
  const d1 = await page.evaluate(() => __pm.CAM.dist);
  ok(d1 < d0 * 0.8, `pinch zoom in: ${d0.toFixed(2)} -> ${d1.toFixed(2)}`);
  // project save
  await page.click('#btnMenu');
  const [pj] = await Promise.all([page.waitForEvent('download'), menuItem('Save Project')]);
  await pj.saveAs(SHOTS + '/project.json');
  ok(fs.statSync(SHOTS + '/project.json').size > 1000, 'project saved ' + fs.statSync(SHOTS + '/project.json').size + ' bytes');
  // reload restores autosave
  await sleep(1600);
  const before = await page.evaluate(() => __pm.S.objects[0].mesh.faces.length);
  await page.reload(); await sleep(1500);
  const after = await page.evaluate(() => __pm.S.objects[0] && __pm.S.objects[0].mesh.faces.length);
  ok(before === after, `autosave restored after reload (${before} faces -> ${after})`);
  await page.screenshot({ path: SHOTS + '/16-reloaded.png' });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
