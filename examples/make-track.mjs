// Original, procedural model for testing the BRRES exporter. No game assets.
// Run from the repo root: node examples/make-track.mjs [output-directory]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {loadSrc} from '../test/loadsrc.mjs';
const {exportBRRES} = await loadSrc('export.js', 'brres.js');
const out = process.argv[2] || 'work/track-example';
fs.mkdirSync(out, {recursive: true});
const n = 64;
function ring(name, inside, outside, z, slots, alternate = false) {
  const verts = [], faces = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2 * Math.PI / n;
    for (const r of [inside, outside]) verts.push([Math.cos(a)*r, Math.sin(a)*r, z]);
  }
  for (let i = 0; i < n; i++) faces.push({v:[i*2,i*2+1,(i*2+3)%(n*2),(i*2+2)%(n*2)],uv:[[0,i/4],[1,i/4],[1,(i+1)/4],[0,(i+1)/4]],mat:alternate ? i%2 : 0});
  return {name,mesh:{verts,faces,looseEdges:[],seams:new Set(),smooth:false},position:[0,0,0],quaternion:[0,0,0,1],scale:[1,1,1],materials:slots};
}
const rgba = new Uint8Array(64*64*4);
for(let y=0;y<64;y++) for(let x=0;x<64;x++) {
  const line = x>=30 && x<34 && y<40;
  const color = line ? [250,213,50,255] : [65+(x+y)%3,68+(x+y)%3,73+(x+y)%3,255];
  rgba.set(color,(y*64+x)*4);
}
// Small dependency-free PNG encoder for the companion editable project.
function crc(bytes) {let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(tag,bytes) {const name=Buffer.from(tag),data=Buffer.from(bytes),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);name.copy(b,4);data.copy(b,8);b.writeUInt32BE(crc(Buffer.concat([name,data])),8+data.length);return b;}
const header=Buffer.alloc(13);header.writeUInt32BE(64,0);header.writeUInt32BE(64,4);header[8]=8;header[9]=6;
const scan=Buffer.alloc(64*(64*4+1));for(let y=0;y<64;y++)scan.set(rgba.slice(y*256,(y+1)*256),y*257+1);
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(scan)),chunk('IEND',[])]);
const linear=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
const specs=[['Road','#ffffff'],['CurbRed','#df3c35'],['CurbWhite','#eeeeee'],['Grass','#69a342']];
const materials=specs.map(([name,hex],i)=>({name,color:[1,3,5].map(k=>linear(parseInt(hex.slice(k,k+2),16)/255)),alpha:1,alphaMode:'opaque',doubleSided:false,wrap:'repeat',texture:i===0?{name:'road.png',width:64,height:64,mime:'image/png',bytes:png,rgba,filter:'nearest'}:null}));
const objects=[ring('Road',21,29,.1,[0]),ring('InnerCurb',20,21,.12,[1,2],true),ring('OuterCurb',29,30,.12,[1,2],true),ring('Grass',.01,38,0,[3])];
const file=exportBRRES({objects,materials},{baseName:'course_model',scale:100})[0];
fs.writeFileSync(path.join(out,file.name),file.data);
const project={app:'PocketMesh',version:1,objects:objects.map((o,i)=>({id:i+1,name:o.name,pos:o.position,quat:o.quaternion,scl:o.scale,mesh:{...o.mesh,seams:[]},materials:o.materials.map(j=>j+1),modifiers:[],visible:true,selected:i===0})),materials:materials.map((m,i)=>({id:i+1,name:m.name,color:specs[i][1],alpha:1,roughness:.8,metalness:0,shader:'unlit',alphaMode:'opaque',doubleSided:false,texture:i===0?1:null,useTexture:i===0,tint:false,filter:'nearest',wrap:'repeat'})),images:[{id:1,name:'road.png',mime:'image/png',data:png.toString('base64')}],active:1,cursor:[0,0,0],camera:{target:[0,0,0],yaw:.6,pitch:.8,dist:105,ortho:false},settings:{shading:'material',selectMode:'face',pivot:'median',orient:'global'}};
fs.writeFileSync(path.join(out,'example-track.pocketmesh.json'),JSON.stringify(project));
console.log(`Wrote ${file.name} (${file.data.length} bytes) and editable project to ${out}. Model preview only; no KCL/KMP/SZS.`);
