import {describe, expect, it} from 'vitest';
import {GlobalStore} from '@rewrite/interactions';
import {AchievementSession, AchievementsSchema, memoryStore, storageStore, type Achievements} from './index';

const lib: Achievements = {version: 1, items: [
 {id: 'a1', name: 'First steps', description: '', hidden: false},
 {id: 'a2', name: 'Rich', description: 'Collect 10 coins', hidden: true, condition: {globalId: 'g-coins', op: '>=', value: 10}},
], boards: [{id: 'b1', name: 'Best score', order: 'high', globalId: 'g-coins'}, {id: 'b2', name: 'Fastest', order: 'low', globalId: ''}]};
const make = (store = memoryStore()) => {
 const globals = new GlobalStore({version: 1, items: [{id: 'g-coins', name: 'coins', type: 'number', initial: 0}]} as never), events: string[] = [], shown: string[] = [];
 const s = new AchievementSession({library: () => lib, store, globals: () => globals, silent: () => false, emit: e => events.push(`${e.type}:${e.sourceId}`), unlocked: a => shown.push(a.name)});
 return {s, globals, events, shown, store};
};
describe('achievements', () => {
 it('unlocks once by ID or name and remembers it in the store', () => {
  const {s, events, shown, store} = make();
  expect(s.unlock('First steps')).toBe(true); expect(s.unlock('a1')).toBe(false);
  expect(events).toEqual(['achievement.unlocked:a1']); expect(shown).toEqual(['First steps']);
  expect(make(store).s.unlocked('a1')).toBe(true);
  expect(() => s.unlock('nope')).toThrow(/Unknown achievement/);
 });
 it('unlocks by itself when its condition holds', () => {
  const {s, globals, events} = make();
  s.system.update!(1 / 60); expect(events).toEqual([]);
  globals.set('g-coins', 12); s.system.update!(1 / 60); s.system.update!(1 / 60);
  expect(events).toEqual(['achievement.unlocked:a2']); expect(s.list()).toEqual([{id: 'a1', name: 'First steps', unlocked: false}, {id: 'a2', name: 'Rich', unlocked: true}]);
 });
 it('keeps the best ten scores in the board order and returns the rank', () => {
  const {s} = make();
  for (let i = 1; i <= 12; i++) s.submit('b1', i * 10, `P${i}`);
  expect(s.top('Best score').map(x => x.score)).toEqual([120, 110, 100, 90, 80, 70, 60, 50, 40, 30]);
  expect(s.submit('b1', 5)).toBe(0); expect(s.submit('b1', 115, 'Ace')).toBe(2);
  expect(s.submit('b2', 9.5)).toBe(1); expect(s.submit('b2', 8)).toBe(1); expect(s.top('b2').map(x => x.score)).toEqual([8, 9.5]);
  expect(() => s.submit('b1', NaN)).toThrow();
 });
 it('reads browser storage defensively and validates the definitions', () => {
  const data = new Map<string, string>(), storage = {getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }};
  const store = storageStore('k', storage); expect(store.read()).toBeNull();
  store.write({unlocked: {a1: 1}, boards: {}}); expect(store.read()).toEqual({unlocked: {a1: 1}, boards: {}});
  data.set('k', '{bad'); expect(store.read()).toBeNull();
  expect(() => AchievementsSchema.parse({...lib, boards: [{...lib.boards[0], id: 'a1'}]})).toThrow(/unique/);
 });
});
