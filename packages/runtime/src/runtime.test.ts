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
