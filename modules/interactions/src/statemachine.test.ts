import {expect, it} from 'vitest';
import type {Entity} from '@rewrite/scene';
import {InteractionSession, builtinActions, GlobalStore, StateMachineSchema, stateMachineDefinition, validateInteractions, builtinTriggers, stateTriggers} from './index';

const action = (id: string, type: string, targetId: string, amount?: number) => ({id, type, targetId, value: true, ...(amount === undefined ? {} : {amount})});
const machine = StateMachineSchema.parse({
 initial: 'idle',
 states: [{id: 'idle', name: 'idle', actions: [action('a0', 'global.set', 'v-mode', 0)]}, {id: 'run', name: 'run', actions: [action('a1', 'global.set', 'v-mode', 1)]}, {id: 'won', name: 'won', actions: [action('a2', 'global.set', 'v-mode', 2)]}],
 transitions: [
  {id: 't1', from: 'idle', to: 'run', trigger: {type: 'pointer.click', sourceId: 'button', event: ''}},
  {id: 't2', from: 'run', to: 'won', trigger: {type: 'pointer.click', sourceId: 'button', event: ''}, condition: {globalId: 'v-score', op: '>=', value: 3}},
  {id: 't3', from: '*', to: 'idle', trigger: {type: 'pointer.click', sourceId: 'reset', event: ''}},
 ],
});
const entities = (active = true): Entity[] => [
 {id: 'brain', name: 'Brain', parentId: null, active, components: [{id: 'sm', type: 'interactions.stateMachine', version: 1, data: machine as never}, {id: 'rules', type: 'interactions.bindings', version: 1, data: {rules: [{id: 'r', trigger: {type: 'state.enter', sourceId: 'sm', event: 'won'}, actions: [action('w', 'global.add', 'v-score', 100)]}]}}]},
 {id: 'button', name: 'Button', parentId: null, active: true, components: []}, {id: 'reset', name: 'Reset', parentId: null, active: true, components: []},
];
const setup = (list = entities()) => {
 const globals = new GlobalStore({version: 1, items: [{id: 'v-mode', name: 'mode', type: 'number', initial: -1}, {id: 'v-score', name: 'score', type: 'number', initial: 0}]});
 const session = new InteractionSession(() => list, builtinActions, {globals, setActive() {}, changeScene() {}, invoke() {}});
 globals.changes$.subscribe(c => session.emit({type: 'global.change', sourceId: c.id, silent: c.silent}));
 const click = (id: string) => { session.emit({type: 'pointer.click', sourceId: id, silent: false}); session.flush(); };
 return {session, globals, click};
};

it('enters the initial state, follows matching transitions with conditions and lets rules react to state.enter', () => {
 const {session, globals, click} = setup();
 session.flush();
 expect(session.states()).toEqual({sm: 'idle'});
 expect(globals.get('v-mode')).toBe(0);
 click('button'); expect(session.states().sm).toBe('run'); expect(globals.get('v-mode')).toBe(1);
 click('button'); expect(session.states().sm).toBe('run');
 globals.set('v-score', 3); click('button');
 expect(session.states().sm).toBe('won'); expect(globals.get('v-mode')).toBe(2); expect(globals.get('v-score')).toBe(103);
 click('reset'); expect(session.states().sm).toBe('idle');
});

it('inactive machines do not run; validation catches missing states and references', () => {
 const {session, globals} = setup(entities(false));
 session.flush();
 expect(session.states()).toEqual({}); expect(globals.get('v-mode')).toBe(-1);
 expect(() => StateMachineSchema.parse({...machine, initial: 'nope'})).toThrow('initial state');
 expect(() => StateMachineSchema.parse({...machine, transitions: [{...machine.transitions[0], to: 'ghost'}]})).toThrow('missing state');
 const list = entities(); list.splice(2, 1);
 const errors = validateInteractions({entities: list, scenes: [], globals: [{id: 'v-mode', name: 'mode', type: 'number' as const}, {id: 'v-score', name: 'score', type: 'number' as const}]}, [...builtinTriggers, ...stateTriggers], builtinActions);
 expect(errors).toEqual(['Brain: State transition has a missing trigger/reference/event']);
});

it('duplicating remaps trigger sources and action targets but keeps state IDs', () => {
 const remapped = StateMachineSchema.parse(stateMachineDefinition.remapReferences!(machine as never, {entities: new Map([['button', 'button2']]), components: new Map()}));
 expect(remapped.transitions[0].trigger.sourceId).toBe('button2');
 expect(remapped.transitions[0].id).not.toBe('t1');
 expect(remapped.states.map(s => s.id)).toEqual(['idle', 'run', 'won']);
});
