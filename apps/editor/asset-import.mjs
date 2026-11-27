import { constants, createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import unzipper from 'unzipper';
import { access, cp, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AssetPack } from '@assetpack/core';
import { pixiManifest } from '@assetpack/core/manifest';
import { AtlasAttachmentLoader, BinaryInput, SkeletonBinary, SkeletonJson, TextureAtlas } from '@esotericsoftware/spine-core';
import { resolveSpineEventAudioDefaults, spineRelativePath, supportsSpineVersion } from '@olivestudio/engine/spine-format';

const extensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.wav', '.mp3', '.ogg']);
const maxFile = 24 * 1024 * 1024;
const maxBatch = 64 * 1024 * 1024;
const execute = promisify(execFile);
const spineSkinMapSuffix = '.olive-skins.json';

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
const isAudio = name => typeof name === 'string' && /\.(wav|mp3|ogg)$/i.test(name);
const isAtlasFile = name => /\.atlas(?:\.txt)?$/i.test(name);
const rigExtension = name => /\.skel\.bytes$/i.test(name) ? '.skel' : extname(name).toLowerCase();
const withoutBytesSuffix = name => /\.skel\.bytes$/i.test(name) ? name.slice(0, -6) : name;
const safeCompanion = name => typeof name === 'string' && name !== '.' && name !== '..' &&
  name.length > 0 && name.length <= 255 && !/[\\/{}:\x00-\x1f]/.test(name);
const safeAtlasImage = name => isImage(name) && spineRelativePath(name) === name;

async function readAsset(path, remaining, t, companion = false) {
  const file = await open(path, companion ? constants.O_RDONLY | constants.O_NOFOLLOW : 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size === 0 && !isAtlasFile(path)) {
      throw new Error(t('emptyAsset', { path: basename(path) }));
    }
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

function binaryVersion(bytes) {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return new BinaryInput(bytes, [], 8, view).readString();
  } catch {
    return null;
  }
}

export function readSpineSkeleton(extension, bytes, atlas, json) {
  const loader = new AtlasAttachmentLoader(atlas);
  const skeleton = extension === '.skel'
    ? new SkeletonBinary(loader).readSkeletonData(new Uint8Array(bytes))
    : new SkeletonJson(loader).readSkeletonData(resolveSpineEventAudioDefaults(json ?? JSON.parse(bytes.toString('utf8'))));
  if (!skeleton.bones.length) throw new Error('Spine rig requires a root bone');
  return skeleton;
}

function spineRuntimeAudio(skeleton) {
  return { directory: spineRelativePath(skeleton.audioPath),
    paths: skeleton.events.map(event => spineRelativePath(event.audioPath)).filter(isAudio) };
}

function spineAudioMetadata(extension, bytes, atlasBytes) {
  if (extension === '.json') {
    const document = JSON.parse(bytes.toString('utf8'));
    return { document, directory: spineRelativePath(document.skeleton?.audio),
      paths: Object.values(document.events ?? {}).map(event => event?.audio).map(spineRelativePath).filter(isAudio) };
  }
  if (!atlasBytes) return { paths: [] };
  const atlas = new TextureAtlas(atlasBytes.toString('utf8'));
  try {
    return spineRuntimeAudio(readSpineSkeleton(extension, bytes, atlas));
  } catch { return { paths: [] }; }
  finally { atlas.dispose(); }
}

async function importSpineAudio(root, metadata, read, t) {
  if (!metadata.paths.length) return [];
  const base = await realpath(root);
  const files = [];
  for (const path of new Set(metadata.paths)) {
    const candidates = metadata.directory ? [join(metadata.directory, path), path] : [path];
    for (const candidate of candidates) {
      let bytes;
      try {
        const filename = await realpath(join(base, candidate));
        const local = relative(base, filename);
        if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) continue;
        const info = await stat(filename);
        if (!info.isFile() || !info.size) continue;
        bytes = await read(filename, true);
      } catch (error) {
        if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error?.code)) continue;
        throw error;
      }
      if (matchesFormat(bytes, extname(path).toLowerCase())) {
        files.push({ path, data: bytes.toString('base64') });
        if (files.length > 128) throw new Error(t('assetLimit'));
        break;
      }
    }
  }
  return files;
}

async function alternateSpineAtlas(path, bytes, selectedPaths, t) {
  const directory = dirname(path);
  const extension = rigExtension(path);
  const siblings = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && safeCompanion(entry.name) && isAtlasFile(entry.name))
    .map(entry => resolve(directory, entry.name));
  const selected = siblings.filter(file => selectedPaths.has(file));
  for (const choices of [selected, siblings.filter(file => !selectedPaths.has(file))]) {
    let match;
    for (const filename of choices) {
      let atlas;
      try {
        const data = await readAsset(filename, maxFile, t, true);
        atlas = new TextureAtlas(data.toString('utf8'));
        if (!atlas.pages.length || atlas.pages.some(page => !safeAtlasImage(page.name))) continue;
        readSpineSkeleton(extension, bytes, atlas);
      } catch {
        continue;
      } finally {
        atlas?.dispose();
      }
      if (match) throw new Error(t('ambiguousSpineAtlas', { name: basename(path) }));
      match = filename;
    }
    if (match) return match;
  }
}

function prepareSpineAudio(extension, bytes, atlas, audio, decode, t) {
  if (audio === undefined) return { bytes, files: [] };
  if (!Array.isArray(audio) || !audio.length || audio.length > 128) throw new Error(t('invalidAssetLibrary'));
  const metadata = spineAudioMetadata(extension, bytes, atlas);
  const paths = new Set(metadata.paths);
  const names = new Set();
  const files = [];
  for (const item of audio) {
    if (!item || !isAudio(item.path) || spineRelativePath(item.path) !== item.path || names.has(item.path)) {
      throw new Error(t('invalidAssetLibrary'));
    }
    names.add(item.path);
    if (!paths.has(item.path)) continue;
    const data = decode(item.data);
    if (!matchesFormat(data, extname(item.path).toLowerCase())) throw new Error(t('invalidAssetLibrary'));
    const directory = metadata.document ? 'audio' : metadata.directory;
    files.push({ name: directory ? directory + '/' + item.path : item.path, bytes: data });
  }
  if (files.length && metadata.document) {
    metadata.document.skeleton.audio = './audio/';
    bytes = Buffer.from(JSON.stringify(metadata.document));
  }
  return { bytes, files };
}

async function animationFiles(path, bytes, readCompanion, t) {
  const extension = rigExtension(path);
  let json;
  if (extension === '.json') {
    try { json = JSON.parse(bytes.toString('utf8')); }
    catch { throw new Error(t('unsupportedAnimationAsset')); }
  }
  if (extension === '.skel' || typeof json?.skeleton?.spine === 'string') {
    const version = extension === '.skel' ? binaryVersion(bytes) : json.skeleton.spine;
    if (!supportsSpineVersion(version)) throw new Error(t('spineVersionError', { version: version ?? '—' }));
    if (extension === '.json' && !Array.isArray(json.bones)) throw new Error(t('unsupportedAnimationAsset'));
    const atlasName = withoutBytesSuffix(basename(path)).slice(0, -extension.length) + '.atlas';
    const atlas = await readCompanion(atlasName, () => {
      const empty = new TextureAtlas('');
      try {
        readSpineSkeleton(extension, bytes, empty, json);
        return { name: atlasName, bytes: Buffer.from('\n') };
      } catch { return undefined; }
      finally { empty.dispose(); }
    });
    let parsed;
    let skeleton;
    try {
      parsed = new TextureAtlas(atlas.bytes.toString('utf8'));
      skeleton = readSpineSkeleton(extension, bytes, parsed, json);
    } catch {
      parsed?.dispose();
      throw new Error(t('invalidSpineRig', { name: basename(path), atlas: atlasName }));
    }
    try {
      if (parsed.pages.length >= 128) throw new Error(t('unsupportedAnimationAsset'));
      const names = [...new Set(parsed.pages.map(page => page.name))];
      const files = [atlas.bytes.length ? atlas : { ...atlas, bytes: Buffer.from('\n') }];
      for (const name of names) {
        if (!safeAtlasImage(name)) throw new Error(t('missingAnimationFile', { name }));
        files.push(await readCompanion(name));
      }
      return { kind: 'spine', files, audioMetadata: spineRuntimeAudio(skeleton) };
    } finally {
      parsed.dispose();
    }
  }
  if (json?.frames && typeof json.frames === 'object' && !Array.isArray(json.frames) && isImage(json.meta?.image) &&
      safeCompanion(json.meta.image)) {
    return { kind: 'sheet', files: [await readCompanion(json.meta.image)] };
  }
  throw new Error(t('unsupportedAnimationAsset'));
}

export async function findSpineLauncher(selection) {
  const configured = selection ?? process.env.OLIVESTUDIO_SPINE_EXECUTABLE;
  const candidates = configured ? (isAbsolute(configured) ? [configured] : []) :
    ['/Applications', join(homedir(), 'Applications')].flatMap(directory =>
      [directory, join(directory, 'Spine')].map(folder => join(folder, 'Spine.app', 'Contents', 'MacOS', 'Spine')));
  for (const candidate of candidates) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* Check the next installation path. */ }
  }
  return null;
}

export async function testSpineLauncher(path) {
  if (!path) return { state: 'unavailable' };
  try {
    const { stdout, stderr } = await execute(path, ['--update', '4.2.xx', '--version'], {
      timeout: 30000, maxBuffer: 2 * 1024 * 1024,
    });
    const output = stdout + '\n' + stderr;
    if (/^\s*WARNING:\s*Not activated\b/im.test(output)) return { state: 'notActivated' };
    const version = /^Spine (4\.2\.\d+) (Essential|Professional|Education|Enterprise)\s*$/im.exec(output);
    if (version) return { state: 'ready', version: `${version[1]} ${version[2]}` };
  } catch { /* An incomplete launch cannot be confirmed. */ }
  return { state: 'unavailable' };
}

async function spineExecutable(t, selection) {
  const executable = await findSpineLauncher(selection);
  if (executable) return executable;
  throw new Error(t('spineLauncherMissing'));
}

const spineJsonExport = { class: 'export-json', extension: '.json', format: 'JSON', nonessential: true };

async function expandSpineProjects(paths, temporary, t, launcher) {
  const inputs = [];
  const settings = join(temporary, 'spine-project.export.json');
  let executable;
  for (const input of paths) {
    if (extname(input).toLowerCase() !== '.spine') {
      inputs.push({ path: input });
      continue;
    }
    if (!executable) {
      executable = await spineExecutable(t, launcher);
      await writeFile(settings, JSON.stringify({
        ...spineJsonExport,
        packAtlas: { atlasExtension: '.atlas', useIndexes: false },
        packSource: 'attachments',
        packTarget: 'perskeleton',
      }), { flag: 'wx' });
    }
    const source = resolve(input);
    const info = await stat(source);
    if (!info.isFile() || !info.size || info.size > maxFile) throw new Error(t('assetReadError', { path: basename(source) }));
    const output = await mkdtemp(join(temporary, 'spine-'));
    try {
      await execute(executable, ['--update', '4.2.xx', '--export-all', '--input', source, '--output', output, '--export', settings],
        { cwd: dirname(source), timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    } catch {
      throw new Error(t('spineLauncherFailed', { name: basename(source) }));
    }
    const files = (await readdir(output, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort();
    const skeletons = [];
    for (const name of files.filter(name => extname(name).toLowerCase() === '.json' && safeCompanion(name))) {
      const path = join(output, name);
      const data = await readAsset(path, maxFile, t, true);
      let parsed;
      try { parsed = JSON.parse(data.toString('utf8')); } catch { continue; }
      if (!parsed?.skeleton?.spine || !Array.isArray(parsed.bones)) continue;
      if (await restoreSpineProjectSkins(source, name, parsed, t)) await writeFile(path, JSON.stringify(parsed));
      skeletons.push({ path, audioRoot: dirname(source) });
    }
    if (!skeletons.length || skeletons.length > 128) throw new Error(t('spineLauncherFailed', { name: basename(source) }));
    inputs.push(...skeletons);
  }
  return inputs;
}

async function expandSpineArchives(paths, temporary, t) {
  const expanded = [];
  let total = 0;
  for (const path of paths) {
    if (!/\.zip$/i.test(path)) { expanded.push(path); continue; }
    const file = await stat(path);
    if (!file.isFile() || file.size > maxBatch) throw new Error(t('assetLimit'));
    const invalid = () => new Error(t('spineArchiveInvalid', { name: basename(path) }));
    const archive = await unzipper.Open.file(path).catch(() => { throw invalid(); });
    if (archive.files.length > 4096) throw new Error(t('assetLimit'));
    const entries = archive.files.filter(entry => entry.type === 'File' && !entry.path.startsWith('__MACOSX/') &&
      (/\.spine$/i.test(entry.path) || isImage(entry.path) || isAudio(entry.path) || entry.path.endsWith(spineSkinMapSuffix)));
    const projects = entries.filter(entry => /\.spine$/i.test(entry.path));
    if (!projects.length) throw new Error(t('spineArchiveNoProjects', { name: basename(path) }));
    if (projects.length > 128) throw new Error(t('assetLimit'));
    const root = await mkdtemp(join(temporary, 'spine-archive-'));
    for (const entry of entries) {
      if (!entry.path.split('/').every(safeCompanion)) throw invalid();
      if (entry.uncompressedSize > maxFile || total + entry.uncompressedSize > maxBatch) throw new Error(t('assetLimit'));
      const target = join(root, entry.path);
      await mkdir(dirname(target), { recursive: true });
      let size = 0;
      const limit = new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length;
        total += chunk.length;
        if (size > maxFile || total > maxBatch) callback(new Error(t('assetLimit')));
        else callback(null, chunk);
      } });
      await pipeline(await entry.stream(), limit, createWriteStream(target, { flags: 'wx' }));
      if (size !== entry.uncompressedSize) throw invalid();
    }
    expanded.push(...projects.map(entry => join(root, entry.path)));
  }
  return expanded;
}

export async function importAssets(paths, t, launcher) {
  const temporary = await mkdtemp(join(tmpdir(), 'olive-import-'));
  try {
    const entry = join(temporary, 'source');
    const output = join(temporary, 'packed');
    let total = 0;
    const sources = new Set();
    const primary = new Map();
    const consumed = new Set();
    const selectedPaths = new Set(paths.map(path => resolve(path)));
    const read = async (path, companion = false) => {
      const bytes = await readAsset(path, maxBatch - total, t, companion);
      total += bytes.length;
      if (total > maxBatch) throw new Error(t('assetLimit'));
      return bytes;
    };
    const isAnimation = path => ['.json', '.skel'].includes(rigExtension(path));
    const expanded = await expandSpineArchives(paths, temporary, t);
    const inputs = await expandSpineProjects(expanded, temporary, t, launcher);
    const sorted = inputs.sort((a, b) => Number(isAnimation(b.path)) - Number(isAnimation(a.path)));
    for (const { path, audioRoot } of sorted) {
      if (consumed.has(resolve(path))) continue;
      const name = withoutBytesSuffix(basename(path));
      const extension = extname(name).toLowerCase();
      if (!extensions.has(extension) && !isAnimation(name)) throw new Error(t('unsupportedAsset', { path: name }));
      const bytes = await read(path, audioRoot !== undefined);
      let media;
      if (isAnimation(name)) {
        media = await animationFiles(path, bytes, async (name, withoutAtlas) => {
          if (!safeCompanion(name) && !safeAtlasImage(name)) throw new Error(t('missingAnimationFile', { name: String(name) }));
          let file = join(dirname(path), name);
          let data;
          try {
            let source = file;
            if (name.includes('/')) {
              const root = await realpath(dirname(path));
              source = await realpath(file);
              const local = relative(root, source);
              if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) {
                throw new Error(t('missingAnimationFile', { name }));
              }
            }
            data = await read(source, true);
          } catch (error) {
            if (!['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error?.code)) throw error;
            if (error.code !== 'ENOENT' || !name.endsWith('.atlas')) throw new Error(t('missingAnimationFile', { name }));
            const unityAtlas = file + '.txt';
            try {
              const atlas = await read(unityAtlas, true);
              consumed.add(resolve(unityAtlas));
              return { name, bytes: atlas };
            } catch (unityError) {
              if (unityError?.code !== 'ENOENT') throw unityError;
            }
            const directory = dirname(resolve(path));
            const selectedAtlas = [...selectedPaths].some(file => dirname(file) === directory && isAtlasFile(file));
            const empty = selectedAtlas ? undefined : withoutAtlas?.();
            if (empty) return empty;
            const alternate = await alternateSpineAtlas(path, bytes, selectedPaths, t);
            if (!alternate) {
              const empty = selectedAtlas ? withoutAtlas?.() : undefined;
              if (empty) return empty;
              throw new Error(t('missingAnimationFile', { name }));
            }
            file = alternate;
            data = await read(file, true);
          }
          if (isImage(name) && !matchesFormat(data, extname(name).toLowerCase())) throw new Error(t('missingAnimationFile', { name }));
          consumed.add(resolve(file));
          return { name, bytes: data };
        }, t);
        if (media.kind === 'spine') {
          const audio = await importSpineAudio(audioRoot ?? dirname(path), media.audioMetadata, read, t);
          if (audio.length) media.audio = audio;
        }
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
        const target = join(directory, file.name);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.bytes, { flag: 'wx' });
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
      packed.push({ alias, data, media: { kind: media.kind, files, ...(media.audio && { audio: media.audio }) } });
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
      if (media ? !(extension === '.json' || (media.kind === 'spine' && extension === '.skel')) ||
        !['spine', 'sheet'].includes(media.kind) || !Array.isArray(media.files) ||
        !media.files.length || media.files.length > 128 : !extensions.has(extension)) throw new Error(t('unsupportedAsset', { path: alias }));
      if (data.length > maxFile * 4 / 3) throw new Error(t('assetLimit'));
      let bytes = Buffer.from(data, 'base64');
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
      let audio = [];
      if (media?.audio !== undefined) {
        if (media.kind !== 'spine') throw new Error(t('invalidAssetLibrary'));
        const atlas = media.files.find(file => typeof file?.name === 'string' && file.name.endsWith('.atlas'));
        if (atlas && (typeof atlas.data !== 'string' || atlas.data.length > maxFile * 4 / 3)) throw new Error(t('assetLimit'));
        const companion = prepareSpineAudio(extension, bytes, atlas ? Buffer.from(atlas.data, 'base64') : undefined, media.audio, value => {
          if (typeof value !== 'string' || !value.length || value.length > maxFile * 4 / 3) throw new Error(t('assetLimit'));
          const content = Buffer.from(value, 'base64');
          if (content.toString('base64') !== value) throw new Error(t('invalidAssetLibrary'));
          total += content.length;
          if (total > maxBatch) throw new Error(t('assetLimit'));
          return content;
        }, t);
        bytes = companion.bytes;
        audio = companion.files;
      }
      sources.set(prefix + '/' + file, { alias, bundle });
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, file), bytes);
      for (const companion of media?.files ?? []) {
        const { name, data } = companion ?? {};
        const supported = media.kind === 'spine'
          ? safeAtlasImage(name) || (safeCompanion(name) && name.endsWith('.atlas'))
          : safeCompanion(name) && isImage(name);
        if (!supported ||
          typeof data !== 'string' || sources.has(prefix + '/' + name)) throw new Error(t('invalidAssetLibrary'));
        if (data.length > maxFile * 4 / 3) throw new Error(t('assetLimit'));
        const bytes = Buffer.from(data, 'base64');
        total += bytes.length;
        if (total > maxBatch) throw new Error(t('assetLimit'));
        const atlasAlias = media.kind === 'spine' && name.endsWith('.atlas') ? alias.slice(0, -5) + '.atlas' : undefined;
        sources.set(prefix + '/' + name, { bundle, alias: atlasAlias });
        const target = join(folder, name);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes, { flag: 'wx' });
      }
      for (const { name, bytes } of audio) {
        if (sources.has(prefix + '/' + name)) throw new Error(t('invalidAssetLibrary'));
        sources.set(prefix + '/' + name, { bundle });
        await mkdir(dirname(join(folder, name)), { recursive: true });
        await writeFile(join(folder, name), bytes, { flag: 'wx' });
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

export async function exportSpineFiles(parent, asset, t) {
  const { alias, data, media } = asset ?? {};
  const extension = typeof alias === 'string' ? extname(alias).toLowerCase() : '';
  if (!['.json', '.skel'].includes(extension) || media?.kind !== 'spine' ||
      !Array.isArray(media.files) || !media.files.length || media.files.length > 128) throw new Error(t('unsupportedAnimationAsset'));
  let total = 0;
  const decode = value => {
    if (typeof value !== 'string' || !value.length || value.length > maxFile * 4 / 3) throw new Error(t('assetLimit'));
    const bytes = Buffer.from(value, 'base64');
    if (bytes.toString('base64') !== value) throw new Error(t('invalidAssetLibrary'));
    total += bytes.length;
    if (total > maxBatch) throw new Error(t('assetLimit'));
    return bytes;
  };
  const files = new Map();
  for (const file of media.files) {
    const name = file?.name;
    if (!(safeAtlasImage(name) || (safeCompanion(name) && name.endsWith('.atlas'))) ||
        files.has(name)) throw new Error(t('invalidAssetLibrary'));
    const bytes = decode(file.data);
    if (isImage(file.name) && !matchesFormat(bytes, extname(file.name).toLowerCase())) throw new Error(t('missingAnimationFile', { name: file.name }));
    files.set(file.name, bytes);
  }
  const atlases = [...files.keys()].filter(name => name.endsWith('.atlas'));
  if (atlases.length !== 1) throw new Error(t('unsupportedAnimationAsset'));
  const [atlasName] = atlases;
  const primary = atlasName.slice(0, -6) + extension;
  if (!safeCompanion(primary)) throw new Error(t('invalidAssetLibrary'));
  const bytes = decode(data);
  await animationFiles(primary, bytes, async name => {
    const bytes = files.get(name);
    if (!bytes) throw new Error(t('missingAnimationFile', { name }));
    return { name, bytes };
  }, t);
  const companion = prepareSpineAudio(extension, bytes, files.get(atlasName), media.audio, decode, t);
  files.set(primary, companion.bytes);
  const folder = await mkdtemp(join(parent, 'spine-'));
  try {
    for (const [name, bytes] of files) {
      const target = join(folder, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
    }
    for (const { name, bytes } of companion.files) {
      await mkdir(dirname(join(folder, name)), { recursive: true });
      await writeFile(join(folder, name), bytes, { flag: 'wx' });
    }
    return folder;
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}

async function convertSpineFormat(asset, format, t, launcher) {
  const extension = format === 'json' ? '.skel' : '.json';
  const outputExtension = format === 'json' ? '.json' : '.skel';
  if (typeof asset?.alias !== 'string' || extname(asset.alias).toLowerCase() !== extension) {
    throw new Error(t('unsupportedAnimationAsset'));
  }
  const executable = await spineExecutable(t, launcher);
  const work = await mkdtemp(join(tmpdir(), 'olive-spine-convert-'));
  try {
    const source = await exportSpineFiles(work, asset, t);
    const atlasName = asset.media.files.find(file => file.name.endsWith('.atlas')).name;
    const stem = atlasName.slice(0, -6);
    const sourceFile = join(source, stem + extension);
    const compatibility = format === 'binary' ? await prepareSpineBinaryInput(sourceFile) : await prepareSpineBinaryRead(sourceFile);
    const output = await mkdtemp(join(work, 'output-'));
    const settings = join(work, 'spine.export.json');
    const exportOptions = format === 'json'
      ? spineJsonExport
      : { class: 'export-binary', extension: '.skel', nonessential: true };
    await writeFile(settings, JSON.stringify(exportOptions), { flag: 'wx' });
    let data;
    try {
      await execute(executable, ['--update', '4.2.xx', '--input', sourceFile, '--output', output, '--export', settings],
        { cwd: work, timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
      const candidates = (await readdir(output, { withFileTypes: true })).filter(entry =>
        entry.isFile() && safeCompanion(entry.name) && extname(entry.name).toLowerCase() === outputExtension);
      const result = candidates.find(entry => entry.name === stem + outputExtension) ??
        (candidates.length === 1 ? candidates[0] : undefined);
      if (!result) throw new Error('Expected one skeleton file');
      data = await readAsset(join(output, result.name), maxFile, t, true);
      if (compatibility && format === 'binary') data = restoreSpineBinaryNames(data, compatibility);
      if (compatibility && format === 'json') data = restoreSpineBinaryJson(data, compatibility.attachments);
    } catch {
      throw new Error(t('spineFormatFailed', { name: stem, format: outputExtension }));
    }
    const converted = { ...asset, alias: asset.alias.slice(0, -extension.length) + outputExtension, data: data.toString('base64') };
    await exportSpineFiles(work, converted, t);
    return converted;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function prepareSpineBinaryInput(path) {
  const text = await readFile(path, 'utf8');
  const document = JSON.parse(text);
  const skins = document.skins ?? [];
  const base = skins.find(skin => skin.name === 'default');
  const names = new Map();
  if (!base?.attachments) return;
  // The official editor cannot import skin placeholders that share a skinless attachment's key.
  // Give those placeholders temporary keys while it writes the binary; the runtime supports the original keys.
  let prefix = 'olive-binary-attachment-';
  while (text.includes(prefix)) prefix += 'x';
  const temporary = name => {
    const key = prefix + names.size;
    names.set(key, name);
    return key;
  };
  const renamed = new Map();
  const attachments = [];
  for (const skin of skins) {
    if (skin === base) continue;
    const slots = new Map();
    for (const [slot, entries] of Object.entries(skin.attachments ?? {})) {
      const keys = new Map();
      for (const [key, attachment] of Object.entries(entries)) {
        if (!spineProjectAttachment(base, slot, key)) continue;
        const next = temporary(key);
        const label = attachment.name ?? key;
        attachments.push({ skin: skin.name, slot, key, temporaryKey: next, name: attachment.name ?? null });
        preserveSpineProjectTexture(attachment, label);
        attachment.name = label === key ? next : temporary(label);
        entries[next] = attachment;
        delete entries[key];
        keys.set(key, next);
      }
      if (keys.size) slots.set(slot, keys);
    }
    if (slots.size) renamed.set(skin.name, slots);
  }
  if (!names.size) return;
  remapSpineBinaryAttachmentReferences(document, renamed);
  await writeFile(path, JSON.stringify(document));
  return { names, attachments };
}

function remapSpineBinaryAttachmentReferences(document, renamed) {
  const skins = document.skins ?? [];
  for (const skin of skins) for (const [slot, entries] of Object.entries(skin.attachments ?? {})) {
    for (const attachment of Object.values(entries)) {
      const parent = renamed.get(attachment.skin)?.get(slot)?.get(attachment.parent);
      if (parent) attachment.parent = parent;
    }
  }
  for (const clip of Object.values(document.animations ?? {})) for (const [skin, slots] of renamed) {
    for (const [slot, keys] of slots) {
      const tracks = clip.attachments?.[skin]?.[slot];
      if (!tracks) continue;
      for (const [from, to] of keys) if (Object.hasOwn(tracks, from)) {
        Object.defineProperty(tracks, to, { value: tracks[from], enumerable: true, configurable: true, writable: true });
        delete tracks[from];
      }
    }
  }
}

function encodeSpinePositiveInt(length) {
  const size = [];
  while (length > 127) {
    size.push((length & 127) | 128);
    length >>>= 7;
  }
  size.push(length);
  return Buffer.from(size);
}

function encodeSpineBinaryString(value) {
  const utf8 = Buffer.from(value, 'utf8');
  return Buffer.concat([encodeSpinePositiveInt(utf8.length + 1), utf8]);
}

const spineBinarySkinMarker = 'olivestudio:shared-attachments:1:';

function spineBinaryStrings(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const input = new BinaryInput(data, [], 8, view);
  input.readString();
  input.index += 5 * 4;
  if (input.readBoolean()) {
    input.readFloat();
    input.readString();
    input.readString();
  }
  const offset = input.index;
  const count = input.readInt(true);
  if (count < 0 || count > data.length - input.index) throw new Error('Invalid Spine binary string table');
  const entries = [];
  for (let index = 0; index < count; index++) {
    const start = input.index;
    const value = input.readString();
    entries.push({ value, bytes: data.subarray(start, input.index) });
  }
  return { offset, entries, end: input.index };
}

function restoreSpineBinaryNames(data, { names, attachments }) {
  if (!supportsSpineVersion(binaryVersion(data))) throw new Error('Unexpected Spine binary version');
  const { offset, entries, end } = spineBinaryStrings(data);
  const aliases = [];
  const strings = entries.map(({ value, bytes }, index) => {
    if (!names.has(value)) return bytes;
    aliases.push([index, value]);
    return encodeSpineBinaryString(names.get(value));
  });
  if (new Set(aliases.map(([, name]) => name)).size !== names.size) {
    throw new Error('Temporary attachment names were not preserved by Spine');
  }
  // An unreferenced table entry lets OliveStudio reverse the editor-specific aliases later.
  // Standard Spine runtimes ignore it and use the restored names at their original indices.
  const marker = spineBinarySkinMarker + Buffer.from(JSON.stringify({ aliases, attachments })).toString('base64');
  return Buffer.concat([data.subarray(0, offset), encodeSpinePositiveInt(entries.length + 1),
    ...strings, encodeSpineBinaryString(marker), data.subarray(end)]);
}

async function prepareSpineBinaryRead(path) {
  const data = await readFile(path);
  if (!supportsSpineVersion(binaryVersion(data))) return;
  const { offset, entries, end } = spineBinaryStrings(data);
  const marker = entries.at(-1)?.value;
  if (!marker?.startsWith(spineBinarySkinMarker)) return;
  const compatibility = JSON.parse(Buffer.from(marker.slice(spineBinarySkinMarker.length), 'base64').toString('utf8'));
  const replacements = new Map(compatibility.aliases);
  const strings = entries.slice(0, -1).map(({ bytes }, index) =>
    replacements.has(index) ? encodeSpineBinaryString(replacements.get(index)) : bytes);
  await writeFile(path, Buffer.concat([data.subarray(0, offset), encodeSpinePositiveInt(strings.length), ...strings, data.subarray(end)]));
  return compatibility;
}

function restoreSpineBinaryJson(data, attachments) {
  const document = JSON.parse(data.toString('utf8'));
  const skins = new Map(document.skins?.map(skin => [skin.name, skin]));
  const renamed = new Map();
  for (const { skin, slot, key, temporaryKey, name } of attachments) {
    const entries = skins.get(skin)?.attachments?.[slot];
    if (!entries || !Object.hasOwn(entries, temporaryKey) || Object.hasOwn(entries, key)) throw new Error('Missing Spine binary attachment alias');
    const attachment = entries[temporaryKey];
    if (name === null) delete attachment.name;
    else attachment.name = name;
    Object.defineProperty(entries, key, { value: attachment, enumerable: true, configurable: true, writable: true });
    delete entries[temporaryKey];
    if (!renamed.has(skin)) renamed.set(skin, new Map());
    const slots = renamed.get(skin);
    if (!slots.has(slot)) slots.set(slot, new Map());
    slots.get(slot).set(temporaryKey, key);
  }
  remapSpineBinaryAttachmentReferences(document, renamed);
  return Buffer.from(JSON.stringify(document));
}

export async function convertSpineBinary(asset, t, launcher) {
  const { data } = await convertSpineFormat(asset, 'json', t, launcher);
  return data;
}

export async function exportSpineBinary(parent, asset, t, launcher) {
  return exportSpineFiles(parent, await convertSpineFormat(asset, 'binary', t, launcher), t);
}

function renameSpineProjectBase(document, base, name) {
  const oldName = base.name;
  base.name = name;
  document.skins = [base, ...document.skins.filter(skin => skin !== base)];
  for (const skin of document.skins) {
    for (const entries of Object.values(skin.attachments ?? {})) {
      for (const attachment of Object.values(entries)) {
        if (attachment.parent && (attachment.skin || 'default') === oldName) attachment.skin = name;
      }
    }
  }
  for (const animation of Object.values(document.animations ?? {})) {
    const tracks = animation.attachments;
    if (!tracks || !Object.hasOwn(tracks, oldName)) continue;
    tracks[name] = mergeSpineProjectSlots(tracks[name], tracks[oldName]);
    delete tracks[oldName];
  }
}

function mergeSpineProjectSlots(target, source) {
  if (!target) return source;
  if (!source) return target;
  return { ...target, ...Object.fromEntries(Object.entries(source).map(([slot, entries]) =>
    [slot, { ...(Object.hasOwn(target, slot) && target[slot]), ...entries }])) };
}

function sharedSpineProjectSlots(left, right) {
  return Object.entries(left ?? {}).some(([slot, entries]) => Object.hasOwn(right ?? {}, slot) &&
    Object.keys(entries).some(key => Object.hasOwn(right[slot], key)));
}

function spineProjectAttachment(skin, slot, key) {
  const slots = skin?.attachments;
  if (slots && Object.hasOwn(slots, slot) && Object.hasOwn(slots[slot], key)) return slots[slot][key];
}

function preserveSpineProjectTexture(attachment, name) {
  if ([undefined, 'region', 'mesh', 'linkedmesh'].includes(attachment.type)) attachment.path ??= name;
}

function prepareSpineProjectSkins(document) {
  const skins = document.skins ?? [];
  const base = skins.find(skin => skin.name === 'default');
  if (!base?.attachments) return;

  const shared = Object.entries(base.attachments).flatMap(([slot, entries]) =>
    Object.keys(entries).filter(key => skins.some(skin => skin !== base &&
      spineProjectAttachment(skin, slot, key))).map(key => [slot, key]));
  if (!shared.length) return;

  // The runtime permits default-skin fallback and named skin placeholders to share a key.
  // The Spine editor needs a named skin for every attachment that uses the shared placeholder.
  const names = new Set(skins.map(skin => skin.name));
  let baseName = 'Olive Base';
  for (let suffix = 2; names.has(baseName); suffix++) baseName = `Olive Base ${suffix}`;
  renameSpineProjectBase(document, base, baseName);

  const reserved = new Set();
  for (const skin of skins) {
    for (const entries of Object.values(skin.attachments ?? {})) {
      for (const [key, attachment] of Object.entries(entries)) {
        reserved.add(key);
        reserved.add(attachment.name ?? key);
      }
    }
  }
  const labels = [];
  for (const [slot, key] of shared) {
    for (const skin of skins) {
      const attachment = spineProjectAttachment(skin, slot, key);
      if (!attachment) continue;
      const name = attachment.name ?? key;
      preserveSpineProjectTexture(attachment, name);
      let label = `${name}-2`;
      for (let suffix = 3; reserved.has(label); suffix++) label = `${name}-${suffix}`;
      reserved.add(label);
      labels.push({ skin: skin.name, slot, key, label, original: attachment.name ?? null });
      attachment.name = label;
    }
  }
  return { base: baseName, labels };
}

async function restoreSpineProjectSkins(source, skeletonFile, document, t) {
  const path = source.slice(0, -extname(source).length) + spineSkinMapSuffix;
  let map;
  try { map = JSON.parse((await readAsset(path, maxFile, t, true)).toString('utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return false;
    throw error;
  }
  if (map?.version !== 1 || map.skeleton !== skeletonFile || typeof map.base !== 'string' || !Array.isArray(map.labels)) return false;
  const skins = new Map(document.skins?.map(skin => [skin.name, skin]) ?? []);
  const base = skins.get(map.base);
  if (!base || base.name === 'default') return false;
  const nativeDefault = skins.get('default');
  if (nativeDefault) {
    // New skinless attachments in Spine land in a fresh default skin. Preserve both sets on return.
    if (sharedSpineProjectSlots(base.attachments, nativeDefault.attachments) ||
        Object.values(document.animations ?? {}).some(({ attachments }) =>
          sharedSpineProjectSlots(attachments?.[base.name], attachments?.default))) return false;
    base.attachments = mergeSpineProjectSlots(base.attachments, nativeDefault.attachments);
    for (const field of ['bones', 'ik', 'transform', 'path', 'physics']) {
      if (nativeDefault[field]?.length) base[field] = [...new Set([...(base[field] ?? []), ...nativeDefault[field]])];
    }
    document.skins = document.skins.filter(skin => skin !== nativeDefault);
  }

  for (const entry of map.labels) {
    if (typeof entry?.skin !== 'string' || typeof entry.slot !== 'string' || typeof entry.key !== 'string' ||
        typeof entry.label !== 'string' || (entry.original !== null && typeof entry.original !== 'string')) continue;
    const attachment = spineProjectAttachment(skins.get(entry.skin), entry.slot, entry.key);
    if (attachment?.name !== entry.label) continue;
    preserveSpineProjectTexture(attachment, entry.label);
    if (entry.original === null) delete attachment.name;
    else attachment.name = entry.original;
  }
  renameSpineProjectBase(document, base, 'default');
  return true;
}

export async function exportSpineProject(parent, asset, t, launcher) {
  if (typeof asset?.alias !== 'string' || !/\.(json|skel)$/i.test(asset.alias)) throw new Error(t('unsupportedAnimationAsset'));
  const executable = await spineExecutable(t, launcher);
  const sourceAsset = /\.skel$/i.test(asset.alias) ? await convertSpineFormat(asset, 'json', t, executable) : asset;
  const work = await mkdtemp(join(parent, '.spine-build-'));
  let published;
  try {
    const source = await exportSpineFiles(work, sourceAsset, t);
    const atlasName = sourceAsset.media.files.find(file => file.name.endsWith('.atlas')).name;
    const stem = atlasName.slice(0, -6);
    const atlasPath = join(source, atlasName);
    const atlas = new TextureAtlas(await readFile(atlasPath, 'utf8'));
    const textured = atlas.pages.length > 0;
    try {
      if (atlas.regions.some(region => !region.name.split('/').every(safeCompanion))) {
        throw new Error(t('invalidAssetLibrary'));
      }
    } finally { atlas.dispose(); }
    const output = join(work, 'output');
    const images = join(output, 'images');
    await mkdir(images, { recursive: true });
    const input = join(output, stem + '.json');
    const project = join(output, stem + '.spine');
    const document = JSON.parse(await readFile(join(source, stem + '.json'), 'utf8'));
    const skinMap = prepareSpineProjectSkins(document);
    document.skeleton.images = './images/';
    if (sourceAsset.media.audio && document.skeleton.audio === './audio/') {
      try { await cp(join(source, 'audio'), join(output, 'audio'), { recursive: true }); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    await writeFile(input, JSON.stringify(document), { flag: 'wx' });
    const launch = args => execute(executable, ['--update', '4.2.xx', ...args],
      { cwd: output, timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    try {
      if (textured) await launch(['--input', source, '--output', images, '--unpack', atlasPath]);
      await launch(['--input', input, '--output', project, '--import']);
      const info = await stat(project);
      if (!info.isFile() || !info.size) throw new Error('No Spine project was written');
    } catch {
      throw new Error(t('spineLauncherProjectFailed', { name: stem }));
    }
    await rm(input);
    if (skinMap) await writeFile(join(output, stem + spineSkinMapSuffix), JSON.stringify({
      version: 1, skeleton: stem + '.json', ...skinMap,
    }), { flag: 'wx' });
    const folder = await mkdtemp(join(parent, 'spine-project-'));
    try { await rename(output, folder); }
    catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
    published = folder;
  } finally { await rm(work, { recursive: true, force: true }); }
  return published;
}

function matchesFormat(bytes, extension) {
  if (extension === '.png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.jpg' || extension === '.jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (extension === '.mp3') return bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224);
  if (extension === '.ogg') return bytes.toString('ascii', 0, 4) === 'OggS';
  return bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === (extension === '.wav' ? 'WAVE' : 'WEBP');
}
