import {realpath,stat,readdir} from 'node:fs/promises';
import {isAbsolute,resolve,relative,join,dirname,basename,sep} from 'node:path';
/** Main-process path capability: canonical roots, including symlink resolution and missing-file parents. */
export class AutomationFileScope {
 private allowed=new Set<string>();
 constructor(private projectPath:()=>string|null){}
 get roots(){return [...this.allowed];}
 revoke(folder:string){this.allowed.delete(folder);}
 async grant(folder:string){const canonical=await realpath(folder);if(!(await stat(canonical)).isDirectory())throw Error('Expected a directory');this.allowed.add(canonical);}
 async list(candidate:unknown,offset=0,limit=50){
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>200)throw Error('Invalid directory page');
  const path=await this.resolve(candidate);if(!(await stat(path)).isDirectory())throw Error('Expected a directory');
  const entries=(await readdir(path,{withFileTypes:true})).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name));
  return{path,total:entries.length,nextOffset:offset+limit<entries.length?offset+limit:null,items:entries.slice(offset,offset+limit).map(entry=>({name:entry.name,path:join(path,entry.name),kind:entry.isDirectory()?'directory':entry.isSymbolicLink()?'symlink':'file'}))};
 }
 async resolve(candidate:unknown,write=false){
  if(typeof candidate!=='string'||!isAbsolute(candidate)||candidate.includes('\0'))throw Error('An absolute file path is required');
  const absolute=resolve(candidate),canonical=await realpath(absolute).catch(async error=>{if(write&&(error as NodeJS.ErrnoException).code==='ENOENT')return join(await realpath(dirname(absolute)),basename(absolute));throw error;});
  const project=this.projectPath(),roots=[...this.allowed,...(project?[await realpath(dirname(project))]:[])];
  if(!roots.some(root=>{const rest=relative(root,canonical);return rest===''||rest!=='..'&&!rest.startsWith('..'+sep)&&!isAbsolute(rest);}))throw Error('Folder access is not granted. Use Settings → MCP server → Allow folder.');
  return canonical;
 }
}
