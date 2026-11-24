import {is2DEntity,spatialType,type Scene} from '@rewrite/scene';
import type {ViewportFeatureHandle} from './viewport-features';
/** Per-viewport async startup gate. Feature projections survive visual rehosts, but never a cancelled startup. */
export class ViewportRuntimeGate{
 private generation=0;private prepared?:{scene:Scene;features:ViewportFeatureHandle[]};private active:ViewportFeatureHandle[]=[];private cancelPreparation?:()=>void;private running=false;private finalWaits=new Set<()=>void>();
 constructor(private features:()=>readonly ViewportFeatureHandle[]){}
 private validate(scene:Scene,features:readonly ViewportFeatureHandle[]){
  for(const e of scene.entities)if(!is2DEntity(e)&&!features.some(f=>f.runtime?.spatialTypes.includes(spatialType(e))))throw Error(`${e.name}: Preview spatial provider unavailable: ${spatialType(e)}`);
  const errors=features.flatMap(f=>f.runtime?.validate?.(scene)??[]);if(errors.length)throw Error(errors.join('\n'));
 }
 async prepare(scene:Scene){
  if(this.running)throw Error('Stop Preview before preparation');
  this.cancelPreparation?.();
  const generation=++this.generation;this.prepared=undefined;
  const features=[...this.features()];this.validate(scene,features);
  let cancel!:()=>void;
  const cancelled=new Promise<never>((_resolve,reject)=>{cancel=()=>reject(Error('Preview preparation cancelled'));});
  this.cancelPreparation=cancel;
  try{
   await Promise.race([Promise.all(features.map(f=>f.runtime?.prepare?.(scene))),cancelled]);
   if(generation!==this.generation||features.some(f=>!this.features().includes(f)))throw Error('Preview preparation cancelled');
   this.prepared={scene,features};
  }finally{if(this.cancelPreparation===cancel)this.cancelPreparation=undefined;}
 }
 enter(scene:Scene){const prepared=this.prepared;if(!prepared||prepared.scene!==scene)throw Error('Prepare this scene before Preview');if(prepared.features.some(f=>!this.features().includes(f)))throw Error('Preview feature removed after preparation');this.validate(scene,prepared.features);this.prepared=undefined;this.running=true;try{for(const f of prepared.features){this.active.push(f);f.runtime?.enter?.();}}catch(error){try{this.exit();}catch{/* Retain startup error. */}throw error;}}
 /** Wait for the actual runtime projection, after runtime-only filtering/template reconciliation. */
 async ready(){
  if(!this.running)throw Error('Preview is not prepared');
  const generation=this.generation,features=[...this.active];let cancel!:()=>void;
  const cancelled=new Promise<never>((_resolve,reject)=>{cancel=()=>reject(Error('Preview readiness cancelled'));});this.finalWaits.add(cancel);
  try{await Promise.race([Promise.all(features.map(f=>f.runtime?.ready?.())),cancelled]);if(!this.running||generation!==this.generation||features.some(f=>!this.features().includes(f)))throw Error('Preview readiness cancelled');}
  finally{this.finalWaits.delete(cancel);}
 }
 exit(){for(const cancel of this.finalWaits)cancel();this.finalWaits.clear();this.cancelPreparation?.();this.cancelPreparation=undefined;this.running=false;this.generation++;this.prepared=undefined;const active=this.active;this.active=[];const errors:unknown[]=[];for(const f of active.reverse())try{f.runtime?.exit?.();}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'Preview feature cleanup');}
}
