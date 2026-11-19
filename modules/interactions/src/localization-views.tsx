import {useSyncExternalStore} from 'react';
import {LanguageIdSchema, LocalizationSchema, StringKeySchema, applyTranslations, codeDirection, languageDirection, fileLanguage, languageName, mergeI18nextJson, missingTranslations, toI18nextJson, type Localization, type TranslateProgress, type TranslateRequest} from './localization';
export {missingTranslations, applyTranslations, type TranslateRequest, type TranslateProgress};

/** Text field that commits on Enter or blur; `commit` may throw to reject (the field then reverts). */
export function TextInput({label,value,disabled,commit,report,placeholder,dir}:{label:string;value:string;disabled:boolean;commit(v:string):void;report(e:unknown):void;placeholder?:string;dir?:'ltr'|'rtl'|'auto'}){
 return <input aria-label={label} key={value} defaultValue={value} placeholder={placeholder} disabled={disabled} dir={dir} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} onBlur={e=>{const next=e.currentTarget.value;if(next===value)return;try{commit(next);}catch(error){e.currentTarget.value=value;report(error);}}}/>;
}

interface Bridge{read():Localization;write(next:Localization,label?:string):void;subscribe(listener:()=>void):()=>void;version():number;useEditable():boolean;text(key:string):string;report(e:unknown):void;previewLanguage():string;setPreviewLanguage(id:string):void;
 /** i18next resource files: picked JSON files, and writing `{lng}.json` files into a chosen folder. */
 importFiles?():Promise<{name:string;folder:string;text:string}[]>;exportFiles?(files:{name:string;text:string}[]):Promise<string|null>;
 /** Machine translation with the local language model; resolves to key → text. */
 translate?(request:TranslateRequest,progress:(p:TranslateProgress)=>void,signal:AbortSignal):Promise<Record<string,string>>;
 /** Plain (not yet localized) texts of the edited scene, and moving them into the table as {@key} (one undo step). */
 useSceneTexts?():readonly {componentId:string;object:string;text:string}[];localize?(componentIds:readonly string[]):void;
}

/**
 * Localization panel (i18next): languages, keyed texts per language (plural forms as `key_one`/`key_other`…, notes for
 * translators), i18next JSON import/export, and AI translation of missing texts with review. Every table change is one
 * undo step; the preview language only affects Preview. A translation keeps running while the panel is closed.
 */
/** Texts in the edited scene that are still plain text: Make key moves each into the table as {@key}. */
function SceneTexts({use,localize,editable,t}:{use():readonly {componentId:string;object:string;text:string}[];localize(ids:readonly string[]):void;editable:boolean;t(key:string):string}){
 const texts=use();
 return <fieldset className="scene-texts" data-testid="scene-texts" data-count={texts.length}><legend>{t('localization.sceneTexts').replace('{n}',String(texts.length))}</legend>
  {!texts.length?<p className="panel-empty">{t('localization.sceneTextsNone')}</p>:<>
   {texts.slice(0,50).map(x=><div className="inline-row" key={x.componentId} data-component={x.componentId}><span title={x.text}><strong>{x.object}</strong> · {x.text.length>40?x.text.slice(0,39)+'…':x.text}</span><button aria-label={`${t('localization.makeKey')} ${x.object}`} disabled={!editable} onClick={()=>localize([x.componentId])}>{t('localization.makeKey')}</button></div>)}
   <button disabled={!editable} onClick={()=>localize(texts.map(x=>x.componentId))}>{t('localization.makeKeys').replace('{n}',String(texts.length))}</button>
  </>}
 </fieldset>;
}
export function createLocalizationPanel(bridge:Bridge){
 type Job={lng:string;progress:TranslateProgress;abort?:AbortController};
 let job:Job|null=null,message='';const listeners=new Set<()=>void>();
 const notify=()=>{for(const l of listeners)l();},subscribe=(l:()=>void)=>{listeners.add(l);return()=>{listeners.delete(l);};};
 const translate=async(lng:string)=>{
  if(!bridge.translate||job?.progress.phase==='running')return;
  const request=missingTranslations(bridge.read(),lng),total=request.items.length+request.plurals.length;
  const abort=new AbortController();job={lng,progress:{phase:'running',done:0,total},abort};message='';notify();
  if(!total){job={lng,progress:{phase:'done',done:0,total:0,message:bridge.text('localization.nothingMissing')}};notify();return;}
  try{
   const result=await bridge.translate(request,p=>{if(job?.abort===abort){job={...job,progress:p};notify();}},abort.signal);
   const out=applyTranslations(bridge.read(),request,result);
   if(out.written)bridge.write(out.table,`Translate to ${request.to.name}`);
   job={lng,progress:{phase:'done',done:total,total,message:bridge.text('localization.translated').replace('{n}',String(out.written)).replace('{language}',request.to.name)+(out.refused.length?' '+bridge.text('localization.refused').replace('{keys}',out.refused.slice(0,8).join(', ')):'')}};
  }catch(error){job={lng,progress:{phase:abort.signal.aborted?'cancelled':'failed',done:job?.progress.done??0,total,message:error instanceof Error?error.message:String(error)}};}
  notify();
 };
 const importFiles=async()=>{
  const files=await bridge.importFiles?.();if(!files?.length)return;
  let table=bridge.read();const notes:string[]=[];
  for(const f of files){const lng=fileLanguage(f);let json:unknown;try{json=JSON.parse(f.text);}catch{throw Error(`${f.name}: not valid JSON`);}const r=mergeI18nextJson(table,lng,json);table=r.table;notes.push(`${lng}: +${r.added} / ${r.updated}${r.skipped.length?` (${bridge.text('localization.skipped')} ${r.skipped.slice(0,5).join(', ')})`:''}`);}
  bridge.write(table,'Import i18next JSON');message=`${bridge.text('localization.imported')} ${notes.join(' · ')}`;notify();
 };
 const exportFiles=async()=>{const table=bridge.read(),dir=await bridge.exportFiles?.(table.languages.map(l=>({name:`${l.id}.json`,text:JSON.stringify(toI18nextJson(table,l.id),null,2)+'\n'})));if(dir){message=bridge.text('localization.exported').replace('{folder}',dir);notify();}};
 const run=(work:()=>Promise<void>)=>{work().catch(bridge.report);};

 return function LocalizationPanel(){
  useSyncExternalStore(bridge.subscribe,bridge.version);const value=bridge.read(),editable=bridge.useEditable(),t=bridge.text;
  useSyncExternalStore(subscribe,()=>job);useSyncExternalStore(subscribe,()=>message);
  const write=(fn:(next:Localization)=>void,label?:string)=>{const next=structuredClone(value);fn(next);bridge.write(LocalizationSchema.parse(next),label);};
  const safe=(fn:(next:Localization)=>void)=>{try{write(fn);}catch(e){bridge.report(e);}};
  const preview=value.languages.some(l=>l.id===bridge.previewLanguage())?bridge.previewLanguage():value.defaultLanguage;
  const running=job?.progress.phase==='running';
  const missing=(lng:string)=>{const r=missingTranslations(value,lng);return r.items.length+r.plurals.length;};
  const reviews=value.entries.reduce((n,e)=>n+(e.review?.length??0),0);
  return <div className="panel-body localization-panel" data-testid="localization-panel">
   <p className="panel-empty">{t('localization.help')}</p>
   <div className="panel-actions">
    {bridge.importFiles&&<button disabled={!editable} onClick={()=>run(importFiles)}>{t('localization.import')}</button>}
    {bridge.exportFiles&&<button disabled={!value.entries.length} onClick={()=>run(exportFiles)}>{t('localization.export')}</button>}
   </div>
   {message&&<p className="panel-empty" role="status" data-testid="localization-message">{message}</p>}
   <fieldset><legend>{t('localization.languages')}</legend>
    {value.languages.map((l,i)=><div className="inline-row localization-language" key={l.id} data-language={l.id} data-missing={l.id===value.defaultLanguage?0:missing(l.id)}>
     <TextInput label={`${t('localization.code')} ${l.id}`} value={l.id} disabled={!editable} report={bridge.report} commit={id=>write(next=>{LanguageIdSchema.parse(id);next.languages[i].id=id;if(next.defaultLanguage===l.id)next.defaultLanguage=id;for(const e of next.entries){if(l.id in e.values){e.values[id]=e.values[l.id];delete e.values[l.id];}if(e.review)e.review=e.review.map(x=>x===l.id?id:x);}})}/>
     <TextInput label={`${t('localization.name')} ${l.id}`} value={l.name} disabled={!editable} report={bridge.report} commit={name=>write(next=>{next.languages[i].name=name.trim();})}/>
     <select aria-label={`${t('localization.direction')} ${l.id}`} title={t('localization.directionHint')} value={l.direction??''} disabled={!editable} onChange={e=>write(next=>{const v=e.target.value;if(v==='ltr'||v==='rtl')next.languages[i].direction=v;else delete next.languages[i].direction;})}><option value="">{t('localization.directionAuto')} ({codeDirection(l.id)==='rtl'?'RTL':'LTR'})</option><option value="ltr">LTR</option><option value="rtl">RTL</option></select>
     <label className="checkbox" title={t('localization.default')}><input type="radio" name="default-language" aria-label={`${t('localization.default')} ${l.id}`} checked={value.defaultLanguage===l.id} disabled={!editable} onChange={()=>safe(next=>{next.defaultLanguage=l.id;})}/></label>
     {bridge.translate&&l.id!==value.defaultLanguage&&<button aria-label={`${t('localization.translateMissing')} ${l.id}`} title={`${t('localization.translateMissing')} (${missing(l.id)})`} disabled={!editable||running||!missing(l.id)} onClick={()=>run(()=>translate(l.id))}>✨ {missing(l.id)}</button>}
     <button aria-label={`${t('localization.removeLanguage')} ${l.id}`} disabled={!editable||value.languages.length<2} onClick={()=>safe(next=>{next.languages.splice(i,1);if(next.defaultLanguage===l.id)next.defaultLanguage=next.languages[0].id;for(const e of next.entries){delete e.values[l.id];if(e.review){e.review=e.review.filter(x=>x!==l.id);if(!e.review.length)delete e.review;}}})}>×</button>
    </div>)}
    <button disabled={!editable||value.languages.length>=64} onClick={()=>safe(next=>{const used=new Set(next.languages.map(l=>l.id));const id=['tr','de','fr','es','it','pt','ja','ko','zh','ru','ar','nl'].find(c=>!used.has(c))??'xx';next.languages.push({id,name:languageName(id)});})}>{t('localization.addLanguage')}</button>
    <label className="field"><span>{t('localization.preview')}</span><select aria-label={t('localization.preview')} value={preview} onChange={e=>bridge.setPreviewLanguage(e.target.value)}>{value.languages.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
   </fieldset>
   {job&&<p className={`prompt-writer-status ${job.progress.phase}`} role="status" data-testid="translate-status" data-phase={job.progress.phase} data-language={job.lng}>
    {running&&<span className="spinner" aria-hidden="true"/>}
    {running?t('localization.translating').replace('{done}',String(job.progress.done)).replace('{total}',String(job.progress.total)):job.progress.message??t(`localization.phase.${job.progress.phase}`)}
    {running&&<button onClick={()=>job?.abort?.abort()}>{t('localization.cancelTranslate')}</button>}
   </p>}
   {bridge.useSceneTexts&&bridge.localize&&<SceneTexts use={bridge.useSceneTexts} localize={ids=>{try{bridge.localize!(ids);}catch(e){bridge.report(e);}}} editable={editable} t={t}/>}
   {reviews>0&&<div className="panel-actions"><span className="panel-empty">{t('localization.reviewCount').replace('{n}',String(reviews))}</span><button disabled={!editable} onClick={()=>safe(next=>{for(const e of next.entries)delete e.review;})}>{t('localization.approveAll')}</button></div>}
   <fieldset><legend>{t('localization.strings')}</legend>
    {value.entries.map((e,i)=><div className="localization-entry" key={e.key} data-key={e.key} data-review={(e.review??[]).join(' ')}>
     <div className="inline-row"><TextInput label={`${t('localization.key')} ${i+1}`} value={e.key} disabled={!editable} report={bridge.report} commit={key=>write(next=>{StringKeySchema.parse(key);next.entries[i].key=key;})}/><button aria-label={`${t('localization.removeString')} ${e.key}`} disabled={!editable} onClick={()=>safe(next=>{next.entries.splice(i,1);})}>×</button></div>
     {value.languages.map(l=>{const review=e.review?.includes(l.id);return <label className={`field${review?' localization-review':''}`} key={l.id}><span>{l.id}{review&&<em title={t('localization.reviewHint')}> AI</em>}</span>
      <TextInput label={`${e.key} ${l.id}`} value={e.values[l.id]??''} dir={languageDirection(value,l.id)} disabled={!editable} report={bridge.report} commit={text=>write(next=>{const x=next.entries[i];if(text)x.values[l.id]=text;else delete x.values[l.id];if(x.review){x.review=x.review.filter(id=>id!==l.id);if(!x.review.length)delete x.review;}})}/>
      {review&&<button aria-label={`${t('localization.approve')} ${e.key} ${l.id}`} title={t('localization.approve')} disabled={!editable} onClick={e2=>{e2.preventDefault();safe(next=>{const x=next.entries[i];x.review=x.review?.filter(id=>id!==l.id);if(!x.review?.length)delete x.review;});}}>✓</button>}
     </label>;})}
     <TextInput label={`${t('localization.note')} ${e.key}`} placeholder={t('localization.noteHint')} value={e.note??''} disabled={!editable} report={bridge.report} commit={note=>write(next=>{if(note.trim())next.entries[i].note=note.trim();else delete next.entries[i].note;})}/>
    </div>)}
    <button disabled={!editable||value.entries.length>=5000} onClick={()=>safe(next=>{const keys=new Set(next.entries.map(e=>e.key));let n=next.entries.length+1;while(keys.has(`text${n}`))n++;next.entries.push({key:next.entries.length?`text${n}`:'title',values:{}});})}>{t('localization.addString')}</button>
   </fieldset>
  </div>;
 };
}
