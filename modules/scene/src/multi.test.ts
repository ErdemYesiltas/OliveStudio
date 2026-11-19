import {expect, it} from 'vitest';
import {SceneService, transformDefinition, transform, subtreeRoots, type Entity} from './index';
import type {ComponentDefinition, Json} from '@rewrite/sdk';

// A component that references another entity, remapped through the component's own definition.
const link: ComponentDefinition = {
 type: 'test.link', version: 1, titleKey: 'link', defaults: () => ({target: ''}), parse: v => v as Json, fields: [],
 remapReferences: (value, ids) => { const v = value as {target: string}; return {target: ids.entities.get(v.target) ?? v.target}; },
};
const defs = new Map<string, ComponentDefinition>([[transformDefinition.type, transformDefinition], [link.type, link]]);
function setup() {
 const s = new SceneService(() => defs);
 const parent = s.create('Parent'), child = s.create('Child'), other = s.create('Other');
 s.reparent(child, parent);
 s.setTransforms([{id: parent, value: {x: 100, y: 50, rotation: 90, scaleX: 2, scaleY: 2}}]);
 return {s, parent, child, other};
}
const at = (s: SceneService, id: string) => transform(s.document.current.entities.find(e => e.id === id) as Entity);

it('treats a selected ancestor as the owner of its subtree', () => {
 const {s, parent, child, other} = setup();
 expect(subtreeRoots(s.document.current, [child, other, parent])).toEqual([parent, other]);
});

it('deletes and duplicates many subtrees in one undo step without doubling descendants', () => {
 const {s, parent, child, other} = setup(), before = s.document.current;
 const copies = s.duplicateMany([child, parent, other]);
 expect(copies).toHaveLength(2);
 expect(s.document.current.entities).toHaveLength(6);
 expect(s.document.current.entities.filter(e => e.name.endsWith(' copy')).map(e => e.name)).toEqual(['Parent copy', 'Other copy']);
 s.document.undo();
 expect(s.document.current).toEqual(before);
 s.removeMany([child, parent]);
 expect(s.document.current.entities.map(e => e.id)).toEqual([other]);
 s.document.undo();
 expect(s.document.current).toEqual(before);
});

it('applies several transforms atomically and rejects a stale expectation', () => {
 const {s, child, other} = setup(), before = s.document.current;
 expect(() => s.setTransforms([{id: other, value: {...at(s, other), x: 1}}, {id: child, value: at(s, child), expected: {...at(s, child), x: 999}}])).toThrow('Transform changed');
 expect(s.document.current).toBe(before);
 s.setTransforms([{id: other, value: {...at(s, other), x: 1}}, {id: child, value: {...at(s, child), y: 7}}]);
 s.document.undo();
 expect(s.document.current).toEqual(before);
});

it('moves by a world delta inside each parent space', () => {
 const {s, child, other} = setup(), c0 = at(s, child), o0 = at(s, other);
 s.translateWorld(new Map([[child, {x: 20, y: 0}], [other, {x: 20, y: 0}]]));
 // Parent is rotated 90° and scaled 2×: +20 world X is -10 local Y for the child.
 expect(at(s, child).x).toBeCloseTo(c0.x);
 expect(at(s, child).y).toBeCloseTo(c0.y - 10);
 expect(at(s, other)).toEqual({...o0, x: o0.x + 20});
});

it('places a subtree under a new parent before a sibling, keeping its world pose, and rejects cycles', () => {
 const {s, parent, child, other} = setup();
 s.place([other], parent, child);
 const scene = s.document.current;
 expect(scene.entities.find(e => e.id === other)!.parentId).toBe(parent);
 expect(scene.entities.filter(e => e.parentId === parent).map(e => e.id)).toEqual([other, child]);
 expect(() => s.place([parent], child, null)).toThrow('Hierarchy cycle');
 s.document.undo();
 expect(s.document.current.entities.find(e => e.id === other)!.parentId).toBeNull();
});

it('copies with world poses and pastes new IDs, remapping internal links and counting unresolved ones', () => {
 const {s, parent, child, other} = setup();
 s.addComponent(child, link.type);
 s.document.transact('link', d => { d.entities.find(e => e.id === child)!.components.find(c => c.type === link.type)!.data = {target: other}; });
 const clip = JSON.parse(JSON.stringify(s.copy([child])));
 expect(clip.entities[0].parentId).toBeNull();
 const world = clip.entities[0].components.find((c: {type: string}) => c.type === transformDefinition.type).data;
 expect(world.x).toBeCloseTo(100 - 2 * at(s, child).y);
 // Same scene: the external link target exists.
 expect(s.paste(clip).unresolved).toBe(0);
 // Another scene: the copied link points at an object that is not there.
 const target = new SceneService(() => defs), pasted = target.paste(clip);
 expect(pasted.unresolved).toBe(1);
 expect(pasted.ids[0]).not.toBe(child);
 // Internal links follow the copy.
 const clip2 = s.copy([child, other]), result = target.paste(clip2), copies = target.document.current.entities;
 const linked = copies.find(e => e.id === result.ids[0])!.components.find(c => c.type === link.type)!.data as {target: string};
 expect(linked.target).toBe(result.ids[1]);
 expect(result.unresolved).toBe(0);
 expect(() => target.paste({...clip2, roots: ['missing']})).toThrow();
 void parent;
});
