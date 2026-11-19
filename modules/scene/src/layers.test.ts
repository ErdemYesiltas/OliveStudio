import {expect, it} from 'vitest';
import {SceneService, labelDefinition, transform, transformDefinition, type Entity} from './index';

const defs = new Map([[transformDefinition.type, transformDefinition], [labelDefinition.type, labelDefinition], ['test.box', {type: 'test.box', version: 1, titleKey: 'box', defaults: () => ({size: 1}), parse: (v: unknown) => v as never, fields: []}], ['test.cam', {type: 'test.cam', version: 1, titleKey: 'cam', uniqueInScene: 'Camera', defaults: () => ({}), parse: (v: unknown) => v as never, fields: []}]]);
const setup = () => {
 const service = new SceneService(() => defs as never), doc = () => service.document.current, find = (id: string) => doc().entities.find(e => e.id === id)!;
 const make = (name: string, value: Record<string, number>) => { const id = service.create(name); service.setTransform(id, {x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ...value}, transform(find(id))); return id; };
 return {service, doc, find, make};
};
const world = (doc: () => {entities: Entity[]}, id: string) => { let x = 0, y = 0; const chain: Entity[] = []; for (let e: Entity | undefined = doc().entities.find(e => e.id === id); e; e = e.parentId ? doc().entities.find(p => p.id === e!.parentId) : undefined) chain.unshift(e); let r = 0, sx = 1, sy = 1; for (const e of chain) { const t = transform(e), a = r * Math.PI / 180, lx = t.x * sx, ly = t.y * sy; x += lx * Math.cos(a) - ly * Math.sin(a); y += lx * Math.sin(a) + ly * Math.cos(a); r += t.rotation; sx *= t.scaleX; sy *= t.scaleY; } return {x: Math.round(x * 1e6) / 1e6, y: Math.round(y * 1e6) / 1e6, r}; };

it('groups objects at the centre of their origins without moving them, keeps draw order, ungroups back; one undo each', () => {
 const {service, doc, find, make} = setup();
 const a = make('A', {x: 100, y: 100}), back = make('Back', {x: 0, y: 0}), b = make('B', {x: 300, y: 200, rotation: 45}), c = make('C', {x: 500, y: 300});
 service.place([c], back, null);
 const before = [a, b, c].map(id => world(doc, id));
 const g = service.group([a, b, c]);
 expect(transform(find(g))).toMatchObject({x: 300, y: 200});
 expect([a, b, c].map(id => find(id).parentId)).toEqual([g, g, g]);
 expect([a, b, c].map(id => world(doc, id))).toEqual(before);
 expect(doc().entities.map(e => e.name)).toEqual(['Group', 'A', 'Back', 'B', 'C']);
 service.document.undo();
 expect(doc().entities.some(e => e.id === g)).toBe(false);
 service.document.redo();
 expect(service.ungroup([g]).sort()).toEqual([a, b, c].sort());
 expect(doc().entities.map(e => e.name)).toEqual(['A', 'B', 'C', 'Back']);
 expect([a, b, c].map(id => world(doc, id))).toEqual(before);
 expect(() => service.ungroup([a])).not.toThrow();
 service.addComponent(back, 'test.box');
 expect(() => service.ungroup([back])).toThrow(/plain groups/);
});

it('renames in Layers order with numbers, padding and the old name; labels and component order and paste', () => {
 const {service, doc, find, make} = setup();
 const ids = [make('Brick', {}), make('Brick', {}), make('Wall', {})];
 service.renameMany([ids[2], ids[0], ids[1]], '{name} {nn}', 9);
 expect(doc().entities.map(e => e.name)).toEqual(['Brick 09', 'Brick 10', 'Wall 11']);
 service.document.undo(); expect(doc().entities.map(e => e.name)).toEqual(['Brick', 'Brick', 'Wall']);
 service.setLabel(ids.slice(0, 2), 'red');
 expect(find(ids[0]).components.find(c => c.type === 'editor.label')?.data).toEqual({color: 'red'});
 service.setLabel([ids[0]], null);
 expect(find(ids[0]).components.some(c => c.type === 'editor.label')).toBe(false);
 service.addComponent(ids[0], 'test.box'); service.addComponent(ids[0], 'test.cam');
 const box = find(ids[0]).components.find(c => c.type === 'test.box')!;
 service.moveComponent(ids[0], box.id, 1);
 expect(find(ids[0]).components.map(c => c.type)).toEqual(['scene.transform2d', 'test.cam', 'test.box']);
 service.moveComponent(ids[0], find(ids[0]).components[1].id, -1);
 expect(find(ids[0]).components[0].type).toBe('scene.transform2d');
 expect(service.pasteComponent(ids[1], {type: 'test.box', version: 1, data: {size: 5}})).toBe('added');
 expect(service.pasteComponent(ids[1], {type: 'test.box', version: 1, data: {size: 7}})).toBe('replaced');
 expect(find(ids[1]).components.find(c => c.type === 'test.box')!.data).toEqual({size: 7});
 expect(() => service.pasteComponent(ids[2], {type: 'test.cam', version: 1, data: {}})).toThrow(/one Camera/);
 service.pasteComponent(ids[2], {type: 'scene.transform2d', version: 1, data: {x: 5, y: 6, rotation: 0, scaleX: 2, scaleY: 2}});
 expect(transform(find(ids[2]))).toMatchObject({x: 5, scaleX: 2});
});
