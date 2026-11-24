import {z} from 'zod';
import {components,createItems,settings,type ComponentDefinition,type EditorModule,type RuntimeSystem} from '@rewrite/sdk';
import {assetImporters,type AssetRecord} from '@rewrite/assets';
import {transform,type Entity} from '@rewrite/scene';
import {BehaviorSubject,Subject,distinctUntilChanged,map,merge,of,scan,startWith,switchMap,takeWhile,type Observable as Stream,type Subscription} from 'rxjs';
import {tweenChannels} from '@rewrite/tween/contracts';
import {AudioSourceSchema,AudioListenerSchema,AudioMetadataSchema,spatialMix,MixerSchema,audioImporter,audioBuses,busGain,busEffects,noBusEffects,defaultMixer,type AudioBus,type AudioControls,type AudioEvent,type AudioState,type Mixer,type AudioController,type AudioProvider,type AudioSource,type AudioVoice,type VoiceSnapshot,type VoiceSpec,type Point} from './contracts';
export * from './contracts';
export const audioSourceDefinition:ComponentDefinition={type:'audio.source',version:1,titleKey:'component.audioSource',defaults:()=>({assetId:'',volume:1,loop:false,rate:1,autoplay:false,bus:'sfx',bpm:0,beatOffset:0,pitchJitter:0,volumeJitter:0,pan:0,spatial:false,minDistance:100,maxDistance:1000,rolloff:'linear',panAmount:1}),get dataSchema(){return z.toJSONSchema(AudioSourceSchema,{unrepresentable:'any'});},parse:v=>AudioSourceSchema.parse(v),fields:[{key:'assetId',titleKey:'audio.clip',kind:'asset',assetType:'audio.clip'},...['volume','rate','bpm','beatOffset','pitchJitter','volumeJitter'].map(key=>({key,titleKey:`audio.${key}`,kind:'number'as const})),...['loop','autoplay'].map(key=>({key,titleKey:`audio.${key}`,kind:'boolean'as const})),{key:'bus',titleKey:'audio.bus',kind:'enum',options:audioBuses.map(value=>({value,titleKey:`audio.bus.${value}`}))},{key:'pan',titleKey:'audio.pan',kind:'number'},
 {key:'spatial',titleKey:'audio.spatial',kind:'boolean'},...(['minDistance','maxDistance','panAmount'] as const).map(key=>({key,titleKey:`audio.${key}`,kind:'number' as const,visible:(d:unknown)=>(d as {spatial?:boolean}).spatial===true})),
 {key:'rolloff',titleKey:'audio.rolloff',kind:'enum',options:(['linear','inverse','exponential'] as const).map(value=>({value,titleKey:`audio.rolloff.${value}`})),visible:(d:unknown)=>(d as {spatial?:boolean}).spatial===true}]};
/** Where spatial sources are heard from (one per scene is used: the first active one). */
export const audioListenerDefinition:ComponentDefinition={type:'audio.listener',version:1,titleKey:'component.audioListener',defaults:()=>({}),get dataSchema(){return z.toJSONSchema(AudioListenerSchema,{unrepresentable:'any'});},parse:v=>AudioListenerSchema.parse(v),fields:[]};
/** An entity's position in world pixels (its parents' transforms applied). */
export function worldPoint(entities:readonly Entity[],id:string):Point|undefined{
 const byId=new Map(entities.map(e=>[e.id,e])),chain:Entity[]=[];
 for(let e=byId.get(id);e&&chain.length<64;e=e.parentId?byId.get(e.parentId):undefined)chain.push(e);
 if(!chain.length)return undefined;
 let p={x:transform(chain[0]).pivotX??0,y:transform(chain[0]).pivotY??0};
 for(const e of chain){const t=transform(e),a=t.rotation*Math.PI/180,x=(p.x-(t.pivotX??0))*t.scaleX,y=(p.y-(t.pivotY??0))*t.scaleY;p={x:t.x+x*Math.cos(a)-y*Math.sin(a),y:t.y+x*Math.sin(a)+y*Math.cos(a)};}
 return p;
}
/** The first active object with an Audio Listener, as a world point. */
export function listenerPoint(entities:readonly Entity[]):Point|undefined{
 const byId=new Map(entities.map(e=>[e.id,e])),active=(e:Entity)=>{for(let x:Entity|undefined=e;x;x=x.parentId?byId.get(x.parentId):undefined)if(!x.active)return false;return true;};
 const listener=entities.find(e=>active(e)&&e.components.some(c=>c.type==='audio.listener'&&c.version===1));
 return listener?worldPoint(entities,listener.id):undefined;
}
/** Editor gizmo: min (solid) and max distance circles of the selected spatial sources, in each object's local space. */
export function audioRanges(entities:readonly Entity[],ids:readonly string[]){
 const byId=new Map(entities.map(e=>[e.id,e])),scale=(id:string)=>{let s=1;for(let e=byId.get(id);e;e=e.parentId?byId.get(e.parentId):undefined)s*=Math.abs(transform(e).scaleX)||1;return s;};
 return ids.flatMap(id=>{const e=byId.get(id);if(!e)return[];return e.components.flatMap(c=>{if(c.type!=='audio.source'||c.version!==1)return[];const p=AudioSourceSchema.safeParse(c.data);if(!p.success||!p.data.spatial)return[];const k=scale(id);
  return[p.data.minDistance,Math.max(p.data.minDistance+1,p.data.maxDistance)].map((r,i)=>({entityId:id,points:Array.from({length:64},(_,j)=>({x:Math.cos(j/64*Math.PI*2)*r/k,y:Math.sin(j/64*Math.PI*2)*r/k})),color:i?'#6aa7d9':'#9fd96a'}));});});
}
export const audioModule:EditorModule={manifest:{id:'audio',version:'1.0.0',apiVersion:1,requires:{scene:'^1',assets:'^1'},entries:{worker:'@rewrite/audio/node',runtime:'@rewrite/audio'}},activate(c){c.contribute(createItems,'audio.sound',{titleKey:'create.sound',category:'audio',icon:'audio',name:'Sound',components:[{type:'audio.source'}]});c.contribute(settings,'audio.previewVolume',{titleKey:'setting.previewVolume',descriptionKey:'setting.previewVolumeHelp',kind:'number',default:25,min:0,max:100,step:1,unit:'%'});c.contribute(components,'audio.source',audioSourceDefinition);c.contribute(components,'audio.listener',audioListenerDefinition);c.contribute(createItems,'audio.listener',{titleKey:'create.audioListener',category:'audio',icon:'audio',name:'Audio listener',components:[{type:'audio.listener'}]});c.contribute(tweenChannels,'audio.volume',{componentType:'audio.source',version:1,property:'volume',titleKey:'audio.volume',min:0,max:1,defaultValue:1});c.contribute(tweenChannels,'audio.rate',{componentType:'audio.source',version:1,property:'rate',titleKey:'audio.rate',min:.25,max:4,defaultValue:1});c.contribute(assetImporters,audioImporter.id,audioImporter);}};
export function voiceSpec(source:Pick<AudioSource,'volume'|'loop'|'rate'|'bus'>,asset:AssetRecord|undefined,url:(asset:AssetRecord,file:string)=>string,provider:AudioProvider,mixer?:Mixer):VoiceSpec{
 if(!asset||asset.type!=='audio.clip')throw Error('Audio clip is missing');const meta=AudioMetadataSchema.parse(asset.metadata);
 if(!provider.supports(meta.format))throw Error(`Audio format is unsupported: ${meta.format}`);
 return{url:url(asset,`audio.${meta.format}`),format:meta.format,volume:source.volume*busGain(mixer,source.bus),loop:source.loop,rate:source.rate,bus:source.bus};
}
class Observable {
 private listeners=new Set<()=>void>();
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 protected changed(){for(const fn of this.listeners)fn();}
}
/** Editor preview ownership is independent of runtime source ownership. */
export class AudioPreview extends Observable implements AudioController {
 private entries=new Map<string,{voice:AudioVoice;unsubscribe:()=>void}>();
 constructor(private provider:()=>AudioProvider){super();}
 snapshot=(key:string)=>this.entries.get(key)?.voice.snapshot;
 get diagnostics(){return Object.fromEntries([...this.entries].map(([key,e])=>[key,e.voice.snapshot]));}
 play=(key:string,spec?:VoiceSpec)=>{if(!spec)return;this.stop(key);const voice=this.provider().create(spec),unsubscribe=voice.subscribe(()=>this.changed());this.entries.set(key,{voice,unsubscribe});voice.play();this.changed();};
 stop=(key:string)=>{const entry=this.entries.get(key);if(!entry)return;this.entries.delete(key);entry.unsubscribe();entry.voice.dispose();this.changed();};
 stopAll(){for(const key of [...this.entries.keys()])this.stop(key);}
}
/** A gain ramp on the game clock: emits from → to over `seconds` of frames, then completes. */
export function ramp(frame$:Stream<number>,from:number,to:number,seconds:number):Stream<number>{
 if(seconds<=0||from===to)return of(to);
 return frame$.pipe(scan((t,dt)=>t+dt,0),map(t=>t>=seconds?to:from+(to-from)*t/seconds),takeWhile(v=>v!==to,true),startWith(from));
}
interface Entry {
 key:string;entityId:string;signature:string;voice?:AudioVoice;unsubscribe?:()=>void;error?:VoiceSnapshot;wantsPlay:boolean;
 source:AudioSource;state$:BehaviorSubject<AudioState>;fade$:BehaviorSubject<number>;fadeCommand$:Subject<{to:number;seconds:number;stopAfter:boolean}>;
 jitter:{volume:number;rate:number};beat:number;subscriptions:Subscription[];
 /** Distance gain and stereo pan from the listener (1 and the source's pan when not spatial). */
 spatial:{gain:number;pan:number};
}
/**
 * Browser-only runtime audio on RxJS: the provider owns acoustic time; Step never starts a voice. Gains are live
 * streams (source × bus × master × ducking × fade × variation → voice volume, no restart); fades and ducking ramps run
 * on the frame stream (they pause with the session); beats come from the playing position and the clip's BPM.
 */
export class AudioSession extends Observable implements AudioController, AudioControls {
 private entries=new Map<string,Entry>();
 private paused=false;private dead=false;
 readonly system:RuntimeSystem;
 /** One value per rendered frame (seconds). */
 readonly frame$=new Subject<number>();
 /** Sources that ended and beats crossed. */
 readonly events$=new Subject<AudioEvent>();
 private mixer$:BehaviorSubject<Mixer>;
 private overrides$=new BehaviorSubject<Record<AudioBus,number>>({music:1,sfx:1,ui:1});
 private playing$=new BehaviorSubject<Record<AudioBus,number>>({music:0,sfx:0,ui:0});
 private duck$=new BehaviorSubject<Record<AudioBus,number>>({music:1,sfx:1,ui:1});
 private duckSubscription?:Subscription;private mixSubscription?:Subscription;private effectsSubscription?:Subscription;
 private random:()=>number;
 private listener:()=>Point|undefined;
 /** `listener`: where to hear spatial sources from when no object has an Audio Listener (the camera centre, world pixels). */
 constructor(private entities:()=>readonly Entity[],private resolve:(source:AudioSource)=>VoiceSpec,private provider:AudioProvider,options:{mixer?:Mixer;random?:()=>number;listener?:()=>Point|undefined}={}){
  super();this.random=options.random??Math.random;this.listener=options.listener??(()=>undefined);this.mixer$=new BehaviorSubject(options.mixer??defaultMixer);this.ducking();
  // Any change of the mix, runtime bus gains or ducking re-applies every live gain.
  this.mixSubscription=merge(this.mixer$,this.overrides$,this.duck$).subscribe(()=>this.applyAll());
  // Bus effects live in the provider's audio graph (shared by every voice on the bus).
  this.effectsSubscription=this.mixer$.subscribe(m=>{for(const b of audioBuses)this.provider.setBusEffects?.(b,busEffects(m,b));});
  this.system={id:'audio',start:context=>{if(context)this.paused=context.paused;this.reconcile();},update:dt=>{this.reconcile();if(!this.paused&&dt>0){this.frame$.next(dt);this.beats();this.spatialize();}},pause:()=>this.pause(),resume:()=>this.resume(),dispose:()=>this.dispose()};
 }
 snapshot=(key:string)=>{const entry=this.entries.get(key);return entry?.voice?.snapshot??entry?.error;};
 /** Per bus right now: effective gain (master × bus × runtime gain × ducking) and how many sounds are playing; the Mixer panel meters. */
 levels():Record<AudioBus,{gain:number;playing:number}>{const m=this.mixer$.value,o=this.overrides$.value,d=this.duck$.value,p=this.playing$.value;return Object.fromEntries(audioBuses.map(b=>[b,{gain:busGain(m,b)*o[b]*d[b],playing:p[b]}])) as Record<AudioBus,{gain:number;playing:number}>;}
 get diagnostics(){return Object.fromEntries([...this.entries].map(([id,e])=>[id,{entityId:e.entityId,...this.snapshot(id),fade:e.fade$.value,volume:this.volumeOf(e),pan:e.spatial.pan}]));}
 /** Project mix (bus gains and ducking rules); live: sources follow immediately. */
 /** Bus effects the provider applies now (with the voices routed through each bus). */
 get effects(){return this.provider.busEffects?.()??{};}
 setMixer(mixer:Mixer){this.mixer$.next(MixerSchema.parse(mixer));this.ducking();}
 setBus=(bus:AudioBus,gain:number)=>{if(!audioBuses.includes(bus))throw Error(`Unknown bus ${String(bus)}`);if(!Number.isFinite(gain)||gain<0||gain>1)throw Error('Bus volume must be 0–1');this.overrides$.next({...this.overrides$.value,[bus]:gain});};
 bus=(bus:AudioBus)=>{if(!audioBuses.includes(bus))throw Error(`Unknown bus ${String(bus)}`);return this.overrides$.value[bus];};
 play=(key:string)=>{const entry=this.entries.get(key);if(!entry||this.dead)return;entry.wantsPlay=true;this.vary(entry);if(!this.paused)entry.voice?.play();};
 stop=(key:string)=>{const entry=this.entries.get(key);if(!entry)return;entry.wantsPlay=false;entry.fadeCommand$.next({to:1,seconds:0,stopAfter:false});entry.voice?.stop();};
 fade=(key:string,to:number,seconds:number,stopAfter=false)=>{
  const entry=this.entries.get(key);if(!entry||this.dead)return;if(!Number.isFinite(to)||to<0||to>1)throw Error('Fade target must be 0–1');if(!Number.isFinite(seconds)||seconds<0||seconds>60)throw Error('Fade time must be 0–60 s');
  const state=entry.voice?.snapshot.state;if(to>0&&state!=='playing'){entry.fade$.next(0);this.play(key);}
  entry.fadeCommand$.next({to,seconds,stopAfter});
 };
 state=(key:string)=>{const e=this.entries.get(key);return e?{state:e.state$.value,fade:e.fade$.value,beat:e.beat,position:e.voice?.position?.()??0,spatial:{...e.spatial}}:undefined;};
 /** Live gain of a source: its volume × bus × master × ducking × fade × variation × distance. */
 private volumeOf(e:Entry){const m=this.mixer$.value;return Math.max(0,Math.min(1,e.source.volume*m.master*m[e.source.bus]*this.overrides$.value[e.source.bus]*this.duck$.value[e.source.bus]*e.fade$.value*e.jitter.volume*e.spatial.gain));}
 private rateOf(e:Entry){return Math.max(.25,Math.min(4,e.source.rate*e.jitter.rate));}
 private vary(e:Entry){const {pitchJitter,volumeJitter}=e.source;e.jitter={rate:1+(this.random()*2-1)*pitchJitter,volume:1-this.random()*volumeJitter};this.apply(e);}
 private apply(e:Entry){e.voice?.setVolume?.(this.volumeOf(e));e.voice?.setRate?.(this.rateOf(e));e.voice?.setPan?.(e.spatial.pan);}
 /** Distance gain and pan of one source from the listener (an Audio Listener object, else the host's camera centre). */
 private place(e:Entry,entities:readonly Entity[],ear:Point|undefined){const at=e.source.spatial?worldPoint(entities,e.entityId):undefined;return spatialMix(e.source,at??ear??{x:0,y:0},ear??at??{x:0,y:0});}
 /** Each frame: spatial sources follow their objects and the listener; only changed gains and pans reach the voices. */
 private spatialize(){
  if(![...this.entries.values()].some(e=>e.source.spatial||e.spatial.pan!==e.source.pan))return;
  const entities=this.entities(),ear=listenerPoint(entities)??this.listener();
  for(const e of this.entries.values()){const next=this.place(e,entities,ear);if(Math.abs(next.gain-e.spatial.gain)<1e-4&&Math.abs(next.pan-e.spatial.pan)<1e-4)continue;e.spatial=next;this.apply(e);}
 }
 private applyAll(){for(const e of this.entries.values())this.apply(e);}
 /** Rebuilds the ducking streams for the current rules: playing count on the trigger bus → ramped gain on the target. */
 private ducking(){
  this.duckSubscription?.unsubscribe();const rules=this.mixer$.value.ducking,gains=new Map<string,number>(rules.map(r=>[r.id,1]));
  const publish=()=>{const next:Record<AudioBus,number>={music:1,sfx:1,ui:1};for(const r of rules)next[r.target]*=gains.get(r.id)??1;this.duck$.next(next);};
  this.duckSubscription=merge(...rules.map(rule=>this.playing$.pipe(map(p=>p[rule.trigger]>0),distinctUntilChanged(),switchMap(active=>ramp(this.frame$,gains.get(rule.id)??1,active?rule.amount:1,active?rule.attack:rule.release)),map(gain=>({id:rule.id,gain}))))).subscribe(({id,gain})=>{gains.set(id,gain);publish();});
  publish();
 }
 private recount(){const next:Record<AudioBus,number>={music:0,sfx:0,ui:0};for(const e of this.entries.values())if(e.state$.value==='playing')next[e.source.bus]++;const old=this.playing$.value;if(audioBuses.some(b=>old[b]!==next[b]))this.playing$.next(next);}
 private beats(){for(const e of this.entries.values()){if(!e.source.bpm||e.state$.value!=='playing'||!e.voice?.position)continue;const beat=Math.floor((e.voice.position()-e.source.beatOffset)*e.source.bpm/60);if(beat===e.beat)continue;e.beat=beat;if(beat>=0)this.events$.next({kind:'beat',key:e.key,entityId:e.entityId,beat,bar:beat%4===0});}}
 private remove(key:string){const e=this.entries.get(key);this.entries.delete(key);if(!e)return;for(const s of e.subscriptions)s.unsubscribe();e.unsubscribe?.();e.voice?.dispose();e.state$.complete();e.fade$.complete();e.fadeCommand$.complete();}
 private reconcile(){
  if(this.dead)return;const entities=this.entities(),byId=new Map(entities.map(e=>[e.id,e])),wanted=new Set<string>();let changed=false;
  for(const entity of entities){let parent:Entity|undefined=entity,active=true;while(parent){if(!parent.active){active=false;break;}parent=parent.parentId?byId.get(parent.parentId):undefined;}if(!active)continue;
   for(const component of entity.components){if(component.type!=='audio.source'||component.version!==1)continue;const key=component.id;wanted.add(key);let source:AudioSource|undefined,spec:VoiceSpec|undefined,error:unknown;
    try{source=AudioSourceSchema.parse(component.data);spec=this.resolve(source);}catch(e){error=e;}
    // Only the clip, looping and errors need a new voice; volume, rate, bus, tempo and variation are live.
    const signature=JSON.stringify([source?.assetId,source?.loop,spec?.url,spec?.format,error?String(error):null]),existing=this.entries.get(key);
    if(existing?.signature===signature){if(source&&JSON.stringify(source)!==JSON.stringify(existing.source)){existing.source=source;existing.spatial=this.place(existing,entities,listenerPoint(entities)??this.listener());this.apply(existing);this.recount();}continue;}
    this.remove(key);changed=true;
    const entry:Entry={key,entityId:entity.id,signature,wantsPlay:source?.autoplay??false,source:source??AudioSourceSchema.parse({assetId:'',volume:0,loop:false,rate:1,autoplay:false}),state$:new BehaviorSubject<AudioState>('loading'),fade$:new BehaviorSubject(1),fadeCommand$:new Subject(),jitter:{volume:1,rate:1},beat:-1,subscriptions:[],spatial:{gain:1,pan:0}};
    entry.spatial=this.place(entry,entities,listenerPoint(entities)??this.listener());
    this.entries.set(key,entry);
    entry.subscriptions.push(entry.fadeCommand$.pipe(switchMap(cmd=>ramp(this.frame$,entry.fade$.value,cmd.to,cmd.seconds).pipe(map(gain=>({gain,cmd}))))).subscribe(({gain,cmd})=>{entry.fade$.next(gain);this.apply(entry);if(gain===cmd.to&&cmd.stopAfter){entry.wantsPlay=false;entry.voice?.stop();entry.fade$.next(1);}}));
    entry.subscriptions.push(entry.state$.pipe(distinctUntilChanged()).subscribe(state=>{this.recount();if(state==='ended')this.events$.next({kind:'ended',key,entityId:entity.id});if(state!=='playing')entry.beat=-1;}));
    try{if(error)throw error;if(entry.wantsPlay)this.vary(entry);entry.voice=this.provider.create({...spec!,volume:this.volumeOf(entry),rate:this.rateOf(entry),pan:entry.spatial.pan});entry.unsubscribe=entry.voice.subscribe(()=>{if(this.dead||this.entries.get(key)!==entry)return;const state=entry.voice!.snapshot.state;if(state==='ended'||state==='error')entry.wantsPlay=false;entry.state$.next(state);this.changed();});entry.state$.next(entry.voice.snapshot.state);if(entry.wantsPlay&&!this.paused)entry.voice.play();}
    catch(e){entry.error={state:'error',starts:0,error:String(e)};entry.state$.next('error');}
   }
  }
  for(const key of [...this.entries.keys()])if(!wanted.has(key)){this.remove(key);changed=true;}
  if(changed){this.recount();this.changed();}
 }
 pause(){if(this.dead||this.paused)return;this.paused=true;for(const e of this.entries.values())e.voice?.pause();}
 resume(){if(this.dead||!this.paused)return;this.paused=false;for(const e of this.entries.values())if(e.wantsPlay)e.voice?.play();}
 dispose(){if(this.dead)return;this.dead=true;this.duckSubscription?.unsubscribe();this.mixSubscription?.unsubscribe();this.effectsSubscription?.unsubscribe();for(const b of audioBuses)this.provider.setBusEffects?.(b,noBusEffects);for(const key of [...this.entries.keys()])this.remove(key);this.frame$.complete();this.events$.complete();this.changed();}
}
