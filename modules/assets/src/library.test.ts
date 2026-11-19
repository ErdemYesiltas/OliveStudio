import {expect, it} from 'vitest';
import type {AssetRecord} from './contracts';
import {addTags, addToInbox, assetUsage, createFolder, deleteFolder, emptyLibrary, filterAssets, folderPath, LibrarySchema, moveAssets, moveFolder, pruneLibrary, removeTag, renameFolder, tagCounts, viewCounts} from './library';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asset = (n: number, name: string, type = 'pixi.texture', bytes = 1000): AssetRecord => ({id: id(n), name, type, revision: 'a'.repeat(64), source: {extension: 'png', bytes}, metadata: {}});
const items = [asset(1, 'hero'), asset(2, 'coin', 'pixi.texture', 5000), asset(3, 'jump', 'audio.clip'), asset(4, 'slime gen')];

it('folders nest, rename, move and delete (contents move up); names are unique per parent; no cycles', () => {
 const r = createFolder(emptyLibrary(), 'Characters', null, 'chars'); let lib = r.library;
 lib = createFolder(lib, 'Enemies', 'chars', 'enemies').library;
 expect(() => createFolder(lib, 'characters', null)).toThrow('already here');
 expect(folderPath(lib, 'enemies').map(f => f.name)).toEqual(['Characters', 'Enemies']);
 lib = renameFolder(lib, 'enemies', 'Foes');
 expect(() => moveFolder(lib, 'chars', 'enemies')).toThrow('inside itself');
 lib = moveAssets(lib, [id(1)], 'enemies');
 lib = deleteFolder(lib, 'enemies');
 expect(lib.items[id(1)].folderId).toBe('chars'); expect(lib.folders.map(f => f.id)).toEqual(['chars']);
 expect(() => LibrarySchema.parse({version: 1, folders: [{id: 'a', name: 'A', parentId: 'b'}, {id: 'b', name: 'B', parentId: 'a'}], items: {}})).toThrow('inside itself');
});
it('views, text/tag/kind/usage filters, sorting and counts; the inbox stays out of folders until sent', () => {
 let lib = createFolder(emptyLibrary(), 'Sprites', null, 'sprites').library;
 lib = moveAssets(lib, [id(1), id(2)], 'sprites');
 lib = addTags(lib, [id(1), id(2)], ['Pixel', 'ui']);
 lib = addToInbox(lib, [id(4)], ['generated', 'image', 'Bad tag!']);
 expect(lib.items[id(4)]).toEqual({folderId: null, tags: ['generated', 'image'], inbox: true});
 const names = (q: Parameters<typeof filterAssets>[2]) => filterAssets(items, lib, q).map(a => a.name);
 expect(names({view: {kind: 'folder', id: 'sprites'}, sort: 'name'})).toEqual(['coin', 'hero']);
 expect(names({view: {kind: 'inbox'}})).toEqual(['slime gen']);
 expect(names({view: {kind: 'unfiled'}})).toEqual(['jump']);
 expect(names({view: {kind: 'all'}, text: 'pix'})).toEqual(['hero', 'coin']);
 expect(names({view: {kind: 'all'}, kinds: ['audio']})).toEqual(['jump']);
 expect(names({view: {kind: 'all'}, usage: 'unused', used: new Set([id(1)]), sort: 'size'})).toEqual(['coin', 'jump', 'slime gen']);
 expect(names({view: {kind: 'all'}, sort: 'recent'})).toEqual(['slime gen', 'jump', 'coin', 'hero']);
 expect(viewCounts(items, lib)).toEqual({all: 4, inbox: 1, unfiled: 1, folders: {sprites: 2}});
 expect(tagCounts(items, lib)).toEqual([['pixel', 2], ['ui', 2], ['generated', 1], ['image', 1]]);
 lib = moveAssets(lib, [id(4)], 'sprites');
 expect(lib.items[id(4)]).toEqual({folderId: 'sprites', tags: ['generated', 'image']});
 lib = removeTag(lib, [id(1)], 'ui');
 expect(lib.items[id(1)].tags).toEqual(['pixel']);
 expect(Object.keys(pruneLibrary(lib, new Set([id(1)])).items)).toEqual([id(1)]);
});
it('finds where assets are used, at any depth of component data', () => {
 const usage = assetUsage([{id: 's', name: 'Level 1', entities: [{id: 'e', name: 'Player', components: [{type: 'pixi.sprite', data: {assetId: id(1)}}, {type: 'x', data: {list: [{clip: id(3)}]}}]}]}], new Set([id(1), id(3)]));
 expect(usage.get(id(1))).toEqual([{scope: 'Level 1', entity: 'Player', component: 'pixi.sprite'}]);
 expect(usage.get(id(3))?.[0].component).toBe('x'); expect(usage.has(id(2))).toBe(false);
});
