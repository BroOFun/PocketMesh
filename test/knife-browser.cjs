const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const {chromium, devices} = require('playwright');
(async () => {
  const root = path.resolve(__dirname, '../docs');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {res.writeHead(404); res.end(); return;}
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  try {
    for (const layout of (process.env.KNIFE_LAYOUT ? [process.env.KNIFE_LAYOUT] : ['desktop', 'phone', 'landscape'])) {
      const mobile = layout !== 'desktop';
      const ctx = await browser.newContext({...(mobile ? devices['iPhone 14'] : {viewport: {width: 1200, height: 850}}), ...(layout === 'landscape' ? {viewport: {width: 844, height: 390}} : {}), serviceWorkers: 'block'});
      await ctx.addInitScript(() => {localStorage.setItem('pm_welcomed', 'true'); localStorage.setItem('pm_installHinted', 'true');});
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__pm);
      assert.equal(await page.getByRole('button', {name: 'Knife tool · K', exact: true}).count(), 0, 'Knife is edit-only');
      const load = async (kind = 'plane') => {
        await page.evaluate(async ({kind, layout}) => {
          const p = __pm, d = p.serializeProject(); d.objects = d.objects.slice(0,1);
          const mesh = kind === 'cube' ? p.primCube() : {verts: [[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]], faces: [{v: [0,1,2,3], uv: [[0,0],[1,0],[1,1],[0,1]], mat: 0}], looseEdges: [], seams: [], creases: []};
          d.objects[0].mesh = {...mesh, seams: [...mesh.seams], creases: [...mesh.creases]};
          d.objects[0].selected = true; d.objects[0].pos = [0,0,0]; d.objects[0].quat = [0,0,0,1]; d.objects[0].scl = [1,1,1];
          d.camera = {target: [0,0,0], yaw: 0, pitch: Math.PI / 2, dist: layout === 'landscape' ? 3.7 : 6, ortho: true};
          await p.loadProject(d); p.setMode('edit');
        }, {kind, layout});
      };
      const start = () => page.getByRole('button', {name: 'Knife tool · K', exact: true}).click();
      const point = p => page.evaluate(p => __pm.screenOf(...p), p);
      const tap = async (p, offset = [0,0]) => {
        const s = await point(p); s.x += offset[0]; s.y += offset[1];
        if (mobile) await page.touchscreen.tap(s.x, s.y); else await page.mouse.click(s.x, s.y);
      };
      const state = () => page.evaluate(() => ({verts: __pm.S.active.mesh.verts, faces: __pm.S.active.mesh.faces}));
      const apply = () => page.getByRole('button', {name: 'Apply knife cuts', exact: true}).click();
      await load(); const initial = await state();
      await start();
      await tap([-1,-1,0], [7,-4]);
      assert.deepEqual(await page.evaluate(() => __pm.KNIFE.first.point), [-1,-1,0], 'Offset input magnetizes exactly to the vertex');
      assert.equal(await page.evaluate(() => __pm.KNIFE.first.kind), 'Vertex');
      await tap([1,1,0], [-6,4]);
      assert.equal(await page.evaluate(() => __pm.KNIFE.mesh.faces.length), 2);
      await start(); assert.equal(await page.evaluate(() => __pm.KNIFE.mesh.faces.length), 2, 'Reselecting Knife keeps the preview');
      assert.deepEqual(await state(), initial, 'Preview does not change the source');
      assert.deepEqual(await page.evaluate(() => __pm.serializeProject().objects[0].mesh.faces), initial.faces, 'Saving during preview excludes uncommitted cuts');
      fs.mkdirSync('work', {recursive: true});
      await page.screenshot({path: `work/knife-${layout}.png`, animations: 'disabled'});
      await page.getByRole('button', {name: 'Cancel knife cuts', exact: true}).click();
      assert.deepEqual(await state(), initial);
      await start(); await tap([-1,-1,0], [7,-4]); await tap([1,1,0], [-6,4]); await apply();
      const applied = await state(); assert.equal(applied.faces.length, 2); assert.equal(applied.verts.length, 4);
      assert.equal(await page.evaluate(() => __pm.UNDO.stack[__pm.UNDO.idx].label), 'Knife cut');
      await page.locator('#btnUndo').click(); assert.deepEqual(await state(), initial);
      await page.locator('#btnRedo').click(); assert.deepEqual(await state(), applied);
      await page.locator('#btnUndo').click();
      // Cut an edge, then cross the preview with another cut. New preview edges
      // are snap targets, but project geometry only changes once on Apply.
      await start(); await tap([-1,0,0]); await tap([1,0,0]);
      assert.equal(await page.evaluate(() => __pm.KNIFE.hover.kind), 'Edge');
      await page.getByRole('button', {name: 'New cut', exact: true}).click();
      await tap([0,-1,0]); await tap([0,1,0]);
      assert.equal(await page.evaluate(() => __pm.KNIFE.mesh.faces.length), 4);
      await page.locator('#btnUndo').click();
      assert.equal(await page.evaluate(() => __pm.KNIFE.mesh.faces.length), 2);
      await tap([0,1,0]); await apply();
      assert.equal((await state()).faces.length, 4); assert.equal((await state()).verts.length, 9);
      await page.locator('#btnUndo').click(); assert.deepEqual(await state(), initial);
      // Switching tool/editor or pressing Escape discards a pending knife cut.
      await start(); await tap([-1,-1,0]); await tap([1,1,0]);
      await page.getByRole('button', {name: 'Move gizmo', exact: true}).click(); assert.deepEqual(await state(), initial);
      assert.equal(await page.evaluate(() => __pm.KNIFE.mesh), null);
      await page.keyboard.press('k'); assert.equal(await page.evaluate(() => __pm.S.tool), 'knife');
      await tap([-1,-1,0]); await tap([1,1,0]); await page.keyboard.press('Escape'); assert.deepEqual(await state(), initial);
      await start(); await tap([-1,-1,0]); await tap([1,1,0]); await page.locator('#btnView').click();
      assert.equal(await page.evaluate(() => __pm.KNIFE.mesh), null); assert.deepEqual(await state(), initial);
      await page.locator('#btnView').click(); await page.locator('#btnView').click();
      await start(); await tap([-1,-1,0]); await tap([1,1,0]);
      await page.evaluate(() => {__pm.S.active.mesh.faces[0].mat = 1; __pm.pushUndo('Assign material');});
      assert.equal(await page.evaluate(() => __pm.KNIFE.mesh), null, 'Another edit invalidates stale preview');
      assert.equal((await state()).faces[0].mat, 1);
      // Only visible geometry is cut, including when X-ray display is enabled.
      await load('cube'); await start();
      await page.evaluate(() => {__pm.S.xray = true;});
      await tap([-1,-1,1], [5,-3]); await tap([1,1,1], [-5,3]); await page.keyboard.press('Enter');
      const cube = await state(); assert.equal(cube.faces.length, 7); assert.equal(cube.verts.length, 8);
      assert.ok(cube.faces.some(f => f.v.length === 4 && f.v.every(v => cube.verts[v][2] === -1)), 'Occluded bottom face untouched');
      // Normal drag navigation stays available without creating a cut.
      await start(); const box = await page.locator('#c3d').boundingBox();
      const yaw = await page.evaluate(() => __pm.CAM.yaw);
      await page.mouse.move(box.x + box.width * .55, box.y + box.height * .5); await page.mouse.down();
      await page.mouse.move(box.x + box.width * .55 + 45, box.y + box.height * .5 + 20, {steps: 6}); await page.mouse.up();
      assert.notEqual(await page.evaluate(() => __pm.CAM.yaw), yaw);
      assert.equal(await page.evaluate(() => __pm.KNIFE.first), null);
      await page.keyboard.press('Tab');
      assert.equal(await page.getByRole('button', {name: 'Knife tool · K', exact: true}).count(), 0);
      assert.deepEqual(errors, []);
      console.log(`${layout}: vertex magnets, edge/crossing cuts, preview/cancel/save isolation, apply/undo/redo, keyboard, pane/tool switches, occlusion and orbit passed`);
      await ctx.close();
    }
  } finally {await browser.close(); server.close();}
})().catch(e => {console.error(e); process.exit(1);});
