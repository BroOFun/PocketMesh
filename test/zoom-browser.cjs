const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium,devices}=require('playwright');
(async()=>{
  const root=path.resolve(__dirname,'../docs');
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    for(const layout of (process.env.ZOOM_LAYOUT?[process.env.ZOOM_LAYOUT]:['desktop','phone','landscape'])){
      const mobile=layout!=='desktop';
      const ctx=await browser.newContext({...(mobile?devices['iPhone 14']:{viewport:{width:1200,height:850}}),...(layout==='landscape'?{viewport:{width:844,height:390}}:{}),serviceWorkers:'block'});
      await ctx.addInitScript(()=>{localStorage.setItem('pm_welcomed','true');localStorage.setItem('pm_installHinted','true');});
      const page=await ctx.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__pm);
      const cdp=await ctx.newCDPSession(page);
      const load=async(ortho=false,height=2,faces=true)=>page.evaluate(async({ortho,height,faces})=>{
        const p=__pm,d=p.serializeProject();d.objects=d.objects.slice(0,1);
        d.objects[0].mesh={verts:[[-3,-3,height],[3,-3,height],[3,3,height],[-3,3,height]],faces:faces?[{v:[0,1,2,3],uv:[[0,0],[1,0],[1,1],[0,1]],mat:0}]:[],looseEdges:[],seams:[],creases:[]};
        Object.assign(d.objects[0],{pos:[0,0,0],quat:[0,0,0,1],scl:[1,1,1],modifiers:[]});
        d.camera={target:[0,0,0],yaw:0,pitch:Math.PI/2,dist:height>100?height+10:8,ortho};
        await p.loadProject(d);p.setWorkspace('model');
      },{ortho,height,faces});
      const point=v=>page.evaluate(v=>__pm.screenOf(...v),v);
      const state=()=>page.evaluate(()=>{const p=__pm,c=p.tc.camera;return {dist:p.CAM.dist,target:p.CAM.target.toArray(),near:c.near,far:c.far,position:c.position.toArray(),ortho:p.CAM.ortho};});
      const wheel=async(p,delta)=>{
        await page.mouse.move(p.x,p.y);
        await page.evaluate(()=>{window.__zoomWheelDone=false;document.querySelector('#c3d').addEventListener('wheel',()=>{window.__zoomWheelDone=true;},{once:true});});
        await page.mouse.wheel(0,delta);await page.waitForFunction(()=>window.__zoomWheelDone);
        await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      };
      const pinch=async(p,zoomIn=true)=>{
        const start=zoomIn?14:60,end=zoomIn?60:14;
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:p.x-start,y:p.y},{id:2,x:p.x+start,y:p.y}]});
        for(let i=1;i<=4;i++){
          const r=start+(end-start)*i/4;
          await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:p.x-r,y:p.y},{id:2,x:p.x+r,y:p.y}]});
        }
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      };
      for(const ortho of [false,true]){
        await load(ortho);const source=await page.evaluate(()=>JSON.stringify(__pm.serializeProject().objects));
        const anchor=[.3,.2,2],p=await point(anchor);
        if(mobile)await pinch(p);else await wheel(p,-300);
        const after=await point(anchor),s=await state();
        assert.ok(Math.hypot(after.x-p.x,after.y-p.y)<1.5,`Surface stays beneath wheel / pinch midpoint: ${JSON.stringify({layout,ortho,p,after,s})}`);
        assert.ok(Math.abs(s.target[2]-2)<1e-8,'Focus depth follows the elevated road');
        assert.ok(s.position[2]>2,'Zoom stays in front of the track');
        // Repeated input reaches much closer than the former 0.01-unit limit.
        for(let i=0;i<(mobile?10:5);i++) mobile?await pinch(p):await wheel(p,-1500);
        const close=await state();assert.ok(close.dist<.0002,JSON.stringify(close));
        assert.ok(close.dist>0&&close.position[2]>2);
        const surface=await page.evaluate(anchor=>{
          const p=__pm,c=p.tc.camera,v=c.position.clone().set(...anchor).project(c),r=document.querySelector('#c3d').getBoundingClientRect(),s=p.screenOf(...anchor);
          const old=p.S.selectMode;p.S.selectMode='face';const pick=p.pickElement(s.x-r.left,s.y-r.top);p.S.selectMode=old;
          return {z:v.z,pick};
        },anchor);
        assert.ok(surface.z>-1&&surface.z<1,'Close-up surface is inside clipping planes');
        assert.equal(surface.pick?.type,'face','Surface remains pickable at close range');
        if(!ortho)assert.ok(close.near<close.dist*.01,'Perspective near plane shrinks with the view');
        assert.equal(await page.evaluate(()=>JSON.stringify(__pm.serializeProject().objects)),source,'Zoom never changes track geometry or object scale');
        fs.mkdirSync('work',{recursive:true});await page.screenshot({path:`work/zoom-${layout}-${ortho?'ortho':'persp'}.png`,animations:'disabled'});
        const beforeOut=close.dist;mobile?await pinch(p,false):await wheel(p,900);
        assert.ok((await state()).dist>beforeOut,'Can zoom back out after reaching the close limit');
        await load(ortho);
        await page.evaluate(()=>{__pm.CAM.yaw=.4;__pm.CAM.pitch=.7;__pm.applyCamera();});
        const angled=await point(anchor);mobile?await pinch(angled):await wheel(angled,-300);
        const angledAfter=await point(anchor);
        assert.ok(Math.hypot(angledAfter.x-angled.x,angledAfter.y-angled.y)<1.5,'Angled surface stays beneath pointer / fingers');
        assert.ok((await state()).position[2]>2,'Angled zoom stays above the road');
      }
      // Shared camera behavior applies to KCL and KMP as well as model editing.
      for(const workspace of ['kcl','kmp']){
        await load(false);await page.evaluate(w=>__pm.setWorkspace(w),workspace);
        const p=await point([0,0,2]);mobile?await pinch(p):await wheel(p,-600);
        const s=await state();assert.ok(s.position[2]>2&&s.dist<6);assert.ok(Math.abs(s.target[2]-2)<1e-8);
      }
      // Empty-space zoom still works without introducing NaNs or moving geometry.
      await load(false,2,false);const box=await page.locator('#c3d').boundingBox(),center={x:box.x+box.width/2,y:box.y+box.height/2};
      mobile?await pinch(center):await wheel(center,-500);
      let s=await state();assert.ok(s.dist>0&&s.dist<8&&s.target.every(Number.isFinite));assert.ok(Math.abs(s.target[2])<1e-10);
      // A large framed track doesn't jump down to the old 20,000-unit cap.
      await load(false,100000);const big=await point([0,0,100000]);await wheel(big,-100);
      s=await state();assert.ok(s.position[2]>100000&&s.dist<10&&s.dist>8);
      // Chromium scales synthetic wheel deltas on high-DPI mobile emulation.
      for(let i=0;i<(mobile?8:4);i++)await wheel(big,-1500);
      s=await state();assert.ok(s.dist<.05&&s.position[2]>100000,`Large-coordinate close zoom retains a representable distance above the road: ${JSON.stringify(s)}`);
      // Orthographic content behind the old orbit point can still be focused.
      await load(true);await page.evaluate(()=>{__pm.CAM.dist=1;__pm.applyCamera();});
      const behind=await point([0,0,2]);await wheel(behind,-500);
      s=await state();assert.ok(Math.abs(s.target[2]-2)<1e-8&&s.dist<1);
      assert.deepEqual(errors,[]);
      console.log(`${layout}: surface-focused wheel/pinch zoom, close limits, perspective/orthographic clipping and picking, zoom out, KCL/KMP, empty space, large coordinates and unchanged geometry passed`);
      await ctx.close();
    }
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
