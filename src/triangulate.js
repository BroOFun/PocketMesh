// Shared by modeling, UVs and export. Corner indices (and therefore UV seams)
// survive triangulation. Boundary edges are constraints and are never flipped.
const _triEps = 1e-14;
const _triCross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const _triKey = (a,b) => a < b ? a+'_'+b : b+'_'+a;
function _triQuality(P, t) {
  const [a,b,c]=t.map(i=>P[i]);
  const ab=(a[0]-b[0])**2+(a[1]-b[1])**2, bc=(b[0]-c[0])**2+(b[1]-c[1])**2, ca=(c[0]-a[0])**2+(c[1]-a[1])**2;
  const area=_triCross(a,b,c);
  // Squared sine of the smallest angle: larger means less skinny.
  return area*area/Math.max(ab*bc,bc*ca,ca*ab,Number.MIN_VALUE);
}
function _triSimple(P) {
  const n=P.length, eps=_triEps;
  for(let i=0;i<n;i++) {
    const a=P[i], b=P[(i+1)%n];
    if(a[0]===b[0] && a[1]===b[1]) return false;
    for(let j=i+2;j<n;j++) {
      if(i===0 && j===n-1) continue;
      const c=P[j], d=P[(j+1)%n];
      if(Math.max(a[0],b[0])+eps<Math.min(c[0],d[0]) || Math.max(c[0],d[0])+eps<Math.min(a[0],b[0]) ||
         Math.max(a[1],b[1])+eps<Math.min(c[1],d[1]) || Math.max(c[1],d[1])+eps<Math.min(a[1],b[1])) continue;
      const abC=_triCross(a,b,c), abD=_triCross(a,b,d), cdA=_triCross(c,d,a), cdB=_triCross(c,d,b);
      if(!((abC>eps && abD>eps)||(abC<-eps && abD<-eps)||(cdA>eps && cdB>eps)||(cdA<-eps && cdB<-eps))) return false;
    }
  }
  return true;
}
function _triBeautify(P, tris) {
  const adjacency=new Map(), queue=[], queued=new Set();
  const add = fi => tris[fi].forEach((a,i)=>{
    const key=_triKey(a,tris[fi][(i+1)%3]);
    if(!adjacency.has(key)) adjacency.set(key,new Set());
    adjacency.get(key).add(fi);
    if(!queued.has(key)) { queued.add(key); queue.push(key); }
  });
  const remove = fi => tris[fi].forEach((a,i)=>{
    const key=_triKey(a,tris[fi][(i+1)%3]), faces=adjacency.get(key);
    faces.delete(fi); if(!faces.size) adjacency.delete(key);
  });
  tris.forEach((_,fi)=>add(fi));
  let flips=0;
  for(let q=0;q<queue.length && flips<tris.length*32;q++) {
    const key=queue[q]; queued.delete(key);
    const faces=adjacency.get(key); if(faces?.size!==2) continue;
    const [i,j]=faces, t=tris[i], other=tris[j];
    const k=t.findIndex((a,k)=>_triKey(a,t[(k+1)%3])===key);
    const a=t[k], b=t[(k+1)%3], c=t[(k+2)%3], d=other.find(v=>v!==a && v!==b);
    const one=[c,d,b], two=[d,c,a];
    // Only swap a diagonal inside a convex pair; this cannot cross a boundary.
    if(_triCross(...one.map(v=>P[v]))<=_triEps || _triCross(...two.map(v=>P[v]))<=_triEps) continue;
    const before=Math.min(_triQuality(P,t),_triQuality(P,other)), after=Math.min(_triQuality(P,one),_triQuality(P,two));
    if(after<=before+1e-12) continue;
    remove(i); remove(j); tris[i]=one; tris[j]=two; add(i); add(j); flips++;
  }
  return tris;
}
export function triangulatePolygon2D(points) {
  const n=points.length;
  if(n<3 || points.some(p=>!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return [];
  // Local, normalized coordinates avoid absolute tolerances and cancellation
  // for tiny polygons, large track coordinates and translated geometry.
  const origin=points[0], local=points.map(p=>[p[0]-origin[0],p[1]-origin[1]]);
  let scale=0;
  for(const p of local) scale=Math.max(scale,Math.abs(p[0]),Math.abs(p[1]));
  if(!(scale>0) || !Number.isFinite(scale)) return [];
  const P=local.map(p=>[p[0]/scale,p[1]/scale]);
  let area=0;
  for(let i=0;i<n;i++) area+=_triCross([0,0],P[i],P[(i+1)%n]);
  if(Math.abs(area)<=_triEps || !_triSimple(P)) return [];
  const idx=Array.from({length:n},(_,i)=>i), reversed=area<0;
  if(reversed) idx.reverse();
  const orient = t => _triCross(...t.map(i=>P[i]));
  const finish = tris => reversed ? tris.map(([a,b,c])=>[a,c,b]) : tris;
  if(n===3) return finish([idx]);
  if(n===4) {
    const [a,b,c,d]=idx, A=[[a,b,c],[a,c,d]], B=[[a,b,d],[b,c,d]];
    const qa=A.every(t=>orient(t)>_triEps) ? Math.min(...A.map(t=>_triQuality(P,t))) : -1;
    const qb=B.every(t=>orient(t)>_triEps) ? Math.min(...B.map(t=>_triQuality(P,t))) : -1;
    return Math.max(qa,qb)<0 ? [] : finish(qa>=qb-1e-12 ? A : B);
  }
  const tris=[];
  while(idx.length>3) {
    let ear=-1;
    for(let i=0;i<idx.length;i++) {
      const a=idx[(i+idx.length-1)%idx.length], b=idx[i], c=idx[(i+1)%idx.length];
      if(orient([a,b,c])<=_triEps) continue;
      let blocked=false;
      for(const p of idx) {
        if(p===a || p===b || p===c) continue;
        // Include points ON the triangle. Otherwise a collinear boundary
        // corner can be bypassed, making a T-junction with its neighbor.
        if(_triCross(P[a],P[b],P[p])>=-_triEps && _triCross(P[b],P[c],P[p])>=-_triEps && _triCross(P[c],P[a],P[p])>=-_triEps) { blocked=true; break; }
      }
      if(!blocked) { ear=i; tris.push([a,b,c]); break; }
    }
    if(ear<0) return []; // Invalid outline: never force an overlapping triangle.
    idx.splice(ear,1);
  }
  if(orient(idx)<=_triEps) return [];
  tris.push(idx);
  return finish(_triBeautify(P,tris));
}
export function triangulatePolygon(points) {
  const n=points.length;
  if(n<3 || points.some(p=>!p || p.length<3 || !p.every(Number.isFinite))) return [];
  if(n===3) return [[0,1,2]];
  const origin=points[0], local=points.map(p=>p.map((x,k)=>x-origin[k]));
  let scale=0;
  for(const p of local) for(const x of p) scale=Math.max(scale,Math.abs(x));
  if(!(scale>0) || !Number.isFinite(scale)) return [];
  const P=local.map(p=>p.map(x=>x/scale)), normal=[0,0,0];
  for(let i=0;i<n;i++) {
    const a=P[i], b=P[(i+1)%n];
    normal[0]+=a[1]*b[2]-a[2]*b[1]; normal[1]+=a[2]*b[0]-a[0]*b[2]; normal[2]+=a[0]*b[1]-a[1]*b[0];
  }
  const length=Math.hypot(...normal); if(length<=_triEps) return [];
  const N=normal.map(x=>x/length);
  // An orthonormal projection preserves angles on any planar face orientation.
  const u=Math.abs(N[0])<.9 ? [0,-N[2],N[1]] : [N[2],0,-N[0]], ul=Math.hypot(...u);
  for(let i=0;i<3;i++) u[i]/=ul;
  const v=[N[1]*u[2]-N[2]*u[1],N[2]*u[0]-N[0]*u[2],N[0]*u[1]-N[1]*u[0]];
  return triangulatePolygon2D(P.map(p=>[p[0]*u[0]+p[1]*u[1]+p[2]*u[2],p[0]*v[0]+p[1]*v[1]+p[2]*v[2]]));
}
