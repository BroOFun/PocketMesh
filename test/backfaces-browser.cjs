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
        }),
        page = await ctx.newPage(),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await ctx.addInitScript(() => {
        localStorage.setItem('pm_welcomed', 'true');
        localStorage.setItem('pm_installHinted', 'true');
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__pm);
      assert.equal(await page.evaluate(() => __pm.S.faceOrient), true, 'default is on');
      await page.evaluate(async () => {
        const p = __pm,
          d = p.serializeProject();
        d.objects = [
          {
            ...d.objects[0],
            pos: [0, 0, 0],
            scl: [1, 1, 1],
            selected: false,
            materials: [1],
            mesh: {
              verts: [
                [-3, -2, 1],
                [-1, -2, 1],
                [-1, 2, 1],
                [-3, 2, 1],
                [1, -2, 1],
                [3, -2, 1],
                [3, 2, 1],
                [1, 2, 1],
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
                {
                  v: [7, 6, 5, 4],
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
        d.materials = [
          { ...d.materials[0], id: 1, name: 'Textured road', shader: 'unlit', color: '#ffffff', doubleSided: true },
        ];
        d.camera = { target: [0, 0, 1], yaw: 0, pitch: Math.PI / 2, dist: 14, ortho: true };
        d.settings.shading = 'solid';
        await p.loadProject(d);
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const g = c.getContext('2d');
        g.fillStyle = '#4090c0';
        g.fillRect(0, 0, 8, 16);
        g.fillStyle = '#a0b0c0';
        g.fillRect(8, 0, 8, 16);
        const im = p.addImageFromCanvas('two-tone.png', c);
        p.S.materials[0].texture = im.id;
        p.rebuildObject(p.S.active);
        p.pushUndo('Textured fixture');
      });
      const point = async (x, y = 0.63, z = 1) => page.evaluate(([x, y, z]) => __pm.screenOf(x, y, z), [x, y, z]);
      const pixel = async (x, y = 0.63, z = 1) => {
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const p = await point(x, y, z),
          png = await page.screenshot({
            clip: { x: Math.floor(p.x) - 1, y: Math.floor(p.y) - 1, width: 3, height: 3 },
            scale: 'css',
          });
        return page.evaluate(async (b64) => {
          const im = new Image();
          im.src = 'data:image/png;base64,' + b64;
          await im.decode();
          const c = document.createElement('canvas');
          c.width = c.height = 3;
          const g = c.getContext('2d');
          g.drawImage(im, 0, 0);
          return [...g.getImageData(1, 1, 1, 1).data].slice(0, 3);
        }, png.toString('base64'));
      };
      const near = (a, b, t = 3) => a.every((n, i) => Math.abs(n - b[i]) <= t);
      const toggle = async () => {
        await page.getByRole('button', { name: 'Viewport shading', exact: true }).click();
        await page.getByRole('button', { name: /^Backface overlay: / }).click();
      };
      await toggle();
      assert.equal(await page.evaluate(() => __pm.S.faceOrient), false);
      const frontOff = await pixel(-2.5),
        backOff = await pixel(1.5),
        backOtherOff = await pixel(2.5);
      const before = await page.evaluate(() =>
        Array.from(__pm.runExport('brres', { baseName: 'course_model', selectedOnly: false }).data),
      );
      await toggle();
      const frontOn = await pixel(-2.5),
        backOn = await pixel(1.5),
        backOtherOn = await pixel(2.5);
      assert.ok(near(frontOn, frontOff), 'front pixels unchanged');
      assert.ok(
        near(
          backOn,
          backOff.map((v, i) => v * 0.72 + [255, 40.8, 51][i] * 0.28),
        ),
        'back is a subtle 28% red tint',
      );
      assert.ok(
        near(
          backOtherOn,
          backOtherOff.map((v, i) => v * 0.72 + [255, 40.8, 51][i] * 0.28),
        ),
        'texture variation remains visible',
      );
      assert.deepEqual(
        await page.evaluate(() =>
          Array.from(__pm.runExport('brres', { baseName: 'course_model', selectedOnly: false }).data),
        ),
        before,
        'overlay never changes export bytes',
      );
      await page.screenshot({ path: `work/backfaces-${mobile ? 'phone' : 'desktop'}.png` });
      // Flipping a face removes the tint; undo restores it.
      await page.evaluate(() => {
        const p = __pm,
          f = p.S.active.mesh.faces[1];
        f.v.reverse();
        f.uv.reverse();
        p.rebuildObject(p.S.active);
        p.pushUndo('Flip face');
      });
      assert.ok(near(await pixel(1.5), backOff));
      await page.evaluate(() => __pm.undo());
      assert.ok(near(await pixel(1.5), backOn));
      // The same tint is present in lit shading variants and edit/workspace views.
      for (const shading of ['material', 'rendered']) {
        await page.evaluate((k) => {
          const p = __pm;
          p.S.materials[0].shader = 'lit';
          p.setShading(k);
          p.setBackfaceOverlay(false);
        }, shading);
        const f = await pixel(-2.5),
          b = await pixel(1.5);
        await page.evaluate(() => __pm.setBackfaceOverlay(true));
        assert.ok(near(await pixel(-2.5), f));
        assert.ok(
          near(
            await pixel(1.5),
            b.map((v, i) => v * 0.72 + [255, 40.8, 51][i] * 0.28),
            4,
          ),
        );
      }
      await page.evaluate(() => {
        const p = __pm;
        p.S.materials[0].shader = 'unlit';
        p.setShading('solid');
        p.setMode('edit');
      });
      assert.ok(near(await pixel(1.5), backOn));
      await page.evaluate(() => __pm.setMode('object'));
      for (const workspace of ['kcl', 'kmp']) {
        await page.evaluate((w) => {
          __pm.TRACKVIEW.colors = false;
          __pm.setWorkspace(w);
        }, workspace);
        assert.ok(near(await pixel(1.5), backOn));
      }
      await page.evaluate(() => __pm.setWorkspace('model'));
      // Transparent double-sided surfaces use two render passes with reversed GL winding.
      await page.evaluate(() => {
        const p = __pm,
          m = p.S.materials[0];
        m.alphaMode = 'blend';
        m.alpha = 0.6;
        p.setBackfaceOverlay(false);
      });
      const transparentFront = await pixel(-2.5),
        transparentBack = await pixel(1.5);
      await page.evaluate(() => __pm.setBackfaceOverlay(true));
      assert.ok(near(await pixel(-2.5), transparentFront));
      const transparentTint = await pixel(1.5);
      assert.ok(
        transparentTint[0] > transparentBack[0] + 15 && transparentTint[1] < transparentBack[1] - 5,
        'transparent backface is tinted',
      );
      await page.evaluate(() => {
        const p = __pm,
          m = p.S.materials[0];
        m.alphaMode = 'auto';
        m.alpha = 1;
        p.setBackfaceOverlay(true);
      });
      // Respect material culling again when disabled; this is a viewport override only.
      await page.evaluate(() => {
        const p = __pm;
        p.S.materials[0].doubleSided = false;
        p.rebuildObject(p.S.active);
        p.setBackfaceOverlay(false);
      });
      const culled = await pixel(1.5);
      await page.evaluate(() => __pm.setBackfaceOverlay(true));
      assert.ok(near(await pixel(1.5), backOn));
      assert.ok(!near(culled, backOn));
      assert.equal(await page.evaluate(() => __pm.S.materials[0].doubleSided), false);
      await page.evaluate(() => {
        __pm.setShading('wire');
        __pm.setBackfaceOverlay(false);
      });
      const wireFront = await pixel(-2.5),
        wireBack = await pixel(1.5);
      await page.evaluate(() => __pm.setBackfaceOverlay(true));
      assert.ok(near(await pixel(-2.5), wireFront));
      const wireTint = await pixel(1.5);
      assert.ok(wireTint[0] > wireBack[0] + 20, 'wireframe back gets a faint red fill');
      await page.evaluate(() => {
        __pm.setShading('solid');
        __pm.setBackfaceOverlay(false);
      });
      await page.reload();
      await page.waitForFunction(() => window.__pm);
      assert.equal(await page.evaluate(() => __pm.S.faceOrient), false, 'off preference survives reopening');
      await page.getByRole('button', { name: 'Viewport shading', exact: true }).click();
      assert.ok(await page.getByRole('button', { name: /^Backface overlay: off/ }).isVisible());
      await page.getByRole('button', { name: /^Backface overlay: off/ }).click();
      assert.equal(await page.evaluate(() => localStorage.getItem('pm_backfaceOverlay')), 'true');
      assert.deepEqual(errors, []);
      await ctx.close();
      console.log(
        `${mobile ? 'iPhone' : 'Desktop'}: default/toggle persistence, front/back pixels, preserved textures/export, flip/undo, lit/edit/workspaces/culling/wireframe passed`,
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
