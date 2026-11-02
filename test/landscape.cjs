const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ ...devices['iPhone 14 landscape'] });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8765/'); await page.waitForTimeout(1200);
  await page.click('#sheetClose').catch(() => {});
  await page.evaluate(() => __pm.setMode('edit'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: process.env.SHOTS + '/30-landscape.png' });
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, view: document.querySelector('#btnView').getBoundingClientRect().right }));
  console.log(JSON.stringify(ov), errs.join('\n') || 'no errors');
  await browser.close();
})();
