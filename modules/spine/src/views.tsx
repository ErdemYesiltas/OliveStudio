import {useSyncExternalStore} from 'react';
import type {AssetRecord,AssetService} from '@rewrite/assets';
import type {Entity,SceneService} from '@rewrite/scene';
import type {SpineService} from './index';
import {SpineSchema,SpineMetadataSchema} from './contracts';
export function createSpineViews(bridge:{scene:SceneService;assets:AssetService;service:SpineService;useEditable():boolean;text(key:string):string;report(error:unknown):void;refresh():void}){
 const {text:t}=bridge;
 function Inspector({entity,component}:{entity:Entity;component:Entity['components'][number]}){
  const editable=bridge.useEditable(),p=SpineSchema.parse(component.data),asset=bridge.assets.get(p.assetId),metadata=SpineMetadataSchema.safeParse(asset?.metadata),time=useSyncExternalStore(bridge.service.subscribe,()=>bridge.service.frame(component.id).time);
  const run=(fn:()=>void)=>{try{fn();bridge.refresh();}catch(e){bridge.report(e);}};
  const duration=metadata.success?metadata.data.animations.find(a=>a.name===(p.animation||metadata.data.animations[0]?.name))?.duration??0:0;
  return <div className="spine-controls">
   {!metadata.success?<p className="component-warning">{t('spine.missing')}</p>:<>
    {(['skin','animation']as const).map(key=>{const options=key==='skin'?metadata.data.skins:metadata.data.animations.map(a=>a.name);return <label className="field" key={key}><span>{t(`spine.${key}`)}</span><select aria-label={`Spine ${key}`} disabled={!editable} value={p[key]} onChange={e=>run(()=>bridge.scene.document.transact('Change Spine '+key,d=>{const target=d.entities.find(a=>a.id===entity.id)!.components.find(c=>c.id===component.id)!;target.data=SpineSchema.parse({...SpineSchema.parse(target.data),[key]:e.target.value});}))}><option value="">{t('spine.default')}</option>{p[key]&&!options.includes(p[key])&&<option value={p[key]}>{t('spine.missing')}: {p[key]}</option>}{options.map(name=><option key={name} value={name}>{name}</option>)}</select></label>;})}
    <small>{metadata.data.version} · {metadata.data.bones} {t('spine.bones')}</small>
    <label className="field"><span>{t('spine.time')}</span><input type="range" aria-label={t('spine.time')} min="0" max={Math.max(duration,1)} step="0.01" value={time} disabled={!editable} onChange={e=>{const value=Number(e.target.value);run(()=>bridge.service.seek(component.id,value));}}/></label>
    <div className="panel-actions"><button disabled={!editable} aria-label={t('spine.preview')} onClick={()=>run(()=>bridge.service.playPreview(component.id))}>{t('spine.preview')}</button><button disabled={!editable} onClick={()=>run(()=>{bridge.service.clearPreview(component.id);})}>{t('spine.reset')}</button></div>
   </>}
  </div>;
 }
 function AssetInfo({asset}:{asset:AssetRecord}){const meta=SpineMetadataSchema.safeParse(asset.metadata);return meta.success?<small>Spine {meta.data.version} · {meta.data.bones} {t('spine.bones')} · {meta.data.animations.length} {t('spine.animations')}</small>:null;}
 return{Inspector,AssetInfo};
}
