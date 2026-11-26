import { z } from 'zod';
import type { Asset, AssetBundle } from './assets';
import type { SceneObject } from './scene';

export const projectRoot = 'project';
export const builtInRoot = 'built-in';
export const allAssets = 'all';
export const assetDragType = 'application/x-olive-asset';
export const folderDragType = 'application/x-olive-folder';

export const libraryName = z.string().trim().min(1).max(255)
  .refine(name => name !== '.' && name !== '..' && !/[\\/:\x00-\x1f]/.test(name));
export const bundleName = z.string().regex(/^[a-z][a-z\d_-]{0,47}$/).refine(name => name !== 'default');
export const assetTagsSchema = z.array(z.string().trim().min(1).max(40)).max(24)
  .transform(tags => [...new Map(tags.map(tag => [tag.normalize('NFC').toLowerCase(), tag])).values()]);

export const assetLibrarySchema = z.strictObject({
  folders: z.array(z.strictObject({ id: z.uuid(), name: libraryName, parentId: z.uuid().nullable() })),
  entries: z.array(z.strictObject({
    alias: z.string().min(1), name: libraryName, folderId: z.uuid().nullable(), bundleId: z.uuid().optional(),
    tags: assetTagsSchema.optional(), generated: z.literal(true).optional(),
  })),
  bundles: z.array(z.strictObject({ id: z.uuid(), name: bundleName })).optional(),
});
export type AssetLibrary = z.output<typeof assetLibrarySchema>;
export const emptyLibrary: AssetLibrary = { folders: [], entries: [] };
type Folder = { id: string; name: string; parentId: string; writable: boolean };
export type CatalogEntry = Asset & { name: string; folderId: string; writable: boolean; bundleId?: string; tags?: string[]; generated?: true };

export const filename = (path: string) => path.split('/').at(-1)!;
export const extension = (name: string) => name.match(/\.[^.]+$/)?.[0] ?? '';
const normalized = (name: string) => name.normalize('NFC').toLowerCase();

export function siblingNameTaken(library: AssetLibrary, parent: string | null, name: string, except?: string) {
  const key = normalized(name);
  return library.folders.some(folder => folder.parentId === parent && folder.id !== except && normalized(folder.name) === key) ||
    library.entries.some(entry => entry.folderId === parent && entry.alias !== except && normalized(entry.name) === key);
}

export function addLibraryEntries(library: AssetLibrary, aliases: string[], folderId: string | null, generated = false): AssetLibrary {
  const next = { ...library, entries: [...library.entries] };
  for (const alias of aliases) {
    if (next.entries.some(entry => entry.alias === alias)) continue;
    const original = filename(alias);
    const ext = extension(original);
    const stem = original.slice(0, original.length - ext.length).replace(/[:]/g, '_');
    let name = stem.slice(0, 255 - ext.length) + ext;
    for (let index = 2; siblingNameTaken(next, folderId, name); index++) {
      const suffix = ` (${index})${ext}`;
      name = stem.slice(0, 255 - suffix.length) + suffix;
    }
    next.entries.push({ alias, name, folderId, ...(generated ? { generated: true } : {}) });
  }
  return next;
}

export function validateLibrary(library: AssetLibrary, aliases: Set<string>) {
  const bundles = library.bundles ?? [];
  const bundleIds = new Set(bundles.map(bundle => bundle.id));
  if (bundleIds.size !== bundles.length || new Set(bundles.map(bundle => bundle.name)).size !== bundles.length) return false;
  const parents = new Map(library.folders.map(folder => [folder.id, folder.parentId]));
  const listed = new Set<string>();
  const names = new Set<string>();
  const unique = (parent: string | null, name: string) => {
    const key = (parent ?? '') + '\0' + normalized(name);
    if (names.has(key)) return false;
    names.add(key);
    return true;
  };
  if (parents.size !== library.folders.length) return false;
  for (const folder of library.folders) {
    if (!unique(folder.parentId, folder.name)) return false;
    const visited = new Set([folder.id]);
    let parent = folder.parentId;
    while (parent !== null) {
      if (visited.has(parent) || !parents.has(parent)) return false;
      visited.add(parent);
      parent = parents.get(parent)!;
    }
  }
  for (const entry of library.entries) {
    if (!aliases.has(entry.alias) || listed.has(entry.alias) || (entry.bundleId && !bundleIds.has(entry.bundleId)) ||
      (entry.folderId !== null && !parents.has(entry.folderId)) || !unique(entry.folderId, entry.name)) return false;
    listed.add(entry.alias);
  }
  return true;
}

export function createCatalog(bundles: AssetBundle[], imports: AssetBundle, library: AssetLibrary, labels: [string, string]) {
  const folders = new Map<string, Folder>([
    [projectRoot, { id: projectRoot, name: labels[0], parentId: allAssets, writable: true }],
    [builtInRoot, { id: builtInRoot, name: labels[1], parentId: allAssets, writable: false }],
  ]);
  for (const folder of library.folders) folders.set(folder.id, { ...folder, parentId: folder.parentId ?? projectRoot, writable: true });
  const metadata = new Map(library.entries.map(item => [item.alias, item]));
  const entries: CatalogEntry[] = imports.assets.map(asset => {
    const info = metadata.get(asset.alias);
    return { ...asset, name: info?.name ?? filename(asset.alias), folderId: info?.folderId ?? projectRoot,
      writable: true, bundleId: info?.bundleId, tags: info?.tags, generated: info?.generated };
  });
  for (const bundle of bundles) {
    for (const asset of bundle.assets) {
      const path = asset.alias.split('/').slice(0, -1);
      const parts = bundle.name.split('/');
      if (!parts.every((part, index) => part === path[index])) parts.push(...path);
      else parts.push(...path.slice(parts.length));
      let parentId = builtInRoot;
      for (const name of parts) {
        const id = parentId + '/' + encodeURIComponent(name);
        if (!folders.has(id)) folders.set(id, { id, name, parentId, writable: false });
        parentId = id;
      }
      entries.push({ ...asset, name: filename(asset.alias), folderId: parentId, writable: false });
    }
  }
  return { folders, entries };
}

export function objectAsset(node: SceneObject) {
  if ('texture' in node) return node.texture;
  if ('asset' in node) return node.asset;
  return null;
}

export function objectAssetKind(node: SceneObject): Asset['kind'] | undefined {
  if ('texture' in node) return 'image';
  if (node.type === 'AudioSource') return 'audio';
  if (node.type === 'AnimatedSprite') return 'sheet';
  if (node.type === 'Spine') return 'spine';
}

export function assignObjectAsset(node: SceneObject, asset: Asset): SceneObject {
  if (objectAssetKind(node) !== asset.kind || objectAsset(node) === asset.alias) return node;
  if ('texture' in node) return { ...node, texture: asset.alias };
  if (node.type === 'AudioSource') return { ...node, asset: asset.alias };
  if (node.type === 'AnimatedSprite') return { ...node, asset: asset.alias, animation: null };
  if (node.type === 'Spine') return { ...node, asset: asset.alias, animation: null, skin: null };
  return node;
}

export function assetUsers(objects: SceneObject[], alias: string): string[] {
  return objects.flatMap(node => node.type === 'Container' ? assetUsers(node.children, alias) :
    objectAsset(node) === alias ? [node.label] : []);
}

export type LibraryItem = { type: 'folder' | 'asset'; id: string };
export type LibraryAction =
  | { type: 'create'; id: string; parent: string | null; name: string }
  | { type: 'rename'; item: LibraryItem; name: string }
  | { type: 'move'; item: LibraryItem; parent: string | null }
  | { type: 'delete'; item: LibraryItem }
  | { type: 'tags'; aliases: readonly string[]; tags: string[] }
  | { type: 'bundle'; operation: BundleAction };

type BundleAction =
  | { type: 'save'; id: string; name: string; aliases?: readonly string[] }
  | { type: 'delete'; id: string }
  | { type: 'assign'; aliases: readonly string[]; id: string | null };

function changeBundles(library: AssetLibrary, action: BundleAction): AssetLibrary {
  const bundles = library.bundles ?? [];
  if (action.type === 'save') {
    const name = bundleName.parse(action.name);
    if (bundles.some(bundle => bundle.name === name && bundle.id !== action.id)) throw new Error('bundleNameConflict');
    const old = bundles.find(bundle => bundle.id === action.id);
    const bundle = { id: action.id, name };
    const updated = old?.name === name ? library : { ...library,
      bundles: old ? bundles.map(item => item === old ? bundle : item) : [...bundles, bundle] };
    return action.aliases ? changeBundles(updated, { type: 'assign', aliases: action.aliases, id: action.id }) : updated;
  }
  if (action.type === 'delete') {
    if (!bundles.some(bundle => bundle.id === action.id)) return library;
    return { ...library, bundles: bundles.filter(bundle => bundle.id !== action.id),
      entries: library.entries.map(entry => {
        if (entry.bundleId !== action.id) return entry;
        const { bundleId: _removed, ...remaining } = entry;
        return remaining;
      }) };
  }
  if (action.id !== null && !bundles.some(bundle => bundle.id === action.id)) return library;
  const selection = new Set(action.aliases);
  let changed = false;
  const entries = library.entries.map(entry => {
    if (!selection.has(entry.alias) || (entry.bundleId ?? null) === action.id) return entry;
    changed = true;
    const { bundleId: _removed, ...remaining } = entry;
    return { ...remaining, ...(action.id ? { bundleId: action.id } : {}) };
  });
  return changed ? { ...library, entries } : library;
}

export function changeLibrary(scene: import('./scene').Scene, action: LibraryAction, referencedObjects = scene.objects): import('./scene').Scene {
  const { assetLibrary: library } = scene;
  if (action.type === 'bundle') {
    const updated = changeBundles(library, action.operation);
    return updated === library ? scene : { ...scene, assetLibrary: updated };
  }
  if (action.type === 'tags') {
    const tags = assetTagsSchema.parse(action.tags);
    const selected = new Set(action.aliases);
    const entries = library.entries.map(entry => selected.has(entry.alias) ? { ...entry, tags } : entry);
    return { ...scene, assetLibrary: { ...library, entries } };
  }
  if ((action.type === 'create' || action.type === 'move') && action.parent !== null &&
    !library.folders.some(folder => folder.id === action.parent)) return scene;
  if (action.type === 'create') {
    const name = libraryName.parse(action.name);
    if (siblingNameTaken(library, action.parent, name)) throw new Error('assetNameConflict');
    return { ...scene, assetLibrary: { ...library, folders: [...library.folders, { id: action.id, parentId: action.parent, name }] } };
  }
  const folder = action.item.type === 'folder' ? library.folders.find(item => item.id === action.item.id) : undefined;
  const asset = action.item.type === 'asset' ? library.entries.find(item => item.alias === action.item.id) : undefined;
  const entry = folder ?? asset;
  if (!entry) return scene;
  const originalParent = folder?.parentId ?? asset?.folderId ?? null;
  if (action.type === 'delete') {
    if (folder && (library.folders.some(item => item.parentId === folder.id) || library.entries.some(item => item.folderId === folder.id))) {
      throw new Error('assetFolderNotEmpty');
    }
    if (asset && assetUsers(referencedObjects, asset.alias).length) throw new Error('assetInUse');
    return {
      ...scene, assets: asset ? scene.assets.filter(item => item.alias !== asset.alias) : scene.assets,
      assetLibrary: {
        ...library,
        folders: library.folders.filter(item => item !== folder),
        entries: library.entries.filter(item => item !== asset),
      },
    };
  }
  const name = action.type === 'rename' ? libraryName.parse(action.name) : entry.name;
  const parent = action.type === 'move' ? action.parent : originalParent;
  if (parent === originalParent && name === entry.name) return scene;
  if (siblingNameTaken(library, parent, name, action.item.id)) throw new Error('assetNameConflict');
  if (folder) {
    const parents = new Map(library.folders.map(item => [item.id, item.parentId]));
    for (let candidate = parent; candidate !== null; candidate = parents.get(candidate) ?? null) {
      if (candidate === folder.id) throw new Error('assetMoveCycle');
    }
  }
  return { ...scene, assetLibrary: {
    ...library,
    folders: folder ? library.folders.map(item => item === folder ? { ...item, name, parentId: parent } : item) : library.folders,
    entries: asset ? library.entries.map(item => item === asset ? { ...item, name, folderId: parent } : item) : library.entries,
  } };
}
