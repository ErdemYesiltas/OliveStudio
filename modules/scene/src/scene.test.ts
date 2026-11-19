import { expect, it } from 'vitest';
import { SceneService, transformDefinition, makeEntity, parseScene, referencePaths, spawnCopy } from './index';
const defs = new Map([[transformDefinition.type, transformDefinition]]);
it('keeps unknown components losslessly and validates known data before editing', () => {
 const service = new SceneService(() => defs), id = service.create();
 const data = structuredClone(service.document.current);
 data.entities[0].components.push({ id: 'unknown', type: 'external.special', version: 9, data: { nested: [1,'x',null] } });
 service.document.replace(data); service.rename(id, 'Renamed');
 expect(service.document.current.entities[0].components[1]).toEqual(data.entities[0].components[1]);
 expect(service.diagnostics).toHaveLength(1);
 expect(() => service.setField(id, 'scene.transform2d', 'x', 'bad')).toThrow();
 service.document.undo(); expect(service.document.current).toEqual(data);
});
it('duplicates descendants with new component IDs and deletes as one transaction', () => {
 const service = new SceneService(() => defs), a = makeEntity('Parent'), b = makeEntity('Child'); b.parentId = a.id;
 service.document.replace({ formatVersion: 1, id: 'scene', name: 'Test', entities: [a,b] });
 const copy = service.duplicate(a.id), entities = service.document.current.entities;
 expect(entities).toHaveLength(4); expect(entities[3].parentId).toBe(copy);
 expect(new Set(entities.flatMap(e => e.components.map(c => c.id))).size).toBe(4);
 service.remove(copy); expect(service.document.current.entities).toHaveLength(2);
 service.document.undo(); expect(service.document.current.entities).toHaveLength(4);
});
it('rejects hierarchy cycles and duplicate component types', () => {
 const a = makeEntity('A'), b = makeEntity('B'); a.parentId = b.id; b.parentId = a.id;
 expect(() => parseScene({ formatVersion: 1, id: 's', name: 'S', entities: [a,b] }, defs)).toThrow('cycle');
 const service = new SceneService(() => defs), id = service.create();
 expect(() => service.addComponent(id, transformDefinition.type)).toThrow('Duplicate');
});

it('preserves world position when reparenting and rejects a cycle without touching history', () => {
 const service=new SceneService(()=>defs),parent=makeEntity('Parent',100,50),child=makeEntity('Child',300,200);
 service.document.replace({formatVersion:1,id:'s',name:'S',entities:[parent,child]});
 service.reparent(child.id,parent.id);
 expect(service.document.current.entities[1].components[0].data).toMatchObject({x:200,y:150});
 expect(()=>service.reparent(parent.id,child.id)).toThrow('cycle');service.document.undo();expect(service.document.current.entities).toEqual([parent,child]);
});

it('commits the entire transform once, rejects stale/invalid gestures and preserves undo history',()=>{
 const service=new SceneService(()=>defs),entity=makeEntity('Entity');service.document.replace({formatVersion:1,id:'s',name:'S',entities:[entity]});
 const original={x:480,y:270,rotation:0,scaleX:1,scaleY:1},next={x:500,y:300,rotation:30,scaleX:2,scaleY:3};
 service.setTransform(entity.id,original,original);expect(service.document.canUndo).toBe(false);
 service.setTransform(entity.id,next,original);expect(service.document.current.entities[0].components[0].data).toEqual(next);
 expect(()=>service.setTransform(entity.id,original,original)).toThrow('changed');
 expect(()=>service.setTransform(entity.id,{...next,scaleX:0},next)).toThrow();
 service.document.undo();expect(service.document.current.entities[0].components[0].data).toEqual(original);expect(service.document.canUndo).toBe(false);
 service.document.redo();expect(service.document.current.entities[0].components[0].data).toEqual(next);
});
it('moves only sibling order while preserving interleaved descendants, identities and transforms in one undo step',()=>{const service=new SceneService(()=>defs),a=makeEntity('A'),b=makeEntity('B'),c=makeEntity('C'),aa=makeEntity('AA'),ab=makeEntity('AB');aa.parentId=a.id;ab.parentId=a.id;service.document.replace({formatVersion:1,id:'s',name:'Order',entities:[a,aa,b,ab,c]});const before=service.document.current;service.moveSibling(b.id,-1);expect(service.document.current.entities.map(e=>e.id)).toEqual([b.id,aa.id,a.id,ab.id,c.id]);for(const e of before.entities)expect(service.document.current.entities.find(copy=>copy.id===e.id)).toEqual(e);service.document.undo();expect(service.document.current).toEqual(before);expect(service.document.canUndo).toBe(false);service.document.redo();expect(service.document.current.entities[0].id).toBe(b.id);service.moveSibling(aa.id,1);expect(service.document.current.entities.filter(e=>e.parentId===a.id).map(e=>e.id)).toEqual([ab.id,aa.id]);expect(service.document.current.entities.filter(e=>e.parentId===null).map(e=>e.id)).toEqual([b.id,a.id,c.id]);});
it('does not dirty or add history when a sibling is at its boundary; rejects missing IDs atomically',()=>{const service=new SceneService(()=>defs),a=makeEntity('Only');service.document.replace({formatVersion:1,id:'s',name:'Order',entities:[a]});const before=service.document.current;service.moveSibling(a.id,-1);service.moveSibling(a.id,1);expect(service.document.current).toBe(before);expect(service.document.canUndo).toBe(false);expect(service.document.dirty).toBe(false);expect(()=>service.moveSibling('missing',1)).toThrow('Entity missing');expect(service.document.current).toBe(before);});
it('allows at most one entity per scene with a uniqueInScene component (the camera)', () => {
 const camera: import('@rewrite/sdk').ComponentDefinition = {type: 'test.camera', version: 1, titleKey: 'Camera', uniqueInScene: 'Camera', fields: [], defaults: () => ({}), parse: v => v as import('@rewrite/sdk').Json};
 const map = new Map([[transformDefinition.type, transformDefinition], [camera.type, camera]]), service = new SceneService(() => map), a = service.create('A'), b = service.create('B');
 service.addComponent(a, camera.type);
 expect(() => service.addComponent(b, camera.type)).toThrow('A scene can have only one Camera');
 expect(() => service.duplicate(a)).toThrow('only one Camera');
 expect(service.document.current.entities.filter(e => e.components.some(c => c.type === camera.type))).toHaveLength(1);
 service.removeComponent(a, camera.type); service.addComponent(b, camera.type);
 expect(parseScene(service.document.current, map).entities.find(e => e.id === b)?.components).toHaveLength(2);
});
it('finds reference paths through a definition and copies a subtree for spawning with references remapped', () => {
 const link: import('@rewrite/sdk').ComponentDefinition = {type: 'test.link', version: 1, titleKey: 'Link', fields: [], defaults: () => ({}), parse: v => v as import('@rewrite/sdk').Json,
  remapReferences: (v, ids) => { const d = v as {tracks: {entityId: string; componentId: string; label: string}[]; target: string}; return {...d, target: ids.entities.get(d.target) ?? d.target, tracks: d.tracks.map(t => ({...t, entityId: ids.entities.get(t.entityId) ?? t.entityId, componentId: ids.components.get(t.componentId) ?? t.componentId}))}; }};
 const root = makeEntity('Ship', 10, 20), child = makeEntity('Flame', 0, 5), outside = makeEntity('Planet');
 child.parentId = root.id;
 const data = {tracks: [{entityId: child.id, componentId: child.components[0].id, label: child.id}], target: outside.id};
 root.components.push({id: 'link', type: link.type, version: 1, data});
 const paths = referencePaths(data, link);
 expect(paths).toHaveLength(3);
 expect(paths).toEqual(expect.arrayContaining([['target'], ['tracks', 0, 'entityId'], ['tracks', 0, 'componentId']]));
 expect(referencePaths(data, transformDefinition)).toEqual([]);
 const seen: string[] = [];
 const copy = spawnCopy([outside, root, child], root.id, c => c.type === link.type ? paths : [], {x: 300, y: 400}, (from, to) => seen.push(`${from.id}>${to.id}`));
 expect(copy).toHaveLength(2);
 const [newRoot, newChild] = copy;
 expect(newRoot.id).not.toBe(root.id); expect(newRoot.parentId).toBeNull(); expect(newChild.parentId).toBe(newRoot.id);
 expect(newRoot.components[0].data).toMatchObject({x: 300, y: 400});
 const linked = newRoot.components.find(c => c.type === link.type)!.data as typeof data;
 expect(linked.tracks[0]).toEqual({entityId: newChild.id, componentId: newChild.components[0].id, label: child.id});
 expect(linked.target).toBe(outside.id);
 expect(seen).toHaveLength(3);
 expect(root.components[1].data).toEqual(data);
});
