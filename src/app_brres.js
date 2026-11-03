// Standalone archive editor: opening a BRRES does not replace the modeling scene.
const BRED = { archive: null, name: '', selected: null, changes: new Map(), palettes: new Map(), preview: null, replacement: null, imageTarget: null, error: '' };
function loadBRRESEditor(bytes, name = 'course_model.brres') {
  const archive = inspectBRRES(bytes); // Validate before replacing an open archive.
  Object.assign(BRED,{archive,name,selected:(archive.textures[0] || archive.resources[0])?.offset ?? null,changes:new Map(),palettes:new Map(),preview:null,replacement:null,error:''});
  openBRRESEditor(); return archive;
}
function brresImage(texture, level = 0) {
  const edit = BRED.changes.get(texture.offset);
  if (edit) {
    const t = { ...edit,offset:0,dataOffset:0,encodedSize:edit.data.length };
    return decodeBRRESTexture({bytes:edit.data,textures:[t],palettes:[]},t,null,level);
  }
  const palette = BRED.archive.palettes.find((p) => p.offset === BRED.palettes.get(texture.offset));
  return decodeBRRESTexture(BRED.archive,texture,palette,level);
}
function brresCanvas(image) {
  const canvas = h('canvas',{class:'brres-preview',width:image.width,height:image.height,'aria-label':'Texture preview'});
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.rgba),image.width,image.height),0,0);
  return canvas;
}
function brresSize(bytes) { return bytes >= 1048576 ? (bytes/1048576).toFixed(2)+' MiB' : (bytes/1024).toFixed(1)+' KiB'; }
function openBRRESEditor() { openSheet('BRRES Editor',buildBRRESEditor,{panel:true,kind:'brres'}); }
function brresEditorError(error) { BRED.error = error.message || String(error); if (SHEET.kind === 'brres') refreshSheet(true); toast(BRED.error,true); }
function brresSelectResource(value) {
  BRED.selected = String(value).startsWith('material:') ? String(value) : Number(value);
  BRED.preview=null; BRED.replacement=null; BRED.error=''; refreshSheet(true);
}
function brresMaterialButton(material) {
  return h('button',{class:'brres-material','aria-label':`Inspect material ${material.name} in ${material.model}`,onclick:() => brresSelectResource('material:'+material.offset)},
    h('strong',{},material.name),h('span',{class:'muted'},material.model+' · '+(material.samplers.length ? material.samplers.map((s) => s.name).join(', ') : 'No image texture')));
}
function buildBRRESMaterial(body, material) {
  const card=h('div',{class:'card'},h('h3',{},'Material · '+material.name),h('span',{class:'muted'},`Model: ${material.model} · ${brresSize(material.size)}`));
  card.append(h('span',{class:'muted'},`${material.tevStages} TEV stage${material.tevStages===1?'':'s'} · ${material.translucent?'Translucent':'Opaque draw list'}`));
  if (material.color) {
    const [r,g,b,a]=material.color, hex='#'+[r,g,b].map((n) => n.toString(16).padStart(2,'0')).join('');
    card.append(h('div',{class:'row'},h('span',{'aria-hidden':'true',style:{width:'28px',height:'28px',borderRadius:'6px',background:hex,border:'1px solid var(--line)'}}),h('span',{},`Channel color ${hex} · alpha ${a}/255`)));
  }
  card.append(h('h3',{},'Linked textures'));
  if (!material.samplers.length) card.append(h('p',{class:'muted'},'This material is included in the BRRES without an image texture. Its appearance comes from material/vertex colors and the shader.'));
  for (const sampler of material.samplers) {
    const texture=BRED.archive.textures.find((t) => t.name===sampler.name), edit=texture && BRED.changes.get(texture.offset), current=edit||texture;
    card.append(h('strong',{},sampler.name),h('span',{class:'muted'},`Texture slot ${sampler.slot}`+(sampler.palette?' · Palette: '+sampler.palette:'')));
    if (texture) {
      card.append(h('span',{class:'muted'},current.width === undefined ? 'Unsupported texture version' : `${current.width} × ${current.height} px · ${WII_TEXTURE_FORMATS[current.format]||texture.formatName}`));
      card.append(h('button',{class:'btn',onclick:() => brresSelectResource(texture.offset)},'Open texture '+sampler.name));
    } else card.append(h('p',{class:'brres-error'},'This texture is referenced by the material but is not embedded in this archive.'));
  }
  card.append(h('p',{class:'muted'},'Material and shader settings are preserved. Open a linked texture above to preview, resize or replace its image.'));
  body.append(card);
}
function buildBRRESEditor(body) {
  body.append(h('div',{class:'row'},h('button',{class:'btn primary',onclick:() => $('#fileBRRES').click()},'Open BRRES…'),h('button',{class:'btn',onclick:() => {
    try { const file = runExport('brres',{baseName:'course_model',scale:1,textureSize:512,selectedOnly:false,zip:false}); loadBRRESEditor(file.data,file.name); } catch (e) { brresEditorError(e); }
  }},'Use current scene')));
  if (BRED.error) body.append(h('p',{class:'brres-error',role:'alert'},BRED.error));
  const a = BRED.archive;
  if (!a) {
    body.append(h('p',{class:'muted'},'Open an uncompressed Wii .brres to inspect models, animations, palettes and textures. Resize, replace or convert textures, then save a BRRES copy.'));
    body.append(h('p',{class:'muted'},'This basic editor changes textures. Geometry, material/shader definitions and animations in opened files are preserved. Use PocketMesh’s modeling tools for new models.'));
    return;
  }
  const counts = new Map(); for (const r of a.resources) counts.set(r.type,(counts.get(r.type)||0)+1);
  body.append(h('div',{class:'card'},h('strong',{style:{overflowWrap:'anywhere'}},BRED.name),h('span',{class:'muted'},`BRRES v${a.version} · Big endian · ${brresSize(a.bytes.length)}`),h('span',{class:'muted'},[...counts].map(([type,n]) => `${n} ${type}`).join(' · ') || 'Empty archive'),h('span',{class:'muted'},`${a.materials.length} material${a.materials.length===1?'':'s'} inside models`)));
  const exportButton = h('button',{class:'btn primary',onclick:() => {
    try { const bytes = saveBRRESEdits(a,BRED.changes); shareOrDownload(safeFileName(BRED.name.replace(/\.brres$/i,''))+'_edited.brres',bytes); } catch (e) { brresEditorError(e); }
  }},'Save & Send BRRES…');
  body.append(h('div',{class:'row'},exportButton,h('span',{class:'muted','aria-live':'polite'},`${BRED.changes.size} edited texture${BRED.changes.size === 1 ? '' : 's'}`)));
  if (!a.resources.length) return;
  if (a.materials.length) body.append(h('div',{class:'card'},h('h3',{},`Materials (${a.materials.length})`),h('div',{class:'brres-materials'},...a.materials.map(brresMaterialButton))));
  const entries=[...a.resources.map((r) => [r.offset,`${r.type} · ${r.name}${BRED.changes.has(r.offset) ? ' *' : ''}`]),...a.materials.map((m) => ['material:'+m.offset,`Material · ${m.model} / ${m.name}`])];
  body.append(field('Resource',selectInput(BRED.selected,entries,brresSelectResource,'BRRES resource')));
  const material=a.materials.find((m) => 'material:'+m.offset===BRED.selected);
  if (material) { buildBRRESMaterial(body,material); return; }
  const t = a.resources.find((r) => r.offset === BRED.selected); if (!t) return;
  const card = h('div',{class:'card'},h('h3',{style:{overflowWrap:'anywhere'}},t.type+' · '+t.name),h('span',{class:'muted'},`${t.group} · Version ${t.version} · ${brresSize(t.size)}`));
  body.append(card);
  if (t.type !== 'TEX0') {
    if (t.type === 'MDL0' && t.vertices !== undefined) {
      card.append(h('p',{class:'muted'},`${t.vertices.toLocaleString()} vertices · ${t.polygons.toLocaleString()} polygons`));
      card.append(h('h3',{},'Materials'),h('p',{class:'muted',style:{overflowWrap:'anywhere'}},t.materials.join(', ') || 'None'));
    }
    if (t.type === 'PLT0' && t.entries !== undefined) card.append(h('p',{class:'muted'},`${t.entries} palette colors · ${['IA8','RGB565','RGB5A3'][t.format] || 'Unknown format '+t.format}`));
    card.append(h('p',{class:'muted'},'Inspected only. This resource stays unchanged when you save texture edits.'));
    return;
  }
  if (t.width === undefined) { card.append(h('p',{class:'muted'},'This TEX0 version is not supported for preview or editing.')); return; }
  const edit = BRED.changes.get(t.offset), current = edit || t;
  const users=a.materials.filter((m) => m.samplers.some((s) => s.name===t.name));
  if (users.length) card.append(h('span',{class:'muted',style:{overflowWrap:'anywhere'}},'Used by: '+users.map((m) => m.name).join(', ')));
  card.append(h('span',{},`${current.width} × ${current.height} px · ${WII_TEXTURE_FORMATS[current.format] || t.formatName} (${current.format})`),h('span',{class:'muted'},`${current.mipCount} mip level${current.mipCount === 1 ? '' : 's'} · ${brresSize(edit?.data.length || t.encodedSize || 0)} encoded pixels`));
  if (edit) card.append(h('span',{class:'muted'},`Original: ${t.width} × ${t.height} · ${t.formatName} · ${t.mipCount} levels`));
  if ([8,9,10].includes(t.format) && !edit) {
    const matching = a.palettes.find((p) => p.name === t.name);
    card.append(field('Palette',selectInput(BRED.palettes.get(t.offset) ?? matching?.offset ?? '',[['','Choose palette…'],...a.palettes.map((p) => [p.offset,p.name])],(value) => { BRED.palettes.set(t.offset,Number(value)); BRED.preview=null; refreshSheet(true); },'Texture palette')));
  }
  let image;
  try {
    const key = `${t.offset}:${BRED.palettes.get(t.offset)}:${!!edit}`;
    if (BRED.preview?.key !== key) BRED.preview = {key,image:brresImage(t)};
    image = BRED.replacement?.offset === t.offset ? BRED.replacement.image : BRED.preview.image;
    card.append(brresCanvas(image));
    if (BRED.replacement?.offset === t.offset) card.append(h('strong',{},'Replacement ready — apply changes below.'));
  } catch (e) { card.append(h('p',{class:'muted'},e.message)); }
  if (!t.editable) { card.append(h('p',{class:'muted'},'This texture has an unsupported format or user metadata. It is read-only and will be preserved.')); return; }
  const buttons = h('div',{class:'row'},h('button',{class:'btn',onclick:() => { BRED.imageTarget={archive:a,offset:t.offset}; $('#fileBRRESTexture').click(); }},'Replace image…'));
  if (image) buttons.append(h('button',{class:'btn',onclick:() => shareOrDownload(safeFileName(t.name)+'.png',canvasBytes(brresCanvas(image),'image/png'))},'Export PNG'));
  if (edit || BRED.replacement) buttons.append(h('button',{class:'btn',onclick:() => { BRED.changes.delete(t.offset); BRED.replacement=null; BRED.preview=null; BRED.error=''; refreshSheet(true); }},'Revert texture'));
  card.append(buttons);
  if (!image) return;
  const sizes = Array.from({length:11},(_,i) => [2**i,String(2**i)]), pot = (n) => 2**Math.floor(Math.log2(Math.min(1024,n)));
  let width = pot(image.width), height = pot(image.height), format = [0,1,2,3,4,5,6].includes(current.format) ? current.format : 6, mipMode = current.mipCount > 1 ? 'keep' : 'none';
  const widthInput = selectInput(width,sizes,(v) => { width=+v; updateEstimate(); },'Texture width');
  const heightInput = selectInput(height,sizes,(v) => { height=+v; updateEstimate(); },'Texture height');
  card.append(field('Width (px)',widthInput),field('Height (px)',heightInput));
  card.append(field('Fit longest edge',selectInput('',[['','Choose size…'],...[64,128,256,512,1024].map((n) => [n,n+' px'])],(value) => {
    if (!value) return; const scale = +value / Math.max(image.width,image.height);
    width = Math.max(1,pot(image.width*scale)); height = Math.max(1,pot(image.height*scale)); widthInput.value=String(width); heightInput.value=String(height); updateEstimate();
  },'Fit texture size')));
  card.append(field('Output format',selectInput(format,[[6,'RGBA8 · full color + alpha'],[5,'RGB5A3 · color + alpha'],[4,'RGB565 · opaque color'],[3,'IA8 · gray + alpha'],[2,'IA4 · compact gray + alpha'],[1,'I8 · intensity = alpha'],[0,'I4 · intensity = alpha']],(v) => { format=+v; updateEstimate(); },'Texture format')));
  card.append(field('Mipmaps',selectInput(mipMode,[['keep','Keep count · rebuild'],['full','Full mip chain'],['none','Base level only']],(v) => { mipMode=v; updateEstimate(); },'Texture mipmaps')));
  const estimate = h('p',{class:'muted','aria-live':'polite'}), maxLevels = () => 1+Math.log2(Math.max(width,height));
  const levels = () => mipMode === 'full' ? maxLevels() : mipMode === 'none' ? 1 : Math.min(current.mipCount,maxLevels());
  function updateEstimate() {
    let w=width, hh=height, bytes=0; for (let i=0;i<levels();i++) { bytes+=wiiTextureLevelSize(w,hh,format); w=Math.max(1,w>>1); hh=Math.max(1,hh>>1); }
    estimate.textContent = `${width} × ${height} · ${WII_TEXTURE_FORMATS[format]} · ${levels()} levels · ${brresSize(bytes)}. `+(format === 4 ? 'Alpha will be removed.' : format === 5 ? 'Color and alpha precision will be reduced.' : format < 4 ? 'Converts color to grayscale.' : 'Full color and alpha.');
  }
  updateEstimate(); card.append(estimate);
  if ([8,9,10,14].includes(t.format)) card.append(h('p',{class:'muted'},'CMPR and indexed textures can be previewed. Applying changes converts them to the output format above. Compression and palette encoding are not available yet.'));
  card.append(h('button',{class:'btn primary',onclick:() => {
    try { BRED.changes.set(t.offset,prepareBRRESTexture(image,width,height,format,levels())); BRED.replacement=null; BRED.preview=null; BRED.error=''; refreshSheet(true); toast('Texture updated · save a BRRES copy to keep it'); } catch (e) { brresEditorError(e); }
  }},'Apply texture changes'));
  body.append(h('p',{class:'muted'},'Edits stay here until you save a copy; they are not stored in the modeling project. Archive layout is preserved, so smaller textures reduce texture memory but may not shrink the file. Models, shaders and animations remain unchanged.'));
}
$('#fileBRRES').addEventListener('change',async (event) => {
  const file=event.target.files[0]; event.target.value=''; if (!file) return;
  try { if (file.size > 128*1024*1024) throw new Error('BRRES files are limited to 128 MiB'); loadBRRESEditor(new Uint8Array(await file.arrayBuffer()),file.name); } catch (e) { brresEditorError(e); }
});
$('#fileBRRESTexture').addEventListener('change',async (event) => {
  const file=event.target.files[0], target=BRED.imageTarget; event.target.value=''; if (!file || !target) return;
  const url=URL.createObjectURL(file);
  try {
    if (file.size > 32*1024*1024) throw new Error('Replacement images are limited to 32 MiB');
    const im=await new Promise((resolve,reject) => { const img=new Image(); img.onload=() => resolve(img); img.onerror=() => reject(new Error('Could not read this image')); img.src=url; });
    if (Math.max(im.naturalWidth,im.naturalHeight) > 4096) throw new Error('Resize the replacement image to 4096 pixels or less first');
    const c=document.createElement('canvas'); c.width=im.naturalWidth; c.height=im.naturalHeight; const ctx=c.getContext('2d'); ctx.drawImage(im,0,0);
    if (BRED.archive !== target.archive || BRED.selected !== target.offset) return;
    BRED.replacement={offset:target.offset,image:{width:c.width,height:c.height,rgba:new Uint8Array(ctx.getImageData(0,0,c.width,c.height).data)}};
    BRED.error=''; refreshSheet(true);
  } catch (e) { brresEditorError(e); } finally { URL.revokeObjectURL(url); }
});
