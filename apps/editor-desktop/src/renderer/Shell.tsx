import {playbackDisabled} from './preview-preparation';
import {CanvasTools} from './CanvasTools';
import {layoutControl} from './layout-control';
import {presetPanels,workspacePresets,type WorkspacePreset} from './workspace-presets';
import {useDraftController} from '@rewrite/ui/drafts';
import {PanelFinder} from './PanelFinder';
import {AppearanceSettings} from './AppearanceSettings';
import {focusPanelContent,focusDockedPanel} from './panel-focus';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Popover, DropdownMenu, Tooltip } from 'radix-ui';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview';
import { Gamepad2, Globe, SlidersVertical, Folder, Layers, SlidersHorizontal, LayoutTemplate, Pin, X, Box, Play, Pause, StepForward, Square, Plus, Type, Shapes, Activity, Puzzle, Check, Search, Terminal, ChevronDown, ChevronRight, Undo2, Redo2, Clapperboard, Orbit, SquareRoundCorner, Circle, Egg, Triangle, Hexagon, Star, Minus, Image, Film, Grid3x3, Frame, Waves, Spline, Sparkles, Bone, Music, Settings, Columns3, Rows3, LayoutDashboard, Hash, Languages, Workflow, Map as MapIcon, Video, PackageOpen, Boxes, GalleryVerticalEnd, WandSparkles, BotMessageSquare, FileCode, ListTodo, BookOpen, Gauge, Palette, MessageSquareText, GitBranch, Trophy } from 'lucide-react';
import { SettingsDialog } from './SettingsDialog';
import { overlays, panels, menus, tools, workspaces, createItems, createCategories, settings, settingsSections, type PanelDefinition, type SettingsStore, type CreateItemDefinition, type SettingsSectionDefinition } from '@rewrite/sdk';
import type { ModuleHost } from '@rewrite/kernel';
import { useUi, notify } from './state';
import { applyTheme, resolveTheme, ThemeSchema } from './themes';
import { t } from './strings';
import styles from './Shell.module.css';
import 'dockview/dist/styles/dockview.css';
import './global.css';
const icons: Record<string,ComponentType<{size?:number}>> = { input:Gamepad2,globals:Globe,mixer:SlidersVertical,physics:Orbit,animation:Clapperboard,layers:Layers, properties:SlidersHorizontal, library:Folder, box:Box, play:Play,pause:Pause,step:StepForward,stop:Square,plus:Plus,text:Type,shape:Shapes,shapes:Shapes,square:Square,squareRound:SquareRoundCorner,circle:Circle,ellipse:Egg,triangle:Triangle,hexagon:Hexagon,star:Star,line:Minus,image:Image,sprites:Image,film:Film,grid:Grid3x3,frame:Frame,mesh:Waves,meshes:Waves,rope:Spline,sparkles:Sparkles,effects:Sparkles,bone:Bone,skeletal:Bone,audio:Music,console:Terminal,basic:Box,settings:Settings,row:Columns3,column:Rows3,layout:LayoutDashboard,bitmapText:Hash,localization:Languages,logic:Workflow,export:PackageOpen,generate:WandSparkles,assistant:BotMessageSquare,script:FileCode,jobs:ListTodo,skills:BookOpen,prefab:Boxes,scenes:GalleryVerticalEnd,tilemap:MapIcon,camera:Video,activity:Activity,profiler:Gauge,shader:Palette,dialogue:MessageSquareText,git:GitBranch,trophy:Trophy,undo:Undo2,redo:Redo2 };
const physicsSettingsId='studio.physics';
const editCommands=new Set(['undo','redo','selectAll','duplicate','group','ungroup','flipH','flipV']);
const dockTitle=(def:PanelDefinition)=>t(({layers:'workspace.hierarchy',properties:'workspace.inspector',library:'workspace.project'} as Record<string,string>)[def.icon]??def.titleKey);
function Icon({name}:{name:string}) { const View=icons[name]??Box; return <View size={17}/>; }
function Tip({label,children}:{label:string;children:React.ReactNode}) { return <Tooltip.Root><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className={styles.tooltip} sideOffset={8}>{label}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>; }
export function Shell({host,preferences}:{host:ModuleHost;preferences?:SettingsStore}) {
 const drafts=useDraftController();
 const settingsTrigger=useRef<HTMLButtonElement>(null);
 const ui=useUi(), api=useRef<DockviewApi|null>(null), subscriptions=useRef<{dispose():void}[]>([]);
 const lastSelection=useRef(ui.selected),automaticPanel=useRef<string|null>(null);
 const workspaceTrigger=useRef<HTMLButtonElement>(null),toolsReturn=useRef<HTMLButtonElement>(null);
 const [workspacePreset,setWorkspacePreset]=useState<WorkspacePreset>('studio');
 const [settingsOpen,setSettingsOpen]=useState(false),[settingsSection,setSettingsSection]=useState<string>();
 const settingEntries=useMemo(()=>host.entries(settings),[host]);
 const projectSettingSections=useMemo<readonly {id:string;value:SettingsSectionDefinition}[]>(()=>[
  ...host.entries(settingsSections),
  {id:'shell.appearance',value:{titleKey:'settings.appearance',scope:'editor',keywords:['theme','color','contrast'],view:AppearanceSettings}},
  {id:'shell.modules',value:{titleKey:'settings.modules',scope:'editor',keywords:['plugins','diagnostics'],view:()=> <>
   {[...host.states].map(([id,state])=><div className={styles.moduleRow} key={id}><Puzzle size={15}/><span>{id}</span><span>{state}</span></div>)}
   {host.diagnostics.map((d,index)=><p key={index} role="alert">{d.owner}: {d.message}</p>)}
  </>}},
 ],[host]);
 const physicsSettings=preferences&&projectSettingSections.find(e=>e.id===physicsSettingsId);
 const openSettings=(section?:string)=>{setSettingsSection(section);setSettingsOpen(true);};

 /** Add menu: categories in a fixed order; a category with one item shows it directly, larger ones are submenus. */
 const addGroups=useMemo(()=>{const groups=new Map<string,{id:string;owner:string;value:CreateItemDefinition}[]>();for(const e of host.entries(createItems))groups.set(e.value.category,[...(groups.get(e.value.category)??[]),e]);const rank=(c:string)=>{const i=(createCategories as readonly string[]).indexOf(c);return i<0?createCategories.length:i;};return [...groups].sort((a,b)=>rank(a[0])-rank(b[0])).map(([category,items])=>({category,items:[...items].sort((a,b)=>(a.value.order??0)-(b.value.order??0))}));},[host]);
 const [finderOpen,setFinderOpen]=useState(false),finderActive=useRef(false),finderReturn=useRef<HTMLElement|null>(null),finderFallback=useRef<HTMLElement|null>(null),finderChoice=useRef<string|null>(null),pinTransfer=useRef<string|null>(null);
 const [systemDark,setSystemDark]=useState(matchMedia('(prefers-color-scheme: dark)').matches);
 const panelEntries=useMemo(()=>host.entries(panels),[host]), workspace=host.entries(workspaces)[0];
 const definition=(id:string):PanelDefinition|undefined=>panelEntries.find(e=>e.id===id)?.value;
 const toolEntries=panelEntries.map(e=>({id:e.id,title:dockTitle(e.value),icon:e.value.icon,shortcut:e.value.shortcut}));
 const finderEntries=physicsSettings?[...toolEntries,{id:physicsSettingsId,title:t(physicsSettings.value.titleKey),shortcut:'Alt+Y'}]:toolEntries;
 const menuEntries=host.entries(menus);
 const editItems=menuEntries.filter(e=>editCommands.has(e.id.split('.').at(-1)??''));
 const fileItems=menuEntries.filter(e=>!editItems.includes(e));
 const execute=(id:string)=>{void host.execute(id).catch(notify);};
 useEffect(()=>{
  const query=matchMedia('(prefers-color-scheme: dark)'), listener=()=>setSystemDark(query.matches); query.addEventListener('change',listener);
  try { const raw=JSON.parse(localStorage.getItem('rewrite:custom-themes')??'[]') as unknown[]; useUi.getState().set({customThemes:raw.map(v=>ThemeSchema.parse(v))}); } catch { /* Invalid preferences do not stop boot. */ }
  return()=>query.removeEventListener('change',listener);
 },[]);
 useEffect(()=>{const resolved=resolveTheme(ui.theme,systemDark,ui.customThemes);applyTheme(resolved);useUi.getState().set({resolvedTheme:resolved.id});localStorage.setItem('rewrite:theme',ui.theme);},[ui.theme,ui.customThemes,systemDark]);
 useEffect(()=>window.platform.onAction(name=>{
  if(name==='settings'){if(preferences)openSettings();return;}
  const menu=host.entries(menus).find(e=>e.id.endsWith(`.${name}`)); if(menu) execute(menu.value.command);
 }),[host]); // Native menu maps to contributed commands.
 useEffect(()=>()=>{for(const sub of subscriptions.current)sub.dispose();},[]);
 useEffect(()=>{if(ui.panel&&api.current?.getPanel(ui.panel)){api.current.getPanel(ui.panel)!.api.setActive();focusDockedPanel(ui.panel);useUi.getState().set({panel:null});}},[ui.panel]);
 const showPanel=(id:string)=>{if(id===physicsSettingsId&&physicsSettings){openSettings(id);return;}const panel=api.current?.getPanel(id);if(panel){panel.api.setActive();useUi.getState().set({panel:null});focusDockedPanel(id);}else useUi.getState().set({panel:id});};
 const openPanel=(id:string)=>{try{drafts?.flush();}catch(error){notify(error);return;}if(useUi.getState().panel===id)useUi.getState().set({panel:null});else showPanel(id);};
 // Selection and Radix outside-dismiss happen in the same pointer gesture. Keep the
 // inspector open on authoring surfaces; reveal again after pointer-up even when
 // clicking the already selected object (which has no selection state change).
 const revealProperties=()=>{const state=useUi.getState();if(!state.selected||state.mode!=='edit')return;const entry=panelEntries.find(e=>e.value.icon==='properties');if(!entry)return;try{drafts?.flush();}catch(error){notify(error);return;}const pinned=api.current?.getPanel(entry.id);if(pinned){pinned.api.setActive();return;}if(state.panel!==entry.id){automaticPanel.current=entry.id;state.set({panel:entry.id});}};
 useEffect(()=>{const previous=lastSelection.current;lastSelection.current=ui.selected;if(ui.selected!==previous)revealProperties();},[ui.selected,ui.mode,panelEntries,drafts]);
 useEffect(()=>{let frame=0;const pointerUp=(event:PointerEvent)=>{if(event.button!==0||!(event.target instanceof Element)||!event.target.closest('[data-testid="pixi-canvas"],[data-entity-select]'))return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=0;revealProperties();});};window.addEventListener('pointerup',pointerUp);return()=>{window.removeEventListener('pointerup',pointerUp);cancelAnimationFrame(frame);};},[panelEntries,drafts]);
 const openFinder=()=>{try{drafts?.flush();}catch(error){notify(error);return;}finderReturn.current=document.activeElement instanceof HTMLElement?document.activeElement:null;finderFallback.current=[...document.querySelectorAll<HTMLElement>('[data-panel-trigger]')].find(node=>node.dataset.panelTrigger===useUi.getState().panel)??settingsTrigger.current;finderActive.current=true;useUi.getState().set({panel:null});setFinderOpen(true);};
 /** Panel shortcuts (⌥ + letter): toggle the panel, or focus it when docked. Not while typing or in a dialog. */
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(!event.altKey||event.metaKey||event.ctrlKey||event.shiftKey||event.repeat||event.defaultPrevented)return;const target=event.target instanceof HTMLElement?event.target:null;if(target?.closest('input,textarea,select,[contenteditable=true]')||document.querySelector('[role="dialog"]:not([data-editor-panel]),[role="menu"]'))return;
  const entry=panelEntries.find(e=>e.value.shortcut&&event.code===`Key${e.value.shortcut.split('+').pop()!.toUpperCase()}`);if(!entry&&!(physicsSettings&&event.code==='KeyY'))return;event.preventDefault();
  try{drafts?.flush();}catch(error){notify(error);return;}
  if(!entry){openSettings(physicsSettingsId);return;}
  if(api.current?.getPanel(entry.id)){api.current.getPanel(entry.id)!.api.setActive();focusDockedPanel(entry.id);return;}
  const ui=useUi.getState();ui.set({panel:ui.panel===entry.id?null:entry.id});};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[panelEntries,drafts,physicsSettings]);
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(!(event.metaKey||event.ctrlKey)||event.altKey||event.shiftKey||event.key.toLowerCase()!=='k'||event.repeat||event.isComposing)return;if(finderActive.current){event.preventDefault();setFinderOpen(false);return;}if(document.querySelector('[role="dialog"][data-state="open"]:not([data-editor-panel])'))return;event.preventDefault();openFinder();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 const restoreSettings=(event:Event)=>{event.preventDefault();settingsTrigger.current?.focus({preventScroll:true});};
 const pin=(id:string)=>{
  try{drafts?.flush();}catch(error){notify(error);return;}
  const def=definition(id),dock=api.current;if(!def||!dock)return;
  if(dock.getPanel(id)){dock.getPanel(id)!.api.setActive();}else dock.addPanel({id,component:'contribution',title:dockTitle(def),params:{id},position:{direction:def.defaultDock==='bottom'?'below':def.defaultDock??(id.endsWith('layers')?'left':'right'),referencePanel:'workspace'},initialWidth:300,initialHeight:def.preferredHeight??350,minimumWidth:240});
  pinTransfer.current=id;useUi.getState().set({panel:null});
 };
 const arrangePreset=(dock:DockviewApi,preset:WorkspacePreset)=>{
  for(const panel of [...dock.panels])if(panel.id!=='workspace')dock.removePanel(panel);
  const bottomHeight=preset==='studio'?Math.max(205,Math.min(285,Math.round(dock.height*.31))):300;
  let bottom:ReturnType<DockviewApi['addPanel']>|undefined;
  for(const item of presetPanels(panelEntries,preset)){
   const def=definition(item.id)!;
   const position=item.tabWith?{direction:'within' as const,referencePanel:item.tabWith}:item.edge?{direction:item.side}:{direction:item.side,referencePanel:'workspace'};
   const panel=dock.addPanel({id:item.id,component:'contribution',title:dockTitle(def),params:{id:item.id},position,
    initialWidth:item.side==='left'?230:300,initialHeight:item.side==='below'?bottomHeight:undefined,
    minimumWidth:item.side==='right'?230:180,minimumHeight:preset==='studio'&&item.side==='below'?185:105,inactive:Boolean(item.tabWith)});
   if(item.side==='below'&&!item.tabWith)bottom=panel;
  }
  // Inserting the full-height Inspector can rebalance the nested vertical split.
  bottom?.group.api.setSize({height:bottomHeight});
  dock.getPanel('workspace')?.api.setActive();
 };
 const storePreset=(preset:WorkspacePreset)=>{setWorkspacePreset(preset);localStorage.setItem('rewrite:workspace-preset',preset);};
 const applyPreset=(preset:WorkspacePreset)=>{
  const dock=api.current;if(!dock)return;try{drafts?.flush();}catch(error){notify(error);return;}
  const previous=dock.toJSON();try{useUi.getState().set({panel:null});arrangePreset(dock,preset);storePreset(preset);}catch(error){dock.fromJSON(previous);notify(error);}
 };
 useEffect(()=>{
  const controls={preset:applyPreset,panel(id:string,mode:'open'|'close'|'pin'|'unpin'){
   if(id===physicsSettingsId&&physicsSettings){
    if(mode==='close'){if(settingsSection===id)setSettingsOpen(false);}
    else if(mode==='open')openSettings(id);
    else throw Error('Physics is a Project Settings section');
    return;
   }
   if(!definition(id))throw Error('Unknown panel');
   if(mode==='pin')pin(id);
   else if(mode==='open')showPanel(id);
   else{
    const dock=api.current,panel=dock?.getPanel(id);if(panel)dock!.removePanel(panel);
    if(mode==='unpin')useUi.getState().set({panel:id});
    else if(useUi.getState().panel===id)useUi.getState().set({panel:null});
   }
  },state:()=>({preset:workspacePreset,pinned:api.current?.panels.filter(p=>p.id!=='workspace').map(p=>p.id)??[],floating:useUi.getState().panel})};
  layoutControl.current=controls;return()=>{if(layoutControl.current===controls)delete layoutControl.current;};
 },[workspacePreset,panelEntries,physicsSettings,settingsSection]);
 const components=useMemo(()=>({
  contribution:({params}:{params:{id:string}})=>{const def=definition(params.id); const View=def?.view as ComponentType|undefined;return View?<div className="panel-content" data-panel-content={params.id} tabIndex={-1}><View/></div>:null;},
  workspace:()=>{const View=workspace?.value.view as ComponentType|undefined;return View?<View/>:<div className={styles.empty}><Box size={28}/><h1>Make room for your ideas.</h1><p>The empty profile is running. Add a workspace module to begin.</p></div>;},
 }),[host]);
 const ready=({api:dock}:DockviewReadyEvent)=>{
  api.current=dock;
  let restored=false;
  try{
   const saved=localStorage.getItem('rewrite:layout');
   if(saved){dock.fromJSON(JSON.parse(saved));restored=Boolean(dock.getPanel('workspace'));}
  }catch{dock.clear();}
  if(!restored){dock.clear();dock.addPanel({id:'workspace',component:'workspace',title:t(workspace?.value.titleKey??'workspace.empty')});}
  for(const panel of [...dock.panels])if(panel.id!=='workspace'){
   const def=definition(panel.id);
   if(def)panel.api.setTitle(dockTitle(def));else dock.removePanel(panel);
  }
  const center=dock.getPanel('workspace')!.group;
  center.locked='no-drop-target';
  center.header.hidden=center.panels.length===1;
  const saved=localStorage.getItem('rewrite:workspace-preset');
  const named=workspacePresets.find(preset=>preset===saved);
  const preset=named??(restored&&dock.panels.length>1?'canvas':'studio');
  if(!restored||(!named&&preset==='studio'))arrangePreset(dock,preset);
  storePreset(preset);
  const save=()=>localStorage.setItem('rewrite:layout',JSON.stringify(dock.toJSON()));
  save();
  subscriptions.current.push(dock.onDidLayoutChange(()=>{
   const workspaceGroup=dock.getPanel('workspace')?.group;
   if(workspaceGroup)workspaceGroup.header.hidden=workspaceGroup.panels.length===1;
   save();
  }));
 };
 return <Tooltip.Provider delayDuration={450}>{host.entries(overlays).map(e=>{const View=e.value.view as ComponentType;return <View key={e.id}/>;})}<main className={styles.shell} data-testid="editor-shell" data-mode={ui.mode} data-workspace={workspacePreset} aria-busy={ui.busy}>
  <header className={styles.toolbar}>
   <div className={styles.trafficSpace}/>
   <DropdownMenu.Root><DropdownMenu.Trigger className={styles.projectButton} aria-label="Project menu">{t('workspace.file')} <ChevronDown size={13}/></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className={styles.menu} sideOffset={12}>
    {fileItems.map(e=><DropdownMenu.Item key={e.id} className={styles.menuItem} onSelect={()=>execute(e.value.command)}>{t(e.value.titleKey)}</DropdownMenu.Item>)}
   </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
   {editItems.length>0&&<DropdownMenu.Root><DropdownMenu.Trigger className={styles.projectButton}>{t('workspace.edit')}<ChevronDown size={12}/></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className={styles.menu} sideOffset={8}>{editItems.map(e=><DropdownMenu.Item key={e.id} className={styles.menuItem} onSelect={()=>execute(e.value.command)}>{t(e.value.titleKey)}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}
   <span className={styles.divider}/><strong className={styles.projectTitle} title={ui.title}><span>{ui.title}</span>{ui.dirty&&<span aria-label="Unsaved changes" className={styles.dirty}/>}</strong>
   <div className={styles.tools}>{host.entries(tools).filter(e=>e.value.group==='add').map(tool=><DropdownMenu.Root key={tool.id}><DropdownMenu.Trigger className={styles.addButton} aria-label={t(tool.value.titleKey)} disabled={ui.mode!=='edit'||ui.busy}><Plus size={16}/><span>{t(tool.value.titleKey)}</span><ChevronDown size={13}/></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className={styles.menu} sideOffset={12} align="start" data-testid="add-menu">
     {addGroups.map(group=>{const item=(e:typeof group.items[number])=><DropdownMenu.Item key={e.id} className={styles.menuItem} data-create={e.id} onSelect={()=>{void host.execute(tool.value.command,e.id).catch(notify);}}><Icon name={e.value.icon??'box'}/>{t(e.value.titleKey)}</DropdownMenu.Item>;
      return group.items.length===1?item(group.items[0]):<DropdownMenu.Sub key={group.category}><DropdownMenu.SubTrigger className={styles.menuItem}><Icon name={group.category}/>{t(`create.category.${group.category}`)}<ChevronRight size={14}/></DropdownMenu.SubTrigger><DropdownMenu.Portal><DropdownMenu.SubContent className={styles.menu} sideOffset={6} aria-label={t(`create.category.${group.category}`)}>{group.items.map(item)}</DropdownMenu.SubContent></DropdownMenu.Portal></DropdownMenu.Sub>;})}
    </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>)}{host.entries(tools).filter(e=>e.value.group==='edit').map(e=><Tip key={e.id} label={t(e.value.titleKey)}><button aria-label={t(e.value.titleKey)} disabled={ui.mode!=='edit'||ui.busy} onClick={()=>execute(e.value.command)}><Icon name={e.value.icon}/></button></Tip>)}</div>
   <div className={styles.playback}>{host.entries(tools).filter(e=>e.value.group==='play').map(e=><Tip key={e.id} label={t(e.value.titleKey)}><button aria-label={t(e.value.titleKey)} disabled={playbackDisabled(e.value.icon,ui)} aria-pressed={e.value.icon==='play'?ui.mode!=='edit':e.value.icon==='pause'?ui.mode==='paused':undefined} onClick={()=>execute(e.value.command)}><Icon name={e.value.icon}/></button></Tip>)}</div>
   <div className={styles.headerActions}>
    <CanvasTools entries={toolEntries} choose={openPanel}/>
    <button ref={toolsReturn} className={styles.findTools} aria-label={t('panels.find')} title={`${t('panels.find')} (⌘ / Ctrl K)`} onClick={openFinder}><Search size={16}/></button>
   </div>
   {panelEntries.map(entry=>{const View=entry.value.view as ComponentType;return <Popover.Root key={entry.id} open={ui.panel===entry.id} onOpenChange={open=>{if(!open&&useUi.getState().panel===entry.id)ui.set({panel:null});}}><Popover.Anchor className={styles.panelAnchor}/>
     <Popover.Portal><Popover.Content onEscapeKeyDown={event=>{if(drafts?.discardFocused())event.preventDefault();}} onInteractOutside={event=>{if(document.body.dataset.assetDrag){event.preventDefault();return;}if(drafts?.pending)try{drafts.flush();}catch{event.preventDefault();return;}const target=event.detail.originalEvent.target;if(entry.value.icon==='properties'&&target instanceof Element&&target.closest('.viewport-wrap,[data-entity-select]'))event.preventDefault();}} data-editor-panel="true" aria-label={t(entry.value.titleKey)} className={styles.popover} style={{width:entry.value.preferredWidth??310,height:entry.value.preferredHeight,maxWidth:'calc(100vw - 32px)'}} align="end" sideOffset={12} collisionPadding={16} onOpenAutoFocus={e=>{e.preventDefault();if(automaticPanel.current===entry.id){automaticPanel.current=null;return;}const root=(e.target as HTMLElement).querySelector<HTMLElement>('[data-panel-content]');if(root)focusPanelContent(root);}} onCloseAutoFocus={e=>{if(pinTransfer.current===entry.id){e.preventDefault();pinTransfer.current=null;focusDockedPanel(entry.id);}else if(finderActive.current||useUi.getState().panel)e.preventDefault();else{e.preventDefault();toolsReturn.current?.focus({preventScroll:true});}}}>
      <div className={styles.panelHeader}><strong>{t(entry.value.titleKey)}</strong><button aria-label={`Pin ${t(entry.value.titleKey)}`} onClick={()=>pin(entry.id)}><Pin size={15}/></button><Popover.Close aria-label="Close panel"><X size={15}/></Popover.Close></div><div className={`panel-content ${styles.floatingContent}`} data-panel-content={entry.id} tabIndex={-1}><View/></div>
     </Popover.Content></Popover.Portal>
    </Popover.Root>;})}
   <DropdownMenu.Root><DropdownMenu.Trigger ref={workspaceTrigger} aria-label={t('workspace.choose')} title={t('workspace.choose')} className={styles.workspacePicker}><LayoutTemplate size={17}/><span>{t(`workspace.preset.${workspacePreset}`)}</span><ChevronDown size={12}/></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className={styles.menu} align="end" sideOffset={10}><DropdownMenu.Label className={styles.menuLabel}>{t('workspace.choose')}</DropdownMenu.Label>{workspacePresets.map(preset=><DropdownMenu.Item key={preset} className={styles.menuItem} onSelect={()=>applyPreset(preset)}><LayoutTemplate size={15}/>{t(`workspace.preset.${preset}`)}{workspacePreset===preset&&<Check size={14}/>}</DropdownMenu.Item>)}<DropdownMenu.Separator className={styles.separator}/><DropdownMenu.Item className={styles.menuItem} onSelect={()=>applyPreset('studio')}>{t('workspace.reset')}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
   {preferences&&<button ref={settingsTrigger} className={styles.settingsButton} aria-label={t('settings.title')} title={t('settings.title')} onClick={()=>openSettings()}><Settings size={17}/></button>}
  </header>
  <section className={styles.workspace} aria-label={t('workspace.choose')}><DockviewReact components={components as Record<string,React.FunctionComponent<IDockviewPanelProps>>} onReady={ready} className="editor-dock" theme={{name:'editor',className:'editor-dock-theme'}}/></section>
  <footer className={styles.footer}><span><i/>{t(ui.previewPreparing?'workspace.preparing':ui.mode==='edit'?'workspace.editing':ui.mode==='paused'?'workspace.paused':'workspace.playing')}</span></footer>
  {ui.notice&&<div className={styles.notice} role="alert"><span>{ui.notice}</span><button aria-label="Dismiss message" onClick={()=>ui.set({notice:''})}><X size={16}/></button></div>}
  {preferences&&<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} entries={settingEntries} store={preferences} onCloseAutoFocus={restoreSettings} projectSections={projectSettingSections} initialSection={settingsSection}/>}
  <PanelFinder open={finderOpen} onOpenChange={setFinderOpen} entries={finderEntries} choose={id=>{finderChoice.current=id;setFinderOpen(false);}} closed={()=>{finderActive.current=false;const id=finderChoice.current;finderChoice.current=null;if(id)showPanel(id);else{const target=finderReturn.current?.isConnected?finderReturn.current:finderFallback.current;target?.focus({preventScroll:true});}}}/>
 </main></Tooltip.Provider>;
}
