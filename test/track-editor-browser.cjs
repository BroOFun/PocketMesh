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
      assert.equal(await page.evaluate(() => __pm.S.track.scale), 100);
      for (const name of ['Move', 'Rotate', 'Scale'])
        assert.equal(await page.locator('#shelf').getByRole('button', { name, exact: true }).count(), 0);
      for (const name of ['Move gizmo', 'Rotate gizmo', 'Scale gizmo'])
        assert.ok(await page.getByRole('button', { name, exact: true }).isVisible());
      const category = async (name) => {
        if (await page.locator('#sheet').isVisible()) await page.locator('#sheetClose').click();
        await page.locator('#sub').getByRole('button', { name: 'Track Editor', exact: true }).click();
        await page
          .locator('#sheet')
          .getByRole('button', { name: new RegExp('^' + name) })
          .click();
      };
      await category('Course Model');
      assert.match(await page.locator('#sheetTitle').textContent(), /Course Model/);
      assert.equal(await page.getByLabel('Shared Wii export scale').inputValue(), '100');
      await category('KCL');
      assert.equal(await page.evaluate(() => __pm.S.workspace), 'kcl');
      await category('KMP');
      assert.equal(await page.evaluate(() => __pm.S.workspace), 'kmp');
      await category('SZS');
      assert.match(await page.locator('#sheetTitle').textContent(), /SZS/);
      await category('Course Model');
      await page.getByRole('button', { name: 'Edit geometry', exact: true }).click();
      // An old 1:1 scene becomes 100x for all authored Wii files; editor coordinates stay unchanged.
      await page.evaluate(async () => {
        const p = __pm,
          d = p.serializeProject(),
          o = d.objects[0];
        o.mesh = {
          verts: [
            [-1, -1, 0],
            [1, -1, 0],
            [1, 1, 0],
            [-1, 1, 0],
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
        };
        o.pos = [1, 2, 3];
        o.scl = [2, 1, 1];
        o.quat = [0, 0, 0, 1];
        o.modifiers = [];
        d.track = { scale: 1, start: { position: [1, 2, 3], rotation: [0, 90, 0] } };
        await p.loadProject(d);
      });
      const before = await page.evaluate(() => JSON.stringify(__pm.serializeProject().objects));
      async function exported() {
        return page.evaluate(() => {
          const p = __pm,
            b = p.runExport('brres', { baseName: 'course_model', selectedOnly: false, scale: 1, zip: false }).data;
          const a = p.inspectBRRES(b),
            at = a.resources.find((r) => r.type === 'MDL0').offset,
            v = new DataView(b.buffer, b.byteOffset, b.byteLength);
          const bounds = [0, 1, 2, 3, 4, 5].map((i) => v.getFloat32(at + 0x74 + 4 * i));
          const triangles = p.trackTriangles(),
            kmp = p.inspectKMP(p.szsProjectFile('course.kmp'));
          return {
            bounds,
            points: triangles.flatMap((t) => t.points),
            start: kmp.start.position,
            kcl: Array.from(p.szsProjectFile('course.kcl')),
            brres: Array.from(b),
            szsBrres: Array.from(p.szsProjectFile('course_model.brres')),
          };
        });
      }
      let files = await exported();
      assert.deepEqual(files.bounds, [-100, 300, -300, 300, 300, -100]);
      assert.deepEqual(files.start, [100, 300, -200]);
      assert.deepEqual(files.brres, files.szsBrres, 'SZS injection uses the same BRRES scale');
      const bounds = (pts) =>
        [...Array(3)]
          .map((_, i) => Math.min(...pts.map((p) => p[i])))
          .concat([...Array(3)].map((_, i) => Math.max(...pts.map((p) => p[i]))));
      assert.deepEqual(bounds(files.points), files.bounds);
      // Independently reconstruct KCL prism vertices and compare to model coordinates.
      const bytes = Uint8Array.from(files.kcl),
        v = new DataView(bytes.buffer),
        po = v.getUint32(0),
        no = v.getUint32(4),
        pr = v.getUint32(8),
        tree = v.getUint32(12);
      const vec = (off) => [0, 1, 2].map((i) => v.getFloat32(off + i * 4)),
        cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
        dot = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0),
        points = [];
      for (let off = pr + 16; off < tree; off += 16) {
        const len = v.getFloat32(off),
          p = vec(po + v.getUint16(off + 4) * 12),
          n = vec(no + v.getUint16(off + 6) * 12),
          a = vec(no + v.getUint16(off + 8) * 12),
          b = vec(no + v.getUint16(off + 10) * 12),
          c = vec(no + v.getUint16(off + 12) * 12),
          u = cross(b, n),
          w = cross(a, n);
        points.push(
          p,
          p.map((x, i) => x + (u[i] * len) / dot(u, c)),
          p.map((x, i) => x + (w[i] * len) / dot(w, c)),
        );
      }
      bounds(points).forEach((n, i) => assert.ok(Math.abs(n - files.bounds[i]) < 0.001));
      if (process.env.NOCLIP_PARSER) {
        const { parse, ArrayBufferSlice } = await import(process.env.NOCLIP_PARSER);
        const b = Uint8Array.from(files.brres),
          mdl = parse(new ArrayBufferSlice(b.buffer)).mdl0[0];
        assert.deepEqual([...mdl.bbox.min, ...mdl.bbox.max], files.bounds);
      }
      assert.equal(await page.evaluate(() => JSON.stringify(__pm.serializeProject().objects)), before);
      await category('Course Model');
      await page.getByLabel('Shared Wii export scale').fill('200');
      await page.getByLabel('Shared Wii export scale').press('Tab');
      files = await exported();
      assert.deepEqual(files.start, [200, 600, -400]);
      assert.deepEqual(files.bounds, [-200, 600, -600, 600, 600, -200]);
      assert.deepEqual(bounds(files.points), files.bounds);
      await page.evaluate(() => __pm.undo());
      assert.equal(await page.evaluate(() => __pm.S.track.scale), 100);
      await page.locator('#sheetClose').click();
      // Prepare a road boundary in top view for repeated touch / mouse extrusion.
      await page.evaluate(async () => {
        const p = __pm,
          d = p.serializeProject(),
          o = d.objects[0];
        o.pos = [0, 0, 0];
        o.scl = [1, 1, 1];
        d.camera = { target: [0, 2, 0], yaw: 0, pitch: Math.PI / 2, dist: 16, ortho: true };
        await p.loadProject(d);
        p.setMode('edit');
        p.setSelectMode('edge');
        p.editSelectAll('none');
      });
      const tap = async (p) => (mobile ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
      const screen = async (p) => page.evaluate((p) => __pm.screenOf(...p), p);
      await tap(await screen([0, 1, 0]));
      assert.equal(await page.evaluate(() => __pm.S.active.esel.edges.size), 1);
      await page.locator('#shelf').getByRole('button', { name: 'Extrude', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => [__pm.S.extrudeTap, __pm.S.extrudeRotate]), [false, false]);
      for (const name of ['Move', 'Rotate', 'Scale'])
        assert.equal(await page.locator('#shelf').getByRole('button', { name, exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Tap extrude', exact: true }).click();
      await tap(await screen([0, 3, 0]));
      let state = await page.evaluate(() => {
        const o = __pm.S.active,
          ids = [...o.esel.verts];
        return { points: ids.map((i) => o.mesh.verts[i]), faces: o.mesh.faces.length };
      });
      assert.equal(state.faces, 2);
      assert.ok(state.points.every((p) => Math.abs(p[1] - 3) < 0.02 && Math.abs(p[2]) < 0.001));
      await page.getByRole('button', { name: 'Rotate to tap', exact: true }).click();
      await tap(await screen([1.5, 4.5, 0]));
      state = await page.evaluate(() => {
        const o = __pm.S.active,
          ids = [...o.esel.verts];
        return { points: ids.map((i) => o.mesh.verts[i]), faces: o.mesh.faces.length, verts: o.mesh.verts };
      });
      assert.equal(state.faces, 3);
      const [p, q] = state.points;
      assert.ok(Math.abs(Math.hypot(...q.map((n, i) => n - p[i])) - 2) < 0.02, 'turn preserves width');
      assert.ok(Math.abs((p[0] + q[0]) / 2 - 1.5) < 0.02 && Math.abs((p[1] + q[1]) / 2 - 4.5) < 0.02);
      assert.ok(Math.abs(q[0] - p[0]) > 1 && Math.abs(q[1] - p[1]) > 1, 'new edge rotates toward diagonal tap');
      const count = await page.evaluate(() => __pm.S.active.mesh.faces.length);
      // Dragging in tap mode or cancelling a pointer must not extrude.
      const cdp = await ctx.newCDPSession(page),
        start = await screen([0, 2, 0]);
      if (mobile) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: start.x + 35, y: start.y + 20, id: 1 }],
        });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 35, start.y + 20, { steps: 3 });
        await page.mouse.up();
      }
      assert.equal(await page.evaluate(() => __pm.S.active.mesh.faces.length), count);
      await page.evaluate(() => __pm.undo());
      assert.equal(await page.evaluate(() => __pm.S.active.mesh.faces.length), 2);
      await page.evaluate(() => __pm.redo());
      assert.equal(await page.evaluate(() => __pm.S.active.mesh.faces.length), 3);
      if (!mobile) {
        await page.evaluate(() => {const p=__pm;p.CAM.pitch=Math.PI/2;p.CAM.yaw=0;p.applyCamera();});
        const point=await screen([3,6,0]);
        await page.keyboard.down('Control');
        await page.mouse.click(point.x, point.y, {button:'right'});
        await page.keyboard.up('Control');
        assert.equal(await page.evaluate(() => __pm.S.active.mesh.faces.length),4,'Ctrl-right-click extrusion');
        await page.evaluate(() => __pm.undo());
      }
      // The same tool retains ordinary extrusion and Done commits its modal move.
      await page.getByRole('button', { name: 'Extrude tool', exact: true }).click();
      await page.getByRole('button', { name: 'Drag extrude', exact: true }).click();
      assert.ok(await page.locator('#tfbar').isVisible());
      await page.getByRole('button', { name: 'Done extruding', exact: true }).click();
      assert.ok(await page.locator('#tfbar').isHidden());
      assert.equal(await page.evaluate(() => __pm.S.tool), 'select');
      assert.equal(await page.evaluate(() => __pm.S.active.mesh.faces.length), 4);
      await page.locator('#btnUndo').click();
      assert.equal(await page.evaluate(() => __pm.S.active.mesh.faces.length), 3);
      await page.getByRole('button', { name: 'Extrude tool', exact: true }).click();
      fs.mkdirSync('work', { recursive: true });
      await page.screenshot({ path: `work/tap-extrude-${mobile ? 'mobile' : 'desktop'}.png`, animations: 'disabled' });
      const saved = await page.evaluate(() => __pm.serializeProject());
      await page.evaluate((d) => __pm.loadProject(d), saved);
      assert.equal(await page.evaluate(() => __pm.S.active.mesh.faces.length), 3);
      assert.equal(await page.evaluate(() => __pm.S.track.scale), 100);
      assert.deepEqual(errors, []);
      console.log(
        `${mobile ? 'Mobile' : 'Desktop'}: Track Editor navigation, shared 100x BRRES/KCL/KMP/SZS, unchanged viewport, tap extrusion, turning, drag/undo/save passed`,
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
