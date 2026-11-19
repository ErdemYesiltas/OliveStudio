import {Texture} from 'pixi.js';
import {TextureAtlas,AtlasAttachmentLoader,SkeletonJson,type SkeletonData} from '@esotericsoftware/spine-core';
import {SpineTexture} from '@esotericsoftware/spine-pixi-v8';
import type {AssetRecord,AssetService} from '@rewrite/assets';
import {SpineMetadataSchema} from './contracts';
export interface SpineResource{data:SkeletonData;dispose():void}
interface Entry{refs:number;abort:AbortController;promise:Promise<SpineResource>;resource?:SpineResource}
export class SpineResources{
 private entries=new Map<string,Entry>();private dead=false;
 constructor(private assets:Pick<AssetService,'get'|'url'>){}
 get stats(){return{resources:this.entries.size,refs:[...this.entries.values()].reduce((sum,e)=>sum+e.refs,0),loaded:[...this.entries.values()].filter(e=>e.resource).length};}
 key(id:string){const a=this.assets.get(id);return a?.type==='spine.skeleton'?this.assets.url(a,'skeleton.json'):'';}
 acquire(assetId:string){if(this.dead)throw Error('Spine resource scope disposed');const asset=this.assets.get(assetId);if(!asset||asset.type!=='spine.skeleton')throw Error('Spine asset missing');const key=this.key(assetId);let entry=this.entries.get(key);if(!entry){const abort=new AbortController();entry={refs:0,abort,promise:Promise.resolve(null as unknown as SpineResource)};this.entries.set(key,entry);const current=entry;entry.promise=this.load(asset,abort.signal).then(resource=>{if(this.dead||abort.signal.aborted||this.entries.get(key)!==current){resource.dispose();throw Error('Spine resource cancelled');}current.resource=resource;return resource;});}entry.refs++;let released=false;return{promise:entry.promise,release:()=>{if(released)return;released=true;entry!.refs--;queueMicrotask(()=>{if(entry!.refs===0&&this.entries.get(key)===entry){this.entries.delete(key);entry!.abort.abort();entry!.resource?.dispose();}});}};}
 private async load(asset:AssetRecord,signal:AbortSignal):Promise<SpineResource>{
  const meta=SpineMetadataSchema.parse(asset.metadata),owned:{texture:Texture;bitmap:ImageBitmap}[]=[];let atlas:TextureAtlas|undefined;
  const get=async(file:string)=>{const response=await fetch(this.assets.url(asset,file),{signal});if(!response.ok)throw Error(`Spine file unavailable: ${file}`);return response;};
  try{const json=await(await get('skeleton.json')).json(),text=await(await get('skeleton.atlas')).text();atlas=new TextureAtlas(text);for(const p of meta.pages){const page=atlas.pages.find(a=>a.name===p.name);if(!page)throw Error('Spine atlas page mismatch');const response=await get(p.file),blob=await response.blob(),bitmap=await createImageBitmap(blob);if(signal.aborted){bitmap.close();throw Error('Spine load cancelled');}const texture=Texture.from(bitmap);owned.push({texture,bitmap});page.setTexture(SpineTexture.from(texture.source));}
   const data=new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(json);let disposed=false;return{data,dispose(){if(disposed)return;disposed=true;atlas?.dispose();for(const o of owned){o.texture.destroy(true);o.bitmap.close();}}};
  }catch(error){atlas?.dispose();for(const o of owned){o.texture.destroy(true);o.bitmap.close();}throw error;}
 }
 dispose(){if(this.dead)return;this.dead=true;for(const entry of this.entries.values()){entry.abort.abort();entry.resource?.dispose();}this.entries.clear();}
}
