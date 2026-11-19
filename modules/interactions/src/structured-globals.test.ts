import {expect, it} from 'vitest';
import {InteractionSession, GlobalStore, GlobalsSchema, builtinActions, compareGlobal, formatTemplate, globalAt, parseGlobal, parseItem, showItem, validateInteractions, type Globals, type Rule} from './index';
import type {Entity} from '@rewrite/scene';

const defs: Globals = {version: 1, items: [
 {id: 'inv', name: 'inventory', type: 'list', initial: ['sword']},
 {id: 'pl', name: 'player', type: 'object', initial: {hp: 10, name: 'Ada', tags: ['brave']}},
]};
const host = (rules: Rule[]): Entity => ({id: 'host', name: 'Host', parentId: null, active: true, components: [{id: 'b', type: 'interactions.bindings', version: 1, data: {rules}}]} as never);

it('validates list and object globals: types, limits and field names', () => {
 expect(GlobalsSchema.parse(defs).items).toHaveLength(2);
 expect(() => GlobalsSchema.parse({version: 1, items: [{id: 'x', name: 'x', type: 'list', initial: {}}]})).toThrow();
 expect(() => GlobalsSchema.parse({version: 1, items: [{id: 'x', name: 'x', type: 'object', initial: {'bad key': 1}}]})).toThrow();
 expect(() => GlobalsSchema.parse({version: 1, items: [{id: 'x', name: 'x', type: 'list', initial: Array(1001).fill(0)}]})).toThrow();
 expect(() => GlobalsSchema.parse({version: 1, items: [{id: 'x', name: 'x', type: 'list', initial: [[[[[[[1]]]]]]]}]})).toThrow();
 expect(parseGlobal('list', '["a", 2, true]')).toEqual(['a', 2, true]);
 expect(() => parseGlobal('list', '{"a": 1}')).toThrow('Enter a JSON list');
 expect(() => parseGlobal('object', '[1]')).toThrow('Enter a JSON object');
 expect(() => parseGlobal('object', '{oops')).toThrow('Enter a JSON object');
 expect([parseItem('3'), parseItem('key'), parseItem('"3"'), parseItem('true')]).toEqual([3, 'key', '3', true]);
 expect([showItem(3), showItem('key'), showItem('3')]).toEqual(['3', 'key', '"3"']);
});

it('stores frozen copies, changes by content, and supports push / remove / fields with change events', () => {
 const store = new GlobalStore(defs), changes: string[] = [];
 store.changes$.subscribe(c => changes.push(`${c.name}=${JSON.stringify(c.value)}`));
 const inv = store.get('inv') as string[];
 expect(Object.isFrozen(inv)).toBe(true);
 expect(() => { inv.push('x'); }).toThrow();
 store.set('inv', ['sword']);
 expect(changes).toEqual([]);
 store.push('inv', 'key'); store.push('inv', 'key'); store.removeItem('inv', 'key'); store.removeItem('inv', 'missing');
 store.setField('pl', 'hp', 7); store.setField('pl', 'tags', undefined);
 expect(() => store.set('inv', {a: 1})).toThrow('inventory is a list, not a object');
 expect(() => store.push('pl', 1)).toThrow('player is not a list');
 expect(changes).toEqual(['inventory=["sword","key"]', 'inventory=["sword","key","key"]', 'inventory=["sword","key"]', 'player={"hp":7,"name":"Ada","tags":["brave"]}', 'player={"hp":7,"name":"Ada"}']);
 const saved = store.values(), fresh = new GlobalStore(defs);
 fresh.restore({...saved, inv: 'not a list'});
 expect(fresh.get('pl')).toEqual({hp: 7, name: 'Ada'});
 expect(fresh.get('inv')).toEqual(['sword']);
});

it('templates read lists, fields and counts; conditions compare items, counts, fields and content', () => {
 const store = new GlobalStore(defs);
 expect(formatTemplate('{inventory} · {inventory.length} · {inventory.0} · {player.hp} HP · {player.tags.0} · {player} · {player.missing}', store.byName)).toBe('sword · 1 · sword · 10 HP · brave · {"hp":10,"name":"Ada","tags":["brave"]} · {player.missing}');
 expect(globalAt(['a', 'b'], ['1'])).toBe('b');
 expect(globalAt({a: {b: 2}}, ['a', 'b'])).toBe(2);
 expect(globalAt({a: 1}, ['toString'])).toBeUndefined();
 expect([compareGlobal(['a', 2], 'contains', 2), compareGlobal(['a'], 'contains', 'b'), compareGlobal(['a', 'b'], '>=', 2), compareGlobal(['a'], '>', 1)]).toEqual([true, false, true, false]);
 expect([compareGlobal({hp: 1}, 'has', 'hp'), compareGlobal({hp: 1}, 'has', 'mp'), compareGlobal({a: [1]}, '==', {a: [1]}), compareGlobal(['x'], '!=', ['x'])]).toEqual([true, false, true, false]);
});

it('rules add and remove list items, set and remove object fields, and are checked against the global types', () => {
 const store = new GlobalStore(defs);
 const rule: Rule = {id: 'r', trigger: {type: 'pointer.click', sourceId: 'host', event: ''}, condition: {globalId: 'inv', op: 'contains', value: 'sword'}, actions: [
  {id: 'a', type: 'list.add', targetId: 'inv', value: true, to: 'shield'}, {id: 'b', type: 'list.remove', targetId: 'inv', value: true, to: 'sword'},
  {id: 'c', type: 'object.set', targetId: 'pl', value: true, key: 'hp', to: 3}, {id: 'd', type: 'object.remove', targetId: 'pl', value: true, key: 'name'},
 ]};
 const entities = [host([rule, {id: 'r2', trigger: {type: 'pointer.click', sourceId: 'host', event: ''}, condition: {globalId: 'pl', op: 'has', value: 'name'}, actions: [{id: 'e', type: 'list.clear', targetId: 'inv', value: true}]}])];
 const session = new InteractionSession(() => entities, builtinActions, {invoke: () => {}, setActive: () => {}, changeScene: () => {}, globals: store});
 session.emit({type: 'pointer.click', sourceId: 'host', silent: false}); session.flush();
 expect(store.get('inv')).toEqual(['shield']);
 expect(store.get('pl')).toEqual({hp: 3, tags: ['brave']});
 session.emit({type: 'pointer.click', sourceId: 'host', silent: false}); session.flush();
 expect(store.get('inv')).toEqual(['shield']); // no sword any more, and the player lost its name: neither rule runs
 const catalog = {entities, scenes: [], globals: defs.items.map(g => ({id: g.id, name: g.name, type: g.type}))};
 expect(validateInteractions(catalog, [{type: 'pointer.click', titleKey: 'click', entityReference: true, references: c => c.entities.map(e => ({id: e.id, name: e.name}))}], builtinActions)).toEqual([]);
 const bad = [host([{id: 'x', trigger: {type: 'pointer.click', sourceId: 'host', event: ''}, condition: {globalId: 'inv', op: '>=', value: 'two'}, actions: [{id: 'y', type: 'object.set', targetId: 'pl', value: true, to: 1}, {id: 'z', type: 'global.set', targetId: 'inv', value: true, to: {a: 1}}]}])];
 expect(validateInteractions({...catalog, entities: bad}, [{type: 'pointer.click', titleKey: 'click', entityReference: true, references: c => c.entities.map(e => ({id: e.id, name: e.name}))}], builtinActions).join('\n')).toMatch(/compares the list inventory with a string[\s\S]*has no field name[\s\S]*sets the list inventory to a object/);
});
