const { chromium, devices } = require('playwright');
const SHOTS = process.env.SHOTS || '/tmp/shots';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto('http://localhost:8765/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOTS + '/01-start.png' });
  // close welcome sheet
  await page.click('#sheetClose').catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + '/02-main.png' });
  console.log(errors.join('\n') || 'no console errors');
  await browser.close();
})();
