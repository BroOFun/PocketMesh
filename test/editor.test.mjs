import assert from 'node:assert/strict';
import { loadSrc } from './loadsrc.mjs';
const m = await loadSrc('mesh.js','export.js','brres.js','brres_edit.js','measure.js');
const {inspectBRRES,decodeBRRESTexture,prepareBRRESTexture,saveBRRESEdits,encodeWiiTexture,wiiTextureLevelSize,resizeTexturePixels} = m;
const pixels = new Uint8Array(16*8*4);
for (let i=0;i<128;i++) pixels.set([i*2,255-i,i,i%7===0?0:255],i*4);
const materials = ['Road','Curb'].map((name) => ({name,color:[1,1,1],texture:{name,width:16,height:8,bytes:new Uint8Array([1]),rgba:pixels}}));
const mesh=m.primCube(); mesh.faces[0].mat=1;
const original=m.exportBRRES({objects:[{name:'Track',mesh,materials:[0,1]}],materials})[0].data;
const a=inspectBRRES(original), tex=a.textures[0];
const pooled=Buffer.alloc(original.length+16); pooled.set(original,7);
assert.equal(inspectBRRES(pooled.subarray(7,7+original.length)).textures.length,2,'typed-array byte offset');
assert.equal(a.resources[0].type,'MDL0'); assert.deepEqual(a.resources[0].materials,['Road','Curb']);
assert.equal(a.textures.length,2); assert.deepEqual(decodeBRRESTexture(a,tex).rgba,pixels);
assert.deepEqual(saveBRRESEdits(a,new Map()),original,'unchanged archive is byte-identical');
const edits=new Map([[tex.offset,prepareBRRESTexture(decodeBRRESTexture(a,tex),8,4,5,4)],[a.textures[1].offset,prepareBRRESTexture(decodeBRRESTexture(a,a.textures[1]),64,32,6,7)]]);
const saved=saveBRRESEdits(a,edits), b=inspectBRRES(saved);
assert.equal(b.textures[0].offset,tex.offset,'smaller texture updated in place');
assert.ok(b.textures[1].offset>=original.length,'larger texture appended');
assert.deepEqual(b.textures.map(t=>[t.name,t.width,t.height,t.format,t.mipCount]),[['Road',8,4,5,4],['Curb',64,32,6,7]]);
const model=a.resources[0]; assert.deepEqual(saved.slice(model.offset,model.offset+model.size),original.slice(model.offset,model.offset+model.size),'model/shader bytes preserved');
assert.deepEqual(a.bytes,original,'input stays immutable');
assert.equal(decodeBRRESTexture(b,b.textures[1],null,6).rgba.length,4);
assert.deepEqual(saveBRRESEdits(a,edits),saved,'repeated saves are deterministic');
// Fixed, independent pixel expectations for every supported encoding.
function raw(format,width,height,bytes,palette) {
 const t={format,width,height,offset:0,dataOffset:0,encodedSize:bytes.length,mipCount:1,name:'test'};
 return decodeBRRESTexture({bytes,textures:[t],palettes:palette?[palette]:[]},t,palette);
}
for (const format of [0,1,2,3,4,5,6]) {
 const rgba=new Uint8Array(8*8*4); for(let i=0;i<64;i++)rgba.set([255,0,0,255],i*4);
 const bytes=encodeWiiTexture(rgba,8,8,format), image=raw(format,8,8,bytes);
 const expected={0:[68,68,68,68],1:[76,76,76,76],2:[68,68,68,255],3:[76,76,76,255],4:[255,0,0,255],5:[255,0,0,255],6:[255,0,0,255]}[format];
 for(let i=0;i<64;i++)assert.deepEqual(Array.from(image.rgba.slice(i*4,i*4+4)),expected,`format ${format} pixel ${i}`);
}
const alphaPixel=raw(5,1,1,new Uint8Array([0x3f,0x08,...Array(30).fill(0)]));
assert.deepEqual(Array.from(alphaPixel.rgba),[255,0,136,109]);
for (const format of [8,9,10]) {
 const bytes=new Uint8Array(36); bytes[0]=format===8?0x10:format===9?1:0; if(format===10)bytes[1]=1;
 bytes.set([0,0,0xf8,0],32);
 const image=raw(format,1,1,bytes,{offset:32,dataOffset:0,entries:2,format:1});
 assert.deepEqual(Array.from(image.rgba),[255,0,0,255]);
}
const cmpr=new Uint8Array(32); for(let i=0;i<4;i++)cmpr.set([0xf8,0,0x07,0xe0,0x1b,0x1b,0x1b,0x1b],i*8);
const cmprPixels=raw(14,8,8,cmpr).rgba;
assert.deepEqual(Array.from(cmprPixels.slice(0,16)),[255,0,0,255,0,255,0,255,159,95,0,255,95,159,0,255]);
const transparent=new Uint8Array(32); transparent.set([0,0,255,255,255,255,255,255]);
assert.equal(raw(14,1,1,transparent).rgba[3],0);
assert.throws(()=>raw(8,1,1,new Uint8Array(32)),/palette/);
const filtered=resizeTexturePixels({width:2,height:1,rgba:new Uint8Array([255,0,0,0,0,255,0,255])},1,1);
assert.deepEqual(Array.from(filtered.rgba),[0,255,0,128],'resizing preserves alpha without transparent-color fringes');
assert.equal(wiiTextureLevelSize(1,1,6),64); assert.equal(wiiTextureLevelSize(9,9,14),128);
assert.throws(()=>prepareBRRESTexture(filtered,3,1),/power-of-two/);
assert.throws(()=>prepareBRRESTexture(filtered,1,1,6,2),/mipmap/);
assert.throws(()=>saveBRRESEdits(a,new Map([[tex.offset,{...edits.get(tex.offset),data:new Uint8Array(1)}]])),/encoded/);
// User metadata is deliberately read-only; damaged offsets and lengths fail safely.
const metadata=original.slice();new DataView(metadata.buffer).setUint32(tex.offset+52,64);
const readonly=inspectBRRES(metadata);assert.equal(readonly.textures[0].editable,false);
assert.throws(()=>saveBRRESEdits(readonly,edits),/read-only/);
for (const [at,value] of [[8,original.length+1],[28,0xffffffff],[tex.offset+16,0xffffffff],[tex.offset+36,0xffffffff]]) {
 const bad=original.slice();new DataView(bad.buffer).setUint32(at,value);assert.throws(()=>inspectBRRES(bad));
}
assert.throws(()=>inspectBRRES(original.subarray(0,64)),/Truncated/);
assert.throws(()=>inspectBRRES(new Uint8Array(32)),/brres/);
assert.deepEqual(m.normalizeRuler(),{metersPerUnit:1,unit:'m',snap:true,measurements:[]});
assert.equal(m.measurementMeters([0,0,0],[3,4,0]),5); assert.equal(m.measurementMeters([0,0,0],[300,400,0],.01),5);
assert.equal(m.formatMeasurement(5),'5 m');assert.equal(m.formatMeasurement(.25,'cm'),'25 cm');assert.equal(m.formatMeasurement(.3048,'ft'),'1 ft');
assert.equal(m.perspectiveEdgeParameter(.5,2,8),.2);
assert.deepEqual(m.normalizeRuler({metersPerUnit:-2,measurements:[{a:[0,0,NaN],b:[1,2,3]}]}).measurements,[]);
if (process.env.NOCLIP_PARSER) {
 const {parse,ArrayBufferSlice}=await import(process.env.NOCLIP_PARSER);
 const parsed=parse(new ArrayBufferSlice(saved.buffer));
 assert.deepEqual(parsed.tex0.map(t=>[t.name,t.width,t.height,t.format,t.mipCount]),[['Road',8,4,5,4],['Curb',64,32,6,7]]);
 assert.equal(parsed.mdl0[0].shapes.reduce((n,s)=>n+s.loadedVertexData.totalIndexCount,0),36);
 console.log('noclip independently parsed edited textures, mipmaps and untouched model');
}
console.log('Ruler units/perspective; BRRES inspection, all 11 texture decoders, 7 encoders, resizing, mipmaps, preservation and invalid-file handling passed');
