import {Howl,Howler} from 'howler';
import {providers,type EditorModule} from '@rewrite/sdk';
import {audioProviders,effectsActive,noBusEffects,reverbImpulse,type AudioBus,type AudioProvider,type AudioVoice,type BusEffects,type VoiceSnapshot,type VoiceSpec} from '@rewrite/audio/contracts';
/**
 * Bus effects on Howler's Web Audio graph. Each bus has one chain shared by its voices:
 * voice gain → bus input → (low-pass) → dry ─┐
 *                                    └─ convolver → wet ─┴→ Howler.masterGain
 * With no effects the input goes straight to the master (no filtering). The reverb's impulse is a seeded decaying
 * noise burst, rebuilt only when its length changes. Without Web Audio (HTML5 fallback) effects are skipped.
 */
interface BusChain{context:AudioContext;input:GainNode;filter:BiquadFilterNode;dry:GainNode;convolver:ConvolverNode;wet:GainNode;effects:BusEffects;impulse:number;voices:Set<number>}
const settings=new Map<AudioBus,BusEffects>(),chains=new Map<AudioBus,BusChain>();
function chainFor(bus:AudioBus):BusChain|undefined{
 const context=Howler.ctx as AudioContext|undefined,master=Howler.masterGain as GainNode|undefined;
 if(!Howler.usingWebAudio||!context||!master)return undefined;
 let chain=chains.get(bus);
 if(!chain||chain.context!==context){chain={context,input:context.createGain(),filter:context.createBiquadFilter(),dry:context.createGain(),convolver:context.createConvolver(),wet:context.createGain(),effects:noBusEffects,impulse:0,voices:new Set()};chain.filter.type='lowpass';chain.filter.Q.value=.707;chain.dry.connect(master);chain.wet.connect(master);chains.set(bus,chain);chain.effects={...noBusEffects,lowpass:-1};wire(chain,settings.get(bus)??noBusEffects);}
 return chain;
}
function wire(chain:BusChain,effects:BusEffects){
 const before=chain.effects;chain.effects=effects;
 if(before.lowpass>=20000===effects.lowpass>=20000&&before.reverb>0===effects.reverb>0&&before.lowpass!==-1){chain.filter.frequency.value=Math.min(20000,effects.lowpass);chain.wet.gain.value=effects.reverb;reverbFor(chain,effects);return;}
 for(const node of [chain.input,chain.filter,chain.convolver])node.disconnect();chain.convolver.connect(chain.wet);
 const head:AudioNode=effects.lowpass<20000?chain.filter:chain.input;if(head===chain.filter)chain.input.connect(chain.filter);
 head.connect(chain.dry);if(effects.reverb>0)head.connect(chain.convolver);
 chain.filter.frequency.value=Math.min(20000,effects.lowpass);chain.wet.gain.value=effects.reverb;reverbFor(chain,effects);
}
function reverbFor(chain:BusChain,effects:BusEffects){if(effects.reverb<=0||chain.impulse===effects.reverbSeconds)return;const rate=chain.context.sampleRate,channels=reverbImpulse(rate,effects.reverbSeconds),buffer=chain.context.createBuffer(2,channels[0].length,rate);channels.forEach((data,c)=>buffer.copyToChannel(data as Float32Array<ArrayBuffer>,c));chain.convolver.buffer=buffer;chain.impulse=effects.reverbSeconds;}
/** Sends a Howler sound's final gain node through its bus chain. */
function route(howl:Howl,id:number,bus:AudioBus|undefined){
 if(!bus)return;const chain=chainFor(bus),sound=(howl as unknown as {_soundById(id:number):{_node?:GainNode}|null})._soundById(id),node=sound?._node;
 if(!chain||!node)return;node.disconnect();node.connect(chain.input);chain.voices.add(id);
}
class HowlerVoice implements AudioVoice {
 private value:VoiceSnapshot={state:'loading',starts:0};private listeners=new Set<()=>void>();
 private dead=false;private intent:'play'|'pause'|'stop'='stop';private abort=new AbortController();private objectUrl?:string;private howl?:Howl;private soundId?:number;
 get snapshot(){return this.value;}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private publish(state:VoiceSnapshot['state'],error?:string){if(this.dead)return;this.value={state,starts:this.value.starts,...(error?{error}:{})};for(const fn of this.listeners)fn();}
 constructor(private spec:VoiceSpec){void this.load();}
 private async load(){try{
  const response=await fetch(this.spec.url,{signal:this.abort.signal});
  // Capacitor iOS answers same-origin media files with a status-less (0) response that still carries the body; opaque cross-origin responses are 0 too but empty.
  if(!response.ok&&!(response.status===0&&response.type==='basic'))throw Error('Audio source unavailable');const bytes=await response.arrayBuffer();if(!bytes.byteLength)throw Error('Audio source unavailable');if(bytes.byteLength>20*1024*1024)throw Error('Audio exceeds 20 MB');if(this.dead)return;
  // Unique URLs isolate Howler's shared URL cache/unload behavior between owners.
  this.objectUrl=URL.createObjectURL(new Blob([bytes],{type:this.spec.format==='wav'?'audio/wav':'audio/mpeg'}));
  this.howl=new Howl({src:[this.objectUrl],format:[this.spec.format],preload:false,html5:false,volume:this.spec.volume,rate:this.spec.rate,loop:this.spec.loop,
   onload:()=>{if(this.dead)return;if(this.intent==='play')this.play();else this.publish(this.intent==='pause'?'paused':'ready');},
   onloaderror:(_id,error)=>{this.intent='stop';this.publish('error',`Audio load failed: ${String(error)}`);},onplayerror:(id,error)=>{if(this.dead||id!==this.soundId||this.intent!=='play')return;this.intent='stop';this.howl?.stop();this.soundId=undefined;this.publish('error',`Audio playback failed: ${String(error)}. Try Play after unlocking audio.`);},
   onplay:(id)=>{if(this.dead||id!==this.soundId||this.intent!=='play')return;this.pan(id);route(this.howl!,id,this.spec.bus);this.value={...this.value,starts:this.value.starts+1};this.publish('playing');},
   onend:(id)=>{if(this.dead||id!==this.soundId||this.spec.loop||this.intent!=='play')return;for(const chain of chains.values())chain.voices.delete(id);this.intent='stop';this.soundId=undefined;this.publish('ended');},
  });this.howl.load();
 }catch(error){if(!this.dead&&!this.abort.signal.aborted){this.intent='stop';this.publish('error',String(error));}}}
 play(){if(this.dead)return;this.intent='play';if(this.value.state==='error'){this.soundId=undefined;this.publish('loading');if(!this.howl){void this.load();return;}if(this.howl.state()!=='loaded'){this.howl.load();return;}}if(this.howl?.state()!=='loaded'){this.publish('loading');return;}if(this.soundId!==undefined&&this.howl.playing(this.soundId))return;this.soundId=this.soundId===undefined?this.howl.play():this.howl.play(this.soundId);}
 pause(){if(this.dead||this.intent!=='play'||this.value.state==='error')return;this.intent='pause';if(this.soundId!==undefined)this.howl?.pause(this.soundId);this.publish('paused');}
 stop(){if(this.dead)return;this.intent='stop';if(this.soundId!==undefined){this.howl?.stop(this.soundId);for(const chain of chains.values())chain.voices.delete(this.soundId);}this.soundId=undefined;this.publish('stopped');}
 /** Live gain and rate: the running sound changes in place; later plays start with the new values. */
 setVolume(volume:number){if(this.dead||!Number.isFinite(volume))return;this.spec={...this.spec,volume};if(!this.howl)return;if(this.soundId!==undefined)this.howl.volume(volume,this.soundId);else this.howl.volume(volume);}
 setRate(rate:number){if(this.dead||!Number.isFinite(rate))return;this.spec={...this.spec,rate};if(!this.howl)return;if(this.soundId!==undefined)this.howl.rate(rate,this.soundId);else this.howl.rate(rate);}
 /** Stereo position −1…1 through Howler's stereo panner (Web Audio); later plays start at the same position. */
 setPan(pan:number){if(this.dead||!Number.isFinite(pan))return;this.spec={...this.spec,pan:Math.max(-1,Math.min(1,pan))};if(this.soundId!==undefined)this.pan(this.soundId);}
 private pan(id:number){if(!this.howl||this.spec.pan===undefined||(this.spec.pan===0&&!this.panned))return;this.panned=true;this.howl.stereo(this.spec.pan,id);}
 private panned=false;
 position(){if(!this.howl||this.soundId===undefined)return 0;const at=this.howl.seek(this.soundId);return typeof at==='number'&&Number.isFinite(at)?at:0;}
 dispose(){if(this.dead)return;if(this.soundId!==undefined)for(const chain of chains.values())chain.voices.delete(this.soundId);this.dead=true;this.intent='stop';this.abort.abort();this.listeners.clear();this.howl?.off();this.howl?.unload();if(this.objectUrl)URL.revokeObjectURL(this.objectUrl);}
}
export const howlerProvider:AudioProvider={id:'howler',supports:format=>['wav','mp3'].includes(format)&&Boolean(Howler.codecs(format)),create:spec=>new HowlerVoice(spec),
 setBusEffects(bus,effects){settings.set(bus,effects);const chain=chains.get(bus);if(chain)wire(chain,effects);else if(effectsActive(effects))chainFor(bus);},
 busEffects:()=>Object.fromEntries([...settings].map(([bus,effects])=>[bus,{...effects,voices:chains.get(bus)?.voices.size??0}]))};
export const howlerModule:EditorModule={manifest:{id:'howler',version:'1.0.0',apiVersion:1,requires:{audio:'^1'},entries:{runtime:'@rewrite/audio-howler'}},activate(c){c.contribute(audioProviders,'howler.adapter',howlerProvider);c.contribute(providers,'howler.descriptor',{id:'howler',service:'audio',version:'1.0.0',capabilities:['wav','mp3','independent-voices','pause-resume'],targets:['html','macos'],runtimeEntry:'@rewrite/audio-howler'});}};
