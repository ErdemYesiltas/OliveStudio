import {z} from 'zod';
import {registerAssetAutomation} from './automation';
import { token,type EditorModule,type Json } from '@rewrite/sdk';
import { projectToken,projectSections,type ProjectService,type Project } from '@rewrite/project';
import { AssetSchema,AssetHealthSchema,RegistrySchema,sectionKey,assetUrl,type AssetRecord,type AssetHealth,type AssetPort } from './contracts';
import { SheetsSchema,sheetsSection } from './bundle';
import { LibrarySchema,emptyLibrary,librarySection,pruneLibrary,type Library } from './library';
export * from './library';
export * from './contracts';
export {inspectAssetReferences,type AssetReferenceIssue,type AssetReferenceScope} from './references';
export function registry(project:ProjectService):AssetRecord[]{const value=project.document.current.extensions[sectionKey];return value?RegistrySchema.parse(value).items:[];}
export class AssetService {
 busy=false;
 private disposed=false;
 private inspection:{input:unknown;generation:number;sessionId:string;results:ReadonlyMap<string,AssetHealth>}|null=null;
 get health():ReadonlyMap<string,AssetHealth>{const i=this.inspection;return i&&i.input===this.project.document.current.extensions[sectionKey]&&i.generation===this.project.generation&&i.sessionId===this.port.sessionId?i.results:new Map();}
 async rebuild(){
  if(this.disposed||!this.port.rebuild)throw Error('Asset rebuild is unavailable');if(this.busy)throw Error('An asset operation is already running');
  this.busy=true;this.changed();try{return await this.port.rebuild(JSON.stringify(this.project.document.current));}finally{this.inspection=null;this.busy=false;this.changed();}
 }
 async inspect(){
  if(this.disposed||!this.port.inspect)throw Error('Asset inspection is unavailable');if(this.busy)throw Error('An asset operation is already running');
  const input=this.project.document.current.extensions[sectionKey],generation=this.project.generation,sessionId=this.port.sessionId,snapshot=this.project.document.current;
  this.busy=true;this.changed();try{const results=(await this.port.inspect(JSON.stringify(snapshot),sessionId)).map(v=>AssetHealthSchema.parse(v));if(this.disposed||this.project.generation!==generation||this.port.sessionId!==sessionId||this.project.document.current.extensions[sectionKey]!==input)return;this.inspection={input,generation,sessionId,results:new Map(results.map(result=>[result.assetId,result]))};}finally{this.busy=false;this.changed();}
 }

 async dispose(){this.disposed=true;await this.port.cancel();}
 private listeners=new Set<()=>void>();
 constructor(readonly project:ProjectService,readonly port:AssetPort){}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private changed(){for(const fn of this.listeners)fn();}
 private cachedInput:unknown;
 private cachedItems:AssetRecord[]=[];
 private cachedMap=new Map<string,AssetRecord>();
 get items(){const input=this.project.document.current.extensions[sectionKey];if(input!==this.cachedInput){this.cachedInput=input;this.cachedItems=registry(this.project);this.cachedMap=new Map(this.cachedItems.map(a=>[a.id,a]));}return this.cachedItems;}
 get(id:string){void this.items;return this.cachedMap.get(id);}
 url(asset:AssetRecord,file='image.webp'){return assetUrl(this.port.sessionId,asset,file);}
 async import(importerId:string,replaceId?:string,request?:()=>Promise<AssetRecord[]|null>,alsoApply?:(draft:import('@rewrite/project').Project,assets:readonly AssetRecord[])=>void){
  if(this.disposed)throw Error('Asset service is closed');if(this.busy)throw Error('An asset operation is already running');
  const generation=this.project.generation,previous=replaceId?this.get(replaceId):undefined;
  if(replaceId&&!previous)throw Error('Asset no longer exists');
  this.busy=true;this.changed();
  try{
   const result=request?await request():importerId==='*'?await this.port.importAny?.()??null:await this.port.import(importerId,previous);if(!result)return;
   if(this.disposed||this.project.generation!==generation)throw Error('Project changed while importing');
   const assets=result.map(a=>AssetSchema.parse(a));
   if(previous&&(assets.length!==1||assets[0].id!==previous.id||this.get(previous.id)?.revision!==previous.revision))throw Error('Reimport target changed');
   this.project.document.transact(previous?'Reimport asset':'Import assets',draft=>{
    const value=RegistrySchema.parse(draft.extensions[sectionKey]??{version:1,items:[]});
    for(const asset of assets){const index=value.items.findIndex(a=>a.id===asset.id);if(index>=0)value.items[index]=asset;else value.items.push(asset);}
    draft.extensions[sectionKey]=value as Json;
    alsoApply?.(draft,assets);
   });
  }finally{this.busy=false;this.changed();}
 }
 /** Registers records imported outside the dialog (e.g. generated images); `extra` edits the project in the same undo step. */
 adopt(records:readonly unknown[],label:string,extra?:(draft:Project)=>void){
  if(this.disposed)throw Error('Asset service is closed');const assets=records.map(a=>AssetSchema.parse(a));if(!assets.length)return[];
  this.project.document.transact(label,draft=>{const value=RegistrySchema.parse(draft.extensions[sectionKey]??{version:1,items:[]});for(const asset of assets){const index=value.items.findIndex(a=>a.id===asset.id);if(index>=0)value.items[index]=asset;else value.items.push(asset);}draft.extensions[sectionKey]=value as Json;extra?.(draft);});
  return assets;
 }
 /** Library folders, tags and the generated inbox (editor-only). */
 private cachedLibraryInput:unknown;private cachedLibrary:Library=emptyLibrary();
 get library():Library{const input=this.project.document.current.extensions[librarySection];if(input!==this.cachedLibraryInput){this.cachedLibraryInput=input;this.cachedLibrary=input?LibrarySchema.parse(input):emptyLibrary();}return this.cachedLibrary;}
 /** One undo step: `edit` returns the next library (validated). */
 editLibrary(label:string,edit:(library:Library)=>Library){this.project.document.transact(label,draft=>{const current=draft.extensions[librarySection]?LibrarySchema.parse(draft.extensions[librarySection]):emptyLibrary();draft.extensions[librarySection]=LibrarySchema.parse(edit(current)) as unknown as Json;});}
 /** Removes assets from the project (and their Library entries) in one undo step. Objects that used them show missing references. */
 remove(ids:readonly string[]){
  if(this.disposed)throw Error('Asset service is closed');if(this.busy)throw Error('An asset operation is already running');if(!ids.length)return;
  this.project.document.transact(ids.length===1?'Delete asset':`Delete ${ids.length} assets`,draft=>{const value=RegistrySchema.parse(draft.extensions[sectionKey]??{version:1,items:[]}),gone=new Set(ids);value.items=value.items.filter(a=>!gone.has(a.id));draft.extensions[sectionKey]=value as Json;if(draft.extensions[librarySection])draft.extensions[librarySection]=pruneLibrary(LibrarySchema.parse(draft.extensions[librarySection]),new Set(value.items.map(a=>a.id))) as unknown as Json;});
 }
 rename(id:string,name:string){this.project.document.transact('Rename asset',draft=>{const value=RegistrySchema.parse(draft.extensions[sectionKey]);const asset=value.items.find(a=>a.id===id);if(!asset)throw Error('Asset missing');asset.name=AssetSchema.shape.name.parse(name);draft.extensions[sectionKey]=value as Json;});}
}
export const assetToken=token<AssetService>('assets','assets.registry');
export function assetsModule(port:AssetPort):EditorModule{return{manifest:{id:'assets',version:'1.0.0',apiVersion:1,requires:{project:'^1'}},activate(c){c.contribute(projectSections,'assets.registry',{key:sectionKey,get dataSchema(){return z.toJSONSchema(RegistrySchema,{unrepresentable:'any'});},parse:v=>RegistrySchema.parse(v) as Json});c.contribute(projectSections,'assets.sheets',{key:sheetsSection,get dataSchema(){return z.toJSONSchema(SheetsSchema);},parse:v=>SheetsSchema.parse(v) as Json});c.contribute(projectSections,'assets.library',{key:librarySection,get dataSchema(){return z.toJSONSchema(LibrarySchema,{unrepresentable:'any'});},parse:v=>LibrarySchema.parse(v) as unknown as Json});const service=new AssetService(c.get(projectToken),port);c.provide(assetToken,service);registerAssetAutomation(c,service);c.own(()=>service.dispose());}};}
export * from './bundle';
