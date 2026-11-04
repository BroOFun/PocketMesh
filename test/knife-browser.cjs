const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const {chromium, devices} = require('playwright');
(async () => {
  const root = path.resolve(__dirname, '../docs');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {res.writeHead(404); res.end(); return;}
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  try {
    for (const layout of (process.env.KNIFE_LAYOUT ? [process.env.KNIFE_LAYOUT] : ['desktop', 'phone', 'landscape'])) {
      const mobile = layout !== 'desktop';
      const ctx = await browser.newContext({...(mobile ? devices['iPhone 14'] : {viewport: {width: 1200, height: 850}}), ...(layout === 'landscape' ? {viewport: {width: 844, height: 390}} : {}), serviceWorkers: 'block'});
      await ctx.addInitScript(() => {localStorage.setItem('pm_welcomed', 'true'); localStorage.setItem('pm_installHinted', 'true');});
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.__pm);
      assert.equal(await page.getByRole('button', {name: 'Knife tool · K', exact: true}).count(), 0, 'Knife is edit-only');
      const load = async (kind = 'plane') => {
        await page.evaluate(async ({kind, layout}) => {
          const p = __pm, d = p.serializeProject(); d.objects = d.objects.slice(0,1);
          const ngon = [[-1,-1,0],[1,-1,0],[1,0,0],[0,0,0],[0,1,0],[-1,1,0]];
          const mesh = kind === 'ngon' ? {verts: ngon, faces: [{v: [0,1,2,3,4,5], uv: ngon.map(([x,y])=>[(x+1)/2,(y+1)/2]), mat: 0}], looseEdges: [], seams: [], creases: []} : kind === 'cube' ? p.primCube() : {verts: [[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]], faces: [{v: [0,1,2,3], uv: [[0,0],[1,0],[1,1],[0,1]], mat: 0}], looseEdges: [], seams: [], creases: []};
          d.objects[0].mesh = {...mesh, seams: [...mesh.seams], creases: [...mesh.creases]};
          d.objects[0].selected = true; d.objects[0].pos = [0,0,0]; d.objects[0].quat = [0,0,0,1]; d.objects[0].scl = [1,1,1];
          d.camera = {target: [0,0,0], yaw: 0, pitch: Math.PI / 2, dist: layout === 'landscape' ? 3.7 : 6, ortho: true};
          await p.loadProject(d); p.setMode('edit');
        }, {kind, layout});
      };
      const start = () => page.getByRole('button', {name: 'Knife tool · K', exact: true}).click();
      const point = p => page.evaluate(p => __pm.screenOf(...p), p);
      const tap = async (p, offset = [0,0]) => {
        const s = await point(p); s.x += offset[0]; s.y += offset[1];
        if (mobile) await page.touchscreen.tap(s.x, s.y); else await page.mouse.click(s.x, s.y);
      };
      const state = () => page.evaluate(() => ({verts: __pm.S.active.mesh.verts, faces: __pm.S.active.mesh.faces}));
      const apply = () => page.getByRole('button', {name: 'Done · apply knife cuts', exact: true}).click();
      await load(); const initial = await state();
      await page.evaluate(()=>{document.querySelector('#sub').scrollLeft=10000;});
      await start();
      const doneBox=await page.getByRole('button',{name:'Done · apply knife cuts',exact:true}).boundingBox();
      assert.ok(doneBox.x>=0 && doneBox.x+doneBox.width<=page.viewportSize().width,'Done is visible without horizontal scrolling');
      assert.equal(await page.evaluate(()=>__pm.KNIFE.snap),true,'Snapping starts enabled');
      await tap([-1,-1,0], [7,-4]);
      assert.deepEqual(await page.evaluate(() => __pm.KNIFE.first.point), [-1,-1,0], 'Offset input magnetizes exactly to the vertex');
      assert.equal(await page.evaluate(() => __pm.KNIFE.first.kind), 'Vertex');
      await tap([1,1,0], [-6,4]);
      assert.equal(await page.evaluate(() => __pm.KNIFE.mesh.faces.length), 2);
      await start(); assert.equal(await page.evaluate(() => __pm.KNIFE.mesh.faces.length), 2, 'Reselecting Knife keeps the preview');
      assert.deepEqual(await state(), initial, 'Preview does not change the source');
      assert.deepEqual(await page.evaluate(() => __pm.serializeProject().objects[0].mesh.faces), initial.faces, 'Saving during preview excludes uncommitted cuts');
      fs.mkdirSync('work', {recursive: true});
      await page.screenshot({path: `work/knife-${layout}.png`, animations: 'disabled'});
      await page.getByRole('button', {name: 'Cancel knife cuts', exact: true}).click();
      assert.deepEqual(await state(), initial);
      await start(); await tap([-1,-1,0], [7,-4]); await tap([1,1,0], [-6,4]); await apply();
      const applied = await state(); assert.equal(applied.faces.length, 2); assert.equal(applied.verts.length, 4);
      assert.equal(await page.evaluate(() => __pm.UNDO.stack[__pm.UNDO.idx].label), 'Knife cut');
      await page.locator('#btnUndo').click(); assert.deepEqual(await state(), initial);
      await page.locator('#btnRedo').click(); assert.deepEqual(await state(), applied);
      await page.locator('#btnUndo').click();
      // Cut an edge, then cross the preview with another cut. New preview edges
      // are snap targets, but project geometry only changes once on Done.
      await start(); await tap([-1,0,0]); await tap([1,0,0]);
      assert.equal(await page.evaluate(() => __pm.KNIFE.hover.kind), 'Edge');
      await page.getByRole('button', {name: 'New cut', exact: true}).click();
      await tap([0,-1,0]); await tap([0,1,0]);
      assert.equal(await page.evaluate(() => __pm.KNIFE.mesh.faces.length), 4);
      await page.locator('#btnUndo').click();
      assert.equal(await page.evaluate(() => __pm.KNIFE.mesh.faces.length), 2);
      await tap([0,1,0]); await apply();
      assert.equal((await state()).faces.length, 4); assert.equal((await state()).verts.length, 9);
      await page.locator('#btnUndo').click(); assert.deepEqual(await state(), initial);
      // Face selection mode also accepts points in the middle of faces.
      await page.evaluate(()=>__pm.setSelectMode('face'));
      await start(); await tap([-.4,.25,0]);
      assert.equal(await page.evaluate(()=>__pm.KNIFE.first.kind),'Face');
      await tap([.45,-.3,0]);
      assert.ok(await page.evaluate(()=>__pm.KNIFE.edges.size>0));
      assert.deepEqual(await state(),initial);
      const hiddenEdgePick=await page.evaluate(()=>{
        const p=__pm,k=p.KNIFE,rect=document.querySelector('#c3d').getBoundingClientRect();
        const points=k.mesh.verts.map(v=>p.screenOf(...v));
        const dist=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
        const visible=[...k.snapEdges].map(e=>e.split('_').map(Number));
        for(const [a,b] of p.topo(k.mesh).edges) {
          if(k.snapEdges.has(a<b?`${a}_${b}`:`${b}_${a}`)) continue;
          for(const t of [.25,.5,.75]) {
            const q={x:points[a].x*(1-t)+points[b].x*t,y:points[a].y*(1-t)+points[b].y*t};
            if(points.some(v=>Math.hypot(v.x-q.x,v.y-q.y)<29)||visible.some(([a,b])=>dist(q,points[a],points[b])<12)) continue;
            return p.knifePick(q.x-rect.x,q.y-rect.y,28)?.kind;
          }
        }
        return 'no candidate';
      });
      assert.equal(hiddenEdgePick,'Face','Invisible support diagonals do not magnetize the next cut');
      await page.screenshot({path:`work/face-knife-${layout}.png`,animations:'disabled'});
      await page.getByRole('button',{name:'Undo cut',exact:true}).click();
      assert.equal(await page.evaluate(()=>__pm.KNIFE.mesh.faces.length),1);
      await tap([.45,-.3,0]); await apply();
      const interior=await state(); assert.ok(interior.verts.length>=6);
      assert.ok(interior.faces.length>1);
      await page.locator('#btnUndo').click(); assert.deepEqual(await state(),initial);
      await page.locator('#btnRedo').click(); assert.deepEqual(await state(),interior);
      await page.locator('#btnUndo').click();
      await start(); await page.getByRole('button',{name:'Knife snapping',exact:true}).click();
      await tap([-.95,-.95,0]);
      const precise=await page.evaluate(()=>__pm.KNIFE.first);
      assert.equal(precise.kind,'Face','Snap off permits face points near a corner');
      assert.ok(Math.hypot(precise.point[0]+.95,precise.point[1]+.95)<.015);
      await page.getByRole('button',{name:'Cancel knife cuts',exact:true}).click();
      // Switching tool/editor or pressing Escape discards a pending knife cut.
      await start(); await tap([-1,-1,0]); await tap([1,1,0]);
      await page.getByRole('button', {name: 'Move gizmo', exact: true}).click(); assert.deepEqual(await state(), initial);
      assert.equal(await page.evaluate(() => __pm.KNIFE.mesh), null);
      await page.keyboard.press('k'); assert.equal(await page.evaluate(() => __pm.S.tool), 'knife');
      await tap([-1,-1,0]); await tap([1,1,0]); await page.keyboard.press('Escape'); assert.deepEqual(await state(), initial);
      await start(); await tap([-1,-1,0]); await tap([1,1,0]); await page.locator('#btnView').click();
      assert.equal(await page.evaluate(() => __pm.KNIFE.mesh), null); assert.deepEqual(await state(), initial);
      await page.locator('#btnView').click(); await page.locator('#btnView').click();
      await start(); await tap([-1,-1,0]); await tap([1,1,0]);
      await page.evaluate(() => {__pm.S.active.mesh.faces[0].mat = 1; __pm.pushUndo('Assign material');});
      assert.equal(await page.evaluate(() => __pm.KNIFE.mesh), null, 'Another edit invalidates stale preview');
      assert.equal((await state()).faces[0].mat, 1);
      // Only visible geometry is cut, including when X-ray display is enabled.
      await load('cube'); await start();
      await page.evaluate(() => {__pm.S.xray = true;});
      await tap([-1,-1,1], [5,-3]); await tap([1,1,1], [-5,3]); await page.keyboard.press('Enter');
      const cube = await state(); assert.equal(cube.faces.length, 7); assert.equal(cube.verts.length, 8);
      assert.ok(cube.faces.some(f => f.v.length === 4 && f.v.every(v => cube.verts[v][2] === -1)), 'Occluded bottom face untouched');
      // Normal drag navigation stays available without creating a cut.
      await start(); const box = await page.locator('#c3d').boundingBox();
      const yaw = await page.evaluate(() => __pm.CAM.yaw);
      await page.mouse.move(box.x + box.width * .55, box.y + box.height * .5); await page.mouse.down();
      await page.mouse.move(box.x + box.width * .55 + 45, box.y + box.height * .5 + 20, {steps: 6}); await page.mouse.up();
      assert.notEqual(await page.evaluate(() => __pm.CAM.yaw), yaw);
      assert.equal(await page.evaluate(() => __pm.KNIFE.first), null);
      await page.keyboard.press('Tab');
      assert.equal(await page.getByRole('button', {name: 'Knife tool · K', exact: true}).count(), 0);
      // Real taps on a concave face create preview cuts; Done commits once.
      await load('ngon'); const beforeNgon=await state();
      await page.evaluate(()=>__pm.setSelectMode('face'));
      await start(); await tap([-.5,.5,0]); await tap([-.4,-.5,0]); await tap([.5,-.5,0]);
      assert.equal(await page.evaluate(()=>__pm.KNIFE.steps.length),2);
      assert.equal(await page.evaluate(()=>__pm.KNIFE.hover.kind),'Face');
      assert.deepEqual(await state(),beforeNgon);
      await apply(); const cutNgon=await state();
      assert.ok(cutNgon.faces.length>1 && cutNgon.verts.length>=9);
      await page.locator('#btnUndo').click(); assert.deepEqual(await state(),beforeNgon);
      await page.locator('#btnRedo').click(); assert.deepEqual(await state(),cutNgon);
      // Triangulate n-gons via the shelf and Ctrl+T; retain UVs and selection.
      await load('ngon');
      await page.evaluate(()=>{__pm.setSelectMode('face');__pm.editSelectAll('select');__pm.pushUndo('Select n-gon');});
      const beforeTri=await state();
      await page.getByRole('button',{name:'Triangulate',exact:true}).click();
      const afterTri=await state();
      assert.equal(afterTri.faces.length,4);
      assert.equal(await page.evaluate(()=>__pm.S.active.esel.faces.size),4);
      for(const f of afterTri.faces) {
        assert.equal(f.v.length,3); assert.equal(f.mat,beforeTri.faces[0].mat);
        assert.deepEqual(f.uv,f.v.map(v=>beforeTri.faces[0].uv[v]));
      }
      await page.locator('#btnUndo').click(); assert.deepEqual(await state(),beforeTri);
      await page.keyboard.press('Control+t'); assert.deepEqual(await state(),afterTri);
      await page.locator('#btnUndo').click(); assert.deepEqual(await state(),beforeTri);
      await page.locator('#btnRedo').click(); assert.deepEqual(await state(),afterTri);
      // Inset is accessible in the sidebar, preserves a concave n-gon and
      // rolls back both geometry and selection on Cancel.
      await load('ngon');
      await page.evaluate(()=>{__pm.setSelectMode('face'); __pm.editSelectAll('select'); __pm.pushUndo('Select n-gon');});
      const ngon=await state();
      const selection=()=>page.evaluate(()=>Object.fromEntries(Object.entries(__pm.S.active.esel).map(([k,v])=>[k,[...v]])));
      const selected=await selection();
      const inset=()=>page.getByRole('button',{name:'Inset faces · I',exact:true}).click();
      await inset(); assert.deepEqual(await state(),ngon,'Opening Inset changes no topology');
      assert.equal(await page.locator('#pmNum').count(),1,JSON.stringify({errors,selected,ui:await page.locator('#tfbar').innerHTML(),tool:await page.evaluate(()=>__pm.S.tool)}));
      await page.getByRole('textbox',{name:'Inset value',exact:true}).fill('.15');
      const insetPreview=await state(); assert.equal(insetPreview.faces.length,7); assert.equal(insetPreview.faces[0].v.length,6);
      await page.locator('#tfbar').getByRole('button',{name:'Cancel',exact:true}).click();
      assert.deepEqual(await state(),ngon); assert.deepEqual(await selection(),selected);
      await inset(); await page.getByRole('textbox',{name:'Inset value',exact:true}).fill('.15');
      await page.locator('#tfbar').getByRole('button',{name:'Done',exact:true}).click();
      assert.deepEqual(await state(),insetPreview);
      await page.locator('#btnUndo').click(); assert.deepEqual(await state(),ngon);
      await page.locator('#btnRedo').click(); assert.deepEqual(await state(),insetPreview);
      await page.screenshot({path:`work/inset-ngon-${layout}.png`,animations:'disabled'});
      await page.locator('#btnUndo').click();
      await page.keyboard.press('i'); await page.getByRole('textbox',{name:'Inset value',exact:true}).fill('100');
      const limited=await state(); assert.ok(limited.verts.every(v=>v.every(Number.isFinite)));
      assert.ok(await page.evaluate(()=>__pm.S.active.mesh.faces.every(f=>__pm.faceNormal(__pm.S.active.mesh,f)[2]>.99)));
      await page.keyboard.press('Escape'); assert.deepEqual(await state(),ngon);
      // Horizontal touch/mouse drag drives the same inset preview.
      await inset(); const drag=await point([.2,.2,0]);
      if(mobile) {
        const session=await ctx.newCDPSession(page);
        await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:drag.x,y:drag.y}]});
        await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:drag.x+35,y:drag.y}]});
        await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await session.detach();
      } else {
        await page.mouse.move(drag.x,drag.y); await page.mouse.down(); await page.mouse.move(drag.x+35,drag.y,{steps:4}); await page.mouse.up();
      }
      assert.ok(Number(await page.locator('#pmNum').inputValue())>0);
      await page.locator('#tfbar').getByRole('button',{name:'Individual',exact:true}).click();
      await page.locator('#tfbar').getByRole('button',{name:'Done',exact:true}).click();
      assert.equal((await state()).faces[0].v.length,6);
      assert.deepEqual(errors, []);
      console.log(`${layout}: Done visibility, vertex/edge magnets, optional snap, hidden support edges, face/concave n-gon cuts, preview/cancel/save isolation, undo/redo, triangulate shelf/shortcut/UVs, keyboard, pane/tool switches, occlusion, orbit and n-gon inset passed`);
      await ctx.close();
    }
  } finally {await browser.close(); server.close();}
})().catch(e => {console.error(e); process.exit(1);});
