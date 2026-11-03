const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, devices } = require('playwright');
(async () => {
  const root = path.resolve(__dirname, '../docs');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
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
  try {
    for (const mobile of [false, true]) {
      const ctx = await browser.newContext({
        ...(mobile ? devices['iPhone 14'] : { viewport: { width: 1200, height: 850 } }),
        serviceWorkers: 'block',
      });
      await ctx.addInitScript(() => {
        localStorage.setItem('pm_welcomed', 'true');
        localStorage.setItem('pm_installHinted', 'true');
      });
      const page = await ctx.newPage(),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.stack));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__pm);
      const original = await page.evaluate(() => __pm.serializeProject());
      await page.evaluate(async () => {
        const p = __pm,
          doc = p.serializeProject(),
          base = doc.objects[0];
        doc.objects = [-2.4, 0, 2.4].map((x, i) => ({
          ...structuredClone(base),
          id: i + 1,
          name: 'Cube ' + (i + 1),
          pos: [x, 0, 0],
          scl: [0.7, 0.7, 0.7],
          selected: i === 0,
        }));
        doc.active = 1;
        doc.camera = { target: [0, 0, 0], yaw: 0, pitch: 1.4, dist: 15, ortho: true };
        await p.loadProject(doc);
      });
      const points = await page.evaluate(() => {
        const p = __pm,
          active = p.S.active;
        const pts = p.S.objects.map((o) => {
          p.S.active = o;
          return p.screenOf(0, 0, 1);
        });
        p.S.active = active;
        return pts;
      });
      const cdp = await ctx.newCDPSession(page);
      async function tap(p, hold = 0) {
        if (mobile) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] });
          if (hold) await page.waitForFunction(() => __pm.S.multiSelect === true, null, { timeout: 5000 });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.mouse.move(p.x, p.y);
          await page.mouse.down();
          if (hold) await page.waitForFunction(() => __pm.S.multiSelect === true, null, { timeout: 5000 });
          await page.mouse.up();
        }
      }
      const selected = () => page.evaluate(() => __pm.S.objects.filter((o) => o.selected).map((o) => o.id));
      // Long press adds without removing the previous selection; taps toggle any object.
      await tap(points[1], 530);
      assert.deepEqual(await selected(), [1, 2]);
      assert.equal(await page.evaluate(() => __pm.S.multiSelect), true);
      await tap(points[0]);
      assert.deepEqual(await selected(), [2], 'remove a non-active selected object');
      await tap(points[2]);
      assert.deepEqual(await selected(), [2, 3]);
      await tap(points[2]);
      assert.deepEqual(await selected(), [2]);
      await tap(points[1]);
      assert.deepEqual(await selected(), []);
      await tap(points[0]);
      assert.deepEqual(await selected(), [1]);
      await page.getByRole('button', { name: 'Multiselect', exact: true }).click();
      await tap(points[2]);
      assert.deepEqual(await selected(), [3], 'Done restores single selection');
      // Explicit control is available without a long press, even after using Move.
      await page.getByRole('button', { name: 'Move gizmo', exact: true }).click();
      await tap(points[0], 530);
      assert.deepEqual(await selected(), [1, 3], 'hold outside gizmo while Move is active');
      await page.getByRole('button', { name: 'Multiselect', exact: true }).click();
      await page.getByRole('button', { name: 'Multiselect', exact: true }).click();
      await tap(points[2]);
      assert.deepEqual(await selected(), [1]);
      await page.getByRole('button', { name: 'Multiselect', exact: true }).click();
      await page.getByRole('button', { name: 'Multiselect', exact: true }).click();
      await tap(points[2]);
      await page.evaluate(() => __pm.tfStart('move', { axis: 0 }));
      await page.getByLabel('Exact value', { exact: true }).fill('3');
      await page.getByLabel('Exact value', { exact: true }).press('Enter');
      assert.deepEqual(
        await page.evaluate(() => __pm.S.objects.map((o) => +o.node.position.x.toFixed(3))),
        [0.6, 0, 5.4],
        'transform moves both selected objects',
      );
      // Test the complete face-based crease workflow through actual UI controls.
      await page.evaluate((data) => __pm.loadProject(data), original);
      await page.getByRole('button', { name: 'Show UV editor', exact: true }).click();
      assert.equal(await page.evaluate(() => __pm.S.view), 'split');
      if (await page.locator('#sheet').isVisible()) await page.locator('#sheetClose').click();
      await page.getByRole('button', { name: 'Modifiers', exact: true }).click();
      await page.getByRole('button', { name: 'Add Subdivision Surface', exact: true }).click();
      assert.equal(await page.getByLabel('Subdivision boundary').inputValue(), 'keep-corners');
      await page.getByLabel('Subdivision boundary').selectOption('keep-boundary');
      await page.getByLabel('Subdivision levels').selectOption('2');
      await page.getByRole('button', { name: 'Add Creases', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => [__pm.S.mode, __pm.S.selectMode, __pm.S.multiSelect]), [
        'edit',
        'face',
        true,
      ]);
      assert.equal(await page.locator('#sheet').isVisible(), false, 'selection viewport unobstructed');
      assert.equal(await page.evaluate(() => __pm.S.view), '3d', 'crease selection returns to 3D');
      const face = await page.evaluate(() => {
        const p = __pm,
          o = p.S.active;
        const f = o.mesh.faces.find((f) => p.faceNormal(o.mesh, f)[2] > 0.5);
        return p.screenOf(...p.faceCenter(o.mesh, f));
      });
      await tap(face);
      assert.equal(await page.evaluate(() => __pm.S.active.esel.faces.size), 1, 'tap selects face');
      await page.getByRole('button', { name: 'Mark Creases', exact: true }).click();
      assert.equal(await page.evaluate(() => __pm.S.active.mesh.creases.size), 4);
      await page.getByRole('button', { name: 'Remove Creases', exact: true }).click();
      assert.equal(await page.evaluate(() => __pm.S.active.mesh.creases.size), 0);
      await page.evaluate(() => __pm.undo());
      assert.equal(await page.evaluate(() => __pm.S.active.mesh.creases.size), 4);
      await page.evaluate(() => __pm.redo());
      assert.equal(await page.evaluate(() => __pm.S.active.mesh.creases.size), 0);
      await page.getByRole('button', { name: 'Mark Creases', exact: true }).click();
      await page.getByRole('button', { name: 'Done editing creases', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => [__pm.S.mode, __pm.S.active.renderMesh.creases.size]), ['object', 16]);
      let saved = await page.evaluate(() => __pm.serializeProject());
      await page.evaluate((data) => __pm.loadProject(data), saved);
      assert.deepEqual(
        await page.evaluate(() => [__pm.S.active.mesh.creases.size, __pm.S.active.modifiers[0].boundary]),
        [4, 'keep-boundary'],
      );
      if (await page.locator('#sheet').isVisible()) await page.locator('#sheetClose').click();
      await page.getByRole('button', { name: 'Modifiers', exact: true }).click();
      await page.getByRole('button', { name: 'Add Creases', exact: true }).click();
      await page.evaluate(() => __pm.editSelectAll('select'));
      await page.getByRole('button', { name: 'Mark Creases', exact: true }).click();
      await page.getByRole('button', { name: 'Done editing creases', exact: true }).click();
      assert.equal(await page.evaluate(() => __pm.S.active.mesh.creases.size), 12);
      const before = await page.evaluate(() => JSON.stringify(__pm.S.active.renderMesh.verts));
      assert.equal(
        await page.evaluate(() => {
          const n = __pm.S.active.meshNode.geometry.attributes.normal.array;
          for (let i = 0; i < n.length; i += 3)
            if ([n[i], n[i + 1], n[i + 2]].filter((v) => Math.abs(v) > 1e-6).length !== 1) return false;
          return true;
        }),
        true,
        'viewport uses split crease normals',
      );
      fs.mkdirSync('work', { recursive: true });
      await page.screenshot({ path: `work/creases-${mobile ? 'mobile' : 'desktop'}.png` });
      await page.getByRole('button', { name: 'Apply to mesh', exact: true }).click();
      assert.deepEqual(
        await page.evaluate(() => [
          __pm.S.active.mesh.faces.length,
          __pm.S.active.mesh.creases.size,
          __pm.S.active.modifiers.length,
        ]),
        [96, 48, 0],
      );
      assert.equal(
        await page.evaluate(() => JSON.stringify(__pm.S.active.mesh.verts)),
        before,
        'Apply matches preview',
      );
      await page.evaluate(() => __pm.undo());
      assert.equal(await page.evaluate(() => __pm.S.active.mesh.creases.size), 12);
      await page.getByRole('button', { name: 'Clear All Creases', exact: true }).click();
      assert.equal(await page.evaluate(() => __pm.S.active.mesh.creases.size), 0);
      assert.notEqual(
        await page.evaluate(() => JSON.stringify(__pm.S.active.renderMesh.verts)),
        before,
        'removing creases restores smoothing',
      );
      assert.deepEqual(errors, []);
      console.log(
        `${mobile ? 'Mobile' : 'Desktop'}: object multiselect/toggling, face creases, boundary setting, undo, save/load, preview/Apply and hard normals passed`,
      );
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
