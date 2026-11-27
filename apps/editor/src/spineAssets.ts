import { AtlasAttachmentLoader, SkeletonBinary, SkeletonJson, TextureAtlas } from '@esotericsoftware/spine-core';
import { spineDocumentSchema, type SpineDocument } from '@olivestudio/engine/spine-format';
import { filename, siblingNameTaken } from './assetLibrary';
import { assetMime, importedAssetsSchema, type Asset, type EmbeddedMedia } from './assets';
import { rewriteDirectorSteps, type DirectorDefinition } from './directorModel';
import { t } from './i18n';
import type { Project, SceneRecord } from './project';
import type { SceneObject, SpineCue, SpineMix, SpinePlayback } from './scene';
import { changeSelection, findSceneObjectByPath, selectionTree } from './selection';

type SpineRename = { from: string; to: string | null };
export type SpineReferenceChanges = { skins: SpineRename[]; animations: SpineRename[]; events?: SpineRename[]; eventAudio?: SpineRename[] };
export type SpineReferenceChange = SpineRename & { kind: 'skin' | 'animation' | 'event' };
type RemapClip = (name: string) => string | null;

export function spineEventAudioChanges(before: SpineDocument['events'], after: SpineDocument['events']): SpineRename[] {
  const available = new Set(Object.values(after ?? {}).map(event => event.audio));
  const changes: SpineRename[] = [];
  const removed = new Set<string>();
  for (const [name, event] of Object.entries(before ?? {})) {
    const from = event.audio;
    if (typeof from !== 'string' || !from) continue;
    const to = Object.hasOwn(after ?? {}, name) ? after?.[name]?.audio : undefined;
    if (typeof to === 'string' && to && to !== from) changes.push({ from, to });
    if (!available.has(from)) removed.add(from);
  }
  return [...changes, ...[...removed].map(from => ({ from, to: null }))];
}

export function remapProjectSpineReferences(project: Project, alias: string, renames: SpineReferenceChanges): Project {
  const remap = (name: string, changes: SpineRename[]) =>
    changes.reduce<string | null>((value, { from, to }) => value === from ? to : value, name);
  const renameAnimation: RemapClip = name => remap(name, renames.animations);
  const renameEvent: RemapClip = name => remap(name, renames.events ?? []);
  const mapped = mapProjectSpineNodes(project, node => {
    if (node.asset !== alias) return node;
    const skin = node.skin && remap(node.skin, renames.skins);
    const layers = renames.skins.length && node.skinLayers ?
      [...new Set(node.skinLayers.map(name => remap(name, renames.skins)).filter((name): name is string => name !== null && name !== skin))] : node.skinLayers;
    const skinLayers = layers?.length === node.skinLayers?.length && layers?.every((name, index) => node.skinLayers?.[index] === name)
      ? node.skinLayers : layers?.length ? layers : undefined;
    const animation = node.animation && renameAnimation(node.animation);
    const mix = remapSpineMix(node.mix, renameAnimation);
    const playback = renames.animations.length ? remapSpinePlayback(node.playback, renameAnimation) : node.playback;
    const eventAudio = remapSpineEventAudio(node.eventAudio, renames.eventAudio);
    return skin === node.skin && skinLayers === node.skinLayers && animation === node.animation && mix === node.mix &&
      playback === node.playback && eventAudio === node.eventAudio ? node : { ...node, skin, skinLayers, animation, mix, playback, eventAudio };
  });
  if (!renames.animations.length && !renames.events?.length) return mapped;
  const remapGraphs = (objects: SceneObject[]) => remapSpineGraphSignals(objects, alias, renameAnimation, renameEvent);
  return { ...mapped, scenes: mapped.scenes.map(scene => {
    const next = renames.animations.length ? remapSpineDirector(scene, alias, renameAnimation) : scene;
    const objects = remapGraphs(next.objects);
    return objects === next.objects ? next : { ...next, objects };
  }), prefabs: mapped.prefabs.map(prefab => {
    const [root] = remapGraphs([prefab.root]);
    return root === prefab.root ? prefab : { ...prefab, root };
  }) };
}

function remapSpineGraphSignals(objects: SceneObject[], alias: string, renameAnimation: RemapClip, renameEvent: RemapClip) {
  const tree = selectionTree(objects);
  const graphOwners = new Set([...tree.values()].filter(({ node }) => node.logicGraph).map(({ node }) => node.id));
  if (!graphOwners.size) return objects;
  return changeSelection(objects, graphOwners, node => {
    const graph = node.logicGraph!;
    const removed = new Set<string>();
    const nodes = graph.nodes.flatMap(item => {
      if (item.kind === 'action' && item.action.type === 'spine.play' && typeof item.action.to === 'string' && item.action.to) {
        const target = tree.get(item.action.targetId)?.node;
        if (target?.type !== 'Spine' || target.asset !== alias) return [item];
        const clip = renameAnimation(item.action.to);
        if (clip === item.action.to) return [item];
        if (clip === null) { removed.add(item.id); return []; }
        return [{ ...item, action: { ...item.action, to: clip } }];
      }
      if (item.kind !== 'event' || !item.trigger.event) return [item];
      const { type, sourceId, event } = item.trigger;
      if (type !== 'spine.event' && type !== 'spine.complete') return [item];
      const source = tree.get(sourceId)?.node;
      if (source?.type !== 'Spine' || source.asset !== alias) return [item];
      const name = (type === 'spine.event' ? renameEvent : renameAnimation)(event);
      if (name === event) return [item];
      if (name === null) { removed.add(item.id); return []; }
      return [{ ...item, trigger: { ...item.trigger, event: name } }];
    });
    if (!removed.size && nodes.every((item, index) => item === graph.nodes[index])) return node;
    const links = removed.size ? graph.links.filter(link => !removed.has(link.from) && !removed.has(link.to)) : graph.links;
    return { ...node, logicGraph: { nodes, links } };
  });
}

function remapSpineEventAudio(audio: Readonly<Record<string, string | null>> | undefined, changes: SpineRename[] | undefined) {
  if (!audio || !changes?.some(({ from }) => Object.hasOwn(audio, from))) return audio;
  const next = new Map(Object.entries(audio));
  for (const { from, to } of changes) {
    if (!Object.hasOwn(audio, from)) continue;
    if (to === null) next.delete(from);
    else if (!next.has(to)) next.set(to, audio[from]);
  }
  return next.size ? Object.fromEntries(next) : undefined;
}

function remapSpinePlayback(playback: SpinePlayback | undefined, rename: RemapClip) {
  if (!playback) return;
  let changed = false;
  const remap = (clips: SpineCue[]) => clips.flatMap(clip => {
    const animation = rename(clip.animation);
    if (animation === clip.animation) return [clip];
    changed = true;
    return animation ? [{ ...clip, animation }] : [];
  });
  const queue = remap(playback.queue);
  const tracks = playback.tracks.map(track => ({ ...track, clips: remap(track.clips) })).filter(track => track.clips.length);
  return changed ? queue.length || tracks.length ? { queue, tracks } : undefined : playback;
}

function remapSpineMix(mix: SpineMix | undefined, rename: RemapClip) {
  if (!mix) return;
  const pairs = new Map<string, SpineMix['pairs'][number]>();
  let changed = false;
  for (const pair of mix.pairs) {
    const from = rename(pair.from), to = rename(pair.to);
    if (from === null || to === null) { changed = true; continue; }
    const key = JSON.stringify([from, to]);
    const renamed = pair.from !== from || pair.to !== to;
    if (renamed || !pairs.has(key)) pairs.set(key, renamed ? { ...pair, from, to } : pair);
    changed ||= renamed;
  }
  return changed ? { ...mix, pairs: [...pairs.values()] } : mix;
}

function remapSpineDirector(scene: SceneRecord, alias: string, rename: RemapClip): SceneRecord {
  const library = scene.cinematics?.director;
  if (!library?.length) return scene;
  const nodes = selectionTree(scene.objects);
  const labels = new Map<string, SceneObject | null>();
  for (const { node } of nodes.values()) labels.set(node.label, labels.has(node.label) ? null : node);
  const usesRig = (target: string) => {
    if (target.startsWith('$')) return false;
    const node = nodes.get(target)?.node ?? (target.includes('/') ? findSceneObjectByPath(scene.objects, target) : labels.get(target));
    return node?.type === 'Spine' && node.asset === alias;
  };
  const director = library.map(definition => remapSpineComposition(definition, usesRig, rename));
  return director.some((item, index) => item !== library[index]) ?
    { ...scene, cinematics: { ...scene.cinematics!, director } } : scene;
}

function remapSpineComposition(definition: DirectorDefinition, usesRig: (target: string) => boolean,
  rename: RemapClip): DirectorDefinition {
  try {
    return rewriteDirectorSteps(definition, step => {
      if (step.type !== 'animation' || typeof step.key !== 'string' || step.key.startsWith('$')) return step;
      const key = rename(step.key);
      if (key === step.key) return step;
      if (typeof step.target === 'string' && usesRig(step.target)) {
        return key === null ? undefined : { ...step, key };
      }
      if (!Array.isArray(step.target)) return step;
      const renamed = step.target.filter(target => typeof target === 'string' && usesRig(target));
      if (!renamed.length) return step;
      const remaining = step.target.filter(target => !renamed.includes(target));
      if (key === null) return remaining.length ? { ...step, target: remaining } : undefined;
      return remaining.length ? { type: 'parallel', children: [
        { ...step, target: renamed, key }, { ...step, target: remaining },
      ] } : { ...step, key };
    });
  } catch { throw new Error(t('spineRemapDirectorFailed', { name: definition.name })); }
}

export function replaceProjectSpineBinary(project: Project, source: string, alias: string, data: string): Project {
  const library = project.assetLibrary;
  const assets = importedAssetsSchema.parse(project.assets.map(asset =>
    asset.alias === source ? { ...asset, alias, data } : asset));
  const entries = library.entries.map(entry => {
    if (entry.alias !== source) return entry;
    const name = filename(alias);
    const updateName = entry.name === filename(source) && !siblingNameTaken(library, entry.folderId, name, source);
    return { ...entry, alias, name: updateName ? name : entry.name };
  });
  return mapProjectSpineNodes({ ...project, assets, assetLibrary: { ...library, entries } },
    node => node.asset === source ? { ...node, asset: alias } : node);
}

function mapProjectSpineNodes(project: Project, update: (node: Extract<SceneObject, { type: 'Spine' }>) => SceneObject): Project {
  function remap(node: SceneObject): SceneObject {
    if (node.type === 'Container') {
      const children = node.children.map(remap);
      return children.some((child, index) => child !== node.children[index]) ? { ...node, children } : node;
    }
    return node.type === 'Spine' ? update(node) : node;
  }
  return { ...project, scenes: project.scenes.map(scene => {
    const objects = scene.objects.map(remap);
    return objects.some((node, index) => node !== scene.objects[index]) ? { ...scene, objects } : scene;
  }), prefabs: project.prefabs.map(prefab => {
    const root = remap(prefab.root);
    return root === prefab.root ? prefab : { ...prefab, root };
  }) };
}

export function spineAssetBase64(bytes: Uint8Array) {
  if (bytes.length > 24 * 1024 * 1024) throw new Error(t('assetLimit'));
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += 8192) parts.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
  return btoa(parts.join(''));
}

function atlasText(data: string) {
  return new TextDecoder().decode(Uint8Array.from(atob(data), byte => byte.charCodeAt(0)));
}

const signalNames = new WeakMap<Project['assets'][number], { events: string[]; animations: string[] }>();

export function spineSignalNames(asset: Project['assets'][number] | undefined) {
  if (asset?.media?.kind !== 'spine') return;
  const cached = signalNames.get(asset);
  if (cached) return cached;
  const file = asset.media.files.find(file => file.name.endsWith('.atlas'));
  let atlas: TextureAtlas | undefined;
  try {
    atlas = new TextureAtlas(file ? atlasText(file.data) : '');
    const loader = new AtlasAttachmentLoader(atlas);
    const rig = /\.skel$/i.test(asset.alias)
      ? new SkeletonBinary(loader).readSkeletonData(Uint8Array.from(atob(asset.data), byte => byte.charCodeAt(0)))
      : new SkeletonJson(loader).readSkeletonData(JSON.parse(atlasText(asset.data)));
    const names = { events: rig.events.map(event => event.name), animations: rig.animations.map(animation => animation.name) };
    signalNames.set(asset, names);
    return names;
  } catch {
    const empty = { events: [], animations: [] };
    signalNames.set(asset, empty);
    return empty;
  } finally { atlas?.dispose(); }
}

export function spineAtlasInfo(files: EmbeddedMedia['files'] | undefined) {
  const file = files?.find(file => file.name.endsWith('.atlas'));
  if (!file) return { pages: [], regions: [] };
  const atlas = new TextureAtlas(atlasText(file.data));
  try {
    const regions = atlas.regions.map(region => {
      const width = region.originalWidth || region.width, height = region.originalHeight || region.height;
      return { name: region.name, width, height, trim: {
        left: region.offsetX / width, right: (region.offsetX + region.width) / width,
        top: 1 - (region.offsetY + region.height) / height, bottom: 1 - region.offsetY / height,
      } };
    });
    return { pages: atlas.pages.map(page => page.name), regions };
  } finally { atlas.dispose(); }
}

async function readSpineTexture(image: Asset) {
  if (image.kind !== 'image' || !assetMime(image.path)?.startsWith('image/')) throw new Error(t('spineChooseImages'));
  const response = await fetch(image.url);
  if (!response.ok) throw new Error(t('previewUnavailable'));
  const blob = await response.blob();
  if (!blob.size || blob.size > 24 * 1024 * 1024) throw new Error(t('assetLimit'));
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  return { extension: image.path.split('.').at(-1)!.toLowerCase(), width, height, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

function spineAtlasPage(page: string, region: string, width: number, height: number) {
  return [page, `size: ${width},${height}`, 'filter: Linear,Linear', 'pma: false',
    region, `bounds: 0,0,${width},${height}`].join('\n');
}

export async function addSpineAtlasImage(files: EmbeddedMedia['files'], image: Asset) {
  if (files.length >= 128) throw new Error(t('assetLimit'));
  const atlas = files.find(file => file.name.endsWith('.atlas'));
  if (!atlas) throw new Error(t('unsupportedAnimationAsset'));
  const { extension, width, height, bytes } = await readSpineTexture(image);
  const stem = filename(image.path).slice(0, -extension.length - 1).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'texture';
  const regions = new Set(spineAtlasInfo(files).regions.map(region => region.name));
  const pages = new Set(files.map(file => file.name.toLowerCase()));
  let region = stem;
  for (let index = 2; regions.has(region) || pages.has(`${region.toLowerCase()}.${extension}`); index++) region = `${stem}-${index}`;
  const page = `${region}.${extension}`;
  const existing = atlasText(atlas.data);
  const next = existing.trimEnd() + '\n\n' + spineAtlasPage(page, region, width, height) + '\n';
  return { region, files: [
    ...files.map(file => file === atlas ? { ...file, data: spineAssetBase64(new TextEncoder().encode(next)) } : file),
    { name: page, data: spineAssetBase64(bytes) },
  ] };
}

function changeSpinePagePma(text: string, pageName: string, premultiplied: boolean) {
  const blocks = text.replace(/\r\n?/g, '\n').split(/(\n(?:[ \t]*\n)+)/);
  for (let index = 0; index < blocks.length; index += 2) {
    const lines = blocks[index].split('\n');
    const start = lines.findIndex(line => !!line.trim() && !line.includes(':'));
    if (lines[start]?.trim() !== pageName) continue;
    let end = start + 1;
    while (lines[end]?.includes(':')) end++;
    const header = lines.slice(start + 1, end).filter(line => !/^\s*pma\s*:/.test(line));
    lines.splice(start + 1, end - start - 1, ...header, `pma: ${premultiplied}`);
    blocks[index] = lines.join('\n');
    return blocks.join('');
  }
  throw new Error(t('unsupportedAnimationAsset'));
}

export async function replaceSpineAtlasImage(files: EmbeddedMedia['files'], pageName: string, image: Asset, premultiplied = false) {
  const atlasFile = files.find(file => file.name.endsWith('.atlas'));
  const current = files.find(file => file.name === pageName);
  if (!atlasFile || !current) throw new Error(t('unsupportedAnimationAsset'));
  const mime = assetMime(pageName);
  if (!mime?.startsWith('image/') || assetMime(image.path) !== mime) {
    throw new Error(t('spineAtlasPageFormatMismatch', { page: pageName }));
  }
  const text = atlasText(atlasFile.data);
  const atlas = new TextureAtlas(text);
  let size: { width: number; height: number };
  let currentPma: boolean;
  try {
    const page = atlas.pages.find(page => page.name === pageName);
    if (!page) throw new Error(t('unsupportedAnimationAsset'));
    size = { width: page.width, height: page.height };
    currentPma = page.pma;
  } finally { atlas.dispose(); }
  if (!size.width || !size.height) {
    const response = await fetch(`data:${mime};base64,${current.data}`);
    const bitmap = await createImageBitmap(await response.blob());
    size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
  }
  const { width, height, bytes } = await readSpineTexture(image);
  if (width !== size.width || height !== size.height) {
    throw new Error(t('spineAtlasPageSizeMismatch', { page: pageName, ...size, actualWidth: width, actualHeight: height }));
  }
  const data = spineAssetBase64(bytes);
  if (data === current.data && currentPma === premultiplied) return files;
  const nextAtlas = currentPma === premultiplied ? atlasFile : { ...atlasFile,
    data: spineAssetBase64(new TextEncoder().encode(changeSpinePagePma(text, pageName, premultiplied))) };
  return files.map(file => file === atlasFile ? nextAtlas : file === current ? { ...file, data } : file);
}

export function removeSpineAtlasPage(document: SpineDocument, files: EmbeddedMedia['files'], page: string) {
  const file = files.find(file => file.name.endsWith('.atlas'));
  if (!file) throw new Error(t('unsupportedAnimationAsset'));
  const text = atlasText(file.data);
  const original = new TextureAtlas(text);
  const pages = original.pages.map(page => page.name);
  const firstPages = new Map<string, string>();
  for (const region of original.regions) {
    if (!firstPages.has(region.name)) firstPages.set(region.name, region.page.name);
  }
  original.dispose();
  if (!pages.includes(page)) throw new Error(t('unsupportedAnimationAsset'));
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n(?:[ \t]*\n)+/);
  const next = blocks.flatMap(block => {
    const lines = block.split('\n');
    const start = lines.findIndex(line => !!line.trim() && !line.includes(':'));
    if (lines[start]?.trim() !== page) return [block];
    const header = lines.slice(0, start).join('\n').trimEnd();
    return header ? [header] : [];
  }).join('\n\n');
  const atlas = new TextureAtlas(next);
  try {
    const expected = pages.filter(name => name !== page);
    if (atlas.pages.length !== expected.length || atlas.pages.some(({ name }, index) => name !== expected[index])) {
      throw new Error(t('unsupportedAnimationAsset'));
    }
    // A duplicate region on another page must not silently replace the current binding.
    const lookup = atlas.findRegion.bind(atlas);
    atlas.findRegion = name => firstPages.get(name) === page ? null : lookup(name);
    try { new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(document); }
    catch (error) { throw new Error(t('spineAtlasPageRemoveFailed', { page, detail: error instanceof Error ? error.message : String(error) })); }
    return files.filter(entry => entry.name !== page)
      .map(entry => entry === file ? { ...file, data: spineAssetBase64(new TextEncoder().encode(next || '\n')) } : entry);
  } finally { atlas.dispose(); }
}

export async function createSpineAsset(images: readonly Asset[], stem: string) {
  if (images.length >= 128) throw new Error(t('assetLimit'));
  const atlas: string[] = [];
  const files: EmbeddedMedia['files'] = [];
  const bones = [{ name: 'root' }] as { name: string; parent?: string; x?: number }[];
  const slots = [];
  const attachments: Record<string, Record<string, unknown>> = {};
  let height = 0, totalWidth = 0, bytes = 0;
  for (const [index, image] of images.entries()) {
    const { extension, width, height: imageHeight, bytes: source } = await readSpineTexture(image);
    bytes += source.length;
    if (bytes > 64 * 1024 * 1024) throw new Error(t('assetLimit'));
    const part = `part-${index + 1}`;
    const page = `${part}.${extension}`;
    files.push({ name: page, data: spineAssetBase64(source) });
    atlas.push(spineAtlasPage(page, part, width, imageHeight));
    bones.push({ name: part, parent: 'root', x: totalWidth + width / 2 });
    slots.push({ name: part, bone: part, attachment: part });
    attachments[part] = { [part]: { type: 'region', path: part, width, height: imageHeight } };
    totalWidth += width;
    height = Math.max(height, imageHeight);
  }
  for (const bone of bones) if (bone.x !== undefined) bone.x -= totalWidth / 2;
  const document = spineDocumentSchema.parse({
    skeleton: { spine: '4.2.120', x: -totalWidth / 2, y: -height / 2, width: totalWidth, height },
    bones, slots, skins: [{ name: 'default', attachments }],
  });
  files.unshift({ name: `${stem}.atlas`, data: spineAssetBase64(new TextEncoder().encode(atlas.join('\n\n') + '\n')) });
  const data = spineAssetBase64(new TextEncoder().encode(JSON.stringify(document)));
  return { data, media: { kind: 'spine' as const, files } };
}
