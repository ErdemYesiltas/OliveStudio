import {beforeAll, expect, it} from 'vitest';
import type {QuickJSWASMModule} from 'quickjs-emscripten-core';
import type {Entity} from '@rewrite/scene';
import type {InteractionEvent} from '@rewrite/interactions';
import {compileScript} from '@rewrite/scripts/compile';
import {loadScriptEngine, ScriptSession, type ScriptHost} from '@rewrite/scripts/session';
import type {ScriptLibrary} from '@rewrite/scripts/contracts';
import {behaviorProblems, behaviorType, type ActorInfo} from '@rewrite/behavior/contracts';
import {behaviorControls, xstateBehaviorExtension} from './index';
import {describeMachine} from './editor';

let engine: QuickJSWASMModule;
beforeAll(async () => { engine = await loadScriptEngine(); });

const entity = (id: string, name: string, extra: Entity['components'] = []): Entity => ({id, name, active: true, parentId: null, components: [{id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1}}, ...extra]} as unknown as Entity);
const behavior = (id: string, scriptId: string, extra: Record<string, unknown> = {}) => ({id, type: behaviorType, version: 1, data: {scriptId, params: {}, refs: {}, ...extra}}) as unknown as Entity['components'][number];
const library = (...scripts: {id: string; name: string; source: string}[]): ScriptLibrary => ({version: 1, items: scripts.map(s => ({...s, ...compileScript(s.source, s.name)}))});
function host(entities: Entity[], extra: Partial<ScriptHost> = {}) {
 const log: string[] = [], emitted: InteractionEvent[] = [];
 let time = 0;
 const h: ScriptHost = {
  entities: () => entities, time: () => time, stage: {width: 960, height: 540},
  names: {globals: [], scenes: [], actions: [{id: 'a1', name: 'jump'}]},
  setActive: () => {}, changeScene: () => {}, invoke: () => {},
  log: (level, message) => { log.push(`${level}: ${message}`); }, extensions: [xstateBehaviorExtension], emit: e => { emitted.push(e); }, ...extra,
 };
 return {h, log, emitted, tick: (dt: number) => { time += dt; }};
}

const enemy = `
const {setup, assign} = xstate;
export const params = {speed: param.number(80)};
export const machine = setup({
  guards: {strong: ({event}) => (event.amount ?? 0) >= 3},
  actions: {flee: ({context}) => { context.self.x -= context.speed; }},
}).createMachine({
  id: 'enemy', version: '2',
  context: ({input}) => ({self: input.self, speed: input.params.speed, hits: 0}),
  type: 'parallel',
  states: {
    mood: {
      initial: 'calm',
      states: {
        calm: {on: {click: 'angry', hit: [{guard: 'strong', target: 'scared'}, {target: 'angry'}]}},
        angry: {after: {1000: 'calm'}, on: {hit: {target: 'scared', actions: assign({hits: ({context}) => context.hits + 1})}}},
        scared: {entry: 'flee', on: {'input.pressed': {guard: ({event}) => event.action === 'jump', target: 'calm'}}},
      },
    },
    body: {initial: 'alive', states: {alive: {on: {die: 'dead'}}, dead: {type: 'final'}}},
  },
});`;

it('runs one actor per Behavior with game-clock delays, parallel regions, guards and typed game events', () => {
 const foe = entity('e', 'Enemy', [behavior('b1', 's1', {machine: {id: 'enemy', version: '2'}})]);
 const {h, log, emitted, tick} = host([foe]);
 const session = new ScriptSession(engine, library({id: 's1', name: 'Enemy', source: enemy}), h, m => log.push(m));
 const controls = behaviorControls(() => session);
 expect(session.count).toBe(1);
 session.system.update!(0.016); tick(0.016);
 let [actor] = controls.inspect();
 expect(actor).toMatchObject({entityId: 'e', object: 'Enemy', script: 'Enemy', machine: {id: 'enemy', version: '2'}, status: 'active', states: ['mood.calm', 'body.alive']});
 expect(actor.events).toEqual(expect.arrayContaining(['click', 'hit', 'die', 'input.pressed']));
 expect(emitted.map(e => e.event)).toEqual(['mood', 'mood.calm', 'body', 'body.alive']);

 session.observe({type: 'pointer.click', sourceId: 'e', silent: false});
 expect(controls.inspect()[0].states).toEqual(['mood.angry', 'body.alive']);
 expect(emitted.at(-1)).toMatchObject({type: 'behavior.state', sourceId: 'e', event: 'mood.angry'});
 // The delayed transition follows the game clock: 0.9 s is not enough, the next frame passes 1 s.
 for (let i = 0; i < 9; i++) session.system.update!(0.1);
 expect(controls.inspect()[0].states[0]).toBe('mood.angry');
 session.system.update!(0.15);
 expect(controls.inspect()[0].states[0]).toBe('mood.calm');

 controls.send('e', {type: 'hit', amount: 5});
 actor = controls.inspect()[0];
 expect(actor.states[0]).toBe('mood.scared');
 expect(foe.components[0].data).toMatchObject({x: -80});
 expect(actor.history.at(-1)).toMatchObject({event: 'hit', from: ['mood.calm', 'body.alive'], to: ['mood.scared', 'body.alive']});
 expect(JSON.parse(actor.context)).toMatchObject({speed: 80, hits: 0, self: {object: 'Enemy', id: 'e'}});
 session.observe({type: 'input.pressed', sourceId: 'a1', silent: false});
 expect(controls.inspect()[0].states[0]).toBe('mood.calm');
 expect(() => controls.send('e', {type: 'teleport'})).toThrow(/does not handle teleport/);
 expect(() => controls.send('missing', {type: 'hit'})).toThrow(/no running behavior/);
 controls.send('e', {type: 'die'});
 expect(controls.inspect()[0].states).toEqual(['mood.calm', 'body.dead']);
 expect(log.filter(l => !l.startsWith('info'))).toEqual([]);
 session.dispose();
});

it('lets scripts and machines talk: behavior.send / matches from hooks, game.send messages and tick', () => {
 const door = entity('d', 'Door', [behavior('b1', 'm1')]), lever = entity('l', 'Lever', [{id: 'sb', type: 'scripts.behaviour', version: 1, data: {scriptId: 's2', params: {}, refs: {}}} as never]);
 const {h, log} = host([door, lever]);
 const lib = library(
  {id: 'm1', name: 'Door', source: `export const tick = true;
export const machine = xstate.setup({}).createMachine({id: 'door', context: {open: 0}, initial: 'closed', states: {
  closed: {on: {message: {guard: ({event}) => event.message === 'open', target: 'opening'}}},
  opening: {on: {tick: [{guard: ({context}) => context.open >= 0.25, target: 'open'}, {actions: xstate.assign({open: ({context, event}) => context.open + event.dt})}]}},
  open: {},
}});`},
  {id: 's2', name: 'Lever', source: `export function onClick(self) { game.send('open'); }
export function update(self) { if (behavior.matches(game.find('Door'), 'open')) self.state.seen = true; }`},
 );
 const session = new ScriptSession(engine, lib, h, m => log.push(m));
 const controls = behaviorControls(() => session);
 session.system.update!(0.1);
 expect(controls.inspect()[0].states).toEqual(['closed']);
 session.observe({type: 'pointer.click', sourceId: 'l', silent: false});
 expect(controls.inspect()[0].states).toEqual(['opening']);
 for (let i = 0; i < 4; i++) session.system.update!(0.1);
 expect(controls.inspect()[0].states).toEqual(['open']);
 session.system.update!(0.1);
 expect(session.instances()[0].state).toContain('seen: true');
 expect(log).toEqual([]);
 session.dispose();
});

it('refuses a different pinned machine, isolates a failing action, cleans up removed objects and floods', () => {
 const a = entity('a', 'Pinned', [behavior('b1', 's1', {machine: {id: 'enemy', version: '1'}})]);
 const b = entity('b', 'Broken', [behavior('b2', 's2')]);
 const c = entity('c', 'Looper', [behavior('b3', 's3')]);
 const world = [a, b, c];
 const {h, log} = host(world);
 const lib = library(
  {id: 's1', name: 'Enemy', source: enemy},
  {id: 's2', name: 'Broken', source: `export const machine = xstate.setup({}).createMachine({id: 'broken', initial: 'a', states: {a: {on: {click: {actions: () => { throw new Error('boom'); }}}}}});`},
  {id: 's3', name: 'Looper', source: `export const machine = xstate.setup({}).createMachine({id: 'loop', initial: 'a', states: {a: {on: {ping: {actions: () => { for (let i = 0; i < 400; i++) behavior.send(game.find('Looper'), 'noop'); }}, noop: {}}}}});`},
 );
 const session = new ScriptSession(engine, lib, h, m => log.push(m));
 const controls = behaviorControls(() => session);
 session.system.update!(0.016);
 const byObject = (name: string) => controls.inspect().find((x: ActorInfo) => x.object === name)!;
 expect(byObject('Pinned')).toMatchObject({status: 'error', error: expect.stringContaining('expects machine enemy v1 but the script defines enemy v2')});
 session.observe({type: 'pointer.click', sourceId: 'b', silent: false});
 expect(byObject('Broken')).toMatchObject({status: 'error', error: expect.stringContaining('boom')});
 controls.send('c', {type: 'ping'});
 expect(log.some(l => l.includes('more than 256 behavior events in one frame'))).toBe(true);
 expect(byObject('Looper').status).toBe('active');
 // Other behaviors keep running; a removed object's actor is stopped and dropped on the next frame.
 world.splice(2, 1);
 session.system.update!(0.016);
 expect(controls.inspect().map(x => x.object)).toEqual(['Pinned', 'Broken']);
 session.dispose();
 expect(() => controls.inspect()).toThrow(/not running/);
});

it('describes a machine script without a game and reports static problems', () => {
 const code = compileScript(enemy, 'Enemy').code;
 expect(describeMachine(engine, code, 'Enemy')).toEqual({id: 'enemy', version: '2', states: ['mood', 'mood.calm', 'mood.angry', 'mood.scared', 'body', 'body.alive', 'body.dead'], initial: ['mood.calm', 'body.alive'], events: ['click', 'die', 'hit', 'input.pressed']});
 expect(describeMachine(engine, 'exports.x = 1;', 'Plain').error).toMatch(/no machine export/);
 const project = {extensions: {'scripts.library': library({id: 's1', name: 'Enemy', source: enemy}, {id: 's2', name: 'Plain', source: 'export function update() {}'})}, scenes: [{id: 'sc', name: 'Main', entities: [entity('x', 'X', [behavior('b1', 's2')]), entity('y', 'Y', [behavior('b2', 'nope')]), entity('z', 'Z', [behavior('b3', 's1')])]}]};
 expect(behaviorProblems(project as never)).toEqual(['Main / X: script Plain has no "export const machine"', 'Main / Y: missing behavior script']);
});

it('retains inactive actors and freezes their delays, including inactive parents and initial inactivity', () => {
 const root=entity('root','Root'), child=entity('child','Child',[behavior('b','m')]); child.parentId=root.id;
 const {h,log}=host([root,child]);
 const lib=library({id:'m',name:'Timed',source:`export const machine=xstate.setup({}).createMachine({id:'timer',initial:'waiting',states:{waiting:{after:{500:'done'}},done:{}}});`});
 const s=new ScriptSession(engine,lib,h,m=>log.push(m)), c=behaviorControls(()=>s);
 try {
  s.system.update!(0.1); root.active=false;
  for(let i=0;i<10;i++)s.system.update!(0.1);
  expect(c.inspect()).toHaveLength(1); expect(c.inspect()[0].states).toEqual(['waiting']);
  root.active=true; for(let i=0;i<3;i++)s.system.update!(0.1);
  expect(c.inspect()[0].states).toEqual(['waiting']);
  s.system.update!(0.1); expect(c.inspect()[0].states).toEqual(['done']);
  expect(log).toEqual([]);
 } finally {s.dispose();}
 child.active=false;
 const next=new ScriptSession(engine,lib,h,m=>log.push(m)), nc=behaviorControls(()=>next);
 try {next.system.update!(0.1); expect(nc.inspect()[0].status).toBe('idle'); child.active=true; next.system.update!(0.1); expect(nc.inspect()[0].states).toEqual(['waiting']);}finally{next.dispose();}
});

it('captures versioned domain checkpoints and restores through migration and guarded events',()=>{
 const e=entity('hero','Hero',[behavior('b','s')]);
 const {h}=host([e]);
 const source=`export const machine=xstate.setup({actions:{restore:xstate.assign({coins:({event})=>event.coins})},guards:{valid:({event})=>event.coins>=0}}).createMachine({id:'save',context:{coins:0},initial:'playing',states:{playing:{on:{RESTORE:{guard:'valid',actions:'restore'}}}}});
 export const checkpoint={version:2,save:({snapshot})=>({coins:snapshot.context.coins}),migrate:(data,from)=>{if(from!==1)throw Error('Unsupported migration');return {coins:data.gold};},restore:({data})=>({type:'RESTORE',coins:data.coins})};`;
 const s=new ScriptSession(engine,library({id:'s',name:'Save',source}),h,()=>{});
 try{
  s.system.update!(1/60);
  const capture=()=>s.provider(behaviorType,'checkpoint',{entityId:'hero'});
  expect(capture()).toEqual({formatVersion:1,machineId:'save',dataVersion:2,data:{coins:0}});
  const restore=(value:unknown)=>s.provider(behaviorType,'restore',{entityId:'hero',value});
  restore({formatVersion:1,machineId:'save',dataVersion:1,data:{gold:7}});
  expect(capture()).toMatchObject({data:{coins:7}});
  restore({formatVersion:1,machineId:'save',dataVersion:2,data:{coins:-1}});
  expect(capture()).toMatchObject({data:{coins:7}});
  expect(()=>restore({formatVersion:1,machineId:'other',dataVersion:2,data:{}})).toThrow('Incompatible');
  expect(()=>restore({formatVersion:1,machineId:'save',dataVersion:3,data:{}})).toThrow('newer');
 }finally{s.dispose();}
});
