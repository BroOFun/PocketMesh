const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium, devices } = require('playwright');
(async () => {
  const root = path.resolve(__dirname, '../docs');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const { makeU8 } = await import('./szs-fixture.mjs'), { loadSrc } = await import('./loadsrc.mjs');
  const api = await loadSrc('szs.js', 'kmp.js');
  try {
    for (const mobile of [false, true]) {
      const ctx = await browser.newContext({ ...(mobile ? devices['iPhone 14'] : { viewport: { width: 1200, height: 850 } }), serviceWorkers: 'block', acceptDownloads: true });
      await ctx.addInitScript(() => { localStorage.setItem('pm_welcomed', 'true'); localStorage.setItem('pm_installHinted', 'true'); });
      const page = await ctx.newPage(), errors = [], downloads = [];
      page.on('pageerror', (e) => errors.push(e.message)); page.on('download', (d) => downloads.push(d));
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => window.__pm);
      const files = await page.evaluate(() => {
        __pm.S.track.start = { position: [0, 0, 2], rotation: [0, 0, 0] }; __pm.pushUndo('Start');
        return Object.fromEntries(['course_model.brres', 'course.kcl', 'course.kmp'].map((name) => [name, Array.from(__pm.szsProjectFile(name))]));
      });
      const tree = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, new Uint8Array(bytes)]));
      tree.assets = { 'keep.bin': new Uint8Array([12, 34, 56]), empty: {} };
      const original = Buffer.from(makeU8(tree));
      const open = async (buffer = original, name = 'auto.szs') => {
        await page.locator('#fileSZS').setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
        await page.getByText(name, { exact: true }).waitFor();
      };
      const state = () => page.evaluate(() => ({ revision: __pm.SZED.revision, count: __pm.SZED.changes.size, notice: __pm.SZED.notice, sync: Object.fromEntries(__pm.SZED.sync) }));
      const bytes = (name) => page.evaluate((name) => {
        const p = __pm, id = p.SZED.archive.nodes.find((n) => n.name === name).id;
        return Array.from(p.szsEntryBytes(p.SZED.archive, id, p.SZED.changes));
      }, name);
      const matches = async (names) => {
        await page.waitForFunction((names) => names.every((name) => {
          const p = __pm, node = p.SZED.archive.nodes.find((n) => n.name === name), s = p.SZED.sync.get(name);
          if (!s || s.error || s.paused) return false;
          const a = p.szsEntryBytes(p.SZED.archive, node.id, p.SZED.changes), b = p.szsProjectFile(name);
          return a.length === b.length && a.every((v, i) => v === b[i]);
        }), names);
      };
      const all = Object.keys(files);
      await open();
      assert.equal((await state()).count, 0, 'identical project is not restaged');
      await page.evaluate(() => { __pm.S.active.node.position.x += 3; __pm.rebuildObject(__pm.S.active); __pm.pushUndo('Move course'); });
      await matches(all);
      assert.equal((await state()).count, 2, 'mesh movement updates model and KCL only');
      assert.match((await state()).notice, /Automatically updated: course_model.brres, course.kcl/);
      const model = await bytes('course_model.brres'), collision = await bytes('course.kcl');
      await page.evaluate(() => { __pm.S.materials[0].kclFlag = 6; __pm.pushUndo('Boost collision'); });
      await matches(all);
      assert.deepEqual(await bytes('course_model.brres'), model);
      assert.notDeepEqual(await bytes('course.kcl'), collision);
      assert.match((await state()).notice, /Automatically updated: course.kcl\./);
      const beforeTexture = await bytes('course_model.brres'), texturedCollision = await bytes('course.kcl');
      await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = c.height = 128;
        const g = c.getContext('2d'); g.fillStyle = '#7654ff'; g.fillRect(0, 0, 128, 128);
        const im = __pm.addImageFromCanvas('track.png', c);
        __pm.S.materials[0].texture = im.id; __pm.S.materials[0].useTexture = true; __pm.pushUndo('Track texture');
      });
      await matches(all);
      assert.notDeepEqual(await bytes('course_model.brres'), beforeTexture);
      assert.deepEqual(await bytes('course.kcl'), texturedCollision);
      await page.evaluate(() => __pm.downscaleMaterialImage(__pm.S.materials[0], 64)); await matches(all);
      assert.equal(await page.evaluate(() => {
        const p = __pm, id = p.SZED.archive.nodes.find((n) => n.name === 'course_model.brres').id;
        return p.inspectBRRES(p.szsEntryBytes(p.SZED.archive, id, p.SZED.changes)).textures[0].width;
      }), 64, 'image downscaling reaches the SZS model');
      await page.evaluate(() => {
        __pm.S.track.start.position[0] = 4;
        __pm.S.track.checkpoints = { points: [{ left: [-4, 0], right: [4, 0], type: 0, respawn: 0, prev: 0, next: 0 }], groups: [{ start: 0, count: 1, prev: [0], next: [0] }], dirty: true };
        __pm.pushUndo('Start and lap');
      });
      await matches(all);
      assert.match((await state()).notice, /Automatically updated: course.kmp\./);
      const kmp = await bytes('course.kmp');
      assert.equal(api.inspectKMP(new Uint8Array(kmp)).checkpoints.points[0].type, 0);
      await page.evaluate(() => __pm.undo()); await matches(all);
      assert.notDeepEqual(await bytes('course.kmp'), kmp);
      await page.evaluate(() => __pm.redo()); await matches(all);
      assert.deepEqual(await bytes('course.kmp'), kmp);
      const revision = (await state()).revision;
      await page.evaluate(() => { __pm.CAM.yaw += 0.3; __pm.S.active.selected = !__pm.S.active.selected; __pm.pushUndo('Selection only'); });
      await page.waitForTimeout(1000);
      assert.equal((await state()).revision, revision, 'selection/camera do not replace files');
      await page.evaluate(() => __pm.setTrackScale(150)); await matches(all);
      assert.match((await state()).notice, /course_model.brres, course.kcl, course.kmp/);

      // A disk replacement remains authoritative until explicitly resumed.
      await page.getByLabel('Search archive files').fill('course.kmp');
      await page.getByRole('button', { name: 'Select archive file ./course.kmp', exact: true }).click();
      await page.locator('#fileSZSReplace').setInputFiles({ name: 'manual.kmp', mimeType: 'application/octet-stream', buffer: Buffer.from(files['course.kmp']) });
      await page.waitForFunction(() => __pm.SZED.sync.get('course.kmp').paused);
      await page.evaluate(() => { __pm.S.track.start.position[0] = 8; __pm.pushUndo('New start'); });
      await page.waitForTimeout(1000);
      assert.deepEqual(await bytes('course.kmp'), files['course.kmp']);
      await page.getByRole('button', { name: 'Resume automatic updates · course.kmp', exact: true }).click(); await matches(all);
      const validKMP = await bytes('course.kmp');
      await page.evaluate(() => { __pm.S.track.start = null; __pm.pushUndo('Incomplete start'); });
      await page.waitForFunction(() => !!__pm.SZED.sync.get('course.kmp').error);
      assert.deepEqual(await bytes('course.kmp'), validKMP, 'failed export retains the last good file');
      await page.getByRole('button', { name: 'Prepare SZS download', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'SZS not prepared' }).waitFor();
      assert.equal(downloads.length, 0);
      await page.evaluate(() => __pm.undo()); await matches(all);
      assert.match((await state()).notice, /Now up to date: course.kmp/);

      // An edit during the worker operation invalidates its old result.
      await page.evaluate(() => {
        [...document.querySelectorAll('button')].find((b) => b.textContent === 'Prepare SZS download').click();
        __pm.S.track.start.position[0] = 11; __pm.pushUndo('Edit while packing');
      });
      await page.waitForFunction(() => !__pm.SZED.busy);
      await matches(all);
      assert.equal(await page.getByRole('button', { name: 'Save & Send SZS…', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Prepare SZS download', exact: true }).click();
      await page.getByRole('button', { name: 'Save & Send SZS…', exact: true }).waitFor();
      await page.evaluate(() => {
        __pm.S.track.start = null; __pm.pushUndo('Invalid start after packing');
        [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save & Send SZS…').click();
      });
      await page.getByRole('alert').filter({ hasText: 'SZS not prepared' }).waitFor();
      assert.equal(downloads.length, 0, 'post-pack errors return to visible file statuses');
      await page.evaluate(() => __pm.undo()); await matches(all);
      await page.getByRole('button', { name: 'Prepare SZS download', exact: true }).click();
      await page.getByRole('button', { name: 'Save & Send SZS…', exact: true }).waitFor();
      // Also catch edits after packing, immediately before the final share tap.
      await page.evaluate(() => {
        __pm.S.track.start.position[0] = 12; __pm.pushUndo('Edit after packing');
        [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save & Send SZS…').click();
      });
      await page.waitForFunction(() => !__pm.SZED.busy);
      assert.equal(downloads.length, 0, 'stale prepared bytes were not downloaded');
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Save & Send SZS…', exact: true }).click();
      const download = await pending, output = `work/szs-auto-${mobile ? 'phone' : 'desktop'}.szs`;
      await download.saveAs(output);
      const saved = api.inspectSZS(new Uint8Array(fs.readFileSync(output)));
      for (const name of all) {
        const node = saved.nodes.find((n) => n.name === name);
        assert.deepEqual(Array.from(api.szsEntryBytes(saved, node.id)), await bytes(name));
      }
      const start = api.inspectKMP(api.szsEntryBytes(saved, saved.nodes.find((n) => n.name === 'course.kmp').id)).start;
      assert.equal(start.position[0], 1800);
      assert.deepEqual(api.szsEntryBytes(saved, saved.nodes.find((n) => n.name === 'keep.bin').id), tree.assets['keep.bin']);
      await open(); // Current edits already exist when the original donor is reopened.
      assert.equal((await state()).count, 3, 'opening a donor automatically imports the current project');
      await page.getByRole('button', { name: 'Revert all replacements', exact: true }).click();
      await page.waitForTimeout(1000);
      assert.equal((await state()).count, 0);
      assert.equal(await page.getByLabel('Automatically update course files').isChecked(), false);
      await page.getByLabel('Automatically update course files').check(); await matches(all);
      await page.screenshot({ path: `work/szs-auto-${mobile ? 'phone' : 'desktop'}.png` });
      const ambiguous = { a: { 'course_model.brres': tree['course_model.brres'] }, b: { 'COURSE_MODEL.BRRES': tree['course_model.brres'] }, 'course.kmp': tree['course.kmp'] };
      await open(Buffer.from(makeU8(ambiguous)), 'ambiguous.szs');
      const issues = await state();
      assert.match(issues.sync['course_model.brres'].error, /Multiple/);
      assert.match(issues.sync['course.kcl'].error, /Missing/);
      assert.equal(issues.count, 1, 'ambiguous or missing destinations are not guessed');
      assert.deepEqual(errors, []);
      await ctx.close();
      console.log(`${mobile ? 'iPhone' : 'Desktop'} SZS auto sync, undo/redo, manual protection, export failures and stale-download checks passed`);
    }
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
