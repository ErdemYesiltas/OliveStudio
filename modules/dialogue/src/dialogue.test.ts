import {describe, expect, it} from 'vitest';
import {GlobalStore} from '@rewrite/interactions';
import {DialogueLibrarySchema, DialogueSession, dialogueEvents, dialogueProblems, type Dialogue} from './index';

const shop: Dialogue = {id: 'd1', name: 'Shop', start: 'a', lines: [
 {id: 'a', speaker: 'Olive', text: 'Hi! You have {coins} coins.', next: '', event: 'greet', choices: [
  {id: 'c1', text: 'Buy (5)', next: 'b', condition: {globalId: 'g-coins', op: '>=', value: 5}},
  {id: 'c2', text: 'Bye', next: ''},
 ]},
 {id: 'b', speaker: 'Olive', text: 'Thanks!', next: 'c', choices: [], event: '', set: {globalId: 'g-bought', value: true}},
 {id: 'c', speaker: '', text: 'Come again.', next: '', choices: [], event: 'done'},
]};
const run = (coins: number) => {
 const globals = new GlobalStore({version: 1, items: [{id: 'g-coins', name: 'coins', type: 'number', initial: coins}, {id: 'g-bought', name: 'bought', type: 'boolean', initial: false}]} as never);
 const events: string[] = [], views: (string | null)[] = [];
 const s = new DialogueSession({library: () => ({version: 1, items: [shop]}), globals: () => globals, silent: () => false, emit: e => events.push(`${e.type}:${e.event ?? ''}`)});
 s.subscribe(v => views.push(v ? v.lineId : null));
 return {s, globals, events, views};
};
describe('dialogue', () => {
 it('shows a line with templates and only the choices whose condition holds', () => {
  const {s, events} = run(3); s.start('Shop');
  expect(s.view()).toMatchObject({dialogue: 'Shop', speaker: 'Olive', text: 'Hi! You have 3 coins.', choices: [{index: 0, text: 'Bye'}]});
  expect(events).toEqual(['dialogue.event:greet']);
  s.advance(); expect(s.view()?.lineId).toBe('a');
  s.choose(0); expect(s.view()).toBeNull(); expect(events).toEqual(['dialogue.event:greet', 'dialogue.end:']);
 });
 it('follows a choice, sets globals, continues lines and ends', () => {
  const {s, globals, events, views} = run(9); s.start('d1');
  expect(s.view()!.choices.map(c => c.text)).toEqual(['Buy (5)', 'Bye']);
  s.choose(0); expect(s.view()?.text).toBe('Thanks!'); expect(globals.get('g-bought')).toBe(true);
  s.advance(); expect(s.view()?.text).toBe('Come again.');
  s.advance(); expect(views).toEqual(['a', 'b', 'c', null]); expect(events).toEqual(['dialogue.event:greet', 'dialogue.event:done', 'dialogue.end:']);
  s.choose(3); s.advance(); expect(events).toHaveLength(3);
 });
 it('stops, restarts and rejects unknown dialogues', () => {
  const {s, events} = run(0); s.start('Shop'); s.stop(); expect(s.view()).toBeNull(); expect(events.at(-1)).toBe('dialogue.end:');
  expect(() => s.start('Nope')).toThrow(/Unknown dialogue/);
 });
 it('reports problems and lists events', () => {
  expect(dialogueProblems(shop)).toEqual([]);
  const broken: Dialogue = {...shop, start: 'x', lines: [...shop.lines, {id: 'lost', speaker: '', text: '', next: 'missing', choices: [], event: ''}]};
  expect(dialogueProblems(broken)).toEqual(['Choose the first line', 'Line 4: “then” points to a missing line', 'Line 1 is never reached', 'Line 2 is never reached', 'Line 3 is never reached', 'Line 4 is never reached']);
  expect(dialogueEvents(shop)).toEqual(['greet', 'done']);
  expect(() => DialogueLibrarySchema.parse({version: 1, items: [shop, shop]})).toThrow(/unique/);
 });
});
