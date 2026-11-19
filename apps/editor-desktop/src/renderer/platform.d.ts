export {};
declare global {
 /** The editor's MCP server (main process) as Settings shows it. */
 interface McpStatus {enabled:boolean;port:number;token:string;running:boolean;url:string;error?:string;lastCall?:number;clients:number;configPath:string;stdio:{command:string;args:string[];env:Record<string,string>}}
 interface HubProject {path:string;name:string;openedAt:number;pinned?:boolean;modifiedAt:number|null;exists:boolean;scenes:number;thumbnail:string|null}
 interface HubExample {id:string;title:string;description:string;tags:string[];thumbnail:string|null}
 interface Window { platform: {
  recovery:import('@rewrite/recovery').RecoveryPort;
  build:import('@rewrite/build').BuildPort;
  comfy:import('@rewrite/ai-comfy/contracts').ComfyPort;
  lm:import('@rewrite/ai-lm/contracts').LmPort;
  localhub:import('@rewrite/ai-hub/contracts').HubPort;
  plugins:{list():Promise<{id:string;name:string;version:string;description:string;main:string;enabled:boolean;error?:string}[]>;enable(id:string,value:boolean):Promise<string[]>;reveal():Promise<void>};
  git:{status():Promise<{available:boolean;saved?:boolean;repo?:boolean;folder?:string;root?:string;branch?:string;head?:string|null;changes?:{status:string;file:string}[]}>;init():Promise<boolean>;commit(message:string):Promise<string>;log():Promise<{hash:string;short:string;author:string;date:string;subject:string}[]>;show(hash:string):Promise<string>;restore(hash:string):Promise<{text:string;path:string;warnings:string[]}|null>};
  mcp:{status():Promise<McpStatus>;configure(patch:{enabled?:boolean;port?:number;regenerate?:boolean}):Promise<McpStatus>;onRequest(handler:(request:{id:string;method:'list'|'call'|'rect';name?:string;args?:Record<string,unknown>})=>Promise<unknown>):()=>void};
  strings:{import():Promise<{name:string;folder:string;text:string}[]>;export(files:{name:string;text:string}[]):Promise<string|null>};
  assets:{inspect(text:string,scope:string):Promise<import('@rewrite/assets').AssetHealth[]>;info():Promise<{sessionId:string;workerProcessId:number|null}>;import(id:string,replace?:unknown):Promise<import('@rewrite/assets').AssetRecord[]|null>;importAny():Promise<import('@rewrite/assets').AssetRecord[]|null>;importBytes(bytes:Uint8Array,name:string,extension:string):Promise<import('@rewrite/assets').AssetRecord[]>;drop(files:File[]):Promise<import('@rewrite/assets').AssetRecord[]|null>;cancel():Promise<void>;rebuild(text:string):Promise<string[]>};
  /** Start screen: recent projects and bundled examples (see native-hub.ts). */
  hub:{state():Promise<{showAtStartup:boolean}>;list():Promise<HubProject[]>;examples():Promise<HubExample[]>;open(path:string):Promise<{text:string;path:string;warnings:string[]}|null>;create(id:string):Promise<{text:string;path:string;warnings:string[]}|null>;remove(path:string):Promise<void>;pin(path:string,pinned:boolean):Promise<void>;reveal(path:string):Promise<void>;thumbnail(url:string):Promise<void>};
  open(): Promise<{text:string;path:string;warnings:string[]} | null>; acceptOpen(path:string): Promise<{sessionId?:string;warnings?:string[]}>;
  save(text:string,saveAs?:boolean): Promise<{path:string;warnings:string[]} | null>;
  dirty(value:boolean): Promise<void>; discard(): Promise<{sessionId?:string;warnings?:string[]}|null>; onAction(callback:(name:string)=>void):()=>void;
 } }
}
