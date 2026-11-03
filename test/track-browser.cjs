const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');
const http = require('node:http');
function serve() {
 const root=path.resolve(__dirname,'../docs');
 const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  const type={'.html':'text/html','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{'content-type':type});fs.createReadStream(file).pipe(res);
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));
}
(async () => {
 const server=process.env.PM_URL ? null : await serve();
 const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
 const ctx=await browser.newContext({...devices['iPhone 14'],acceptDownloads:true,serviceWorkers:'block'});
 const page=await ctx.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.stack));
 await page.goto(process.env.PM_URL || `http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__pm);
 if(await page.locator('#sheet').isVisible()) await page.locator('#sheetClose').click();
 await page.getByRole('button',{name:'Modifiers',exact:true}).click();
 await page.getByRole('button',{name:'Add Subdivision Surface'}).click();
 assert.deepEqual(await page.evaluate(()=>[__pm.S.active.mesh.faces.length,__pm.S.active.renderMesh.faces.length]),[6,24]);
 await page.getByLabel('Subdivision levels').selectOption('2');
 assert.equal(await page.evaluate(()=>__pm.S.active.renderMesh.faces.length),96);
 await page.getByLabel('Subdivision method').selectOption('simple');
 assert.equal(await page.evaluate(()=>__pm.S.active.modifiers[0].levels),2,'changing method preserves levels');
 await page.evaluate(()=>__pm.undo());
 await page.evaluate(()=>__pm.undo());assert.equal(await page.evaluate(()=>__pm.S.active.renderMesh.faces.length),24);
 await page.evaluate(()=>__pm.redo());assert.equal(await page.evaluate(()=>__pm.S.active.renderMesh.faces.length),96);
 await page.locator('#sheetClose').click();
 const saved=await page.evaluate(()=>__pm.serializeProject());
 await page.evaluate(data=>__pm.loadProject(data),saved);
 assert.equal(await page.evaluate(()=>__pm.S.active.renderMesh.faces.length),96);
 await page.evaluate(()=>{__pm.setMode('edit');__pm.S.active.esel.verts.clear();__pm.editSelectAll('none');__pm.S.xray=true;__pm.rebuildObject(__pm.S.active);});
 assert.equal(await page.evaluate(()=>__pm.S.active.renderMesh.faces.length),6);
 const cdp=await ctx.newCDPSession(page);
 const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map((p,i)=>({...p,id:i+1}))});
 const coordinates=async(mode)=>page.evaluate(mode=>{const p=__pm,o=p.S.active;let pts;
  if(mode==='vert') pts=o.mesh.verts;
  if(mode==='edge') pts=p.topo(o.mesh).edges.map(([a,b])=>o.mesh.verts[a].map((v,k)=>(v+o.mesh.verts[b][k])/2));
  if(mode==='face') pts=o.mesh.faces.map(f=>p.faceCenter(o.mesh,f));
  return pts.map(p=>__pm.screenOf(...p));
 },mode);
 for(const mode of ['vert','edge','face']) {
  await page.evaluate(mode=>{__pm.S.multiSelect=false;__pm.S.selOp='set';__pm.setSelectMode(mode);__pm.editSelectAll('none');},mode);
  const pts=await coordinates(mode), a=pts[0], b=pts.find(p=>Math.hypot(p.x-a.x,p.y-a.y)>55);
  await touch('touchStart',[a]);await page.waitForTimeout(520);await touch('touchEnd',[]);
  assert.equal(await page.evaluate(()=>__pm.S.multiSelect),true,'long press '+mode);
  const count=()=>page.evaluate(mode=>__pm.S.active.esel[{vert:'verts',edge:'edges',face:'faces'}[mode]].size,mode);
  assert.equal(await count(),1);
  await touch('touchStart',[b]);await touch('touchEnd',[]);assert.equal(await count(),2,'add '+mode);
  await touch('touchStart',[b]);await touch('touchEnd',[]);assert.equal(await count(),1,'toggle '+mode);
  await page.getByRole('button',{name:'Multiselect'}).click();assert.equal(await page.evaluate(()=>__pm.S.selOp),'set');
 }
 // Movement and cancellation must not cause a delayed selection.
 await page.evaluate(()=>__pm.editSelectAll('none'));
 const pt=(await coordinates('face'))[0];
 await touch('touchStart',[pt]);await touch('touchMove',[{x:pt.x+40,y:pt.y}]);await page.waitForTimeout(520);await touch('touchEnd',[]);
 assert.equal(await page.evaluate(()=>__pm.S.multiSelect),false);
 await touch('touchStart',[pt]);await touch('touchCancel',[]);await page.waitForTimeout(520);
 assert.equal(await page.evaluate(()=>__pm.S.multiSelect),false);
 await touch('touchStart',[pt]);await touch('touchStart',[pt,{x:pt.x+80,y:pt.y}]);await page.waitForTimeout(520);await touch('touchEnd',[]);
 assert.equal(await page.evaluate(()=>__pm.S.multiSelect),false,'second finger cancels hold');
 await page.evaluate(()=>__pm.setMode('object'));
 await page.getByRole('button',{name:'Modifiers',exact:true}).click();
 await page.getByRole('button',{name:'Apply to mesh',exact:true}).click();
 assert.equal(await page.evaluate(()=>__pm.S.active.mesh.faces.length),96);
 await page.evaluate(()=>__pm.undo());assert.equal(await page.evaluate(()=>__pm.S.active.mesh.faces.length),6);
 await page.locator('#sheetClose').click();
 // Import a colored/transparent image through the actual input and resize it.
 await page.getByRole('button',{name:'Material',exact:true}).click();
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1024;c.height=512;const x=c.getContext('2d');x.fillStyle='#ff0000';x.fillRect(0,0,512,512);x.fillStyle='#00ff00';x.fillRect(512,0,512,512);x.clearRect(0,0,128,128);return c.toDataURL().split(',')[1];});
 const file=Buffer.from(png,'base64');
 await page.getByRole('button',{name:'Upload image…',exact:true}).click();
 await page.locator('#fileTex').setInputFiles({name:'road.png',mimeType:'image/png',buffer:file});
 await page.waitForFunction(()=>__pm.S.images.size>0);
 const originalId=await page.evaluate(()=>__pm.S.materials[0].texture);
 await page.getByLabel('Maximum image size',{exact:true}).selectOption('256');
 await page.getByRole('button',{name:'Downscale image',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>{const im=__pm.S.images.get(__pm.S.materials[0].texture);return [im.width,im.height,im.el.getContext('2d').getImageData(0,0,1,1).data[3]];}),[256,128,0]);
 await page.evaluate(()=>__pm.undo());assert.equal(await page.evaluate(()=>__pm.S.materials[0].texture),originalId);
 await page.evaluate(()=>__pm.redo());
 await page.getByLabel('Material shader').selectOption('unlit');
 await page.getByLabel('Transparency mode').selectOption('cutout');
 assert.equal(await page.evaluate(()=>__pm.S.active.meshNode.material[0].type),'MeshBasicMaterial');
 assert.equal(await page.getByText('Cutout threshold',{exact:true}).isVisible(),true);
 await page.locator('#sheetClose').click();
 await page.locator('#btnMenu').click();await page.getByRole('button',{name:/Export as BRRES/}).click();
 const downloadPromise=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export & Send BRRES…',exact:true}).click();
 const download=await downloadPromise;
 assert.equal(download.suggestedFilename(),'course_model.brres');
 const out=process.env.PM_TEST_OUTPUT || 'work';fs.mkdirSync(out,{recursive:true});await download.saveAs(path.join(out,'browser-course.brres'));
 const data=fs.readFileSync(path.join(out,'browser-course.brres'));assert.equal(data.toString('ascii',0,4),'bres');
 await page.screenshot({path:path.join(out,'export-mobile.png')});
 // MTL + matching image import through the file input, then independent sampler state.
 await page.locator('#sheetClose').click();
 await page.locator('#fileMat').setInputFiles([
  {name:'materials.mtl',mimeType:'text/plain',buffer:Buffer.from('newmtl TrackRoad\nKd 1 1 1\nmap_Kd road.png\nnewmtl TrackGrass\nKd .2 .7 .1\nd .6\nmap_Kd road.png')},
  {name:'road.png',mimeType:'image/png',buffer:file}
 ]);
 await page.waitForFunction(()=>__pm.S.materials.some(m=>m.name==='TrackGrass'));
 const project=await page.evaluate(()=>__pm.serializeProject());
 const road=project.materials.find(m=>m.name==='TrackRoad'), grass=project.materials.find(m=>m.name==='TrackGrass');
 assert.equal(road.texture,grass.texture);assert.equal(grass.alpha,.6);assert.equal(grass.shader,'unlit');
 road.filter='nearest';road.wrap='extend';grass.filter='linear';grass.wrap='repeat';
 await page.evaluate(p=>__pm.loadProject(p),project);
 assert.deepEqual(await page.evaluate(()=>{const o=__pm.S.active, mats=o.meshNode.material;const a=mats[o.materials.indexOf(__pm.S.materials.find(m=>m.name==='TrackRoad').id)],b=mats[o.materials.indexOf(__pm.S.materials.find(m=>m.name==='TrackGrass').id)];return [a.map!==b.map,a.map.magFilter!==b.map.magFilter,a.map.wrapS!==b.map.wrapS];}),[true,true,true]);
 assert.deepEqual(errors,[]);
 console.log('Mobile subdivision, undo/save/load/apply, hold selection in all three modes, gesture cancellation, texture downscale/alpha and BRRES download passed');
 } finally {await browser.close();if(server)server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
