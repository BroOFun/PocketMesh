import assert from 'node:assert/strict';
import {loadSrc} from './loadsrc.mjs';
import {loadExport} from './load-export.cjs';
const {triangulatePolygon2D: tri2, triangulatePolygon: tri3, triangulateFace, triangulateFaces} = await loadSrc('mesh.js');
const exportTri = loadExport().api._private._exTriangulate;
const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const key = (a,b) => a<b ? `${a}_${b}` : `${b}_${a}`;
const area = P => P.reduce((s,a,i)=>s+cross([0,0],a,P[(i+1)%P.length]),0);
const inside = (P,p) => {
  let result=false;
  for(let i=0,j=P.length-1;i<P.length;j=i++) {
    const a=P[i],b=P[j];
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) result=!result;
  }
  return result;
};
function validate(P, tris) {
  assert.equal(tris.length,P.length-2,'Exactly n-2 triangles');
  const edges=new Map(), direction=Math.sign(area(P)); let sum=0;
  for(const t of tris) {
    assert.equal(new Set(t).size,3);
    assert.ok(t.every(v=>Number.isInteger(v)&&v>=0&&v<P.length));
    const A=cross(...t.map(i=>P[i])); assert.ok(A*direction>1e-12,'Nondegenerate, original winding'); sum+=A;
    assert.ok(inside(P,[0,1].map(k=>t.reduce((s,i)=>s+P[i][k],0)/3)),'Triangle stays inside concave boundary');
    t.forEach((a,i)=>{const b=t[(i+1)%3],k=key(a,b); edges.set(k,(edges.get(k)||0)+1);});
  }
  assert.ok(Math.abs(sum-area(P))<1e-9,'Exact polygon coverage');
  const boundary=new Set(P.map((_,i)=>key(i,(i+1)%P.length)));
  for(const k of boundary) assert.equal(edges.get(k),1,'Every original boundary segment survives');
  for(const [k,count] of edges) assert.equal(count,boundary.has(k)?1:2,'Manifold triangulation');
  const segments=[...edges.keys()].map(k=>k.split('_').map(Number));
  for(const [a,b] of segments) {
    for(let c=0;c<P.length;c++) if(c!==a&&c!==b) {
      const dot=(P[c][0]-P[a][0])*(P[c][0]-P[b][0])+(P[c][1]-P[a][1])*(P[c][1]-P[b][1]);
      assert.ok(Math.abs(cross(P[a],P[b],P[c]))>1e-12 || dot>=-1e-12,'No corner bypassed by a diagonal / T-junction');
    }
    for(const [c,d] of segments) if(new Set([a,b,c,d]).size===4)
      assert.ok(!(cross(P[a],P[b],P[c])*cross(P[a],P[b],P[d])<-1e-12 && cross(P[c],P[d],P[a])*cross(P[c],P[d],P[b])<-1e-12),'No crossing diagonals');
  }
}
const polygons = [
  [[0,0],[2,0],[2,1],[1,1],[1,2],[0,2]],
  [[0,0],[3,0],[3,3],[2,3],[2,1],[1,1],[1,3],[0,3]],
  [[0,0],[6,0],[6,1],[5,1],[5,3],[4,3],[4,1],[3,1],[3,3],[2,3],[2,1],[1,1],[1,3],[0,3]],
  [[0,0],[5,0],[5,5],[1,5],[1,2],[3,2],[3,3],[2,3],[2,4],[4,4],[4,1],[0,1]],
  [[0,0],[1,0],[2,0],[2,1],[2,2],[1,2],[0,2],[0,1]],
  [[0,0],[1,0],[2,0],[0,2]],
  Array.from({length:14},(_,i)=>{const a=i*Math.PI/7,r=i%2?.4:1; return [r*Math.cos(a),r*Math.sin(a)];}),
];
for(const outline of polygons) for(const P of [outline,outline.slice().reverse()]) {
  validate(P,tri2(P));
  for(const [scale,offset] of [[1,0],[1e-9,0],[1e6,1e10],[1,1e8]]) {
    const points=P.map(([x,y])=>[offset+scale*x,offset+scale*y,offset]);
    validate(P,tri3(points));
    assert.deepEqual(exportTri(points),triangulateFace({verts:points},{v:P.map((_,i)=>i)}),'Rendering, editing and export share triangles');
  }
  const points=P.map(([x,y])=>[x/Math.sqrt(2)+y/Math.sqrt(6),-x/Math.sqrt(2)+y/Math.sqrt(6),-2*y/Math.sqrt(6)]);
  validate(P,tri3(points));
}
let seed=3951;
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
for(let trial=0;trial<100;trial++) {
  const n=5+Math.floor(random()*25);
  const P=Array.from({length:n},(_,i)=>{const a=(i+.3*random())*2*Math.PI/n,r=.2+random()*2;return [Math.cos(a)*r,Math.sin(a)*r];});
  validate(P,tri2(P));
}
for(const bad of [
  [[0,0],[2,2],[0,2],[2,0]], // crossing
  [[0,0],[3,0],[1,2],[1,-1],[3,2]], // crossing with nonzero area
  [[0,0],[2,0],[2,0],[0,2]], // duplicate corner
  [[0,0],[1,0],[2,0],[3,0]], // zero area
  [[0,0],[2,0],[2,2],[1,0],[0,2]], // boundary touches itself
]) {
  assert.deepEqual(tri2(bad),[]);
  assert.deepEqual(tri3(bad.map(([x,y])=>[x,y,0])),[]);
}
assert.deepEqual(tri3([[0,0,0],[1,0,0],[NaN,1,0],[0,1,0]]),[]);
const minAngle=(P,T)=>Math.min(...T.flatMap(t=>t.map((v,i)=>{
  const a=P[t[(i+1)%3]].map((x,k)=>x-P[v][k]),b=P[t[(i+2)%3]].map((x,k)=>x-P[v][k]);
  return Math.acos(Math.max(-1,Math.min(1,(a[0]*b[0]+a[1]*b[1])/(Math.hypot(...a)*Math.hypot(...b)))));
})));
const quality=[[0,0],[5,0],[5,1],[4,2],[1,3],[0,2]];
assert.ok(minAngle(quality,tri2(quality))>1.6*minAngle(quality,[[5,0,1],[5,1,2],[5,2,3],[3,4,5]]),'Improve skinny ears by flipping interior diagonals');
const quad=[[1.4,1.9],[-.62,.83],[-1.29,-.62],[1.31,-2.36]];
assert.deepEqual(tri2(quad),[[0,1,3],[1,2,3]],'Choose better triangle angles over the shortest diagonal');
const verts=polygons[0].map(([x,y])=>[x,y,0]);
const original={v:[0,1,2,3,4,5],uv:verts.map(([x,y],i)=>[x*.23+i*.01,y*.17]),mat:3};
const invalid={v:[0,2,1,5],uv:[[0,0],[1,1],[1,0],[0,1]],mat:2};
const mesh={verts,faces:[structuredClone(original),structuredClone(invalid)],seams:new Set(['0_1']),creases:new Set(['4_5']),looseEdges:[]};
const result=triangulateFaces(mesh,new Set([0,1]));
assert.equal(result.changed,1); assert.equal(result.skipped,1);
assert.deepEqual(mesh.faces[1],invalid,'Invalid outlines left unchanged without partial edits');
assert.equal(result.faces.size,5);
for(const fi of result.faces) if(fi!==1) {
  const f=mesh.faces[fi]; assert.equal(f.mat,3);
  assert.deepEqual(f.uv,f.v.map(v=>original.uv[v]));
}
assert.deepEqual(mesh.seams,new Set(['0_1'])); assert.deepEqual(mesh.creases,new Set(['4_5']));
assert.deepEqual(mesh.verts,verts);
const large=Array.from({length:2000},(_,i)=>[Math.cos(i*Math.PI/1000),Math.sin(i*Math.PI/1000)]),start=performance.now();
assert.equal(tri2(large).length,1998);
console.log(`Triangulation: concave/collinear n-gons, winding, scale, 3D rotation, 100 random outlines, invalid outlines, angle quality, UV/material/tag preservation and export consistency passed (2,000 corners: ${Math.round(performance.now()-start)} ms)`);
