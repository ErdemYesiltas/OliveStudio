import {useEffect,useState,useSyncExternalStore} from 'react';
import {audioBuses,busEffects,BusEffectsSchema,type AudioController,type BusEffects,type VoiceSpec,type VoiceSnapshot} from './contracts';
const idle:VoiceSnapshot={state:'stopped',starts:0};
export function AudioControls({controller,sourceKey,spec,enabled,text,stopOnUnmount=true}:{stopOnUnmount?:boolean;controller:AudioController;sourceKey:string;spec?:VoiceSpec;enabled:boolean;text(key:string):string}){
 const state=useSyncExternalStore(controller.subscribe,()=>controller.snapshot(sourceKey)??idle);
 const signature=JSON.stringify(spec);
 useEffect(()=>()=>{if(stopOnUnmount)controller.stop(sourceKey);},[controller,sourceKey,signature,stopOnUnmount]);
 return <div className="audio-controls" data-audio-key={sourceKey} data-audio-state={state.state}>
  <button aria-label={text('audio.play')} disabled={!enabled} onClick={()=>controller.play(sourceKey,spec)}>{text('audio.playLabel')}</button>
  <button aria-label={text('audio.stop')} onClick={()=>controller.stop(sourceKey)}>{text('audio.stopLabel')}</button>
  <span role="status">{text(`audio.state.${state.state}`)}</span>{state.error&&<small className="component-warning">{state.error}</small>}
 </div>;
}
/** Project mix: master and bus gains. A slider previews while dragging and commits one undo step on release. */
export function createMixerPanel(bridge:{read():import('./contracts').Mixer;write(next:import('./contracts').Mixer):void;subscribe(listener:()=>void):()=>void;version():number;useEditable():boolean;text(key:string):string;
 /** While the game runs: per-bus effective gain (mix × runtime × ducking) and playing sounds; null in edit mode. */
 live?():Record<'music'|'sfx'|'ui',{gain:number;playing:number}>|null}){
 const channels=['master','music','sfx','ui'] as const;
 return function MixerPanel(){
  useSyncExternalStore(bridge.subscribe,bridge.version);
  const editable=bridge.useEditable(),mixer=bridge.read(),[draft,setDraft]=useState<Partial<Record<typeof channels[number],number>>>({});
  const commit=(key:typeof channels[number],value:number)=>{setDraft(d=>{const next={...d};delete next[key];return next;});if(mixer[key]!==value)bridge.write({...mixer,[key]:value});};
  const [levels,setLevels]=useState<ReturnType<NonNullable<typeof bridge.live>>|null>(null);
  useEffect(()=>{if(editable||!bridge.live){setLevels(null);return;}let frame=0,last='';const tick=()=>{const now=bridge.live?.()??null,key=JSON.stringify(now&&Object.values(now).map(v=>[Math.round(v.gain*100),v.playing]));if(key!==last){last=key;setLevels(now);}frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[editable]);
  return <div className="panel-body mixer-panel" data-testid="mixer-panel">
   <p className="panel-empty">{bridge.text('mixer.help')}</p>
   {levels&&<div className="mixer-meters" data-testid="mixer-meters" role="group" aria-label={bridge.text('mixer.live')}>{(Object.entries(levels) as [string,{gain:number;playing:number}][]).map(([bus,l])=><div className="mixer-meter" key={bus} data-bus={bus} data-gain={Math.round(l.gain*100)} data-playing={l.playing}><span>{bridge.text(`mixer.${bus}`)}</span><meter min={0} max={1} value={l.gain} aria-label={`${bridge.text(`mixer.${bus}`)} ${bridge.text('mixer.live')}`}/><output>{Math.round(l.gain*100)}% · {l.playing} ♪</output></div>)}</div>}
   {channels.map(key=>{const value=draft[key]??mixer[key];return <label className="field mixer-channel" key={key}><span>{bridge.text(`mixer.${key}`)}</span>
    <input type="range" min={0} max={1} step={0.01} aria-label={bridge.text(`mixer.${key}`)} disabled={!editable} value={value}
     onChange={e=>setDraft(d=>({...d,[key]:Number(e.target.value)}))} onPointerUp={e=>commit(key,Number(e.currentTarget.value))} onKeyUp={e=>commit(key,Number(e.currentTarget.value))} onBlur={e=>{if(draft[key]!==undefined)commit(key,Number(e.currentTarget.value));}}/>
    <output>{Math.round(value*100)}%</output></label>;})}
   <h3>{bridge.text('mixer.effects')}</h3>
   <p className="panel-empty">{bridge.text('mixer.effectsHelp')}</p>
   <div className="mixer-effects" data-testid="mixer-effects">{audioBuses.map(bus=>{const fx=busEffects(mixer,bus),label=(key:string)=>`${bridge.text(key)} ${bridge.text(`mixer.${bus}`)}`,set=(patch:Partial<BusEffects>)=>{const next=BusEffectsSchema.parse({...fx,...patch}),effects={...mixer.effects};if(next.lowpass>=20000&&next.reverb<=0&&next.reverbSeconds===2)delete effects[bus];else effects[bus]=next;bridge.write({...mixer,effects});};return <div className="mixer-effect inline-row" key={bus} data-bus={bus}>
    <strong>{bridge.text(`mixer.${bus}`)}</strong>
    <label className="field"><span>{bridge.text('mixer.lowpass')}</span><input type="number" aria-label={label('mixer.lowpass')} title={bridge.text('mixer.lowpassHint')} disabled={!editable} min={40} max={20000} step={10} key={`lp-${fx.lowpass}`} defaultValue={fx.lowpass} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} onBlur={e=>{const v=Number(e.currentTarget.value);if(Number.isFinite(v)&&v!==fx.lowpass)set({lowpass:Math.max(40,Math.min(20000,v))});}}/></label>
    <label className="field"><span>{bridge.text('mixer.reverb')}</span><input type="range" aria-label={label('mixer.reverb')} disabled={!editable} min={0} max={1} step={0.05} value={fx.reverb} onChange={e=>set({reverb:Number(e.target.value)})}/><output>{Math.round(fx.reverb*100)}%</output></label>
    <label className="field"><span>{bridge.text('mixer.reverbSeconds')}</span><input type="number" aria-label={label('mixer.reverbSeconds')} disabled={!editable||fx.reverb<=0} min={0.2} max={8} step={0.1} key={`rs-${fx.reverbSeconds}`} defaultValue={fx.reverbSeconds} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} onBlur={e=>{const v=Number(e.currentTarget.value);if(Number.isFinite(v)&&v!==fx.reverbSeconds)set({reverbSeconds:Math.max(.2,Math.min(8,v))});}}/></label>
   </div>;})}</div>
   <h3>{bridge.text('mixer.ducking')}</h3>
   <p className="panel-empty">{bridge.text('mixer.duckingHelp')}</p>
   <div className="mixer-ducking" data-testid="mixer-ducking">{(mixer.ducking??[]).map((d,i)=>{const update=(patch:Partial<typeof d>)=>{const next={...d,...patch};if(next.trigger===next.target)return;bridge.write({...mixer,ducking:mixer.ducking.map(x=>x.id===d.id?next:x)});},label=(key:string)=>`${bridge.text(key)} ${i+1}`;return <div className="mixer-duck" key={d.id} data-duck={d.id}>
    <label className="field"><span>{bridge.text('mixer.duckTrigger')}</span><select aria-label={label('mixer.duckTrigger')} disabled={!editable} value={d.trigger} onChange={e=>update({trigger:e.target.value as typeof d.trigger})}>{audioBuses.map(b=><option key={b} value={b} disabled={b===d.target}>{bridge.text(`mixer.${b}`)}</option>)}</select></label>
    <label className="field"><span>{bridge.text('mixer.duckTarget')}</span><select aria-label={label('mixer.duckTarget')} disabled={!editable} value={d.target} onChange={e=>update({target:e.target.value as typeof d.target})}>{audioBuses.map(b=><option key={b} value={b} disabled={b===d.trigger}>{bridge.text(`mixer.${b}`)}</option>)}</select></label>
    {(['amount','attack','release'] as const).map(key=><label className="field" key={key}><span>{bridge.text(`mixer.duck${key[0].toUpperCase()}${key.slice(1)}`)}</span><input type="number" aria-label={label(`mixer.duck${key[0].toUpperCase()}${key.slice(1)}`)} disabled={!editable} min={0} max={key==='amount'?1:key==='attack'?5:10} step={0.05} defaultValue={d[key]} key={`${d.id}-${key}-${d[key]}`} onBlur={e=>{const v=Number(e.target.value);if(Number.isFinite(v)&&v!==d[key])update({[key]:Math.max(0,Math.min(key==='amount'?1:key==='attack'?5:10,v))});}} onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}}/></label>)}
    <button aria-label={label('mixer.removeDuck')} title={bridge.text('mixer.removeDuck')} disabled={!editable} onClick={()=>bridge.write({...mixer,ducking:mixer.ducking.filter(x=>x.id!==d.id)})}>×</button>
   </div>;})}</div>
   <button disabled={!editable||(mixer.ducking??[]).length>=8} onClick={()=>bridge.write({...mixer,ducking:[...(mixer.ducking??[]),{id:crypto.randomUUID(),trigger:'sfx',target:'music',amount:.3,attack:.1,release:.5}]})}>{bridge.text('mixer.addDuck')}</button>
  </div>;
 };
}
