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
  const twist = async (cx, cy, r, degTotal, steps = 12) => {
    const P = (a) => [{ x: cx - r * Math.cos(a), y: cy - r * Math.sin(a) }, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }];
    await T('touchStart', P(0));
    for (let i = 1; i <= steps; i++) await T('touchMove', P((degTotal * Math.PI / 180) * i / steps));
    await T('touchEnd', []);
  };
  const pinch = async (cx, cy, r0, r1) => {
    await T('touchStart', [{ x: cx - r0, y: cy }, { x: cx + r0, y: cy }]);
    for (let i = 1; i <= 10; i++) { const r = r0 + (r1 - r0) * i / 10; await T('touchMove', [{ x: cx - r, y: cy }, { x: cx + r, y: cy }]); }
    await T('touchEnd', []);
  };
  // --- separate by material
  await E(() => {
    const S = __pm.S, o = S.active;
    S.materials.push({ id: 99, name: 'Red', color: '#cc3333', roughness: 0.5, metalness: 0, alpha: 1, texture: null, filter: 'linear' });
    o.materials.push(99); o.mesh.faces[4].mat = 1;
  });
  await page.click('#shelf button:has-text("Separate")'); await page.click('#sheetBody .mi:has(.t:text-is("By Material"))'); await page.waitForTimeout(200);
  const sep = await E(() => __pm.S.objects.map((o) => [o.name, o.mesh.faces.length, o.materials.length]));
  ok(sep.length === 2 && sep[0][1] === 5 && sep[1][1] === 1 && sep[1][0].includes('Red'), 'separate by material → ' + JSON.stringify(sep));
  // --- 3D twist turns the view
  const yaw0 = await E(() => __pm.CAM.yaw);
  await twist(195, 450, 70, 40);
  const dyaw = ((await E(() => __pm.CAM.yaw)) - yaw0) * 180 / Math.PI;
  ok(Math.abs(dyaw - 40) < 3, `3D twist 40° turns view by ${dyaw.toFixed(1)}°`);
  // --- map style: one finger pans instead of orbiting
  await E(() => { __pm.S.navStyle = 'map'; });
  const tgt0 = await E(() => __pm.CAM.target.toArray()), y1 = await E(() => __pm.CAM.yaw);
  await T('touchStart', [{ x: 150, y: 500 }]); for (let i = 1; i <= 8; i++) await T('touchMove', [{ x: 150 + i * 10, y: 500 }]); await T('touchEnd', []);
  const tgt1 = await E(() => __pm.CAM.target.toArray()), y2 = await E(() => __pm.CAM.yaw);
  ok(Math.hypot(tgt1[0] - tgt0[0], tgt1[1] - tgt0[1], tgt1[2] - tgt0[2]) > 0.3 && Math.abs(y2 - y1) < 1e-9, 'map style: one finger pans');
  const p0 = await E(() => __pm.CAM.pitch);
  await T('touchStart', [{ x: 150, y: 500 }, { x: 250, y: 500 }]); for (let i = 1; i <= 8; i++) await T('touchMove', [{ x: 150, y: 500 + i * 8 }, { x: 250, y: 500 + i * 8 }]); await T('touchEnd', []);
  ok((await E(() => __pm.CAM.pitch)) > p0 + 0.2, 'map style: two-finger slide tilts');
  await E(() => { __pm.S.navStyle = 'modeler'; });
  // --- UV view: pinch both ways + twist with 90° snapping
  await E(() => __pm.setMode('edit'));
  await page.click('#btnView'); await page.click('#btnView'); await page.waitForTimeout(300);
  const box = await page.$eval('#cuv', (el) => { const r = el.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
  const s0 = await E(() => UV_dbg());
  await pinch(box.cx, box.cy, 40, 120);
  const s1 = await E(() => UV_dbg());
  ok(s1.scale > s0.scale * 2, `UV spread fingers zooms in (${s0.scale.toFixed(0)} → ${s1.scale.toFixed(0)})`);
  await pinch(box.cx, box.cy, 120, 40);
  const s2 = await E(() => UV_dbg());
  ok(s2.scale < s1.scale / 2, `UV pinch zooms out (${s1.scale.toFixed(0)} → ${s2.scale.toFixed(0)})`);
  await twist(box.cx, box.cy, 80, 45);
  const r45 = (await E(() => UV_dbg())).rot;
  ok(Math.abs(r45 - 45) < 3, `UV twist 45° rotates view ${r45.toFixed(1)}°`);
  await twist(box.cx, box.cy, 80, 40);
  const r90 = (await E(() => UV_dbg())).rot;
  ok(Math.abs(r90 - 90) < 1e-6, `UV twist to ~85° clicks to exactly ${r90.toFixed(3)}°`);
  // --- UV rotate tool snaps to 90
  await page.click('#uvtools button[aria-label="Fit view"]');
  await E(() => __pm.editSelectAll('select'));
  await page.click('#shelf button:has-text("Select")'); await page.click('#sheetBody .mi:has(.t:text-is("All"))');
  await page.click('#uvtools button[aria-label="Drag to rotate UVs"]');
  const before = await E(() => __pm.S.active.mesh.faces.map((f) => f.uv.map((u) => u.slice())));
  const c = await E(() => { const m = __pm.S.active.mesh; let u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9; for (const f of m.faces) for (const u of f.uv) { u0 = Math.min(u0, u[0]); u1 = Math.max(u1, u[0]); v0 = Math.min(v0, u[1]); v1 = Math.max(v1, u[1]); } const s = UV_s((u0 + u1) / 2, (v0 + v1) / 2); const r = document.querySelector('#cuv').getBoundingClientRect(); return { x: s[0] + r.left, y: s[1] + r.top }; });
  // drag around the center by ~87° counter-clockwise
  const R = 90, P = (a) => ({ x: c.x + R * Math.cos(a), y: c.y - R * Math.sin(a) });
  await T('touchStart', [P(0)]); for (let i = 1; i <= 12; i++) await T('touchMove', [P((87 * Math.PI / 180) * i / 12)]); await T('touchEnd', []);
  const after = await E(() => __pm.S.active.mesh.faces.map((f) => f.uv.map((u) => u.slice())));
  // check exact 90° rotation about some center: (u,v)-c rotated by 90 => compare first two corners' delta vectors
  const d0 = [before[0][1][0] - before[0][0][0], before[0][1][1] - before[0][0][1]], d1 = [after[0][1][0] - after[0][0][0], after[0][1][1] - after[0][0][1]];
  const ang = Math.atan2(d1[1], d1[0]) - Math.atan2(d0[1], d0[0]);
  const deg = ((ang * 180 / Math.PI) % 360 + 360) % 360;
  ok(Math.abs(deg - 90) < 1e-6, `UV rotate tool dragged ~87° snaps to ${deg.toFixed(4)}°`);
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
