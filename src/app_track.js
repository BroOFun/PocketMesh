// Shared track workspaces: geometry and camera belong to the project, not a file panel.
const TRACKVIEW = { material: null, colors: true, action: 'select', labels: [] };
const trackOverlay = new THREE.Group();
scene.add(trackOverlay);
function trackButton(text, run, primary = false) {
  return h('button', { class: 'btn' + (primary ? ' primary' : ''), onclick: run }, text);
}
function trackCommit(label) {
  pushUndo(label);
  trackRefresh();
  buildSubbar();
  refreshSheet(true);
  gizmoSync();
  requestRender();
}
function setTrackScale(value) {
  if (!Number.isFinite(value) || value < 0.001 || value > 100000) return;
  S.track.scale = value;
  S.track.scaleVersion = 1;
  const ex = settingsGet('export', {});
  ex.scale = value;
  settingsSet('export', ex);
  trackCommit('Track export scale');
}
function trackScaleField() {
  return field(
    'Course model export scale',
    numInput(S.track.scale, setTrackScale, { min: 0.001, max: 100000, label: 'Shared Wii export scale' }),
  );
}
function openTrackEditor() {
  menuSheet('Track Editor', [
    {label: 'Course Model', icon: 'cube', desc: 'Model geometry, BRRES resources and textures', run: () => { setWorkspace('model'); openBRRESEditor(); }},
    {label: 'KCL', icon: 'layers', desc: 'Collision materials and road types', run: () => setWorkspace('kcl')},
    {label: 'KMP', icon: 'cursor', desc: 'Start position, direction and checkpoints', run: () => setWorkspace('kmp')},
    {label: 'SZS', icon: 'folder', desc: 'Track archive and file replacement', run: openSZSEditor},
  ]);
}
function setWorkspace(workspace) {
  checkpointCancel();
  if (S.tool === 'circle') circleDone();
  if (!['model', 'kcl', 'kmp'].includes(workspace)) return;
  if (S.tool === 'knife') knifeCancel();
  if (TF.active) tfCancel();
  if (PM.active) pmCancel();
  closeSheet();
  S.pendingTap = null;
  S.multiSelect = false;
  S.selOp = 'set';
  rulerResetPending();
  if (workspace !== 'model' && S.mode === 'edit') setMode('object');
  S.workspace = workspace;
  S.tool = 'select';
  TRACKVIEW.action = workspace === 'kmp' && !S.track.start ? 'place' : 'select';
  if (workspace !== 'model' && S.view !== '3d') setWorkView('3d');
  $('#btnMode').hidden = workspace !== 'model';
  $('#btnView').hidden = workspace !== 'model';
  onModeChanged();
  buildTools();
  trackRefresh();
  gizmoSync();
  hint(
    workspace === 'kcl'
      ? 'Tap a surface to edit its material’s collision.'
      : workspace === 'kmp'
        ? 'Place Start snaps to the road. Aim sets the driving direction.'
        : null,
  );
}
function trackSubbar(bar) {
  if(checkpointActive()) {checkpointControls(bar);return true;}
  const menu = trackButton('Track Editor ▾', openTrackEditor);
  menu.setAttribute('aria-label', 'Track Editor');
  bar.append(menu, h('span', {class: 'muted', style: {whiteSpace: 'nowrap'}}, S.workspace === 'model' ? 'Course Model' : S.workspace.toUpperCase()));
  if (S.workspace === 'model') return false;
  bar.append(
    trackButton(S.workspace === 'kcl' ? 'Materials & flags' : 'Start point', S.workspace === 'kcl' ? openKCL : openKMP),
    trackButton('Export ' + S.workspace.toUpperCase(), () => trackExport(S.workspace)),
  );
  if(S.workspace==='kmp') {
    bar.append(trackButton('Checkpoints',()=>checkpointActivate()));
  }
  return true;
}
function buildTrackShelf(sh) {
  if (S.workspace === 'model') return false;
  if (S.workspace === 'kcl')
    sh.append(
      shelfBtn('Materials', 'material', openKCL),
      shelfBtn('Road types', 'layers', openKCLCatalog),
      shelfBtn('Focus material', 'frame', trackFocusMaterial),
    );
  else
    sh.append(
      shelfBtn('Checkpoints', 'checkpoint', () => checkpointActivate()),
      shelfBtn('Place Start', 'cursor', () => trackAction('place')),
      shelfBtn('Aim Start', 'rotate', () => trackAction('aim')),
      shelfBtn('Start settings', 'sliders', openKMP),
      shelfBtn('Focus Start', 'frame', trackFocusStart),
      shelfBtn('Open KMP', 'folder', () => $('#fileKMP').click()),
    );
  sh.append(
    shelfBtn(TRACKVIEW.colors ? 'Colors On' : 'Colors Off', 'material', () => {
      TRACKVIEW.colors = !TRACKVIEW.colors;
      trackRefresh();
      buildShelf();
    }),
    shelfBtn('Export ' + S.workspace.toUpperCase(), 'export', () => trackExport(S.workspace)),
    shelfBtn('Scene', 'layers', openOutliner),
  );
  return true;
}
function trackTool(tool) {
  cancelViewportGesture();
  if (GZ && tc.dragging) return;
  if (S.workspace === 'kmp' && ['move', 'rotate'].includes(tool) && !S.track.start) {
    trackAction('place');
    toast('Tap the track to place Start first');
    return;
  }
  closeSheet();
  S.tool = tool;
  TRACKVIEW.action = 'select';
  S.pendingTap = null;
  hint(
    tool === 'move' && S.workspace === 'kmp'
      ? 'Drag the start arrows. X/Y movement snaps height; Z adjusts height directly.'
      : null,
  );
  buildTools();
  buildSubbar();
  gizmoSync();
}
function trackAction(action) {
  if (action === 'aim' && !S.track.start) {
    toast('Place a start point first', true);
    return;
  }
  closeSheet();
  S.tool = 'select';
  cancelViewportGesture();
  TRACKVIEW.action = action;
  hint(
    action === 'place'
      ? 'Tap the road to place Start at its surface height.'
      : 'Tap ahead of Start to set the driving direction.',
  );
  buildTools();
  buildSubbar();
  gizmoSync();
}
function trackScene() {
  const ids = new Map(S.materials.map((m, i) => [m.id, i]));
  return {
    materials: S.materials.map((m) => ({ ...m, texture: null })),
    objects: S.objects
      .filter((o) => o.visible)
      .map((o) => ({
        name: o.name,
        mesh: evaluateModifiers(o.mesh, o.modifiers),
        position: o.node.position.toArray(),
        quaternion: o.node.quaternion.toArray(),
        scale: o.node.scale.toArray(),
        materials: o.materials.map((id) => ids.get(id)),
      })),
  };
}
function trackTriangles() {
  const prep = _exPrepare(trackScene(), { yUp: true, bake: true }),
    triangles = [];
  for (const o of prep.objects)
    for (const f of o.faces) {
      const m = prep.materials[f.mat];
      if (m.kclEnabled === false) continue;
      for (const t of _exFaceTris(f))
        triangles.push({
          points: t.map((i) => f.pts[i].map((n) => n * S.track.scale)),
          flag: m.kclFinish ? 0 : (m.kclFlag ?? 0),
        });
    }
  return triangles;
}
function trackMaterials() {
  const ids = new Set();
  for (const o of S.objects)
    if (o.visible) for (const f of (o.renderMesh || o.mesh).faces) ids.add(o.materials[f.mat] ?? o.materials[0]);
  return S.materials.filter((m) => ids.has(m.id));
}
function trackCurrentMaterial() {
  const ms = trackMaterials();
  return ms.find((m) => m.id === TRACKVIEW.material) || ms[0];
}
function trackRefresh() {
  for (const child of [...trackOverlay.children]) {
    trackOverlay.remove(child);
    child.geometry.dispose();
    child.material.dispose();
  }
  TRACKVIEW.labels = [];
  trackOverlay.visible = S.workspace !== 'model';
  if (S.workspace === 'model') {
    requestRender();
    return;
  }
  const pos = [],
    colors = [],
    groups = new Map();
  scene.updateMatrixWorld(true);
  for (const o of S.objects) {
    if (!o.visible) continue;
    const mesh = o.renderMesh || o.mesh;
    for (const f of mesh.faces) {
      const m = matById(o.materials[f.mat] ?? o.materials[0]);
      if (!m) continue;
      let g = groups.get(m.id);
      if (!g) {
        g = { material: m, box: new THREE.Box3(), points: 0 };
        groups.set(m.id, g);
      }
      const col = new THREE.Color(
        m.kclEnabled === false ? '#555555' : m.kclFinish ? '#ffffff' : KCL_TYPES[(m.kclFlag ?? 0) & 31].color,
      );
      for (const t of triangulateFace(mesh, f))
        for (const i of t) {
          const p = new THREE.Vector3(...mesh.verts[f.v[i]]).applyMatrix4(o.node.matrixWorld);
          g.box.expandByPoint(p);
          g.points++;
          pos.push(...p.toArray());
          colors.push(col.r, col.g, col.b);
        }
    }
  }
  TRACKVIEW.labels = [...groups.values()];
  if (TRACKVIEW.colors && pos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    trackOverlay.add(new THREE.Mesh(geo, mat));
  }
  requestRender();
}
function drawTrack() {
  const canvas = $('#trackCanvas'),
    { w, h: height } = viewSize(),
    dpr = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, height);
  if (S.workspace === 'model') return;
  function label(p, text, color) {
    const s = toScreen(p);
    if (s.z < -1 || s.z > 1 || s.x < 0 || s.x > w || s.y < 0 || s.y > height) return;
    ctx.font = '600 12px system-ui';
    const width = ctx.measureText(text).width + 14;
    const x = Math.max(2, Math.min(w - width - 2, s.x - width / 2));
    ctx.fillStyle = '#171b25e8';
    ctx.fillRect(x, s.y - 24, width, 23);
    ctx.strokeStyle = color;
    ctx.strokeRect(x, s.y - 24, width, 23);
    ctx.fillStyle = color;
    ctx.fillText(text, x + 7, s.y - 8);
  }
  for (const g of TRACKVIEW.labels) {
    const m = g.material;
    if (m.kclFinish || m.id === TRACKVIEW.material) {
      label(
        g.box.getCenter(new THREE.Vector3()),
        m.kclFinish
          ? '⚑ Finish line · Road'
          : m.name + ' · ' + (m.kclEnabled === false ? 'No collision' : KCL_TYPES[(m.kclFlag ?? 0) & 31].name),
        m.kclFinish ? '#ffffff' : '#8de4ed',
      );
    }
  }
  drawCheckpoints(ctx);
  if (S.track.start) {
    const start = S.track.start,
      p = new THREE.Vector3(...start.position),
      yaw = start.rotation[1] * DEG,
      len = Math.max(0.5, CAM.dist * 0.06),
      q = p.clone().add(new THREE.Vector3(Math.sin(yaw) * len, -Math.cos(yaw) * len, 0)),
      a = toScreen(p),
      b = toScreen(q);
    if (a.z >= -1 && a.z <= 1 && b.z >= -1 && b.z <= 1) {
      ctx.strokeStyle = '#71f0aa';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.moveTo(b.x - 11 * Math.cos(angle - 0.5), b.y - 11 * Math.sin(angle - 0.5));
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x - 11 * Math.cos(angle + 0.5), b.y - 11 * Math.sin(angle + 0.5));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(a.x, a.y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    if(!checkpointActive())label(p, 'Start · ' + fmt(start.rotation[1], 1) + '°', '#71f0aa');
  }
}
// Picking must not depend on display shading, backface culling, or assigned KCL flags.
const trackPickMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
function trackHitMaterial(hit) {
  const o = hit.object.userData.obj;
  const f = (o.renderMesh || o.mesh).faces[o.rd.triFace[hit.faceIndex]];
  return matById(o.materials[f.mat] ?? o.materials[0]);
}
function trackIsDrivable(hit) {
  const m = trackHitMaterial(hit);
  const type = m?.kclFinish ? 0 : (m?.kclFlag ?? 0) & 31;
  return m?.kclEnabled !== false && [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 19, 21, 22, 23, 29].includes(type);
}
function trackHits(ray, drivable = false) {
  scene.updateMatrixWorld(true);
  const nodes = S.objects.filter((o) => o.visible).map((o) => o.meshNode);
  const materials = nodes.map((node) => node.material);
  try {
    for (const node of nodes) node.material = trackPickMaterial;
    return ray.intersectObjects(nodes, false).filter((hit) => !drivable || trackIsDrivable(hit));
  } finally {
    nodes.forEach((node, i) => {
      node.material = materials[i];
    });
  }
}
function trackTap(x, y) {
  if (S.workspace === 'kcl') {
    const hit = trackHits(screenRay(x, y))[0];
    if (!hit) return;
    const o = hit.object.userData.obj,
      f = (o.renderMesh || o.mesh).faces[o.rd.triFace[hit.faceIndex]];
    TRACKVIEW.material = o.materials[f.mat] ?? o.materials[0];
    selectObject(o, S.selOp);
    if (S.tool === 'select') openKCL();
    return;
  }
  if (checkpointActive()) return;
  if (TRACKVIEW.action === 'select') {
    if (S.tool === 'move' || S.tool === 'rotate') return;
    openKMP();
    return;
  }
  const hit = trackHits(screenRay(x, y))[0];
  if (!hit) {
    toast('No model surface under that tap. Frame the track, then tap a face.', true);
    return;
  }
  if (TRACKVIEW.action === 'place') {
    S.track.start = {
      position: [hit.point.x, hit.point.y, hit.point.z + S.track.clearance],
      rotation: S.track.start?.rotation.slice() || [0, 0, 0],
    };
    trackCommit('Place start');
    toast(
      trackIsDrivable(hit)
        ? 'Start placed at surface height'
        : 'Start placed. Assign a drivable KCL type to this surface before testing.',
      !trackIsDrivable(hit),
    );
  } else {
    const p = S.track.start.position,
      dx = hit.point.x - p[0],
      dy = hit.point.y - p[1];
    if (Math.hypot(dx, dy) < 1e-6) return;
    S.track.start.rotation = [0, Math.atan2(dx, -dy) / DEG, 0];
    trackCommit('Aim start');
    toast('Start direction updated');
  }
  TRACKVIEW.action = 'select';
  hint(null);
  buildTools();
  gizmoSync();
}
function trackSnapStart() {
  if (!S.track.start) throw new Error('Place a start point first');
  const p = S.track.start.position,
    box = new THREE.Box3();
  for (const o of S.objects) if (o.visible) box.expandByObject(o.node);
  if (box.isEmpty()) throw new Error('No track geometry');
  const ray = new THREE.Raycaster(new THREE.Vector3(p[0], p[1], box.max.z + 1), new THREE.Vector3(0, 0, -1));
  const hits = trackHits(ray).sort(
    (a, b) => Math.abs(a.point.z + S.track.clearance - p[2]) - Math.abs(b.point.z + S.track.clearance - p[2]),
  );
  if (!hits.length) throw new Error('No model surface beneath this X/Y position');
  p[2] = hits[0].point.z + S.track.clearance;
}
function trackFocusBox(box) {
  if (!box || box.isEmpty()) return;
  CAM.target.copy(box.getCenter(new THREE.Vector3()));
  CAM.dist = Math.max(2, box.getSize(new THREE.Vector3()).length() * 1.4);
  CAM.anim = null;
  applyCamera();
}
function trackFocusMaterial() {
  const m = trackCurrentMaterial();
  trackFocusBox(TRACKVIEW.labels.find((g) => g.material.id === m?.id)?.box);
}
function trackFocusStart() {
  if (!S.track.start) return;
  CAM.target.fromArray(S.track.start.position);
  CAM.anim = null;
  applyCamera();
}
function openKCL() {
  openSheet('KCL · Material collision', buildKCL, { panel: true, kind: 'kcl' });
}
function trackMaterialPreview(m, large = false) {
  const image = S.images.get(m.texture);
  const canvas = h('canvas', {
    class: 'collision-preview' + (large ? ' large' : ''),
    width: large ? 256 : 96,
    height: large ? 160 : 72,
    'aria-label': 'Texture preview for ' + m.name,
  });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = m.color || '#888888';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (image) {
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    ctx.drawImage(
      image.el,
      (canvas.width - image.width * scale) / 2,
      (canvas.height - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
  }
  return canvas;
}
function buildKCL(body) {
  const ms = trackMaterials(),
    m = trackCurrentMaterial();
  body.append(
    h(
      'p',
      { class: 'muted' },
      'Every face using a material shares its collision type. Hidden objects and disabled materials are excluded. Tap a surface to pick its material.',
    ),
  );
  if (!m) {
    body.append(h('p', {}, 'Assign a material to your mesh in Model first.'));
    return;
  }
  TRACKVIEW.material = m.id;
  body.append(
    h(
      'div',
      { class: 'collision-material-grid', 'aria-label': 'Material images' },
      ...ms.map((mat) => {
        const image = S.images.get(mat.texture);
        return h(
          'button',
          {
            class: 'collision-material' + (mat.id === m.id ? ' on' : ''),
            'aria-label': 'Choose material ' + mat.id + ': ' + mat.name,
            'aria-pressed': String(mat.id === m.id),
            onclick: () => {
              TRACKVIEW.material = mat.id;
              trackRefresh();
              refreshSheet(true);
            },
          },
          trackMaterialPreview(mat),
          h('strong', {}, mat.name + ' · #' + mat.id),
          h('span', { class: 'muted' }, image?.name || 'Color only'),
          h(
            'span',
            {},
            mat.kclEnabled === false
              ? 'No collision'
              : mat.kclFinish
                ? 'Finish line · Road'
                : KCL_TYPES[(mat.kclFlag ?? 0) & 31].name,
          ),
        );
      }),
    ),
  );
  const flag = m.kclFinish ? 0 : (m.kclFlag ?? 0),
    f = decodeKCLFlag(flag),
    type = KCL_TYPES[f.type];
  const change = (patch) => {
    Object.assign(m, patch);
    trackCommit('Collision · ' + m.name);
  };
  const c = h(
    'div',
    { class: 'card' },
    trackMaterialPreview(m, true),
    h(
      'span',
      { class: 'muted' },
      S.images.has(m.texture)
        ? S.images.get(m.texture).name +
            ' · ' +
            S.images.get(m.texture).width +
            ' × ' +
            S.images.get(m.texture).height +
            (m.useTexture === false ? ' · texture disabled' : '')
        : 'No image · color ' + m.color,
    ),
    field(
      'Material',
      selectInput(
        m.id,
        ms.map((m) => [m.id, m.name]),
        (id) => {
          TRACKVIEW.material = +id;
          trackRefresh();
          refreshSheet(true);
        },
        'Collision material',
      ),
    ),
    trackButton('Focus this material', trackFocusMaterial),
    trackButton('Show textures on track', () => {
      TRACKVIEW.colors = false;
      setShading('material');
      trackRefresh();
      buildShelf();
      closeSheet();
    }),
    checkInput('Include in KCL', m.kclEnabled !== false, (v) => change({ kclEnabled: v })),
    h('b', { id: 'collisionFlag' }, kclHex(flag) + ' · ' + (m.kclFinish ? 'Finish line (normal road)' : type.name)),
  );
  c.append(
    h(
      'div',
      { class: 'row' },
      ...[
        [0, 'Road'],
        [6, 'Boost panel'],
        [7, 'Boost ramp'],
        [3, 'Off-road'],
        [12, 'Wall'],
      ].map(([flag, name]) => trackButton(name, () => change({ kclFlag: flag, kclFinish: false, kclEnabled: true }))),
      trackButton('Finish line', () => change({ kclFlag: 0, kclFinish: true, kclEnabled: true })),
    ),
  );
  c.append(
    field(
      'Base type',
      selectInput(
        f.type,
        KCL_TYPES.map((t) => [t.id, kclHex(t.id) + ' · ' + t.name]),
        (id) =>
          change({
            kclFlag: encodeKCLFlag({ ...f, type: +id, variant: 0, trick: [7, 8, 19].includes(+id) ? false : f.trick }),
            kclFinish: false,
          }),
        'KCL base type',
      ),
    ),
    field(
      'Variant',
      selectInput(
        f.variant,
        type.variants.map((n, i) => [i, i + ' · ' + n]),
        (v) => change({ kclFlag: encodeKCLFlag({ ...f, variant: +v }), kclFinish: false }),
        'KCL variant',
      ),
    ),
  );
  if (type.note) c.append(h('p', { class: 'muted' }, type.note));
  if (m.kclFinish)
    c.append(
      h(
        'p',
        { class: 'muted' },
        'Editor marker only. Exports Road 0x0000; a real lap gate belongs in KMP checkpoints. The label stays visible in KCL and KMP.',
      ),
    );
  c.append(
    field(
      'BLIGHT / effect index',
      selectInput(
        f.blight,
        Array.from({ length: 8 }, (_, i) => [i, i]),
        (v) => change({ kclFlag: encodeKCLFlag({ ...f, blight: +v }), kclFinish: false }),
        'KCL BLIGHT index',
      ),
    ),
    field(
      'Wheel depth',
      selectInput(
        f.depth,
        [0, 1, 2, 3].map((i) => [i, i]),
        (v) => change({ kclFlag: encodeKCLFlag({ ...f, depth: +v }), kclFinish: false }),
        'KCL wheel depth',
      ),
    ),
    ...[
      ['trick', 'Trickable'],
      ['reject', 'Reject road'],
      ['soft', 'Soft wall'],
    ].map(([key, label]) =>
      checkInput(label, f[key], (v) => change({ kclFlag: encodeKCLFlag({ ...f, [key]: v }), kclFinish: false })),
    ),
  );
  const raw = h('input', { 'aria-label': 'Raw KCL flag', type: 'text', value: kclHex(flag), maxlength: 6 });
  raw.addEventListener('change', () => {
    const s = raw.value.trim();
    if (!/^(?:0x)?[0-9a-f]{1,4}$/i.test(s)) {
      raw.value = kclHex(flag);
      toast('Enter a hexadecimal flag from 0000 to FFFF', true);
      return;
    }
    change({ kclFlag: parseInt(s.replace(/^0x/i, ''), 16), kclFinish: false });
  });
  c.append(field('Raw hexadecimal flag', raw));
  body.append(
    c,
    h(
      'div',
      { class: 'card' },
      trackScaleField(),
      h('p', { class: 'muted' }, 'Shared by BRRES, KCL and KMP. Changing scale requires re-exporting all three.'),
      trackButton('Export & Send KCL…', () => trackExport('kcl'), true),
      trackButton('Road type list', openKCLCatalog),
      trackButton('Send material assignments CSV', () =>
        shareOrDownload('collision-materials.csv', new Blob([trackAssignmentsCSV()], { type: 'text/csv' })),
      ),
    ),
  );
}
function trackAssignmentsCSV() {
  const rows = [['material', 'enabled', 'editor_label', 'flag', 'type', 'variant']];
  for (const m of trackMaterials()) {
    const flag = m.kclFinish ? 0 : (m.kclFlag ?? 0),
      f = decodeKCLFlag(flag);
    rows.push([
      m.name,
      m.kclEnabled !== false,
      m.kclFinish ? 'Finish line' : '',
      kclHex(flag),
      KCL_TYPES[f.type].name,
      KCL_TYPES[f.type].variants[f.variant],
    ]);
  }
  return rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
}
function openKCLCatalog() {
  openSheet('KCL · All road & collision types', (body) => {
    const search = h('input', {
        type: 'search',
        placeholder: 'Search road, boost, wall…',
        'aria-label': 'Search collision types',
      }),
      list = h('div', { class: 'trackCatalog' });
    const render = () => {
      list.replaceChildren();
      for (const t of KCL_TYPES.filter((t) =>
        (t.name + ' ' + t.variants.join(' ') + ' ' + kclHex(t.id)).toLowerCase().includes(search.value.toLowerCase()),
      ))
        list.append(
          h(
            'details',
            { class: 'card' },
            h('summary', {}, kclHex(t.id) + ' · ' + t.name),
            h('p', { class: 'muted' }, t.note || 'Choose a variant below; unknown values are marked.'),
            ...t.variants.map((n, i) => h('div', {}, kclHex(t.id | (i << 5)) + ' · ' + i + ' · ' + n)),
          ),
        );
    };
    search.addEventListener('input', render);
    render();
    body.append(
      search,
      trackButton('Export & Send type list CSV…', () =>
        shareOrDownload('mkw-kcl-types.csv', new Blob([kclCatalogCSV()], { type: 'text/csv' })),
      ),
      h(
        'p',
        { class: 'muted' },
        '32 base types · 8 variants each. Extra bits: BLIGHT 8–10, depth 11–12, trick 13, reject 14, soft wall 15.',
      ),
      h(
        'a',
        { href: 'https://mkwiiki.org/wiki/KCL_flag', target: '_blank', rel: 'noopener' },
        'Full flag reference and track-slot effects',
      ),
      list,
    );
  });
}
function openKMP() {
  openSheet('KMP · Start point', buildKMP, { panel: true, kind: 'kmp' });
}
function buildKMP(body) {
  const start = S.track.start;
  const c = h(
    'div',
    { class: 'card' },
    h('h3', {}, 'Start position · KTPT'),
    h(
      'p',
      { class: 'muted' },
      'Place Start, then tap the road. Height snaps to that surface. Aim Start, then tap ahead to set the driving direction.',
    ),
    h(
      'div',
      { class: 'row' },
      trackButton('Place Start', () => trackAction('place'), true),
      trackButton('Aim Start', () => trackAction('aim')),
    ),
    field(
      'Height above surface',
      numInput(
        S.track.clearance,
        (v) => {
          S.track.clearance = v;
          trackCommit('Start clearance');
        },
        { min: 0, max: 100, label: 'Start clearance' },
      ),
    ),
  );
  if (start) {
    c.append(
      xyzField('Editor position (Z is height)', start.position, (values, axis) => {
        const prev = start.position;
        start.position = values;
        try {
          if (axis !== 2) trackSnapStart();
          trackCommit('Move start');
        } catch (e) {
          start.position = prev;
          toast(e.message, true);
          refreshSheet(true);
        }
      }),
      field(
        'Driving direction (Wii yaw °)',
        numInput(
          start.rotation[1],
          (v) => {
            start.rotation[1] = v;
            trackCommit('Rotate start');
          },
          { label: 'Start yaw' },
        ),
      ),
      trackButton('Snap height again', () => {
        try {
          trackSnapStart();
          trackCommit('Snap start height');
        } catch (e) {
          toast(e.message, true);
        }
      }),
      h(
        'p',
        { class: 'muted' },
        'Wii position X / Y / Z: ' +
          trackToWii(start.position, S.track.scale)
            .map((v) => fmt(v, 2))
            .join(' / '),
      ),
      h(
        'p',
        { class: 'muted' },
        '0° points toward editor −Y; 90° toward +X. Multiples of 90° avoid the vanilla minimap start-line bug.',
      ),
    );
  }
  body.append(
    c,
    h('div',{class:'card'},h('h3',{},'Checkpoints'),h('p',{class:'muted'},(S.track.checkpoints?.points.length||0)+' checkpoint lines · draw, edit, or set normal/key/lap types.'),trackButton('Draw checkpoints',()=>checkpointActivate(),true),trackButton('Checkpoint settings',openCheckpoints)),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'KMP file'),
      trackScaleField(),
      trackButton('Open existing KMP…', () => $('#fileKMP').click()),
      h(
        'p',
        { id: 'kmpTemplate', class: 'muted' },
        S.track.template
          ? 'Updating: ' +
              S.track.templateName +
              '. Start and edited checkpoint data are updated; other entries and sections are preserved.'
          : 'Automatic Time Trials test setup supplies temporary enemy/item routes, cameras and a respawn at Start. Your drawn checkpoints replace its placeholder loop. Routes are not fitted to the track; import a working KMP to retain existing routes and respawns.',
      ),
      (S.track.template || S.track.checkpoints?.dirty)
        ? trackButton('Use automatic test setup', () => {
            S.track.template = null;
            S.track.templateName = '';
            S.track.checkpoints = null;
            CHECKPOINT.selected = -1;
            trackCommit('Automatic KMP setup');
          })
        : null,
      trackButton('Export & Send KMP…', () => trackExport('kmp'), true),
      h(
        'p',
        { class: 'muted' },
        'Export includes your checkpoint lines, types, direction and group links. Use the SZS editor to replace course.kmp alongside the course model and collision. Enemy/item routes and respawn positions are not fitted to your new mesh.',
      ),
    ),
  );
}
$('#fileKMP').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('KMP file is too large');
    const bytes = new Uint8Array(await file.arrayBuffer()),
      parsed = inspectKMP(bytes);
    const checkpoints=checkpointsFromKMP(parsed,S.track.scale,parsed.start?trackFromWii(parsed.start.position,S.track.scale)[2]:CAM.target.z);
    checkpointCancel();CHECKPOINT.selected=-1;CHECKPOINT.group=0;
    S.track.checkpoints=checkpoints;
    S.track.template = b64FromBytes(bytes);
    S.track.templateName = file.name;
    if (parsed.start)
      S.track.start = { position: trackFromWii(parsed.start.position, S.track.scale), rotation: parsed.start.rotation };
    trackCommit('Open KMP');
    openKMP();
  } catch (e) {
    toast(e.message, true);
  }
});
function trackExport(kind) {
  try {
    let bytes,
      report = '';
    if (kind === 'kcl') {
      const result = exportKCL(trackTriangles());
      bytes = result.bytes;
      report =
        'KCL: ' +
        result.triangleCount +
        ' triangles' +
        (result.skipped ? ' · ' + result.skipped + ' degenerate triangles skipped' : '');
    } else
      bytes = exportKMP(S.track.start, {
        scale: S.track.scale,
        template: S.track.template ? bytesFromB64(S.track.template) : null,
        checkpoints: S.track.checkpoints,
      });
    shareOrDownload('course.' + kind, new Blob([bytes], { type: 'application/octet-stream' }));
    if (report) toast(report);
  } catch (e) {
    toast(e.message, true);
  }
}
