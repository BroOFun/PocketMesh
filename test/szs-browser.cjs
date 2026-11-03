const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http');
const { chromium, devices } = require('playwright');
(async () => {
  const root = path.resolve(__dirname, '../docs'),
    server = http.createServer((req, res) => {
      const f = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
      if (!f.startsWith(root + path.sep) || !fs.existsSync(f)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader(
        'content-type',
        f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream',
      );
      fs.createReadStream(f).pipe(res);
    });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    }),
    { loadSrc } = await import('./loadsrc.mjs'),
    { makeU8 } = await import('./szs-fixture.mjs'),
    api = await loadSrc('szs.js', 'kmp.js');
  try {
    for (const mobile of [false, true]) {
      const ctx = await browser.newContext({
          ...(mobile ? devices['iPhone 14'] : { viewport: { width: 1200, height: 850 } }),
          serviceWorkers: 'block',
          acceptDownloads: true,
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
          d = p.serializeProject(),
          base = d.objects[0];
        d.materials = [{ ...d.materials[0], id: 1, name: 'Material', doubleSided: false, kclEnabled: false }];
        d.objects = [
          {
            ...base,
            materials: [1],
            pos: [0, 0, 0],
            scl: [1, 1, 1],
            mesh: {
              verts: [
                [-20, -20, 0],
                [20, -20, 0],
                [20, 20, 4],
                [-20, 20, 4],
              ],
              faces: [
                {
                  v: [3, 2, 1, 0],
                  uv: [
                    [0, 1],
                    [1, 1],
                    [1, 0],
                    [0, 0],
                  ],
                  mat: 0,
                },
              ],
              looseEdges: [],
              seams: [],
              smooth: false,
            },
          },
        ];
        d.camera = { target: [0, 0, 2], yaw: 0, pitch: 1.45, dist: 65, ortho: true };
        d.track = { scale: 100, clearance: 0.2 };
        await p.loadProject(d);
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const g = c.getContext('2d');
        g.fillStyle = '#ff0000';
        g.fillRect(0, 0, 16, 16);
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, 8, 8);
        const im = p.addImageFromCanvas('unnamed-road.png', c);
        p.S.materials[0].texture = im.id;
        p.rebuildObject(p.S.active);
      });
      const tap = async (p) => (mobile ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
      const cdp = mobile ? await ctx.newCDPSession(page) : null;
      const drag = async (from, to) => {
        if (mobile) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
          for (let i = 1; i <= 8; i++)
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 }],
            });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.mouse.move(from.x, from.y);
          await page.mouse.down();
          await page.mouse.move(to.x, to.y, { steps: 8 });
          await page.mouse.up();
        }
      };
      await page.locator('#sub').getByRole('button', { name: 'KMP', exact: true }).click();
      assert.equal(await page.evaluate(() => __pm.TRACKVIEW.action), 'place', 'empty KMP starts in placement mode');
      await tap(await page.evaluate(() => __pm.screenOf(0, 0, 2)));
      let start = await page.evaluate(() => __pm.S.track.start);
      assert.ok(start, 'back-facing/disabled collision surface still accepts placement');
      assert.ok(Math.abs(start.position[2] - 2.2) < 0.02);
      await page.getByRole('button', { name: 'Start point', exact: true }).click();
      await page.locator('#sheetBody').getByRole('button', { name: 'Place Start', exact: true }).click();
      assert.ok(await page.locator('#sheet').isHidden(), 'Place Start closes panel');
      const beforeDrag = await page.evaluate(() => JSON.stringify(__pm.S.track.start)),
        cam = await page.evaluate(() => __pm.CAM.yaw),
        point = await page.evaluate(() => __pm.screenOf(5, 5, 2.5));
      await drag(point, { x: point.x + 30, y: point.y + 15 });
      assert.notEqual(await page.evaluate(() => __pm.CAM.yaw), cam);
      assert.equal(
        await page.evaluate(() => JSON.stringify(__pm.S.track.start)),
        beforeDrag,
        'camera drag does not place',
      );
      await page.evaluate(() => {
        __pm.CAM.pitch = 1.45;
        __pm.CAM.yaw = 0;
        __pm.applyCamera();
      });
      await tap(await page.evaluate(() => __pm.screenOf(5, 5, 2.5)));
      assert.ok(Math.abs((await page.evaluate(() => __pm.S.track.start.position[2])) - 2.7) < 0.03);
      // Real pointer drags on the common transform gizmo, rather than direct state edits.
      await page.getByRole('button', { name: 'Move gizmo', exact: true }).click();
      const xHandle = async () =>
        page.evaluate(() => {
          const tc = __pm.tc,
            node = tc._gizmo.picker[tc.mode].children.find((n) => n.name === 'X');
          tc.updateMatrixWorld(true);
          node.geometry.computeBoundingBox();
          const point = node.geometry.boundingBox
            .getCenter(__pm.gizmoProxy.position.clone())
            .applyMatrix4(node.matrixWorld)
            .project(tc.camera);
          const base = __pm.gizmoProxy.position.clone().project(tc.camera);
          const r = document.querySelector('#c3d').getBoundingClientRect();
          const dx = (point.x - base.x) * r.width,
            dy = (base.y - point.y) * r.height,
            length = Math.hypot(dx, dy);
          return {
            x: r.left + ((point.x + 1) * r.width) / 2,
            y: r.top + ((1 - point.y) * r.height) / 2,
            dx: dx / length,
            dy: dy / length,
          };
        });
      const origin = await xHandle();
      const beforeMove = await page.evaluate(() => __pm.S.track.start.position.slice());
      await drag({ x: origin.x, y: origin.y }, { x: origin.x + origin.dx * 25, y: origin.y + origin.dy * 25 });
      const moved = await page.evaluate(() => __pm.S.track.start.position);
      assert.ok(Math.abs(moved[0] - beforeMove[0]) > 0.1, 'start moves through X gizmo');
      assert.ok(Math.abs(moved[2] - beforeMove[2]) < 0.03, 'X movement retains snapped surface height');
      await page.evaluate(() => __pm.undo());
      assert.deepEqual(await page.evaluate(() => __pm.S.track.start.position), beforeMove);
      await page.getByRole('button', { name: 'Rotate gizmo', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => [__pm.tc.enabled, __pm.tc.showX, __pm.tc.showY, __pm.tc.showZ]), [
        true,
        false,
        false,
        true,
      ]);
      const rotated = await page.evaluate(() => {
        const p = __pm;
        p.tc.axis = 'Z';
        p.tc.dispatchEvent({ type: 'mouseDown' });
        p.gizmoProxy.quaternion.setFromAxisAngle(p.gizmoProxy.position.clone().set(0, 0, 1), Math.PI / 2);
        p.tc.dispatchEvent({ type: 'objectChange' });
        p.tc.dispatchEvent({ type: 'mouseUp' });
        return p.S.track.start.rotation[1];
      });
      assert.ok(Math.abs(rotated - 90) < 0.001);
      await page.evaluate(() => __pm.undo());
      await page.locator('#sub').getByRole('button', { name: 'KCL', exact: true }).click();
      for (const name of ['Move gizmo', 'Rotate gizmo', 'Scale gizmo'])
        assert.ok(await page.getByRole('button', { name, exact: true }).isVisible());
      await page.getByRole('button', { name: 'Materials & flags', exact: true }).click();
      assert.equal(await page.locator('.collision-material').count(), 1);
      assert.ok(await page.getByText('unnamed-road.png', { exact: true }).isVisible());
      assert.deepEqual(
        await page
          .locator('.collision-material canvas')
          .evaluate((c) => [...c.getContext('2d').getImageData(24, 24, 1, 1).data]),
        [255, 255, 255, 255],
      );
      await page.screenshot({ path: `work/material-images-${mobile ? 'phone' : 'desktop'}.png` });
      await page.getByRole('button', { name: 'Road', exact: true }).click();
      await page.getByRole('button', { name: 'Show textures on track', exact: true }).click();
      assert.equal(await page.evaluate(() => __pm.TRACKVIEW.colors), false);
      await page.getByRole('button', { name: 'Move gizmo', exact: true }).click();
      const objOrigin = await xHandle(),
        oldX = await page.evaluate(() => __pm.S.active.node.position.x);
      await drag(
        { x: objOrigin.x, y: objOrigin.y },
        { x: objOrigin.x + objOrigin.dx * 25, y: objOrigin.y + objOrigin.dy * 25 },
      );
      assert.ok(
        Math.abs((await page.evaluate(() => __pm.S.active.node.position.x)) - oldX) > 0.1,
        'KCL mesh shares transform controls',
      );
      await page.evaluate(() => __pm.undo());
      const project = await page.evaluate(() => {
        const p = __pm;
        return {
          'course_model.brres': Array.from(
            p.runExport('brres', { baseName: 'course_model', selectedOnly: false }).data,
          ),
          'course.kcl': Array.from(p.exportKCL(p.trackTriangles()).bytes),
          'course.kmp': Array.from(p.exportKMP(p.S.track.start, { scale: p.S.track.scale })),
        };
      });
      const contents = Object.fromEntries(Object.entries(project).map(([n, b]) => [n, new Uint8Array(b)]));
      contents.assets = { 'keep.bin': new Uint8Array([1, 2, 3, 255]), empty: {} };
      contents.many = Object.fromEntries(
        Array.from({ length: 103 }, (_, i) => ['file' + i + '.bin', new Uint8Array([i])]),
      );
      const original = api.encodeYaz0(makeU8(contents));
      await page.locator('#sub').getByRole('button', { name: 'SZS', exact: true }).click();
      await page
        .locator('#fileSZS')
        .setInputFiles({ name: 'sample.szs', mimeType: 'application/octet-stream', buffer: Buffer.from(original) });
      await page.getByText('sample.szs', { exact: true }).waitFor();
      assert.equal(await page.locator('.szs-entry').count(), 96);
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      assert.ok(
        await page.getByRole('button', { name: 'Select archive file ./many/file102.bin', exact: true }).isVisible(),
      );
      await page.getByLabel('Search archive files').fill('keep.bin');
      await page.getByRole('button', { name: 'Select archive file ./assets/keep.bin', exact: true }).click();
      await page.locator('#fileSZSReplace').setInputFiles({
        name: 'new.bin',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('replacement bytes'),
      });
      await page.getByText('1 replacement staged', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Revert selected file', exact: true }).click();
      assert.equal(await page.evaluate(() => __pm.SZED.changes.size), 0);
      await page.getByLabel('Search archive files').fill('course.kmp');
      await page.getByRole('button', { name: 'Select archive file ./course.kmp', exact: true }).click();
      await page
        .locator('#fileSZSReplace')
        .setInputFiles({ name: 'wrong.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('wrong') });
      await page.getByRole('alert').waitFor();
      assert.equal(await page.evaluate(() => __pm.SZED.changes.size), 0);
      await page.evaluate(() => {
        __pm.S.track.start = null;
      });
      await page.getByRole('button', { name: 'Use current project course files', exact: true }).click();
      assert.equal(await page.evaluate(() => __pm.SZED.changes.size), 0, 'failed bulk export is atomic');
      await page.evaluate(() => {
        __pm.S.track.start = { position: [1, 2, 3], rotation: [0, 90, 0] };
      });
      await page.getByRole('button', { name: 'Use current project course files', exact: true }).click();
      assert.equal(await page.evaluate(() => __pm.SZED.changes.size), 3);
      await page.getByLabel('Search archive files').fill('');
      await page.screenshot({ path: `work/szs-${mobile ? 'phone' : 'desktop'}.png` });
      await page
        .locator('#fileSZS')
        .setInputFiles({ name: 'bad.szs', mimeType: 'application/octet-stream', buffer: Buffer.from('bad archive') });
      await page.getByRole('alert').waitFor();
      assert.equal(await page.evaluate(() => __pm.SZED.changes.size), 3, 'invalid import preserves pending edits');
      assert.equal(await page.evaluate(() => __pm.SZED.name), 'sample.szs');
      await page.getByRole('button', { name: 'Prepare SZS download', exact: true }).click();
      await page.getByRole('button', { name: 'Save & Send SZS…', exact: true }).waitFor();
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Save & Send SZS…', exact: true }).click();
      const d = await pending,
        file = `work/szs-ui-${mobile ? 'phone' : 'desktop'}.szs`;
      await d.saveAs(file);
      const saved = api.inspectSZS(new Uint8Array(fs.readFileSync(file))),
        old = api.inspectSZS(original);
      for (const n of old.nodes.filter((n) => !n.directory && !n.name.startsWith('course')))
        assert.deepEqual(api.szsEntryBytes(saved, n.id), api.szsEntryBytes(old, n.id));
      const kn = saved.nodes.find((n) => n.name === 'course.kmp');
      assert.deepEqual(api.inspectKMP(api.szsEntryBytes(saved, kn.id)).start.position, [100, 300, -200]);
      await page.locator('#fileSZS').setInputFiles({
        name: 'roundtrip.szs',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(fs.readFileSync(file)),
      });
      await page.getByText('roundtrip.szs', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => __pm.SZED.changes.size), 0);
      assert.deepEqual(errors, []);
      await ctx.close();
      console.log(
        `${mobile ? 'iPhone' : 'Desktop'} placement/camera/gizmo/thumbnail/SZS import/replacement/download preservation passed`,
      );
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
