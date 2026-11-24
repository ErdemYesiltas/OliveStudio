import {CommitInput} from '@rewrite/ui/drafts';
import {useCallback,useEffect,useMemo,useState,useSyncExternalStore,type ReactNode} from 'react';
import {VirtualList} from '@rewrite/ui';
import type {AssetReferenceIssue} from './references';
import {useDndContext,useDraggable,useDroppable} from '@dnd-kit/core';
import {Upload,RefreshCw,ShieldCheck,LayoutGrid,List,Image as ImageIcon,Music,File,Eye,Folder as FolderIcon,FolderPlus,Inbox,Layers,Pencil,Send,Tag,Trash2,X} from 'lucide-react';
import {type AssetImporter,type AssetRecord,type AssetService} from './index';
import {addTags,createFolder,deleteFolder,entryOf,filterAssets,folderPath,kindOf,moveAssets,moveFolder,removeTag,renameFolder,tagCounts,viewCounts,type AssetKind,type Library,type LibraryQuery,type LibraryView} from './library';

export interface AssetUiBridge {
 useEditable():boolean;report(error:unknown):void;text(key:string):string;
 importers():readonly {id:string;value:AssetImporter}[];
 use(asset:AssetRecord):void;canUse(asset:AssetRecord):boolean;
 extra?(asset:AssetRecord):ReactNode;placeholder?(asset:AssetRecord):ReactNode;
 thumbnail(asset:AssetRecord,cacheEpoch:number):string|undefined;
 /** Full-size preview image (textures). */
 image?(asset:AssetRecord,cacheEpoch:number):string|undefined;
 references?():readonly AssetReferenceIssue[];
 /** Where each asset is used (scene or prefab, object, component). */
 useUsage?():ReadonlyMap<string,readonly {scope:string;entity:string;component:string}[]>;
 /** Extra preview details, e.g. how a generated asset was made. */
 details?(asset:AssetRecord):ReactNode;
 rebuild():Promise<void>;
}
const KINDS:readonly AssetKind[]=['image','audio','font','spine','model'];
type Ui={view:LibraryView;text:string;tags:string[];kinds:AssetKind[];usage:''|'used'|'unused';sort:NonNullable<LibraryQuery['sort']>;selected:string[];preview:string|null;confirm:string[]|null;renaming:string|null;mode:'grid'|'list'};

/**
 * Library panel: folders (nested, drag assets onto them), tags, filters (kind, usage, tags, text), sorting, bulk
 * actions, a preview with details, the Generated inbox (send to the Library or discard), adding files of any supported
 * type and deleting assets. Organisation lives in the editor-only `assets.library` section; every change is one undo step.
 */
export function createAssetView(service:AssetService,bridge:AssetUiBridge){
 let initialMode:'grid'|'list'='grid';try{if(localStorage.getItem('rewrite:library-mode')==='list')initialMode='list';}catch{/* Storage may be unavailable in embedded hosts. */}
 let ui:Ui={view:{kind:'all'},text:'',tags:[],kinds:[],usage:'',sort:'added',selected:[],preview:null,confirm:null,renaming:null,mode:initialMode};
 const listeners=new Set<()=>void>(),set=(patch:Partial<Ui>)=>{if(patch.mode)try{localStorage.setItem('rewrite:library-mode',patch.mode);}catch{/* Keep the view usable without persistent storage. */}ui={...ui,...patch};for(const l of listeners)l();};
 const subscribe=(l:()=>void)=>{listeners.add(l);return()=>{listeners.delete(l);};};
 const t=bridge.text,run=(work:()=>void|Promise<void>)=>{try{const r=work();if(r)r.catch(bridge.report);}catch(error){bridge.report(error);}};
 const edit=(label:string,fn:(lib:Library)=>Library)=>run(()=>service.editLibrary(label,fn));
 /** Folder the current view stands for (where new folders and sent assets go). */
 const currentFolder=()=>ui.view.kind==='folder'&&service.library.folders.some(f=>f.id===(ui.view as {id:string}).id)?(ui.view as {id:string}).id:null;
 const send=(ids:readonly string[],folderId=currentFolder())=>edit(ids.length===1?'Send to Library':`Send ${ids.length} assets to Library`,lib=>moveAssets(lib,ids,folderId));
 const remove=(ids:readonly string[])=>run(()=>{service.remove(ids);set({selected:ui.selected.filter(id=>!ids.includes(id)),preview:ids.includes(ui.preview??'')?null:ui.preview,confirm:null});});
 const newFolder=()=>edit('New folder',lib=>{const parent=currentFolder();let n=1,name=t('library.newFolderName');while(lib.folders.some(f=>f.parentId===parent&&f.name.toLowerCase()===name.toLowerCase()))name=`${t('library.newFolderName')} ${++n}`;const r=createFolder(lib,name,parent);set({view:{kind:'folder',id:r.id},renaming:r.id});return r.library;});

 function FolderButton({view,label,count,depth=0,icon}:{view:LibraryView;label:string;count:number;depth?:number;icon:ReactNode}){
  const key=view.kind==='folder'?view.id:view.kind,{setNodeRef,isOver}=useDroppable({id:`folder:${key}`,disabled:view.kind==='all'||view.kind==='inbox'});
  const current=ui.view.kind===view.kind&&(view.kind!=='folder'||(ui.view as {id:string}).id===view.id);
  return <button ref={setNodeRef} className={`library-folder${isOver?' drop':''}`} style={{['--indent' as string]:`${8+depth*14}px`}} data-depth={depth} aria-current={current?'true':undefined} data-folder={key} onClick={()=>set({view,selected:[],preview:null})}>{icon}<span>{label}</span><small>{count}</small></button>;
 }
 function Folders({lib,items}:{lib:Library;items:readonly AssetRecord[]}){
  const counts=useMemo(()=>viewCounts(items,lib),[items,lib]);
  const tree=(parent:string|null,depth:number):ReactNode[]=>lib.folders.filter(f=>f.parentId===parent).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(f=>[
   ui.renaming===f.id?<CommitInput key={f.id} label={t('library.folderName')} autoFocus value={f.name} commit={raw=>service.editLibrary('Rename folder',l=>renameFolder(l,f.id,raw))} onCommitted={()=>set({renaming:null})} onError={bridge.report}/>
   :<FolderButton key={f.id} view={{kind:'folder',id:f.id}} label={f.name} count={counts.folders[f.id]??0} depth={depth} icon={<FolderIcon size={14}/>}/>,
   ...tree(f.id,depth+1)]);
  return <nav className="library-folders" aria-label={t('library.folders')}>
   <FolderButton view={{kind:'all'}} label={t('library.all')} count={counts.all} icon={<Layers size={14}/>}/>
   <FolderButton view={{kind:'inbox'}} label={t('library.inbox')} count={counts.inbox} icon={<Inbox size={14}/>}/>
   <FolderButton view={{kind:'unfiled'}} label={t('library.unfiled')} count={counts.unfiled} icon={<FolderIcon size={14}/>}/>
   {tree(null,0)}
   <button className="library-new-folder" aria-label={t('library.newFolder')} data-tip={t('library.newFolder')} disabled={!bridge.useEditable()} onClick={newFolder}><FolderPlus size={14}/><span>{t('library.newFolder')}</span></button>
  </nav>;
 }
 function Tags({id,tags,editable}:{id:string;tags:readonly string[];editable:boolean}){
  const [draft,setDraft]=useState('');
  return <div className="library-tags" aria-label={t('library.tags')}>
   {tags.map(tag=><span key={tag} className="library-tag">{tag}<button aria-label={`${t('library.removeTag')} ${tag}`} disabled={!editable} onClick={()=>edit('Remove tag',lib=>removeTag(lib,[id],tag))}><X size={11}/></button></span>)}
   <input aria-label={t('library.addTag')} placeholder={t('library.addTag')} value={draft} disabled={!editable} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&draft.trim()){e.preventDefault();const tags=draft.split(',').map(s=>s.trim()).filter(Boolean);edit('Add tag',lib=>addTags(lib,[id],tags));setDraft('');}}}/>
  </div>;
 }
 function Card({asset,cacheEpoch,working,lib}:{asset:AssetRecord;cacheEpoch:number;working:boolean;lib:Library}){
  const editable=bridge.useEditable(),[renaming,setRenaming]=useState(false),[imageFailed,setImageFailed]=useState(false),entry=entryOf(lib,asset.id);
  const {attributes,listeners:drag,setNodeRef,isDragging}=useDraggable({id:`asset:${asset.id}`,data:{assetId:asset.id},disabled:!editable||(service.busy||working)});
  const importer=bridge.importers().find(i=>i.value.assetType===asset.type);
  const source=bridge.thumbnail(asset,cacheEpoch),health=service.health.get(asset.id),selected=ui.selected.includes(asset.id);
  useEffect(()=>{setImageFailed(false);},[source,cacheEpoch]);
  return <article className={`asset-card${selected?' selected':''}${ui.preview===asset.id?' previewed':''}`} data-testid={`asset-${asset.id}`} data-asset-name={asset.name} data-inbox={entry.inbox?'true':undefined} style={{opacity:isDragging?.45:1}}>
   <label className="asset-check" data-tip={t('library.select')}><input type="checkbox" aria-label={`${t('library.select')} ${asset.name}`} checked={selected} onChange={e=>set({selected:e.target.checked?[...ui.selected,asset.id]:ui.selected.filter(id=>id!==asset.id)})}/></label>
   <button ref={setNodeRef} className="asset-thumbnail" aria-label={`${t('asset.place')} ${asset.name}`} disabled={!editable||(service.busy||working)||!bridge.canUse(asset)} {...attributes} {...drag} onClick={()=>bridge.use(asset)}>
    {source&&!imageFailed?<img key={source} src={source} alt={asset.name} draggable={false} onError={()=>setImageFailed(true)}/>:<span className="asset-placeholder">{bridge.placeholder?.(asset)??'◇'}</span>}
   </button>
   {renaming?<CommitInput label={t('asset.name')} autoFocus value={asset.name} disabled={!editable||service.busy||working} commit={raw=>service.rename(asset.id,raw)} onCommitted={()=>setRenaming(false)} onError={bridge.report}/>:<button className="asset-name" aria-label={`${t('asset.rename')} ${asset.name}`} disabled={!editable||service.busy||working} onClick={()=>{setRenaming(true);}}>{asset.name}</button>}
   <small>{asset.source.extension.toUpperCase()} · {Math.ceil(asset.source.bytes/1024)} KB</small>
   {entry.tags.length>0&&<div className="asset-card-tags">{entry.tags.slice(0,3).map(tag=><span key={tag} className="library-tag">{tag}</span>)}{entry.tags.length>3&&<span className="library-tag">+{entry.tags.length-3}</span>}</div>}
   <div className="asset-card-actions">
    <button aria-label={`${t('library.preview')} ${asset.name}`} data-tip={t('library.preview')} onClick={()=>set({preview:ui.preview===asset.id?null:asset.id})}><Eye size={13}/></button>
    {entry.inbox&&<button aria-label={`${t('library.send')} ${asset.name}`} data-tip={t('library.sendHint')} disabled={!editable} onClick={()=>send([asset.id])}><Send size={13}/></button>}
    <button className="asset-reimport" aria-label={`${t('asset.reimport')} ${asset.name}`} disabled={!editable||(service.busy||working)||!importer} onClick={()=>{if(importer)void service.import(importer.id,asset.id).catch(bridge.report);}} data-tip={t('asset.reimport')}><RefreshCw size={13}/></button>
   </div>
   {health&&<div className="asset-health" data-testid="asset-health" data-source={health.source} data-cache={health.cache}><small className={health.source==='ready'?'':'component-warning'}>{t('asset.source.'+health.source)}</small>{health.cache!=='ready'&&<small className="component-warning">{t('asset.cache.'+health.cache)}</small>}</div>}
   {bridge.extra?.(asset)}
  </article>;
 }
 function Preview({asset,lib,usage,cacheEpoch}:{asset:AssetRecord;lib:Library;usage:readonly {scope:string;entity:string;component:string}[];cacheEpoch:number}){
  const editable=bridge.useEditable(),entry=entryOf(lib,asset.id),image=bridge.image?.(asset,cacheEpoch)??bridge.thumbnail(asset,cacheEpoch),meta=asset.metadata as Record<string,unknown>;
  const size=typeof meta?.width==='number'&&typeof meta?.height==='number'?`${meta.width}×${meta.height} px · `:'',duration=typeof meta?.duration==='number'?`${Math.round(meta.duration*10)/10} s · `:'';
  return <section className="asset-preview" aria-label={t('library.previewPane')} data-testid="asset-preview" data-asset={asset.id}>
   <div className="asset-preview-head"><strong>{asset.name}</strong><button aria-label={t('library.closePreview')} data-tip={t('library.closePreview')} onClick={()=>set({preview:null})}><X size={14}/></button></div>
   <div className="asset-preview-media">{image?<img src={image} alt={asset.name}/>:<span className="asset-placeholder">{bridge.placeholder?.(asset)??'◇'}</span>}</div>
   {bridge.extra?.(asset)}
   <small data-testid="asset-preview-info">{t(`library.kind.${kindOf(asset.type)}`)} · {asset.source.extension.toUpperCase()} · {size}{duration}{Math.ceil(asset.source.bytes/1024)} KB</small>
   <label className="field"><span>{t('library.folder')}</span><select aria-label={t('library.folder')} value={entry.folderId??''} disabled={!editable} onChange={e=>edit('Move to folder',l=>moveAssets(l,[asset.id],e.target.value||null))}><option value="">{entry.inbox?t('library.inbox'):t('library.unfiled')}</option>{lib.folders.map(f=><option key={f.id} value={f.id}>{folderPath(lib,f.id).map(x=>x.name).join(' / ')}</option>)}</select></label>
   <Tags id={asset.id} tags={entry.tags} editable={editable}/>
   <div className="asset-usage" data-testid="asset-usage" data-count={usage.length}><span>{usage.length?t('library.usedBy').replace('{n}',String(usage.length)):t('library.unused')}</span>{usage.length>0&&<ul>{usage.slice(0,8).map((u,i)=><li key={i}>{u.scope} / {u.entity} <small>{u.component}</small></li>)}</ul>}</div>
   {bridge.details?.(asset)}
   <div className="panel-actions">
    {bridge.canUse(asset)&&<button disabled={!editable} onClick={()=>bridge.use(asset)}>{t('asset.place')}</button>}
    {entry.inbox&&<button className="primary" disabled={!editable} onClick={()=>send([asset.id])}><Send size={13}/> {t('library.send')}</button>}
    <button aria-label={`${t('library.delete')} ${asset.name}`} disabled={!editable||service.busy} onClick={()=>set({confirm:[asset.id]})}><Trash2 size={13}/> {t('library.delete')}</button>
   </div>
  </section>;
 }

 function AssetLibrary(){
  const version=useSyncExternalStore(service.project.document.subscribe,()=>service.project.document.version);
  const s=useSyncExternalStore(subscribe,()=>ui),busy=useSyncExternalStore(service.subscribe,()=>service.busy),editable=bridge.useEditable(),[rebuilding,setRebuilding]=useState(false),[cacheEpoch,setCacheEpoch]=useState(0),[bulkTag,setBulkTag]=useState('');
  const sourceItems=service.items,lib=service.library,usage=bridge.useUsage?.()??new Map(),used=useMemo(()=>new Set(usage.keys()),[usage]);
  const view=s.view.kind==='folder'&&!lib.folders.some(f=>f.id===(s.view as {id:string}).id)?{kind:'all'} as LibraryView:s.view;
  const items=useMemo(()=>filterAssets(sourceItems,lib,{view,text:s.text,tags:s.tags,kinds:s.kinds,usage:s.usage||undefined,used,sort:s.sort}),[sourceItems,lib,view,s.text,s.tags,s.kinds,s.usage,used,s.sort]);
  const rows=useMemo(()=>Array.from({length:Math.ceil(items.length/(s.mode==='list'?1:2))},(_,i)=>{const n=s.mode==='list'?1:2;return items.slice(i*n,i*n+n);}),[items,s.mode]);
  const {active}=useDndContext(),dragId=active?.data.current?.assetId,dragRow=rows.find(row=>row.some(a=>a.id===dragId)),rowKey=useCallback((row:AssetRecord[])=>row.map(a=>`${a.id}:${a.revision}`).join('|'),[]);
  const issues=useMemo(()=>bridge.references?.()??[],[version]),tags=useMemo(()=>tagCounts(sourceItems,lib).slice(0,16),[sourceItems,lib]);
  const selected=s.selected.filter(id=>sourceItems.some(a=>a.id===id)),preview=s.preview?service.get(s.preview):undefined,inboxSelected=selected.filter(id=>entryOf(lib,id).inbox);
  const folder=view.kind==='folder'?lib.folders.find(f=>f.id===view.id):undefined,working=busy||rebuilding;
  const confirmUsage=(s.confirm??[]).reduce((n,id)=>n+(usage.get(id)?.length??0),0);
  const toggle=<T,>(list:readonly T[],v:T)=>list.includes(v)?list.filter(x=>x!==v):[...list,v];
  const resetKey=JSON.stringify([view,s.text,s.tags,s.kinds,s.usage,s.sort]);

  return <div className={`panel-body asset-library collection-panel ${s.mode==='list'?'library-list-mode':''}`} data-view={view.kind} data-import-folder={folder?.id??''}><div className="panel-actions">
   {service.port.importAny&&<button className="primary" disabled={!editable||working} onClick={()=>run(async()=>{const before=new Set(sourceItems.map(a=>a.id));await service.import('*');const added=service.items.filter(a=>!before.has(a.id)).map(a=>a.id);const target=currentFolder();if(added.length&&target)service.editLibrary('Add files to folder',l=>moveAssets(l,added,target));})}><Upload size={15}/>{t('library.addFiles')}</button>}
   {bridge.importers().map(i=><button key={i.id} aria-label={t(i.value.titleKey)} data-tip={t(i.value.titleKey)} disabled={!editable||working} onClick={()=>void service.import(i.id).catch(bridge.report)}>{i.value.assetType==='audio.clip'?<Music size={15}/>:i.value.assetType==='pixi.texture'?<ImageIcon size={15}/>:<File size={15}/>}</button>)}
   {service.port.inspect&&<button aria-label={t('asset.inspect')} data-tip={t('asset.inspect')} disabled={!editable||working||!sourceItems.length} onClick={()=>void service.inspect().catch(bridge.report)}><ShieldCheck size={15}/></button>}
   <button aria-label={t('asset.rebuildCache')} disabled={!editable||working||!sourceItems.length} onClick={()=>{setRebuilding(true);void bridge.rebuild().then(()=>setCacheEpoch(v=>v+1)).catch(bridge.report).finally(()=>setRebuilding(false));}} data-tip={t('asset.rebuild')}><RefreshCw size={15}/></button>
  </div>
   {working&&<div className="asset-progress" role="status">{t('asset.processing')}<button onClick={()=>void service.port.cancel().catch(bridge.report)}>{t('asset.cancel')}</button></div>}
   {issues.length>0&&<details className="asset-reference-issues" data-testid="asset-reference-issues"><summary>{t('asset.referenceIssues')} · {issues.length}</summary><ul>{issues.slice(0,50).map((issue,i)=><li key={i}><strong>{issue.scopeName} / {issue.entityName}</strong><small>{issue.componentType} · {issue.field}: {t('asset.reference.'+issue.kind)}</small></li>)}</ul>{issues.length>50&&<small>{t('asset.moreIssues')}</small>}</details>}
   <div className="library-layout">
    <Folders lib={lib} items={sourceItems}/>
    <div className="library-main">
     <div className="library-search"><input className="asset-search" aria-label={t('asset.search')} placeholder={t('library.searchHint')} value={s.text} onChange={e=>set({text:e.target.value})}/>
      <select aria-label={t('library.sort')} value={s.sort} onChange={e=>set({sort:e.target.value as Ui['sort']})}>{(['added','recent','name','type','size'] as const).map(v=><option key={v} value={v}>{t(`library.sort.${v}`)}</option>)}</select><button aria-label={t('library.gridView')} data-tip={t('library.gridView')} aria-pressed={s.mode==='grid'} onClick={()=>set({mode:'grid'})}><LayoutGrid size={15}/></button><button aria-label={t('library.listView')} data-tip={t('library.listView')} aria-pressed={s.mode==='list'} onClick={()=>set({mode:'list'})}><List size={15}/></button></div>
     <div className="library-filters" role="group" aria-label={t('library.filters')}>
      {KINDS.map(k=><button key={k} aria-pressed={s.kinds.includes(k)} onClick={()=>set({kinds:toggle(s.kinds,k)})}>{t(`library.kinds.${k}`)}</button>)}
      <select aria-label={t('library.usage')} value={s.usage} onChange={e=>set({usage:e.target.value as Ui['usage']})}><option value="">{t('library.usage.any')}</option><option value="used">{t('library.usage.used')}</option><option value="unused">{t('library.usage.unused')}</option></select>
     </div>
     {tags.length>0&&<div className="library-filters" role="group" aria-label={t('library.tagFilter')}>{tags.map(([tag,n])=><button key={tag} className="library-tag" aria-pressed={s.tags.includes(tag)} onClick={()=>set({tags:toggle(s.tags,tag)})}><Tag size={11}/>{tag}<small>{n}</small></button>)}</div>}
     {folder&&<div className="library-breadcrumb" data-testid="library-breadcrumb"><nav aria-label={t('library.path')}><button onClick={()=>set({view:{kind:'all'}})}><FolderIcon size={13}/></button>{folderPath(lib,folder.id).map(f=><span key={f.id}><span aria-hidden="true"> / </span><button onClick={()=>set({view:{kind:'folder',id:f.id}})}>{f.name}</button></span>)}</nav>
      <button aria-label={t('library.renameFolder')} data-tip={t('library.renameFolder')} disabled={!editable} onClick={()=>set({renaming:folder.id})}><Pencil size={13}/></button>
      {folder.parentId!==null&&<button aria-label={t('library.moveFolderUp')} data-tip={t('library.moveFolderUp')} disabled={!editable} onClick={()=>edit('Move folder',l=>moveFolder(l,folder.id,lib.folders.find(f=>f.id===folder.parentId)?.parentId??null))}>↑</button>}
      <button aria-label={t('library.deleteFolder')} data-tip={t('library.deleteFolderHint')} disabled={!editable} onClick={()=>{edit('Delete folder',l=>deleteFolder(l,folder.id));set({view:folder.parentId?{kind:'folder',id:folder.parentId}:{kind:'all'}});}}><Trash2 size={13}/></button></div>}
     {view.kind==='inbox'&&<p className="panel-empty">{t('library.inboxHelp')}</p>}
     {selected.length>0&&<div className="library-bulk" role="group" aria-label={t('library.bulk')} data-testid="library-bulk">
      <span>{t('library.selected').replace('{n}',String(selected.length))}</span>
      <select aria-label={t('library.moveSelected')} value="" disabled={!editable} onChange={e=>{const v=e.target.value;if(!v)return;edit('Move to folder',l=>moveAssets(l,selected,v==='unfiled'?null:v));}}><option value="">{t('library.moveSelected')}</option><option value="unfiled">{t('library.unfiled')}</option>{lib.folders.map(f=><option key={f.id} value={f.id}>{folderPath(lib,f.id).map(x=>x.name).join(' / ')}</option>)}</select>
      <input aria-label={t('library.tagSelected')} placeholder={t('library.tagSelected')} value={bulkTag} disabled={!editable} onChange={e=>setBulkTag(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&bulkTag.trim()){e.preventDefault();edit('Tag assets',l=>addTags(l,selected,bulkTag.split(',').map(x=>x.trim()).filter(Boolean)));setBulkTag('');}}}/>
      {inboxSelected.length>0&&<button className="primary" disabled={!editable} onClick={()=>send(inboxSelected)}><Send size={13}/> {t('library.sendSelected')}</button>}
      <button disabled={!editable||busy} onClick={()=>set({confirm:selected})}><Trash2 size={13}/> {t('library.deleteSelected')}</button>
      <button onClick={()=>set({selected:[]})}>{t('library.clearSelection')}</button>
     </div>}
     {view.kind==='inbox'&&items.length>0&&!selected.length&&<div className="panel-actions"><button className="primary" disabled={!editable} onClick={()=>send(items.map(a=>a.id),null)}><Send size={13}/> {t('library.sendAll')}</button><button onClick={()=>set({selected:items.map(a=>a.id)})}>{t('library.selectAll')}</button></div>}
     {s.confirm&&<div className="library-confirm" role="alertdialog" aria-label={t('library.confirmDelete')} data-testid="library-confirm">
      <p>{t('library.confirmText').replace('{n}',String(s.confirm.length))}{confirmUsage>0&&<strong> {t('library.confirmUsed').replace('{n}',String(confirmUsage))}</strong>}</p>
      <div className="panel-actions"><button className="danger" onClick={()=>remove(s.confirm!)}>{t('library.deleteConfirm')}</button><button onClick={()=>set({confirm:null})}>{t('asset.cancel')}</button></div>
     </div>}
     {preview&&<Preview asset={preview} lib={lib} usage={usage.get(preview.id)??[]} cacheEpoch={cacheEpoch}/>}
     <VirtualList items={rows} itemKey={rowKey} estimate={s.mode==='list'?86:250} pinnedKeys={dragRow?[rowKey(dragRow)]:[]} label={t('asset.collection')} testId="asset-list" resetKey={resetKey} render={row=><div className={s.mode==='list'?'asset-list-row':'asset-grid asset-grid-row'}>{row.map(a=><Card key={`${a.id}:${a.revision}`} asset={a} cacheEpoch={cacheEpoch} working={working} lib={lib}/>)}</div>}/>
     {!items.length&&<p className="panel-empty">{sourceItems.length?t('library.noMatch'):t('asset.empty')}</p>}
    </div>
   </div>
  </div>;
 }
 return Object.assign(AssetLibrary,{
  /** Where the Library currently files new things (the open folder, or none). */
  currentFolder,
  /** Sends generated assets from the inbox to the open Library folder. */
  send,
  /** A drag ended on a folder: the dragged asset (with the rest of the selection when it is selected) moves there. */
  dropOnFolder(assetId:string,target:string){const ids=ui.selected.includes(assetId)?ui.selected:[assetId],folderId=target==='unfiled'?null:target;edit(ids.length===1?'Move to folder':`Move ${ids.length} assets`,lib=>moveAssets(lib,ids,folderId));},
 });
}
