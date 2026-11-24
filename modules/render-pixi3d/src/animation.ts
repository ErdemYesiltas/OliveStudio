import {captureBindPose} from './bind-pose';
import type {AnimationPlayer} from '@pixi/3d';
import type {Ticker} from 'pixi.js';
import type {Entity} from '@rewrite/scene';
import type {AssetRecord} from '@rewrite/assets';
import {ModelMetadataSchema,Model3DSchema,modelComponentType} from './model-contracts';
import {modelAnimationType,ModelAnimationSchema,resolveModelClip,type ModelAnimation,type ModelAnimationAction} from './animation-contracts';
export interface ModelAnimationState{componentId:string;entityId:string;clip:string;time:number;duration:number;playing:boolean;completed:boolean;ready:boolean}
interface Entry extends ModelAnimationState{signature:string;config:ModelAnimation;active:boolean;legacyClip?:string;player?:AnimationPlayer;blendTime:number;blendLabel?:string;fade?:{label:string;time:number;loop:boolean;duration:number;left:number;total:number;speed:number}}
/** Absolute clip sampling through public gotoAndStop. No Pixi/shared ticker or wall clock. */
export class ModelAnimations{
 private bases=new WeakMap<AnimationPlayer,{clip?:string;restore:()=>void}>();
 private entries=new Map<string,Entry>();private time=0;readonly errors:string[]=[];
 constructor(private player:(entityId:string)=>AnimationPlayer|undefined,private asset:(id:string)=>AssetRecord|undefined,private complete:(id:string,silent:boolean)=>void=()=>{}){}
 sync(entities:readonly Entity[],strict=true,autoplay=true){this.errors.length=0;const byId=new Map(entities.map(e=>[e.id,e])),seen=new Set<string>();for(const entity of entities){const c=entity.components.find(c=>c.type===modelAnimationType&&c.version===1);if(!c)continue;seen.add(c.id);try{const config=ModelAnimationSchema.parse(c.data),model=entity.components.find(c=>c.type===modelComponentType&&c.version===1);if(!model)throw Error(`${entity.name}: model animation needs Model 3D on the same entity`);const assetId=Model3DSchema.parse(model.data).assetId,asset=this.asset(assetId),metadata=ModelMetadataSchema.parse(asset?.metadata),resolved=resolveModelClip(metadata.animations,config.clip);if(!config.clip||!resolved)throw Error(`${entity.name}: select a unique animation clip from its GLB model`);
  const signature=JSON.stringify([entity.id,assetId,asset?.revision,config]);let entry=this.entries.get(c.id);if(!entry||entry.signature!==signature){const previous=entry;
   const blend=config.blendClip?resolveModelClip(metadata.animations,config.blendClip):undefined;if(config.blendClip&&!blend)throw Error(`${entity.name}: blend clip is missing or ambiguous: ${config.blendClip}`);
   entry={componentId:c.id,entityId:entity.id,clip:config.clip,signature,config,time:config.startOffset,blendTime:config.startOffset,duration:resolved.clip.duration,playing:config.autoplay&&autoplay,completed:false,ready:false,active:true,legacyClip:config.clip===`Animation ${resolved.index+1}`?`anim_${resolved.index}`:undefined};
   if(blend)entry.blendLabel=config.blendClip===`Animation ${blend.index+1}`?`anim_${blend.index}`:config.blendClip;
   // A clip swapped while the old one plays fades across instead of cutting.
   if(previous&&previous.playing&&previous.player&&previous.clip!==config.clip&&config.fadeDuration>0){const label=previous.player.animationLabels.includes(previous.clip)?previous.clip:previous.legacyClip??previous.clip;entry.fade={label,time:previous.time,loop:previous.config.loop,duration:previous.duration,left:config.fadeDuration,total:config.fadeDuration,speed:previous.config.speed};entry.playing=true;}
   this.entries.set(c.id,entry);}
  entry.active=true;for(let p:Entity|undefined=entity;p;p=p.parentId?byId.get(p.parentId):undefined)if(!p.active){entry.active=false;break;}
  entry.player=this.player(entity.id);entry.ready=Boolean(entry.player);this.apply(entry);
 }catch(error){this.restore(this.entries.get(c.id)?.player);this.entries.delete(c.id);if(strict)throw error;this.errors.push(String(error));}
 }for(const id of this.entries.keys())if(!seen.has(id)){this.restore(this.entries.get(id)?.player);this.entries.delete(id);}}
 private apply(e:Entry){if(!e.player||e.player.destroyed)return;const label=e.player.animationLabels.includes(e.clip)?e.clip:e.legacyClip??e.clip,state=e.player.getState(label);let base=this.bases.get(e.player);if(!base){base={restore:captureBindPose(e.player.target)};this.bases.set(e.player,base);}e.player.autoUpdate=false;e.player.stop();
  const mix=mixParts(e,label),key=mix.map(p=>p.label).join('|');if(base.clip!==key){base.restore();base.clip=key;}e.duration=state.animation.duration;
  if(mix.length===1){const only=e.player.getState(mix[0].label);only.gotoAndStop(Math.max(0,Math.min(only.animation.duration,mix[0].time)));return;}
  // Several clips at once: each state is held at its own time (speed 0) and one zero-length update blends them by weight.
  for(const part of mix){const s=e.player.getState(part.label),d=s.animation.duration;s.loop=true;s.weight=part.weight;s.play();s.animationSpeed=0;s.time=Math.max(0,Math.min(d>0?d-1e-4:0,part.time));}
  e.player.update({deltaMS:0} as Ticker);}
 private restore(player:AnimationPlayer|undefined){if(!player||player.destroyed)return;const base=this.bases.get(player);base?.restore();if(base)base.clip=undefined;}

 advanceTo(time:number,silent=false){if(!Number.isFinite(time)||time<0)throw Error('Invalid animation clock');const dt=Math.max(0,time-this.time);this.time=time;for(const e of this.entries.values()){if(e.active&&e.playing&&dt>0){e.blendTime+=dt*e.config.speed;if(e.fade){e.fade.time+=dt*e.fade.speed;if(e.fade.loop&&e.fade.duration>0)e.fade.time%=e.fade.duration;e.fade.left-=dt;if(e.fade.left<=0)e.fade=undefined;}e.time+=dt*e.config.speed;if(e.duration>0&&e.config.loop)e.time%=e.duration;else if(e.time>=e.duration){e.time=e.duration;e.playing=false;if(!e.completed){e.completed=true;this.complete(e.componentId,silent);}}}this.apply(e);}}
 rebase(time:number){this.time=time;}
 control(id:string,action:ModelAnimationAction,time?:number){const e=this.entries.get(id);if(!e)throw Error('Model animation component is missing');if(action==='seek'){if(time===undefined||!Number.isFinite(time)||time<0||time>e.duration)throw Error('Seek must be inside the clip duration');e.time=time;e.playing=false;e.completed=false;}else if(action==='play'){if(e.active){e.time=0;e.blendTime=0;e.fade=undefined;e.playing=true;e.completed=false;}}else if(action==='resume'){if(e.active&&!e.completed)e.playing=true;}else if(action==='pause')e.playing=false;else{e.time=0;e.playing=false;e.completed=false;}this.apply(e);return this.state(id);}
 state(id:string):ModelAnimationState|undefined{const e=this.entries.get(id);return e?{componentId:e.componentId,entityId:e.entityId,clip:e.clip,time:e.time,duration:e.duration,playing:e.playing,completed:e.completed,ready:e.ready}:undefined;}
 get diagnostics(){return Object.fromEntries([...this.entries.keys()].map(id=>[id,this.state(id)]));}
 reset(entities:readonly Entity[]){this.clear();this.sync(entities);}
 clear(){for(const e of this.entries.values()){e.player?.stop();this.restore(e.player);}this.entries.clear();this.errors.length=0;this.time=0;}
}
/**
 * The clips an entry poses at once with their weights: the clip, its blend clip at `blendWeight`, and a clip fading
 * out after a swap. Weights are relative, so a fade gives the old clip what is left of the fade and the new mix the rest.
 */
export function mixParts(e:{time:number;blendTime:number;blendLabel?:string;config:{blendWeight:number};fade?:{label:string;time:number;left:number;total:number}},label:string){
 const parts:{label:string;time:number;weight:number}[]=[];const share=e.fade?1-Math.max(0,Math.min(1,e.fade.left/e.fade.total)):1;
 const blend=e.blendLabel&&e.blendLabel!==label?e.config.blendWeight:0;
 if(1-blend>0)parts.push({label,time:e.time,weight:(1-blend)*share});if(blend>0&&e.blendLabel)parts.push({label:e.blendLabel,time:e.blendTime,weight:blend*share});
 if(e.fade&&share<1)parts.push({label:e.fade.label,time:e.fade.time,weight:1-share});
 return parts.length?parts:[{label,time:e.time,weight:1}];}
