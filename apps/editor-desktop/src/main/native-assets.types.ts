import type { AssetRecord,AssetHealth } from '@rewrite/assets';
export interface NativeAssets {
 info():{sessionId:string;workerProcessId:number|null};
 importer(id:string):{extensions:readonly string[]}|undefined;
 importers():readonly {id:string;extensions:readonly string[]}[];
 import(paths:string[],id:string,replace?:unknown):Promise<AssetRecord[]>;
 stageOpen(path:string,project:unknown):Promise<string[]>;
 acceptOpen(path:string):Promise<string>;
 rejectOpen():Promise<void>;
 reset():Promise<string>;
 persist(path:string,project:unknown):Promise<string[]>;
 inspect(project:unknown):Promise<AssetHealth[]>;
 rebuild(project:unknown):Promise<string[]>;
 read(url:string):Promise<Response>;
 cancel():void;
 dispose():Promise<void>;
}
