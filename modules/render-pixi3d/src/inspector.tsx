import {useSyncExternalStore} from 'react';
import {CommitInput,finiteNumber} from '@rewrite/ui/drafts';
import {transform3D} from '@rewrite/scene3d';
import type {ComponentEditorProps} from '@rewrite/scene/views';
import {eulerOf,withEuler,type Axis} from './math';
export function SpatialInspector({scene,entityId,editable,text,report}:ComponentEditorProps){
 const document=useSyncExternalStore(scene.document.subscribe,()=>scene.document.current),entity=document.entities.find(e=>e.id===entityId);if(!entity)return null;const pose=transform3D(entity),angles=eulerOf(pose);
 return <>{(['position','rotation','scale'] as const).map(group=><fieldset className="spatial3d-fields" key={group}><legend>{text('scene3d.'+group)}</legend>{(['x','y','z'] as Axis[]).map(axis=>{
  const key=group==='scale'?({x:'scaleX',y:'scaleY',z:'scaleZ'} as const)[axis]:axis,value=group==='rotation'?angles[axis]:pose[key];
  return <label className="field" key={axis}><span>{axis.toUpperCase()}{group==='rotation'?' °':''}</span><CommitInput label={`${text('scene3d.'+group)} ${axis.toUpperCase()}`} value={String(Math.round(value*1e6)/1e6)} disabled={!editable} type="number" step="any" commit={raw=>{const value=finiteNumber(raw),next=group==='rotation'?withEuler(pose,{...angles,[axis]:value}):{...pose,[key]:value};scene.setSpatial(entityId,next,pose,entity.parentId);}} onError={report}/></label>;
 })}</fieldset>)}</>;
}
