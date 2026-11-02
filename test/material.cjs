const { chromium, devices } = require('playwright');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const SP = process.env.SP;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ ...devices['iPhone 14'], acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8765/'); await page.waitForTimeout(1000);
  await page.click('#sheetClose').catch(() => {});
  const E = (f, a) => page.evaluate(f, a);
  // object with no material: palette click creates one
  await page.click('#shelf button:has-text("Add")'); await page.click('#sheetBody .mi:has(.t:text-is("UV Sphere"))'); await page.waitForTimeout(200);
  ok(await E(() => __pm.S.active.materials.length === 0), 'new sphere has no material');
  await page.click('#shelf button:has-text("Material")'); await page.waitForTimeout(200);
  await page.screenshot({ path: SP + '/shots/50-material-empty.png' });
  await page.click('#sheetBody button[aria-label="Color #3b7dd8"]'); await page.waitForTimeout(150);
  ok(await E(() => { const o = __pm.S.active; const m = __pm.S.materials.find((x) => x.id === o.materials[0]); return m && m.color === '#3b7dd8'; }), 'palette tap created a material with that base color');
  const hex = await page.$('#sheetBody input[aria-label="Base color hex"]');
  await hex.fill('ff8800'); await hex.press('Enter'); await page.waitForTimeout(150);
  ok(await E(() => __pm.S.materials.find((x) => x.id === __pm.S.active.materials[0]).color === '#ff8800'), 'hex field sets color');
  // upload an image via Image Texture tab
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#sheetBody .segrow button:text-is("Image Texture")')]);
  await chooser.setFiles(SP + '/photo.jpg'); await page.waitForTimeout(800);
  const st = await E(() => { const m = __pm.S.materials.find((x) => x.id === __pm.S.active.materials[0]); const im = __pm.S.images.get(m.texture); return { useTexture: m.useTexture, mime: im && im.mime, w: im && im.width, name: im && im.name, map: !!__pm.S.active.meshNode.material[0].map, shading: __pm.S.shading }; });
  ok(st.useTexture && st.mime === 'image/jpeg' && st.w === 512 && st.map, 'uploaded photo becomes the base color texture ' + JSON.stringify(st));
  await page.screenshot({ path: SP + '/shots/51-material-texture.png' });
  await page.click('#sheetClose');
  await page.screenshot({ path: SP + '/shots/52-solid-textured.png' });
  // export: untinted texture writes white base color
  const scene = await E(() => { const r = __pm.runExport('glb', { selectedOnly: true, applyTransforms: false, triangulate: true, yUp: true, zip: false, baseName: 't' }); const dv = new DataView(r.data.buffer, r.data.byteOffset); const jl = dv.getUint32(12, true); const j = JSON.parse(new TextDecoder().decode(r.data.subarray(20, 20 + jl))); return j.materials[0].pbrMetallicRoughness; });
  ok(scene.baseColorTexture && scene.baseColorFactor.slice(0, 3).every((x) => Math.abs(x - 1) < 1e-6), 'GLB: texture with white base color factor ' + JSON.stringify(scene.baseColorFactor));
  // back to color mode keeps the image stored but unused
  await page.click('#shelf button:has-text("Material")'); await page.waitForTimeout(150);
  await page.click('#sheetBody .segrow button:text-is("Color")'); await page.waitForTimeout(150);
  ok(await E(() => !__pm.S.active.meshNode.material[0].map), 'switching to Color removes the texture from the surface');
  await page.click('#sheetBody .segrow button:text-is("Image Texture")'); await page.waitForTimeout(150);
  ok(await E(() => !!__pm.S.active.meshNode.material[0].map), 'switching back reuses the stored image without re-uploading');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})();
