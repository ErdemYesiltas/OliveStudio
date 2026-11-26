import { expect, it } from 'vitest';
import { World } from 'miniplex';
import { RuntimeSession, orderSystems } from './index';
it('uses actual Miniplex dynamic component/query membership', () => {
 const world = new World<{ id: string; audio?: { volume: number } }>(), entity = { id: 'e' };
 const audio = world.with('audio'); world.add(entity); expect(audio.size).toBe(0);
 world.addComponent(entity, 'audio', { volume: .5 }); expect(audio.size).toBe(1);
 world.removeComponent(entity, 'audio'); expect(audio.size).toBe(0); world.remove(entity); expect(world.entities).toHaveLength(0);
});
it('isolates edit data, pauses, steps exactly once, resumes and disposes idempotently', () => {
 const data = [{ id: 'a', active: true, x: 0 }]; let disposed = 0, fixed = 0;
 const session = new RuntimeSession(data, world => [{ id: 'motion', fixedUpdate: () => { fixed++; }, update(dt) { for (const e of world) e.x = Number(e.x) + dt * 60; }, dispose: () => { disposed++; } }]);
 session.pause(); session.advance(1); expect(fixed).toBe(0); session.step(); expect(fixed).toBe(1); expect(session.time).toBeCloseTo(1/60, 12);
 expect(session.world.entities[0].x).toBeCloseTo(1); expect(data[0].x).toBe(0);
 session.resume(); session.advance(1/30); expect(fixed).toBe(3);
 session.dispose(); session.dispose(); session.advance(1); expect(disposed).toBe(1); expect(session.world.entities).toHaveLength(0);
});
it('validates scheduler requirements and cycles', () => {
 const make = (id: string, after: string[] = []) => ({ id, after, dispose() {} });
 expect(orderSystems([make('render',['physics']),make('physics')]).map(s => s.id)).toEqual(['physics','render']);
 expect(() => orderSystems([make('a',['b']),make('b',['a'])])).toThrow('cycle');
 expect(() => orderSystems([make('a',['missing'])])).toThrow('Missing');
});

it('starts paused systems with an explicit silent-start context and advances only on Step',()=>{
 const seen:unknown[]=[],session=new RuntimeSession([],_world=>[{id:'paused',start:context=>{seen.push(context);},update:dt=>seen.push(dt),pause:()=>{seen.push('pause');},dispose(){}}],{paused:true});
 expect(session.paused).toBe(true);expect(seen).toEqual([{paused:true},'pause']);session.advance(1);expect(session.time).toBe(0);session.step();expect(session.time).toBeCloseTo(1/60);expect(seen.at(-1)).toBeCloseTo(1/60);session.dispose();
});

it('spawns and despawns objects (with descendants) while running and tells every system', () => {
 const seen: string[] = [];
 const session = new RuntimeSession([{id: 'a', active: true}], () => [{id: 'watch', spawned: ids => { seen.push('+' + ids.join(',')); }, removed: ids => { seen.push('-' + [...ids].sort().join(',')); }, dispose() {}}]);
 session.spawn([{id: 'b', active: true, parentId: null}, {id: 'c', active: true, parentId: 'b'}]);
 expect(session.world.entities.map(e => e.id)).toEqual(['a', 'b', 'c']);
 expect(() => session.spawn([{id: 'a', active: true}])).toThrow('Object already exists');
 expect(session.despawn(['b']).sort()).toEqual(['b', 'c']);
 expect(session.world.entities.map(e => e.id)).toEqual(['a']);
 expect(session.despawn(['missing'])).toEqual([]);
 expect(seen).toEqual(['+b,c', '-b,c']);
 session.dispose();
});
it('measures each system per advance only while profiling', () => {
 const calls: string[] = [];
 const s = new RuntimeSession([], () => [{id: 'a', fixedUpdate: () => { calls.push('a'); }, dispose() {}}, {id: 'b', update: () => { calls.push('b'); }, dispose() {}}]);
 s.advance(1 / 60); expect(s.timings.size).toBe(0); expect(s.steps).toBe(1);
 s.profile = true; s.advance(2 / 60);
 expect([...s.timings.keys()].sort()).toEqual(['a', 'b']); expect(s.steps).toBe(2); expect(s.timings.get('a')).toBeGreaterThanOrEqual(0);
 s.dispose();
});

it('projects a prepared world without starting clocks or system side effects until explicitly committed',()=>{
 const seen:string[]=[],s=new RuntimeSession([{id:'original',active:true}],world=>[{id:'audio',start:c=>{seen.push('start:'+c?.paused+':'+world.entities.length);},pause(){seen.push('pause');},spawned(){seen.push('spawn');},removed(){seen.push('remove');},update(){seen.push('update');},dispose(){seen.push('dispose');}}],{deferStart:true});
 expect(s.started).toBe(false);s.advance(1);expect(s.time).toBe(0);expect(seen).toEqual([]);expect(()=>s.step()).toThrow('Start runtime');
 s.pause();s.spawn([{id:'other',active:true}]);s.despawn(['original']);expect(seen).toEqual([]);
 s.start();s.start();expect(s.started).toBe(true);expect(seen).toEqual(['start:true:1','pause']);s.step();expect(s.time).toBeCloseTo(1/60);expect(seen.at(-1)).toBe('update');s.dispose();expect(s.started).toBe(false);
});
it('disposes prepared resources on cancellation without autoplay and preserves startup failures',()=>{
 const seen:string[]=[],cancelled=new RuntimeSession([],()=>[{id:'pending',start(){seen.push('start');},dispose(){seen.push('dispose');}}],{deferStart:true});cancelled.dispose();expect(seen).toEqual(['dispose']);expect(()=>cancelled.start()).toThrow('disposed');
 const failing=new RuntimeSession([],()=>[{id:'failing',start(){throw Error('startup');},dispose(){throw Error('cleanup');}}],{deferStart:true});
 expect(()=>failing.start()).toThrow('startup and cleanup');expect(failing.started).toBe(false);expect(failing.world.entities).toEqual([]);
});

it('prepares candidate objects before publishing world membership or spawned callbacks and preserves explicit pause during a hold',async()=>{
 let finish!:()=>void;const events:string[]=[],s=new RuntimeSession([{id:'base',active:true}],()=>[{id:'observe',spawned:ids=>events.push('spawn:'+ids.join(',')),pause:()=>events.push('pause'),resume:()=>events.push('resume'),dispose(){}}]);
 const pending=s.stageSpawn([{id:'room',active:true}],async candidate=>{expect(candidate.map(e=>e.id)).toEqual(['base','room']);await new Promise<void>(r=>finish=r);});await Promise.resolve();expect(s.world.entities.map(e=>e.id)).toEqual(['base']);expect(events).toEqual(['pause']);s.advance(1);expect(s.time).toBe(0);expect(()=>s.step()).toThrow('preparation');s.pause();finish();await pending;expect(events).toEqual(['pause','spawn:room']);expect(s.paused).toBe(true);s.resume();expect(events.at(-1)).toBe('resume');s.dispose();
});
it('cancels hung preparation immediately, rolls back failed spawned callbacks and never resumes a disposed world',async()=>{
 const events:string[]=[],s=new RuntimeSession([],()=>[{id:'observe',pause:()=>events.push('pause'),resume:()=>events.push('resume'),spawned(){throw Error('spawn failed');},removed:ids=>events.push('removed:'+ids.join(',')),dispose(){}}]);
 await expect(s.stageSpawn([{id:'bad',active:true}],async()=>{})).rejects.toThrow('spawn failed');expect(s.world.entities).toEqual([]);expect(events).toContain('removed:bad');
 const c=new AbortController(),pending=s.stageSpawn([{id:'cancelled',active:true}],()=>new Promise<void>(()=>{}),c.signal),rejected=expect(pending).rejects.toThrow('cancelled');c.abort();await rejected;expect(s.world.entities).toEqual([]);
 const late=s.stageSpawn([{id:'late',active:true}],()=>new Promise<void>(()=>{})),closed=expect(late).rejects.toThrow('cancelled');s.dispose();const count=events.length;await closed;expect(events).toHaveLength(count);
});
it('rejects stale candidate membership and keeps nested holds independent',async()=>{
 let finish!:()=>void;const resumes:string[]=[],s=new RuntimeSession([],()=>[{id:'observe',resume:()=>resumes.push('resume'),dispose(){}}]);const release=s.hold(),pending=s.stageSpawn([{id:'candidate',active:true}],()=>new Promise<void>(r=>finish=r));await Promise.resolve();s.spawn([{id:'other',active:true}]);finish();await expect(pending).rejects.toThrow('world changed');expect(s.world.entities.map(e=>e.id)).toEqual(['other']);expect(s.paused).toBe(true);release();release();expect(s.paused).toBe(false);expect(resumes).toEqual(['resume']);s.dispose();
});

it('cleans up every installed system in reverse order when scene assembly fails',()=>{
 const order:string[]=[];
 expect(()=>new RuntimeSession([],(_world,install)=>{
  install({id:'first',dispose:()=>order.push('first')});
  install({id:'second',dispose:()=>order.push('second')});
  throw Error('Later provider failed');
 })).toThrow('Later provider failed');
 expect(order).toEqual(['second','first']);
});
