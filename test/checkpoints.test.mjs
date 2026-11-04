import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {loadSrc} from './loadsrc.mjs';
const a=await loadSrc('kmp.js');
const start={position:[-3.2,-2.8,2],rotation:[0,45,0]};
const points=[
  {left:[-4,-4],right:[-2,-2],type:0},
  {left:[4,-4],right:[2,-2],type:1},
  {left:[4,4],right:[2,2],type:255},
  {left:[-4,4],right:[-2,2],type:2},
].map(p=>({...p,left:p.right,right:p.left,height:2,respawn:0,prev:255,next:255}));
const data={points,groups:[{start:0,count:4,prev:[0],next:[0],padding:0}],extra:[0,0],dirty:true};
a.relinkCheckpoints(data);
assert.deepEqual(points.map(p=>[p.prev,p.next]),[[255,1],[0,2],[1,3],[2,255]]);
assert.deepEqual(a.checkpointConnections(data),[[0,1],[1,2],[2,3],[3,0]]);
assert.deepEqual(a.checkpointWarnings(data),[],'Counterclockwise editor loop has forward, convex gates');
const out=a.exportKMP(start,{scale:100,checkpoints:data}),parsed=a.inspectKMP(out);
assert.deepEqual(parsed.checkpoints.points.map(p=>[p.left,p.right,p.type,p.respawn,p.prev,p.next]),points.map(p=>[[p.left[0]*100,-p.left[1]*100],[p.right[0]*100,-p.right[1]*100],p.type,0,p.prev,p.next]));
assert.equal(parsed.sections.find(s=>s.name==='CKPT').bytes.length,88);
assert.deepEqual(parsed.checkpoints.groups[0],{start:0,count:4,prev:[0,255,255,255,255,255],next:[0,255,255,255,255,255],padding:0});
const read=a.checkpointsFromKMP(parsed,100,2);
assert.deepEqual(read.points,points);assert.equal(read.dirty,false);
const saved=a.normalizeTrack({scale:100,start,checkpoints:data});
saved.checkpoints.points[0].left[0]=123;assert.equal(data.points[0].left[0],-2,'Save/undo data is a deep copy');
const baseline=a.exportKMP(start,{scale:100});
const untouched=a.exportKMP(start,{scale:100,template:out,checkpoints:read});
assert.deepEqual(untouched,out,'Viewing imported checkpoints does not rewrite their bytes');
read.points[1].right=[8,9];read.points[1].type=7;read.dirty=true;
const patched=a.inspectKMP(a.exportKMP(start,{scale:100,template:out,checkpoints:read}));
for(const s of parsed.sections)if(!['KTPT','CKPT','CKPH'].includes(s.name))assert.deepEqual(s.bytes,patched.sections.find(t=>t.name===s.name).bytes);
assert.deepEqual(patched.checkpoints.points[1].right,[800,-900]);assert.equal(patched.checkpoints.points[1].type,7);
assert.deepEqual(patched.sections.find(s=>s.name==='CKPH').bytes,parsed.sections.find(s=>s.name==='CKPH').bytes);
const branch=a.cloneCheckpoints(data);
branch.groups=[{start:0,count:2,prev:[1],next:[1],padding:123},{start:2,count:2,prev:[0],next:[0],padding:456}];branch.extra=[12,34];a.relinkCheckpoints(branch);
const branchParsed=a.inspectKMP(a.exportKMP(start,{scale:100,template:baseline,checkpoints:branch}));
assert.deepEqual(branchParsed.checkpoints.extra,[12,34]);
assert.deepEqual(branchParsed.checkpoints.groups.map(g=>[g.start,g.count,g.prev[0],g.next[0],g.padding]),[[0,2,1,1,123],[2,2,0,0,456]]);
// Insert in the first group and preserve the second group's route links.
branch.points.splice(1,0,structuredClone(branch.points[0]));branch.groups[0].count++;a.relinkCheckpoints(branch);
assert.equal(branch.groups[1].start,3);assert.equal(branch.points[3].prev,255);
assert.equal(a.inspectKMP(a.exportKMP(start,{template:baseline,checkpoints:branch})).checkpoints.points.length,5);
const unsorted=a.cloneCheckpoints(data);
unsorted.groups=[{start:2,count:2,prev:[1],next:[1],padding:0},{start:0,count:2,prev:[0],next:[0],padding:0}];
unsorted.points.splice(1,0,structuredClone(unsorted.points[0]));unsorted.groups[1].count++;a.relinkCheckpoints(unsorted);
assert.deepEqual(unsorted.groups.map(g=>[g.start,g.count,g.next]),[[3,2,[1]],[0,3,[0]]],'Inserting into out-of-order groups preserves group indices and membership');
assert.deepEqual(a.checkpointConnections(unsorted),[[3,4],[4,0],[0,1],[1,2],[2,3]]);
const bad=a.cloneCheckpoints(data);bad.points[0].respawn=1;
assert.throws(()=>a.exportKMP(start,{checkpoints:bad}),/respawn/);
bad.points[0].respawn=0;bad.points[0].left=bad.points[0].right.slice();assert.throws(()=>a.exportKMP(start,{checkpoints:bad}),/apart/);
bad.points[0].left=[1e300,0];assert.throws(()=>a.exportKMP(start,{checkpoints:bad}),/number range/);
const short=out.slice();new DataView(short.buffer).setUint16(parsed.sections.find(s=>s.name==='CKPT').offset+4,100);assert.throws(()=>a.inspectKMP(short),/Truncated CKPT/);
const flip=a.cloneCheckpoints(data);[flip.points[1].left,flip.points[1].right]=[flip.points[1].right,flip.points[1].left];assert.ok(a.checkpointWarnings(flip).some(s=>s.includes('backward')));
const gap=a.cloneCheckpoints(data);gap.points[3].type=7;assert.ok(a.checkpointWarnings(gap).some(s=>s.includes('gaps')));
for(const name of ['luigi_circuit.kmp','strobenz.kmp']){
  const path='../RiiStudio/tests/samples/'+name;if(!fs.existsSync(path))continue;
  const bytes=new Uint8Array(fs.readFileSync(path)),imported=a.inspectKMP(bytes),cp=a.checkpointsFromKMP(imported,100,0);
  const st={position:a.trackFromWii(imported.start.position,100),rotation:imported.start.rotation};
  assert.deepEqual(a.exportKMP(st,{scale:100,template:bytes,checkpoints:cp}),bytes);
  cp.points[0].left[0]+=.25;cp.dirty=true;
  const edited=a.inspectKMP(a.exportKMP(st,{scale:100,template:bytes,checkpoints:cp}));
  for(const s of imported.sections)if(s.name!=='CKPT')assert.deepEqual(edited.sections.find(t=>t.name===s.name).bytes,s.bytes,name+' '+s.name);
}
fs.mkdirSync('work',{recursive:true});fs.writeFileSync('work/checkpoint-course.kmp',out);
if(process.env.WIIMM_BIN){
  // Fit the test fixture's temporary enemy/item routes to this small loop.
  // The editor deliberately preserves those independent route sections.
  const aligned=out.slice(),v=new DataView(aligned.buffer);
  for(const name of ['ENPT','ITPT']) {
    const section=parsed.sections.find(s=>s.name===name);
    [[0,-3],[3,0],[0,3],[-3,0]].forEach((p,i)=>[p[0]*100,200,-p[1]*100].forEach((n,j)=>v.setFloat32(section.offset+8+i*20+j*4,n)));
  }
  fs.writeFileSync('work/checkpoint-fixture-aligned.kmp',aligned);
  const result=execFileSync(process.env.WIIMM_BIN+'/wkmpt',['check','work/checkpoint-fixture-aligned.kmp'],{encoding:'utf8'});console.log(result.trim());
}
console.log('Checkpoint axes/scale/types/direction, group sequences and links, binary round trip, imported section preservation, undo cloning, malformed data and route diagnostics passed');
