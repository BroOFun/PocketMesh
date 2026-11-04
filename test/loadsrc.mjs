import fs from 'fs';
export async function loadSrc(...names) {
  names = ['triangulate.js', ...names.filter(n => n !== 'triangulate.js')];
  const code = names.map(n => fs.readFileSync(new URL('../src/' + n, import.meta.url), 'utf8')).join('\n');
  // collect exported names
  const exp = [...code.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/gm)].map(m => m[1]);
  const body = code.replace(/^export\s+/gm, '') + `\nexport { ${exp.join(', ')} };`;
  return import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
}
