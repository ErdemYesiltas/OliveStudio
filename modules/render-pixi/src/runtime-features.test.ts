import {it,expect,vi} from 'vitest';
import {blankScene,type Scene} from '@rewrite/scene';
import {ViewportRuntimeGate} from './runtime-features';
import type {ViewportFeatureHandle} from './viewport-features';
const feature=(runtime:ViewportFeatureHandle['runtime']):ViewportFeatureHandle=>({runtime,sync(){},clear(){},dispose(){}});
function spatial():Scene{return{...blankScene(),entities:[{id:'mesh',name:'Mesh',parentId:null,active:true,spatial:'demo.transform',components:[]}]};}
it('rejects an unowned spatial world or provider diagnostics before preparing resources',async()=>{const prepare=vi.fn(async()=>{}),f=feature({spatialTypes:[],prepare}),gate=new ViewportRuntimeGate(()=>[f]);await expect(gate.prepare(spatial())).rejects.toThrow('provider unavailable');expect(prepare).not.toHaveBeenCalled();f.runtime!.spatialTypes=['demo.transform'];f.runtime!.validate=()=>['Bad camera'];await expect(gate.prepare(spatial())).rejects.toThrow('Bad camera');expect(prepare).not.toHaveBeenCalled();});
it('waits for resources, requires the prepared scene and tears down all entered scopes in reverse order',async()=>{let resolve!:()=>void;const calls:string[]=[],first=feature({spatialTypes:['demo.transform'],prepare:()=>new Promise<void>(r=>resolve=r),enter:()=>{calls.push('enter one');},exit:()=>{calls.push('exit one');}}),second=feature({spatialTypes:[],enter:()=>{calls.push('enter two');},exit:()=>{calls.push('exit two');throw Error('cleanup');}}),gate=new ViewportRuntimeGate(()=>[first,second]),scene=spatial(),ready=gate.prepare(scene);expect(()=>gate.enter(scene)).toThrow('Prepare');resolve();await ready;expect(()=>gate.enter({...scene})).toThrow('Prepare');gate.enter(scene);expect(()=>gate.exit()).toThrow('cleanup');gate.exit();expect(calls).toEqual(['enter one','enter two','exit two','exit one']);});
it('never starts a cancelled or removed feature after late resource completion',async()=>{let resolve!:()=>void;const enter=vi.fn(),f=feature({spatialTypes:[],prepare:()=>new Promise<void>(r=>resolve=r),enter}),features=[f],gate=new ViewportRuntimeGate(()=>features),scene=blankScene(),ready=gate.prepare(scene);gate.exit();resolve();await expect(ready).rejects.toThrow('cancelled');expect(()=>gate.enter(scene)).toThrow('Prepare');expect(enter).not.toHaveBeenCalled();const removed=gate.prepare(scene);features.pop();resolve();await expect(removed).rejects.toThrow('cancelled');});
it('rolls back partially entered feature scopes when startup fails',async()=>{const calls:string[]=[],one=feature({spatialTypes:[],enter(){calls.push('one');},exit(){calls.push('exit one');}}),two=feature({spatialTypes:[],enter(){calls.push('two');throw Error('start failed');},exit(){calls.push('exit two');}}),gate=new ViewportRuntimeGate(()=>[one,two]),scene=blankScene();await gate.prepare(scene);expect(()=>gate.enter(scene)).toThrow('start failed');expect(calls).toEqual(['one','two','exit two','exit one']);gate.exit();});

it('rejects cancelled preparation immediately even if a backend never completes',async()=>{
 const f=feature({spatialTypes:[],prepare:()=>new Promise<void>(()=>{})}),gate=new ViewportRuntimeGate(()=>[f]);
 const ready=gate.prepare(blankScene()),rejected=expect(ready).rejects.toThrow('cancelled');
 gate.exit();await rejected;
});
it('supersedes pending preparation without blocking a new scene or entering a removed feature',async()=>{
 let finish!:()=>void;
 const enter=vi.fn(),f=feature({spatialTypes:[],prepare:()=>new Promise<void>(r=>finish=r),enter}),features=[f],gate=new ViewportRuntimeGate(()=>features);
 const old=gate.prepare(blankScene()),rejected=expect(old).rejects.toThrow('cancelled');
 features.pop();const next=blankScene();await gate.prepare(next);await rejected;gate.enter(next);
 await expect(gate.prepare(next)).rejects.toThrow('Stop Preview');gate.exit();
 finish();await Promise.resolve();expect(enter).not.toHaveBeenCalled();
 features.push(f);const ready=gate.prepare(next);finish();await ready;features.pop();
 expect(()=>gate.enter(next)).toThrow('removed after preparation');expect(enter).not.toHaveBeenCalled();gate.exit();
});

it('waits for final runtime reconciliation separately from authored-scene preparation and cancels hung final readiness',async()=>{
 let finish!:()=>void;const ready=vi.fn(()=>new Promise<void>(r=>finish=r)),f=feature({spatialTypes:[],prepare:async()=>{},ready}),gate=new ViewportRuntimeGate(()=>[f]),scene=blankScene();await gate.prepare(scene);gate.enter(scene);
 let completed=false;const final=gate.ready().then(()=>{completed=true;});await Promise.resolve();expect(ready).toHaveBeenCalledOnce();expect(completed).toBe(false);finish();await final;
 const pending=gate.ready(),rejected=expect(pending).rejects.toThrow('cancelled');gate.exit();await rejected;finish();await expect(gate.ready()).rejects.toThrow('not prepared');
});
it('rejects removed features and final resource failures without silently declaring Preview ready',async()=>{
 const f=feature({spatialTypes:[],ready:async()=>{throw Error('final model failed');}}),features=[f],gate=new ViewportRuntimeGate(()=>features),scene=blankScene();await gate.prepare(scene);gate.enter(scene);await expect(gate.ready()).rejects.toThrow('final model failed');gate.exit();
 f.runtime!.ready=async()=>{};await gate.prepare(scene);gate.enter(scene);features.pop();await expect(gate.ready()).rejects.toThrow('cancelled');gate.exit();
});
