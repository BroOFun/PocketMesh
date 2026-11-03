// Optional compatibility checks against an external RiiStudio checkout. No sample assets are bundled.
import fs from 'node:fs';
import {loadSrc} from './loadsrc.mjs';
if (!process.env.RIISTUDIO_SAMPLES || !process.env.NOCLIP_PARSER) throw new Error('Set RIISTUDIO_SAMPLES to a sample directory and NOCLIP_PARSER to the bundled noclip parser');
const {parse,ArrayBufferSlice}=await import(process.env.NOCLIP_PARSER);
const m=await loadSrc('brres_edit.js');
const dir=process.env.RIISTUDIO_SAMPLES;
for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.brres'))) {
 try {
  const a=m.inspectBRRES(fs.readFileSync(dir+'/'+name));let decoded=0,skipped=[];const edits=new Map();
  for(const t of a.textures)try{const image=m.decodeBRRESTexture(a,t);decoded++;if(t.editable)edits.set(t.offset,m.prepareBRRESTexture(image,16,16,6,5));}catch(e){skipped.push(t.name+': '+e.message);}
  const out=m.saveBRRESEdits(a,edits); m.inspectBRRES(out);
  for(const r of a.resources.filter(r=>r.type!=='TEX0'))if(Buffer.compare(a.bytes.slice(r.offset,r.offset+r.size),out.slice(r.offset,r.offset+r.size)))throw Error('Changed '+r.type);
  let noclip='ok';try{parse(new ArrayBufferSlice(a.bytes.buffer));}catch(e){noclip='original unsupported';}
  if(noclip==='ok')parse(new ArrayBufferSlice(out.buffer));
  console.log(JSON.stringify({name,resources:a.resources.length,textures:a.textures.length,formats:[...new Set(a.textures.map(t=>t.formatName))],decoded,skipped,noclip}));
 }catch(e){console.log(JSON.stringify({name,error:e.message,stack:e.stack.split('\n').slice(0,2)}));process.exitCode=1;}
}
