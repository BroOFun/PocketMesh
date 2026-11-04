const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const {chromium, devices} = require('playwright');
(async () => {
  const root=path.resolve(__dirname,'../docs');
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)) {res.writeHead(404);res.end();return;}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    for(const layout of (process.env.SELECT_LAYOUT?[process.env.SELECT_LAYOUT]:['desktop','phone','landscape'])) {
      const mobile=layout!=='desktop';
      const ctx=await browser.newContext({...(mobile?devices['iPhone 14']:{viewport:{width:1200,height:850}}),...(layout==='landscape'?{viewport:{width:844,height:390}}:{}),serviceWorkers:'block'});
      await ctx.addInitScript(()=>{localStorage.setItem('pm_welcomed','true');localStorage.setItem('pm_installHinted','true');});
      const page=await ctx.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__pm);
      const cdp=await ctx.newCDPSession(page);
      const load=async(kind='grid',mode='vert')=>{
        await page.evaluate(async({kind,mode,layout})=>{
          const p=__pm,d=p.serializeProject();d.objects=d.objects.slice(0,1);
          let verts,faces=[],looseEdges=[];
          if(kind==='wire') {verts=[[-1,0,0],[0,0,0],[1,0,0],[0,.15,0]];looseEdges=[[0,1],[1,2]];}
          else if(kind==='isolated') verts=[[0,0,0]];
          else if(kind==='cube') {const m=p.primCube();verts=m.verts;faces=m.faces;}
          else {
            verts=Array.from({length:12},(_,i)=>[(i%4-1.5)*.5,(Math.floor(i/4)-1)*.5,0]);
            for(let y=0;y<2;y++) for(let x=0;x<3;x++) {const a=y*4+x;faces.push({v:[a,a+1,a+5,a+4],uv:[[0,0],[1,0],[1,1],[0,1]],mat:0});}
          }
          d.objects[0].mesh={verts,faces,looseEdges,seams:[],creases:[]};
          Object.assign(d.objects[0],{selected:true,pos:[0,0,0],quat:[0,0,0,1],scl:[1,1,1],modifiers:[]});
          d.camera={target:[0,0,0],yaw:0,pitch:Math.PI/2,dist:layout==='landscape'?4:6,ortho:true};
          await p.loadProject(d);p.setMode('edit');p.setSelectMode(mode);p.editSelectAll('none');p.S.xray=false;p.S.selOp='set';p.S.multiSelect=false;p.S.prop=false;p.S.snap=false;p.pushUndo('Selection fixture');
        },{kind,mode,layout});
      };
      const point=v=>page.evaluate(v=>__pm.screenOf(...v),v);
      const selection=()=>page.evaluate(()=>Object.fromEntries(Object.entries(__pm.S.active.esel).map(([k,v])=>[k,[...v].sort((a,b)=>typeof a==='number'?a-b:a.localeCompare(b))])));
      const tap=async v=>{const p=await point(v);mobile?await page.touchscreen.tap(p.x,p.y):await page.mouse.click(p.x,p.y);};
      const down=async p=>{if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...p}]});else{await page.mouse.move(p.x,p.y);await page.mouse.down();}};
      const move=async p=>{if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,...p}]});else await page.mouse.move(p.x,p.y);};
      const up=async()=>{if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();};
      const drag=async(a,b)=>{await down(await point(a));await move(await point(b));await up();};
      const circle=async(radius=12)=>{
        await page.getByRole('button',{name:'Circle select · C',exact:true}).click();
        const box=await page.getByRole('button',{name:'Done circle selecting',exact:true}).boundingBox();
        assert.ok(box.x>=0&&box.x+box.width<=page.viewportSize().width,'Done visible on activation');
        await page.getByRole('spinbutton',{name:'Circle radius in pixels',exact:true}).fill(String(radius));
      };
      // Regression: rapid vertex/edge taps must not expand to the wire chain.
      await load('wire');await tap([0,0,0]);await tap([0,0,0]);
      assert.deepEqual(await selection(),{verts:[1],edges:[],faces:[]});
      await tap([0,.15,0]);await tap([0,.15,0]);
      assert.deepEqual(await selection(),{verts:[3],edges:[],faces:[]},'Isolated vertex near a wire stays individual');
      await page.getByRole('button',{name:'Move gizmo',exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>__pm.gizmoProxy.position.toArray().map(v=>+v.toFixed(6))),[0,.15,0],'Gizmo follows just the floating vertex');
      await page.getByRole('button',{name:'Tap select',exact:true}).click();
      await page.getByRole('button',{name:'Edge select',exact:true}).click();
      await tap([-.5,0,0]);await tap([-.5,0,0]);
      assert.deepEqual(await selection(),{verts:[0,1],edges:['0_1'],faces:[]});
      await tap([-.1,0,0]);await tap([.1,0,0]);
      assert.deepEqual((await selection()).edges,['1_2'],'Nearby different edges are distinct picks');
      await load('grid','edge');await tap([-.5,-.5,0]);await tap([-.5,-.5,0]);
      assert.ok((await selection()).edges.length>1,'Surface-edge double-tap still selects a loop');
      // A floating point is visible/pickable in Object mode even unselected.
      await load('isolated');await page.evaluate(()=>{__pm.setMode('object');__pm.S.active.selected=false;__pm.rebuildObject(__pm.S.active);});
      assert.ok(await page.evaluate(()=>__pm.S.active.vertOv.visible));
      await tap([0,0,0]);assert.equal(await page.evaluate(()=>__pm.S.active.selected),true);
      await load('wire');await page.evaluate(()=>{__pm.setMode('object');__pm.S.active.selected=false;__pm.rebuildObject(__pm.S.active);});
      assert.ok(await page.evaluate(()=>__pm.S.active.edgeOv.visible));
      // Fast sweeps select every crossed vertex, without toggling on return.
      await load();await circle();
      const yaw=await page.evaluate(()=>__pm.CAM.yaw),baseline=await page.evaluate(()=>__pm.UNDO.idx);
      await drag([-.75,0,0],[.75,0,0]);
      assert.deepEqual((await selection()).verts,[4,5,6,7]);
      assert.equal(await page.evaluate(()=>__pm.CAM.yaw),yaw,'Painting does not orbit');
      assert.equal(await page.evaluate(()=>__pm.UNDO.idx),baseline+1,'One undo step per stroke');
      await drag([.75,0,0],[-.75,0,0]);assert.deepEqual((await selection()).verts,[4,5,6,7]);
      assert.equal(await page.evaluate(()=>__pm.UNDO.idx),baseline+1,'Repainting selected elements makes no undo noise');
      await page.getByRole('button',{name:'Circle remove selection',exact:true}).click();
      await drag([-.25,0,0],[.25,0,0]);assert.deepEqual((await selection()).verts,[4,7]);
      await page.locator('#btnUndo').click();assert.deepEqual((await selection()).verts,[4,5,6,7]);
      await page.locator('#btnUndo').click();assert.deepEqual((await selection()).verts,[]);
      await page.locator('#btnRedo').click();assert.deepEqual((await selection()).verts,[4,5,6,7]);
      // Keyboard, radius controls, and mouse wheel resize the visible circle.
      await page.keyboard.press('c');
      const size=await page.evaluate(()=>__pm.CIRCLE.radius);
      await page.keyboard.press(']');assert.equal(await page.evaluate(()=>__pm.CIRCLE.radius),size+4);
      await page.getByRole('button',{name:'Larger selection circle',exact:true}).click();
      assert.equal(await page.evaluate(()=>__pm.CIRCLE.radius),size+12);
      if(!mobile) {
        const p=await point([0,0,0]);await page.mouse.move(p.x,p.y);
        const dist=await page.evaluate(()=>__pm.CAM.dist);await page.mouse.wheel(0,-100);
        await page.waitForFunction(v=>__pm.CIRCLE.radius===v,size+16);
        assert.equal(await page.evaluate(()=>__pm.CAM.dist),dist);
        const brush=await page.locator('#circleBrush').boundingBox();assert.ok(Math.abs(brush.width-2*(size+16))<1);
      }
      await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>__pm.S.tool),'select');
      if(!mobile) {
        await load();await circle(10);await drag([-.75,0,0],[.75,0,0]);
        const a=await point([-.75,0,0]),b=await point([-.25,0,0]);
        await page.mouse.move(a.x,a.y);await page.mouse.down({button:'middle'});await page.mouse.move(b.x,b.y);await page.mouse.up({button:'middle'});
        assert.deepEqual((await selection()).verts,[6,7],'Middle mouse removes without orbiting');
        await page.keyboard.down('Shift');await tap([.25,0,0]);await page.keyboard.up('Shift');
        assert.deepEqual((await selection()).verts,[7]);
        await page.mouse.click(b.x,b.y,{button:'right'});assert.equal(await page.evaluate(()=>__pm.S.tool),'select');
      }
      // Edge painting catches an edge's middle without either endpoint.
      await load('wire','edge');await circle(8);await tap([-.5,0,0]);
      assert.deepEqual((await selection()).edges,['0_1']);
      await page.getByRole('button',{name:'Done circle selecting',exact:true}).click();
      await load('grid','face');await circle(10);await drag([-.5,-.25,0],[.5,-.25,0]);
      assert.deepEqual((await selection()).faces,[0,1,2]);
      await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>__pm.S.tool),'select');
      // Occluded vertices remain unselected unless X-ray is enabled.
      await load('cube');await circle(10);await tap([-1,-1,1]);
      let ids=(await selection()).verts;assert.equal(ids.length,1);
      assert.equal(await page.evaluate(v=>__pm.S.active.mesh.verts[v][2],ids[0]),1);
      await page.locator('#btnXray').click();await tap([-1,-1,1]);assert.equal((await selection()).verts.length,2);
      // Cancelled and two-finger navigation gestures roll back their stroke.
      await load();await circle(12);const before=await selection();
      const a=await point([-.75,0,0]),b=await point([.75,0,0]);
      await down(a);await move(b);
      if(mobile) await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
      else {await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await up();}
      assert.deepEqual(await selection(),before);
      if(mobile) {
        await down(a);await move(b);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...b},{id:2,x:b.x+30,y:b.y+20}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:b.x-20,y:b.y+12},{id:2,x:b.x+10,y:b.y+32}]});
        await up();assert.deepEqual(await selection(),before);
      }
      // Object painting selects multiple disconnected objects and skips hidden ones.
      await load('isolated');
      await page.evaluate(async()=>{
        const p=__pm,d=p.serializeProject(),base=d.objects[0];
        d.objects=[0,1,2].map(i=>({...structuredClone(base),id:900+i,name:'Point '+i,pos:[i*.5,0,0],selected:false,visible:i!==2}));
        d.active=900;await p.loadProject(d);
      });
      await circle(10);await drag([0,0,0],[1,0,0]);
      assert.deepEqual(await page.evaluate(()=>__pm.S.objects.map(o=>o.selected)),[true,true,false]);
      await page.locator('#btnUndo').click();assert.deepEqual(await page.evaluate(()=>__pm.S.objects.map(o=>o.selected)),[false,false,false]);
      await page.locator('#btnRedo').click();assert.deepEqual(await page.evaluate(()=>__pm.S.objects.map(o=>o.selected)),[true,true,false]);
      await page.getByRole('button',{name:'Move gizmo',exact:true}).click();assert.equal(await page.locator('#circleBrush').isHidden(),true);
      await load();await circle(18);await drag([-.75,0,0],[.75,0,0]);
      if(!mobile){const p=await point([.75,0,0]);await page.mouse.move(p.x,p.y);}
      fs.mkdirSync('work',{recursive:true});await page.screenshot({path:`work/circle-${layout}.png`,animations:'disabled'});
      await page.locator('#btnView').click();assert.equal(await page.locator('#circleBrush').isHidden(),true);
      assert.equal(await page.evaluate(()=>__pm.S.tool),'select','Changing editor exits circle selection');
      assert.deepEqual(errors,[]);
      console.log(`${layout}: loose vertex/edge rapid picking, gizmo pivot, wire/point visibility, circle sweep/add/remove/radius/undo, face/edge selection, X-ray, cancellation and editor switching passed`);
      await ctx.close();
    }
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
