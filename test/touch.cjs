const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8765/'); await page.waitForTimeout(1000);
  await page.click('#sheetClose').catch(() => {});
  const cdp = await ctx.newCDPSession(page);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
  const res = {};
  // tap empty space deselects, tap cube selects
  await T('touchStart', [{ x: 60, y: 600 }]); await T('touchEnd', []);
  await page.waitForTimeout(100);
  res.afterEmptyTap = await page.evaluate(() => __pm.S.objects.filter((o) => o.selected).length);
  const c = await page.evaluate(() => __pm.screenOf(0, 0, 0));
  await T('touchStart', [c]); await T('touchEnd', []);
  await page.waitForTimeout(100);
  res.afterCubeTap = await page.evaluate(() => __pm.S.objects.filter((o) => o.selected).length);
  // one-finger orbit
  const yaw0 = await page.evaluate(() => __pm.CAM.yaw);
  await T('touchStart', [{ x: 200, y: 500 }]);
  for (let i = 1; i <= 10; i++) await T('touchMove', [{ x: 200 + i * 10, y: 500 }]);
  await T('touchEnd', []);
  res.yawChanged = +((await page.evaluate(() => __pm.CAM.yaw)) - yaw0).toFixed(3);
  // two-finger pinch out = zoom in
  const d0 = await page.evaluate(() => __pm.CAM.dist);
  await T('touchStart', [{ x: 170, y: 450 }, { x: 230, y: 450 }]);
  for (let i = 1; i <= 10; i++) await T('touchMove', [{ x: 170 - i * 8, y: 450 }, { x: 230 + i * 8, y: 450 }]);
  await T('touchEnd', []);
  res.zoomRatio = +((await page.evaluate(() => __pm.CAM.dist)) / d0).toFixed(3);
  // two-finger tap = undo (select a different shading first so there is something to undo)
  const idx0 = await page.evaluate(() => __pm.UNDO.idx);
  await page.evaluate(() => __pm.setMode('edit'));
  const idx1 = await page.evaluate(() => __pm.UNDO.idx);
  await T('touchStart', [{ x: 150, y: 450 }, { x: 250, y: 450 }]); await T('touchEnd', []);
  await page.waitForTimeout(100);
  res.twoFingerTapUndo = (await page.evaluate(() => __pm.UNDO.idx)) === idx1 - 1 && (await page.evaluate(() => __pm.S.mode)) === 'object';
  res.errs = errs;
  console.log(JSON.stringify(res));
  await browser.close();
})();
