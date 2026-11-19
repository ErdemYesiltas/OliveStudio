import {expect, it} from 'vitest';
import {makeEntity} from '@rewrite/scene';
import {GlobalStore} from './globals';
import {InteractionSession, builtinActions, builtinTriggers, createGraphDefinition, validateInteractions, GraphSchema, graphType} from './index';

const graphEntity = (graph: unknown) => { const e = makeEntity('Brain'); e.components.push({id: 'g', type: graphType, version: 1, data: graph as never}); return e; };

it('runs event → action chains in link order, branches on globals and waits on Delay nodes in game time', () => {
 const button = makeEntity('Button'), lamp = makeEntity('Lamp');
 const brain = graphEntity({nodes: [
  {id: 'click', kind: 'event', x: 0, y: 0, trigger: {type: 'pointer.click', sourceId: button.id, event: ''}},
  {id: 'add', kind: 'action', x: 0, y: 0, action: {id: 'a1', type: 'global.add', targetId: 'g-score', value: true, amount: 5}},
  {id: 'check', kind: 'branch', x: 0, y: 0, condition: {globalId: 'g-score', op: '>=', value: 10}},
  {id: 'off', kind: 'action', x: 0, y: 0, action: {id: 'a2', type: 'entity.active', targetId: lamp.id, value: false}},
  {id: 'wait', kind: 'delay', x: 0, y: 0, seconds: 1},
  {id: 'on', kind: 'action', x: 0, y: 0, action: {id: 'a3', type: 'entity.active', targetId: lamp.id, value: true}},
 ], links: [{id: 'l1', from: 'click', port: 'next', to: 'add'}, {id: 'l2', from: 'add', port: 'next', to: 'check'}, {id: 'l3', from: 'check', port: 'true', to: 'off'}, {id: 'l4', from: 'off', port: 'next', to: 'wait'}, {id: 'l5', from: 'wait', port: 'next', to: 'on'}]});
 const entities = [button, lamp, brain], globals = new GlobalStore({version: 1, items: [{id: 'g-score', name: 'score', type: 'number', initial: 0}]});
 let time = 0; const active: string[] = [];
 const session = new InteractionSession(() => entities, builtinActions, {globals, time: () => time, setActive: (id, v) => { active.push(`${id === lamp.id ? 'lamp' : id} ${v}`); lamp.active = v; }, changeScene() {}, invoke() {}});
 const click = () => { session.emit({type: 'pointer.click', sourceId: button.id, silent: false}); session.flush(); };
 click(); expect(globals.get('g-score')).toBe(5); expect(active).toEqual([]);
 click(); expect(globals.get('g-score')).toBe(10); expect(active).toEqual(['lamp false']);
 time = .5; session.flush(); expect(active).toEqual(['lamp false']);
 time = 1.01; session.flush(); expect(active).toEqual(['lamp false', 'lamp true']);
 expect(Object.keys(session.graphActivity().g)).toEqual(expect.arrayContaining(['click', 'add', 'check', 'off', 'wait', 'on']));
});

it('stops endless loops, validates references and keeps self-references in copies', () => {
 const a = makeEntity('A');
 const loop = graphEntity({nodes: [{id: 'e', kind: 'event', x: 0, y: 0, trigger: {type: 'pointer.click', sourceId: a.id, event: ''}}, {id: 'x', kind: 'action', x: 0, y: 0, action: {id: 'a', type: 'entity.active', targetId: a.id, value: true}}], links: [{id: 'l1', from: 'e', port: 'next', to: 'x'}, {id: 'l2', from: 'x', port: 'next', to: 'x'}]});
 const failures: string[] = [], entities = [a, loop];
 const session = new InteractionSession(() => entities, builtinActions, {setActive() {}, changeScene() {}, invoke() {}}, m => failures.push(m));
 session.emit({type: 'pointer.click', sourceId: a.id, silent: false}); session.flush();
 expect(failures.join()).toMatch(/limit reached/);
 expect(validateInteractions({entities, scenes: []}, builtinTriggers, builtinActions)).toEqual([]);
 expect(validateInteractions({entities: [loop], scenes: []}, builtinTriggers, builtinActions)).toEqual(['Brain: Logic graph event is missing its trigger/reference/event', 'Brain: Logic graph action is missing its action/target']);
 expect(() => GraphSchema.parse({nodes: [{id: 'e', kind: 'event', x: 0, y: 0, trigger: {type: 't', sourceId: '', event: ''}}], links: [{id: 'l', from: 'e', port: 'true', to: 'e'}]})).toThrow();
 const copy = createGraphDefinition().remapReferences!(loop.components[1].data, {entities: new Map([[a.id, 'copy']]), components: new Map()}) as {nodes: {trigger?: {sourceId: string}; action?: {targetId: string}}[]};
 expect(copy.nodes[0].trigger!.sourceId).toBe('copy'); expect(copy.nodes[1].action!.targetId).toBe('copy');
});
