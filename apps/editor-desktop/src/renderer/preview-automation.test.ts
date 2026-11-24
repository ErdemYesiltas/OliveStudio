import {expect, it} from 'vitest';
import {RuntimeSession, type RuntimeEntity} from '@rewrite/runtime';
import {InputSession} from '@rewrite/input';
import {InspectSchema, ReadySchema, SequenceSchema, inspectRuntime, runInputSequence, waitUntilReady, type PreviewPorts, type Readiness} from './preview-automation';

function fixture(paused = false) {
 const hero = {id: 'hero', name: 'Hero', active: true, parentId: null, components: [{id: 't', type: 'scene.transform2d', data: {x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1}}]};
 let right = false, mode = paused ? 'paused' : 'playing';
 const queue: string[] = [], flushed: string[] = [];
 const input = new InputSession({version: 1, deadzone: 0.2, actions: [{id: 'r', name: 'right', kind: 'button', bindings: [{type: 'key', code: 'ArrowRight'}]}]}, {emit: e => queue.push(e.type)});
 input.paused = paused;
 const session = new RuntimeSession([hero as unknown as RuntimeEntity], world => [{id: 'move', dispose() {}, fixedUpdate: dt => { if (right) { const t = (world.entities[0] as unknown as typeof hero).components[0].data; t.x += 120 * dt; } }}], {paused});
 const entities = () => session.world.entities as unknown as typeof hero[];
 const ports: PreviewPorts = {
  session: () => session, sessionId: () => 7, sceneId: () => 'main', input: () => input,
  flush: () => { for (const e of queue.splice(0)) { flushed.push(e); right = e === 'input.pressed'; } },
  render: () => {}, setMode: m => { mode = m; }, entities, body: () => ({velocityX: right ? 120 : 0, velocityY: 0, angularVelocity: 0, sleeping: false, mass: 1}),
  contacts: () => [{phase: 'enter', a: 'hero', b: 'wall', sensor: false, time: 0.5}],
  scripts: () => [{script: 'Hero', object: 'Hero', entityId: 'hero', state: '{hp: 3}'}],
 };
 return {session, input, ports, entities, flushed, mode: () => mode};
}

it('delivers scheduled keys before their frame and steps deterministically while the game was running', async () => {
 const spec = SequenceSchema.parse({frames: 60, events: [{frame: 0, code: 'ArrowRight', down: true}, {frame: 30, code: 'ArrowRight', down: false}], observe: {objectIds: ['hero'], every: 15, fields: ['transform', 'velocity']}});
 const a = fixture(), b = fixture();
 const first = await runInputSequence(a.ports, spec), second = await runInputSequence(b.ports, spec);
 expect(first.samples).toEqual(second.samples);
 expect(first.samples.map(s => [s.frame, (s.objects.hero as {x: number}).x])).toEqual([[0, 0], [15, 30], [30, 60], [45, 60], [60, 60]]);
 expect(first.samples[1].time).toBeCloseTo(0.25);
 expect(first).toMatchObject({session: 7, completed: true, released: []});
 // The game was running: it runs again, input listens again.
 expect(a.session.paused).toBe(false); expect(a.mode()).toBe('playing'); expect(a.input.paused).toBe(false);
});

it('releases keys still held at the end and keeps a paused game paused; refuses another session', async () => {
 const f = fixture(true);
 const result = await runInputSequence(f.ports, SequenceSchema.parse({frames: 10, events: [{frame: 2, code: 'ArrowRight', down: true}], observe: {objectIds: ['hero', 'gone'], every: 10, fields: ['transform', 'active']}}));
 expect(result.released).toEqual(['ArrowRight']);
 expect(f.flushed).toEqual(['input.pressed', 'input.released']);
 expect((result.samples.at(-1)!.objects.hero as {x: number}).x).toBeCloseTo(16);
 expect(result.samples[0].objects.gone).toBeNull();
 expect(f.session.paused).toBe(true); expect(f.input.paused).toBe(true);
 await expect(runInputSequence(f.ports, SequenceSchema.parse({frames: 1, session: 3}))).rejects.toThrow('Preview session 3 has ended (current session: 7)');
 expect(SequenceSchema.safeParse({frames: 5, events: [{frame: 6, code: 'Space', down: true}]}).success).toBe(false);
});

it('inspects selected objects read-only with filters, paging and a stale-session guard', () => {
 const f = fixture();
 const r = inspectRuntime(f.ports, InspectSchema.parse({objectIds: ['hero', 'nope'], include: ['transform', 'physics', 'contacts', 'scripts', 'components'], components: ['scene.transform2d']}));
 expect(r).toMatchObject({session: 7, sceneId: 'main', total: 1, nextOffset: null, missing: ['nope']});
 expect(r.objects).toEqual([{id: 'hero', name: 'Hero', active: true, parentId: null, transform: {x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1}, physics: expect.objectContaining({velocityX: 0}), contacts: [{phase: 'enter', other: 'wall', sensor: false, time: 0.5}], scripts: [{script: 'Hero', state: '{hp: 3}'}], components: [expect.objectContaining({type: 'scene.transform2d'})]}]);
 expect(() => inspectRuntime(f.ports, InspectSchema.parse({session: 1}))).toThrow('has ended');
 expect(inspectRuntime({...f.ports}, InspectSchema.parse({names: ['Nobody']})).total).toBe(0);
});

it('waits for loads, fails fast on permanent problems and notices project changes', async () => {
 const base: Readiness = {generation: 4, busy: false, previewRunning: false, textures: {loading: ['a'], failed: [], unresolved: []}, visuals: [], engines: [{name: 'scripts', ready: false}]};
 let calls = 0;
 const read = () => { calls++; return calls < 3 ? base : {...base, textures: {loading: [], failed: [], unresolved: []}, engines: [{name: 'scripts', ready: true}]}; };
 const sleep = async () => {};
 expect(await waitUntilReady(read, ReadySchema.parse({}), new AbortController().signal, sleep)).toMatchObject({state: 'ready', loading: [], failed: []});
 expect(await waitUntilReady(() => ({...base, textures: {loading: [], failed: ['b'], unresolved: ['c']}}), ReadySchema.parse({}), new AbortController().signal, sleep)).toMatchObject({state: 'failed', failed: ['texture:b', 'missing asset:c']});
 expect(await waitUntilReady(() => base, ReadySchema.parse({generation: 3}), new AbortController().signal, sleep)).toMatchObject({state: 'cancelled'});
 expect(await waitUntilReady(() => base, ReadySchema.parse({timeoutMs: 100}), new AbortController().signal, () => new Promise(r => setTimeout(r, 60)))).toMatchObject({state: 'timeout', loading: ['a', 'engine:scripts']});
 expect(await waitUntilReady(() => ({...base, textures: {loading: [], failed: [], unresolved: []}, engines: []}), ReadySchema.parse({target: 'preview'}), new AbortController().signal, sleep)).toMatchObject({state: 'failed', reason: 'Preview is not running'});
});

it('cancels long scenarios between frame batches and releases held keys',async()=>{
 const f=fixture(),abort=new AbortController();
 const r=await runInputSequence(f.ports,SequenceSchema.parse({frames:120,events:[{frame:0,code:'ArrowRight',down:true}]}),abort.signal,async()=>{abort.abort();});
 expect(r.completed).toBe(false); expect(r.reason).toBe('Sequence cancelled'); expect(r.stoppedAt).toBe(8);
 expect(f.flushed.at(-1)).toBe('input.released'); expect(f.input.paused).toBe(false); expect(f.session.paused).toBe(false);
});

it('exposes readiness as a cancellable read-only job without requiring an idle editor',async()=>{
 const {AutomationExecutor}=await import('@rewrite/kernel');const {automationTool}=await import('@rewrite/sdk');
 let generation=1;
 const base:Readiness={generation:1,busy:true,previewRunning:false,textures:{loading:['pending'],failed:[],unresolved:[]},visuals:[],engines:[]};
 const entry={id:'ready',owner:'test',value:automationTool(ReadySchema,{description:'Wait for resources',effect:'job',readOnly:true,cancellable:true,execute:(a,c)=>waitUntilReady(()=>({...base,generation}),a,c.signal)})};
 const executor=new AutomationExecutor({entries:()=>[entry],snapshot:()=>({generation,revision:1}),editable:()=>{throw Error('Editor busy');},batch:(_,work)=>work()});
 try{
  const h=await executor.execute('ready') as {id:string};expect(executor.job(h.id).state).toBe('running');executor.cancel(h.id);expect(executor.job(h.id).state).toBe('cancelled');
  const next=await executor.execute('ready') as {id:string};generation=2;
  await executor.wait(next.id,1000);expect(executor.job(next.id)).toMatchObject({state:'complete',result:{state:'cancelled',reason:'The project changed while waiting'}});
 }finally{executor.dispose();}
});

it('inspects and samples explicit 3D poses without inventing a 2D rotation',async()=>{const f=fixture(true),e={id:'mesh',name:'Mesh',active:true,spatial:'scene3d.transform',parentId:null,components:[{id:'t3',type:'scene3d.transform',data:{x:1,y:2,z:3,qx:0,qy:0,qz:0,qw:1,scaleX:1,scaleY:2,scaleZ:3}}]},ports:PreviewPorts={...f.ports,entities:()=>[e]};try{const result=inspectRuntime(ports,InspectSchema.parse({include:['transform']})) as {objects:{transform:unknown;spatial:string}[]};expect(result.objects[0].spatial).toBe('scene3d.transform');expect(result.objects[0].transform).toEqual(e.components[0].data);const run=await runInputSequence(ports,SequenceSchema.parse({frames:1,observe:{objectIds:['mesh'],every:1,fields:['transform']}}));expect(run.samples[0].objects.mesh).toEqual({...e.components[0].data,spatial:'scene3d.transform'});}finally{f.session.dispose();}});
