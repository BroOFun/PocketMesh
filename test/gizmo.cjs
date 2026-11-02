const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8765/'); await page.waitForTimeout(1000);
  await page.click('#sheetClose').catch(() => {});
  await page.evaluate(() => { indexedDB.deleteDatabase('pocketmesh'); });
  await page.click('#tools button[aria-label="Move gizmo"]'); await page.waitForTimeout(200);
  // point on the X arrow handle in screen space
  const pts = await page.evaluate(() => {
    const S = __pm.S, cam = __pm.CAM;
    const o = S.active; const p = o.node.position;
    const fov = 50, d = Math.hypot(...['x', 'y', 'z'].map((k) => 0)) ;
    const camPos = (() => { const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch); return [cam.target.x + cam.dist * cp * cy, cam.target.y + cam.dist * cp * sy, cam.target.z + cam.dist * sp]; })();
    const dist = Math.hypot(camPos[0] - p.x, camPos[1] - p.y, camPos[2] - p.z);
    const factor = dist * Math.min(1.9 * Math.tan(Math.PI * fov / 360), 7) * 1.15 / 4;
    const a = __pm.screenOf(0.4 * factor, 0, 0), b = __pm.screenOf(0.4 * factor + 1, 0, 0);
    return { a, b };
  });
  const before = await page.evaluate(() => __pm.S.active.node.position.x);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
  await touch('touchStart', pts.a);
  for (let i = 1; i <= 12; i++) await touch('touchMove', { x: pts.a.x + (pts.b.x - pts.a.x) * i / 12, y: pts.a.y + (pts.b.y - pts.a.y) * i / 12 });
  await touch('touchEnd');
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => __pm.S.active.node.position.toArray());
  const undoLabel = await page.evaluate(() => __pm.UNDO.stack[__pm.UNDO.idx].label);
  console.log(JSON.stringify({ before, after: after.map((x) => +x.toFixed(3)), undoLabel, errs }));
  await page.screenshot({ path: process.env.SHOTS + '/40-gizmo.png' });
  await browser.close();
})();
