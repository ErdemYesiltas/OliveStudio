import {CommitInput,finiteNumber} from '@rewrite/ui/drafts';
import {useEffect,useState} from 'react';
import type {Entity,SceneService} from '@rewrite/scene';
import {TweenSchema,easings,totalDuration,channelValue,type TweenChannel,type TweenData} from './index';
export interface TweenUiBridge {scene:SceneService;channels():readonly TweenChannel[];useEditable():boolean;preview(id:string,time:number):void;clear(id:string):void;report(error:unknown):void;text(key:string):string}
function NumberField({label,value,change,disabled}:{label:string;value:number;change(v:number):void|boolean;disabled:boolean}){return <label className="field"><span>{label}</span><CommitInput label={label} type="number" step="any" value={value} disabled={disabled} commit={raw=>change(finiteNumber(raw))}/></label>;}

export function createTweenInspector(bridge:TweenUiBridge){
 return function TweenInspector({entity,component}:{entity:Entity;component:Entity['components'][number]}){
  const value=TweenSchema.parse(component.data),editable=bridge.useEditable(),[time,setTime]=useState(0),[previewing,setPreviewing]=useState(false),signature=JSON.stringify(component.data),text=bridge.text;
  useEffect(()=>{setTime(0);setPreviewing(false);bridge.clear(component.id);return()=>bridge.clear(component.id);},[component.id,signature,editable]);
  const change=(label:string,edit:(data:TweenData)=>void)=>{try{bridge.scene.document.transact(label,d=>{const c=d.entities.flatMap(e=>e.components).find(c=>c.id===component.id);if(!c)throw Error('Tween missing');const data=TweenSchema.parse(c.data);edit(data);c.data=TweenSchema.parse(data);});return true;}catch(error){bridge.report(error);return false;}};
  const options=(target:Entity|undefined)=>target?.components.flatMap(c=>bridge.channels().filter(k=>k.componentType===c.type&&k.version===c.version).map(channel=>({key:JSON.stringify([c.id,channel.property]),component:c,channel})))??[];
  const setBinding=(track:TweenData['tracks'][number],target:Entity,option:ReturnType<typeof options>[number])=>{track.entityId=target.id;track.componentId=option.component.id;track.property=option.channel.property;const data=option.component.data as Record<string,unknown>,current=channelValue(option.channel,data[track.property]);track.from=current;track.to=option.channel.max!==undefined?Math.min(option.channel.max,current+.25):current+100;};
  const scrub=(next:number)=>{try{bridge.preview(component.id,next);setTime(next);setPreviewing(true);}catch(error){bridge.report(error);}};
  return <div className="tween-inspector">
   <label className="field"><span>{text('tween.ease')}</span><select aria-label={text('tween.ease')} value={value.ease} disabled={!editable} onChange={e=>change('Change tween easing',v=>{v.ease=e.target.value as TweenData['ease'];})}>{easings.map(e=><option key={e} value={e}>{e}</option>)}</select></label>
   {value.tracks.map((track,index)=>{const target=bridge.scene.document.current.entities.find(e=>e.id===track.entityId),available=options(target),key=JSON.stringify([track.componentId,track.property]),valid=available.some(o=>o.key===key);return <fieldset key={track.id} className="tween-track"><legend>{text('tween.track')} {index+1}</legend>
    <label className="field"><span>{text('tween.target')}</span><select aria-label={`${text('tween.target')} ${index+1}`} disabled={!editable} value={track.entityId} onChange={e=>change('Change tween target',v=>{const next=bridge.scene.document.current.entities.find(n=>n.id===e.target.value)!,option=options(next)[0];if(option)setBinding(v.tracks[index],next,option);})}>{!target&&<option value={track.entityId}>{text('tween.missing')}</option>}{bridge.scene.document.current.entities.filter(e=>options(e).length).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <label className="field"><span>{text('tween.property')}</span><select aria-label={`${text('tween.property')} ${index+1}`} disabled={!editable} value={key} onChange={e=>change('Change tween property',v=>{const option=available.find(o=>o.key===e.target.value);if(target&&option)setBinding(v.tracks[index],target,option);})}>{!valid&&<option value={key}>{text('tween.missing')}</option>}{available.map(o=><option key={o.key} value={o.key}>{o.component.type} · {text(o.channel.titleKey)}</option>)}</select></label>
    {!valid&&<p className="component-warning">{text('tween.missing')}</p>}
    <NumberField label={`${text('tween.from')} ${index+1}`} value={track.from} disabled={!editable} change={n=>change('Change tween start',v=>{v.tracks[index].from=n;})}/>
    <NumberField label={`${text('tween.to')} ${index+1}`} value={track.to} disabled={!editable} change={n=>change('Change tween end',v=>{v.tracks[index].to=n;})}/>
    <button disabled={!editable} onClick={()=>change('Remove tween track',v=>{v.tracks.splice(index,1);})}>{text('tween.removeTrack')}</button>
   </fieldset>;})}
   <button disabled={!editable||value.tracks.length>=64} onClick={()=>change('Add tween track',v=>{const first=options(entity)[0];if(!first)throw Error('No numeric channel on entity');const track={id:crypto.randomUUID(),entityId:entity.id,componentId:first.component.id,property:first.channel.property,from:0,to:0};setBinding(track,entity,first);v.tracks.push(track);})}>{text('tween.addTrack')}</button>
   <div className="tween-scrub">{previewing&&<p className="tween-preview-hint">{text('tween.temporary')}</p>}<label>{text('tween.preview')}<input aria-label={text('tween.preview')} type="range" min="0" max={totalDuration(value)} step="any" value={time} disabled={!editable||!value.tracks.length} onChange={e=>scrub(Number(e.target.value))}/></label><output>{time.toFixed(3)} / {totalDuration(value).toFixed(3)} s</output><button disabled={!previewing} onClick={()=>{bridge.clear(component.id);setPreviewing(false);setTime(0);}}>{text('tween.reset')}</button></div>
  </div>;
 };
}
