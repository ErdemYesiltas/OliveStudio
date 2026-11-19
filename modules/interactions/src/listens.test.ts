import {expect, it} from 'vitest';
import {makeEntity} from '@rewrite/scene';
import {InteractionSession, builtinActions, graphType, stateMachineType} from './index';

it('knows which objects react to clicks: rules, logic graphs, state machines, observers; inactive objects do not count', () => {
 const ruled = makeEntity('Ruled'), graphed = makeEntity('Graphed'), machined = makeEntity('Machined'), scripted = makeEntity('Scripted'), glow = makeEntity('Glow'), off = makeEntity('Off');
 const brain = makeEntity('Brain');
 brain.components.push(
  {id: 'b', type: 'interactions.bindings', version: 1, data: {rules: [{id: 'r', trigger: {type: 'pointer.click', sourceId: ruled.id, event: ''}, actions: []}, {id: 'r2', trigger: {type: 'pointer.click', sourceId: off.id, event: ''}, actions: []}]}},
  {id: 'g', type: graphType, version: 1, data: {nodes: [{id: 'n', kind: 'event', x: 0, y: 0, trigger: {type: 'pointer.click', sourceId: graphed.id, event: ''}}], links: []}},
  {id: 'm', type: stateMachineType, version: 1, data: {initial: 'a', states: [{id: 'a', name: 'a', actions: []}], transitions: [{id: 't', from: 'a', to: 'a', trigger: {type: 'pointer.click', sourceId: machined.id, event: ''}}]}},
 );
 const entities = [ruled, graphed, machined, scripted, glow, off, brain];
 const session = new InteractionSession(() => entities, builtinActions, {setActive() {}, changeScene() {}, invoke() {}});
 const stop = session.observe(() => {}, (type, id) => type === 'pointer.click' && id === scripted.id);
 for (const e of [ruled, graphed, machined, scripted, off]) expect(session.listens('pointer.click', e.id)).toBe(true);
 expect(session.listens('pointer.click', glow.id)).toBe(false);
 expect(session.listens('collision.enter', ruled.id)).toBe(false);
 brain.active = false;
 expect(session.listens('pointer.click', ruled.id)).toBe(false);
 stop();
 expect(session.listens('pointer.click', scripted.id)).toBe(false);
});
