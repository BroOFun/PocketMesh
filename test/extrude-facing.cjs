const { chromium, devices } = require('playwright');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8765/'); await page.waitForTimeout(1000);
  await page.click('#sheetClose').catch(() => {});
  const cdp = await ctx.newCDPSession(page);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
  const E = (f, a) => page.evaluate(f, a);
  const out = (o) => E(() => { const o = __pm.S.active; const f = o.mesh.faces[[...o.esel.faces][0]]; return -1 - f.v.reduce((s, v) => s + o.mesh.verts[v][1], 0) / f.v.length; });
  for (const [label, yawDeg, pitchDeg] of [['face-on (front view)', -90, 0], ['slightly off-axis', -80, 8], ['default 3/4 view', -43, 26], ['from behind-ish', -150, 20], ['top-down', -90, 85]]) {
    await page.click('#btnMenu'); await page.click('#sheetBody .mi:has(.t:text-is("New Scene"))'); await page.click('#sheetBody button:has-text("Discard")');
    await E(([y, p]) => { const C = __pm.CAM; C.yaw = y * Math.PI / 180; C.pitch = p * Math.PI / 180; C.ortho = false; __pm.applyCamera(); __pm.S.active.node.updateMatrixWorld(); }, [yawDeg, pitchDeg]);
    await E(() => { __pm.setMode('edit'); __pm.setSelectMode('face'); const o = __pm.S.active, f = o.mesh.faces[1]; o.esel = { verts: new Set(f.v), edges: new Set(f.v.map((v, i) => { const w = f.v[(i + 1) % 4]; return Math.min(v, w) + '_' + Math.max(v, w); })), faces: new Set([1]) }; });
    await page.click('#shelf button:has-text("Extrude")');
    const guide = await E(() => ({ hint: document.querySelector('#hint').textContent }));
    // screen direction of the outward arrow (-Y from the face center)
    const dir = await E(() => { const a = __pm.screenOf(0, -1, 0), b = __pm.screenOf(0, -1.3, 0); const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy); return l > 2 ? { x: dx / l, y: dy / l, len: l } : { x: 0, y: -1, len: l }; });
    const steps = [];
    await T('touchStart', [{ x: 200, y: 520 }]);
    for (let i = 1; i <= 15; i++) { await T('touchMove', [{ x: 200 + dir.x * 120 * i / 15, y: 520 + dir.y * 120 * i / 15 }]); steps.push(await out()); }
    await T('touchEnd', []);
    const final = steps[steps.length - 1];
    let maxJump = 0; for (let i = 1; i < steps.length; i++) maxJump = Math.max(maxJump, Math.abs(steps[i] - steps[i - 1]));
    const mono = steps.every((v, i) => i === 0 || v >= steps[i - 1] - 1e-9);
    ok(final > 0.3 && final < 6 && mono && maxJump < 0.8, `${label}: drag 120px along the arrow → face moves out ${final.toFixed(2)} units (steady: max step ${maxJump.toFixed(2)})`);
    await page.click('#tfbar .cancel');
  }
  // the old failure case: face-on, sliding straight up pulls it toward you
  await E(() => { const C = __pm.CAM; C.yaw = -Math.PI / 2; C.pitch = 0; __pm.applyCamera(); });
  await E(() => { const o = __pm.S.active, f = o.mesh.faces[1]; o.esel = { verts: new Set(f.v), edges: new Set(f.v.map((v, i) => { const w = f.v[(i + 1) % 4]; return Math.min(v, w) + '_' + Math.max(v, w); })), faces: new Set([1]) }; });
  await page.click('#shelf button:has-text("Extrude")');
  await T('touchStart', [{ x: 200, y: 520 }]); for (let i = 1; i <= 10; i++) await T('touchMove', [{ x: 200, y: 520 - 10 * i }]); await T('touchEnd', []);
  const up = await out();
  const hintText = await page.textContent('#hint');
  console.log('face-on hint: ' + hintText);
  const guideVisible = await E(() => true);
  await page.screenshot({ path: process.env.SHOTS + '/60-extrude-guide.png' });
  await page.click('#tfbar .ok');
  ok(up > 0.5, `face-on: slide up 100px pulls the face toward you by ${up.toFixed(2)} units`);
  await E(() => { const C = __pm.CAM; C.yaw = -43 * Math.PI / 180; C.pitch = 26 * Math.PI / 180; __pm.applyCamera(); });
  await E(() => { const o = __pm.S.active, f = o.mesh.faces[1]; o.esel = { verts: new Set(f.v), edges: new Set(f.v.map((v, i) => { const w = f.v[(i + 1) % f.v.length]; return Math.min(v, w) + '_' + Math.max(v, w); })), faces: new Set([1]) }; });
  await page.click('#shelf button:has-text("Extrude")');
  await T('touchStart', [{ x: 200, y: 450 }]); for (let i = 1; i <= 6; i++) await T('touchMove', [{ x: 200 - 6 * i, y: 450 + 4 * i }]);
  await page.waitForTimeout(150);
  await page.screenshot({ path: process.env.SHOTS + '/61-extrude-guide-new.png' });
  await T('touchEnd', []);
  await page.click('#tfbar .ok');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
