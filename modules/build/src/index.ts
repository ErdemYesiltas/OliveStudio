import {slot,token,type EditorModule} from '@rewrite/sdk';
export interface BuildStatus{phase:'idle'|'preflight'|'preparing'|'building'|'packaging'|'complete'|'cancelled'|'failed';message:string;output?:string;
 /** What the finished build is made of (bytes per group, the largest files). */
 report?:{total:number;groups:{label:string;bytes:number;files:number}[];largest:{path:string;bytes:number}[]};
 /** The ZIP written next to the build (Make ZIP). */
 zip?:string}
export interface BuildPort{start(text:string,targetId:string):Promise<{output:string}|null>;status():Promise<BuildStatus>;cancel():Promise<void>;
 /** Zips the last finished build (files at the root), next to it; resolves to the ZIP path. */
 zip?():Promise<string>}
export const buildTargets=slot<{id:string;titleKey:string;nativeEntry:string}>('build.targets.descriptors');
export class BuildService{
 private listeners=new Set<()=>void>();state:BuildStatus={phase:'idle',message:''};busy=false;private timer?:ReturnType<typeof setInterval>;private dead=false;
 constructor(private port:BuildPort){}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private set(state:BuildStatus){if(this.dead)return;this.state=state;for(const fn of this.listeners)fn();}
 async start(text:string,id:string){if(this.busy||this.dead)throw Error('A build is already running');this.busy=true;this.set({phase:'preflight',message:'Choose an output folder…'});this.timer=setInterval(()=>{void this.port.status().then(s=>{if(this.busy)this.set(s);}).catch(()=>{});},150);try{const result=await this.port.start(text,id),done=result?await this.port.status().catch(()=>null):null;this.set(result?{phase:'complete',message:id==='mobile'?'Mobile project complete':'HTML build complete',output:result.output,...(done?.report?{report:done.report}:{})}:{phase:'idle',message:''});}catch(e){const status=await this.port.status();this.set(status.phase==='cancelled'?status:{phase:'failed',message:String(e)});}finally{clearInterval(this.timer);this.busy=false;this.set({...this.state});}}
 cancel(){return this.port.cancel();}
 async zip(){if(!this.port.zip)throw Error('ZIP is unavailable here');if(this.busy||this.state.phase!=='complete')throw Error('Finish a build first');this.set({...this.state,message:'Writing the ZIP…'});const path=await this.port.zip();this.set({...this.state,message:'ZIP written',zip:path});return path;}
 dispose(){this.dead=true;clearInterval(this.timer);if(this.busy)void this.port.cancel();this.listeners.clear();}
}
export const buildToken=token<BuildService>('build','build.service');
export function buildModule(port:BuildPort):EditorModule{return{manifest:{id:'build',version:'1.0.0',apiVersion:1},activate(c){const service=new BuildService(port);c.provide(buildToken,service);c.own(()=>service.dispose());}};}
