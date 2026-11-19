import { utilityProcess } from 'electron';
import { AssetSession,sweepSessions,type BuildJob,type BuildResult,type PreparedSource } from '@rewrite/assets/node';
import {spineImporter} from '@rewrite/spine/contracts';
import {audioImporter} from '@rewrite/audio/contracts';
import { imageImporter } from '@rewrite/assetpack/catalog';
import { fontImporter } from '@rewrite/render-pixi/contracts';
import type { NativeAssets } from './native-assets.types';
export async function createNativeAssets(parent:string,workerPath:string):Promise<NativeAssets>{
 let lastWorkerPid:number|null=null;
 const children=new Set<Electron.UtilityProcess>();
 const invoke=<T>(job:BuildJob|{operation:'prepare';path:string;importerId:string},signal:AbortSignal)=>new Promise<T>((resolve,reject)=>{
  if(signal.aborted){reject(Error('Asset operation cancelled'));return;}
  const child=utilityProcess.fork(workerPath,[],{stdio:'pipe',serviceName:'OliveStudio AssetPack'});children.add(child);
  let done=false;
  const finish=(error?:unknown,result?:T)=>{if(done)return;done=true;clearTimeout(timeout);signal.removeEventListener('abort',cancel);children.delete(child);child.kill();if(error)reject(error);else resolve(result!);};
  const timeout=setTimeout(()=>finish(Error('Asset processing timed out')),60000);
  const cancel=()=>finish(Error('Asset operation cancelled'));signal.addEventListener('abort',cancel,{once:true});
  child.on('spawn',()=>{lastWorkerPid=child.pid??null;child.postMessage(job);});
  child.on('exit',code=>finish(Error(`Asset worker exited (${code})`)));
  child.on('message',(message:{ok:boolean;result?:T;error?:string})=>{if(message?.ok&&message.result)finish(undefined,message.result);else finish(Error(message?.error??'Asset processing failed'));});
 });
 const build=(job:BuildJob,signal:AbortSignal)=>invoke<BuildResult>(job,signal);
 const importers=[imageImporter,audioImporter,fontImporter,{...spineImporter,prepare:(path:string,signal:AbortSignal)=>invoke<PreparedSource>({operation:'prepare',path,importerId:spineImporter.id},signal)}];
 await sweepSessions(parent).catch(()=>0);
 let current=await AssetSession.create(parent,importers,build),pending:{path:string;session:AssetSession}|undefined,disposed=false;
 return{
  info:()=>({sessionId:current.id,workerProcessId:lastWorkerPid}),importer:id=>importers.find(i=>i.id===id),importers:()=>importers,
  import:(paths,id,replace)=>current.importFiles(paths,id,replace),
  async stageOpen(path,project){await pending?.session.dispose();pending=undefined;const candidate=await AssetSession.create(parent,importers,build);try{await candidate.restore(path,project);pending={path,session:candidate};return [...candidate.warnings];}catch(error){await candidate.dispose();throw error;}},
  async acceptOpen(path){if(pending?.path!==path)throw Error('No prepared asset session');const previous=current;current=pending.session;pending=undefined;await previous.dispose();return current.id;},
  async rejectOpen(){await pending?.session.dispose();pending=undefined;},
  async reset(){const next=await AssetSession.create(parent,importers,build);await current.dispose();await pending?.session.dispose();pending=undefined;current=next;return current.id;},
  persist:(path,project)=>current.persist(path,project),rebuild:project=>current.rebuild(project),inspect:project=>current.inspect(project),
  async read(value){try{const url=new URL(value);if(url.hostname!==current.id)return new Response('Session unavailable',{status:404});const parts=url.pathname.slice(1).split('/');if(parts.length!==3||!/^[a-f0-9-]{36}$/.test(parts[0])||!/^[a-f0-9]{64}$/.test(parts[1]))return new Response('Invalid asset URL',{status:400});const result=await current.read(parts[0],parts[1],parts[2]);if(!result)return new Response('Asset unavailable',{status:404});return new Response(new Uint8Array(result.bytes),{headers:{'Content-Type':result.mime,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});}catch{return new Response('Asset unavailable',{status:404});}},
  cancel(){current.cancel();pending?.session.cancel();},
  async dispose(){if(disposed)return;disposed=true;for(const child of children)child.kill();await current.dispose();await pending?.session.dispose();},
 };
}
