// Optional independent compatibility check against a separate noclip checkout.
// Usage: node test/build-noclip-parser.mjs /path/to/noclip.website
import esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
const root = path.resolve(process.argv[2] || '../noclip.website');
const gxSource = fs.readFileSync(path.join(root, 'src/gx/gx_render.ts'), 'utf8');
const markers = ['export class GXTextureMapping', 'export class MaterialParams', 'function autoOptimizeMaterialHasPostTexMtxBlock', 'export function translateCullMode'];
if (!markers.every(s => gxSource.includes(s))) throw new Error('Unsupported noclip revision; see TRACK-AUTHORING.md for the tested commit');
await esbuild.build({
  stdin: { contents: `export {parse} from ${JSON.stringify(path.join(root, 'src/rres/brres.ts'))};\nexport {default as ArrayBufferSlice} from ${JSON.stringify(path.join(root, 'src/ArrayBufferSlice.ts'))};`, resolveDir: root },
  bundle: true, platform: 'node', format: 'esm', outfile: 'work/noclip-parser.mjs', nodePaths: [path.resolve('node_modules')],
  plugins: [{ name: 'parser-only', setup(build) {
    // Keep the original class/optimizer implementations, without loading UI/render code.
    build.onLoad({ filter: /gx_render\.ts$/ }, args => ({
      contents: "import * as GX from './gx_enum.js';\nimport {TextureMapping} from '../TextureHolder.js';\n" + gxSource.slice(gxSource.indexOf(markers[0]), gxSource.indexOf(markers[1])) + gxSource.slice(gxSource.indexOf(markers[2]), gxSource.indexOf(markers[3])),
      loader: 'ts', resolveDir: path.dirname(args.path),
    }));
    build.onResolve({ filter: /^noclip-rust-support$/ }, args => ({ path: args.path, namespace: 'unused-wasm' }));
    build.onLoad({ filter: /.*/, namespace: 'unused-wasm' }, () => ({ contents: 'export default function init() { throw new Error("WASM is not used for BRRES parsing"); }', loader: 'js' }));
  } }],
});
console.log('Built independent parser in work/noclip-parser.mjs');
