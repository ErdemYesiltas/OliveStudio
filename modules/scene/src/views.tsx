import {Plus,Copy,Trash2,ArrowUp,ArrowDown,Group,Ungroup,PencilLine,ClipboardPaste} from 'lucide-react';
import {CommitInput,finiteNumber,isRelativeNumber,numberFrom,useDraftController} from '@rewrite/ui/drafts';
import {VirtualList} from '@rewrite/ui';
import {hierarchyRows,hierarchyTarget,searchHierarchy,visibleHierarchy,hierarchyAncestors} from './hierarchy';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { slot, type ComponentDefinition, type Json } from '@rewrite/sdk';
import { transformDefinition, spatialType, is2DEntity, labelColors, labelType, type Entity, type LabelColor, type SceneService } from './index';
/** Swatches for the editor colour labels (Layers rows). */
export const LABEL_SWATCHES:Record<LabelColor,string>={red:'#e5534b',orange:'#e0823d',yellow:'#d9b43a',green:'#57ab5a',blue:'#539bf5',purple:'#b083f0',gray:'#8b949e'};
/** Copied component (Properties): in memory for this editor window. */
let componentClip:{type:string;version:number;data:Json;title:string}|null=null;const clipListeners=new Set<()=>void>();
const subscribeClip=(l:()=>void)=>{clipListeners.add(l);return()=>{clipListeners.delete(l);};},setClip=(next:typeof componentClip)=>{componentClip=next;for(const l of clipListeners)l();};
export interface ComponentEditorProps{scene:SceneService;entityId:string;editable:boolean;text(key:string):string;report(error:unknown):void}
export interface ComponentEditor{type:string;version:number;view:React.ComponentType<ComponentEditorProps>}
export const componentEditors=slot<ComponentEditor>('scene.component-editors');
export interface SceneUiBridge {
 componentEditors?():readonly ComponentEditor[];
 text?(key:string):string;
 viewScope?():string;
 assetOptions?(type:string):readonly {id:string;name:string}[];
 entityExtra?(entity:import('./index').Entity):React.ReactNode;
 componentExtra?(entity:import('./index').Entity,component:import('./index').Entity['components'][number]):React.ReactNode;
 useSelection(): string|null; select(id:string|null,mode?:'replace'|'toggle'):void;
 /** Full selection, primary last. Optional so hosts without multi-selection keep working. */
 useSelectionSet?():readonly string[]; selectMany?(ids:readonly string[],additive:boolean):void;
 useFlags?():{hidden:ReadonlySet<string>;locked:ReadonlySet<string>}; toggleFlag?(kind:'hidden'|'locked',ids:readonly string[]):void;
 align?(kind:AlignKind):void;
 useEditable():boolean; /** Layers (structure: add, delete, reorder, reparent); defaults to useEditable. */useStructureEditable?():boolean; report(error:unknown):void;
 /** Transforms of objects being dragged on the canvas (not committed yet), so the fields follow the drag. */
 useDragging?():ReadonlyMap<string,Record<string,number>>;
}
export type AlignKind='left'|'hcenter'|'right'|'top'|'vmiddle'|'bottom'|'distribute-h'|'distribute-v';
const path=(d:string)=><path d={d}/>;
/** Minimal stroke icons (no icon dependency in this module). */
const ICONS:Record<string,React.ReactNode>={
 eye:<>{path('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z')}<circle cx="12" cy="12" r="3"/></>,
 eyeOff:<>{path('M3 3l18 18')}{path('M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.9 9.9 0 0 0 5.4-1.6')}</>,
 lock:<><rect x="5" y="11" width="14" height="10" rx="2"/>{path('M8 11V7a4 4 0 0 1 8 0v4')}</>,
 unlock:<><rect x="5" y="11" width="14" height="10" rx="2"/>{path('M8 11V7a4 4 0 0 1 7.8-1.2')}</>,
 left:<>{path('M4 3v18')}<rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/></>,
 hcenter:<>{path('M12 3v18')}<rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></>,
 right:<>{path('M20 3v18')}<rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/></>,
 top:<>{path('M3 4h18')}<rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/></>,
 vmiddle:<>{path('M3 12h18')}<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></>,
 bottom:<>{path('M3 20h18')}<rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/></>,
 'distribute-h':<>{path('M4 4v16M20 4v16')}<rect x="9.5" y="8" width="5" height="8" rx="1"/></>,
 'distribute-v':<>{path('M4 4h16M4 20h16')}<rect x="8" y="9.5" width="8" height="5" rx="1"/></>,
};
export function Icon({name}:{name:string}){return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</svg>;}
const ALIGN:readonly [AlignKind,string][]=[['left','Align left'],['hcenter','Align horizontal centers'],['right','Align right'],['top','Align top'],['vmiddle','Align vertical middles'],['bottom','Align bottom'],['distribute-h','Distribute horizontally'],['distribute-v','Distribute vertically']];
export function useScene(scene:SceneService) {
 useSyncExternalStore(scene.document.subscribe,()=>scene.document.version);
 return scene.document.current;
}
export function ComponentField({field,value,commit,disabled,options,label,missingAssetLabel}:{field:ComponentDefinition['fields'][number];value:Json;commit(value:Json):void;disabled:boolean;label:string;missingAssetLabel?:string;options?:readonly {id:string;name:string}[]}) {
 if(field.kind==='asset'||field.kind==='enum')return <label className="field"><span>{label}</span><select aria-label={field.key} value={String(value)} disabled={disabled} onChange={e=>commit(e.target.value)}>{field.kind==='asset'&&<option value="">None</option>}{field.kind==='asset'&&String(value)&&!options?.some(a=>a.id===String(value))&&<option value={String(value)}>{`${missingAssetLabel??'Missing asset'} · ${String(value)}`} </option>}{options?.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>;
 if(field.kind==='boolean')return <label className="field"><span>{label}</span><input type="checkbox" aria-label={field.key} checked={Boolean(value)} disabled={disabled} onChange={e=>commit(e.target.checked)}/></label>;
 return <label className="field"><span>{label}</span><CommitInput live label={field.key} type={field.kind==='color'?'color':field.kind==='number'?'number':'text'} step="any" disabled={disabled} value={field.kind==='number'&&typeof value==='number'?String(Number(value.toPrecision(8))):field.kind==='number'&&value==null?'0':String(value)} commit={raw=>commit(field.kind==='number'?finiteNumber(raw):raw)}/></label>;
}
export function createSceneViews(scene:SceneService,bridge:SceneUiBridge) {
 let layersQuery='',viewVersion=0;const collapsedScopes=new Map<string,ReadonlySet<string>>(),emptyCollapsed=new Set<string>(),viewListeners=new Set<()=>void>();
 const subscribeView=(listener:()=>void)=>{viewListeners.add(listener);return()=>{viewListeners.delete(listener);};},publishView=()=>{viewVersion++;for(const listener of viewListeners)listener();},setQuery=(next:string)=>{layersQuery=next;publishView();};
 const setCollapsed=(scope:string,next:ReadonlySet<string>)=>{collapsedScopes.set(scope,next);if(collapsedScopes.size>100)collapsedScopes.delete(collapsedScopes.keys().next().value!);publishView();};
 const change=(fn:()=>void)=>{try{fn();}catch(e){bridge.report(e);}};
 function Properties() {
  const document=useScene(scene),selected=bridge.useSelection(),chosen=bridge.useSelectionSet?.()??[],editable=bridge.useEditable(),entity=document.entities.find(e=>e.id===selected),dragging=bridge.useDragging?.(),clip=useSyncExternalStore(subscribeClip,()=>componentClip);
  const title=(type:string)=>{const d=scene.definitions().get(type);return d?(bridge.text?.(d.titleKey)??d.titleKey.replace('component.','')):type;};
  if(chosen.length>1)return <MultiProperties ids={chosen}/>;
  if(!entity)return <div className="panel-body"><p className="panel-empty">Select an object to inspect its components.</p></div>;
  return <div className="panel-body" data-testid="properties">
   <label className="field"><span>Name</span><CommitInput label="Object name" key={entity.id} value={entity.name} disabled={!editable} commit={raw=>scene.rename(entity.id,raw)} onError={bridge.report}/></label>
   <label className="field"><span>Active</span><input aria-label="Object active" type="checkbox" checked={entity.active} disabled={!editable} onChange={e=>change(()=>scene.setActive(entity.id,e.target.checked))}/></label>
   <label className="field"><span>Parent</span><select aria-label="Object parent" value={entity.parentId??''} disabled={!editable} onChange={e=>change(()=>scene.reparent(entity.id,e.target.value||null))}><option value="">Scene root</option>{document.entities.filter(e=>e.id!==entity.id).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
   {bridge.entityExtra?.(entity)}
   {entity.components.filter(c=>{const d=scene.definitions().get(c.type);return d?.version!==c.version||!d.hiddenInInspector;}).map(c=>{
    const definition=scene.definitions().get(c.type),supported=definition&&definition.version===c.version,Editor=bridge.componentEditors?.().find(e=>e.type===c.type&&e.version===c.version)?.view;
    const parsed=supported?definition.parse(c.data):c.data;const data={...(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{}),...(c.type===transformDefinition.type?dragging?.get(entity.id):undefined)};
    return <details key={c.id} className="component" open={c.type===spatialType(entity)}><summary>{definition?(bridge.text?.(definition.titleKey)??definition.titleKey.replace('component.','')):c.type}</summary>
     {!supported?<p className="component-warning">This component is preserved but cannot be edited: {c.type} v{c.version}.</p>:Editor?<Editor scene={scene} entityId={entity.id} editable={editable} text={key=>bridge.text?.(key)??key} report={bridge.report}/>:definition.fields.filter(field=>field.visible?.(c.data)??true).map(field=><ComponentField key={field.key} field={field} missingAssetLabel={bridge.text?.('asset.missingOption')} label={bridge.text?.(field.titleKey)??field.key} value={data[field.key]??null} disabled={!editable} options={field.kind==='asset'?bridge.assetOptions?.(field.assetType??''):field.options?.map(o=>({id:o.value,name:bridge.text?.(o.titleKey)??o.titleKey}))} commit={value=>scene.setField(entity.id,c.type,field.key,value)}/>)}
     {bridge.componentExtra?.(entity,c)}
     <div className="component-tools" role="group" aria-label={`${title(c.type)} tools`}><button aria-label={`Copy ${title(c.type)} component`} title="Copy component" onClick={()=>setClip({type:c.type,version:c.version,data:structuredClone(c.data),title:title(c.type)})}><Copy size={13}/></button>{c.type!==spatialType(entity)&&<><button aria-label={`Move ${title(c.type)} up`} title="Move up" disabled={!editable||entity.components.findIndex(x=>x.id===c.id)<=1} onClick={()=>change(()=>scene.moveComponent(entity.id,c.id,-1))}><ArrowUp size={13}/></button><button aria-label={`Move ${title(c.type)} down`} title="Move down" disabled={!editable||entity.components.findIndex(x=>x.id===c.id)===entity.components.length-1} onClick={()=>change(()=>scene.moveComponent(entity.id,c.id,1))}><ArrowDown size={13}/></button><button disabled={!editable} onClick={()=>change(()=>scene.removeComponent(entity.id,c.type))}>Remove component</button></>}</div>
    </details>;
   })}
   <div className="panel-actions">{clip&&<button aria-label={`Paste ${clip.title} component`} title={entity.components.some(c=>c.type===clip.type)?`Replace this object's ${clip.title} values`:`Add the copied ${clip.title}`} disabled={!editable} onClick={()=>change(()=>scene.pasteComponent(entity.id,clip))}><ClipboardPaste size={14}/> {`Paste ${clip.title}`}</button>}<select aria-label="Add component" value="" disabled={!editable} onChange={e=>{const value=e.target.value;if(value)change(()=>scene.addComponent(entity.id,value));}}><option value="">+ Add component</option>{[...scene.definitions().values()].filter(d=>d.addable!==false&&!entity.components.some(c=>c.type===d.type)&&!(d.uniqueInScene&&scene.document.current.entities.some(e=>e.components.some(c=>c.type===d.type)))).map(d=><option value={d.type} key={d.type}>{bridge.text?.(d.titleKey)??d.type}</option>)}</select></div>
  </div>;
 }
 function MultiProperties({ids}:{ids:readonly string[]}) {
  const document=useScene(scene),editable=bridge.useEditable(),flags=bridge.useFlags?.(),t=(key:string,fallback:string)=>bridge.text?.(key)??fallback;
  const entities=ids.flatMap(id=>document.entities.filter(e=>e.id===id)) as Entity[];
  const dragging=bridge.useDragging?.(),transforms=entities.map(e=>({...(e.components.find(c=>c.type===transformDefinition.type)?.data??{}) as Record<string,unknown>,...dragging?.get(e.id)}));
  const common=(key:string)=>{const of=(v:(typeof transforms)[number])=>v[key as 'x']??0;return transforms.every(v=>of(v)===of(transforms[0]))&&transforms.length?of(transforms[0]):undefined;};
  const all2D=entities.every(is2DEntity);
  const active=entities.every(e=>e.active)?true:entities.every(e=>!e.active)?false:'mixed';
  const allHidden=Boolean(flags)&&ids.every(id=>flags!.hidden.has(id)),allLocked=Boolean(flags)&&ids.every(id=>flags!.locked.has(id));
  return <div className="panel-body" data-testid="properties" data-multi={entities.length}>
   <p className="selection-summary" role="status">{entities.length} {t('selection.objects','objects selected')}</p>
   {bridge.align&&<div className="align-tools" role="toolbar" aria-label={t('align.tools','Align and distribute')}>{ALIGN.map(([kind,label])=><button key={kind} aria-label={t(`align.${kind}`,label)} title={t(`align.${kind}`,label)} disabled={!editable||!all2D||(kind.startsWith('distribute')&&entities.length<3)} onClick={()=>change(()=>bridge.align!(kind))}><Icon name={kind}/></button>)}</div>}
   <label className="field"><span>Active</span><input aria-label="Objects active" type="checkbox" ref={el=>{if(el)el.indeterminate=active==='mixed';}} checked={active===true} disabled={!editable} onChange={e=>change(()=>scene.setActiveMany(ids,e.target.checked))}/></label>
   {all2D&&<details className="component" open><summary>{bridge.text?.(transformDefinition.titleKey)??'Transform'}</summary>
    {transformDefinition.fields.map(field=>{const value=common(field.key);return <label key={field.key} className="field"><span>{bridge.text?.(field.titleKey)??field.key}</span><CommitInput live label={field.key} type="number" step="any" placeholder={value===undefined?t('selection.mixed','Mixed'):undefined} value={value===undefined?'':String(value)} disabled={!editable} commit={raw=>{if(value===undefined&&isRelativeNumber(raw))scene.adjustFieldMany(ids,transformDefinition.type,field.key,v=>numberFrom(raw,v));else scene.setFieldMany(ids,transformDefinition.type,field.key,finiteNumber(raw));}} onError={bridge.report}/></label>;})}
   </details>}
   <div className="panel-actions">
    {bridge.toggleFlag&&<button aria-pressed={allHidden} onClick={()=>bridge.toggleFlag!('hidden',ids)}><Icon name={allHidden?'eyeOff':'eye'}/> {allHidden?t('layers.showSelected','Show'):t('layers.hideSelected','Hide')}</button>}
    {bridge.toggleFlag&&<button aria-pressed={allLocked} onClick={()=>bridge.toggleFlag!('locked',ids)}><Icon name={allLocked?'lock':'unlock'}/> {allLocked?t('layers.unlockSelected','Unlock'):t('layers.lockSelected','Lock')}</button>}
    <button disabled={!editable} onClick={()=>change(()=>bridge.selectMany?.(scene.duplicateMany(ids),false))}>{t('layers.duplicate','Duplicate')}</button>
    <button disabled={!editable} onClick={()=>change(()=>{scene.removeMany(ids);bridge.select(null);})}>{t('layers.delete','Delete')}</button>
   </div>
  </div>;
 }
 function Layers() {
  const document=useScene(scene),selected=bridge.useSelection(),editable=(bridge.useStructureEditable??bridge.useEditable)(),container=useRef<HTMLDivElement>(null),scope=bridge.viewScope?.()??document.id;
  useSyncExternalStore(subscribeView,()=>viewVersion);const drafts=useDraftController(),query=layersQuery,collapsed=collapsedScopes.get(scope)??emptyCollapsed;
  const allRows=useMemo(()=>hierarchyRows(document.entities),[document.entities]),result=useMemo(()=>searchHierarchy(allRows,query),[allRows,query]),searching=Boolean(query.trim()),rows=useMemo(()=>searching?result.rows:visibleHierarchy(result.rows,collapsed),[result,searching,collapsed]),rowKey=useCallback((row:ReturnType<typeof hierarchyRows>[number])=>row.entity.id,[]);
  const selectedEntity=document.entities.find(e=>e.id===selected),siblings=selectedEntity?document.entities.filter(e=>e.parentId===selectedEntity.parentId):[],siblingIndex=siblings.findIndex(e=>e.id===selected);
  const t=(key:string,fallback:string)=>bridge.text?.(key)??fallback;
  const chosen=bridge.useSelectionSet?.()??(selected?[selected]:[]),chosenSet=useMemo(()=>new Set(chosen),[chosen]),flags=bridge.useFlags?.(),multiple=chosen.length>1;
  const [drop,setDrop]=useState<{id:string;zone:'before'|'inside'|'after'}|null>(null),dragging=useRef<readonly string[]|null>(null);
  const [renaming,setRenaming]=useState<{pattern:string;start:string}|null>(null);
  const labelOf=(e:Entity)=>{const c=e.components.find(c=>c.type===labelType)?.data as {color?:LabelColor}|undefined;return c?.color;};
  const plainGroups=chosen.length>0&&chosen.every(id=>{const e=document.entities.find(x=>x.id===id);return Boolean(e)&&e!.components.every(c=>c.type===transformDefinition.type)&&document.entities.some(x=>x.parentId===id);});
  const commonLabel=(()=>{const labels=new Set(chosen.map(id=>{const e=document.entities.find(x=>x.id===id);return e?labelOf(e)??'':'';}));return labels.size===1?[...labels][0]:'mixed';})();
  const pick=(id:string,event:React.MouseEvent)=>{
   if(event.metaKey||event.ctrlKey){bridge.select(id,'toggle');return;}
   if(event.shiftKey&&selected&&bridge.selectMany){const a=rows.findIndex(r=>r.entity.id===selected),b=rows.findIndex(r=>r.entity.id===id);if(a>=0&&b>=0){const range=rows.slice(Math.min(a,b),Math.max(a,b)+1).map(r=>r.entity.id).filter(x=>x!==id);bridge.selectMany([...range,id],false);return;}}
   bridge.select(id);
  };
  const zoneOf=(event:React.DragEvent)=>{const r=event.currentTarget.getBoundingClientRect(),y=(event.clientY-r.top)/Math.max(1,r.height);return y<.25?'before' as const:y>.75?'after' as const:'inside' as const;};
  const dropOn=(target:Entity,zone:'before'|'inside'|'after',ids:readonly string[])=>change(()=>{drafts?.flush();if(zone==='inside'){scene.place(ids,target.id,null);return;}const siblings=document.entities.filter(x=>x.parentId===target.parentId&&!ids.includes(x.id)),i=siblings.findIndex(x=>x.id===target.id);scene.place(ids,target.parentId,zone==='before'?target.id:siblings[i+1]?.id??null);});
  const flagTargets=(id:string)=>chosenSet.has(id)?chosen:[id];
  const focusRow=(id:string)=>requestAnimationFrame(()=>container.current?.querySelector<HTMLButtonElement>(`[data-entity-id="${CSS.escape(id)}"] [data-entity-select]`)?.focus({preventScroll:true}));
  useLayoutEffect(()=>{const hidden=hierarchyAncestors(allRows,selected).filter(id=>collapsed.has(id));if(!hidden.length)return;const next=new Set(collapsed);for(const id of hidden)next.delete(id);setCollapsed(scope,next);},[selected,allRows,scope]);
  const toggle=(id:string)=>{const next=new Set(collapsed);if(next.has(id))next.delete(id);else{next.add(id);if(hierarchyAncestors(allRows,selected).includes(id))bridge.select(id);}setCollapsed(scope,next);focusRow(id);};
  const move=(event:React.KeyboardEvent)=>{if(!['ArrowDown','ArrowUp','Home','End','ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const focused=(event.target as HTMLElement).closest<HTMLElement>('[data-entity-id]')?.dataset.entityId,index=rows.findIndex(r=>r.entity.id===(focused??selected)),current=rows[index];if(current&&!searching&&current.hasChildren&&((event.key==='ArrowLeft'&&!collapsed.has(current.entity.id))||(event.key==='ArrowRight'&&collapsed.has(current.entity.id)))){toggle(current.entity.id);return;}const next=rows[hierarchyTarget(rows,index,event.key)];if(!next)return;bridge.select(next.entity.id);focusRow(next.entity.id);};
  return <div className="panel-body collection-panel" ref={container} data-testid="layers-panel"><h3>{document.name}</h3>
   <div className="hierarchy-search"><input type="search" aria-label={t('layers.search','Search objects')} placeholder={t('layers.searchHint','Name or component type')} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if((e.key==='ArrowDown'||e.key==='Enter')&&!e.nativeEvent.isComposing&&rows.length){e.preventDefault();bridge.select(rows[0].entity.id);requestAnimationFrame(()=>container.current?.querySelector<HTMLButtonElement>('[data-entity-id] [data-entity-select]')?.focus());}}}/>{query&&<button aria-label={t('layers.clearSearch','Clear object search')} onClick={()=>{setQuery('');container.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();}}>{t('layers.clear','Clear')}</button>}</div>
   {searching&&<small className="hierarchy-search-status" role="status" data-testid="layers-search-status">{t('layers.matches','Matches')}: {result.matches} / {document.entities.length}{rows.length>result.matches&&<> · {t('layers.context','With ancestors')}: {rows.length}</>}</small>}

   <div className="hierarchy-content" onKeyDown={move}><VirtualList items={rows} itemKey={rowKey} activeKey={selected} label={t('layers.objects','Scene objects')} testId="layers-list" resetKey={query} render={({entity:e,depth,hasChildren})=><div className="entity-row" data-entity-id={e.id} data-label={labelOf(e)} data-selected={chosenSet.has(e.id)} data-primary={selected===e.id} data-hidden={flags?.hidden.has(e.id)||undefined} data-locked={flags?.locked.has(e.id)||undefined} data-drop={drop?.id===e.id?drop.zone:undefined} style={{paddingLeft:Math.min(depth,12)*12,boxShadow:labelOf(e)?`inset 3px 0 0 ${LABEL_SWATCHES[labelOf(e)!]}`:undefined}}
   draggable={editable&&!searching} onDragStart={ev=>{const ids=chosenSet.has(e.id)?chosen:[e.id];dragging.current=ids;ev.dataTransfer.effectAllowed='move';ev.dataTransfer.setData('application/x-pixi-entities',JSON.stringify(ids));}}
   onDragOver={ev=>{if(!dragging.current)return;ev.preventDefault();ev.dataTransfer.dropEffect='move';const zone=zoneOf(ev);if(drop?.id!==e.id||drop.zone!==zone)setDrop({id:e.id,zone});}}
   onDrop={ev=>{ev.preventDefault();const ids=dragging.current,zone=zoneOf(ev);dragging.current=null;setDrop(null);if(ids&&!ids.includes(e.id))dropOn(e,zone,ids);}} onDragEnd={()=>{dragging.current=null;setDrop(null);}}>{hasChildren?<button className="hierarchy-disclosure" aria-label={`${searching||!collapsed.has(e.id)?t('layers.collapse','Collapse'):t('layers.expand','Expand')} ${e.name}`} aria-expanded={searching||!collapsed.has(e.id)} disabled={searching} title={searching?t('layers.searchExpanded','Search keeps matching paths expanded'):undefined} onClick={()=>toggle(e.id)}><span aria-hidden="true">{searching||!collapsed.has(e.id)?'⌄':'›'}</span></button>:<span className="hierarchy-disclosure-spacer" aria-hidden="true"/>}<button data-entity-select="true" aria-label={`Select ${e.name}`} aria-pressed={chosenSet.has(e.id)} aria-description={[!e.active?t('layers.inactive','Inactive object'):'',searching&&!result.matchedIds.has(e.id)?t('layers.ancestor','Ancestor of a matching object'):''].filter(Boolean).join(' · ')||undefined} title={e.name} onClick={ev=>pick(e.id,ev)}><span style={{color:e.active?'inherit':'var(--muted)',opacity:flags?.hidden.has(e.id)?.55:1}}><span aria-hidden="true">{e.active?'◇':'◌'}</span> &nbsp;{e.name}</span></button>{flags&&bridge.toggleFlag&&<span className="row-flags"><button className="row-flag" data-active={flags.hidden.has(e.id)} aria-label={`${t('layers.hide','Hide')} ${e.name}`} aria-pressed={flags.hidden.has(e.id)} title={t('layers.hideHint','Hide in the editor (Preview and export are unaffected)')} onClick={()=>bridge.toggleFlag!('hidden',flagTargets(e.id))}><Icon name={flags.hidden.has(e.id)?'eyeOff':'eye'}/></button><button className="row-flag" data-active={flags.locked.has(e.id)} aria-label={`${t('layers.lock','Lock')} ${e.name}`} aria-pressed={flags.locked.has(e.id)} title={t('layers.lockHint','Lock against canvas selection')} onClick={()=>bridge.toggleFlag!('locked',flagTargets(e.id))}><Icon name={flags.locked.has(e.id)?'lock':'unlock'}/></button></span>}</div>}/></div>
   {!rows.length&&<p className="panel-empty">{searching?t('layers.noMatches','No matching objects. Try a name or component type.'):t('layers.empty','Your scene is empty. Add an entity or a shape to begin.')}</p>}
   <div className="panel-actions hierarchy-actions"><button aria-label={t('layers.create','+ Entity')} disabled={!editable} onClick={()=>change(()=>bridge.select(scene.create()))}><Plus size={14}/>{t('layers.newEntity','Entity')}</button>{selected&&<><button aria-label={t('layers.moveUp','Move object up')} title={t('layers.moveUpHint','Move up · draw behind the previous sibling')} disabled={!editable||multiple||siblingIndex<=0} onClick={()=>change(()=>{drafts?.flush();scene.moveSibling(selected,-1);})}><ArrowUp size={14}/></button><button aria-label={t('layers.moveDown','Move object down')} title={t('layers.moveDownHint','Move down · draw in front of the next sibling')} disabled={!editable||multiple||siblingIndex<0||siblingIndex===siblings.length-1} onClick={()=>change(()=>{drafts?.flush();scene.moveSibling(selected,1);})}><ArrowDown size={14}/></button><button aria-label={t('layers.duplicate','Duplicate')} data-tip={t('layers.duplicate','Duplicate')} disabled={!editable} onClick={()=>change(()=>{const copies=scene.duplicateMany(chosen);if(bridge.selectMany)bridge.selectMany(copies,false);else bridge.select(copies[0]);})}><Copy size={14}/></button><button aria-label={t('layers.delete','Delete')} data-tip={t('layers.delete','Delete')} disabled={!editable} onClick={()=>change(()=>{scene.removeMany(chosen);bridge.select(null);})}><Trash2 size={14}/></button>
   <button aria-label={t('layers.group','Group selection')} data-tip={t('layers.groupHint','Group (⌘G): wrap in a new object')} disabled={!editable} onClick={()=>change(()=>{drafts?.flush();bridge.select(scene.group(chosen));})}><Group size={14}/></button><button aria-label={t('layers.ungroup','Ungroup')} data-tip={t('layers.ungroupHint','Ungroup (⌘⇧G): release the children of plain groups')} disabled={!editable||!plainGroups} onClick={()=>change(()=>{drafts?.flush();const ids=scene.ungroup(chosen);if(bridge.selectMany&&ids.length)bridge.selectMany(ids,false);else bridge.select(ids[0]??null);})}><Ungroup size={14}/></button><button aria-label={t('layers.rename','Rename objects…')} data-tip={t('layers.renameHint','Rename: {n} numbers, {name} keeps the old name')} aria-expanded={Boolean(renaming)} disabled={!editable} onClick={()=>setRenaming(r=>r?null:{pattern:chosen.length>1?(document.entities.find(e=>e.id===chosen[0])?.name.replace(/\s*\d+$/,'')||'Object')+' {n}':(selectedEntity?.name??'Object'),start:'1'})}><PencilLine size={14}/></button><select aria-label={t('layers.label','Colour label')} value={commonLabel==='mixed'?'':commonLabel} disabled={!editable} onChange={ev=>{const v=ev.target.value as LabelColor|'none'|'';if(v)change(()=>scene.setLabel(chosen,v==='none'?null:v));}}><option value="" disabled>{t('layers.labelNone','Label')}</option><option value="none">{t('layers.labelClear','No label')}</option>{labelColors.map(c=><option key={c} value={c}>{c[0].toUpperCase()+c.slice(1)}</option>)}</select></>}</div>
   {renaming&&selected&&<form className="layers-rename" aria-label={t('layers.rename','Rename objects…')} onSubmit={ev=>{ev.preventDefault();change(()=>{drafts?.flush();scene.renameMany(chosen,renaming.pattern,Number(renaming.start)||1);setRenaming(null);});}}><input aria-label={t('layers.renamePattern','Name pattern')} value={renaming.pattern} onChange={ev=>setRenaming({...renaming,pattern:ev.target.value})} onKeyDown={ev=>{if(ev.key==='Escape'){ev.preventDefault();setRenaming(null);}}} autoFocus/><input aria-label={t('layers.renameStart','First number')} type="number" min="0" step="1" value={renaming.start} onChange={ev=>setRenaming({...renaming,start:ev.target.value})}/><small>{chosen.length} · {'{n}'} {'{nn}'} {'{name}'}</small><button type="submit">{t('layers.renameApply','Rename')}</button></form>}</div>;
 }

 return {Properties,Layers};
}
