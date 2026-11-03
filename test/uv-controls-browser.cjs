const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium, devices } = require('playwright');
(async () => {
  const root = path.resolve(__dirname, '../docs');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const layout of ['desktop', 'phone', 'landscape']) {
      const mobile = layout !== 'desktop';
      const ctx = await browser.newContext({ ...(mobile ? devices['iPhone 14'] : { viewport: {width: 1200, height: 850} }), ...(layout === 'landscape' ? {viewport: {width: 844, height: 390}} : {}), serviceWorkers: 'block' });
      await ctx.addInitScript(() => { localStorage.setItem('pm_welcomed', 'true'); localStorage.setItem('pm_installHinted', 'true'); });
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__pm);
      // A quad with distinct UV corners makes movement and mesh isolation observable.
      await page.evaluate(async () => {
        const p = __pm, d = p.serializeProject();
        d.objects[0].mesh = {verts: [[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]], faces: [{v: [0,1,2,3], uv: [[0,0],[1,0],[1,1],[0,1]], mat: 0}], looseEdges: [], seams: [], creases: []};
        d.objects[0].selected = true;
        d.camera = {target: [0,0,0], yaw: 0, pitch: 1.2, dist: 7, ortho: true};
        await p.loadProject(d); p.setMode('edit'); p.editSelectAll('select'); p.activateExtrude();
      });
      const geometry = await page.evaluate(() => JSON.stringify({verts: __pm.S.active.mesh.verts, pos: __pm.S.active.node.position.toArray(), faces: __pm.S.active.mesh.faces.map(f => f.v)}));
      fs.mkdirSync('work', {recursive: true});
      await page.screenshot({path: `work/cursor-${layout}.png`, animations: 'disabled'});
      await page.locator('#btnView').click();
      const checkFocus = async focus => {
        assert.equal(await page.evaluate(() => __pm.S.focus), focus);
        assert.equal(await page.locator('#shelf').getByRole('button', {name: 'Unwrap', exact: true}).count(), focus === 'uv' ? 1 : 0);
        assert.equal(await page.locator('#selModes').isHidden(), focus === 'uv');
        assert.equal(await page.locator('#sub').getByRole('button', {name: 'Drag extrude', exact: true}).count(), focus === 'uv' ? 0 : 1);
      };
      await checkFocus('uv');
      const tapPane = async id => {
        const b = await page.locator('#' + id).boundingBox();
        const p = {x: b.x + b.width * 0.55, y: b.y + b.height * 0.7};
        if (mobile) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
      };
      for (let i = 0; i < 3; i++) {
        await tapPane('c3d'); await checkFocus('3d');
        await page.getByRole('button', {name: 'Drag to move UVs', exact: true}).click(); await checkFocus('uv');
      }
      await page.locator('#shelf').getByRole('button', {name: '3D Shelf', exact: true}).click(); await checkFocus('3d');
      await page.locator('#shelf').getByRole('button', {name: 'UV Shelf', exact: true}).click(); await checkFocus('uv');
      await page.locator('#btnView').click();
      assert.equal(await page.evaluate(() => __pm.S.view), 'uv');
      assert.ok(await page.locator('#pane3d').isHidden());
      // Axis straightening must remove all tilt without shifting the along-axis
      // coordinates or touching unselected UVs, even when endpoints nearly align.
      const originalUVs = await page.evaluate(() => __pm.S.active.mesh.faces[0].uv.map(u => u.slice()));
      const rows = [
        [[.1,.2],[.4,.48],[.8,.66],[.95,.95]],
        [[.1,.2],[.5,.2000001],[.9,.20000002],[.8,.8]],
        [[.2,.1],[.2000001,.5],[.20000002,.9],[.8,.8]],
        [[.1234561,.22],[.1234562,.2200001],[.8,.9],[.75,.12]],
      ];
      for (const axis of ['X','Y']) for (const row of rows) {
        await page.evaluate(uv => {
          const p = __pm;
          p.S.active.mesh.faces[0].uv = uv.map(u => u.slice());
          p.S.uvSel = new Set([0,1,2]); p.rebuildObject(p.S.active); p.pushUndo('UV line fixture');
        }, row);
        await page.locator('#shelf').getByRole('button', {name: 'Straighten', exact: true}).click();
        await page.locator('#sheet').getByRole('button', {name: new RegExp('^Straighten ' + axis + '(?:$| )')}).click();
        const result = await page.evaluate(() => __pm.S.active.mesh.faces[0].uv);
        const fixed = axis === 'X' ? 1 : 0, along = 1 - fixed;
        assert.equal(result[0][fixed], result[1][fixed], `Straighten ${axis} must be exactly axis-aligned`);
        assert.equal(result[0][fixed], result[2][fixed]);
        for (let i = 0; i < 3; i++) assert.equal(result[i][along], row[i][along], 'Keep along-axis spacing');
        assert.deepEqual(result[3], row[3], 'Leave unselected UV unchanged');
        assert.ok(result.flat().every(Number.isFinite));
        await page.locator('#btnUndo').click();
        assert.deepEqual(await page.evaluate(() => __pm.S.active.mesh.faces[0].uv), row);
        await page.locator('#btnRedo').click();
        assert.deepEqual(await page.evaluate(() => __pm.S.active.mesh.faces[0].uv), result);
      }
      await page.evaluate(uv => {
        const p = __pm; p.S.active.mesh.faces[0].uv = uv;
        p.rebuildObject(p.S.active); p.pushUndo('Restore UV square');
      }, originalUVs);
      await page.locator('#sub').getByRole('button', {name: 'Select all', exact: true}).click();
      assert.equal(await page.evaluate(() => __pm.S.uvSel.size), 4);
      // UV shortcuts choose UV tools and cannot start hidden mesh operations.
      for (const [key, tool] of [['g','move'], ['r','rotate'], ['s','scale'], ['b','box']]) {
        await page.keyboard.press(key);
        assert.equal(await page.evaluate(() => __pm.S.uvTool), tool);
        assert.ok(await page.locator('#tfbar').isHidden());
      }
      for (const key of ['e', 'x', 'Shift+d']) await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => JSON.stringify({verts: __pm.S.active.mesh.verts, pos: __pm.S.active.node.position.toArray(), faces: __pm.S.active.mesh.faces.map(f => f.v)})), geometry);
      const cdp = mobile ? await ctx.newCDPSession(page) : null;
      const drag = async (a, b) => {
        if (mobile) {
          await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{id: 1, ...a}]});
          for (let i=1;i<=5;i++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{id: 1, x: a.x+(b.x-a.x)*i/5, y: a.y+(b.y-a.y)*i/5}]});
          await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        } else {
          await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:5}); await page.mouse.up();
        }
      };
      const screenUV = async (u,v) => page.evaluate(([u,v]) => {const p=UV_s(u,v), r=document.querySelector('#cuv').getBoundingClientRect(); return {x:r.x+p[0],y:r.y+p[1]};},[u,v]);
      const before = await page.evaluate(() => __pm.S.active.mesh.faces[0].uv.map(u => u.slice()));
      await page.getByRole('button', {name: 'Drag to move UVs', exact: true}).click();
      const start = await screenUV(.6,.4);
      await drag(start,{x:start.x+30,y:start.y+20});
      const after = await page.evaluate(() => __pm.S.active.mesh.faces[0].uv.map(u => u.slice()));
      assert.ok(Math.abs(after[0][0]-before[0][0]) > .01);
      await page.locator('#btnUndo').click();
      assert.deepEqual(await page.evaluate(() => __pm.S.active.mesh.faces[0].uv),before);
      await page.locator('#btnRedo').click();
      assert.deepEqual(await page.evaluate(() => __pm.S.active.mesh.faces[0].uv),after);
      await page.locator('#btnUndo').click();
      // Real two-finger view rotation followed by dragging must follow screen motion.
      if (mobile) {
        const b=await page.locator('#cuv').boundingBox(), x=b.x+b.width*.55, y=b.y+b.height*.55, r=Math.min(b.width,b.height)*.16;
        const points = a => [{id:1,x:x-r*Math.cos(a),y:y-r*Math.sin(a)},{id:2,x:x+r*Math.cos(a),y:y+r*Math.sin(a)}];
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(0)});
        for(let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(Math.PI/2*i/8)});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        assert.ok(Math.abs(await page.evaluate(()=>UV_dbg().rot)-90)<1);
        const p=await screenUV(.5,.5), corner=await screenUV(0,0);
        await drag(p,{x:p.x+24,y:p.y+16});
        const uv=await page.evaluate(()=>__pm.S.active.mesh.faces[0].uv[0]), moved=await screenUV(...uv);
        assert.ok(Math.abs(moved.x-corner.x-24)<2, 'rotated UV drag follows screen X');
        assert.ok(Math.abs(moved.y-corner.y-16)<2, 'rotated UV drag follows screen Y');
        await page.locator('#btnUndo').click();
      }
      await page.keyboard.press('Home');
      assert.ok(Math.abs(await page.evaluate(()=>UV_dbg().rot))<.01);
      // Operator settings stay accessible in the UV pane, including full-screen UV.
      await page.locator('#shelf').getByRole('button',{name:'Pack',exact:true}).click();
      assert.ok(await page.locator('#paneUV #redo').isVisible());
      if (await page.locator('#redo').getAttribute('open') === null) await page.locator('#redoTitle').click();
      await page.locator('#redo').getByLabel('Margin',{exact:true}).fill('0.04');
      await page.locator('#redo').getByLabel('Margin',{exact:true}).press('Enter');
      assert.equal(await page.evaluate(() => JSON.stringify({verts: __pm.S.active.mesh.verts, pos: __pm.S.active.node.position.toArray(), faces: __pm.S.active.mesh.faces.map(f => f.v)})), geometry);
      await page.screenshot({path:`work/uv-controls-${layout}.png`,animations:'disabled'});
      await page.locator('#shelf').getByRole('button',{name:'3D View',exact:true}).click();
      assert.equal(await page.evaluate(()=>__pm.S.view),'3d');
      assert.ok(await page.locator('#paneUV').isHidden());
      assert.ok(await page.locator('#pane3d #redo').isVisible());
      // Entering UV with a modal 3D transform must leave its buttons unlocked.
      await page.evaluate(()=>{__pm.editSelectAll('select');__pm.tfStart('move');});
      assert.ok(await page.locator('#tfbar').isVisible());
      await page.locator('#btnView').click();
      assert.ok(await page.locator('#tfbar').isHidden());
      await checkFocus('uv');
      assert.deepEqual(errors,[]);
      console.log(`${layout}: exact X/Y straightening, spacing/unselected UV preservation, undo/redo, pane controls, rotated touch view and return to 3D passed`);
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
