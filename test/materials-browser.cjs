// Regression: a selected road must not exclude finish-line and boost objects from a track export.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), http=require('node:http');
const {chromium,devices}=require('playwright');
(async()=>{
 const {loadSrc}=await import('./loadsrc.mjs'), api=await loadSrc('brres_edit.js');
 const noclip=process.env.NOCLIP_PARSER ? await import(process.env.NOCLIP_PARSER) : null;
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
  // Simulate a returning user whose old export settings selected only the active road.
  await ctx.addInitScript(()=>localStorage.setItem('pm_export',JSON.stringify({fmt:'brres',selectedOnly:true,zip:false})));
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.__pm);
  if(await page.locator('#sheet').isVisible())await page.locator('#sheetClose').click();
  await page.evaluate(async()=>{
   const p=__pm, colors=['#555555','#ff0000','#00ff00'];
   const ids=colors.map((color,i)=>{const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,32,32);return p.addImageFromCanvas(i===0?'road.png':'decal',c).id;});
   const doc=p.serializeProject(), base=doc.objects[0], mat=doc.materials[0];
   doc.images=ids.map(id=>{const im=p.S.images.get(id);return {id,name:im.name,mime:im.mime,data:im.el.toDataURL().split(',')[1]};});
   doc.materials=['Road','FinishLine','Boost','Paint','SharedFinish','Hidden'].map((name,i)=>({...mat,id:i+1,name,color:i===3?'#ff8000':'#ffffff',texture:i<3?ids[i]:i===4?ids[1]:null,useTexture:true,shader:'unlit'}));
   doc.objects=['Road','FinishLine','Boost','Hidden'].map((name,i)=>({...structuredClone(base),id:i+1,name,selected:i===0,visible:i!==3,pos:[(i-1)*4,0,0],materials:i===0?[1]:i===1?[2,5]:i===2?[3,4]:[6]}));
   doc.objects[1].mesh.faces[0].mat=1;doc.objects[2].mesh.faces[0].mat=1;
   doc.active=1;await p.loadProject(doc);
  });
  const openExport=async()=>{await page.locator('#btnMenu').click();await page.getByRole('button',{name:/Export as BRRES/}).click();};
  const download=async(label,name)=>{const promise=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const d=await promise;const file=path.join(out,name);await d.saveAs(file);return file;};
  await openExport();
  assert.equal(await page.getByLabel('Selected objects only',{exact:true}).isChecked(),false,'BRRES defaults to all objects despite old selectedOnly');
  assert.match(await page.locator('#brresScope').textContent(),/All visible objects: 3/);
  const file=await download('Export & Send BRRES…',`all-materials-${mobile?'mobile':'desktop'}.brres`), bytes=new Uint8Array(fs.readFileSync(file)), archive=api.inspectBRRES(bytes);
  assert.deepEqual(archive.materials.map(m=>m.name),['Road','FinishLine','SharedFinish','Boost','Paint']);
  assert.deepEqual(archive.textures.map(t=>t.name),['road','decal','decal_1'],'distinct extensionless image names stay distinct; shared image stays shared');
  const finish=archive.materials.find(m=>m.name==='FinishLine'), boost=archive.materials.find(m=>m.name==='Boost'), paint=archive.materials.find(m=>m.name==='Paint');
  assert.equal(finish.samplers[0].name,'decal');assert.equal(boost.samplers[0].name,'decal_1');assert.deepEqual(paint.samplers,[]);
  assert.deepEqual(Array.from(api.decodeBRRESTexture(archive,archive.textures[1]).rgba.slice(0,4)),[255,0,0,255]);
  assert.deepEqual(Array.from(api.decodeBRRESTexture(archive,archive.textures[2]).rgba.slice(0,4)),[0,255,0,255]);
  if(noclip){const parsed=noclip.parse(new noclip.ArrayBufferSlice(bytes.buffer));assert.equal(parsed.mdl0[0].materials.length,5);assert.equal(parsed.tex0.length,3);assert.equal(parsed.mdl0[0].shapes.reduce((n,s)=>n+s.loadedVertexData.totalIndexCount,0),108);}
  // A deliberately chosen selected-only export remains supported and persists separately.
  await page.getByLabel('Selected objects only',{exact:true}).check();assert.match(await page.locator('#brresScope').textContent(),/Selected visible objects: 1/);
  const onlyFile=await download('Export & Send BRRES…',`road-only-${mobile?'mobile':'desktop'}.brres`);
  assert.deepEqual(api.inspectBRRES(new Uint8Array(fs.readFileSync(onlyFile))).materials.map(m=>m.name),['Road']);
  await page.locator('#sheetClose').click();await openExport();assert.equal(await page.getByLabel('Selected objects only',{exact:true}).isChecked(),true);await page.getByLabel('Selected objects only',{exact:true}).uncheck();
  await page.locator('#sheetClose').click();await page.locator('#sub').getByRole('button',{name:'Track Editor',exact:true}).click();await page.locator('#sheet').getByRole('button',{name:/Course Model/}).click();
  await page.locator('#fileBRRES').setInputFiles(file);await page.getByRole('button',{name:'Inspect material FinishLine in course',exact:true}).waitFor();
  assert.ok(await page.getByRole('button',{name:'Inspect material Boost in course',exact:true}).isVisible());
  await page.getByRole('button',{name:'Inspect material Boost in course',exact:true}).click();
  await page.getByRole('button',{name:'Open texture decal_1',exact:true}).click();
  assert.ok(await page.getByText('Used by: Boost',{exact:true}).isVisible());
  await page.getByLabel('Texture width',{exact:true}).selectOption('16');await page.getByLabel('Texture height',{exact:true}).selectOption('16');await page.getByRole('button',{name:'Apply texture changes',exact:true}).click();
  const editedFile=await download('Save & Send BRRES…',`all-materials-edited-${mobile?'mobile':'desktop'}.brres`), edited=api.inspectBRRES(new Uint8Array(fs.readFileSync(editedFile)));
  assert.deepEqual(edited.materials,archive.materials,'texture edit preserves every material and sampler');
  assert.equal(edited.textures[2].width,16);assert.equal(edited.textures[1].width,32);
  assert.deepEqual(edited.bytes.slice(archive.resources[0].offset,archive.resources[0].offset+archive.resources[0].size),archive.bytes.slice(archive.resources[0].offset,archive.resources[0].offset+archive.resources[0].size));
  await page.getByRole('button',{name:'Inspect material Paint in course',exact:true}).click();assert.ok(await page.getByText(/included in the BRRES without an image texture/).isVisible());
  await page.getByRole('button',{name:'Use current scene',exact:true}).click();assert.equal(await page.evaluate(()=>__pm.BRED.archive.materials.length),5);
  // Screenshot the material list at the top of the panel.
  await page.locator('#sheetBody').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(out,`materials-${mobile?'mobile':'desktop'}.png`)});
  const missing=await page.evaluate(()=>{const m=__pm.S.materials[1],previous=m.texture;m.texture=999999;try{__pm.runExport('brres',{baseName:'missing'});return 'no error';}catch(e){return e.message;}finally{m.texture=previous;}});
  assert.match(missing,/FinishLine.*missing its image/);
  assert.deepEqual(errors,[]);await ctx.close();
 }
 console.log('Desktop/iPhone all-visible BRRES export, selected-only opt-in, finish/boost/shared/color materials, filename collisions, editor links, resize/save preservation and missing-image errors passed');
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
