// Archive changes are separate from project autosave. Export a copy to retain them.
const SZED = {
  archive: null,
  name: '',
  selected: null,
  changes: new Map(),
  search: '',
  page: 0,
  busy: '',
  error: '',
  target: null,
};
function szsWorker(action, payload) {
  const source =
    `const SZS_MAX_SIZE=${SZS_MAX_SIZE};\n` +
    [_szsBytes, _szsMagic, decodeYaz0, encodeYaz0, inspectSZS, szsEntryBytes, saveSZS]
      .map((fn) => fn.toString())
      .join('\n') +
    `\nonmessage=({data})=>{try{const result=data.action==='inspect'?inspectSZS(data.payload):saveSZS(data.payload.archive,data.payload.changes);postMessage({result});}catch(e){postMessage({error:e.message});}};`;
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    let worker, timeout;
    const done = () => {
      clearTimeout(timeout);
      worker?.terminate();
      URL.revokeObjectURL(url);
    };
    try {
      worker = new Worker(url);
      timeout = setTimeout(() => {
        done();
        reject(new Error('Archive operation timed out. Try a smaller archive.'));
      }, 120000);
      worker.onmessage = ({ data }) => {
        done();
        data.error ? reject(new Error(data.error)) : resolve(data.result);
      };
      worker.onerror = () => {
        done();
        reject(new Error('Archive worker failed. Reopen the editor and try again.'));
      };
      worker.postMessage({ action, payload });
    } catch (e) {
      done();
      reject(e);
    }
  });
}
function szsRefresh() {
  if (SHEET.kind === 'szs') refreshSheet(true);
}
function szsError(e) {
  SZED.error = e.message || String(e);
  szsRefresh();
  toast(SZED.error, true);
}
function openSZSEditor() {
  openSheet('SZS · Track archive', buildSZSEditor, { panel: true, kind: 'szs' });
}
async function loadSZSEditor(bytes, name = 'course.szs') {
  if (SZED.busy) throw new Error('Wait for the current archive operation');
  SZED.busy = 'Opening archive…';
  SZED.error = '';
  szsRefresh();
  try {
    const archive = await szsWorker('inspect', bytes);
    Object.assign(SZED, {
      archive,
      name,
      selected: archive.nodes.find((n) => !n.directory)?.id ?? null,
      changes: new Map(),
      search: '',
      page: 0,
      target: null,
    });
    return archive;
  } finally {
    SZED.busy = '';
    szsRefresh();
  }
}
function szsStage(id, bytes) {
  if (SZED.busy) throw new Error('Wait for the current archive operation');
  const node = SZED.archive?.nodes[id];
  if (!node || node.directory) throw new Error('Select an archive file');
  const b = _szsBytes(bytes);
  if (b.length > SZS_MAX_SIZE) throw new Error('Replacement exceeds 128 MiB');
  if (/\.brres$/i.test(node.name)) inspectBRRES(b);
  if (/\.kmp$/i.test(node.name)) inspectKMP(b);
  if (/\.kcl$/i.test(node.name)) {
    if (b.length < 60) throw new Error('Not a Wii KCL file');
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength),
      offsets = [v.getUint32(0), v.getUint32(4), v.getUint32(8) + 16, v.getUint32(12)];
    if (offsets[0] < 60 || offsets[3] >= b.length || offsets.some((n, i) => i && n < offsets[i - 1]))
      throw new Error('Invalid Wii KCL section offsets');
  }
  // Check total before retaining the replacement; rebuilding checks alignment as well.
  let total = Math.ceil(SZED.archive.headerEnd / 32) * 32;
  for (const n of SZED.archive.nodes)
    if (!n.directory)
      total += Math.ceil((n.id === id ? b.length : szsEntryBytes(SZED.archive, n.id, SZED.changes).length) / 32) * 32;
  if (total > SZS_MAX_SIZE) throw new Error('Updated archive exceeds 128 MiB');
  SZED.changes.set(id, b.slice());
  SZED.error = '';
  szsRefresh();
}
function szsProjectFile(name) {
  if (name === 'course.kcl') return exportKCL(trackTriangles()).bytes;
  if (name === 'course.kmp')
    return exportKMP(S.track.start, {
      scale: S.track.scale,
      template: S.track.template ? bytesFromB64(S.track.template) : null,
    });
  return runExport('brres', {
    baseName: 'course_model',
    selectedOnly: false,
    zip: false,
    scale: S.track.scale,
    textureSize: settingsGet('export', {}).textureSize || 512,
  }).data;
}
function szsApplyProject(all = true) {
  if (!SZED.archive || SZED.busy) throw new Error('Open an archive and wait for it to finish loading');
  const names = ['course_model.brres', 'course.kcl', 'course.kmp'];
  const selected = SZED.archive.nodes[SZED.selected];
  const wanted = all ? names : [selected?.name.toLowerCase()];
  const edits = [];
  for (const name of wanted) {
    if (!names.includes(name)) throw new Error('Choose course_model.brres, course.kcl or course.kmp');
    const matches = all ? SZED.archive.nodes.filter((n) => !n.directory && n.name.toLowerCase() === name) : [selected];
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? 'Multiple ' + name + ' entries: select and replace each explicitly.'
          : 'Archive is missing ' + name + '. Use a complete Wii track package.',
      );
    edits.push([matches[0].id, szsProjectFile(name)]);
  }
  // All exports and validation must succeed before committing any replacements.
  const before = SZED.changes;
  SZED.changes = new Map(before);
  try {
    for (const [id, bytes] of edits) szsStage(id, bytes);
  } catch (e) {
    SZED.changes = before;
    szsRefresh();
    throw e;
  }
  szsRefresh();
  toast(edits.length + ' course file' + (edits.length === 1 ? '' : 's') + ' replaced. Save SZS to keep them.');
}
async function szsSave() {
  if (!SZED.archive || SZED.busy) return;
  SZED.busy = 'Packing and compressing SZS…';
  SZED.error = '';
  szsRefresh();
  try {
    const bytes = await szsWorker('save', { archive: SZED.archive, changes: SZED.changes });
    // Keep sharing within a fresh tap on iOS, after compression completes.
    SZED.busy = '';
    szsRefresh();
    const name = safeFileName(SZED.name.replace(/\.(szs|u8|arc)$/i, '')) + '_edited.szs';
    openSheet('SZS ready', (body) =>
      body.append(
        h('p', {}, name + ' · ' + brresSize(bytes.length)),
        trackButton('Save & Send SZS…', () => shareOrDownload(name, bytes), true),
        trackButton('Back to SZS editor', openSZSEditor),
      ),
    );
  } catch (e) {
    SZED.busy = '';
    szsError(e);
  }
}
function szsButton(text, run, primary = false) {
  const b = trackButton(
    text,
    () => {
      try {
        run();
      } catch (e) {
        szsError(e);
      }
    },
    primary,
  );
  Object.assign(b.style, {
    height: 'auto',
    minHeight: '38px',
    whiteSpace: 'normal',
    textAlign: 'left',
    width: '100%',
    overflowWrap: 'anywhere',
  });
  b.disabled = !!SZED.busy;
  return b;
}
function buildSZSEditor(body) {
  body.append(
    szsButton(
      SZED.changes.size ? 'Open another SZS… (discards replacements)' : 'Open SZS…',
      () => $('#fileSZS').click(),
      true,
    ),
  );
  body.append(
    h(
      'p',
      { class: 'muted' },
      'Open an existing Mario Kart Wii track archive. Replace files, then save a compressed SZS copy. Archive edits stay in memory and are not included in project autosave.',
    ),
  );
  if (SZED.error) body.append(h('p', { class: 'brres-error', role: 'alert' }, SZED.error));
  if (SZED.busy) body.append(h('p', { role: 'status' }, SZED.busy));
  const a = SZED.archive;
  if (!a) return;
  body.append(
    h(
      'div',
      { class: 'card' },
      h('strong', { style: { overflowWrap: 'anywhere' } }, SZED.name),
      h(
        'span',
        {},
        `${a.compressed ? 'Yaz0 / U8' : 'Uncompressed U8'} · ${brresSize(a.bytes.length)} unpacked · ${a.nodes.filter((n) => !n.directory).length} files`,
      ),
      h(
        'span',
        { id: 'szsChanges', 'aria-live': 'polite' },
        `${SZED.changes.size} replacement${SZED.changes.size === 1 ? '' : 's'} staged`,
      ),
      szsButton('Prepare SZS download', szsSave, true),
      szsButton('Use current project course files', () => szsApplyProject(true)),
      h(
        'p',
        { class: 'muted' },
        'Replaces course_model.brres, course.kcl and course.kmp together, using the shared Wii scale. Other resources, object files and paths are preserved. Their positions may need adjustment for your new track.',
      ),
    ),
  );
  const search = h('input', {
      type: 'search',
      placeholder: 'Search file paths or types…',
      'aria-label': 'Search archive files',
      value: SZED.search,
      disabled: !!SZED.busy,
    }),
    list = h('div', { class: 'szs-list', 'aria-label': 'Archive file list' }),
    paging = h('div', { class: 'row' });
  const renderList = () => {
    list.replaceChildren();
    paging.replaceChildren();
    const nodes = a.nodes
      .slice(1)
      .filter((n) =>
        (n.path + ' ' + (n.directory ? 'folder' : szsFileType(szsEntryBytes(a, n.id, SZED.changes), n.name)))
          .toLowerCase()
          .includes(SZED.search.toLowerCase()),
      );
    const pages = Math.max(1, Math.ceil(nodes.length / 100));
    SZED.page = Math.min(SZED.page, pages - 1);
    for (const n of nodes.slice(SZED.page * 100, SZED.page * 100 + 100)) {
      if (n.directory) {
        list.append(h('div', { class: 'szs-folder' }, '▾ ' + n.path + '/'));
        continue;
      }
      const b = szsEntryBytes(a, n.id, SZED.changes);
      list.append(
        h(
          'button',
          {
            class: 'szs-entry' + (n.id === SZED.selected ? ' on' : ''),
            'aria-label': 'Select archive file ' + n.path,
            'aria-pressed': String(n.id === SZED.selected),
            disabled: !!SZED.busy,
            onclick: () => {
              SZED.selected = n.id;
              SZED.error = '';
              szsRefresh();
            },
          },
          h('strong', {}, n.path),
          h(
            'small',
            {},
            szsFileType(b, n.name) + ' · ' + brresSize(b.length) + (SZED.changes.has(n.id) ? ' · REPLACED' : ''),
          ),
        ),
      );
    }
    if (!nodes.length) list.append(h('p', {}, 'No matching files.'));
    if (pages > 1) {
      const prev = szsButton('Previous', () => {
          SZED.page--;
          renderList();
        }),
        next = szsButton('Next', () => {
          SZED.page++;
          renderList();
        });
      prev.disabled ||= SZED.page === 0;
      next.disabled ||= SZED.page === pages - 1;
      paging.append(prev, h('span', {}, `${SZED.page + 1} / ${pages}`), next);
    }
  };
  search.addEventListener('input', () => {
    SZED.search = search.value;
    SZED.page = 0;
    renderList();
  });
  renderList();
  body.append(search, list, paging);
  const n = a.nodes[SZED.selected];
  if (n && !n.directory) {
    const bytes = szsEntryBytes(a, n.id, SZED.changes),
      card = h(
        'div',
        { class: 'card' },
        h('h3', { style: { overflowWrap: 'anywhere' } }, n.path),
        h('span', {}, szsFileType(bytes, n.name) + ' · ' + brresSize(bytes.length)),
        szsButton(
          'Replace selected file…',
          () => {
            SZED.target = { archive: a, id: n.id };
            $('#fileSZSReplace').click();
          },
          true,
        ),
        szsButton('Download selected file', () => shareOrDownload(n.name, bytes)),
      );
    if (SZED.changes.has(n.id))
      card.append(
        szsButton('Revert selected file', () => {
          SZED.changes.delete(n.id);
          SZED.error = '';
          szsRefresh();
        }),
      );
    if (['course_model.brres', 'course.kcl', 'course.kmp'].includes(n.name.toLowerCase()))
      card.append(szsButton('Replace with current project ' + n.name, () => szsApplyProject(false)));
    if (/\.brres$/i.test(n.name)) {
      card.append(szsButton('Open selected BRRES in texture editor', () => loadBRRESEditor(bytes, n.name)));
      if (BRED.archive)
        card.append(
          szsButton('Replace with BRRES editor: ' + BRED.name, () =>
            szsStage(n.id, saveBRRESEdits(BRED.archive, BRED.changes)),
          ),
        );
    }
    body.append(card);
  }
  if (SZED.changes.size)
    body.append(
      szsButton('Revert all replacements', () => {
        SZED.changes.clear();
        SZED.error = '';
        szsRefresh();
      }),
    );
}
$('#fileSZS').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    if (file.size > (SZS_MAX_SIZE * 9) / 8 + 16) throw new Error('Archive is too large');
    await loadSZSEditor(new Uint8Array(await file.arrayBuffer()), file.name);
    openSZSEditor();
  } catch (e) {
    szsError(e);
  }
});
$('#fileSZSReplace').addEventListener('change', async (e) => {
  const file = e.target.files[0],
    target = SZED.target || { archive: SZED.archive, id: SZED.selected };
  e.target.value = '';
  SZED.target = null;
  if (!file) return;
  try {
    if (file.size > SZS_MAX_SIZE) throw new Error('Replacement exceeds 128 MiB');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (SZED.archive !== target.archive) throw new Error('The archive changed. Select the file again.');
    szsStage(target.id, bytes);
    toast('Replaced ' + SZED.archive.nodes[target.id].path);
  } catch (e) {
    szsError(e);
  }
});
