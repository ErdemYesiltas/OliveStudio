import {it,expect,vi} from 'vitest';
import {RuntimeSession,RuntimeSpawnQueue} from './index';
it('serializes candidate projections and scene-start callbacks after resource readiness, deduplicating queued scene IDs',async()=>{
 const log:string[]=[],finish:(()=>void)[]=[],s=new RuntimeSession([{id:'base',active:true}],()=>[{id:'observe',spawned:ids=>log.push('spawn:'+ids.join(',')),dispose(){}}]);
 const q=new RuntimeSpawnQueue(s,{prepare:async candidate=>{log.push('prepare:'+candidate.map(e=>e.id).join(','));await new Promise<void>(r=>finish.push(r));},committed:key=>log.push('start:'+key),rollback:vi.fn(),sync:()=>log.push('sync'),report:error=>{throw error;}});
 q.enqueue('B',[{id:'b',active:true}]);q.enqueue('B',[{id:'duplicate',active:true}]);q.enqueue('C',[{id:'c',active:true}]);for(let i=0;i<5;i++)await Promise.resolve();expect(q.pendingKeys).toEqual(['B','C']);expect(s.world.entities.map(e=>e.id)).toEqual(['base']);expect(s.paused).toBe(true);finish.shift()!();for(let i=0;i<20;i++)await Promise.resolve();expect(log).toContain('start:B');expect(log).toContain('prepare:base,b,c');expect(log.indexOf('start:B')).toBeGreaterThan(log.indexOf('spawn:b'));finish.shift()!();await q.idle();expect(s.world.entities.map(e=>e.id)).toEqual(['base','b','c']);expect(q.pendingKeys).toEqual([]);expect(s.paused).toBe(false);q.dispose();s.dispose();
});
it('cancels pending loads, restores committed projection on failure, and allows a later scene to load',async()=>{
 const committed=vi.fn(),rollback=vi.fn(),report=vi.fn(),sync=vi.fn(),s=new RuntimeSession([]),q=new RuntimeSpawnQueue(s,{prepare:async candidate=>{if(candidate.some(e=>e.id==='bad'))throw Error('asset unavailable');if(candidate.some(e=>e.id==='cancel'))await new Promise<void>(()=>{});},committed,rollback,report,sync});
 q.enqueue('bad',[{id:'bad',active:true}]);await q.idle();expect(report).toHaveBeenCalledOnce();expect(rollback).toHaveBeenCalledWith(['bad']);expect(s.world.entities).toEqual([]);
 q.enqueue('cancel',[{id:'cancel',active:true}]);for(let i=0;i<5;i++)await Promise.resolve();q.cancel('cancel');await q.idle();expect(committed).not.toHaveBeenCalled();expect(report).toHaveBeenCalledOnce();expect(s.paused).toBe(false);
 q.enqueue('good',[{id:'good',active:true}]);await q.idle();expect(committed).toHaveBeenCalledWith('good',['good']);expect(sync).toHaveBeenCalledTimes(3);q.dispose();s.dispose();
});
it('disposed queues never restore or start a stale scene after late preparation callbacks',async()=>{
 let finish!:()=>void;const committed=vi.fn(),sync=vi.fn(),s=new RuntimeSession([]),q=new RuntimeSpawnQueue(s,{prepare:()=>new Promise<void>(r=>finish=r),committed,rollback:vi.fn(),sync,report:vi.fn()});q.enqueue('late',[{id:'late',active:true}]);for(let i=0;i<5;i++)await Promise.resolve();q.dispose();s.dispose();await q.idle();finish();await Promise.resolve();expect(committed).not.toHaveBeenCalled();expect(sync).not.toHaveBeenCalled();expect(q.pendingKeys).toEqual([]);
});
