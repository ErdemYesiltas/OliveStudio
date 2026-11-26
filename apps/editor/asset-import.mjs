import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { AssetPack } from '@assetpack/core';
import { pixiManifest } from '@assetpack/core/manifest';
import { TextureAtlas } from '@esotericsoftware/spine-core';

const extensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.wav', '.mp3']);
const maxFile = 24 * 1024 * 1024;
const maxBatch = 64 * 1024 * 1024;

async function packAssets(temporary, entry, output) {
  const pack = new AssetPack({
    entry, output, cacheLocation: join(temporary, 'cache'), cache: false, strict: true, logLevel: 'error',
    pipes: [pixiManifest({ nameStyle: 'relative', includeMetaData: false })],
  });
  try {
    await pack.run();
  } finally {
    await pack.stop();
  }
  return JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
}

const isImage = name => typeof name === 'string' && /\.(png|jpe?g|webp)$/i.test(name);
const safeCompanion = name => typeof name === 'string' && name !== '.' && name !== '..' &&
  name.length > 0 && name.length <= 255 && !/[\\/{}:\x00-\x1f]/.test(name);

async function readAsset(path, remaining, t, companion = false) {
  const file = await open(path, companion ? constants.O_RDONLY | constants.O_NOFOLLOW : 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size === 0) throw new Error(t('emptyAsset', { path: basename(path) }));
    if (stat.size > maxFile || stat.size > remaining) throw new Error(t('assetLimit'));
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error(t('assetReadError', { path: basename(path) }));
      offset += bytesRead;
    }
    return bytes;
  } finally {
    await file.close();
  }
}

async function animationFiles(path, bytes, readCompanion, t) {
  let json;
  try { json = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error(t('unsupportedAnimationAsset')); }
  if (typeof json?.skeleton?.spine === 'string' && /^4\.2\./.test(json.skeleton.spine) && Array.isArray(json.bones)) {
    const atlasName = basename(path).slice(0, -5) + '.atlas';
    const atlas = await readCompanion(atlasName);
    const parsed = new TextureAtlas(atlas.bytes.toString('utf8'));
    try {
      if (!parsed.pages.length || parsed.pages.length >= 128) throw new Error(t('unsupportedAnimationAsset'));
      const names = [...new Set(parsed.pages.map(page => page.name))];
      const files = [atlas];
      for (const name of names) {
        if (!isImage(name)) throw new Error(t('missingAnimationFile', { name }));
        files.push(await readCompanion(name));
      }
      return { kind: 'spine', files };
    } finally {
      parsed.dispose();
    }
  }
  if (json?.frames && typeof json.frames === 'object' && !Array.isArray(json.frames) && isImage(json.meta?.image)) {
    return { kind: 'sheet', files: [await readCompanion(json.meta.image)] };
  }
  throw new Error(t('unsupportedAnimationAsset'));
}

export async function importAssets(paths, t) {
  const temporary = await mkdtemp(join(tmpdir(), 'olive-import-'));
  try {
    const entry = join(temporary, 'source');
    const output = join(temporary, 'packed');
    let total = 0;
    const sources = new Set();
    const primary = new Map();
    const consumed = new Set();
    const read = async (path, companion = false) => {
      const bytes = await readAsset(path, maxBatch - total, t, companion);
      total += bytes.length;
      if (total > maxBatch) throw new Error(t('assetLimit'));
      return bytes;
    };
    const sorted = [...paths].sort((a, b) => Number(/\.json$/i.test(b)) - Number(/\.json$/i.test(a)));
    for (const path of sorted) {
      if (consumed.has(resolve(path))) continue;
      const name = basename(path);
      const extension = extname(name).toLowerCase();
      if (!extensions.has(extension) && extension !== '.json') throw new Error(t('unsupportedAsset', { path: name }));
      const bytes = await read(path);
      let media;
      if (extension === '.json') {
        media = await animationFiles(path, bytes, async name => {
          if (!safeCompanion(name)) throw new Error(t('missingAnimationFile', { name: String(name) }));
          const file = join(dirname(path), name);
          let data;
          try { data = await read(file, true); }
          catch (error) {
            if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error?.code)) throw new Error(t('missingAnimationFile', { name }));
            throw error;
          }
          if (isImage(name) && !matchesFormat(data, extname(name).toLowerCase())) throw new Error(t('missingAnimationFile', { name }));
          consumed.add(resolve(file));
          return { name, bytes: data };
        }, t);
      } else if (!matchesFormat(bytes, extension)) throw new Error(t('assetReadError', { path: name }));

      const folder = randomUUID();
      const stem = name.slice(0, -extension.length).replace(/[{}\\\u0000-\u001f]/g, '_') || 'asset';
      const filename = stem + extension;
      const directory = join(entry, 'project{m}', folder);
      await mkdir(directory, { recursive: true });
      const alias = `project/${folder}/${filename}`;
      sources.add(alias);
      primary.set(alias, media);
      await writeFile(join(directory, filename), bytes);
      for (const file of media?.files ?? []) {
        sources.add(`project/${folder}/${file.name}`);
        await writeFile(join(directory, file.name), file.bytes);
      }
    }
    const manifest = await packAssets(temporary, entry, output);
    for (const bundle of manifest.bundles) {
      for (const asset of bundle.assets) {
        const [alias] = asset.alias;
        const [path] = asset.src;
        if (alias !== path || !sources.delete(path)) throw new Error(t('incompleteManifest'));
      }
    }
    if (sources.size) throw new Error(t('incompleteManifest'));
    const packed = [];
    for (const [alias, media] of primary) {
      const data = (await readFile(join(output, alias))).toString('base64');
      if (!media) { packed.push({ alias, data }); continue; }
      const files = [];
      for (const file of media.files) {
        files.push({ name: file.name, data: (await readFile(join(output, dirname(alias), file.name))).toString('base64') });
      }
      packed.push({ alias, data, media: { kind: media.kind, files } });
    }
    return packed;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function exportBundles(parent, assets, t) {
  if (!Array.isArray(assets) || !assets.length) throw new Error(t('bundleEmpty'));
  const temporary = await mkdtemp(join(parent, '.assetpack-build-'));
  let target;
  let published = false;
  try {
    const entry = join(temporary, 'source');
    const output = join(temporary, 'packed');
    const sources = new Map();
    const aliases = new Set();
    let total = 0;
    for (const [index, asset] of assets.entries()) {
      const { alias, bundle, data, media } = asset ?? {};
      if (typeof alias !== 'string' || !/^project\/[\da-f-]{36}\/[^/\\]+$/i.test(alias) ||
        typeof bundle !== 'string' || !/^[a-z][a-z\d_-]{0,47}$/.test(bundle) ||
        typeof data !== 'string' || aliases.has(alias)) throw new Error(t('invalidAssetLibrary'));
      const extension = extname(alias).toLowerCase();
      if (media ? extension !== '.json' || !['spine', 'sheet'].includes(media.kind) || !Array.isArray(media.files) ||
        !media.files.length || media.files.length > 128 : !extensions.has(extension)) throw new Error(t('unsupportedAsset', { path: alias }));
      if (data.length > maxFile * 4 / 3) throw new Error(t('assetLimit'));
      const bytes = Buffer.from(data, 'base64');
      total += bytes.length;
      if (total > maxBatch) throw new Error(t('assetLimit'));
      if (!media && !matchesFormat(bytes, extension)) throw new Error(t('assetReadError', { path: alias }));
      aliases.add(alias);

      // AssetPack uses folder tags for grouping. Output paths use safe names and keep the original alias separately.
      const sourceFolder = bundle === 'default' ? entry : join(entry, bundle + '{m}');
      const indexName = String(index + 1).padStart(4, '0');
      const folder = join(sourceFolder, 'assets', ...(media ? [indexName] : []));
      const file = media ? basename(alias) : indexName + extension;
      const prefix = (bundle === 'default' ? 'assets' : bundle + '/assets') + (media ? '/' + indexName : '');
      if (media && !safeCompanion(file)) throw new Error(t('invalidAssetLibrary'));
      sources.set(prefix + '/' + file, { alias, bundle });
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, file), bytes);
      for (const companion of media?.files ?? []) {
        const { name, data } = companion ?? {};
        if (!safeCompanion(name) || (!isImage(name) && !(media.kind === 'spine' && name.endsWith('.atlas'))) ||
          typeof data !== 'string' || sources.has(prefix + '/' + name)) throw new Error(t('invalidAssetLibrary'));
        if (data.length > maxFile * 4 / 3) throw new Error(t('assetLimit'));
        const bytes = Buffer.from(data, 'base64');
        total += bytes.length;
        if (total > maxBatch) throw new Error(t('assetLimit'));
        const atlasAlias = media.kind === 'spine' && name.endsWith('.atlas') ? alias.slice(0, -5) + '.atlas' : undefined;
        sources.set(prefix + '/' + name, { bundle, alias: atlasAlias });
        await writeFile(join(folder, name), bytes);
      }
    }

    const manifest = await packAssets(temporary, entry, output);
    manifest.bundles = manifest.bundles.filter(bundle => bundle.assets.length);
    for (const bundle of manifest.bundles) {
      bundle.assets = bundle.assets.filter(asset => {
        const [path] = asset.src;
        const source = sources.get(path);
        if (!source || source.bundle !== bundle.name) throw new Error(t('incompleteManifest'));
        sources.delete(path);
        if (!source.alias) return false;
        asset.alias = [source.alias];
        return true;
      });
    }
    if (sources.size) throw new Error(t('incompleteManifest'));
    await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    target = await mkdtemp(join(parent, 'assetpack-'));
    await rename(output, target);
    published = true;
    return target;
  } finally {
    await rm(temporary, { recursive: true, force: true });
    if (target && !published) await rm(target, { recursive: true, force: true });
  }
}

function matchesFormat(bytes, extension) {
  if (extension === '.png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.jpg' || extension === '.jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (extension === '.mp3') return bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224);
  return bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === (extension === '.wav' ? 'WAVE' : 'WEBP');
}
