import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const root = join(source, '../..');
const editor = join(root, 'apps/editor');
const { build } = createRequire(join(editor, 'package.json'))('esbuild');
const out = join(source, 'dist');
const renderer = join(out, 'renderer');
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' });

run('pnpm', ['--filter', '@olivestudio/editor', 'build', '--outDir', renderer, '--emptyOutDir']);
run(process.execPath, ['build-native.mjs', join(out, 'asset-import.cjs'), '--vscode'], editor);
await Promise.all([
  build({ entryPoints: [join(source, 'extension.mjs')], outfile: join(out, 'extension.cjs'), bundle: true,
    platform: 'node', target: 'node22', format: 'cjs', external: ['vscode'] }),
  build({ entryPoints: [join(source, 'webview.mjs')], outfile: join(renderer, 'host.js'), bundle: true, format: 'iife', target: 'chrome130' }),
  cp(join(editor, 'build/icon.png'), join(out, 'icon.png')),
  cp(join(source, 'activity.png'), join(out, 'activity.png')),
  cp(join(root, 'examples/object-gallery/object-gallery.json'), join(out, 'object-gallery.json')),
  cp(join(root, 'third-party/SPINE-RUNTIMES-LICENSE.txt'), join(out, 'SPINE-RUNTIMES-LICENSE.txt')),
  cp(join(source, 'README.md'), join(out, 'README.md')),
  cp(join(source, 'PANEL-PARITY.md'), join(out, 'PANEL-PARITY.md')),
]);
const { dependencies: _dependencies, ...manifest } = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
await writeFile(join(out, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');

if (process.argv.includes('--package')) {
  const release = join(root, 'release');
  await mkdir(release, { recursive: true });
  const archive = join(release, `olivestudio-${manifest.version}.vsix`);
  run('pnpm', ['dlx', '@vscode/vsce@3.9.2', 'package', '--no-dependencies', '--skip-license', '--allow-missing-repository', '--out', archive], out);
}
