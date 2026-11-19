import {expect, it} from 'vitest';
import {firstValueFrom, take, toArray} from 'rxjs';
import {InteractionSession, GlobalStore, GlobalsSchema, builtinActions, builtinTriggers, formatTemplate, interactionDefinition, parseGlobal, saveActions, validateInteractions, type Globals, type Rule} from './index';
import type {Entity} from '@rewrite/scene';

const defs: Globals = {version: 1, items: [
 {id: 'g-score', name: 'score', type: 'number', initial: 0},
 {id: 'g-paused', name: 'paused', type: 'boolean', initial: false},
 {id: 'g-hero', name: 'hero', type: 'string', initial: 'knight'},
]};
const catalogGlobals = defs.items.map(g => ({id: g.id, name: g.name, type: g.type}));
const host = (rules: Rule[]): Entity => ({id: 'host', name: 'Host', parentId: null, active: true, components: [
 {id: 't', type: 'scene.transform2d', version: 1, data: {x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1}},
 {id: 'b', type: 'interactions.bindings', version: 1, data: {rules}},
]});
function run(rules: Rule[]) {
 const entities = [host(rules)], changes: string[] = [], reports: string[] = [], store = new GlobalStore(defs);
 const session = new InteractionSession(() => entities, [...builtinActions, ...saveActions], {setActive: id => changes.push(`active:${id}`), changeScene: id => changes.push(`scene:${id}`), invoke: () => {}, globals: store, storage: {write: v => { slot = {...v}; }, read: () => slot, clear: () => { slot = null; }}}, m => reports.push(m));
 let slot: Record<string, unknown> | null = null;
 store.changes$.subscribe(c => session.emit({type: 'global.change', sourceId: c.id, silent: c.silent}));
 const click = () => { session.emit({type: 'pointer.click', sourceId: 'host', silent: false}); session.flush(); };
 return {session, store, changes, reports, click};
}

it('streams typed values: value$ starts with the current value, changes$ reports each change once', async () => {
 const store = new GlobalStore(defs), seen = firstValueFrom(store.changes$.pipe(take(3), toArray())), score = firstValueFrom(store.value$('g-score').pipe(take(3), toArray()));
 store.add('g-score', 5); store.set('g-score', 5); store.toggle('g-paused'); store.set('g-hero', 'mage'); store.add('g-score', 1);
 expect(await seen).toEqual([{id: 'g-score', name: 'score', value: 5, previous: 0, silent: false}, {id: 'g-paused', name: 'paused', value: true, previous: false, silent: false}, {id: 'g-hero', name: 'hero', value: 'mage', previous: 'knight', silent: false}]);
 expect(await score).toEqual([0, 5, 6]);
 expect(store.snapshot()).toEqual({score: 6, paused: true, hero: 'mage'});
 expect(() => store.set('g-score', 'ten')).toThrow('score is a number');
 expect(() => store.set('g-score', Number.NaN)).toThrow();
 expect(() => store.add('g-hero', 1)).toThrow('not a number');
 expect(() => store.toggle('g-score')).toThrow('not a boolean');
 expect(() => store.get('nope')).toThrow('Unknown global');
 store.dispose();
});

it('rules add, set and toggle globals; conditions compare by type; a change re-enters the rule queue', () => {
 const {session, store, changes, click} = run([
  {id: 'r1', trigger: {type: 'pointer.click', sourceId: 'host', event: ''}, actions: [{id: 'a1', type: 'global.add', targetId: 'g-score', value: true, amount: 5}, {id: 'a2', type: 'global.toggle', targetId: 'g-paused', value: true}]},
  {id: 'r2', trigger: {type: 'global.change', sourceId: 'g-score', event: ''}, condition: {globalId: 'g-score', op: '>=', value: 10}, actions: [{id: 'a3', type: 'global.set', targetId: 'g-hero', value: true, to: 'wizard'}]},
  {id: 'r3', trigger: {type: 'global.change', sourceId: 'g-hero', event: ''}, condition: {globalId: 'g-hero', op: 'contains', value: 'wiz'}, actions: [{id: 'a4', type: 'scene.change', targetId: 'win', value: true}]},
  {id: 'r4', trigger: {type: 'global.change', sourceId: 'g-paused', event: ''}, condition: {globalId: 'g-paused', op: '==', value: true}, actions: [{id: 'a5', type: 'entity.active', targetId: 'menu', value: true}]},
 ]);
 click();
 expect(changes).toEqual(['active:menu']);
 click();
 expect(store.snapshot()).toEqual({score: 10, paused: false, hero: 'wizard'});
 expect(changes).toEqual(['active:menu', 'scene:win']);
 store.set('g-score', 10); session.flush();
 expect(changes).toHaveLength(2);
});

it('saves and restores every global by type; stops a self-feeding loop at the action budget', () => {
 const {session, store, reports} = run([{id: 'r', trigger: {type: 'pointer.click', sourceId: 'host', event: ''}, actions: [{id: 'w', type: 'save.write', targetId: 'save', value: true}]}]);
 store.set('g-hero', 'rogue'); store.set('g-paused', true);
 session.emit({type: 'pointer.click', sourceId: 'host', silent: false}); session.flush();
 store.set('g-hero', 'x'); store.set('g-paused', false);
 saveActions.find(a => a.type === 'save.read')!.execute({id: 'r', type: 'save.read', targetId: 'save', value: true}, {silent: false, setActive() {}, changeScene() {}, invoke() {}, globals: store, storage: {write() {}, read: () => ({'g-hero': 'rogue', 'g-paused': true, 'g-score': 'bad', ghost: 1}), clear() {}}});
 expect(store.snapshot()).toEqual({score: 0, paused: true, hero: 'rogue'});
 const loop = run([{id: 'r', trigger: {type: 'global.change', sourceId: 'g-score', event: ''}, actions: [{id: 'a', type: 'global.add', targetId: 'g-score', value: true, amount: 1}]}]);
 loop.store.add('g-score', 1); loop.session.flush();
 expect(loop.reports).toContain('Interaction cycle/action limit reached');
 expect(reports).toEqual([]);
});

it('keeps global references through copy remapping and validates types of conditions and set values', () => {
 const rules: Rule[] = [{id: 'r', trigger: {type: 'global.change', sourceId: 'g-score', event: ''}, condition: {globalId: 'g-score', op: '==', value: 1}, actions: [{id: 'a', type: 'global.set', targetId: 'g-score', value: true, to: 0}]}];
 const looked: string[] = [], map = (base: Map<string, string>) => new Proxy(base, {get: (target, key) => key === 'get' || key === 'has' ? (id: string) => { looked.push(id); return (target as Map<string, string>)[key](id); } : Reflect.get(target, key)});
 const out = interactionDefinition.remapReferences!({rules}, {entities: map(new Map()), components: map(new Map())}) as {rules: Rule[]};
 expect(looked).not.toContain('g-score');
 expect(out.rules[0].trigger.sourceId).toBe('g-score');
 const catalog = {entities: [host(rules)], scenes: [], globals: catalogGlobals};
 expect(validateInteractions(catalog, builtinTriggers, builtinActions)).toEqual([]);
 expect(validateInteractions({...catalog, globals: []}, builtinTriggers, builtinActions)).toEqual(expect.arrayContaining([expect.stringContaining('missing global')]));
 const wrong: Rule[] = [{...rules[0], condition: {globalId: 'g-paused', op: '>', value: true}, actions: [{id: 'a', type: 'global.set', targetId: 'g-hero', value: true, to: 3}, {id: 'b', type: 'global.add', targetId: 'g-hero', value: true, amount: 1}]}];
 expect(validateInteractions({...catalog, entities: [host(wrong)]}, builtinTriggers, builtinActions)).toEqual(['Host: Interaction condition uses > on a boolean', 'Host: Interaction action sets the string hero to a number', 'Host: Missing interaction action/target']);
});

it('formats texts by type, parses typed input and rejects bad definitions', () => {
 const values: Record<string, number | boolean | string> = {score: 12, ratio: 2.456, paused: true, hero: 'Ada'};
 expect(formatTemplate('Score {score} / {ratio} {paused} {hero} {nope}', name => values[name])).toBe('Score 12 / 2.46 true Ada {nope}');
 expect(formatTemplate('{@coins:hero}', name => values[name], (key, count) => `${key}:${count}`)).toBe('coins:undefined');
 expect([parseGlobal('number', '3.5'), parseGlobal('boolean', 'false'), parseGlobal('string', '')]).toEqual([3.5, false, '']);
 expect(() => parseGlobal('number', 'x')).toThrow(); expect(() => parseGlobal('boolean', 'yes')).toThrow();
 expect(() => GlobalsSchema.parse({version: 1, items: [defs.items[0], {...defs.items[0], id: 'other'}]})).toThrow('unique');
 expect(() => GlobalsSchema.parse({version: 1, items: [{id: 'x', name: '1bad', type: 'number', initial: 0}]})).toThrow();
 expect(() => GlobalsSchema.parse({version: 1, items: [{id: 'x', name: 'flag', type: 'boolean', initial: 0}]})).toThrow('match');
});

it('visual actions patch runtime component data with the runtime time', async () => {
 const {visualActions} = await import('./index');
 const patches: unknown[] = [];
 const context = {silent: false, setActive() {}, changeScene() {}, invoke() {}, time: () => 1.5, setData: (id: string, patch: unknown) => patches.push([id, patch])};
 for (const type of ['flipbook.play', 'flipbook.stop', 'particles.play', 'particles.stop']) visualActions.find(a => a.type === type)!.execute({id: 'a', type, targetId: 'c1', value: true}, context);
 expect(patches).toEqual([['c1', {autoplay: true, startedAt: 1.5, stoppedAt: null}], ['c1', {stoppedAt: 1.5}], ['c1', {startedAt: 1.5, stoppedAt: null}], ['c1', {stoppedAt: 1.5}]]);
 expect(() => visualActions[0].execute({id: 'a', type: 'flipbook.play', targetId: 'c1', value: true}, {silent: false, setActive() {}, changeScene() {}, invoke() {}})).toThrow('unavailable');
});

it('localized templates: {@key} in the current language, default fallback, variables inside strings', async () => {
 const {formatTemplate, hasTemplate, createLanguageStore, matchLanguage, LocalizationSchema} = await import('./index');
 const table = LocalizationSchema.parse({version: 1, defaultLanguage: 'en', languages: [{id: 'en', name: 'English'}, {id: 'tr', name: 'Türkçe'}, {id: 'pt-BR', name: 'Português'}], entries: [{key: 'title', values: {en: 'Score {score}', tr: 'Puan {score}'}}, {key: 'only.en', values: {en: 'Hi'}}]});
 const store = createLanguageStore(table, 'tr'), value = (n: string) => n === 'score' ? 4 : undefined;
 expect(hasTemplate('{@title}')).toBe(true);
 expect(formatTemplate('{@title}!', value, k => store.text(k))).toBe('Puan 4!');
 expect(formatTemplate('{@only.en} {@missing}', value, k => store.text(k))).toBe('Hi {@missing}');
 store.setLanguage('en');
 expect(formatTemplate('{@title}', value, k => store.text(k))).toBe('Score 4');
 expect(() => store.setLanguage('fr')).toThrow('Unknown language');
 expect([matchLanguage(table, ['tr-TR']), matchLanguage(table, ['pt-br']), matchLanguage(table, ['pt-PT']), matchLanguage(table, ['ja'])]).toEqual(['tr', 'pt-BR', 'pt-BR', 'en']);
 expect(() => LocalizationSchema.parse({...table, defaultLanguage: 'de'})).toThrow('default language');
});
