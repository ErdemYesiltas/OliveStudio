import {BrowserWindow} from 'electron';
import {createServer,type Server} from 'node:http';
import {readFile,mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Json} from '@rewrite/sdk';

/** Separate, sandboxed renderer processes with ephemeral storage; no editor preload or IPC capabilities. */
export class PreviewClients {
 private windows=new Map<number,BrowserWindow>();private folder='';private http:Server|null=null;
 constructor(private build:(folder:string,project:Json)=>Promise<{output:string}>){ }
 list(){return [...this.windows].map(([id,w])=>({id,title:w.getTitle()}));}
 async close(){for(const w of this.windows.values())w.destroy();this.windows.clear();const server=this.http;this.http=null;if(server)await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});if(this.folder){await rm(this.folder,{recursive:true,force:true});this.folder='';}return this.list();}
 async open(project:Json,count:number){
  if(!Number.isInteger(count)||count<1||count>4)throw Error('Open 1 to 4 preview clients');
  await this.close();this.folder=await mkdtemp(join(tmpdir(),'olive-clients-'));
  try{
   const {output}=await this.build(this.folder,project),root=await realpath(output);
   const server=this.http=createServer((req,res)=>{void(async()=>{try{if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}const url=new URL(req.url??'/','http://localhost'),file=await realpath(join(root,decodeURIComponent(url.pathname)==='/'?'index.html':decodeURIComponent(url.pathname))),rest=relative(root,file);if(isAbsolute(rest)||rest==='..'||rest.startsWith('../')){res.writeHead(403).end();return;}const bytes=await readFile(file);const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css','.webp':'image/webp','.png':'image/png','.wav':'audio/wav','.mp3':'audio/mpeg'};res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(404).end();}})();});
   await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   const port=(server.address() as {port:number}).port;
   for(let i=0;i<count;i++){
    const window=new BrowserWindow({title:`Multiplayer client ${i+1}`,width:960,height:640,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,partition:`olive-preview-${randomUUID()}`}});
    this.windows.set(window.id,window);window.on('closed',()=>this.windows.delete(window.id));
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    const origin=`http://127.0.0.1:${port}`;window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/'))event.preventDefault();});
    await window.loadURL(`${origin}/?name=Client${i+1}`);
   }
   return this.list();
  }catch(error){await this.close();throw error;}
 }
}
