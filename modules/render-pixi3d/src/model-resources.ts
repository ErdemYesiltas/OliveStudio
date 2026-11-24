import type {AssetRecord} from '@rewrite/assets';
import {modelAssetType,ModelMetadataSchema} from './model-contracts';
export interface ModelAssetPort{get(id:string):AssetRecord|undefined;url(asset:AssetRecord,file:string):string}
interface Entry<T>{refs:number;promise:Promise<T>;ready:boolean}
/** Lease-based source cache: release is deferred to the end of a synchronous projection rebuild.
 * A new load waits for the preceding unload of that URL. Late loads cannot revive a disposed scope.
 */
export class ModelResources<T>{
 private entries=new Map<string,Entry<T>>();private closing=new Map<string,Promise<void>>();private dead=false;
 constructor(readonly assets:ModelAssetPort,private load:(url:string)=>Promise<T>,private unload:(url:string,value:T)=>Promise<void>,private report:(error:unknown)=>void=()=>{}){}
 key(id:string){const asset=this.assets.get(id);return asset?.type===modelAssetType?this.assets.url(asset,'model.glb'):'';}
 get stats(){return{resources:this.entries.size,refs:[...this.entries.values()].reduce((n,e)=>n+e.refs,0),loaded:[...this.entries.values()].filter(e=>e.ready).length,pendingUnloads:this.closing.size};}
 acquire(id:string){if(this.dead)throw Error('Model resource scope disposed');const asset=this.assets.get(id);if(!asset||asset.type!==modelAssetType)throw Error('3D model asset is missing');ModelMetadataSchema.parse(asset.metadata);const key=this.key(id);let entry=this.entries.get(key);
  if(!entry){const ready:Entry<T>={refs:0,ready:false,promise:Promise.resolve(null as T)};ready.promise=(this.closing.get(key)??Promise.resolve()).then(()=>{if(this.dead)throw Error('Model load cancelled');return this.load(key);}).then(source=>{ready.ready=true;return source;});entry=ready;this.entries.set(key,entry);}
  entry.refs++;const owned=entry;let released=false;return{key,promise:entry.promise,release:()=>{if(released)return;released=true;owned.refs--;queueMicrotask(()=>{if(!owned.refs&&this.entries.get(key)===owned)this.close(key,owned);});}};
 }
 private close(key:string,entry:Entry<T>){this.entries.delete(key);const closing=entry.promise.then(source=>this.unload(key,source),()=>{}).catch(error=>this.report(error));this.closing.set(key,closing);void closing.finally(()=>{if(this.closing.get(key)===closing)this.closing.delete(key);});}
 async dispose(){this.dead=true;for(const [key,entry]of this.entries)this.close(key,entry);await Promise.all([...this.closing.values()]);}
}
