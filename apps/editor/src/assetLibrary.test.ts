import { describe, expect, it } from 'vitest';
import { addLibraryEntries, changeLibrary, emptyLibrary, assetUsers } from './assetLibrary';
import { sceneSchema } from './scene';

const parent = '1c3d8961-44e3-4b29-a050-528744e9b955';
const child = '90b26e90-adc9-4415-bb45-af5ae86545ef';
const alias = 'project/1c3d8961-44e3-4b29-a050-528744e9b955/tree.png';
const duplicate = 'project/90b26e90-adc9-4415-bb45-af5ae86545ef/TREE.png';
const assets = [{ alias, data: 'AAAA' }, { alias: duplicate, data: 'AAAA' }];

describe('asset library', () => {
  it('opens legacy assets from the project root with stable aliases and unique names', () => {
    const scene = sceneSchema.parse({ version: 1, objects: [], assets });
    expect(scene.assetLibrary.entries).toEqual([
      { alias, name: 'tree.png', folderId: null },
      { alias: duplicate, name: 'TREE (2).png', folderId: null },
    ]);
    expect(scene.assets).toEqual(assets);
  });

  it('keeps references through edits and rejects deleting used assets, collisions and cycles', () => {
    const sprite = { id: 's', type: 'Sprite', label: 'Tree sprite', texture: alias };
    let scene = sceneSchema.parse({ version: 1, objects: [sprite], assets, assetLibrary: addLibraryEntries(emptyLibrary, [alias, duplicate], null) });
    scene = changeLibrary(scene, { type: 'create', id: parent, parent: null, name: 'Art' });
    scene = changeLibrary(scene, { type: 'create', id: child, parent, name: 'Nature' });
    expect(() => changeLibrary(scene, { type: 'move', item: { type: 'folder', id: parent }, parent: child })).toThrow('assetMoveCycle');
    expect(() => changeLibrary(scene, { type: 'rename', item: { type: 'asset', id: duplicate }, name: 'TREE.PNG' })).toThrow('assetNameConflict');
    scene = changeLibrary(scene, { type: 'move', item: { type: 'asset', id: alias }, parent: child });
    scene = changeLibrary(scene, { type: 'rename', item: { type: 'asset', id: alias }, name: 'Sapling.png' });
    expect(assetUsers(scene.objects, alias)).toEqual(['Tree sprite']);
    expect(() => changeLibrary(scene, { type: 'delete', item: { type: 'asset', id: alias } })).toThrow('assetInUse');
    expect(() => changeLibrary(scene, { type: 'delete', item: { type: 'folder', id: parent } })).toThrow('assetFolderNotEmpty');
    expect(sceneSchema.parse(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
  });
});
