import {z} from 'zod';
import type {ComponentDefinition} from '@rewrite/sdk';
import {space3d} from '@rewrite/scene3d';
import type {ActionDefinition,TriggerDefinition} from '@rewrite/interactions';
export const modelAnimationType='animation3d.model';
/**
 * One clip, optionally blended with a second (`blendClip` at `blendWeight`), started `startOffset` seconds in. When the
 * clip changes while it plays, the old one fades out over `fadeDuration` instead of cutting.
 */
export const ModelAnimationSchema=z.object({clip:z.string().max(256),loop:z.boolean(),speed:z.number().finite().min(.01).max(8),autoplay:z.boolean(),blendClip:z.string().max(256).default(''),blendWeight:z.number().finite().min(0).max(1).default(.5),fadeDuration:z.number().finite().min(0).max(5).default(.3),startOffset:z.number().finite().min(0).max(600).default(0)}).strict();
export type ModelAnimation=z.infer<typeof ModelAnimationSchema>;
export const modelAnimationDefinition:ComponentDefinition={type:modelAnimationType,version:1,titleKey:'component.modelAnimation3d',defaults:()=>({clip:'',loop:true,speed:1,autoplay:true}),parse:v=>ModelAnimationSchema.parse(v),get dataSchema(){return z.toJSONSchema(ModelAnimationSchema);},supportedSpaces:[space3d],fields:[{key:'clip',titleKey:'animation3d.clip',kind:'string'},{key:'loop',titleKey:'animation3d.loop',kind:'boolean'},{key:'speed',titleKey:'animation3d.speed',kind:'number'},{key:'autoplay',titleKey:'animation3d.autoplay',kind:'boolean'},{key:'blendClip',titleKey:'animation3d.blendClip',kind:'string'},{key:'blendWeight',titleKey:'animation3d.blendWeight',kind:'number',visible:d=>Boolean((d as {blendClip?:string}).blendClip)},{key:'fadeDuration',titleKey:'animation3d.fadeDuration',kind:'number'},{key:'startOffset',titleKey:'animation3d.startOffset',kind:'number'}]};
export type ModelAnimationAction='play'|'pause'|'resume'|'stop'|'seek';
export interface ModelAnimationControls{control(id:string,action:ModelAnimationAction,time?:number):unknown}
const refs:ActionDefinition['references']=catalog=>catalog.entities.flatMap(e=>e.components.filter(c=>c.type===modelAnimationType&&c.version===1).map(c=>({id:c.id,name:e.name})));
export const modelAnimationTriggers:TriggerDefinition[]=[{type:'animation3d.complete',titleKey:'animation3d.complete',references:refs}];
export function modelAnimationActions(controller:()=>ModelAnimationControls|undefined):ActionDefinition[]{return(['play','pause','resume','stop'] as const).map(action=>({type:'animation3d.'+action,titleKey:'animation3d.'+action,references:refs,execute:a=>{const port=controller();if(!port)throw Error('3D model animations are not running');port.control(a.targetId,action);}}));}

/** Keeps generated anonymous clip references stable across pre-animation and current importer caches. */
export function resolveModelClip<T extends {name:string;duration:number}>(clips:readonly T[],name:string):{clip:T;index:number}|undefined{
 const matches=clips.map((clip,index)=>({clip,index})).filter(c=>c.clip.name===name);if(matches.length)return matches.length===1?matches[0]:undefined;
 const legacy=/^Animation ([1-9]\d*)$/.exec(name),current=/^anim_(\d+)$/.exec(name),index=legacy?Number(legacy[1])-1:current?Number(current[1]):-1,clip=clips[index];
 return clip&&(legacy?clip.name===`anim_${index}`:current?clip.name===`Animation ${index+1}`:false)?{clip,index}:undefined;
}
