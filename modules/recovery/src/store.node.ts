import {randomUUID,createHash} from 'node:crypto';
import {mkdir,lstat,readFile,readdir,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import type {RecoveryCopy,RecoveryListing} from './contracts';
const idSchema=z.string().uuid();
const headerSchema=z.object({pid:z.number().int().positive(),active:z.boolean(),name:z.string()});
const metaSchema=z.object({createdAt:z.string(),name:z.string(),sourcePath:z.string().nullable(),savedHash:z.string().nullable(),hash:z.string(),warnings:z.array(z.string())});
const pointerSchema=z.object({current:idSchema,previous:idSchema.optional()});
export const textHash=(text:string)=>createHash('sha256').update(text).digest('hex');
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code==='EPERM';}};
async function realDirectory(path:string){const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Invalid recovery directory');}
async function json(path:string){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size>10*1024*1024)throw Error('Invalid recovery file');return JSON.parse(await readFile(path,'utf8'));}
async function durable(path:string,text:string){const file=await open(path,'wx',0o600);try{await file.writeFile(text);await file.sync();}finally{await file.close();}}
async function atomic(path:string,value:unknown){const tmp=path+'.'+randomUUID()+'.tmp';try{await durable(tmp,JSON.stringify(value));await rename(tmp,path);}finally{await rm(tmp,{force:true});}}
// Flush copied source files before publishing a generation. Never follow symlinks.
async function flushTree(path:string):Promise<void>{for(const e of await readdir(path,{withFileTypes:true})){const target=join(path,e.name);if(e.isSymbolicLink())throw Error('Symlink in recovery copy');if(e.isDirectory())await flushTree(target);else{const file=await open(target,'r+');try{await file.sync();}finally{await file.close();}}}}
export class RecoveryStore {
 private current:string|null=null;
 private claimed:string|null=null;
 constructor(readonly root:string){}
 async init(){await mkdir(this.root,{recursive:true,mode:0o700});await realDirectory(this.root);}
 private dir(id:string){return join(this.root,idSchema.parse(id));}
 private async header(id:string){const dir=this.dir(id);await realDirectory(dir);return headerSchema.parse(await json(join(dir,'owner.json')));}
 async read(id:string){const dir=this.dir(id);await this.header(id);const pointer=pointerSchema.parse(await json(join(dir,'head.json')));
  for(const generation of [pointer.current,pointer.previous]){if(!generation)continue;try{const folder=join(dir,generation);await realDirectory(folder);const meta=metaSchema.parse(await json(join(folder,'meta.json'))),path=join(folder,'project.pixieditor');await json(path);const text=await readFile(path,'utf8');if(textHash(text)!==meta.hash)throw Error('Recovery checksum mismatch');return {id,path,text,meta,generation};}catch{/* Try the previous committed generation. */}}
  throw Error('No intact recovery generation');
 }
 async list(visible:(text:string)=>boolean=()=>true):Promise<RecoveryListing>{const copies:RecoveryCopy[]=[];for(const e of await readdir(this.root,{withFileTypes:true})){if(!e.isDirectory()||!idSchema.safeParse(e.name).success)continue;try{const h=await this.header(e.name);if(h.active&&alive(h.pid))continue;try{await this.assertUnclaimed(e.name);}catch{continue;}const copy=await this.read(e.name);if(!visible(copy.text))continue;copies.push({id:e.name,name:copy.meta.name,createdAt:copy.meta.createdAt,warnings:copy.meta.warnings});}catch{/* Incomplete or damaged copies never prevent opening the editor. */}}
  copies.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));let recent:RecoveryListing['recent']=null;try{const r=z.object({path:z.string(),name:z.string()}).parse(await json(join(this.root,'recent.json')));recent={name:r.name};}catch{/* No recent project. */}return {copies,recent};
 }
 async recentPath(){try{return z.object({path:z.string(),name:z.string()}).parse(await json(join(this.root,'recent.json'))).path;}catch{return null;}}
 async remember(path:string,name:string){await atomic(join(this.root,'recent.json'),{path,name});}
 async checkpoint(text:string,context:{name:string;sourcePath:string|null;savedHash:string|null},persist:(path:string,project:unknown)=>Promise<string[]>){
  if(Buffer.byteLength(text)>10*1024*1024)throw Error('Project exceeds 10 MB');const project=JSON.parse(text);
  if(!this.current){this.current=randomUUID();await mkdir(this.dir(this.current),{mode:0o700});await atomic(join(this.dir(this.current),'owner.json'),{pid:process.pid,active:true,name:context.name});}
  const dir=this.dir(this.current),generation=randomUUID(),stage=join(dir,'.'+generation+'.tmp'),target=join(dir,generation);await mkdir(stage,{mode:0o700});
  try{const warnings=await persist(join(stage,'project.pixieditor'),project);await durable(join(stage,'project.pixieditor'),text);const meta={...context,createdAt:new Date().toISOString(),hash:textHash(text),warnings};await durable(join(stage,'meta.json'),JSON.stringify(meta));await flushTree(stage);await rename(stage,target);
   let previous:string|undefined;try{previous=(await this.read(this.current)).generation;}catch{/* First copy. */}
   await atomic(join(dir,'head.json'),{current:generation,previous});
   for(const e of await readdir(dir,{withFileTypes:true}))if(e.isDirectory()&&idSchema.safeParse(e.name).success&&e.name!==generation&&e.name!==previous)await rm(join(dir,e.name),{recursive:true,force:true});
   if(this.claimed){const restored=this.claimed;await this.release();await this.remove(restored);}
   return {kind:'saved' as const,createdAt:meta.createdAt,warnings};
  }finally{await rm(stage,{recursive:true,force:true});}
 }
 async detach(){if(this.current){const id=this.current;this.current=null;const h=await this.header(id);await atomic(join(this.dir(id),'owner.json'),{...h,active:false});}await this.release();}
 async remove(id:string){const h=await this.header(id);if(h.active&&alive(h.pid))throw Error('Recovery copy is in use');await this.assertUnclaimed(id);await rm(this.dir(id),{recursive:true,force:true});}
 private async assertUnclaimed(id:string){try{const claim=z.object({pid:z.number().int().positive()}).parse(await json(join(this.dir(id),'claim.json')));if(alive(claim.pid))throw Error('Recovery copy is in use');}catch(error){if(error instanceof Error&&error.message==='Recovery copy is in use')throw error;}}
 async claim(id:string){const h=await this.header(id);if(h.active&&alive(h.pid))throw Error('Recovery copy is in use');await this.assertUnclaimed(id);const path=join(this.dir(id),'claim.json');await rm(path,{force:true});await durable(path,JSON.stringify({pid:process.pid}));this.claimed=id;try{return await this.read(id);}catch(error){await this.release();throw error;}}
 async release(){if(this.claimed){await rm(join(this.dir(this.claimed),'claim.json'),{force:true});this.claimed=null;}}
 async clear(){if(this.current){await rm(this.dir(this.current),{recursive:true,force:true});this.current=null;}if(this.claimed){const id=this.claimed;await this.release();await this.remove(id);}}
}
