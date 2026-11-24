import {it,expect,vi} from 'vitest';
import {SharedModelSources} from './shared-model-sources';
it('keeps one shared source alive until every projection scope releases it',async()=>{const source={destroyed:false},read=vi.fn(async()=>source),release=vi.fn(async(_url:string,value:typeof source)=>{value.destroyed=true;}),pool=new SharedModelSources(read,release);const[a,b]=await Promise.all([pool.load('same.glb'),pool.load('same.glb')]);expect(a).toBe(b);expect(read).toHaveBeenCalledOnce();await pool.unload('same.glb',a);expect(source.destroyed).toBe(false);expect(pool.stats).toMatchObject({resources:1,refs:1});await pool.unload('same.glb',b);expect(release).toHaveBeenCalledOnce();expect(source.destroyed).toBe(true);expect(pool.stats).toMatchObject({resources:0,refs:0,pendingUnloads:0});});
it('serializes teardown/reload across different owners and refuses stale releases',async()=>{let finish!:()=>void;let sequence=0;const closing=new Promise<void>(r=>finish=r),read=vi.fn(async()=>({id:++sequence})),pool=new SharedModelSources(read,async()=>closing),first=await pool.load('model.glb'),retired=pool.unload('model.glb',first),second=pool.load('model.glb');await Promise.resolve();expect(read).toHaveBeenCalledOnce();finish();await retired;const current=await second;expect(read).toHaveBeenCalledTimes(2);expect(current).not.toBe(first);await expect(pool.unload('model.glb',first)).rejects.toThrow('ownership');expect(pool.stats.refs).toBe(1);await pool.unload('model.glb',current);});
it('does not retain failed owner counts and allows a clean retry',async()=>{let attempt=0;const read=vi.fn(async()=>{if(++attempt===1)throw Error('network');return{ok:true};}),release=vi.fn(async()=>{}),pool=new SharedModelSources(read,release),failures=await Promise.allSettled([pool.load('retry.glb'),pool.load('retry.glb')]);expect(failures.every(f=>f.status==='rejected')).toBe(true);expect(pool.stats).toMatchObject({resources:0,refs:0});const source=await pool.load('retry.glb');expect(source.ok).toBe(true);await pool.unload('retry.glb',source);expect(read).toHaveBeenCalledTimes(2);expect(release).toHaveBeenCalledOnce();});
it('lets a surviving owner keep a late loaded source when another scope closes',async()=>{let finish!:(value:{ready:boolean})=>void;const release=vi.fn(async()=>{}),pool=new SharedModelSources(()=>new Promise<{ready:boolean}>(r=>finish=r),release),a=pool.load('late.glb'),b=pool.load('late.glb');await Promise.resolve();finish({ready:true});const [one,two]=await Promise.all([a,b]);await pool.unload('late.glb',one);expect(release).not.toHaveBeenCalled();expect(two.ready).toBe(true);await pool.unload('late.glb',two);expect(release).toHaveBeenCalledOnce();});

it('forgets failed teardown and reports the failure without poisoning a later load',async()=>{
 let attempt=0;
 const pool=new SharedModelSources(async()=>({id:++attempt}),()=>{throw Error('backend teardown');});
 const first=await pool.load('broken.glb');
 await expect(pool.unload('broken.glb',first)).rejects.toThrow('backend teardown');
 expect(pool.stats).toEqual({resources:0,refs:0,pendingUnloads:0});
 const next=await pool.load('broken.glb');expect(next.id).toBe(2);
 await expect(pool.unload('broken.glb',next)).rejects.toThrow('backend teardown');
 expect(pool.stats.refs).toBe(0);
});
