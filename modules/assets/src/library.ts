import {z} from 'zod';
import type {AssetRecord} from './contracts';

/**
 * Library organisation (editor-only, never exported): folders (nested), tags per asset, and the "Generated" inbox where
 * generated assets wait until they are sent to the Library. Asset records themselves stay in `assets.registry`.
 */
export const librarySection = 'assets.library';
export const TagSchema = z.string().trim().toLowerCase().min(1).max(40).regex(/^[\p{L}\p{N} _.-]+$/u, 'Tags use letters, digits, spaces, _ . and -');
const FolderId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const FolderSchema = z.object({id: FolderId, name: z.string().trim().min(1).max(60), parentId: FolderId.nullable()}).strict();
export const LibraryEntrySchema = z.object({folderId: FolderId.nullable().default(null), tags: z.array(TagSchema).max(32).default([]),
 /** Generated and not sent to the Library yet. */
 inbox: z.boolean().optional()}).strict();
export const LibrarySchema = z.object({version: z.literal(1), folders: z.array(FolderSchema).max(500).default([]), items: z.record(z.uuid(), LibraryEntrySchema).default({})}).strict().superRefine((v, c) => {
 const ids = new Set(v.folders.map(f => f.id));
 if (ids.size !== v.folders.length) c.addIssue({code: 'custom', message: 'Folder IDs must be unique'});
 for (const f of v.folders) {
  if (f.parentId && !ids.has(f.parentId)) c.addIssue({code: 'custom', message: `Folder ${f.name} has a missing parent`});
  let p = f.parentId, depth = 0;
  while (p && depth++ < 64) { if (p === f.id) { c.addIssue({code: 'custom', message: `Folder ${f.name} is inside itself`}); break; } p = v.folders.find(x => x.id === p)?.parentId ?? null; }
 }
 for (const [id, e] of Object.entries(v.items)) if (e.folderId && !ids.has(e.folderId)) c.addIssue({code: 'custom', message: `Asset ${id} is in a missing folder`});
});
export type Library = z.infer<typeof LibrarySchema>;
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;
export type Folder = z.infer<typeof FolderSchema>;
export const emptyLibrary = (): Library => ({version: 1, folders: [], items: {}});
export const entryOf = (lib: Library, id: string): LibraryEntry => lib.items[id] ?? {folderId: null, tags: []};

/** Broad kind of an asset type, for filters. */
export type AssetKind = 'image' | 'audio' | 'font' | 'spine' | 'model' | 'other';
export const kindOf = (type: string): AssetKind => type === 'pixi.texture' ? 'image' : type === 'audio.clip' ? 'audio' : type === 'font.face' ? 'font' : type === 'spine.skeleton' ? 'spine' : type === 'pixi3d.model' ? 'model' : 'other';

/** Folders from the root to `folderId`. */
export function folderPath(lib: Library, folderId: string | null): Folder[] {
 const out: Folder[] = [];
 let id = folderId;
 while (id && out.length < 64) { const f = lib.folders.find(x => x.id === id); if (!f) break; out.unshift(f); id = f.parentId; }
 return out;
}
/** A folder and every folder inside it. */
export function folderAndDescendants(lib: Library, folderId: string): Set<string> {
 const out = new Set([folderId]);
 for (let changed = true; changed;) { changed = false; for (const f of lib.folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); changed = true; } }
 return out;
}

export type LibraryView = {kind: 'all'} | {kind: 'inbox'} | {kind: 'unfiled'} | {kind: 'folder'; id: string};
export interface LibraryQuery {view: LibraryView; text?: string; tags?: readonly string[]; kinds?: readonly AssetKind[]; usage?: 'used' | 'unused'; used?: ReadonlySet<string>; sort?: 'added' | 'name' | 'recent' | 'size' | 'type'}
/** Assets a view shows: folder views include subfolders and leave the inbox out; text matches names and tags. */
export function filterAssets(items: readonly AssetRecord[], lib: Library, q: LibraryQuery): AssetRecord[] {
 const text = q.text?.trim().toLowerCase() ?? '', folder = q.view.kind === 'folder' ? folderAndDescendants(lib, q.view.id) : null;
 const out = items.filter(a => {
  const e = entryOf(lib, a.id);
  if (q.view.kind === 'inbox' && !e.inbox) return false;
  if (q.view.kind === 'unfiled' && (e.inbox || e.folderId)) return false;
  if (folder && (e.inbox || !e.folderId || !folder.has(e.folderId))) return false;
  if (text && !a.name.toLowerCase().includes(text) && !e.tags.some(t => t.includes(text))) return false;
  if (q.tags?.length && !q.tags.every(t => e.tags.includes(t))) return false;
  if (q.kinds?.length && !q.kinds.includes(kindOf(a.type))) return false;
  if (q.usage && q.used && (q.usage === 'used') !== q.used.has(a.id)) return false;
  return true;
 });
 const order = new Map(items.map((a, i) => [a.id, i]));
 if (q.sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
 else if (q.sort === 'size') out.sort((a, b) => b.source.bytes - a.source.bytes);
 else if (q.sort === 'type') out.sort((a, b) => kindOf(a.type).localeCompare(kindOf(b.type)) || a.name.localeCompare(b.name));
 else if (q.sort === 'recent') out.sort((a, b) => order.get(b.id)! - order.get(a.id)!);
 return out;
}
/** Asset counts per view (all, inbox, unfiled, each folder with its subfolders). */
export function viewCounts(items: readonly AssetRecord[], lib: Library) {
 const folders: Record<string, number> = {};
 let inbox = 0, unfiled = 0;
 for (const a of items) {
  const e = entryOf(lib, a.id);
  if (e.inbox) { inbox++; continue; }
  if (!e.folderId) { unfiled++; continue; }
  for (const f of folderPath(lib, e.folderId)) folders[f.id] = (folders[f.id] ?? 0) + 1;
 }
 return {all: items.length, inbox, unfiled, folders};
}
/** Tags in use with their counts, most used first. */
export function tagCounts(items: readonly AssetRecord[], lib: Library): [string, number][] {
 const counts = new Map<string, number>();
 for (const a of items) for (const t of entryOf(lib, a.id).tags) counts.set(t, (counts.get(t) ?? 0) + 1);
 return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Edits (each returns a new, valid library). */
const clone = (lib: Library) => structuredClone(LibrarySchema.parse(lib));
const put = (lib: Library, id: string, patch: Partial<LibraryEntry>) => { const next = {...entryOf(lib, id), ...patch}; if (!next.inbox) delete next.inbox; lib.items[id] = next; };
export function createFolder(input: Library, name: string, parentId: string | null, id = crypto.randomUUID().slice(0, 12)): {library: Library; id: string} {
 const lib = clone(input), clean = FolderSchema.shape.name.parse(name);
 if (lib.folders.some(f => f.parentId === parentId && f.name.toLowerCase() === clean.toLowerCase())) throw Error(`A folder named "${clean}" is already here`);
 lib.folders.push({id, name: clean, parentId});
 return {library: LibrarySchema.parse(lib), id};
}
export function renameFolder(input: Library, id: string, name: string): Library {
 const lib = clone(input), f = lib.folders.find(x => x.id === id);
 if (!f) throw Error('Folder missing');
 const clean = FolderSchema.shape.name.parse(name);
 if (lib.folders.some(x => x.id !== id && x.parentId === f.parentId && x.name.toLowerCase() === clean.toLowerCase())) throw Error(`A folder named "${clean}" is already here`);
 f.name = clean;
 return LibrarySchema.parse(lib);
}
/** Moves a folder under another (or the root); refuses to move a folder into itself. */
export function moveFolder(input: Library, id: string, parentId: string | null): Library {
 const lib = clone(input), f = lib.folders.find(x => x.id === id);
 if (!f) throw Error('Folder missing');
 if (parentId && folderAndDescendants(lib, id).has(parentId)) throw Error('A folder cannot go inside itself');
 f.parentId = parentId;
 return LibrarySchema.parse(lib);
}
/** Deletes a folder; its assets and subfolders move up to its parent. */
export function deleteFolder(input: Library, id: string): Library {
 const lib = clone(input), f = lib.folders.find(x => x.id === id);
 if (!f) throw Error('Folder missing');
 for (const x of lib.folders) if (x.parentId === id) x.parentId = f.parentId;
 for (const e of Object.values(lib.items)) if (e.folderId === id) e.folderId = f.parentId;
 lib.folders = lib.folders.filter(x => x.id !== id);
 return LibrarySchema.parse(lib);
}
/** Puts assets into a folder (null: unfiled); this also takes them out of the inbox. */
export function moveAssets(input: Library, ids: readonly string[], folderId: string | null): Library {
 const lib = clone(input);
 if (folderId && !lib.folders.some(f => f.id === folderId)) throw Error('Folder missing');
 for (const id of ids) put(lib, id, {folderId, inbox: false});
 return LibrarySchema.parse(lib);
}
export function addTags(input: Library, ids: readonly string[], tags: readonly string[]): Library {
 const lib = clone(input), clean = tags.map(t => TagSchema.parse(t));
 for (const id of ids) put(lib, id, {tags: [...new Set([...entryOf(lib, id).tags, ...clean])].slice(0, 32)});
 return LibrarySchema.parse(lib);
}
export function removeTag(input: Library, ids: readonly string[], tag: string): Library {
 const lib = clone(input);
 for (const id of ids) put(lib, id, {tags: entryOf(lib, id).tags.filter(t => t !== tag)});
 return LibrarySchema.parse(lib);
}
/** New generated assets wait in the inbox with tags describing how they were made. */
export function addToInbox(input: Library, ids: readonly string[], tags: readonly string[]): Library {
 const lib = clone(input), clean = tags.flatMap(t => { const p = TagSchema.safeParse(t); return p.success ? [p.data] : []; });
 for (const id of ids) put(lib, id, {inbox: true, folderId: null, tags: [...new Set([...entryOf(lib, id).tags, ...clean])].slice(0, 32)});
 return LibrarySchema.parse(lib);
}
/** Drops entries of assets that no longer exist. */
export function pruneLibrary(input: Library, existing: ReadonlySet<string>): Library {
 const lib = clone(input);
 for (const id of Object.keys(lib.items)) if (!existing.has(id)) delete lib.items[id];
 return LibrarySchema.parse(lib);
}

/** Where assets are used: every component value (at any depth) equal to an asset ID, per scene or prefab. */
export function assetUsage(scopes: readonly {id: string; name: string; entities: readonly {id: string; name: string; components: readonly {type: string; data: unknown}[]}[]}[], ids: ReadonlySet<string>) {
 const usage = new Map<string, {scope: string; entity: string; component: string}[]>();
 const walk = (value: unknown, hit: (id: string) => void, depth = 0) => {
  if (typeof value === 'string') { if (ids.has(value)) hit(value); }
  else if (value && typeof value === 'object' && depth < 8) for (const v of Object.values(value)) walk(v, hit, depth + 1);
 };
 for (const s of scopes) for (const e of s.entities) for (const c of e.components) walk(c.data, id => { const list = usage.get(id) ?? []; if (!list.some(u => u.scope === s.name && u.entity === e.name && u.component === c.type)) list.push({scope: s.name, entity: e.name, component: c.type}); usage.set(id, list); });
 return usage;
}
