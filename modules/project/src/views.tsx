import {CommitInput} from '@rewrite/ui/drafts';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Dialog} from 'radix-ui';
import {stageSize,type ProjectService} from './index';
const STAGE_PRESETS=[[960,540],[1280,720],[1920,1080],[540,960],[720,1280],[1080,1920],[1024,768],[800,600]] as const;
const NODE_W=104,NODE_H=30,GAP_X=128,GAP_Y=64,COLS=3;
/** Where the line from a node centre towards (dx, dy) leaves its box. */
const exit=(cx:number,cy:number,dx:number,dy:number)=>{const t=Math.min(dx?NODE_W/2/Math.abs(dx):Infinity,dy?NODE_H/2/Math.abs(dy):Infinity);return{x:cx+dx*t,y:cy+dy*t};};
/** Scenes as boxes and every scene change between them as an arrow (rules, graphs, state machines, scripts); click a box to open it. */
function SceneFlow({project,text:t,open}:{project:ProjectService;text(key:string):string;open(id:string):void}){
 const value=project.document.current,edges=project.sceneFlow(),pairs=new Map<string,{from:string;to:string;labels:string[]}>();
 for(const e of edges){const key=e.from+'>'+e.to;const p=pairs.get(key)??{from:e.from,to:e.to,labels:[]};p.labels.push(e.label);pairs.set(key,p);}
 const at=new Map(value.scenes.map((s,i)=>[s.id,{x:16+(i%COLS)*GAP_X+NODE_W/2,y:16+Math.floor(i/COLS)*GAP_Y+NODE_H/2}])),rowsN=Math.ceil(value.scenes.length/COLS),width=32+Math.min(COLS,value.scenes.length)*GAP_X-(GAP_X-NODE_W),height=32+rowsN*GAP_Y-(GAP_Y-NODE_H);
 const name=(id:string)=>value.scenes.find(s=>s.id===id)?.name??id;
 return <section className="scene-flow" aria-label={t('project.flow')} data-testid="scene-flow" data-edges={JSON.stringify([...pairs.values()].map(p=>[name(p.from),name(p.to)]))}>
  <h4>{t('project.flow')}</h4>
  <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={t('project.flow')}><defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>
   {[...pairs.values()].map(p=>{const a=at.get(p.from)!,b=at.get(p.to)!,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,both=pairs.has(p.to+'>'+p.from),ox=both?-dy/len*5:0,oy=both?dx/len*5:0,s=exit(a.x,a.y,dx,dy),e=exit(b.x,b.y,-dx,-dy);return <line key={p.from+p.to} className="flow-edge" x1={s.x+ox} y1={s.y+oy} x2={e.x+ox} y2={e.y+oy} markerEnd="url(#flow-arrow)" style={{color:'var(--muted,#8a939c)'}}><title>{p.labels.join('\n')}</title></line>;})}
   {value.scenes.map(sc=>{const c=at.get(sc.id)!;return <g key={sc.id} className="flow-node" role="button" tabIndex={0} aria-label={t('project.flowNode').replace('{name}',sc.name)} data-active={project.activeSceneId===sc.id} transform={`translate(${c.x-NODE_W/2} ${c.y-NODE_H/2})`} onClick={()=>open(sc.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(sc.id);}}}><rect width={NODE_W} height={NODE_H} rx={6}/><text x={NODE_W/2} y={NODE_H/2+4} textAnchor="middle">{(value.entrySceneId===sc.id?'▶ ':'')+(sc.name.length>13?sc.name.slice(0,12)+'…':sc.name)}</text></g>;})}
  </svg>
  {pairs.size?<ul>{[...pairs.values()].map(p=><li key={p.from+p.to}>{name(p.from)} → {name(p.to)} <small>· {p.labels.length===1?p.labels[0].split(' / ').slice(1).join(' / '):t('project.flowWays').replace('{n}',String(p.labels.length))}</small></li>)}</ul>:<p className="panel-empty">{t('project.flowEmpty')}</p>}
 </section>;
}
export function createProjectViews(project:ProjectService,bridge:{text(key:string):string;useEditable():boolean;run(work:()=>void):void;report(error:unknown):void;thumbnail?(sceneId:string):string|undefined;subscribeThumbnails?(listener:()=>void):()=>void}){
 const noThumbs=()=>()=>{};let thumbVersion=0;
 const t=bridge.text;
 return function ProjectScenes(){
  useSyncExternalStore(project.sceneDocument.subscribe,()=>project.sceneDocument.version);useSyncExternalStore(bridge.subscribeThumbnails?(l=>bridge.subscribeThumbnails!(()=>{thumbVersion++;l();})):noThumbs,()=>thumbVersion);const editable=bridge.useEditable(),value=project.document.current,stage=stageSize(value),[pending,setPending]=useState<string|null>(null),[error,setError]=useState(''),root=useRef<HTMLDivElement>(null),returnFocus=useRef<HTMLButtonElement|null>(null);
  const run=(work:()=>void)=>{setError('');try{bridge.run(work);}catch(e){setError(String(e));bridge.report(e);}};
  const candidate=value.scenes.find(s=>s.id===pending),usages=candidate?project.sceneUsages(candidate.id):[];
  useEffect(()=>{if(pending&&!candidate)setPending(null);},[pending,candidate]);
  return <div ref={root} className="panel-body project-scenes" data-testid="project-scenes" data-active-scene={project.activeSceneId} data-entry-scene={value.entrySceneId}>
   <label className="field"><span>{t('project.name')}</span><CommitInput label={t('project.name')} value={value.name} disabled={!editable} commit={raw=>project.renameProject(raw)} onError={bridge.report}/></label>
   <fieldset className="stage-size" data-testid="project-stage" data-stage={`${stage.width}x${stage.height}`}><legend>{t('project.stage')}</legend>
    <select aria-label={t('project.stagePreset')} disabled={!editable} value={STAGE_PRESETS.some(([w,h])=>w===stage.width&&h===stage.height)?`${stage.width}x${stage.height}`:''} onChange={e=>{const [w,h]=e.target.value.split('x').map(Number);if(w&&h)run(()=>project.setStage({width:w,height:h}));}}>
     {STAGE_PRESETS.map(([w,h])=><option key={`${w}x${h}`} value={`${w}x${h}`}>{w} × {h}{w<h?` · ${t('project.portrait')}`:''}</option>)}<option value="">{t('project.stageCustom')}</option>
    </select>
    <CommitInput label={t('project.stageWidth')} type="number" value={String(stage.width)} disabled={!editable} commit={raw=>project.setStage({width:Number(raw),height:stage.height})} onError={bridge.report}/>
    <span aria-hidden="true">×</span>
    <CommitInput label={t('project.stageHeight')} type="number" value={String(stage.height)} disabled={!editable} commit={raw=>project.setStage({width:stage.width,height:Number(raw)})} onError={bridge.report}/>
   </fieldset>
   <p className="panel-empty">{t('project.sceneHelp')}</p><button disabled={!editable||value.scenes.length>=100} onClick={()=>run(()=>{const names=new Set(value.scenes.map(s=>s.name));let n=1;while(names.has(`${t('project.defaultScene')} ${n}`))n++;project.createScene(`${t('project.defaultScene')} ${n}`);})}>{t('project.addScene')}</button>
   {error&&!candidate&&<p role="alert" className="component-warning">{error}</p>}
   <div className="scene-cards">{value.scenes.map(scene=><section className="scene-card" key={scene.id} data-scene-id={scene.id} data-active={project.activeSceneId===scene.id}>
    <div className="scene-card-heading"><CommitInput label={`${t('project.sceneName')} ${scene.name}`} value={scene.name} disabled={!editable} commit={raw=>project.renameScene(scene.id,raw)} onError={bridge.report}/>{value.entrySceneId===scene.id&&<span className="scene-startup">{t('project.startup')}</span>}</div>
    {bridge.thumbnail?.(scene.id)&&<img className="scene-thumb" src={bridge.thumbnail(scene.id)} alt={`${scene.name} ${t('project.thumbnail')}`} data-testid="scene-thumbnail"/>}<small>{t('project.entityCount')}: {scene.entities.length}</small><div className="panel-actions"><button aria-label={`${t('project.openScene')} ${scene.name}`} aria-pressed={project.activeSceneId===scene.id} disabled={!editable} onClick={()=>run(()=>project.openScene(scene.id))}>{t('project.openScene')}</button><button aria-label={`${t('project.useStartup')} ${scene.name}`} disabled={!editable||value.entrySceneId===scene.id} onClick={()=>run(()=>project.setEntryScene(scene.id))}>{t('project.useStartup')}</button><button aria-label={`${t('project.duplicateScene')} ${scene.name}`} disabled={!editable||value.scenes.length>=100} onClick={()=>run(()=>project.duplicateScene(scene.id))}>{t('project.duplicateScene')}</button><button aria-label={`${t('project.deleteScene')} ${scene.name}`} disabled={!editable||value.scenes.length===1} onClick={e=>{returnFocus.current=e.currentTarget;setError('');setPending(scene.id);}}>{t('project.deleteScene')}</button></div>
   </section>)}</div>
   <SceneFlow project={project} text={t} open={id=>run(()=>project.openScene(id))}/>
   <Dialog.Root open={Boolean(candidate)} onOpenChange={open=>{if(!open)setPending(null);}}><Dialog.Portal><Dialog.Overlay className="scene-dialog-overlay"/><Dialog.Content className="scene-dialog" onCloseAutoFocus={e=>{e.preventDefault();requestAnimationFrame(()=>{const target=returnFocus.current?.isConnected?returnFocus.current:root.current?.querySelector<HTMLElement>('input:not([disabled]),button:not([disabled])');target?.focus({preventScroll:true});});}}><Dialog.Title>{t('project.deleteTitle')} · {candidate?.name}</Dialog.Title><Dialog.Description>{t('project.deleteDescription')}</Dialog.Description>{error&&<p role="alert" className="component-warning">{error}</p>}
    {candidate&&value.entrySceneId===candidate.id&&<p>{t('project.replaceStartup')} {value.scenes.find(s=>s.id!==candidate.id)?.name}</p>}
    {usages.length>0&&<section role="alert"><p>{t('project.sceneReferenced')}</p><ul>{usages.slice(0,50).map((usage,i)=><li key={i}>{usage.label}{usage.targetSceneId===null?` · ${t('project.referenceUnknown')}`:''}</li>)}</ul>{usages.length>50&&<p>{t('project.moreReferences')} ({usages.length})</p>}</section>}
    <div className="panel-actions"><button disabled={!editable||usages.length>0} onClick={()=>run(()=>{project.removeScene(candidate!.id);setPending(null);})}>{t('project.confirmDelete')}</button><Dialog.Close asChild><button>{t('project.cancelDelete')}</button></Dialog.Close></div>
   </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
 };
}
