import {Texture} from 'pixi.js';

export interface TextureLease{
 readonly ready:Promise<Texture>;
 release():void;
}
interface TextureEntry{
 refs:number;
 abort:AbortController;
 ready:Promise<Texture>;
}

/** One decode per URL per Pixi application. The last lease releases both the Pixi source and its bitmap. */
export class TexturePool{
 private entries=new Map<string,TextureEntry>();
 private mode:'linear'|'nearest'='linear';
 private dead=false;

 constructor(private maxBytes=Infinity){}

 acquire(url:string):TextureLease{
  if(this.dead)throw Error('Texture pool disposed');
  let entry=this.entries.get(url);
  if(!entry){
   const abort=new AbortController();
   const created={refs:0,abort,ready:this.load(url,abort.signal)};
   this.entries.set(url,created);
   void created.ready.catch(()=>{
    if(this.entries.get(url)===created)this.entries.delete(url);
   });
   entry=created;
  }
  const owned=entry;
  owned.refs++;
  let released=false;
  return {ready:owned.ready,release:()=>{
   if(released)return;
   released=true;
   if(--owned.refs===0&&this.entries.get(url)===owned){
    this.entries.delete(url);
    owned.abort.abort();
   }
  }};
 }

 private async load(url:string,signal:AbortSignal){
  const response=await fetch(url,{signal});
  if(!response.ok)throw Error('Image unavailable');
  const blob=await response.blob();
  if(blob.size>this.maxBytes)throw Error('Texture too large');
  signal.throwIfAborted();
  const bitmap=await createImageBitmap(blob);
  try{
   signal.throwIfAborted();
   const texture=Texture.from(bitmap);
   texture.source.scaleMode=this.mode;
   signal.addEventListener('abort',()=>{try{texture.destroy(true);}finally{bitmap.close();}},{once:true});
   return texture;
  }catch(error){bitmap.close();throw error;}
 }

 setFiltering(mode:'linear'|'nearest'){
  this.mode=mode;
  for(const entry of this.entries.values())void entry.ready.then(texture=>{
   if(!entry.abort.signal.aborted)texture.source.scaleMode=this.mode;
  },()=>{});
 }

 dispose(){
  this.dead=true;
  for(const entry of this.entries.values())entry.abort.abort();
  this.entries.clear();
 }
}

export const standaloneTextures=new TexturePool();
