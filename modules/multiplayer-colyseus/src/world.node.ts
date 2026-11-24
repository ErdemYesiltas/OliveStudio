import {RuntimeSession,type RuntimeEntity} from '@rewrite/runtime';
import {SceneSchema,spawnCopy,type Entity} from '@rewrite/scene';
import {PhysicsSession,PhysicsSettingsSchema,defaultPhysicsSettings} from '@rewrite/physics';
import {matterProvider} from '@rewrite/physics-matter';
import {ScriptSession,loadScriptEngine} from '@rewrite/scripts/session';
import {xstateBehaviorExtension,behaviorControls} from '@rewrite/behavior-xstate';
import {NetworkEntitySchema,networkEntityType,projectEntity,type ServerWorld,type ReplicatedEntity} from '@rewrite/multiplayer/contracts';

/** A DOM-free room world. Only server code changes it; clients may request explicitly allowlisted behavior events. */
export async function createServerWorld(definition:ServerWorld,bounds:{width:number;height:number}){
 const engine=await loadScriptEngine(),scene=SceneSchema.parse(definition.scene);
 const diagnostics:string[]=[],emitQueue:Parameters<ScriptSession['observe']>[0][]=[];
 let scripts:ScriptSession|undefined,physics:PhysicsSession|undefined,runtime:RuntimeSession|undefined;
 const note=(message:string)=>{diagnostics.push(message);if(diagnostics.length>20)diagnostics.shift();};
 runtime=new RuntimeSession(scene.entities as unknown as RuntimeEntity[],world=>{
  const entities=()=>world.entities as unknown as Entity[];
  physics=new PhysicsSession(entities,PhysicsSettingsSchema.parse(definition.physics??defaultPhysicsSettings),matterProvider,{bounds:()=>bounds,event:e=>{for(const [id,other]of[[e.a,e.b],[e.b,e.a]])emitQueue.push({type:`physics.${e.phase}`,sourceId:id,event:other,silent:true,...(e.contact?{data:e.contact}:{})});}});
  scripts=new ScriptSession(engine,definition.scripts,{entities,time:()=>runtime?.time??0,stage:bounds,names:{globals:[],scenes:[{id:scene.id,name:scene.name}],actions:definition.actions},extensions:[xstateBehaviorExtension],physics:physics.controls,
   setActive:(id,v)=>{const e=entities().find(x=>x.id===id);if(e)e.active=v;},changeScene:()=>{throw Error('Room scene changes require a new room');},invoke:()=>{throw Error('Presentation services are unavailable on the server');},
   destroy:id=>{runtime?.despawn([id]);},spawn:(name,x,y)=>{const all=entities(),source=all.find(e=>e.name===name);if(!source)throw Error('Unknown server template');const copy=spawnCopy(all,source.id,()=>[],{x,y});runtime!.spawn(copy as unknown as RuntimeEntity[]);return copy[0].id;},
   emit:e=>emitQueue.push({...e,silent:true}),log:(level,message)=>{if(level!=='info')note(message);}},note);
  return [physics.system,scripts.system,{id:'server.events',update(){let budget=512;while(emitQueue.length&&--budget>0)scripts?.observe(emitQueue.shift()!);if(emitQueue.length){emitQueue.length=0;note('Server event budget exceeded');}},dispose(){emitQueue.length=0;}}];
 });
 if(physics!.errors.length){runtime.dispose();throw Error(physics!.errors.join('; '));}
 // Initialize machines before a newly joined client can submit its first event.
 runtime.advance(0);
 const controls=behaviorControls(()=>scripts);
 return {
  advance(dt:number){runtime!.advance(dt);},
  snapshot():ReplicatedEntity[]{return(runtime!.world.entities as unknown as Entity[]).filter(e=>e.components.some(c=>c.type===networkEntityType)).map(e=>projectEntity(e,controls.inspect(e.id)[0]?.states));},
  send(id:string,event:{type:string;[key:string]:unknown},clientSession:string){
   const e=(runtime!.world.entities as unknown as Entity[]).find(e=>e.id===id);if(!e)throw Error('Unknown server entity');
   const def=NetworkEntitySchema.parse(e.components.find(c=>c.type===networkEntityType)?.data);
   if(!def.events.includes(event.type))throw Error('Event is not allowed for this entity');
   controls.send(id,{...event,clientSession});
  },
  diagnostics:()=>[...diagnostics,...physics!.errors],
  dispose(){runtime?.dispose();runtime=undefined;scripts=undefined;},
 };
}
