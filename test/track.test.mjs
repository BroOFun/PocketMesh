import assert from 'node:assert/strict';
import { loadSrc } from './loadsrc.mjs';
const {primCube, primPlane, subdivisionSurface, evaluateModifiers, topo, importMTL, exportBRRES, encodeWiiRGBA8, normalizeModifiers} = await loadSrc('mesh.js','modifiers.js','materials.js','export.js','brres.js');
const cube=primCube(), original=JSON.stringify(cube);
cube.seams.clear(); cube.seams.add('0_1'); cube.faces[0].mat=2;
const smooth=subdivisionSurface(cube,1);
assert.equal(smooth.verts.length,26); assert.equal(smooth.faces.length,24);
assert.equal(topo(smooth).edgeFaces.filter(f=>f.length!==2).length,0);
assert.equal(smooth.faces.filter(f=>f.mat===2).length,4); assert.equal(smooth.seams.size,2);
assert.ok(smooth.verts.slice(0,8).every(p=>p.every(v=>Math.abs(Math.abs(v)-5/9)<1e-10)));
assert.equal(subdivisionSurface(primPlane(),1).faces.length,4);
assert.deepEqual(subdivisionSurface(cube,1,'simple').verts.slice(0,8),cube.verts);
assert.equal(evaluateModifiers(cube,[{type:'subdivision',levels:2,enabled:false}]),cube);
assert.throws(()=>subdivisionSurface(cube,4),/levels/);
assert.deepEqual(normalizeModifiers(null),[]);
assert.deepEqual(normalizeModifiers([{type:'subdivision',levels:999}])[0].levels,3);
assert.equal(JSON.stringify(primCube()),original);
const mtl=importMTL('newmtl Asphalt\nKd .2 .3 .4\nd .5\nNs 50\nmap_Kd road surface.png\nnewmtl Grass\nTr .25\nmap_Kd -s 2 2 1 grass.png');
assert.equal(mtl.materials[0].image,'road surface.png'); assert.equal(mtl.materials[1].alpha,.75); assert.equal(mtl.warnings.length,1);
assert.throws(()=>importMTL('newmtl Broken\nKd x 0 0'),/color/);
const pixels=new Uint8Array(8*4*4); for(let i=0;i<32;i++) pixels.set([i,100+i,200-i,255-i],i*4);
const tiled=encodeWiiRGBA8(pixels,8,4);
// Independent decode, checking every texel across the two tiles.
for(let y=0;y<4;y++) for(let x=0;x<8;x++) { const block=Math.floor(x/4)*64, q=(y*4+x%4)*2, p=(y*8+x)*4;
 assert.deepEqual([tiled[block+q+1],tiled[block+q+32],tiled[block+q+33],tiled[block+q]],Array.from(pixels.slice(p,p+4))); }
assert.throws(()=>encodeWiiRGBA8(pixels,3,4),/power-of-two/);
const materials=['A','AA','a','Grass','Road'].map((name,i)=>({name,color:[1,.2,.4],alpha:1,alphaMode:i===1?'blend':i===2?'cutout':'opaque',wrap:i===1?'extend':'repeat',texture:{name:'Road.png',filter:i===0?'nearest':'linear',width:8,height:4,bytes:new Uint8Array([1]),rgba:pixels}}));
const mesh=primCube();mesh.faces.forEach((f,i)=>f.mat=i%materials.length);
const scene={objects:[{name:'Track',mesh,materials:[0,1,2,3,4],position:[10,20,30],scale:[-2,2,2]}],materials};
const file=exportBRRES(scene,{baseName:'course_model'} )[0];
const dv=new DataView(file.data.buffer), read=(p)=>{let s='';while(file.data[p])s+=String.fromCharCode(file.data[p++]);return s;};
assert.equal(read(0).slice(0,4),'bres');assert.equal(dv.getUint32(8),file.data.length);assert.equal(file.data.length%128,0);
// Validate resource dictionary search links, not just sequential enumeration.
function dictionary(at) { const count=dv.getUint32(at+4), entries=[];
 for(let i=1;i<=count;i++){ const p=at+8+16*i,name=read(at+dv.getUint32(p+8)),target=at+dv.getUint32(p+12); entries.push({name,target});
 let prev=0,node=dv.getUint16(at+12),steps=0;
 while(dv.getUint16(at+8+prev*16)>dv.getUint16(at+8+node*16)){
  assert.ok(++steps<=count+1,'dictionary cycle'); prev=node; const bit=dv.getUint16(at+8+node*16), right=((name.charCodeAt(bit>>>3)||0) >>>(bit&7))&1;
  node=dv.getUint16(at+8+node*16+(right?6:4)); assert.ok(node<=count);
 }
 assert.equal(node,i,'dictionary lookup: '+name);
 }
 return entries;
}
const root=dictionary(24), model=dictionary(root[0].target)[0].target;
assert.equal(dv.getUint32(model+8),11);
for(let i=0;i<13;i++){const off=dv.getUint32(model+16+i*4);if(off)dictionary(model+off);}
const textures=dictionary(root[1].target);assert.equal(textures.length,1);
assert.equal(read(textures[0].target).slice(0,4),'TEX0');
assert.throws(()=>exportBRRES({objects:[],materials:[]}),/face/);
assert.throws(()=>exportBRRES(scene,{scale:0}),/scale/);
assert.throws(()=>encodeWiiRGBA8(new Uint8Array(2),4,4),/pixels/);
const triangle={v:[0,1,2],uv:[[.2,.3],[.2,.3],[.2,.3]],mat:0};
const large=exportBRRES({objects:[{name:'Large',mesh:{verts:[[0,0,0],[1,0,0],[0,1,0]],faces:Array(20001).fill(triangle),looseEdges:[],seams:new Set()}}],materials:[]})[0];
// Optional independent parser from an unmodified noclip checkout.
if(process.env.NOCLIP_PARSER){
 const {parse,ArrayBufferSlice}=await import(process.env.NOCLIP_PARSER);
 const parsed=parse(new ArrayBufferSlice(file.data.buffer));const m=parsed.mdl0[0];
 assert.equal(m.name,'course');assert.equal(m.shapes.length,5);assert.equal(m.materials.length,5);assert.equal(parsed.tex0.length,1);
 assert.equal(m.shapes.reduce((n,s)=>n+s.loadedVertexData.totalIndexCount,0),36);
 assert.equal(m.sceneGraph.drawXluOps.length,1);
 assert.equal(m.materials[2].gxMaterial.alphaTest.compareA,6);
 assert.equal(m.materials[0].gxMaterial.texGens[0].source,4); // GX TEX0
 assert.equal(m.materials[0].samplers[0].name,'Road');
 assert.equal(m.materials[0].samplers[0].magFilter,0);assert.equal(m.materials[1].samplers[0].magFilter,1);
 assert.equal(m.materials[0].samplers[0].wrapS,1);assert.equal(m.materials[1].samplers[0].wrapS,0);
 assert.ok(m.materials.every(m=>m.gxMaterial.tevStages.length===1));
 assert.deepEqual(Array.from(m.bbox.min),[8,28,-22]);
 assert.deepEqual(Array.from(m.bbox.max),[12,32,-18]);
 // Read the independently decoded vertex stream: mirrored transforms must retain outward winding.
 for(const shape of m.shapes) {
  const layout=shape.loadedVertexLayout, stride=layout.vertexBufferStrides[0], offsets=layout.vertexAttributeOffsets;
  const view=new DataView(shape.loadedVertexData.vertexBuffers[0]);
  const vec=(i,attr)=>[0,1,2].map(k=>view.getFloat32(i*stride+offsets[attr]+k*4,true));
  for(let i=0;i<shape.loadedVertexData.totalVertexCount;i+=3){
   const p=[vec(i,9),vec(i+1,9),vec(i+2,9)],n=vec(i,10),a=p[1].map((v,k)=>v-p[0][k]),b=p[2].map((v,k)=>v-p[0][k]);
   const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
   assert.ok(cross.reduce((v,x,k)=>v+x*n[k],0)>0,'outward mirrored winding');
  }
 }
 const split=parse(new ArrayBufferSlice(large.data.buffer)).mdl0[0];
 assert.deepEqual(split.shapes.map(s=>s.loadedVertexData.totalIndexCount),[60000,3]);
 const shape=split.shapes[1],uvOffset=shape.loadedVertexLayout.vertexAttributeOffsets[13],uv=new DataView(shape.loadedVertexData.vertexBuffers[0]);
 assert.ok(Math.abs(uv.getFloat32(uvOffset,true)-.2)<1e-6);assert.ok(Math.abs(uv.getFloat32(uvOffset+4,true)-.7)<1e-6);
 console.log('noclip independent BRRES parser passed (materials, textures, transforms, winding, UVs, 16-bit split)');
}
console.log('Subdivision, material import, tiled textures and BRRES dictionaries passed');
