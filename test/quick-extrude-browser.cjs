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
    for (const layout of (process.env.EXTRUDE_LAYOUT ? [process.env.EXTRUDE_LAYOUT] : ['desktop', 'phone', 'landscape'])) {
      const mobile = layout !== 'desktop';
      const ctx = await browser.newContext({...(mobile ? devices['iPhone 14'] : {viewport: {width: 1200, height: 850}}), ...(layout === 'landscape' ? {viewport: {width: 844, height: 390}} : {}), serviceWorkers: 'block'});
      await ctx.addInitScript(() => {localStorage.setItem('pm_welcomed', 'true'); localStorage.setItem('pm_installHinted', 'true');});
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => window.__pm);
      const cdp = await ctx.newCDPSession(page);
      const load = async (kind = 'vertex') => {
        await page.evaluate(async ({kind, layout}) => {
          const p = __pm, d = p.serializeProject(); d.objects = d.objects.slice(0,1);
          const multi = ['edges','faces'].includes(kind);
          const verts = multi ? [[-1,-1,0],[0,-1,0],[1,-1,0],[-1,1,0],[0,1,0],[1,1,0]] : [[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]];
          const faces = (multi ? [[0,1,4,3],[1,2,5,4]] : [[0,1,2,3]]).map(v => ({v,uv:v.map(i => [(verts[i][0]+1)/2,(verts[i][1]+1)/2]),mat:0}));
          d.objects[0].mesh = {verts, faces, looseEdges:[],seams:['0_1'],creases:['0_1']};
          d.objects[0].pos=[0,0,0]; d.objects[0].quat=[0,0,0,1]; d.objects[0].scl=[1,1,1]; d.objects[0].modifiers=[]; d.objects[0].selected=true;
          d.camera={target:[0,0,0],yaw:0,pitch:Math.PI/2,dist:layout==='landscape'?5:8,ortho:true};
          await p.loadProject(d); p.setMode('edit');
          p.S.extrudeQuick=true; p.S.extrudeTap=false; p.S.extrudeVerticesOnly=false; p.S.snap=false; p.S.prop=false;
          const mode = kind.startsWith('face') ? 'face' : kind.startsWith('edge') ? 'edge' : 'vert';
          p.setSelectMode(mode); const o=p.S.active;
          if (kind==='vertex') o.esel={verts:new Set([0]),edges:new Set(),faces:new Set()};
          else if (kind==='vertices') o.esel={verts:new Set([0,1]),edges:new Set(['0_1']),faces:new Set()};
          else if (kind==='edges') o.esel={verts:new Set([0,1,2]),edges:new Set(['0_1','1_2']),faces:new Set()};
          else p.editSelectAll('select');
          p.rebuildObject(o); p.pushUndo('Fixture');
        }, {kind,layout});
        await page.getByRole('button',{name:'Extrude tool',exact:true}).click();
      };
      const mesh = () => page.evaluate(() => __pm.serializeProject().objects[0].mesh);
      const selectedPoint = () => page.evaluate(() => {
        const p=__pm,o=p.S.active,s=o.esel; let point;
        if(p.S.selectMode==='face') point=p.faceCenter(o.mesh,o.mesh.faces[[...s.faces][0]]);
        else if(p.S.selectMode==='edge') {const ids=[...s.edges][0].split('_').map(Number);point=o.mesh.verts[ids[0]].map((v,i)=>(v+o.mesh.verts[ids[1]][i])/2);}
        else point=o.mesh.verts[[...s.verts][0]];
        return p.screenOf(...point);
      });
      const down = async a => {
        if(mobile) await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...a}]});
        else {await page.mouse.move(a.x,a.y); await page.mouse.down();}
      };
      const move = async (a,b) => {
        for(let i=1;i<=5;i++) {
          const p={x:a.x+(b.x-a.x)*i/5,y:a.y+(b.y-a.y)*i/5};
          if(mobile) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,...p}]});
          else await page.mouse.move(p.x,p.y);
        }
      };
      const up = async () => {if(mobile) await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); else await page.mouse.up();};
      const drag = async (a,dx=25,dy=-20) => {
        const height=(await page.locator('#c3d').boundingBox()).height;
        await down(a); await move(a,{x:a.x+dx,y:a.y+dy});
        assert.equal((await page.locator('#c3d').boundingBox()).height,height,'Quick drag must not resize the viewport');
        await up(); assert.ok(await page.locator('#tfbar').isHidden(),'Release confirms without another button');
      };
      // One selected vertex grows a chain without leaving the tool.
      await load(); const initial=await mesh();
      await page.getByRole('button',{name:'Tap extrude',exact:true}).click();
      assert.doesNotMatch(await page.getByRole('button',{name:'Quick drag',exact:true}).getAttribute('class'),/\bon\b/);
      await page.getByRole('button',{name:'Quick drag',exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>[__pm.S.extrudeQuick,__pm.S.extrudeTap]),[true,false],'Quick drag takes over from tap mode in one click');
      for(let i=1;i<=3;i++) {await drag(await selectedPoint()); const m=await mesh(); assert.equal(m.verts.length,4+i);assert.equal(m.looseEdges.length,i);assert.deepEqual(m.faces,initial.faces);}
      assert.equal(await page.evaluate(()=>__pm.S.tool),'extrude');
      const third=await mesh(); await page.locator('#btnUndo').click(); assert.equal((await mesh()).looseEdges.length,2);
      await page.locator('#btnRedo').click(); assert.deepEqual(await mesh(),third);
      // Adjacent vertices can explicitly become separate wires, not a face.
      await load('vertices'); await page.getByRole('button',{name:'Vertices only',exact:true}).click(); const original=await mesh();
      await drag(await selectedPoint()); await drag(await selectedPoint());
      assert.equal((await mesh()).looseEdges.length,4); assert.deepEqual((await mesh()).faces,original.faces);
      assert.equal(await page.evaluate(()=>__pm.S.active.esel.verts.size),2);
      // Selected edge and face groups both remain ready for the next gesture.
      for(const kind of ['edges','face','faces']) {
        await load(kind); const before=await mesh(), add=kind==='edges'?2:kind==='face'?4:6;
        for(let i=1;i<=2;i++) {await drag(await selectedPoint(),kind==='edges'?20:0,-28);assert.equal((await mesh()).faces.length,before.faces.length+add*i);}
        const edited=await mesh(); assert.ok(edited.faces.every(f=>f.v.length===f.uv.length && f.uv.flat().every(Number.isFinite)));
        await page.locator('#btnUndo').click(); assert.equal((await mesh()).faces.length,before.faces.length+add);
        await page.locator('#btnRedo').click(); assert.deepEqual(await mesh(),edited);
      }
      // Cancelled drag and the arrival of a second finger restore topology/tags.
      await load('edges'); const beforeCancel=await mesh(), history=await page.evaluate(()=>__pm.UNDO.idx);
      let a=await selectedPoint(); await down(a); await move(a,{x:a.x+25,y:a.y-20});
      if(mobile) await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]}); else {await page.keyboard.press('Escape');await up();}
      assert.deepEqual(await mesh(),beforeCancel);assert.equal(await page.evaluate(()=>__pm.UNDO.idx),history);
      await page.evaluate(()=>{__pm.S.snap=true;__pm.S.snapMove=10000;});
      await drag(await selectedPoint());assert.deepEqual(await mesh(),beforeCancel,'A snapped zero-distance step leaves no geometry');
      assert.equal(await page.evaluate(()=>__pm.UNDO.idx),history);
      await page.evaluate(()=>{__pm.S.snap=false;__pm.S.snapMove=.1;});
      if(mobile) {
        a=await selectedPoint();await down(a);await move(a,{x:a.x+25,y:a.y-20});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:a.x+25,y:a.y-20},{id:2,x:a.x+65,y:a.y+20}]});
        await up();assert.deepEqual(await mesh(),beforeCancel);assert.equal(await page.evaluate(()=>__pm.UNDO.idx),history);
      }
      // A click alone does not extrude, and empty-space drags still navigate.
      a=await selectedPoint();await down(a);await up();assert.deepEqual(await mesh(),beforeCancel);
      const box=await page.locator('#c3d').boundingBox(), yaw=await page.evaluate(()=>__pm.CAM.yaw);
      await drag({x:box.x+box.width*.55,y:box.y+box.height*.8},25,15);
      assert.notEqual(await page.evaluate(()=>__pm.CAM.yaw),yaw);assert.deepEqual(await mesh(),beforeCancel);
      // Quick drag is optional. With it off, a selected geometry drag navigates.
      await load(); await page.getByRole('button',{name:'Quick drag',exact:true}).click(); const disabled=await mesh();
      await drag(await selectedPoint());assert.deepEqual(await mesh(),disabled);
      // Next and E commit precise steps and immediately start the next one.
      await load(); await page.getByRole('button',{name:'Drag extrude',exact:true}).click();
      await page.getByRole('button',{name:'Constrain to X',exact:true}).click(); await page.getByLabel('Exact value',{exact:true}).fill('1');
      await page.getByRole('button',{name:'Next extrusion',exact:true}).click();
      assert.equal((await mesh()).looseEdges.length,2); // second step is the live preview
      assert.match(await page.getByRole('button',{name:'Constrain to X',exact:true}).getAttribute('class'),/on/,'Next retains the chosen axis');
      await page.getByLabel('Exact value',{exact:true}).fill('2');
      await page.locator('#tfInfo').click(); await page.keyboard.press('e');
      assert.equal((await mesh()).looseEdges.length,3);
      await page.locator('#tfbar').getByRole('button',{name:'Cancel',exact:true}).click();
      const precise=await mesh(); assert.equal(precise.looseEdges.length,2);
      assert.equal(await page.evaluate(()=>__pm.S.active.mesh.verts[[...__pm.S.active.esel.verts][0]][0]),2,'-1 + 1 + 2 = 2');
      await page.locator('#btnUndo').click();assert.equal((await mesh()).looseEdges.length,1);
      await page.locator('#btnRedo').click();assert.deepEqual(await mesh(),precise);
      if(!mobile) {
        await load();a=await selectedPoint();await down(a);await move(a,{x:a.x+25,y:a.y-20});
        await page.keyboard.press('e');await up();
        assert.ok(await page.locator('#tfbar').isVisible(),'Pointer release does not confirm the next manual step');
        await page.locator('#tfbar').getByRole('button',{name:'Cancel',exact:true}).click();
        assert.equal((await mesh()).looseEdges.length,1);
      }
      // Hold-to-multiselect stays in the extrusion tool; rapid taps add vertices.
      await load();await page.getByRole('button',{name:'Tap extrude',exact:true}).click();
      await page.getByRole('button',{name:'Extrude multiselect',exact:true}).click();
      assert.equal(await page.evaluate(()=>__pm.S.extrudeTap),false,'Multiselect changes taps back to selection');
      a=await page.evaluate(()=>__pm.screenOf(1,-1,0));await down(a);await up();
      assert.equal((await mesh()).verts.length,4);assert.equal(await page.evaluate(()=>__pm.S.active.esel.verts.size),2);
      await load(); a=await page.evaluate(()=>__pm.screenOf(1,-1,0));await down(a);await new Promise(r=>setTimeout(r,500));await up();
      assert.equal(await page.evaluate(()=>__pm.S.multiSelect),true);assert.equal(await page.evaluate(()=>__pm.S.tool),'extrude');
      a=await page.evaluate(()=>__pm.screenOf(1,1,0));await down(a);await up();assert.equal(await page.evaluate(()=>__pm.S.active.esel.verts.size),3);
      fs.mkdirSync('work',{recursive:true});await page.screenshot({path:`work/quick-extrude-${layout}.png`,animations:'disabled'});
      assert.deepEqual(errors,[]);
      console.log(`${layout}: repeated vertex/edge/face extrusion, vertex-only wires, release/undo/redo, touch cancellation, navigation, Next/E and multiselect passed`);
      await ctx.close();
    }
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
