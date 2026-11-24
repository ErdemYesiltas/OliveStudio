import {mkdtemp,rm,rename,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ExportTarget,Json,ExportContext} from '@rewrite/sdk';
import type {BuildStatus} from './index';
import {sizeReport,zipFolder} from './build-report.node';
export interface NativeBuildOptions{stage:string;template:string;readAsset(id:string,revision:string,file:string):Promise<Uint8Array>}
export interface NativeTargetFactory{id:string;create(options:NativeBuildOptions):ExportTarget}
export class NativeBuildService{
 state:BuildStatus={phase:'idle',message:''};private last?:string;private abort?:AbortController;private finished?:Promise<void>;private finish?:()=>void;
 constructor(private targets:readonly NativeTargetFactory[],private template:string,private readAsset:NativeBuildOptions['readAsset']){}
 cancel(){this.abort?.abort();}
 /** Zips the last finished build next to it (only that folder: the renderer never names a path). */
 async zip(){if(this.abort)throw Error('A build is running');if(!this.last)throw Error('Finish a build first');const out=this.last+'.zip';await zipFolder(this.last,out);this.state={...this.state,zip:out};return out;}
 async dispose(){this.cancel();await this.finished;}
 async run(parent:string,project:Json,targetId:string){if(this.abort)throw Error('Build already running');const factory=this.targets.find(t=>t.id===targetId);if(!factory)throw Error('Export target unavailable: '+targetId);const abort=new AbortController();this.abort=abort;this.finished=new Promise<void>(resolve=>{this.finish=resolve;});let stage:string|undefined,target:ExportTarget|undefined,committed=false;
 const live=()=>{if(abort.signal.aborted)throw Error('Build cancelled');};
 try{const base=await realpath(parent);stage=await mkdtemp(join(base,'.pixi-build-'));target=factory.create({stage,template:this.template,readAsset:this.readAsset});const ctx:ExportContext={profile:project,signal:abort.signal,report:message=>{this.state={...this.state,message};}},steps=[['preflight',()=>target!.validate(ctx)],['preparing',()=>target!.prepare(ctx)],['building',()=>target!.build(ctx)],['packaging',()=>target!.package(ctx)]]as const;
 for(const[phase,step]of steps){live();this.state={phase,message:phase};const result=await step();if(phase==='preflight'&&Array.isArray(result)){const errors=result.filter(d=>typeof d==='object'&&d&&'severity'in d&&d.severity==='error');if(errors.length)throw Error(errors.map(d=>(d as {message:string}).message).join('\n'));}live();}
 const output=join(base,`Pixi-${targetId==='html'?'HTML':targetId==='mobile'?'Mobile':targetId==='server'?'Server':targetId}-${randomUUID().slice(0,8)}`);live();await rename(stage,output);committed=true;this.last=output;const report=await sizeReport(output).catch(()=>undefined);this.state={phase:'complete',message:targetId==='mobile'?'Mobile project complete':targetId==='server'?'Game server complete':'HTML build complete',output,...(report?{report}:{})};return{output};
 }catch(e){this.state={phase:abort.signal.aborted?'cancelled':'failed',message:String(e)};throw e;}finally{try{await target?.cleanup();}finally{try{if(stage&&!committed)await rm(stage,{recursive:true,force:true});}finally{this.abort=undefined;this.finish?.();}}}}
}
