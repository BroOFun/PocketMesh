// KMP checkpoint tools share the track camera and never alter model geometry.
const CHECKPOINT = {selected:-1, group:0, mode:'draw', type:255, drag:null};
const checkpointColor = p => p.type===0?'#ed8bff':p.type===255?'#68bcff':'#71f0aa';
const checkpointName = p => p.type===0?'Lap':p.type===255?'Normal':'Key '+p.type;
function checkpointActive() { return S.workspace==='kmp' && TRACKVIEW.action==='checkpoints'; }
function checkpointSelected() { return S.track.checkpoints?.points[CHECKPOINT.selected]; }
function checkpointData() {
  if(!S.track.checkpoints) S.track.checkpoints = S.track.template
    ? checkpointsFromKMP(inspectKMP(bytesFromB64(S.track.template)),S.track.scale,S.track.start?.position[2]||0)
    : {points:[],groups:[],extra:[0,0],dirty:false};
  return S.track.checkpoints;
}
function checkpointTopView() {
  CAM.anim=null;CAM.yaw=-Math.PI/2;CAM.pitch=Math.PI/2;CAM.ortho=true;CAM.autoOrtho=false;CAM.viewName='top';
  const box=new THREE.Box3();for(const o of S.objects)if(o.visible)box.expandByObject(o.node);
  if(!box.isEmpty())CAM.target.z=box.max.z;
  applyCamera();updateViewButtons();
}
function checkpointActivate(mode='draw') {
  if(S.workspace!=='kmp')setWorkspace('kmp');
  const data=checkpointData();
  if(data.points.length>255){toast('This editor supports up to 255 checkpoints. The imported file is preserved.',true);return;}
  if(data.points.length) {
    const used=new Set();let valid=true;
    for(const g of data.groups){
      if(!g.count||[...g.prev,...g.next].some(i=>i!==255&&i>=data.groups.length))valid=false;
      for(let i=g.start;i<g.start+g.count;i++){if(i>=data.points.length||used.has(i))valid=false;used.add(i);}
    }
    if(!valid||used.size!==data.points.length){toast('Repair the imported checkpoint groups before editing. The file is preserved.',true);return;}
  }
  closeSheet();cancelViewportGesture();S.tool='select';TRACKVIEW.action='checkpoints';CHECKPOINT.mode=mode;
  if(!data.points.length)CHECKPOINT.type=0;
  checkpointTopView();buildTools();buildSubbar();gizmoSync();
}
function checkpointDone() { cancelViewportGesture();TRACKVIEW.action='select';hint(null);buildTools();buildSubbar();gizmoSync(); }
function checkpointCancel() { CHECKPOINT.drag=null;requestRender(); }
function checkpointNextKey() {
  const used=new Set(checkpointData().points.filter(p=>p.type>0&&p.type<255).map(p=>p.type));
  for(let i=1;i<=127;i++)if(!used.has(i))return i;
  return 127;
}
function checkpointCommit(label) { checkpointData().dirty=true;trackCommit(label); }
function checkpointSetType(type) {
  const p=checkpointSelected();
  if(CHECKPOINT.mode==='edit' && p) {
    p.type=type===1 ? (p.type>0&&p.type<255?p.type:checkpointNextKey()) : type;
    checkpointCommit('Checkpoint type');
  } else {CHECKPOINT.type=type;buildSubbar();}
}
function checkpointControls(bar) {
  hint(CHECKPOINT.mode==='draw'?'Drag across the road to add a line':'Drag an endpoint or line to move it');
  const mode=segButtons(CHECKPOINT.mode,[['draw','Draw'],['edit','Edit']],v=>{checkpointCancel();CHECKPOINT.mode=v;buildSubbar();});
  mode.setAttribute('aria-label','Checkpoint tool mode');
  const p=CHECKPOINT.mode==='edit'?checkpointSelected():null, t=p?.type??CHECKPOINT.type;
  const types=segButtons(t===0?'lap':t===255?'normal':'key',[['normal','Normal'],['key','Key'],['lap','Lap']],v=>checkpointSetType({normal:255,key:1,lap:0}[v]));
  types.setAttribute('aria-label','Checkpoint type');
  bar.append(mode,trackButton('Done',checkpointDone),types,trackButton('Flip direction',checkpointFlip),trackButton('Checkpoint settings',openCheckpoints));
}
function checkpointPlanePoint(p, height) {
  const ray=screenRay(p.x,p.y);
  if(Math.abs(ray.ray.direction.z)<1e-6)return null;
  const t=(height-ray.ray.origin.z)/ray.ray.direction.z;
  if(!CAM.ortho && t<0)return null;
  return ray.ray.at(t,new THREE.Vector3());
}
function checkpointSurfacePoint(p, height) {
  const ray=screenRay(p.x,p.y);
  if(CAM.ortho){ray.ray.origin.addScaledVector(camBasis().z,-camera.near);ray.far=camera.far-camera.near;}
  return trackHits(ray)[0]?.point || checkpointPlanePoint(p,height);
}
function checkpointScreen(p) {
  return [p.left,p.right].map(v=>toScreen(new THREE.Vector3(v[0],v[1],p.height)));
}
function checkpointPick(p) {
  const data=S.track.checkpoints;if(!data)return null;
  let best=null,dist=18;
  data.points.forEach((cp,i)=>{
    const [a,b]=checkpointScreen(cp);if(a.z<-1||a.z>1||b.z<-1||b.z>1)return;
    for(const [point,part] of [[a,'left'],[b,'right']]) {
      const d=Math.hypot(point.x-p.x,point.y-p.y);
      if(d<dist){dist=d;best={i,part};}
    }
  });
  if(best)return best;
  data.points.forEach((cp,i)=>{
    const [a,b]=checkpointScreen(cp);if(a.z<-1||a.z>1||b.z<-1||b.z>1)return;
    const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
    const d=Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
    if(d<dist){dist=d;best={i,part:'line'};}
  });
  return best;
}
function checkpointBegin(p) {
  const data=checkpointData();
  if(CHECKPOINT.mode==='edit') {
    const hit=checkpointPick(p);if(!hit){CHECKPOINT.selected=-1;buildSubbar();requestRender();return;}
    CHECKPOINT.selected=hit.i;CHECKPOINT.group=data.groups.findIndex(g=>hit.i>=g.start&&hit.i<g.start+g.count);
    const cp=data.points[hit.i],point=checkpointPlanePoint(p,cp.height);
    if(point)CHECKPOINT.drag={kind:'edit',...hit,from:point,source:structuredClone(cp),preview:structuredClone(cp),screen:p};
    buildSubbar();requestRender();return;
  }
  if(data.points.length>=255){toast('Maximum 255 checkpoints',true);return;}
  const point=checkpointSurfacePoint(p,CAM.target.z);if(!point)return;
  const xy=[point.x,point.y];
  CHECKPOINT.drag={kind:'draw',screen:p,preview:{left:xy,right:xy.slice(),height:point.z,type:CHECKPOINT.type===1?checkpointNextKey():CHECKPOINT.type,respawn:0,prev:255,next:255}};
  requestRender();
}
function checkpointMove(p) {
  const d=CHECKPOINT.drag;if(!d)return;
  const point=checkpointPlanePoint(p,d.preview.height);if(!point)return;
  if(d.kind==='draw')d.preview.right=[point.x,point.y];
  else if(d.part==='line')for(const side of ['left','right'])d.preview[side]=[d.source[side][0]+point.x-d.from.x,d.source[side][1]+point.y-d.from.y];
  else d.preview[d.part]=[point.x,point.y];
  requestRender();
}
function checkpointEnd(p,cancel=false) {
  const d=CHECKPOINT.drag;if(!d)return;
  if(!cancel)checkpointMove(p);
  CHECKPOINT.drag=null;
  const cp=d.preview, data=checkpointData();
  if(cancel || Math.hypot(p.x-d.screen.x,p.y-d.screen.y)<4 || Math.hypot(cp.right[0]-cp.left[0],cp.right[1]-cp.left[1])<1e-7){requestRender();return;}
  if(d.kind==='edit')data.points[d.i]=cp;
  else {
    if(!data.groups.length)data.groups.push({start:0,count:0,prev:[0],next:[0],padding:0});
    const g=data.groups[CHECKPOINT.group]||data.groups[0];
    CHECKPOINT.selected=g.start+g.count;data.points.splice(CHECKPOINT.selected,0,cp);g.count++;relinkCheckpoints(data);
    if(CHECKPOINT.type===0)CHECKPOINT.type=255;
  }
  checkpointCommit(d.kind==='edit'?'Move checkpoint':'Add checkpoint');
}
function checkpointFlip() {
  const p=checkpointSelected();if(!p){toast('Select or draw a checkpoint first');return;}
  [p.left,p.right]=[p.right,p.left];checkpointCommit('Flip checkpoint direction');
}
function checkpointDelete() {
  const data=checkpointData(),i=CHECKPOINT.selected,p=data.points[i];if(!p)return;
  const g=data.groups.find(g=>i>=g.start&&i<g.start+g.count);
  if(!g)return;
  if(g.count===1&&data.groups.length>1){toast('Keep one checkpoint in each imported group. Move its endpoints instead.',true);return;}
  data.points.splice(i,1);g.count--;if(!data.points.length)data.groups=[];
  relinkCheckpoints(data);CHECKPOINT.selected=Math.min(i,data.points.length-1);checkpointCommit('Delete checkpoint');
}
function checkpointReorder(delta) {
  const data=checkpointData(),i=CHECKPOINT.selected,g=data.groups.find(g=>i>=g.start&&i<g.start+g.count),j=i+delta;
  if(!g||j<g.start||j>=g.start+g.count)return;
  [data.points[i],data.points[j]]=[data.points[j],data.points[i]];CHECKPOINT.selected=j;relinkCheckpoints(data);checkpointCommit('Reorder checkpoint');
}
function checkpointNumberKeys() {
  const data=checkpointData(),lap=data.points.findIndex(p=>p.type===0);
  if(data.groups.length!==1||lap<0||data.points.filter(p=>p.type===0).length!==1){toast('Automatic key numbering needs one route group and one lap checkpoint.',true);return;}
  if(data.points.filter(p=>p.type>0&&p.type<255).length>127){toast('Use at most 127 key checkpoints.',true);return;}
  let key=1;
  for(let j=1;j<data.points.length;j++){const p=data.points[(lap+j)%data.points.length];if(p.type>0&&p.type<255)p.type=key++;}
  checkpointCommit('Number checkpoint keys');
}
function checkpointFocus(all=false) {
  const box=new THREE.Box3(),points=all?checkpointData().points:[checkpointSelected()].filter(Boolean);
  for(const p of points)for(const v of [p.left,p.right])box.expandByPoint(new THREE.Vector3(...v,p.height));
  trackFocusBox(box);checkpointTopView();
}
function drawCheckpoints(ctx) {
  const data=S.track.checkpoints;if(S.workspace!=='kmp'||!data)return;
  const points=data.points.slice(),d=CHECKPOINT.drag;
  if(d?.kind==='edit')points[d.i]=d.preview;
  const screen=points.map(checkpointScreen);
  ctx.save();ctx.lineWidth=1;ctx.strokeStyle='#b9b6d880';ctx.setLineDash([5,5]);
  for(const [i,j] of checkpointConnections(data)) {
    const a=screen[i],b=screen[j];if(!a||!b||[...a,...b].some(p=>p.z<-1||p.z>1))continue;
    ctx.beginPath();for(let k=0;k<2;k++){ctx.moveTo(a[k].x,a[k].y);ctx.lineTo(b[k].x,b[k].y);}ctx.stroke();
  }
  ctx.setLineDash([]);
  if(d?.kind==='draw'){points.push(d.preview);screen.push(checkpointScreen(d.preview));}
  points.forEach((p,i)=>{
    const [a,b]=screen[i];if(a.z<-1||a.z>1||b.z<-1||b.z>1)return;
    const selected=i===CHECKPOINT.selected||i>=data.points.length,color=checkpointColor(p);
    ctx.strokeStyle=selected?'#ffffff':color;ctx.lineWidth=selected?4:2.5;
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    ctx.fillStyle=color;for(const s of [a,b]){ctx.beginPath();ctx.arc(s.x,s.y,selected?6:4,0,Math.PI*2);ctx.fill();}
    const dx=p.right[0]-p.left[0],dy=p.right[1]-p.left[1],len=Math.hypot(dx,dy);if(len<1e-10)return;
    const center=new THREE.Vector3((p.left[0]+p.right[0])/2,(p.left[1]+p.right[1])/2,p.height);
    const from=toScreen(center),to=toScreen(center.clone().add(new THREE.Vector3(-dy/len,dx/len,0)));
    const angle=Math.atan2(to.y-from.y,to.x-from.x),end={x:from.x+26*Math.cos(angle),y:from.y+26*Math.sin(angle)};
    ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(end.x,end.y);
    ctx.moveTo(end.x-9*Math.cos(angle-.5),end.y-9*Math.sin(angle-.5));ctx.lineTo(end.x,end.y);ctx.lineTo(end.x-9*Math.cos(angle+.5),end.y-9*Math.sin(angle+.5));ctx.stroke();
    const label=(i+1)+' · '+checkpointName(p);ctx.font='600 12px system-ui';
    const width=ctx.measureText(label).width+10;ctx.fillStyle='#101020e8';ctx.fillRect(from.x-width/2,from.y+9,width,21);
    ctx.fillStyle=color;ctx.fillText(label,from.x-width/2+5,from.y+24);
    if(selected){ctx.font='600 10px system-ui';ctx.fillText('L',a.x+8,a.y-8);ctx.fillText('R',b.x+8,b.y-8);}
  });
  ctx.restore();
}
function openCheckpoints() { checkpointData();openSheet('KMP · Checkpoints',buildCheckpoints,{panel:true,kind:'checkpoints'}); }
function buildCheckpoints(body) {
  const data=checkpointData(),p=checkpointSelected();
  body.append(h('div',{class:'card'},h('h3',{},'Checkpoints · '+data.points.length),
    h('p',{class:'muted'},'Drag left to right across the road. The arrow faces the racing direction. Draw lines in driving order; dotted links show the route. The first line defaults to Lap.'),
    h('div',{class:'row'},trackButton('Draw checkpoints',()=>checkpointActivate('draw'),true),trackButton('Edit checkpoints',()=>checkpointActivate('edit'))),
    h('div',{class:'row'},trackButton('Top view',checkpointTopView),trackButton('Frame checkpoints',()=>checkpointFocus(true))),trackButton('Number keys in order',checkpointNumberKeys)));
  if(data.groups.length>1)body.append(field('Checkpoint group',selectInput(CHECKPOINT.group,data.groups.map((g,i)=>[i,'Group '+(i+1)+' · '+g.count+' checkpoints']),v=>{CHECKPOINT.group=+v;},'Checkpoint group')));
  if(p) {
    const dx=p.right[0]-p.left[0],dy=p.right[1]-p.left[1],heading=((Math.atan2(-dy,-dx)/DEG)%360+360)%360;
    const card=h('div',{class:'card'},h('h3',{},'Checkpoint '+(CHECKPOINT.selected+1)),
      field('Type',selectInput(p.type===0?'lap':p.type===255?'normal':'key',[['normal','Normal'],['key','Key'],['lap','Lap']],v=>{CHECKPOINT.mode='edit';checkpointSetType({normal:255,key:1,lap:0}[v]);},'Selected checkpoint type')),
      h('p',{class:'muted'},'Facing '+fmt(heading,1)+'° Wii yaw · '+fmt(Math.hypot(dx,dy),2)+' m wide'));
    if(p.type>0&&p.type<255)card.append(field('Key ID',numInput(p.type,v=>{p.type=v;checkpointCommit('Checkpoint key ID');},{int:true,min:1,max:254,label:'Checkpoint key ID'})));
    const respawns=S.track.template?inspectKMP(bytesFromB64(S.track.template)).sections.find(s=>s.name==='JGPT')?.count||0:1;
    card.append(field('Respawn index',numInput(p.respawn,v=>{p.respawn=v;checkpointCommit('Checkpoint respawn');},{int:true,min:0,max:Math.max(0,Math.min(255,respawns-1)),label:'Checkpoint respawn index'})));
    for(const [side,name] of [['left','Left'],['right','Right']])for(const [axis,label] of [[0,'X'],[1,'Y']])card.append(field(name+' '+label,numInput(p[side][axis],v=>{p[side][axis]=v;checkpointCommit('Checkpoint endpoint');},{label:'Checkpoint '+name+' '+label})));
    card.append(h('div',{class:'row'},trackButton('Flip direction',checkpointFlip),trackButton('Focus selected',()=>checkpointFocus())),h('div',{class:'row'},trackButton('Earlier',()=>checkpointReorder(-1)),trackButton('Later',()=>checkpointReorder(1)),trackButton('Delete checkpoint',checkpointDelete)));
    body.append(card);
  }
  const list=h('div',{class:'card'},h('h3',{},'Driving order'));
  data.points.forEach((p,i)=>list.append(trackButton((i+1)+' · '+checkpointName(p),()=>{CHECKPOINT.selected=i;CHECKPOINT.group=data.groups.findIndex(g=>i>=g.start&&i<g.start+g.count);CHECKPOINT.mode='edit';refreshSheet(true);requestRender();},i===CHECKPOINT.selected)));
  if(!data.points.length)list.append(h('p',{class:'muted'},'Draw a line across the track to begin.'));
  body.append(list);
  const warnings=checkpointWarnings(data);
  if(warnings.length)body.append(h('div',{class:'card'},h('h3',{},'Route checks'),...warnings.map(s=>h('p',{class:'muted'},s))));
  body.append(h('p',{class:'muted'},'Normal checkpoints track progress. Pass key IDs in order before crossing Lap again. Gates have no game height; they extend vertically. Imported group links and other KMP sections are preserved.'));
}
