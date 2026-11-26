import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetPack } from '@assetpack/core';
import { pixiManifest } from '@assetpack/core/manifest';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { assetMime, readManifest } from './src/assets';
import { t } from './src/i18n';

const sourceRoot = fileURLToPath(new URL('./raw-assets', import.meta.url));

async function stageSources(source: string, destination: string): Promise<number> {
  await mkdir(destination, { recursive: true });
  let count = 0;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      count += await stageSources(from, to);
    } else if (entry.isFile() && assetMime(entry.name)) {
      const bytes = await readFile(from);
      if (!bytes.length) throw new Error(t('emptyAsset', { path: from }));
      await writeFile(to, bytes);
      count++;
    }
  }
  return count;
}

async function packAssets() {
  const temp = await mkdtemp(join(tmpdir(), 'olivestudio-assetpack-'));
  try {
    const input = join(temp, 'input');
    const output = join(temp, 'output');
    const expectedCount = await stageSources(sourceRoot, input);
    const pack = new AssetPack({
      entry: input, output, cacheLocation: join(temp, 'cache'), cache: false, strict: true, logLevel: 'error',
      pipes: [pixiManifest({ nameStyle: 'relative', includeMetaData: false })],
    });
    try {
      await pack.run();
    } finally {
      await pack.stop();
    }
    const manifest = await readFile(join(output, 'manifest.json'));
    const bundles = readManifest(JSON.parse(manifest.toString()), '');
    const assets = bundles.flatMap(bundle => bundle.assets);
    if (assets.length !== expectedCount) throw new Error(t('incompleteManifest'));

    const files = new Map([['manifest.json', manifest]]);
    for (const { path } of assets) {
      if (files.has(path)) throw new Error(t('duplicateOutput', { path }));
      files.set(path, await readFile(join(output, path)));
    }
    return files;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function assetPackPlugin(): Plugin {
  return {
    name: 'olivestudio-assetpack',
    async configureServer(server) {
      const prefix = server.config.base + 'assetpack/';
      let current: string | undefined;
      let failure: string | undefined;
      let queue = Promise.resolve();
      const snapshots = new Map<string, Awaited<ReturnType<typeof packAssets>>>();
      const rebuild = () => {
        queue = queue.then(async () => {
          try {
            const files = await packAssets();
            const generation = randomUUID();
            snapshots.set(generation, files);
            if (snapshots.size > 2) snapshots.delete(snapshots.keys().next().value!);
            current = generation;
            failure = undefined;
          } catch (error) {
            failure = error instanceof Error ? error.message : String(error);
            server.config.logger.error(failure);
          }
        });
        return queue;
      };

      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (!pathname.startsWith(prefix)) return next();

        const path = pathname.slice(prefix.length);
        const sendStatus = () => {
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ generation: current ?? null, error: failure ?? null }));
        };
        if (path === 'status' && req.method === 'GET') return sendStatus();
        if (path === 'rebuild' && req.method === 'POST' && req.headers['x-olive-rebuild'] === '1') {
          void rebuild().then(sendStatus);
          return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const [generation, ...parts] = path.split('/');
          const filename = parts.map(decodeURIComponent).join('/');
          const bytes = snapshots.get(generation)?.get(filename);
          if (bytes) {
            res.setHeader('Content-Type', assetMime(filename) ?? 'application/json');
            res.setHeader('Cache-Control', 'max-age=31536000, immutable');
            res.end(req.method === 'HEAD' ? undefined : bytes);
            return;
          }
        } catch {
          res.statusCode = 400;
          res.end();
          return;
        }
        res.statusCode = 404;
        res.end();
      });
      await rebuild();
    },
    async generateBundle() {
      for (const [filename, source] of await packAssets()) {
        this.emitFile({ type: 'asset', fileName: `assetpack/${filename}`, source });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  base: './',
  define: { __ASSETPACK_REBUILD__: command === 'serve' },
  plugins: [react(), assetPackPlugin()],
}));
