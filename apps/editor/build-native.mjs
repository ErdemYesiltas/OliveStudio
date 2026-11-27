import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { build as viteBuild } from 'vite';
import { buildServer } from '../../scripts/build-server.mjs';
import { fileURLToPath } from 'node:url';

const output = resolve(process.argv[2] ?? 'dist/asset-import.cjs');
const root = fileURLToPath(new URL('.', import.meta.url));
const vscode = process.argv.includes('--vscode');
const renderer = process.argv[2] ? join(dirname(output), 'renderer') : join(root, 'dist');

if (!vscode) await build({
  entryPoints: [join(root, 'preload.cjs')],
  outfile: join(dirname(output), 'preload.cjs'),
  platform: 'node', target: 'node22', format: 'cjs', bundle: true, external: ['electron'],
});

await build({
  entryPoints: [fileURLToPath(new URL('./asset-import.mjs', import.meta.url))],
  outfile: output,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  bundle: true,
  // Unzipper's optional S3 adapter is unused by local archive imports.
  external: ['@aws-sdk/client-s3'],
  plugins: [{
    name: 'assetpack-crc32',
    setup(build) {
      // AssetPack uses this only for CRC32. Electron already ships the same algorithm in Node.
      build.onResolve({ filter: /^@node-rs\/crc32$/ }, () => ({ path: 'crc32', namespace: 'node-crc32' }));
      build.onLoad({ filter: /^crc32$/, namespace: 'node-crc32' }, () => ({
        contents: "import { crc32 } from 'node:zlib'; export default { crc32 };",
      }));
    },
  }],
});

await build({
  entryPoints: [join(root, 'src/gameExport.node.ts')],
  outfile: join(dirname(output), 'game-export.cjs'),
  platform: 'node', target: 'node22', format: 'cjs', bundle: true,
  loader: { '.json': 'json' },
});
const hubClient = [process.env.LOCALHUB_DIR, resolve(root, '../../localhub'), resolve(root, '../../../localhub')]
  .filter(Boolean).map(directory => join(directory, 'clients/typescript/src/index.ts')).find(existsSync);
const hubBundle = join(dirname(output), 'localhub.cjs');
if (hubClient) {
  await build({
    entryPoints: [resolve(root, vscode ? 'native/native-localhub.mts' : 'native/electron-localhub.mts')],
    outfile: hubBundle, platform: 'node', target: 'node22', format: 'cjs', bundle: true,
    alias: { '@localhub/client': hubClient }, external: ['electron'],
  });
} else {
  await writeFile(hubBundle, 'module.exports = {};\n');
}
await viteBuild({
  root, configFile: false, base: './',
  build: { outDir: join(renderer, 'game-runtime'), emptyOutDir: true, rollupOptions: { input: join(root, 'game.html') } },
});

await buildServer({outDir: join(dirname(output), 'network-server')});
