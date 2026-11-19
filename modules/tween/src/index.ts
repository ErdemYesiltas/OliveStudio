import {components,propertyKey,type ComponentDefinition,type EditorModule,type Json,type RuntimeSystem} from '@rewrite/sdk';
import type {Entity} from '@rewrite/scene';
import {TweenSchema,totalDuration,tweenChannels,type TweenData,type TweenChannel,type TweenProvider,type TweenSampler} from './contracts';
export * from './contracts';
export const tweenDefinition:ComponentDefinition={type:'tween.player',version:1,titleKey:'component.tween',defaults:()=>({duration:1,delay:0,ease:'linear',repeat:0,yoyo:false,autoplay:true,tracks:[]}),parse:v=>TweenSchema.parse(v),fields:[...['duration','delay','repeat'].map(key=>({key,titleKey:`tween.${key}`,kind:'number'as const})),...['yoyo','autoplay'].map(key=>({key,titleKey:`tween.${key}`,kind:'boolean'as const}))],remapReferences(value,ids){const v=TweenSchema.parse(value);v.tracks=v.tracks.map(t=>({...t,id:ids.preserveLocalIds?t.id:crypto.randomUUID(),entityId:ids.entities.get(t.entityId)??t.entityId,componentId:ids.components.get(t.componentId)??t.componentId}));return v as Json;}};
export const tweenModule:EditorModule={manifest:{id:'tween',version:'1.0.0',apiVersion:1,requires:{scene:'^1'},entries:{runtime:'@rewrite/tween'}},activate(c){c.contribute(components,'tween.player',tweenDefinition);for(const property of ['x','y','rotation','scaleX','scaleY','skewX','skewY'])c.contribute(tweenChannels,`tween.transform.${property}`,{componentType:'scene.transform2d',version:1,property,titleKey:`field.${property}`,...(property.startsWith('scale')?{min:-100,max:100,nonZero:true}:property.startsWith('skew')?{min:-89,max:89,defaultValue:0}:{})});}};
export function channelValue(channel:TweenChannel,value:unknown):number{const result=value===undefined?channel.defaultValue:value;if(typeof result!=='number'||!Number.isFinite(result)||result<(channel.min??-Infinity)||result>(channel.max??Infinity))throw Error(`Invalid value for ${channel.property}`);if(channel.nonZero&&Math.abs(result)<1e-4)return Object.is(result,-0)||result<0?-1e-4:1e-4;return result;}
function payload(component:Entity['components'][number]):Record<string,Json>{if(!component.data||typeof component.data!=='object'||Array.isArray(component.data))throw Error('Target component data is unavailable');return component.data;}
function active(entity:Entity,byId:Map<string,Entity>){let current:Entity|undefined=entity;const visited=new Set<string>();while(current){if(!current.active||visited.has(current.id))return false;visited.add(current.id);current=current.parentId?byId.get(current.parentId):undefined;}return true;}
interface Binding {track:TweenData['tracks'][number];channel:TweenChannel;component:Entity['components'][number]}
interface Plan {id:string;ownerId:string;data:TweenData;bindings:Binding[]}
export function compileTweens(entities:readonly Entity[],channels:readonly TweenChannel[],only?:string,writers=new Map<string,string>()):{plans:Plan[];errors:string[]}{
 const byId=new Map(entities.map(e=>[e.id,e])),plans:Plan[]=[],errors:string[]=[];
 for(const owner of entities){for(const component of owner.components){if(component.type!=='tween.player'||component.version!==1||only&&component.id!==only)continue;
  try{const data=TweenSchema.parse(component.data);if(!data.tracks.length)throw Error('Add at least one tween track');const bindings=data.tracks.map(track=>{const target=byId.get(track.entityId),component=target?.components.find(c=>c.id===track.componentId),channel=channels.find(c=>c.componentType===component?.type&&c.version===component.version&&c.property===track.property);if(!target||!component||!channel)throw Error(`Missing target/channel: ${track.id}`);channelValue(channel,payload(component)[track.property]);channelValue(channel,track.from);channelValue(channel,track.to);return{track,component,channel};});
   // Manual players also reserve their channels: future interactions cannot introduce an unseen conflict.
   for(const b of bindings){const key=propertyKey(b.track.entityId,b.track.componentId,b.track.property);if(writers.has(key))throw Error(`Channel already owned by ${writers.get(key)}: ${b.track.property}`);writers.set(key,component.id);}
   plans.push({id:component.id,ownerId:owner.id,data,bindings});
  }catch(error){errors.push(`${owner.name}: ${String(error)}`);}
 }}if(only&&!plans.length&&!errors.length)errors.push('Tween player is missing or inactive');return{plans,errors};
}
interface Job extends Plan {sampler:TweenSampler;elapsed:number;running:boolean}
/** Only the runtime scheduler advances time. A paused scheduler's Step still evaluates one frame. */
export class TweenSession {
 private jobs=new Map<string,Job>();private dead=false;private started=false;
 readonly system:RuntimeSystem;errors:readonly string[]=[];
 constructor(private entities:()=>readonly Entity[],private channels:readonly TweenChannel[],private provider:TweenProvider,private only?:string){this.system={id:'tween',start:()=>this.start(),update:dt=>this.advance(dt),dispose:()=>this.dispose(),spawned:ids=>this.spawned(ids),removed:ids=>this.removed(ids)};}
 /** Tweens of objects spawned while playing (autoplay ones start at once). */
 spawned(ids:readonly string[]){if(this.dead||!this.started||this.only)return;const owners=new Set(ids),compiled=compileTweens(this.entities(),this.channels);const byId=new Map(this.entities().map(e=>[e.id,e]));for(const p of compiled.plans){if(!owners.has(p.ownerId)||this.jobs.has(p.id))continue;const job={...p,sampler:this.provider.create(p.data),elapsed:0,running:p.data.autoplay};this.jobs.set(p.id,job);const owner=byId.get(p.ownerId);if(job.running&&owner&&active(owner,byId))this.apply(job,0);}}
 removed(ids:readonly string[]){const gone=new Set(ids);for(const [id,j] of this.jobs)if(gone.has(j.ownerId)){j.sampler.dispose();this.jobs.delete(id);}}
 start(){if(this.dead||this.started)return;this.started=true;const compiled=compileTweens(this.entities(),this.channels,this.only);this.errors=compiled.errors;if(this.errors.length)return;
  try{for(const p of compiled.plans)this.jobs.set(p.id,{...p,sampler:this.provider.create(p.data),elapsed:0,running:Boolean(this.only)||p.data.autoplay});for(const j of this.jobs.values())if(j.running&&this.entities().some(e=>e.id===j.ownerId&&active(e,new Map(this.entities().map(e=>[e.id,e])))))this.apply(j,0);}catch(error){this.errors=[String(error)];for(const j of this.jobs.values())j.sampler.dispose();this.jobs.clear();}
 }
 private apply(job:Job,time:number){const values=job.sampler.sample(time);const updates=job.bindings.map(b=>({data:payload(b.component),property:b.track.property,value:channelValue(b.channel,values[b.track.id])}));for(const u of updates)u.data[u.property]=u.value;job.elapsed=time;}
 advance(dt:number){if(this.dead||!Number.isFinite(dt)||dt<0)return;const byId=new Map(this.entities().map(e=>[e.id,e]));for(const job of this.jobs.values()){const owner=byId.get(job.ownerId);if(job.running&&owner&&active(owner,byId)){this.apply(job,Math.min(totalDuration(job.data),job.elapsed+dt));if(job.elapsed>=totalDuration(job.data))job.running=false;}}}
 seek(time:number){if(this.dead||!Number.isFinite(time)||time<0)return;for(const job of this.jobs.values())this.apply(job,Math.min(time,totalDuration(job.data)));}
 play(id:string){if(this.dead)return;const job=this.jobs.get(id);if(job){const byId=new Map(this.entities().map(e=>[e.id,e])),owner=byId.get(job.ownerId);if(!owner||!active(owner,byId))return;job.running=true;this.apply(job,0);}}
 stop(id:string){const job=this.jobs.get(id);if(job)job.running=false;}
 get diagnostics(){return Object.fromEntries([...this.jobs].map(([id,j])=>[id,{time:j.elapsed,running:j.running,total:totalDuration(j.data)}]));}
 dispose(){if(this.dead)return;this.dead=true;for(const j of this.jobs.values())j.sampler.dispose();this.jobs.clear();}
}
