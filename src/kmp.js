// KMP v2520 (RKMD), big endian. Preserves untouched imported sections byte-for-byte.
// https://mkwiiki.org/wiki/KMP_(File_Format)
const _KP_NAMES = [
  'KTPT',
  'ENPT',
  'ENPH',
  'ITPT',
  'ITPH',
  'CKPT',
  'CKPH',
  'GOBJ',
  'POTI',
  'AREA',
  'CAME',
  'JGPT',
  'CNPT',
  'MSPT',
  'STGI',
];
export function normalizeTrack(data = {}) {
  const scale = Number(data.scale);
  const start =
    data.start &&
    Array.isArray(data.start.position) &&
    data.start.position.length === 3 &&
    data.start.position.every(Number.isFinite)
      ? {
          position: data.start.position.slice(),
          rotation:
            Array.isArray(data.start.rotation) &&
            data.start.rotation.length === 3 &&
            data.start.rotation.every(Number.isFinite)
              ? data.start.rotation.slice()
              : [0, 0, 0],
        }
      : null;
  return {
    // Migrate the old 1:1 default without changing deliberately customized scales.
    scale: Number.isFinite(scale) && scale >= 0.001 && scale <= 100000 && (scale !== 1 || data.scaleVersion === 1) ? scale : 100,
    scaleVersion: 1,
    start,
    clearance: Number.isFinite(data.clearance) ? Math.max(0, Math.min(100, data.clearance)) : 0.2,
    template: typeof data.template === 'string' ? data.template : null,
    templateName: typeof data.templateName === 'string' ? data.templateName : '',
    checkpoints: data.checkpoints ? cloneCheckpoints(data.checkpoints) : null,
  };
}
export function trackToWii(p, scale = 1) {
  return [p[0] * scale, p[2] * scale, -p[1] * scale];
}
export function trackFromWii(p, scale = 1) {
  return [p[0] / scale, -p[2] / scale, p[1] / scale];
}
// Editor endpoints use horizontal X/Y. Height is an editor display hint only;
// CKPT gates extend vertically and contain no height coordinate in the file.
export function cloneCheckpoints(data) {
  if (!Array.isArray(data.points) || !Array.isArray(data.groups)) throw new Error('Invalid checkpoint data');
  const pair = p => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) throw new Error('Invalid checkpoint coordinates');
    return p.slice();
  };
  const byte = n => {
    if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error('Invalid checkpoint index or type');
    return n;
  };
  return {
    points: data.points.map(p => ({left:pair(p.left), right:pair(p.right), type:byte(p.type), respawn:byte(p.respawn), prev:byte(p.prev), next:byte(p.next), height:Number.isFinite(p.height)?p.height:0})),
    groups: data.groups.map(g => {
      if (!Array.isArray(g.prev) || !Array.isArray(g.next) || g.prev.length > 6 || g.next.length > 6) throw new Error('Invalid checkpoint group links');
      return {start:byte(g.start),count:byte(g.count),prev:g.prev.map(byte),next:g.next.map(byte),padding:(g.padding||0)&65535};
    }),
    extra: [(data.extra?.[0]||0)&65535,(data.extra?.[1]||0)&65535],
    dirty: !!data.dirty,
  };
}
export function checkpointsFromKMP(parsed, scale = 1, height = 0) {
  const data = cloneCheckpoints(parsed.checkpoints);
  for (const p of data.points) {
    p.left = [p.left[0]/scale,-p.left[1]/scale];
    p.right = [p.right[0]/scale,-p.right[1]/scale];
    p.height = height;
  }
  return data;
}
// Rebuild sequence indices only after insertion/deletion/reordering. Imported
// group connections are kept, including branches and alternate routes.
export function relinkCheckpoints(data) {
  let start = 0;
  for (const g of [...data.groups].sort((a,b)=>a.start-b.start)) {
    g.start = start;
    for (let j=0;j<g.count;j++) {
      const p=data.points[start+j];
      p.prev=j===0?255:start+j-1;
      p.next=j===g.count-1?255:start+j+1;
    }
    start += g.count;
  }
  data.dirty = true;
}
export function checkpointConnections(data) {
  const links = [];
  for (const g of data.groups) {
    for(let j=0;j<g.count-1;j++) links.push([g.start+j,g.start+j+1]);
    for(const next of g.next) if(next!==255 && data.groups[next]?.count && g.count)
      links.push([g.start+g.count-1,data.groups[next].start]);
  }
  return links;
}
export function checkpointWarnings(data) {
  const messages=[], points=data.points;
  const laps=points.filter(p=>p.type===0).length;
  if(laps!==1) messages.push(laps?'Use one lap checkpoint for reliable lap counting.':'Add a lap checkpoint at the start/finish line.');
  const keys=[...new Set(points.filter(p=>p.type>0&&p.type<255).map(p=>p.type))].sort((a,b)=>a-b);
  if(!keys.length) messages.push('Add key checkpoints around the route.');
  else if(keys.some((n,i)=>n!==i+1)) messages.push('Key IDs should run from 1 upward without gaps.');
  if(keys.some(n=>n>127)) messages.push('Key IDs above 127 are not recommended.');
  if(data.groups.length===1 && laps===1) {
    const lap=points.findIndex(p=>p.type===0),order=[];
    for(let j=1;j<points.length;j++){const t=points[(lap+j)%points.length].type;if(t>0&&t<255)order.push(t);}
    if(order.some((n,i)=>n!==i+1))messages.push('Key IDs are out of driving order. Use Number keys in order.');
  }
  let invalid=0;
  for(const [a,b] of checkpointConnections(data)) {
    if(!points[a]||!points[b]) continue;
    const quad=[points[a].left,points[a].right,points[b].right,points[b].left];
    if(quad.some((p,i)=>{
      const q=quad[(i+1)%4],r=quad[(i+2)%4];
      return (q[0]-p[0])*(r[1]-q[1])-(q[1]-p[1])*(r[0]-q[0])<=0;
    })) invalid++;
  }
  if(invalid) messages.push(`${invalid} route connection${invalid===1?'':'s'} cross, fold, or face backward. Adjust endpoints, order, or direction.`);
  return messages;
}
export function inspectKMP(input) {
  const bytes = input instanceof Uint8Array ? Uint8Array.from(input) : new Uint8Array(input),
    v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (o) => String.fromCharCode(...bytes.slice(o, o + 4));
  if (bytes.length < 16 || text(0) !== 'RKMD') throw new Error('Not a Mario Kart Wii KMP file');
  const count = v.getUint16(8),
    header = v.getUint16(10);
  if (count < 1 || count > 64 || header < 16 + 4 * count || header > bytes.length || v.getUint32(4) !== bytes.length)
    throw new Error('Invalid KMP header or file length');
  const version = v.getUint32(header - count * 4 - 4);
  if (version !== 2520) throw new Error('Only Mario Kart Wii KMP version 2520 is supported');
  const offsets = Array.from({ length: count }, (_, i) => header + v.getUint32(header - count * 4 + i * 4));
  if (new Set(offsets).size !== count || offsets.some((o) => o < header || o + 8 > bytes.length))
    throw new Error('Invalid KMP section offsets');
  const sorted = [...offsets].sort((a, b) => a - b),
    sections = offsets.map((o) => {
      const end = sorted[sorted.indexOf(o) + 1] ?? bytes.length;
      if (end < o + 8) throw new Error('Overlapping KMP sections');
      return {
        name: text(o),
        count: v.getUint16(o + 4),
        extra: v.getUint16(o + 6),
        offset: o,
        bytes: bytes.slice(o, end),
      };
    });
  if (new Set(sections.map((s) => s.name)).size !== sections.length) throw new Error('Duplicate KMP sections');
  const ktpt = sections.find((s) => s.name === 'KTPT');
  let start = null;
  if (ktpt) {
    if (ktpt.bytes.length < 8 + ktpt.count * 28) throw new Error('Truncated KTPT section');
    if (ktpt.count) {
      const o = ktpt.offset + 8;
      start = {
        position: [0, 1, 2].map((i) => v.getFloat32(o + i * 4)),
        rotation: [0, 1, 2].map((i) => v.getFloat32(o + 12 + i * 4)),
      };
      if (![...start.position, ...start.rotation].every(Number.isFinite)) throw new Error('Invalid KTPT coordinates');
    }
  }
  const checkpoints = {points:[],groups:[],extra:[0,0],dirty:false};
  for(const [name,stride] of [['CKPT',20],['CKPH',16]]) {
    const section=sections.find(s=>s.name===name);
    if(!section) continue;
    if(section.bytes.length<8+section.count*stride) throw new Error('Truncated '+name+' section');
    checkpoints.extra[name==='CKPT'?0:1]=section.extra;
    for(let i=0;i<section.count;i++) {
      const o=section.offset+8+i*stride;
      if(name==='CKPT') {
        const coords=[0,4,8,12].map(j=>v.getFloat32(o+j));
        if(!coords.every(Number.isFinite)) throw new Error('Invalid CKPT coordinates');
        checkpoints.points.push({left:coords.slice(0,2),right:coords.slice(2),respawn:bytes[o+16],type:bytes[o+17],prev:bytes[o+18],next:bytes[o+19],height:0});
      } else checkpoints.groups.push({start:bytes[o],count:bytes[o+1],prev:Array.from(bytes.slice(o+2,o+8)),next:Array.from(bytes.slice(o+8,o+14)),padding:v.getUint16(o+14)});
    }
  }
  return { bytes, sections, start, version, checkpoints };
}
// Original temporary drive-test scaffold, not a route fitted to the model.
// A linked loop avoids the game dereferencing empty path/checkpoint groups.
function _kpTestSections(start, scale) {
  const p = trackToWii(start.position, scale),
    yaw = (start.rotation[1] * Math.PI) / 180;
  const forward = [Math.sin(yaw), 0, Math.cos(yaw)],
    right = [-Math.cos(yaw), 0, Math.sin(yaw)];
  const radius = 5000,
    center = p.map((v, i) => v + right[i] * radius + forward[i] * 500);
  const radial = [right.map((v) => -v), forward, right, forward.map((v) => -v)];
  const point = (i, r) => center.map((v, j) => v + radial[i][j] * r);
  const sections = _KP_NAMES.map((name) => {
    const count =
      { ENPT: 4, ENPH: 1, ITPT: 4, ITPH: 1, CKPT: 4, CKPH: 1, JGPT: 1, CAME: 2, POTI: 1, STGI: 1 }[name] || 0;
    const stride =
      { ENPT: 20, ENPH: 16, ITPT: 20, ITPH: 16, CKPT: 20, CKPH: 16, JGPT: 28, CAME: 72, POTI: 36, STGI: 12 }[name] || 0;
    const bytes = new Uint8Array(8 + count * stride),
      v = new DataView(bytes.buffer);
    Array.from(name).forEach((c, i) => (bytes[i] = c.charCodeAt(0)));
    v.setUint16(4, count);
    const vector = (o, p) => p.forEach((x, i) => v.setFloat32(o + i * 4, x));
    if (name === 'ENPT' || name === 'ITPT')
      for (let i = 0; i < 4; i++) {
        vector(8 + i * 20, point(i, radius));
        v.setFloat32(20 + i * 20, 10);
      }
    if (['ENPH', 'ITPH', 'CKPH'].includes(name)) {
      bytes[9] = 4;
      bytes.fill(255, 10, 22);
      bytes[10] = bytes[16] = 0;
    }
    if (name === 'CKPT')
      for (let i = 0; i < 4; i++) {
        const l = point(i, radius * 1.9),
          r = point(i, radius * 0.1),
          o = 8 + i * 20;
        [l[0], l[2], r[0], r[2]].forEach((x, j) => v.setFloat32(o + j * 4, x));
        bytes[o + 17] = i === 0 ? 0 : i === 2 ? 1 : 255;
        bytes[o + 18] = i === 0 ? 255 : i - 1;
        bytes[o + 19] = i === 3 ? 255 : i + 1;
      }
    if (name === 'JGPT') {
      vector(
        8,
        p.map((v, i) => (i === 1 ? v + 100 : v)),
      );
      vector(20, start.rotation);
    }
    if (name === 'CAME') {
      bytes[6] = 1; // opening camera 1; goal/selection camera 0
      for (let i = 0; i < 2; i++) {
        const o = 8 + i * 72;
        bytes[o] = i ? 5 : 0;
        bytes[o + 1] = 255;
        bytes[o + 3] = i ? 0 : 255;
        vector(
          o + 12,
          p.map((v, j) => v - forward[j] * 1500 + (j === 1 ? 1000 : 0)),
        );
        v.setFloat32(o + 36, 60);
        v.setFloat32(o + 40, 60);
        vector(o + 44, p);
        vector(o + 56, p);
        v.setFloat32(o + 68, 60);
      }
    }
    if (name === 'POTI') {
      v.setUint16(6, 2);
      v.setUint16(8, 2);
      for (let i = 0; i < 2; i++) {
        vector(
          12 + i * 16,
          p.map((v, j) => v - forward[j] * 1500 + (j === 1 ? 1000 : 0) + right[j] * i * 100),
        );
        v.setUint16(24 + i * 16, 100);
      }
    }
    if (name === 'STGI') {
      bytes[8] = 3;
      bytes[11] = 1;
      v.setUint32(12, 0x00ffffff);
      bytes[16] = 0x32;
    }
    return { name, bytes };
  });
  return sections;
}
export function exportKMP(start, { scale = 1, template = null, checkpoints = null } = {}) {
  if (
    !start ||
    !start.position ||
    !start.rotation ||
    start.position.length !== 3 ||
    start.rotation.length !== 3 ||
    ![...start.position, ...start.rotation, scale].every(Number.isFinite) ||
    scale <= 0
  )
    throw new Error('Place a start point on the track first');
  if (![...trackToWii(start.position, scale), ...start.rotation].every((n) => Number.isFinite(Math.fround(n))))
    throw new Error('Start coordinates exceed the KMP number range');
  let sections = template
    ? inspectKMP(template).sections.map((s) => ({ name: s.name, bytes: s.bytes.slice() }))
    : _kpTestSections(start, scale);
  let section = sections.find((s) => s.name === 'KTPT');
  if (!section) {
    section = { name: 'KTPT', bytes: new Uint8Array(8) };
    sections.unshift(section);
  }
  if (section.bytes.length < 36 || new DataView(section.bytes.buffer, section.bytes.byteOffset).getUint16(4) === 0) {
    section.bytes = new Uint8Array(36);
    section.bytes.set([75, 84, 80, 84, 0, 1]);
    new DataView(section.bytes.buffer).setInt16(32, -1);
  }
  const kv = new DataView(section.bytes.buffer, section.bytes.byteOffset, section.bytes.byteLength);
  trackToWii(start.position, scale).forEach((n, i) => kv.setFloat32(8 + i * 4, n));
  start.rotation.forEach((n, i) => kv.setFloat32(20 + i * 4, n));
  if (checkpoints?.dirty) _kpWriteCheckpoints(sections, checkpoints, scale);
  const header = 16 + sections.length * 4,
    size = header + sections.reduce((n, s) => n + s.bytes.length, 0),
    bytes = new Uint8Array(size),
    v = new DataView(bytes.buffer);
  bytes.set([82, 75, 77, 68]);
  v.setUint32(4, size);
  v.setUint16(8, sections.length);
  v.setUint16(10, header);
  v.setUint32(12, 2520);
  let pos = header;
  sections.forEach((s, i) => {
    v.setUint32(16 + i * 4, pos - header);
    bytes.set(s.bytes, pos);
    pos += s.bytes.length;
  });
  return bytes;
}
function _kpWriteCheckpoints(sections, input, scale) {
  const data=cloneCheckpoints(input), n=data.points.length;
  if(!n) throw new Error('Draw checkpoints before exporting, or use the automatic test setup');
  if(n>255 || !data.groups.length || data.groups.length>255) throw new Error('Checkpoint editing supports up to 255 checkpoints and groups');
  const used=new Set();
  for(const g of data.groups) {
    if(!g.count || g.start+g.count>n || [...g.prev,...g.next].some(i=>i!==255&&i>=data.groups.length)) throw new Error('Invalid checkpoint group range or connection');
    for(let i=g.start;i<g.start+g.count;i++) {if(used.has(i)) throw new Error('Overlapping checkpoint groups');used.add(i);}
  }
  if(used.size!==n) throw new Error('Every checkpoint needs a group');
  const respawns=sections.find(s=>s.name==='JGPT');
  const respawnCount=respawns?new DataView(respawns.bytes.buffer,respawns.bytes.byteOffset).getUint16(4):0;
  for(const p of data.points) {
    if(p.respawn>=respawnCount) throw new Error('Checkpoint respawn index is missing from this KMP');
    if(Math.hypot(p.right[0]-p.left[0],p.right[1]-p.left[1])<1e-7) throw new Error('Checkpoint endpoints must be apart');
    if([p.prev,p.next].some(i=>i!==255&&i>=n)) throw new Error('Invalid checkpoint sequence index');
    if(![...p.left,...p.right].every(v=>Number.isFinite(Math.fround(v*scale)))) throw new Error('Checkpoint coordinates exceed the KMP number range');
    if(p.left.every((v,i)=>Math.fround(v*scale)===Math.fround(p.right[i]*scale))) throw new Error('Checkpoint endpoints are too close at these coordinates');
  }
  for(const [name,count,stride,extra] of [['CKPT',n,20,data.extra[0]],['CKPH',data.groups.length,16,data.extra[1]]]) {
    const bytes=new Uint8Array(8+count*stride),v=new DataView(bytes.buffer);
    bytes.set(Array.from(name,c=>c.charCodeAt(0)));v.setUint16(4,count);v.setUint16(6,extra);
    if(name==='CKPT') data.points.forEach((p,i)=>{
      const o=8+i*20;
      [p.left[0]*scale,-p.left[1]*scale,p.right[0]*scale,-p.right[1]*scale].forEach((x,j)=>v.setFloat32(o+j*4,x));
      bytes.set([p.respawn,p.type,p.prev,p.next],o+16);
    });
    else data.groups.forEach((g,i)=>{
      const o=8+i*16;bytes[o]=g.start;bytes[o+1]=g.count;bytes.fill(255,o+2,o+14);
      bytes.set(g.prev,o+2);bytes.set(g.next,o+8);v.setUint16(o+14,g.padding);
    });
    const existing=sections.find(s=>s.name===name);
    if(existing) existing.bytes=bytes; else sections.push({name,bytes});
  }
}
