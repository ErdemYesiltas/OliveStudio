import {registerAnimationAutomation} from './automation';
import {sceneToken} from '@rewrite/scene';
import {z} from 'zod';
import {components,propertyKey,type ComponentDefinition,type EditorModule,type Json,type RuntimeSystem} from '@rewrite/sdk';
import type {Entity} from '@rewrite/scene';
import {Subject,skip} from 'rxjs';
import {easings,compileTweens,TweenSession,type TweenChannel,type TweenProvider,type TweenSampler} from '@rewrite/tween';
import {TimelineRunner,resolveChannel,mixColor,entityTarget,type ResolvedChannel,type TrackKind,type TrackValue,type TimelineControl} from './timeline';
export * from './timeline';
/** Custom easing: CSS-style cubic bezier (x within 0..1 keeps time monotonic; y may overshoot). */
export const CurveSchema=z.tuple([z.number().min(0).max(1),z.number().min(-2).max(3),z.number().min(0).max(1),z.number().min(-2).max(3)]);
export type Curve=z.infer<typeof CurveSchema>;
const keySchema=z.object({id:z.string().min(1),time:z.number().min(0),/** Numbers ease; #rrggbb colours blend; on/off and text step at each key. */value:z.union([z.number().finite(),z.string().max(2000),z.boolean()]),ease:z.enum(['hold','curve',...easings]),curve:CurveSchema.optional()}).strict().superRefine((k,c)=>{if(k.ease==='curve'&&!k.curve)c.addIssue({code:'custom',message:'Curve easing needs control points'});});
/** Solves x(t)=progress for a cubic bezier with endpoints (0,0),(1,1) and returns y(t). Pure and deterministic. */
export function bezierEase([x1,y1,x2,y2]:Curve,progress:number):number{
 const p=Math.max(0,Math.min(1,progress));if(p===0||p===1)return p;
 const cx=3*x1,bx=3*(x2-x1)-cx,ax=1-cx-bx,cy=3*y1,by=3*(y2-y1)-cy,ay=1-cy-by;
 const x=(t:number)=>((ax*t+bx)*t+cx)*t,dx=(t:number)=>(3*ax*t+2*bx)*t+cx;
 let t=p;for(let i=0;i<8;i++){const err=x(t)-p,d=dx(t);if(Math.abs(err)<1e-7)break;if(Math.abs(d)<1e-6)break;t-=err/d;}
 if(t<0||t>1||Math.abs(x(t)-p)>1e-5){let lo=0,hi=1;t=p;for(let i=0;i<40;i++){const v=x(t);if(Math.abs(v-p)<1e-7)break;if(v<p)lo=t;else hi=t;t=(lo+hi)/2;}}
 return ((ay*t+by)*t+cy)*t;
}
export const curvePresets:readonly {id:string;curve:Curve}[]=[{id:'ease',curve:[.25,.1,.25,1]},{id:'easeIn',curve:[.42,0,1,1]},{id:'easeOut',curve:[0,0,.58,1]},{id:'easeInOut',curve:[.42,0,.58,1]},{id:'backOut',curve:[.34,1.56,.64,1]},{id:'anticipate',curve:[.36,0,.66,-.56]}];
/** A rule action carried by a timeline marker (validated against the interaction actions by the host). */
export const CueSchema=z.object({id:z.string().min(1),type:z.string().min(1),targetId:z.string(),value:z.boolean().default(true),amount:z.number().finite().optional(),to:z.json().optional(),key:z.string().max(40).optional(),x:z.number().finite().min(-1e6).max(1e6).optional(),y:z.number().finite().min(-1e6).max(1e6).optional()}).strict();
export type Cue=z.infer<typeof CueSchema>;
export const ClipSchema=z.object({id:z.string().min(1),name:z.string().trim().min(1).max(100),duration:z.number().min(1/60).max(600),repeat:z.number().int().min(0).max(100),yoyo:z.boolean(),tracks:z.array(z.object({id:z.string().min(1),entityId:z.string().min(1),componentId:z.string().min(1),property:z.string().min(1),keys:z.array(keySchema).min(1).max(128)}).strict()).max(64),markers:z.array(z.object({id:z.string().min(1),time:z.number().min(0),name:z.string().trim().min(1).max(100),
 /** Sent to every script's onMessage when crossed during playback. */message:z.string().trim().min(1).max(100).optional(),
 /** Plays or stops a sound, tween or animation component when crossed. */action:z.object({service:z.enum(['audio','tween','animation']),method:z.enum(['play','stop']),targetId:z.string().min(1)}).strict().optional(),
 /** Cutscene cue: any rule action (camera, dialogue, walk to, globals, scene…) run when crossed, same shape as a rule action. */cue:CueSchema.optional()}).strict()).max(256),
 /** Nested clips: another player's clip placed on this timeline (start offset, speed), driven by this clip's time. */
 clips:z.array(z.object({id:z.string().min(1),playerId:z.string().min(1),clipId:z.string().min(1),start:z.number().min(0),speed:z.number().min(.01).max(100)}).strict()).max(32).default([])}).strict().superRefine((v,c)=>{
 const ids=[...v.tracks.map(t=>t.id),...v.tracks.flatMap(t=>t.keys.map(k=>k.id)),...v.markers.map(m=>m.id)];if(new Set(ids).size!==ids.length)c.addIssue({code:'custom',message:'Duplicate clip item ID'});
 for(const t of v.tracks){const times=t.keys.map(k=>k.time).sort((a,b)=>a-b);if(times.some((time,i)=>time>v.duration||i>0&&time-times[i-1]<1e-8))c.addIssue({code:'custom',message:'Keyframe times must be unique and inside the clip'});}
 if(v.markers.some(m=>m.time>v.duration))c.addIssue({code:'custom',message:'Marker is outside the clip'});
 if(v.clips.some(n=>n.start>v.duration))c.addIssue({code:'custom',message:'Nested clip starts after the clip ends'});
 if(new Set(v.clips.map(n=>n.id)).size!==v.clips.length)c.addIssue({code:'custom',message:'Duplicate nested clip ID'});
});
export type AnimationClip=z.infer<typeof ClipSchema>;
export type AnimationTrack=AnimationClip['tracks'][number];
export const AnimationSchema=z.object({activeClipId:z.string().min(1),autoplay:z.boolean(),clips:z.array(ClipSchema).min(1).max(32)}).strict().superRefine((v,c)=>{if(new Set(v.clips.map(clip=>clip.id)).size!==v.clips.length)c.addIssue({code:'custom',message:'Duplicate clip ID'});});
export type AnimationPlayer=z.infer<typeof AnimationSchema>;
export function newClip(name='Clip'):AnimationClip{return{id:crypto.randomUUID(),name,duration:1,repeat:0,yoyo:false,tracks:[],markers:[],clips:[]};}
export const animationDefinition:ComponentDefinition={type:'animation.player',version:1,titleKey:'component.animation',defaults(){const clip=newClip();return{activeClipId:clip.id,autoplay:true,clips:[clip]};},get dataSchema(){return z.toJSONSchema(AnimationSchema,{unrepresentable:'any'});},parse:v=>AnimationSchema.parse(v),fields:[{key:'autoplay',titleKey:'animation.autoplay',kind:'boolean'}],remapReferences(value,ids){const v=AnimationSchema.parse(value),clips=new Map(v.clips.map(c=>[c.id,ids.preserveLocalIds?c.id:crypto.randomUUID()]));v.activeClipId=clips.get(v.activeClipId)??v.activeClipId;for(const c of v.clips){c.id=clips.get(c.id)!;for(const t of c.tracks){if(!ids.preserveLocalIds)t.id=crypto.randomUUID();t.entityId=ids.entities.get(t.entityId)??t.entityId;t.componentId=t.componentId===entityTarget?t.componentId:ids.components.get(t.componentId)??t.componentId;if(!ids.preserveLocalIds)for(const k of t.keys)k.id=crypto.randomUUID();}for(const m of c.markers){if(!ids.preserveLocalIds)m.id=crypto.randomUUID();if(m.action)m.action.targetId=ids.components.get(m.action.targetId)??m.action.targetId;}for(const n of c.clips){if(!ids.preserveLocalIds)n.id=crypto.randomUUID();n.clipId=clips.get(n.clipId)??n.clipId;n.playerId=ids.components.get(n.playerId)??n.playerId;}}return v as Json;}};
export const animationModule:EditorModule={manifest:{id:'animation',version:'1.0.0',apiVersion:1,requires:{scene:'^1',tween:'^1'},entries:{runtime:'@rewrite/animation'}},activate(c){c.contribute(components,'animation.player',animationDefinition);registerAnimationAutomation(c,c.get(sceneToken));}};
export const clipDuration=(clip:AnimationClip)=>clip.duration*(clip.repeat+1);
export function clipPosition(time:number,clip:AnimationClip){const t=Math.max(0,Math.min(clipDuration(clip),time)),cycle=Math.max(0,Math.min(clip.repeat,Math.ceil(t/clip.duration)-1)),reverse=clip.yoyo&&cycle%2===1,local=t-cycle*clip.duration;return{time:reverse?clip.duration-local:local,reverse};}

function curveSampler(curve:Curve,duration:number,from:number,to:number):TweenSampler{return{sample:(time:number)=>({value:from+(to-from)*bezierEase(curve,duration>0?time/duration:1)}),dispose(){}};}
type Key=AnimationTrack['keys'][number];
/** Samples one track. Numbers ease between keys; colours blend with the same easing; on/off and text hold until the next key. */
export function createTrackSampler(track:AnimationTrack,provider:TweenProvider,kind:TrackKind='number'){
 const keys=[...track.keys].sort((a,b)=>a.time-b.time),segments:{left:Key;right:Key;sampler?:TweenSampler}[]=[];let dead=false;
 const blends=kind==='number'||kind==='color';
 try{for(let i=0;i<keys.length-1;i++){const left=keys[i],right=keys[i+1],from=kind==='number'?Number(left.value):0,to=kind==='number'?Number(right.value):1;segments.push({left,right,sampler:!blends||left.ease==='hold'?undefined:left.ease==='curve'?curveSampler(left.curve!,right.time-left.time,from,to):provider.create({duration:right.time-left.time,delay:0,repeat:0,yoyo:false,ease:left.ease,tracks:[{id:'value',from,to}]})});}}catch(error){for(const s of segments)s.sampler?.dispose();throw error;}
 return{sample(time:number):TrackValue{if(dead)throw Error('Animation sampler disposed');if(!Number.isFinite(time))throw Error('Invalid animation time');if(time<=keys[0].time)return keys[0].value;if(time>=keys[keys.length-1].time)return keys[keys.length-1].value;const segment=segments.find(s=>time<s.right.time)!;if(!segment.sampler)return segment.left.value;const v=segment.sampler.sample(time-segment.left.time).value;return kind==='color'?mixColor(String(segment.left.value),String(segment.right.value),v):v;},dispose(){if(dead)return;dead=true;for(const s of segments)s.sampler?.dispose();}};
}
/** One binding's value under a cross-fade: from the pose at the switch toward the new clip. Properties the old clip did not animate start from their current value. */
function blended(b:Binding,value:TrackValue,blend:Blend):TrackValue{const key=propertyKey(b.track.entityId,b.track.componentId,b.track.property);let from=blend.from.get(key);if(from===undefined&&(b.channel.kind==='number'||b.channel.kind==='color')){from=b.channel.read();blend.from.set(key,from);}if(from===undefined)return value;const w=Math.max(0,Math.min(1,blend.elapsed/blend.duration));if(b.channel.kind==='number')return b.channel.check(Number(from)+(Number(value)-Number(from))*w);if(b.channel.kind==='color')return mixColor(String(from),String(value),w);return value;}
export function entityActive(entity:Entity,byId:Map<string,Entity>){let e:Entity|undefined=entity;const seen=new Set<string>();while(e){if(!e.active||seen.has(e.id))return false;seen.add(e.id);e=e.parentId?byId.get(e.parentId):undefined;}return true;}
interface Binding{track:AnimationTrack;channel:ResolvedChannel}
/** A clip placed inside another clip's timeline. */
interface Nested{id:string;playerId:string;clip:AnimationClip;start:number;speed:number;bindings:Binding[];children:Nested[]}
interface Plan{id:string;ownerId:string;clip:AnimationClip;autoplay:boolean;bindings:Binding[];children:Nested[]}
const findPlayer=(entities:readonly Entity[],playerId:string)=>{for(const e of entities)for(const c of e.components)if(c.id===playerId&&c.type==='animation.player'&&c.version===1)return{owner:e,player:AnimationSchema.parse(c.data)};return undefined;};
function bind(clip:AnimationClip,byId:Map<string,Entity>,channels:readonly TweenChannel[],writers:Map<string,string>,owner:string,links:ReadonlySet<string>=new Set()):Binding[]{
 return clip.tracks.map(track=>{let channel:ResolvedChannel;try{channel=resolveChannel(channels,byId.get(track.entityId),track.componentId,track.property);}catch(error){throw Error(`Missing animation target/channel: ${track.id} (${error instanceof Error?error.message:String(error)})`);}
  channel.check(channel.read());for(const key of track.keys)channel.check(key.value);
  const key=propertyKey(track.entityId,track.componentId,track.property),current=writers.get(key);if(current!==undefined&&!links.has(`${current}|${owner}`))throw Error(`Channel already owned by ${current}: ${track.property}`);if(current===undefined)writers.set(key,owner);return{track,channel};});
}
function nest(clip:AnimationClip,entities:readonly Entity[],byId:Map<string,Entity>,channels:readonly TweenChannel[],writers:Map<string,string>,owner:string,path:string[],links:ReadonlySet<string>):Nested[]{
 return clip.clips.map(n=>{const found=findPlayer(entities,n.playerId),inner=found?.player.clips.find(c=>c.id===n.clipId);if(!inner)throw Error('Nested clip is missing');const key=`${n.playerId}/${n.clipId}`;if(path.includes(key)||path.length>=4)throw Error(`Nested clips form a loop or go deeper than 4: ${inner.name}`);
  return{id:n.id,playerId:n.playerId,clip:inner,start:n.start,speed:n.speed,bindings:bind(inner,byId,channels,writers,owner,links),children:nest(inner,entities,byId,channels,writers,owner,[...path,key],links)};});
}
export function compileAnimations(entities:readonly Entity[],channels:readonly TweenChannel[],only?:{playerId:string;clipId:string},writers=new Map<string,string>()){
 const byId=new Map(entities.map(e=>[e.id,e])),plans:Plan[]=[],errors:string[]=[];
 // A player and the players whose clips it nests share their channels: they are one timeline, not competing writers.
 const links=new Set<string>(),visit=(root:string,clip:AnimationClip,depth:number)=>{if(depth>4)return;for(const n of clip.clips){links.add(`${root}|${n.playerId}`);links.add(`${n.playerId}|${root}`);const inner=findPlayer(entities,n.playerId)?.player.clips.find(c=>c.id===n.clipId);if(inner)visit(root,inner,depth+1);}};
 for(const e of entities)for(const c of e.components)if(c.type==='animation.player'&&c.version===1){const parsed=AnimationSchema.safeParse(c.data);if(!parsed.success)continue;const clip=parsed.data.clips.find(x=>x.id===(only&&only.playerId===c.id?only.clipId:parsed.data.activeClipId));if(clip)visit(c.id,clip,0);}
 for(const owner of entities){for(const component of owner.components){if(component.type!=='animation.player'||component.version!==1||only&&component.id!==only.playerId)continue;
  try{const player=AnimationSchema.parse(component.data),clip=player.clips.find(c=>c.id===(only?.clipId??player.activeClipId));if(!clip)throw Error('Animation clip is missing');if(!clip.tracks.length&&!clip.clips.length)throw Error('Add at least one animation track');
   const local=new Map(writers),bindings=bind(clip,byId,channels,local,component.id,links),children=nest(clip,entities,byId,channels,local,component.id,[`${component.id}/${clip.id}`],links);
   for(const [k,v] of local)writers.set(k,v);plans.push({id:component.id,ownerId:owner.id,clip,autoplay:player.autoplay,bindings,children});
  }catch(error){errors.push(`${owner.name}: ${String(error)}`);}
 }}if(only&&!plans.length&&!errors.length)errors.push('Animation player is missing or inactive');return{plans,errors};
}
export function validateMotion(entities:readonly Entity[],channels:readonly TweenChannel[],writers=new Map<string,string>()){return[...compileTweens(entities,channels,undefined,writers).errors,...compileAnimations(entities,channels,undefined,writers).errors];}
export interface AnimationEvent{kind:'marker'|'complete';ownerId:string;playerId:string;clipId:string;markerId?:string;name:string;time:number;reverse:boolean;silent:boolean;
 /** Marker payloads: a message for scripts, a media action to run. */message?:string;action?:AnimationClip['markers'][number]['action'];cue?:Cue}
/** Scene playback uses one provider and one event route for both animation hosts. */
export function createSceneMotion(
 entities:()=>readonly Entity[],
 channels:readonly TweenChannel[],
 provider:TweenProvider,
 ports:{
  silent():boolean;
  emit(event:{type:string;sourceId:string;event?:string;silent:boolean}):void;
  invoke(service:string,method:'play'|'stop',id:string):void;
  cue(action:unknown,silent:boolean,owner:string):void;
  message(message:string,data:{marker:string}):void;
  report(error:unknown):void;
  observe?(event:AnimationEvent):void;
 },
){
 const tween=new TweenSession(entities,channels,provider);
 const animation=new AnimationSession(entities,channels,provider,{
  silent:ports.silent,
  event(event){
   if(event.kind==='complete')ports.emit({type:'animation.complete',sourceId:event.playerId,silent:event.silent});
   else{
    ports.emit({type:'animation.marker',sourceId:event.playerId,event:event.name,silent:event.silent});
    if(event.action&&!(event.silent&&event.action.service==='audio')){
     try{ports.invoke(event.action.service,event.action.method,event.action.targetId);}
     catch(error){ports.report(error);}
    }
    if(event.cue)ports.cue(event.cue,event.silent,event.ownerId);
    if(event.message)ports.message(event.message,{marker:event.name});
   }
   ports.observe?.(event);
  },
 });
 return {tween,animation};
}
export function crossedMarkers(clip:AnimationClip,from:number,to:number){const found=new Map<string,{marker:AnimationClip['markers'][number];time:number;reverse:boolean}>();for(let cycle=0;cycle<=clip.repeat;cycle++){const reverse=clip.yoyo&&cycle%2===1;for(const marker of clip.markers){const local=reverse?clip.duration-marker.time:marker.time,time=local===0||local===clip.duration?(cycle+(local===0?0:1))*clip.duration:cycle*clip.duration+local;if(time>from+1e-10&&time<=to+1e-10){const key=JSON.stringify([marker.id,time]);if(!found.has(key))found.set(key,{marker,time,reverse});}}}return [...found.values()].sort((a,b)=>a.time-b.time||a.marker.id.localeCompare(b.marker.id));}
/** Markers crossed while playing from → to (either direction), in playing order. */
function playedMarkers(clip:AnimationClip,from:number,to:number){if(to>=from)return crossedMarkers(clip,from,to);return crossedMarkers(clip,to-1e-9,from-1e-9).reverse();}
interface SamplerSet{bindings:Binding[];samplers:ReturnType<typeof createTrackSampler>[];children:{nested:Nested;set:SamplerSet;last:number|null}[]}
/** A cross-fade from the pose a player had when its clip switched: weight 0 → 1 over `duration` seconds of game time. */
interface Blend{from:Map<string,TrackValue>;duration:number;elapsed:number}
interface Job extends Plan{runner:TimelineRunner;set:SamplerSet;subscriptions:{unsubscribe():void}[];posed:number|null;blend?:Blend}
/** Playback state of one player, for diagnostics, scripts and the editor. */
export interface TimelineState{clipId:string;time:number;position:number;total:number;running:boolean;speed:number;direction:1|-1}

/**
 * Plays animation players on RxJS timelines: every frame goes through `frame$`; each player's runner applies poses from
 * its `time$`, fires markers for the ranges it played (forward or reversed) and completes once per play. Nested clips
 * follow their parent's time. Seeks pose without events. The public API matches the earlier session (play/stop/seek).
 */
export class AnimationSession {
 readonly system:RuntimeSystem;errors:readonly string[]=[];
 /** Every rendered frame's delta (seconds). */
 readonly frame$=new Subject<number>();
 /** Markers and completions of every player. */
 readonly events$=new Subject<AnimationEvent>();
 private jobs=new Map<string,Job>();private dead=false;private started=false;
 constructor(private entities:()=>readonly Entity[],private channels:readonly TweenChannel[],private provider:TweenProvider,private options:{only?:{playerId:string;clipId:string};silent?:()=>boolean;event?:(event:AnimationEvent)=>void}={}){this.system={id:'animation',start:()=>this.start(),update:dt=>this.advance(dt),dispose:()=>this.dispose(),spawned:ids=>this.spawned(ids),removed:ids=>this.removed(ids)};}
 /** Animation players of objects spawned while playing (autoplay ones start at once). */
 spawned(ids:readonly string[]){if(this.dead||!this.started||this.options.only)return;const owners=new Set(ids),compiled=compileAnimations(this.entities(),this.channels);for(const plan of compiled.plans){if(!owners.has(plan.ownerId)||this.jobs.has(plan.id))continue;const job=this.createJob(plan,plan.autoplay);this.jobs.set(plan.id,job);if(job.runner.control$.value.playing&&this.active(job))job.runner.play();}}
 removed(ids:readonly string[]){const gone=new Set(ids);for(const [id,job] of this.jobs)if(gone.has(job.ownerId)){this.drop(job);this.jobs.delete(id);}}
 private samplers(bindings:Binding[],children:Nested[]):SamplerSet{const samplers:ReturnType<typeof createTrackSampler>[]=[],sets:SamplerSet['children']=[];try{for(const b of bindings)samplers.push(createTrackSampler(b.track,this.provider,b.channel.kind));for(const n of children)sets.push({nested:n,set:this.samplers(n.bindings,n.children),last:null});}catch(error){for(const s of samplers)s.dispose();for(const c of sets)this.release(c.set);throw error;}return{bindings,samplers,children:sets};}
 private release(set:SamplerSet){for(const s of set.samplers)s.dispose();for(const c of set.children)this.release(c.set);}
 private byId(){return new Map(this.entities().map(e=>[e.id,e]));}
 private active(job:Plan){const byId=this.byId(),owner=byId.get(job.ownerId);return Boolean(owner&&entityActive(owner,byId));}
 private createJob(plan:Plan,running:boolean,blend?:Blend):Job{
  const set=this.samplers(plan.bindings,plan.children),runner=new TimelineRunner(this.frame$,clipDuration(plan.clip),running,()=>this.active(plan));
  const job:Job={...plan,runner,set,subscriptions:[],posed:null,...(blend?{blend}:{})};
  // The initial 0 is not a pose: players write only once played or sought (inactive owners stay untouched).
  job.subscriptions.push(runner.time$.pipe(skip(1)).subscribe(time=>{if(job.posed===time){job.posed=null;return;}job.posed=null;this.pose(job.clip,set,time,null,job.blend);}));
  job.subscriptions.push(runner.played$.subscribe(range=>{if(this.options.only)return;this.markers(job,job.clip,range.from,range.to,job.id);this.pose(job.clip,set,range.to,job,job.blend);job.posed=range.to;}));
  // Blend time follows the game clock (after the runner has posed this frame); the blend ends at full weight.
  if(blend)job.subscriptions.push(this.frame$.subscribe(dt=>{const b=job.blend;if(!b)return;b.elapsed+=dt;if(b.elapsed>=b.duration)job.blend=undefined;}));
  job.subscriptions.push(runner.complete$.subscribe(time=>{if(!this.options.only)this.emit({kind:'complete',ownerId:job.ownerId,playerId:job.id,clipId:job.clip.id,name:'complete',time,reverse:clipPosition(time,job.clip).reverse,silent:this.silent()});}));
  return job;
 }
 private silent(){return this.options.silent?.()??false;}
 private emit(event:AnimationEvent){this.events$.next(event);this.options.event?.(event);}
 private markers(job:Job,clip:AnimationClip,from:number,to:number,playerId:string){for(const hit of playedMarkers(clip,from,to))this.emit({kind:'marker',ownerId:job.ownerId,playerId,clipId:clip.id,markerId:hit.marker.id,name:hit.marker.name,time:hit.time,reverse:to<from,silent:this.silent(),...(hit.marker.message?{message:hit.marker.message}:{}),...(hit.marker.action?{action:hit.marker.action}:{}),...(hit.marker.cue?{cue:hit.marker.cue}:{})});}
 /** Writes every track (and nested clip) for a timeline time; `job` set while playing so nested markers fire. */
 private pose(clip:AnimationClip,set:SamplerSet,time:number,job:Job|null,blend?:Blend){
  const position=clipPosition(time,clip),values=set.bindings.map((b,i)=>{const v=b.channel.check(set.samplers[i].sample(position.time));return blend?blended(b,v,blend):v;});
  set.bindings.forEach((b,i)=>b.channel.write(values[i]));
  for(const child of set.children){const n=child.nested,total=clipDuration(n.clip),local=(position.time-n.start)*n.speed;if(local<0){child.last=null;continue;}const t=Math.min(total,local);if(job&&child.last!==null&&t!==child.last)this.markers(job,n.clip,child.last,t,n.playerId);child.last=t;this.pose(n.clip,child.set,t,job,blend);}
 }
 start(){if(this.dead||this.started)return;this.started=true;const compiled=compileAnimations(this.entities(),this.channels,this.options.only);this.errors=compiled.errors;if(this.errors.length)return;
  try{for(const plan of compiled.plans)this.jobs.set(plan.id,this.createJob(plan,Boolean(this.options.only)||plan.autoplay));}catch(error){this.errors=[String(error)];for(const job of this.jobs.values())this.drop(job);this.jobs.clear();return;}
  for(const job of this.jobs.values())if(job.runner.control$.value.playing&&this.active(job)){if(this.options.only)job.runner.seek(0);else job.runner.play();}}
 /** One frame of playback (the runtime system's update). */
 advance(dt:number){if(this.dead||!Number.isFinite(dt)||dt<0)return;this.frame$.next(dt);}
 seek(time:number){if(this.dead||!Number.isFinite(time)||time<0)return;for(const job of this.jobs.values())job.runner.seek(Math.min(time,clipDuration(job.clip)));}
 /** Restarts a player (optionally on another of its clips); `fade` seconds cross-fade from its current pose (numbers and colours blend, on/off and text switch at once). */
 play(id:string,clipId?:string,fade=0){if(this.dead)return;let job=this.jobs.get(id);if(!job)return;const blend=Number.isFinite(fade)&&fade>0?Math.min(fade,60):0;if(blend||clipId&&clipId!==job.clip.id)job=this.switchClip(job,clipId??job.clip.id,blend);if(!this.active(job))return;job.runner.play();}
 /** Rules: cross-fade a player to a clip by name (the active clip when empty). */
 crossFade(id:string,clipName:string,seconds:number){if(this.dead||!this.jobs.has(id))return;const found=findPlayer(this.entities(),id),clip=clipName?found?.player.clips.find(c=>c.name===clipName):undefined;if(clipName&&!clip)throw Error(`No clip named "${clipName}"`);this.play(id,clip?.id,seconds);}
 stop(id:string){this.jobs.get(id)?.runner.pause();}
 pause(id:string){this.jobs.get(id)?.runner.pause();}
 resume(id:string){const job=this.jobs.get(id);if(job&&this.active(job))job.runner.resume();}
 seekPlayer(id:string,time:number){this.jobs.get(id)?.runner.seek(time);}
 setSpeed(id:string,speed:number){this.jobs.get(id)?.runner.setSpeed(speed);}
 reverse(id:string){this.jobs.get(id)?.runner.reverse();}
 /** Live control and time of one player (RxJS). */
 timeline(id:string){const job=this.jobs.get(id);return job?{time$:job.runner.time$.asObservable(),control$:job.runner.control$.asObservable(),clip:job.clip}:undefined;}
 private switchClip(job:Job,clipId:string,fade=0):Job{
  const others=new Map<string,string>();for(const j of this.jobs.values())if(j!==job)for(const b of this.flatBindings(j.set))others.set(propertyKey(b.track.entityId,b.track.componentId,b.track.property),j.id);
  const compiled=compileAnimations(this.entities(),this.channels,{playerId:job.id,clipId},others);if(compiled.errors.length)throw Error(compiled.errors.join('\n'));
  const from=new Map<string,TrackValue>();if(fade>0)for(const b of this.flatBindings(job.set))if(b.channel.kind==='number'||b.channel.kind==='color')from.set(propertyKey(b.track.entityId,b.track.componentId,b.track.property),b.channel.read());
  const control=job.runner.control$.value;this.drop(job);const next=this.createJob(compiled.plans[0],false,fade>0?{from,duration:fade,elapsed:0}:undefined);if(control.speed!==1)next.runner.setSpeed(control.speed);if(control.direction<0)next.runner.reverse();this.jobs.set(job.id,next);return next;
 }
 private flatBindings(set:SamplerSet):Binding[]{return[...set.bindings,...set.children.flatMap(c=>this.flatBindings(c.set))];}
 private drop(job:Job){for(const s of job.subscriptions)s.unsubscribe();job.runner.dispose();this.release(job.set);}
 state(id:string):TimelineState|undefined{const j=this.jobs.get(id);if(!j)return undefined;const c:TimelineControl=j.runner.control$.value,time=j.runner.time$.value;return{clipId:j.clip.id,time,position:clipPosition(time,j.clip).time,total:clipDuration(j.clip),running:c.playing,speed:c.speed,direction:c.direction};}
 get diagnostics(){return Object.fromEntries([...this.jobs.keys()].map(id=>{const s=this.state(id)!;return[id,{clipId:s.clipId,time:s.time,position:s.position,running:s.running,total:s.total,speed:s.speed,direction:s.direction}];}));}
 dispose(){if(this.dead)return;this.dead=true;for(const job of this.jobs.values())this.drop(job);this.jobs.clear();this.frame$.complete();this.events$.complete();}
}
