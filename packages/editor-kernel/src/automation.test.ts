import {expect,it} from 'vitest';
import {AutomationExecutor,type AutomationEntry} from './automation';
import {automationTool,automationSchema as z} from '@rewrite/sdk';
import {DocumentSession} from '../../documents/src/index';
// Domain-free test document, not editor or renderer fixtures.
const setup=()=>{
 const document=new DocumentSession({value:0},v=>{const x=v as {value:number};if(x.value<0)throw Error('Negative');return x;}),entries:AutomationEntry[]=[];let generation=0,blocked=false;
 const executor=new AutomationExecutor({entries:()=>entries,snapshot:()=>({generation,revision:document.version}),editable:()=>{if(blocked)throw Error('Busy');},batch:(label,work)=>document.batch(label,work)});
 return{document,entries,executor,setGeneration:(v:number)=>{generation=v;},block:()=>{blocked=true;}};
};
// SDK helpers use Zod, supplied through the test fixture's module dependency.
const empty=z.object({}).strict();
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
it('validates input and atomically rolls back an entire batch, preserving redo',async()=>{
 const s=setup();s.entries.push({id:'test.set',owner:'test',value:automationTool(z.object({value:z.number()}).strict(),{description:'Set',effect:'edit',execute:a=>s.document.transact('Set',d=>{d.value=a.value;})})});
 await s.executor.execute('test.set',{value:1});s.document.undo();expect(s.document.canRedo).toBe(true);
 await expect(s.executor.executeBatch([{name:'test.set',arguments:{value:2}},{name:'test.set',arguments:{value:-1}}])).rejects.toThrow('Negative');
 expect(s.document.current.value).toBe(0);expect(s.document.canRedo).toBe(true);expect(s.document.historyLength).toBe(0);
 await expect(s.executor.execute('test.set',{value:'bad'})).rejects.toThrow();
 await s.executor.executeBatch([{name:'test.set',arguments:{value:2}},{name:'test.set',arguments:{value:3}}]);expect(s.document.historyLength).toBe(1);s.document.undo();expect(s.document.current.value).toBe(0);
});
it('rejects stale writes, queued project changes and edits while blocked',async()=>{
 const s=setup();s.entries.push({id:'test.set',owner:'test',value:automationTool(empty,{description:'Set',effect:'edit',execute:()=>s.document.transact('Set',d=>{d.value++;})})});
 await expect(s.executor.execute('test.set',{}, {revision:9})).rejects.toMatchObject({code:'STALE_CONTEXT'});
 const queued=s.executor.execute('test.set');s.setGeneration(1);await expect(queued).rejects.toMatchObject({code:'STALE_CONTEXT'});s.block();await expect(s.executor.execute('test.set')).rejects.toThrow('Busy');
});
it('requires UI approval, rejects stale approval and does not expose an approval tool',async()=>{
 const s=setup();let ran=0;s.entries.push({id:'test.save',owner:'test',value:automationTool(empty,{description:'Save',effect:'job',approval:true,execute:()=>{ran++;}})});
 const first=await s.executor.execute('test.save') as {id:string};expect(ran).toBe(0);expect(s.executor.job(first.id).state).toBe('awaiting_approval');s.document.transact('Human edit',d=>{d.value=3;});await expect(s.executor.approve(first.id)).rejects.toMatchObject({code:'STALE_CONTEXT'});expect(ran).toBe(0);
 const second=await s.executor.execute('test.save') as {id:string};await s.executor.approve(second.id);await tick();expect(ran).toBe(1);expect(s.executor.job(second.id).state).toBe('complete');expect(s.executor.list().map(v=>v.name)).not.toContain('automation.approve');
});
it('cancels async work with a real abort signal and ignores late results',async()=>{
 const s=setup();let finish!:(v:string)=>void;let aborted=false;s.entries.push({id:'test.job',owner:'test',value:automationTool(empty,{description:'Job',effect:'job',execute:(_,ctx)=>{ctx.signal.addEventListener('abort',()=>{aborted=true;});return new Promise<string>(resolve=>{finish=resolve;});}})});
 const job=await s.executor.execute('test.job') as {id:string};s.executor.cancel(job.id);finish('late');await tick();expect(aborted).toBe(true);expect(s.executor.job(job.id)).toMatchObject({state:'cancelled'});expect(s.executor.job(job.id).result).toBeUndefined();
});
it('rejects non-edit batch tools before invoking any handler',async()=>{
 const s=setup();let calls=0;for(const effect of ['edit','job'] as const)s.entries.push({id:effect,owner:'test',value:automationTool(empty,{description:effect,effect,execute:()=>{calls++;}})});
 await expect(s.executor.executeBatch([{name:'edit'},{name:'job'}])).rejects.toMatchObject({code:'INVALID_BATCH'});expect(calls).toBe(0);
});
it('does not execute a removed module tool after approval',async()=>{
 const s=setup();s.entries.push({id:'test.save',owner:'test',value:automationTool(empty,{description:'Save',effect:'job',approval:true,execute:()=>{throw Error('Must not run');}})});const job=await s.executor.execute('test.save') as {id:string};s.entries.length=0;await s.executor.approve(job.id);await tick();expect(s.executor.job(job.id)).toMatchObject({state:'failed',error:{code:'TOOL_NOT_FOUND'}});
});

it('validates declared edit outputs before committing document changes',async()=>{
 const s=setup();s.entries.push({id:'test.bad',owner:'test',value:automationTool(empty,{description:'Bad output',effect:'edit',output:z.object({ok:z.literal(true)}),execute:()=>{s.document.transact('Change',d=>{d.value=9;});return{ok:false};}})});
 await expect(s.executor.execute('test.bad')).rejects.toThrow();expect(s.document.current.value).toBe(0);expect(s.document.historyLength).toBe(0);
});
it('does not claim a running atomic file commit can be cancelled',async()=>{
 const s=setup();let finish!:()=>void;s.entries.push({id:'test.save',owner:'test',value:automationTool(empty,{description:'Save',effect:'job',cancellable:false,execute:()=>new Promise<void>(resolve=>{finish=resolve;})})});const job=await s.executor.execute('test.save') as {id:string};expect(()=>s.executor.cancel(job.id)).toThrow('already started');finish();await tick();expect(s.executor.job(job.id).state).toBe('complete');
});
it('runs a preempting session call ahead of a pending one without the busy guard',async()=>{
 let busy=false,release!:()=>void,preparing=false;const order:string[]=[],seen:(boolean|undefined)[]=[];const entries:AutomationEntry[]=[];
 const executor=new AutomationExecutor({entries:()=>entries,snapshot:()=>({generation:0,revision:0}),editable:(_tool,preempting)=>{seen.push(preempting);if(!preempting&&busy)throw Error('Busy');},batch:(_label,work)=>work()});
 entries.push({id:'test.preview',owner:'test',value:automationTool(z.object({action:z.enum(['play','stop'])}).strict(),{description:'Preview',effect:'session',preempts:a=>(a as {action:string}).action==='stop'&&preparing,execute:async a=>{if(a.action==='play'){busy=preparing=true;await new Promise<void>(r=>{release=r;});busy=preparing=false;order.push('play');}else{order.push('stop');release?.();}}})});
 const play=executor.execute('test.preview',{action:'play'});await tick();
 await executor.execute('test.preview',{action:'stop'});await play;expect(order).toEqual(['stop','play']);expect(seen).toEqual([undefined,true]);
 await expect(executor.execute('test.preview',{action:'stop'})).resolves.toEqual({ok:true});expect(seen.at(-1)).toBeUndefined();
});
