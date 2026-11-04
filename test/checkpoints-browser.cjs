const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium,devices}=require('playwright');
(async()=>{
  const root=path.resolve(__dirname,'../docs'),server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/html');fs.createReadStream(file).pipe(res);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{for(const layout of(process.env.CHECKPOINT_LAYOUT?[process.env.CHECKPOINT_LAYOUT]:['desktop','phone','landscape'])){
    const mobile=layout!=='desktop',ctx=await browser.newContext({...(mobile?devices['iPhone 14']:{viewport:{width:1200,height:850}}),...(layout==='landscape'?{viewport:{width:844,height:390}}:{}),acceptDownloads:true,serviceWorkers:'block'});
    await ctx.addInitScript(()=>{localStorage.setItem('pm_welcomed','true');localStorage.setItem('pm_installHinted','true');});
    const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__pm);
    const cdp=await ctx.newCDPSession(page);
    await page.evaluate(async()=>{
      const p=__pm,d=p.serializeProject();d.objects=d.objects.slice(0,1);
      Object.assign(d.objects[0],{pos:[0,0,0],quat:[0,0,0,1],scl:[1,1,1],modifiers:[]});
      d.objects[0].mesh={verts:[[-8,-8,2],[8,-8,2],[8,8,2],[-8,8,2]],faces:[{v:[0,1,2,3],uv:[[0,0],[1,0],[1,1],[0,1]],mat:0}],looseEdges:[],seams:[],creases:[]};
      d.track={scale:100,start:{position:[0,-3,2.2],rotation:[0,180,0]}};
      d.camera={target:[0,0,0],yaw:.7,pitch:.4,dist:18,ortho:false};await p.loadProject(d);p.setWorkspace('kmp');
    });
    const source=await page.evaluate(()=>JSON.stringify(__pm.serializeProject().objects));
    await page.locator('#tools').getByRole('button',{name:'Checkpoints',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>[__pm.CAM.ortho,__pm.CAM.pitch,__pm.CAM.yaw]),[true,Math.PI/2,-Math.PI/2]);
    const world=xy=>page.evaluate(v=>__pm.screenOf(...v,2),xy);
    const state=()=>page.evaluate(()=>structuredClone(__pm.S.track.checkpoints));
    const down=async p=>mobile?cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:p.x,y:p.y}]}):(await page.mouse.move(p.x,p.y),await page.mouse.down());
    const move=async p=>mobile?cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:p.x,y:p.y}]}):page.mouse.move(p.x,p.y);
    const up=async()=>mobile?cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}):page.mouse.up();
    const drag=async(a,b)=>{await down(a);for(let i=1;i<=5;i++)await move({x:a.x+(b.x-a.x)*i/5,y:a.y+(b.y-a.y)*i/5});await up();};
    const draw=async(y)=>drag(await world([-3,y]),await world([3,y]));
    await draw(-2);let d=await state();assert.equal(d.points.length,1);assert.equal(d.points[0].type,0);assert.ok(d.points[0].left[0]<d.points[0].right[0]);
    await page.locator('#btnUndo').click();assert.equal((await state())?.points.length||0,0);await page.locator('#btnRedo').click();assert.equal((await state()).points.length,1);
    await draw(0);assert.equal((await state()).points[1].type,255);
    await page.locator('[aria-label="Checkpoint type"]').getByRole('button',{name:'Key',exact:true}).click();
    await draw(2);d=await state();assert.deepEqual(d.points.map(p=>p.type),[0,255,1]);assert.deepEqual(d.points.map(p=>[p.prev,p.next]),[[255,1],[0,2],[1,255]]);
    const beforeFlip=d.points[2];await page.locator('#sub').getByRole('button',{name:'Flip direction',exact:true}).click();d=await state();assert.deepEqual(d.points[2].left,beforeFlip.right);assert.deepEqual(d.points[2].right,beforeFlip.left);
    await page.locator('#btnUndo').click();assert.deepEqual((await state()).points[2],beforeFlip);
    await page.locator('[aria-label="Checkpoint tool mode"]').getByRole('button',{name:'Edit',exact:true}).click();
    let cp=(await state()).points[1];await drag(await world(cp.left),await world([-4,-.5]));d=await state();assert.ok(Math.abs(d.points[1].left[0]+4)<.06);assert.ok(Math.abs(d.points[1].left[1]+.5)<.06);
    // Moving a line translates both endpoints without changing width.
    cp=d.points[1];const mid=cp.left.map((v,i)=>(v+cp.right[i])/2);await drag(await world(mid),await world([mid[0],mid[1]+.6]));d=await state();assert.ok(Math.abs(d.points[1].right[1]-cp.right[1]-.6)<.06);
    await page.locator('#sub').getByRole('button',{name:'Checkpoint settings',exact:true}).click();
    await page.getByLabel('Selected checkpoint type',{exact:true}).selectOption('key');
    await page.getByLabel('Checkpoint key ID',{exact:true}).fill('2');await page.getByLabel('Checkpoint key ID',{exact:true}).press('Enter');assert.equal((await state()).points[1].type,2);
    await page.locator('#sheet').getByRole('button',{name:'Number keys in order',exact:true}).click();
    assert.deepEqual((await state()).points.map(p=>p.type),[0,1,2]);
    await page.locator('#sheetClose').click();await page.locator('#btnUndo').click();
    await page.locator('#sub').getByRole('button',{name:'Checkpoint settings',exact:true}).click();
    assert.deepEqual((await state()).points.map(p=>p.type),[0,2,1]);
    await page.locator('#sheet').getByRole('button',{name:'Later',exact:true}).click();assert.equal((await state()).points[2].type,2);
    await page.locator('#sheet').getByRole('button',{name:'Earlier',exact:true}).click();assert.equal((await state()).points[1].type,2);
    await page.locator('#sheet').getByRole('button',{name:'Delete checkpoint',exact:true}).click();assert.equal((await state()).points.length,2);
    await page.locator('#sheetClose').click();
    await page.locator('#btnUndo').click();assert.equal((await state()).points.length,3);
    // A click, canceled stroke, or second finger must not create a checkpoint.
    await page.locator('[aria-label="Checkpoint tool mode"]').getByRole('button',{name:'Draw',exact:true}).click();
    const count=(await state()).points.length,pt=await world([-2,1]);await down(pt);await up();assert.equal((await state()).points.length,count);
    await down(pt);await move({x:pt.x+30,y:pt.y});
    if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});else{await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await up();}
    assert.equal((await state()).points.length,count);
    if(mobile){
      await down(pt);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:pt.x,y:pt.y},{id:2,x:pt.x+80,y:pt.y}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:pt.x+15,y:pt.y+15},{id:2,x:pt.x+100,y:pt.y+15}]});await up();assert.equal((await state()).points.length,count);
    }
    const saved=await page.evaluate(()=>__pm.serializeProject());
    await page.evaluate(async doc=>{await __pm.loadProject(doc);__pm.setWorkspace('kmp');},saved);assert.deepEqual(await state(),saved.track.checkpoints);
    assert.equal(await page.evaluate(()=>JSON.stringify(__pm.serializeProject().objects)),source);
    // Real download and the SZS current-project replacement include edited CKPT/CKPH.
    const download=page.waitForEvent('download');await page.locator('#sub').getByRole('button',{name:'Export KMP',exact:true}).click();
    const file=await download,bytes=fs.readFileSync(await file.path());
    const {loadSrc}=await import('./loadsrc.mjs'),api=await loadSrc('kmp.js'),parsed=api.inspectKMP(bytes);
    assert.equal(parsed.checkpoints.points.length,3);assert.deepEqual(parsed.checkpoints.points.map(p=>p.type),saved.track.checkpoints.points.map(p=>p.type));
    assert.deepEqual(Buffer.from(await page.evaluate(()=>Array.from(__pm.szsProjectFile('course.kmp')))),bytes);
    await page.locator('#fileKMP').setInputFiles({name:'checkpoints.kmp',mimeType:'application/octet-stream',buffer:bytes});
    await page.getByText(/Updating: checkpoints.kmp/).waitFor();assert.equal((await state()).dirty,false);assert.equal((await state()).points.length,3);
    await page.locator('#sheetClose').click();await page.locator('#tools').getByRole('button',{name:'Checkpoints',exact:true}).click();
    await page.locator('#sub').getByRole('button',{name:'Checkpoint settings',exact:true}).click();await page.locator('#sheet').getByRole('button',{name:'2 · Key 2',exact:true}).click();
    await page.getByLabel('Checkpoint Left X',{exact:true}).fill('-5');await page.getByLabel('Checkpoint Left X',{exact:true}).press('Enter');
    const patched=api.inspectKMP(Buffer.from(await page.evaluate(()=>Array.from(__pm.szsProjectFile('course.kmp')))));
    assert.equal(patched.checkpoints.points[1].left[0],-500);
    for(const section of parsed.sections)if(section.name!=='CKPT')assert.deepEqual(patched.sections.find(s=>s.name===section.name).bytes,section.bytes);
    await page.locator('#sheetClose').click();
    await page.evaluate(()=>__pm.checkpointTopView());
    fs.mkdirSync('work',{recursive:true});await page.screenshot({path:`work/checkpoints-${layout}.png`,animations:'disabled'});
    assert.deepEqual(errors,[]);console.log(`${layout}: top view, drag creation/editing, types/direction, key IDs, reorder/delete/undo, gesture cancellation, persistence, KMP download, import preservation and SZS replacement passed`);await ctx.close();
  }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
