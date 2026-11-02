// Loads src/export.js the way the app build does: strip `export`, evaluate in one scope.
// Also enforces the module rules (no imports, private top-level names prefixed _ex/_EX).
'use strict';
const fs = require('fs');
const path = require('path');

function loadExport() {
  const file = path.join(__dirname, '..', 'src', 'export.js');
  const src = fs.readFileSync(file, 'utf8');
  if (/^\s*import[\s{(*]/m.test(src)) throw new Error('export.js contains an import statement');
  if (/\brequire\s*\(/.test(src)) throw new Error('export.js uses require()');
  const exported = [...src.matchAll(/^export\s+(?:function|const|let)\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
  const topLevel = [...src.matchAll(/^(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
  const bad = topLevel.filter((n) => !/^_ex|^_EX/.test(n));
  if (bad.length) throw new Error('unprefixed private top-level names: ' + bad.join(', '));
  const body = src.replace(/^export\s+/gm, '');
  // eslint-disable-next-line no-new-func
  const api = new Function('"use strict";\n' + body + '\nreturn {' + exported.join(',') + ', _private: { _exTriangulate, _exQuatToEulerXYZDeg, _exNewell } };')();
  return { api, exported };
}

module.exports = { loadExport };
