import type {TweenChannel} from '@rewrite/tween/contracts';
import {z} from 'zod';
import {slot} from '@rewrite/sdk';
export const audioImporter={id:'audio.files',assetType:'audio.clip',titleKey:'audio.import',extensions:['wav','mp3']as const};
export const audioBuses=['music','sfx','ui']as const;
export type AudioBus=typeof audioBuses[number];
/** `bus` is optional in stored data; older sources play on the effects bus. */
export const AudioSourceSchema=z.object({assetId:z.uuid().or(z.literal('')),volume:z.number().min(0).max(1),loop:z.boolean(),rate:z.number().min(.25).max(4),autoplay:z.boolean(),voiceLimit:z.number().int().min(1).max(16).default(1),bus:z.enum(audioBuses).default('sfx'),
 /** Beat sync: tempo of the clip (0 = none) and where its first beat starts (seconds). */
 bpm:z.number().min(0).max(400).default(0),beatOffset:z.number().min(0).max(60).default(0),
 /** Variation per play: random pitch (rate ± amount) and volume (down to 1 − amount). */
 pitchJitter:z.number().min(0).max(.5).default(0),volumeJitter:z.number().min(0).max(1).default(0),
 /** Stereo position −1 (left) … 1 (right); spatial sources add their position to it. */
 pan:z.number().min(-1).max(1).default(0),
 /** 2D spatial sound: quieter with distance from the listener (full inside minDistance, rolloff out to maxDistance) and panned by side. */
 spatial:z.boolean().default(false),minDistance:z.number().min(0).max(100000).default(100),maxDistance:z.number().min(1).max(100000).default(1000),
 rolloff:z.enum(['linear','inverse','exponential']).default('linear'),
 /** How much the side of the listener pans the sound (0 = only distance, 1 = fully left/right at half the max distance). */
 panAmount:z.number().min(0).max(1).default(1)}).strict();
/** The listener's ears: spatial sources are heard from the first active object with this component (else the camera centre). */
export const AudioListenerSchema=z.object({}).strict();
export interface Point {x:number;y:number}
/**
 * Gain and pan of a source at `at` heard from `ear` (world pixels). Inside minDistance the gain is 1; then linear falls
 * to 0 at maxDistance, inverse is min/d and exponential (min/d)², both held at their maxDistance value beyond it.
 */
export function spatialMix(s:Pick<AudioSource,'spatial'|'minDistance'|'maxDistance'|'rolloff'|'pan'|'panAmount'>,at:Point,ear:Point):{gain:number;pan:number}{
 if(!s.spatial)return{gain:1,pan:s.pan};
 const min=Math.max(0,s.minDistance),max=Math.max(min+1,s.maxDistance),dx=at.x-ear.x,d=Math.min(max,Math.hypot(dx,at.y-ear.y));
 const gain=d<=min?1:s.rolloff==='linear'?1-(d-min)/(max-min):s.rolloff==='inverse'?Math.max(1,min)/Math.max(1,d):(Math.max(1,min)/Math.max(1,d))**2;
 const side=Math.max(-1,Math.min(1,dx/(max/2)))*s.panAmount;
 return{gain:Math.max(0,Math.min(1,gain)),pan:Math.max(-1,Math.min(1,s.pan+side))};
}
/** Project mix: master and per-bus gains, applied as source volume × bus × master. */
export const mixerSection='audio.mixer';
/** Sidechain ducking: while anything plays on `trigger`, the `target` bus goes to `amount` × its gain (attack/release in seconds). */
export const DuckSchema=z.object({id:z.string().min(1),trigger:z.enum(audioBuses),target:z.enum(audioBuses),amount:z.number().min(0).max(1),attack:z.number().min(0).max(5),release:z.number().min(0).max(10)}).strict().refine(d=>d.trigger!==d.target,'A bus cannot duck itself');
export type Duck=z.infer<typeof DuckSchema>;
/** A bus's effects: a low-pass filter (cutoff in Hz; 20000 = off) and a reverb (wet level 0–1, tail length in seconds). */
export const BusEffectsSchema=z.object({lowpass:z.number().min(40).max(20000).default(20000),reverb:z.number().min(0).max(1).default(0),reverbSeconds:z.number().min(.2).max(8).default(2)}).strict();
export type BusEffects=z.infer<typeof BusEffectsSchema>;
export const noBusEffects:BusEffects={lowpass:20000,reverb:0,reverbSeconds:2};
export const MixerSchema=z.object({version:z.literal(1),master:z.number().min(0).max(1),music:z.number().min(0).max(1),sfx:z.number().min(0).max(1),ui:z.number().min(0).max(1),ducking:z.array(DuckSchema).max(8).default([]),
 /** Effects per bus (absent: none). */
 effects:z.object({music:BusEffectsSchema.optional(),sfx:BusEffectsSchema.optional(),ui:BusEffectsSchema.optional()}).strict().optional()}).strict();
export type Mixer=z.infer<typeof MixerSchema>;
export const defaultMixer:Mixer={version:1,master:1,music:1,sfx:1,ui:1,ducking:[]};
export function busGain(mixer:Mixer|undefined,bus:AudioBus):number{return mixer?mixer.master*mixer[bus]:1;}
/** A bus's effects in a mix (none when unset). */
export const busEffects=(mixer:Mixer|undefined,bus:AudioBus):BusEffects=>({...noBusEffects,...mixer?.effects?.[bus]});
/** Whether effects change the sound (a cutoff below 20 kHz or some reverb). */
export const effectsActive=(e:BusEffects)=>e.lowpass<20000||e.reverb>0;
/**
 * A decaying stereo noise burst for a convolution reverb: `seconds` long, amplitude (1 − t)^decay, from a seeded
 * generator so every run sounds the same.
 */
export function reverbImpulse(sampleRate:number,seconds:number,channels=2,decay=3,seed=1):Float32Array[]{
 const length=Math.max(1,Math.round(sampleRate*seconds)),out:Float32Array[]=[];let s=seed>>>0||1;const rand=()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};
 for(let c=0;c<channels;c++){const data=new Float32Array(length);for(let i=0;i<length;i++)data[i]=(rand()*2-1)*Math.pow(1-i/length,decay);out.push(data);}
 return out;
}
export type AudioSource=z.infer<typeof AudioSourceSchema>;
export const AudioMetadataSchema=z.object({format:z.enum(['wav','mp3']),duration:z.number().positive().max(600),sampleRate:z.number().int().min(8000).max(192000),channels:z.number().int().min(1).max(2),codec:z.string().min(1),processedBytes:z.number().int().positive(),pipeline:z.string().min(1)}).strict();
export type AudioState='loading'|'ready'|'playing'|'paused'|'stopped'|'ended'|'error';
export interface VoiceSnapshot {state:AudioState;error?:string;starts:number}
export interface VoiceSpec {url:string;format:'wav'|'mp3';volume:number;rate:number;loop:boolean;voiceLimit?:number;/** Stereo position −1…1. */pan?:number;/** Mixer bus whose effects the voice goes through. */bus?:AudioBus}
export interface AudioVoice {
 readonly snapshot:VoiceSnapshot;
 subscribe(listener:()=>void):()=>void;
 play():void;pause():void;stop():void;dispose():void;
 /** Live changes without restarting (providers that cannot do this get a new voice instead). */
 setVolume?(volume:number):void;setRate?(rate:number):void;
 /** Live stereo position −1 (left) … 1 (right). */
 setPan?(pan:number):void;
 /** Playback position in seconds (beat sync). */
 position?():number;
}
export interface AudioProvider {id:string;supports(format:string):boolean;create(spec:VoiceSpec):AudioVoice;
 /** Bus effects (providers without an audio graph ignore them). */
 setBusEffects?(bus:AudioBus,effects:BusEffects):void;
 /** What the provider applies now, per bus (diagnostics). */
 busEffects?():Partial<Record<AudioBus,BusEffects&{voices:number}>>}
export const audioProviders=slot<AudioProvider>('audio.providers');
export interface AudioController {subscribe(listener:()=>void):()=>void;snapshot(key:string):VoiceSnapshot|undefined;play(key:string,spec?:VoiceSpec):void;stop(key:string):void}
/** Reactive runtime audio (fades, buses, state) for interactions and scripts. */
export interface AudioControls {
 play(key:string):void;stop(key:string):void;
 /** Ramp the source's fade gain to `to` (0–1) over `seconds`; fading in starts a stopped source, `stopAfter` stops it at the end. */
 fade(key:string,to:number,seconds:number,stopAfter?:boolean):void;
 /** Runtime bus gain on top of the project mix (1 = as mixed). */
 setBus(bus:AudioBus,gain:number):void;bus(bus:AudioBus):number;
 state(key:string):{state:AudioState;fade:number;beat:number;position:number;spatial?:{gain:number;pan:number}}|undefined;
}
/** Runtime audio events: a source ended, or crossed a beat (bar every 4 beats). */
export interface AudioEvent {kind:'ended'|'beat';key:string;entityId:string;beat?:number;bar?:boolean}

export const audioTweenChannels:readonly TweenChannel[]=[
 {componentType:'audio.source',version:1,property:'volume',titleKey:'audio.volume',min:0,max:1,defaultValue:1},
 {componentType:'audio.source',version:1,property:'rate',titleKey:'audio.rate',min:.25,max:4,defaultValue:1},
];
