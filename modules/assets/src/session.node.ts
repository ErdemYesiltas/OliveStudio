import { mkdir,mkdtemp,readFile,readdir,writeFile,rename,rm,lstat,realpath } from 'node:fs/promises';
import { join,relative,basename,extname,dirname } from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import { createHash,randomUUID } from 'node:crypto';
import { AssetSchema,RegistrySchema,sectionKey,importFileLimit,importLimitMessage,type AssetRecord,type AssetHealth } from './contracts';
export interface PreparedSource{name:string;extension:string;bytes:Uint8Array}
export interface NativeImporter {id:string;assetType:string;extensions:readonly string[];prepare?(path:string,signal:AbortSignal):Promise<PreparedSource>}
export interface BuildJob { root:string; importerId:string; asset:AssetRecord }
export interface BuildResult {metadata:AssetRecord['metadata'];files:{name:string;mime:string}[]}
export type AssetBuilder=(job:BuildJob,signal:AbortSignal)=>Promise<BuildResult>;
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export const sourceName=(a:AssetRecord)=>`${a.id}-${a.revision}.${a.source.extension}`;
export const cacheKey=(a:AssetRecord)=>`${a.id}-${a.revision}`;
export function projectAssets(input:unknown):AssetRecord[]{
 if(!input||typeof input!=='object'||!('extensions'in input))return[];
 const extensions=input.extensions;if(!extensions||typeof extensions!=='object'||!(sectionKey in extensions))return[];
 return RegistrySchema.parse((extensions as Record<string,unknown>)[sectionKey]).items;
}
async function directory(path:string):Promise<string>{
 try{const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Asset directories must be real directories');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await mkdir(path,{recursive:true});}
 return realpath(path);
}
async function sourceBytes(root:string,a:AssetRecord):Promise<Buffer>{
 for(const dir of [root,dirname(root)]){const info=await lstat(dir);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Asset source directories cannot be symbolic links');}
 const path=join(root,sourceName(a)),stat=await lstat(path);
 if(stat.isSymbolicLink()||!stat.isFile()||stat.size!==a.source.bytes)throw Error(`Invalid source: ${a.name}`);
 const resolved=await realpath(path),base=await realpath(root),rel=relative(base,resolved);
 if(rel.startsWith('..')||rel.startsWith('/'))throw Error('Asset source escapes its directory');
 const bytes=await readFile(resolved);if(hash(bytes)!==a.revision)throw Error(`Source checksum mismatch: ${a.name}`);return bytes;
}
async function atomic(root:string,name:string,bytes:Uint8Array){
 const destination=join(root,name),temporary=join(root,`.${randomUUID()}.tmp`);
 try{const stat=await lstat(destination);if(stat.isSymbolicLink()||!stat.isFile())throw Error('Refusing to overwrite a non-regular asset file');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 try{await writeFile(temporary,bytes,{flag:'wx',mode:0o600});await rename(temporary,destination);}finally{await rm(temporary,{force:true});}
}
export class AssetSession {
 readonly id=randomUUID();
 private records=new Map<string,AssetRecord>();
 private built=new Map<string,BuildResult>();
 private abort=new AbortController();
 private disposed=false;
 readonly warnings:string[]=[];
 private constructor(readonly root:string,private importers:readonly NativeImporter[],private build:AssetBuilder){}
 static async create(parent:string,importers:readonly NativeImporter[],build:AssetBuilder){await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'session-'));await writeFile(join(root,'owner.json'),JSON.stringify({pid:process.pid,started:Date.now()}));await directory(join(root,'sources'));await directory(join(root,'cache'));return new AssetSession(root,importers,build);}
 private assertLive(signal?:AbortSignal){if(this.disposed||signal?.aborted)throw Error('Asset operation cancelled');}
 async importFiles(paths:readonly string[],importerId:string,replace?:unknown):Promise<AssetRecord[]>{
  const signal=this.abort.signal;this.assertLive(signal);const importer=this.importers.find(i=>i.id===importerId);if(!importer)throw Error('Unsupported importer');
  if(!paths.length||paths.length>importFileLimit)throw Error(importLimitMessage(paths.length));
  // Every source is checked before the first one is processed, so a refused request leaves nothing behind.
  for(const path of paths){const extension=extname(path).slice(1).toLowerCase();if(!importer.extensions.includes(extension))throw Error('Unsupported source extension');const stat=await lstat(path);if(!stat.isFile()||stat.size<1||stat.size>20*1024*1024)throw Error('Assets must be regular files between 1 byte and 20 MB');}
  const previous=replace===undefined?undefined:AssetSchema.parse(replace);
  if(previous&&(!this.records.has(cacheKey(previous))||paths.length!==1||previous.type!==importer.assetType))throw Error('Reimport target is not in this session');
  const result:AssetRecord[]=[];
  for(const path of paths){
   this.assertLive(signal);const extension=extname(path).slice(1).toLowerCase();if(!importer.extensions.includes(extension))throw Error('Unsupported source extension');
   const stat=await lstat(path);if(!stat.isFile()||stat.size<1||stat.size>20*1024*1024)throw Error('Assets must be regular files between 1 byte and 20 MB');
   const prepared=importer.prepare?await importer.prepare(path,signal):undefined;this.assertLive(signal);const bytes=prepared?Buffer.from(prepared.bytes):await readFile(path);if(!prepared&&bytes.length!==stat.size)throw Error('Source changed during import');if(bytes.length>20*1024*1024)throw Error('Prepared source exceeds 20 MB');
   const asset=AssetSchema.parse({id:previous?.id??randomUUID(),name:previous?.name??prepared?.name??basename(path,extname(path)).slice(0,120),type:importer.assetType,revision:hash(bytes),source:{extension:prepared?.extension??extension,bytes:bytes.length},metadata:{}});
   await atomic(join(this.root,'sources'),sourceName(asset),bytes);
   const built=await this.build({root:this.root,importerId,asset},signal);this.assertLive(signal);
   const complete=AssetSchema.parse({...asset,metadata:built.metadata});this.records.set(cacheKey(complete),complete);this.built.set(cacheKey(complete),built);result.push(complete);
  }
  return result;
 }
 /** A lease owned by the native import transaction. Rollback removes only newly staged sources/cache entries. */
 async importLease(){
  const keys=new Set(this.records.keys()),sources=new Set(await readdir(join(this.root,'sources'))),cache=new Set(await readdir(join(this.root,'cache')));
  let done=false;
  return async()=>{if(done)return;done=true;if(this.disposed)return;
   for(const key of this.records.keys())if(!keys.has(key)){this.records.delete(key);this.built.delete(key);}
   for(const [folder,known]of [['sources',sources],['cache',cache]] as const)for(const name of await readdir(join(this.root,folder)))if(!known.has(name))await rm(join(this.root,folder,name),{recursive:true,force:true});
  };
 }
 async restore(projectPath:string,input:unknown):Promise<void>{
  const signal=this.abort.signal;this.assertLive(signal);const records=projectAssets(input),sourceRoot=join(projectPath+'.assets','sources');
  for(const asset of records){
   this.records.set(cacheKey(asset),asset);
   try{
    const bytes=await sourceBytes(sourceRoot,asset);this.assertLive(signal);await atomic(join(this.root,'sources'),sourceName(asset),bytes);
    const importer=this.importers.find(i=>i.assetType===asset.type);
    if(importer){const built=await this.build({root:this.root,importerId:importer.id,asset},signal);this.assertLive(signal);this.built.set(cacheKey(asset),built);}
   }catch(error){this.assertLive(signal);this.warnings.push(`${asset.name}: ${String(error)}`);}
  }
 }
 async persist(projectPath:string,input:unknown):Promise<string[]>{
  const signal=this.abort.signal;this.assertLive(signal);const records=projectAssets(input);if(!records.length)return[];
  const sidecar=await directory(projectPath+'.assets'),sources=await directory(join(sidecar,'sources')),warnings:string[]=[];
  for(const asset of records){
   this.assertLive(signal);if(!this.records.has(cacheKey(asset)))throw Error(`Asset was not imported or opened: ${asset.name}`);
   let bytes:Buffer;
   try{bytes=await sourceBytes(join(this.root,'sources'),asset);}catch(error){warnings.push(`${asset.name}: source is missing or corrupt (${String(error)})`);continue;}
   await atomic(sources,sourceName(asset),bytes);
  }
  return warnings;
 }
 private async cachedFile(id:string,revision:string,file:string):Promise<{path:string;mime:string}|null>{
  this.assertLive();const key=`${id}-${revision}`,entry=this.built.get(key),output=entry?.files.find(f=>f.name===file);
  if(!output||!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(file))return null;
  try{const base=join(this.root,'cache'),folder=join(base,key),path=join(folder,file);for(const dir of [base,folder]){const stat=await lstat(dir);if(stat.isSymbolicLink()||!stat.isDirectory())return null;}const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isFile()||stat.size===0)return null;return{path,mime:output.mime};}catch{return null;}
 }
 async read(id:string,revision:string,file:string):Promise<{bytes:Buffer;mime:string}|null>{const output=await this.cachedFile(id,revision,file);if(!output)return null;try{return {bytes:await readFile(output.path),mime:output.mime};}catch{return null;}}
 /** Read-only verification of the current document's captured revision, not arbitrary disk paths. */
 async inspect(input:unknown):Promise<AssetHealth[]>{
  const signal=this.abort.signal;this.assertLive(signal);const results:AssetHealth[]=[];
  for(const asset of projectAssets(input)){
   this.assertLive(signal);const result:AssetHealth={assetId:asset.id,revision:asset.revision,source:'ready',cache:'ready'},key=cacheKey(asset),built=this.built.get(key);
   if(!this.records.has(key))result.source='unavailable';
   else try{await sourceBytes(join(this.root,'sources'),asset);}catch(error){result.source=(error as NodeJS.ErrnoException).code==='ENOENT'?'missing':'corrupt';}
   this.assertLive(signal);
   if(!this.importers.some(i=>i.assetType===asset.type))result.cache='unsupported';
   else if(!built)result.cache='missing';
   else{for(const file of built.files){if(!await this.cachedFile(asset.id,asset.revision,file.name)){result.cache='missing';break;}this.assertLive(signal);}if(result.cache==='ready'&&!isDeepStrictEqual(built.metadata,asset.metadata))result.cache='outdated';}
   results.push(result);
  }
  return results;
 }
 async rebuild(input:unknown):Promise<string[]>{
  const signal=this.abort.signal;this.assertLive(signal);const warnings:string[]=[];
  for(const asset of projectAssets(input)){
   const importer=this.importers.find(i=>i.assetType===asset.type);if(!importer)continue;
   try{await sourceBytes(join(this.root,'sources'),asset);const built=await this.build({root:this.root,importerId:importer.id,asset},signal);this.assertLive(signal);this.built.set(cacheKey(asset),built);}catch(error){this.assertLive(signal);warnings.push(`${asset.name}: ${String(error)}`);}
  }
  return warnings;
 }
 cancel(){this.abort.abort();this.abort=new AbortController();}
 async dispose(){if(this.disposed)return;this.disposed=true;this.abort.abort();await rm(this.root,{recursive:true,force:true,maxRetries:3});}
}

/** Whether a process still runs (EPERM: it runs under another user). */
const processAlive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code==='EPERM';}};
/**
 * Removes asset sessions left behind by editors that ended without cleaning up (crashes, force quits, killed test
 * runs): a session whose owner process is gone, or one without an owner record (older builds) untouched for a week.
 * Sessions of running editors are kept. Returns how many were removed.
 */
export async function sweepSessions(parent:string,options:{alive?:(pid:number)=>boolean;now?:number;legacyAgeMs?:number}={}):Promise<number>{
 const alive=options.alive??processAlive,now=options.now??Date.now(),legacyAge=options.legacyAgeMs??7*24*60*60*1000;let removed=0,names:string[];
 try{names=await readdir(parent);}catch{return 0;}
 for(const name of names){
  if(!/^session-[A-Za-z0-9]+$/.test(name))continue;const dir=join(parent,name);
  try{
   const info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())continue;
   let owner:{pid?:unknown}|undefined;try{owner=JSON.parse(await readFile(join(dir,'owner.json'),'utf8'));}catch{owner=undefined;}
   const pid=typeof owner?.pid==='number'&&Number.isInteger(owner.pid)&&owner.pid>0?owner.pid:undefined;
   const stale=pid!==undefined?pid!==process.pid&&!alive(pid):now-info.mtimeMs>legacyAge;
   if(stale){await rm(dir,{recursive:true,force:true,maxRetries:3});removed++;}
  }catch{/* another editor may be removing it at the same time */}
 }
 return removed;
}
export {importFileLimit,importLimitMessage} from './contracts';
export {BundleManifestSchema,stem} from './bundle';
