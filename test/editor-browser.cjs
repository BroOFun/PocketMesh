const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium,devices}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'../docs');
 const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.png':'image/png'}[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const out=process.env.PM_TEST_OUTPUT||'work';fs.mkdirSync(out,{recursive:true});
 try {
 for(const mobile of [false,true]) {
  const ctx=await browser.newContext({...mobile?devices['iPhone 14']:{viewport:{width:1200,height:850}},acceptDownloads:true,serviceWorkers:'block'});
  const page=await ctx.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.stack));
  await page.goto(process.env.PM_URL||`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__pm);
  if(await page.locator('#sheet').isVisible())await page.locator('#sheetClose').click();
  // Configure a top view and a non-uniformly scaled cube: ruler distances are world-space meters.
  await page.evaluate(()=>{const p=__pm;p.CAM.pitch=Math.PI/2;p.CAM.yaw=0;p.CAM.dist=10;p.CAM.ortho=true;p.S.active.node.scale.set(1.5,1,1);p.rebuildObject(p.S.active);p.applyCamera();});
  await page.getByRole('button',{name:'Ruler · Measure',exact:true}).click();
  const vertex=await page.evaluate(()=>__pm.screenOf(-1,-1,1));
  const endpoint=await page.evaluate(()=>__pm.screenOf(1,-1,1));
  const click=async(p)=> mobile?page.touchscreen.tap(p.x,p.y):page.mouse.click(p.x,p.y);
  await click({x:vertex.x+3,y:vertex.y+2});
  assert.equal(await page.evaluate(()=>__pm.RULER.first.kind),'Vertex');
  await click({x:endpoint.x-3,y:endpoint.y+2});
  assert.equal(await page.evaluate(()=>__pm.S.ruler.measurements.length),1);
  assert.deepEqual(await page.evaluate(()=>__pm.S.ruler.measurements[0]),{a:[-1.5,-1,1],b:[1.5,-1,1]});
  await page.screenshot({path:path.join(out,`ruler-${mobile?'mobile':'desktop'}.png`)});
  // Tap two edge midpoints far enough from the corners to exercise edge snapping.
  const edgeA=await page.evaluate(()=>__pm.screenOf(0,-1,1)), edgeB=await page.evaluate(()=>__pm.screenOf(0,1,1));
  await click(edgeA);assert.equal(await page.evaluate(()=>__pm.RULER.first.kind),'Edge');await click(edgeB);
  assert.ok(await page.evaluate(()=>Math.abs(__pm.S.ruler.measurements[1].a[1]+1)<1e-6&&Math.abs(__pm.S.ruler.measurements[1].b[1]-1)<1e-6));
  await page.getByRole('button',{name:'Ruler',exact:true}).first().click();
  assert.ok(await page.getByText('1. 3 m',{exact:true}).isVisible());
  await page.getByLabel('Ruler unit',{exact:true}).selectOption('cm');assert.ok(await page.getByText('1. 300 cm',{exact:true}).isVisible());
  await page.getByLabel('Meters per modeling unit',{exact:true}).fill('0.01');await page.getByLabel('Meters per modeling unit',{exact:true}).press('Tab');
  assert.ok(await page.getByText('1. 3 cm',{exact:true}).isVisible());
  const project=await page.evaluate(()=>__pm.serializeProject());await page.evaluate(p=>__pm.loadProject(p),project);
  assert.equal(await page.evaluate(()=>__pm.S.ruler.measurements.length),2);assert.equal(await page.evaluate(()=>__pm.S.ruler.metersPerUnit),.01);
  await page.getByLabel('Delete measurement 2',{exact:true}).click();assert.equal(await page.evaluate(()=>__pm.S.ruler.measurements.length),1);
  await page.evaluate(()=>__pm.undo());assert.equal(await page.evaluate(()=>__pm.S.ruler.measurements.length),2);
  await page.evaluate(()=>__pm.redo());assert.equal(await page.evaluate(()=>__pm.S.ruler.measurements.length),1);
  await page.locator('#sheetClose').click();await page.getByRole('button',{name:'Done',exact:true}).click();
  // Load a generated file through the actual file chooser; inspect, resize, save, reopen.
  const bytes=await page.evaluate(()=>{
   const c=document.createElement('canvas');c.width=64;c.height=32;const x=c.getContext('2d');x.fillStyle='#ee6040';x.fillRect(0,0,32,32);x.fillStyle='#3288e8';x.fillRect(32,0,32,32);x.clearRect(0,0,8,8);
   const im=__pm.addImageFromCanvas('test.png',c);__pm.S.materials[0].texture=im.id;__pm.S.materials[0].useTexture=true;
   return Array.from(__pm.runExport('brres',{baseName:'editor-test',scale:1,textureSize:64}).data);
  });
  await page.locator('#btnMenu').click();await page.getByRole('button',{name:/BRRES Editor/}).click();
  await page.locator('#fileBRRES').setInputFiles({name:'editor-test.brres',mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});
  await page.getByLabel('Texture width',{exact:true}).waitFor();
  assert.ok(await page.getByText('64 × 32 px · RGBA8 (6)',{exact:true}).isVisible());
  await page.getByLabel('Texture width',{exact:true}).selectOption('32');await page.getByLabel('Texture height',{exact:true}).selectOption('16');
  await page.getByLabel('Texture format',{exact:true}).selectOption('5');await page.getByLabel('Texture mipmaps',{exact:true}).selectOption('full');
  await page.getByRole('button',{name:'Apply texture changes',exact:true}).click();
  assert.ok(await page.getByText('32 × 16 px · RGB5A3 (5)',{exact:true}).isVisible());
  await page.screenshot({path:path.join(out,`brres-${mobile?'mobile':'desktop'}.png`)});
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Save & Send BRRES…',exact:true}).click();const download=await downloadPromise;
  const savedPath=path.join(out,`edited-${mobile?'mobile':'desktop'}.brres`);await download.saveAs(savedPath);
  await page.locator('#fileBRRES').setInputFiles(savedPath);await page.waitForFunction(name=>__pm.BRED.name===name,path.basename(savedPath));await page.getByText('32 × 16 px · RGB5A3 (5)',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>__pm.BRED.archive.textures[0].mipCount),6);
  // Malformed uploads leave the previously open archive available.
  await page.locator('#fileBRRES').setInputFiles({name:'bad.brres',mimeType:'application/octet-stream',buffer:Buffer.from('bad')});
  await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>__pm.BRED.archive.textures.length),1);
  // Replace an image and increase size: exercise appending a TEX0 and export alpha.
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=16;c.height=8;const x=c.getContext('2d');x.fillStyle='#00ff00';x.fillRect(0,0,8,8);return c.toDataURL().split(',')[1];});
  await page.getByRole('button',{name:'Replace image…',exact:true}).click();
  await page.locator('#fileBRRESTexture').setInputFiles({name:'green.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.getByText('Replacement ready — apply changes below.',{exact:true}).waitFor();
  await page.getByLabel('Texture width',{exact:true}).selectOption('128');await page.getByLabel('Texture height',{exact:true}).selectOption('64');await page.getByLabel('Texture format',{exact:true}).selectOption('6');
  await page.getByRole('button',{name:'Apply texture changes',exact:true}).click();
  const result=await page.evaluate(()=>{const a=__pm.inspectBRRES(__pm.saveBRRESEdits(__pm.BRED.archive,__pm.BRED.changes)),t=a.textures[0],im=__pm.decodeBRRESTexture(a,t);return {offset:t.offset,oldLength:__pm.BRED.archive.bytes.length,size:[t.width,t.height],first:Array.from(im.rgba.slice(0,4)),last:Array.from(im.rgba.slice(-4))};});
  assert.deepEqual(result.size,[128,64]);assert.ok(result.offset>=result.oldLength);assert.deepEqual(result.first,[0,255,0,255]);assert.deepEqual(result.last,[0,0,0,0]);
  // Inspect model metadata without changing its bytes; revert texture edit.
  const options=await page.getByLabel('BRRES resource',{exact:true}).locator('option').allTextContents();assert.ok(options.some(s=>s.startsWith('MDL0')));
  await page.getByRole('button',{name:'Revert texture',exact:true}).click();assert.equal(await page.evaluate(()=>__pm.BRED.changes.size),0);
  assert.deepEqual(errors,[]);
  await ctx.close();
 }
 console.log('Desktop + iPhone ruler snapping/meters/units/persistence/undo and BRRES inspect/resize/mipmaps/save/reopen/replace/append/error/revert passed');
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
