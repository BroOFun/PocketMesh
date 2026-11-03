import assert from 'node:assert/strict';
import {loadSrc} from './loadsrc.mjs';
const {inset, newMesh, cloneMesh, faceArea, faceNormal, topo, primGrid} = await loadSrc('mesh.js');
const polygon = points => {
  const m=newMesh(); m.verts=points.map(p=>[...p,0]);
  m.faces=[{v:points.map((_,i)=>i), uv:points.map(([x,y])=>[x*.3+2,y*.4-1]), mat:3}];
  m.seams.add('0_1'); m.creases.add('0_1'); return m;
};
function check(m, area, sign=1) {
  assert.ok(Math.abs(m.faces.reduce((s,f)=>s+faceArea(m,f),0)-area)<1e-8, 'Inset tiles the original surface');
  for (const f of m.faces) {
    assert.equal(f.v.length,f.uv.length); assert.equal(new Set(f.v).size,f.v.length);
    assert.ok(faceArea(m,f)>1e-12); assert.ok(faceNormal(m,f)[2]*sign>.999);
    assert.equal(f.mat,3);
    f.v.forEach((v,i)=>{
      assert.ok(Math.abs(f.uv[i][0]-(m.verts[v][0]*.3+2))<1e-8,'U follows the original texture');
      assert.ok(Math.abs(f.uv[i][1]-(m.verts[v][1]*.4-1))<1e-8,'V follows the original texture');
    });
  }
  assert.ok(topo(m).edgeFaces.every(fs=>fs.length<=2));
  assert.ok(m.seams.has('0_1')); assert.ok(m.creases.has('0_1'));
}
const shapes=[
  [[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]], // concave L
  [[0,0],[3,0],[3,3],[2,3],[2,1],[1,1],[1,3],[0,3]], // narrow U
  [[0,0],[1,0],[2,0],[2,2],[1,2],[0,2]], // collinear knife corners
  Array.from({length:9},(_,i)=>[2*Math.cos(i*Math.PI*2/9),2*Math.sin(i*Math.PI*2/9)]),
  [[0,0],[4,0],[.1,.5],[-.1,.5],[-.5,.2]], // acute corner
];
for (const points of shapes) for (const reverse of [false,true]) {
  const m=polygon(reverse ? [...points].reverse():points), area=faceArea(m,m.faces[0]), n=points.length;
  const r=inset(m,new Set([0]),.025);
  assert.equal(r.clamped,false); assert.equal(m.faces[0].v.length,n,'Inner n-gon remains an n-gon');
  assert.equal(m.faces.length,n+1); assert.equal(m.verts.length,2*n); check(m,area,reverse?-1:1);
  const large=polygon(reverse?[...points].reverse():points);
  assert.equal(inset(large,new Set([0]),100).clamped,true); check(large,area,reverse?-1:1);
}
const noop=polygon(shapes[0]), before=cloneMesh(noop);
inset(noop,new Set([0]),0); assert.deepEqual(noop,before,'Opening Inset adds no zero-area geometry');
const depth=polygon(shapes[0]); inset(depth,new Set([0]),.1,.7);
for(const v of depth.faces[0].v) assert.equal(depth.verts[v][2],.7);
for(const [i,v] of depth.faces[0].v.entries()) assert.ok(Math.abs(depth.faces[0].uv[i][0]-(depth.verts[v][0]*.3+2))<1e-10);
// Region vs Individual retains the existing shared-boundary behavior.
for(const individual of [false,true]) {
  const m=primGrid({xSub:2,ySub:1}); inset(m,new Set([0,1]),.1,0,individual);
  assert.equal(m.faces.length,individual?10:8);
  assert.ok(topo(m).edgeFaces.every(fs=>fs.length<=2));
}
console.log('Inset: convex/concave n-gons, collinear corners, overlap limit, UVs, winding, depth, region/individual and zero-distance passed');
