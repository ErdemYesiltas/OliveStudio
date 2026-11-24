import { World } from 'miniplex';
import type { RuntimeSystem } from '@rewrite/sdk';
export interface RuntimeEntity { id: string; active: boolean; [key: string]: unknown }
export function orderSystems(systems: readonly RuntimeSystem[]): RuntimeSystem[] {
 const map = new Map<string, RuntimeSystem>();
 for (const system of systems) { if (map.has(system.id)) throw Error(`Duplicate system: ${system.id}`); map.set(system.id, system); }
 const deps = new Map(systems.map(s => [s.id, new Set(s.after ?? [])]));
 for (const s of systems) for (const target of s.before ?? []) { if (!map.has(target)) throw Error(`Missing system: ${target}`); deps.get(target)!.add(s.id); }
 const visiting = new Set<string>(), visited = new Set<string>(), result: RuntimeSystem[] = [];
 const visit = (id: string) => {
  if (visited.has(id)) return; if (visiting.has(id)) throw Error(`System cycle: ${id}`);
  const s = map.get(id); if (!s) throw Error(`Missing system: ${id}`); visiting.add(id);
  for (const dep of deps.get(id)!) visit(dep);
  visiting.delete(id); visited.add(id); result.push(s);
 };
 for (const id of map.keys()) visit(id); return result;
}
/** Shared browser-only clock. No React, Electron, timer or global animation ticker. */
export class RuntimeSession {
 readonly world = new World<RuntimeEntity>();
 private systems: RuntimeSystem[];
 private accumulator = 0;
 private dead = false;
 private hasStarted = false;
 get started(){return this.hasStarted&&!this.dead;}
 private userPaused=false;
 private holds=0;
 private structuralRevision=0;
 private preparations=new Set<()=>void>();
 get paused(){return this.userPaused||this.holds>0;}
 time = 0;
 /** Total fixed simulation frames in this session. */
 frame = 0;
 /** Measure each system (profiler): `timings` then holds the milliseconds every system spent in the last advance. */
 profile = false;
 readonly timings = new Map<string, number>();
 /** Fixed 1/60 s steps run by the last advance. */
 steps = 0;
 constructor(input: readonly RuntimeEntity[], create: (world: World<RuntimeEntity>) => RuntimeSystem[] = () => [], options:{paused?:boolean;deferStart?:boolean}={}) {
  this.userPaused=Boolean(options.paused);
  for (const entity of structuredClone(input)) this.world.add(entity);
  this.systems = orderSystems(create(this.world));
  if(!options.deferStart)this.start();
 }
 /** Resource preparation may inspect/project the isolated world before any start/autoplay side effects. */
 start():void{
  if(this.dead)throw Error('Runtime session disposed');if(this.hasStarted)return;this.hasStarted=true;
  try{for(const system of this.systems)system.start?.({paused:this.paused});if(this.paused)for(const system of this.systems)system.pause?.();}
  catch(error){try{this.dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Runtime startup and cleanup failed');}throw error;}
 }
 advance(seconds: number): void { if (this.started&&!this.paused) this.evaluate(seconds); }
 step(): void { if(this.holds)throw Error('Wait for runtime resource preparation before stepping');if(!this.started)throw Error('Start runtime before stepping');if (!this.paused) throw Error('Pause before stepping'); this.evaluate(1 / 60); }
 private evaluate(seconds: number): void {
  if (this.dead || !Number.isFinite(seconds) || seconds < 0) return;
  const delta = Math.min(seconds, 8 / 60); this.accumulator += delta; this.steps = 0;
  if (this.profile) this.timings.clear();
  const run = (system: RuntimeSystem, call: () => void) => {
   if (!this.profile) { call(); return; }
   const start = performance.now();
   try { call(); } finally { this.timings.set(system.id, (this.timings.get(system.id) ?? 0) + performance.now() - start); }
  };
  while (this.accumulator + 1e-10 >= 1 / 60) {
   for (const system of this.systems) if (system.fixedUpdate) run(system, () => system.fixedUpdate!(1 / 60));
   this.accumulator = Math.max(0, this.accumulator - 1 / 60); this.steps++; this.frame++;
  }
  this.time += delta; for (const system of this.systems) if (system.update) run(system, () => system.update!(delta));
 }
 /** Adds objects to the running world (a spawned copy and its children, parents first) and tells the systems. */
 spawn(entities: readonly RuntimeEntity[]): void {
  if (this.dead || !entities.length) return;
  const ids = new Set(this.world.entities.map(e => e.id));
  for (const e of entities) { if (ids.has(e.id)) throw Error(`Object already exists: ${e.id}`); ids.add(e.id); }
  for (const e of entities) this.world.add(e);
  this.structuralRevision++;
  const added = entities.map(e => e.id);
  if(this.started)for (const s of this.systems) s.spawned?.(added);
 }
 /** Removes objects and all their descendants from the running world and tells the systems; returns the removed IDs. */
 despawn(ids: readonly string[]): string[] {
  if (this.dead) return [];
  const gone = new Set(ids.filter(id => this.world.entities.some(e => e.id === id)));
  let size: number;
  do { size = gone.size; for (const e of this.world.entities) if (typeof e.parentId === 'string' && gone.has(e.parentId)) gone.add(e.id); } while (gone.size !== size);
  for (const e of [...this.world.entities]) if (gone.has(e.id)) this.world.remove(e);
  const removed = [...gone];if(removed.length)this.structuralRevision++;
  if (removed.length&&this.started) for (const s of this.systems) s.removed?.(removed);
  return removed;
 }
 /** A resource hold freezes the clock and real-time systems without losing the user's pause choice. */
 hold():()=>void{
  if(this.dead)throw Error('Runtime session disposed');const before=this.paused;this.holds++;
  if(!before&&this.started)for(const system of this.systems)system.pause?.();let released=false;
  return()=>{if(released)return;released=true;this.holds--;if(!this.dead&&!this.paused&&this.started)for(const system of this.systems)system.resume?.();};
 }
 /** Prepare the candidate projection without publishing entities or spawned callbacks into the world.
  * The host owns projection rollback on rejection. Concurrent structural changes invalidate the candidate.
  */
 async stageSpawn(input:readonly RuntimeEntity[],prepare:(candidate:readonly RuntimeEntity[])=>Promise<void>,signal?:AbortSignal):Promise<string[]>{
  if(!this.started)throw Error('Start runtime before preparing objects');signal?.throwIfAborted();
  const copy=structuredClone(input),taken=new Set(this.world.entities.map(e=>e.id));for(const e of copy){if(taken.has(e.id))throw Error(`Object already exists: ${e.id}`);taken.add(e.id);}
  const revision=this.structuralRevision,release=this.hold();let cancel!:()=>void;
  const cancelled=new Promise<never>((_resolve,reject)=>{cancel=()=>reject(Error('Runtime object preparation cancelled'));});
  this.preparations.add(cancel);signal?.addEventListener('abort',cancel,{once:true});
  try{
   await Promise.race([Promise.resolve().then(()=>{if(this.dead||signal?.aborted)throw Error('Runtime object preparation cancelled');return prepare([...this.world.entities,...copy]);}),cancelled]);
   if(this.dead||signal?.aborted)throw Error('Runtime object preparation cancelled');if(this.structuralRevision!==revision)throw Error('Runtime world changed during object preparation');
   try{this.spawn(copy);}catch(error){try{this.despawn(copy.map(e=>e.id));}catch(rollback){throw new AggregateError([error,rollback],'Runtime spawn and rollback failed');}throw error;}
   return copy.map(e=>e.id);
  }finally{signal?.removeEventListener('abort',cancel);this.preparations.delete(cancel);release();}
 }
 pause(): void { if(this.dead)return;const before=this.paused;this.userPaused=true;if(!before&&this.started)for(const system of this.systems)system.pause?.(); }
 resume(): void { if(this.dead)return;const before=this.paused;this.userPaused=false;if(before&&!this.paused&&this.started)for(const system of this.systems)system.resume?.(); }
 dispose(): void {
  if (this.dead) return; this.dead = true;for(const cancel of this.preparations)cancel();this.preparations.clear();
  const errors: unknown[] = [];
  for (const s of [...this.systems].reverse()) { try { s.dispose(); } catch (error) { errors.push(error); } }
  for (const e of [...this.world.entities]) this.world.remove(e);
  if (errors.length) throw new AggregateError(errors, 'Runtime cleanup');
 }
}
export {RuntimeSpawnQueue,type SpawnPreparationPorts} from './preparation';
