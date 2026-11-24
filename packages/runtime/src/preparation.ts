import type {RuntimeEntity,RuntimeSession} from './index';
export interface SpawnPreparationPorts{
 prepare(candidate:readonly RuntimeEntity[]):Promise<void>;
 committed(key:string,ids:readonly string[]):void;
 rollback(ids:readonly string[]):void;
 sync():void;
 report(error:unknown):void;
 changed?(active:boolean):void;
}
/** Serial resource preparation for additive scenes. The session publishes a candidate only after ready.
 * Hosts own temporary projection resources; cancel/failed loads restore the committed world.
 */
export class RuntimeSpawnQueue{
 private pending=new Map<string,AbortController>();private tail=Promise.resolve();private dead=false;
 active=false;
 constructor(private session:RuntimeSession,private ports:SpawnPreparationPorts){}
 get pendingKeys(){return[...this.pending.keys()];}
 enqueue(key:string,input:readonly RuntimeEntity[]){
  if(this.dead)throw Error('Runtime preparation queue disposed');if(this.pending.has(key))return;
  const copy=structuredClone(input),controller=new AbortController();this.pending.set(key,controller);
  this.tail=this.tail.then(async()=>{
   if(this.dead||controller.signal.aborted)return;
   this.active=true;
   try{this.ports.changed?.(true);
    const ids=await this.session.stageSpawn(copy,candidate=>this.ports.prepare(candidate),controller.signal);
    if(!this.dead)this.ports.committed(key,ids);
   }catch(error){
    if(!this.dead){try{this.ports.rollback(copy.map(e=>e.id));}catch(rollback){error=new AggregateError([error,rollback],'Runtime preparation rollback failed');}if(!controller.signal.aborted)this.ports.report(error);}
   }finally{
    this.active=false;if(this.pending.get(key)===controller)this.pending.delete(key);
    if(!this.dead){this.ports.changed?.(false);this.ports.sync();}
   }
  }).catch(error=>{if(!this.dead)this.ports.report(error);}).finally(()=>{if(this.pending.get(key)===controller)this.pending.delete(key);});
 }
 cancel(key:string){const controller=this.pending.get(key);if(!controller)return false;controller.abort();return true;}
 idle(){return this.tail;}
 dispose(){if(this.dead)return;this.dead=true;for(const controller of this.pending.values())controller.abort();this.pending.clear();this.active=false;}
}
