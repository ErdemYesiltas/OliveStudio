import {RecoveryStore,textHash} from '@rewrite/recovery/node';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {NativeAssets} from './native-assets.types';
/** Coordinates document scopes and durable copies; accepts no renderer-controlled file paths. */
export class NativeRecovery {
 private boot:string|null=null;private interrupted=false;private pending:{ticket:string;path:string;sourcePath:string|null;savedHash:string|null;warnings:string[]}|null=null;
 private checkpointWork:Promise<unknown>|null=null;
 private savedHash:string|null=null;
 constructor(readonly store:RecoveryStore,private bridge:{assets():NativeAssets|null;path():string|null;setPath(value:string|null):void;dirty():boolean;resetDirty():void;confirm():Promise<boolean>;busy():boolean}){}
 async wait(){await this.checkpointWork?.catch(()=>{});}
 async bootstrap(nonce:unknown){if(typeof nonce!=='string'||nonce.length>100)throw Error('Invalid renderer boot');if(this.boot&&this.boot!==nonce){await this.wait();if(this.bridge.dirty()||this.interrupted)await this.store.detach();else await this.store.clear();await this.rejectPending();await this.bridge.assets()?.reset();this.bridge.setPath(null);this.savedHash=null;this.bridge.resetDirty();}this.boot=nonce;this.interrupted=false;return this.store.list();}
 crash(){this.interrupted=true;}
 async checkpoint(text:unknown,scope:unknown){const assets=this.bridge.assets();if(!assets||this.bridge.busy()||this.checkpointWork)return {kind:'busy' as const};if(typeof text!=='string'||Buffer.byteLength(text)>10*1024*1024||scope!==assets.info().sessionId)throw Error('Stale recovery request');if(!this.bridge.dirty())return {kind:'busy' as const};const parsed=JSON.parse(text);if(!parsed||typeof parsed.name!=='string'||parsed.formatVersion!==1||!Array.isArray(parsed.scenes))throw Error('Invalid project');
  const work=this.store.checkpoint(text,{name:parsed.name,sourcePath:this.bridge.path(),savedHash:this.savedHash},(path,project)=>assets.persist(path,project));this.checkpointWork=work;try{return await work;}finally{if(this.checkpointWork===work)this.checkpointWork=null;}
 }
 async saved(path:string,text:string){this.savedHash=textHash(text);await this.store.remember(path,JSON.parse(text).name);await this.store.clear();}
 async opened(path:string,text:string){this.savedHash=textHash(text);await this.store.clear();await this.store.remember(path,JSON.parse(text).name);}
 async discarded(){this.savedHash=null;await this.store.clear();await this.rejectPending();}
 async prepare(id:unknown){if(typeof id!=='string')throw Error('Invalid recovery ID');if(!await this.bridge.confirm())return null;await this.rejectPending();await this.store.release();const copy=await this.store.claim(id);try{const warnings=await this.bridge.assets()?.stageOpen(copy.path,JSON.parse(copy.text))??[];this.pending={ticket:randomUUID(),path:copy.path,sourcePath:copy.meta.sourcePath,savedHash:copy.meta.savedHash,warnings:[...copy.meta.warnings,...warnings]};return {ticket:this.pending.ticket,text:copy.text,warnings:this.pending.warnings};}catch(error){await this.store.release();throw error;}}
 async accept(ticket:unknown){const p=this.pending,assets=this.bridge.assets();if(!p||p.ticket!==ticket||!assets)throw Error('Invalid recovery ticket');let source=p.sourcePath;const warnings=[...p.warnings];if(source){let matches=false;try{matches=p.savedHash!==null&&textHash(await readFile(source,'utf8'))===p.savedHash;}catch{/* Missing original. */}if(!matches){source=null;warnings.push('The original project changed or is missing. Save As will be used.');}}
  const sessionId=await assets.acceptOpen(p.path);this.pending=null;this.bridge.setPath(source);this.savedHash=source?p.savedHash:null;return {sessionId,warnings};
 }
 async reject(ticket:unknown){if(this.pending?.ticket!==ticket)throw Error('Invalid recovery ticket');await this.rejectPending();}
 private async rejectPending(){if(this.pending){await this.bridge.assets()?.rejectOpen();this.pending=null;await this.store.release();}}
 async close(discarded:boolean){await this.wait();await this.rejectPending();if(discarded&&!this.interrupted)await this.store.clear();else await this.store.detach();}
}
