import {expect, it} from 'vitest';
import {InputSession, InputMapSchema, bindingLabel, defaultInputMap, type InputMap} from './index';
import type {InteractionEvent} from '@rewrite/interactions';

const map: InputMap = {version: 1, deadzone: 0.2, actions: [
 {id: 'jump', name: 'jump', kind: 'button', bindings: [{type: 'key', code: 'Space'}, {type: 'gamepadButton', index: 0}, {type: 'touch'}]},
 {id: 'fire', name: 'fire', kind: 'button', bindings: [{type: 'mouse', button: 0}]},
 {id: 'move', name: 'move_x', kind: 'axis', globalId: 'v-move', bindings: [{type: 'keyAxis', negative: 'ArrowLeft', positive: 'ArrowRight'}, {type: 'gamepadAxis', index: 0, invert: false}]},
]};
function setup() {
 const events: string[] = [], vars: Record<string, number> = {};
 let pad: {buttons: {pressed: boolean}[]; axes: number[]} | null = null;
 const session = new InputSession(map, {emit: (e: InteractionEvent) => events.push(`${e.type}:${e.sourceId}`), setGlobal: (id, v) => { vars[id] = v; }}, () => [pad as Gamepad | null]);
 return {session, events, vars, setPad: (p: typeof pad) => { pad = p; }};
}

it('emits pressed/released once per edge across several bindings', () => {
 const {session, events, setPad} = setup();
 session.key('Space', true); session.key('Space', true);
 setPad({buttons: [{pressed: true}], axes: []}); session.update();
 session.key('Space', false);
 expect(events).toEqual(['input.pressed:jump']);
 setPad({buttons: [{pressed: false}], axes: []}); session.update();
 session.pointer(1, 'mouse', 0, true); session.pointer(2, 'touch', 0, true); session.pointer(2, 'touch', 0, false); session.pointer(1, 'mouse', 0, false);
 expect(events).toEqual(['input.pressed:jump', 'input.released:jump', 'input.pressed:fire', 'input.pressed:jump', 'input.released:jump', 'input.released:fire']);
});

it('combines key pairs and sticks with a deadzone into an axis variable', () => {
 const {session, vars, setPad} = setup();
 session.key('ArrowRight', true);
 expect(vars['v-move']).toBe(1);
 session.key('ArrowLeft', true);
 expect(vars['v-move']).toBe(0);
 session.key('ArrowLeft', false); session.key('ArrowRight', false);
 setPad({buttons: [], axes: [0.1]}); session.update();
 expect(vars['v-move']).toBe(0);
 setPad({buttons: [], axes: [-0.75]}); session.update();
 expect(vars['v-move']).toBe(-0.75);
 expect(session.snapshot()).toMatchObject({move_x: -0.75, jump: false});
});

it('releases everything on focus loss and stays quiet while paused', () => {
 const {session, events, vars} = setup();
 session.key('Space', true); session.key('ArrowRight', true);
 session.releaseAll();
 expect(events).toEqual(['input.pressed:jump', 'input.released:jump']);
 expect(vars['v-move']).toBe(0);
 session.paused = true;
 session.key('Space', true);
 expect(events).toHaveLength(2);
});

it('validates binding kinds, unique names and labels bindings', () => {
 expect(InputMapSchema.parse(defaultInputMap).actions).toEqual([]);
 expect(() => InputMapSchema.parse({...map, actions: [{...map.actions[0], bindings: [{type: 'keyAxis', negative: 'A', positive: 'D'}]}]})).toThrow('button action cannot');
 expect(() => InputMapSchema.parse({...map, actions: [map.actions[0], {...map.actions[1], name: 'jump'}]})).toThrow('unique');
 expect(bindingLabel({type: 'keyAxis', negative: 'KeyA', positive: 'KeyD'})).toBe('A / D');
 expect(bindingLabel({type: 'key', code: 'ArrowUp'})).toBe('Arrow Up');
});
