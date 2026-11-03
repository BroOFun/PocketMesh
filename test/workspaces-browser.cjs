const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http');
const { chromium, devices } = require('playwright');
(async () => {
  const root = path.resolve(__dirname, '../docs'),
    server = http.createServer((req, res) => {
      const file = path.resolve(
        root,
        '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'),
      );
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader(
        'content-type',
        file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream',
      );
      fs.createReadStream(file).pipe(res);
    });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const { loadSrc } = await import('./loadsrc.mjs'),
    api = await loadSrc('kcl.js', 'kmp.js');
  try {
    for (const mobile of [false, true]) {
      const ctx = await browser.newContext({
          ...(mobile ? devices['iPhone 14'] : { viewport: { width: 1200, height: 850 } }),
          acceptDownloads: true,
          serviceWorkers: 'block',
        }),
        page = await ctx.newPage(),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.stack));
      await ctx.addInitScript(() => {
        localStorage.setItem('pm_welcomed', 'true');
        localStorage.setItem('pm_installHinted', 'true');
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__pm);
      await page.evaluate(async () => {
        const p = __pm,
          doc = p.serializeProject(),
          base = doc.objects[0],
          mat = doc.materials[0];
        doc.materials = ['Road', 'Finish', 'Boost', 'Scenery'].map((name, i) => ({
          ...mat,
          id: i + 1,
          name,
          kclFlag: 0,
        }));
        doc.objects = doc.materials.map((m, i) => ({
          ...structuredClone(base),
          id: i + 1,
          name: m.name,
          materials: [m.id],
          pos: [(i - 1) * 8, 0, 3],
          scl: [1, 1, 1],
          selected: i === 0,
          mesh: {
            verts: [
              [-3, -8, 0],
              [3, -8, 0],
              [3, 8, 2],
              [-3, 8, 2],
            ],
            faces: [
              {
                v: [0, 1, 2, 3],
                uv: [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                ],
                mat: 0,
              },
            ],
            looseEdges: [],
            seams: [],
            smooth: false,
          },
        }));
        doc.active = 1;
        doc.track = { scale: 100, clearance: 0.2 };
        doc.camera = { target: [4, 0, 4], yaw: 0, pitch: 1.45, dist: 47, ortho: true };
        await p.loadProject(doc);
      });
      const cam = await page.evaluate(() => JSON.stringify(__pm.serializeProject().camera));
      await page.locator('#sub').getByRole('button', { name: 'Track Editor', exact: true }).click();
      await page.locator('#sheet').getByRole('button', { name: 'KCL', exact: false }).click();
      assert.equal(await page.evaluate(() => JSON.stringify(__pm.serializeProject().camera)), cam);
      await page.getByRole('button', { name: 'Materials & flags', exact: true }).click();
      await page.getByLabel('Collision material', { exact: true }).selectOption('2');
      await page.getByRole('button', { name: 'Finish line', exact: true }).click();
      assert.match(await page.locator('#collisionFlag').textContent(), /0x0000.*Finish/);
      await page.getByLabel('Collision material', { exact: true }).selectOption('3');
      await page.getByRole('button', { name: 'Boost panel', exact: true }).click();
      await page.getByLabel('KCL variant').selectOption('1');
      await page.getByLabel('KCL BLIGHT index').selectOption('3');
      await page.getByLabel('Trickable', { exact: true }).check();
      assert.equal(await page.evaluate(() => __pm.S.materials[2].kclFlag), 0x2326);
      await page.getByLabel('Collision material', { exact: true }).selectOption('4');
      await page.getByLabel('Include in KCL', { exact: true }).uncheck();
      const tris = await page.evaluate(() => __pm.trackTriangles());
      assert.equal(tris.length, 6);
      assert.deepEqual([...new Set(tris.map((t) => t.flag))], [0, 0x2326]);
      assert.ok(tris.some((t) => t.points.some((p) => p[1] === 500)));
      const download = async (name, file) => {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name, exact: true }).click();
        const d = await pending;
        await d.saveAs(file);
        return new Uint8Array(fs.readFileSync(file));
      };
      const kcl = await download('Export & Send KCL…', `work/ui-${mobile ? 'phone' : 'desktop'}.kcl`);
      assert.ok(kcl.length > 60);
      await page.getByRole('button', { name: 'Road type list', exact: true }).click();
      await page.getByLabel('Search collision types').fill('boost');
      assert.ok((await page.locator('.trackCatalog details').count()) >= 2); // boost half-pipe variant
      await page.getByLabel('Search collision types').fill('');
      assert.equal(await page.locator('.trackCatalog details').count(), 32);
      const csv = await download('Export & Send type list CSV…', `work/ui-${mobile ? 'phone' : 'desktop'}-types.csv`);
      assert.equal(new TextDecoder().decode(csv).split('\r\n').length, 257);
      await page.locator('#sheetClose').click();
      await page.locator('#sub').getByRole('button', { name: 'Track Editor', exact: true }).click();
      await page.locator('#sheet').getByRole('button', { name: 'KMP', exact: false }).click();
      assert.equal(await page.evaluate(() => JSON.stringify(__pm.serializeProject().camera)), cam);
      assert.equal(await page.evaluate(() => __pm.TRACKVIEW.labels.filter((g) => g.material.kclFinish).length), 1);
      await page.locator('#shelf').getByRole('button', { name: 'Place Start', exact: true }).click();
      const pt = await page.evaluate(() => __pm.screenOf(0, 0, 1));
      if (mobile) await page.touchscreen.tap(pt.x, pt.y);
      else await page.mouse.click(pt.x, pt.y);
      const start = await page.evaluate(() => __pm.S.track.start);
      assert.ok(start, 'tap places a start');
      assert.ok(Math.abs(start.position[2] - 4.2) < 0.02, 'surface height + clearance');
      await page.locator('#shelf').getByRole('button', { name: 'Aim Start', exact: true }).click();
      const aim = await page.evaluate(() => __pm.screenOf(2, 0, 1));
      if (mobile) await page.touchscreen.tap(aim.x, aim.y);
      else await page.mouse.click(aim.x, aim.y);
      assert.ok(Math.abs((await page.evaluate(() => __pm.S.track.start.rotation[1])) - 90) < 1);
      await page.getByRole('button', { name: 'Start point', exact: true }).click();
      await page.getByLabel('Start yaw', { exact: true }).fill('90');
      await page.getByLabel('Start yaw', { exact: true }).press('Enter');
      const kmp = await download('Export & Send KMP…', `work/ui-${mobile ? 'phone' : 'desktop'}.kmp`),
        parsed = api.inspectKMP(kmp);
      assert.equal(parsed.start.rotation[1], 90);
      assert.ok(Math.abs(parsed.start.position[1] - 420) < 2);
      assert.equal(parsed.sections.find((s) => s.name === 'CKPT').count, 4);
      assert.equal(parsed.sections.find((s) => s.name === 'JGPT').count, 1);
      await page
        .locator('#fileKMP')
        .setInputFiles({ name: 'base.kmp', mimeType: 'application/octet-stream', buffer: Buffer.from(kmp) });
      await page.getByText(/Updating: base.kmp/).waitFor();
      await page.getByLabel('Start yaw', { exact: true }).fill('180');
      await page.getByLabel('Start yaw', { exact: true }).press('Enter');
      const modified = api.inspectKMP(
        await download('Export & Send KMP…', `work/ui-${mobile ? 'phone' : 'desktop'}-patched.kmp`),
      );
      for (const s of parsed.sections)
        if (s.name !== 'KTPT') assert.deepEqual(s.bytes, modified.sections.find((t) => t.name === s.name).bytes);
      const state = await page.evaluate(async () => {
        const p = __pm,
          doc = p.serializeProject();
        await p.loadProject(JSON.parse(JSON.stringify(doc)));
        const before = p.S.track.start.rotation[1];
        p.S.track.start.rotation[1] = 45;
        p.pushUndo('yaw');
        p.undo();
        const undone = p.S.track.start.rotation[1];
        p.redo();
        return {
          before,
          undone,
          after: p.S.track.start.rotation[1],
          finish: p.S.materials[1].kclFinish,
          template: p.S.track.templateName,
        };
      });
      assert.deepEqual(state, { before: 180, undone: 180, after: 45, finish: true, template: 'base.kmp' });
      await page.locator('#sheetClose').click();
      await page.screenshot({ path: `work/workspace-${mobile ? 'phone' : 'desktop'}.png` });
      await page.locator('#sub').getByRole('button', { name: 'Track Editor', exact: true }).click();
      await page.locator('#sheet').getByRole('button', { name: 'Course Model', exact: false }).click();
      await page.locator('#sheetClose').click();
      assert.ok(await page.getByRole('button', { name: 'Interaction mode', exact: true }).isVisible());
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    console.log(
      'Desktop/iPhone shared viewport, material flags, exclusions, finish marker, start height/aim, CSV/KCL/KMP downloads, import preservation and save/undo passed',
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
