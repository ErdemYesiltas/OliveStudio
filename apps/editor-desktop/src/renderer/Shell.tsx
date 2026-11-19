import {presetPanels,workspacePresets,type WorkspacePreset} from './workspace-presets';
import {useDraftController} from '@rewrite/ui/drafts';
import {PanelFinder} from './PanelFinder';
import {ContrastReport} from './ContrastReport';
import {focusPanelContent,focusDockedPanel} from './panel-focus';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Popover, DropdownMenu, Dialog, Tooltip } from 'radix-ui';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview';
import { Gamepad2, Globe, SlidersVertical, Folder, Layers, SlidersHorizontal, LayoutTemplate, Pin, X, Box, Play, Pause, StepForward, Square, Plus, Type, Shapes, Activity, Puzzle, Check, SunMoon, ChevronDown, ChevronRight, Undo2, Redo2, Clapperboard, Orbit, SquareRoundCorner, Circle, Egg, Triangle, Hexagon, Star, Minus, Image, Film, Grid3x3, Frame, Waves, Spline, Sparkles, Bone, Music, Settings, Columns3, Rows3, LayoutDashboard, Hash, Languages, Workflow, Map as MapIcon, Video, PackageOpen, Boxes, GalleryVerticalEnd, WandSparkles, BotMessageSquare, FileCode, ListTodo, BookOpen, Gauge, Palette, MessageSquareText, GitBranch, Trophy } from 'lucide-react';
import { SettingsDialog } from './SettingsDialog';
import { overlays, panels, menus, tools, workspaces, createItems, createCategories, settings, settingsSections, type PanelDefinition, type SettingsStore, type CreateItemDefinition } from '@rewrite/sdk';
import type { ModuleHost } from '@rewrite/kernel';
import { useUi, notify } from './state';
import { applyTheme, resolveTheme, themes, ThemeSchema } from './themes';
import { t,shortcutLabel } from './strings';
import styles from './Shell.module.css';
import 'dockview/dist/styles/dockview.css';
import './global.css';
const icons: Record<string,ComponentType<{size?:number}>> = { input:Gamepad2,globals:Globe,mixer:SlidersVertical,physics:Orbit,animation:Clapperboard,layers:Layers, properties:SlidersHorizontal, library:Folder, box:Box, play:Play,pause:Pause,step:StepForward,stop:Square,plus:Plus,text:Type,shape:Shapes,shapes:Shapes,square:Square,squareRound:SquareRoundCorner,circle:Circle,ellipse:Egg,triangle:Triangle,hexagon:Hexagon,star:Star,line:Minus,image:Image,sprites:Image,film:Film,grid:Grid3x3,frame:Frame,mesh:Waves,meshes:Waves,rope:Spline,sparkles:Sparkles,effects:Sparkles,bone:Bone,skeletal:Bone,audio:Music,basic:Box,settings:Settings,row:Columns3,column:Rows3,layout:LayoutDashboard,bitmapText:Hash,localization:Languages,logic:Workflow,export:PackageOpen,generate:WandSparkles,assistant:BotMessageSquare,script:FileCode,jobs:ListTodo,skills:BookOpen,prefab:Boxes,scenes:GalleryVerticalEnd,tilemap:MapIcon,camera:Video,activity:Activity,profiler:Gauge,shader:Palette,dialogue:MessageSquareText,git:GitBranch,trophy:Trophy,undo:Undo2,redo:Redo2 };
function Icon({name}:{name:string}) { const View=icons[name]??Box; return <View size={17}/>; }
function Tip({label,children}:{label:string;children:React.ReactNode}) { return <Tooltip.Root><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className={styles.tooltip} sideOffset={8}>{label}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>; }
export function Shell({host,preferences}:{host:ModuleHost;preferences?:SettingsStore}) {
 const drafts=useDraftController();
 const settingsTrigger=useRef<HTMLButtonElement>(null);
 const ui=useUi(), api=useRef<DockviewApi|null>(null), subscriptions=useRef<{dispose():void}[]>([]);
 const [moduleOpen,setModuleOpen]=useState(false),[customOpen,setCustomOpen]=useState(false),[custom,setCustom]=useState(''),[customError,setCustomError]=useState('');
 const panelRow=useRef<HTMLDivElement>(null);
 const [workspacePreset,setWorkspacePreset]=useState<WorkspacePreset>(()=>{const saved=localStorage.getItem('rewrite:workspace-preset');return workspacePresets.includes(saved as WorkspacePreset)?saved as WorkspacePreset:'canvas';});
 const [settingsOpen,setSettingsOpen]=useState(false),settingEntries=useMemo(()=>host.entries(settings),[host]),projectSettingSections=useMemo(()=>host.entries(settingsSections),[host]);
 /** Add menu: categories in a fixed order; a category with one item shows it directly, larger ones are submenus. */
 const addGroups=useMemo(()=>{const groups=new Map<string,{id:string;owner:string;value:CreateItemDefinition}[]>();for(const e of host.entries(createItems))groups.set(e.value.category,[...(groups.get(e.value.category)??[]),e]);const rank=(c:string)=>{const i=(createCategories as readonly string[]).indexOf(c);return i<0?createCategories.length:i;};return [...groups].sort((a,b)=>rank(a[0])-rank(b[0])).map(([category,items])=>({category,items:[...items].sort((a,b)=>(a.value.order??0)-(b.value.order??0))}));},[host]);
 const [finderOpen,setFinderOpen]=useState(false),[contrastOpen,setContrastOpen]=useState(false),finderActive=useRef(false),finderReturn=useRef<HTMLElement|null>(null),finderFallback=useRef<HTMLElement|null>(null),finderChoice=useRef<string|null>(null),pinTransfer=useRef<string|null>(null);
 const [systemDark,setSystemDark]=useState(matchMedia('(prefers-color-scheme: dark)').matches);
 const panelEntries=useMemo(()=>host.entries(panels),[host]), workspace=host.entries(workspaces)[0];
 const definition=(id:string):PanelDefinition|undefined=>panelEntries.find(e=>e.id===id)?.value;
 const execute=(id:string)=>{void host.execute(id).catch(notify);};
 useEffect(()=>{
  const query=matchMedia('(prefers-color-scheme: dark)'), listener=()=>setSystemDark(query.matches); query.addEventListener('change',listener);
  try { const raw=JSON.parse(localStorage.getItem('rewrite:custom-themes')??'[]') as unknown[]; useUi.getState().set({customThemes:raw.map(v=>ThemeSchema.parse(v))}); } catch { /* Invalid preferences do not stop boot. */ }
  return()=>query.removeEventListener('change',listener);
 },[]);
 useEffect(()=>{const resolved=resolveTheme(ui.theme,systemDark,ui.customThemes);applyTheme(resolved);useUi.getState().set({resolvedTheme:resolved.id});localStorage.setItem('rewrite:theme',ui.theme);},[ui.theme,ui.customThemes,systemDark]);
 useEffect(()=>window.platform.onAction(name=>{
  if(name==='settings'){if(preferences)setSettingsOpen(true);return;}
  const menu=host.entries(menus).find(e=>e.id.endsWith(`.${name}`)); if(menu) execute(menu.value.command);
 }),[host]); // Native menu maps to contributed commands.
 useEffect(()=>()=>{for(const sub of subscriptions.current)sub.dispose();},[]);
 useEffect(()=>{if(ui.panel&&api.current?.getPanel(ui.panel)){api.current.getPanel(ui.panel)!.api.setActive();focusDockedPanel(ui.panel);useUi.getState().set({panel:null});}},[ui.panel]);
 const showPanel=(id:string)=>{const panel=api.current?.getPanel(id);if(panel){panel.api.setActive();useUi.getState().set({panel:null});focusDockedPanel(id);}else useUi.getState().set({panel:id});};
 const openFinder=()=>{try{drafts?.flush();}catch(error){notify(error);return;}finderReturn.current=document.activeElement instanceof HTMLElement?document.activeElement:null;finderFallback.current=[...document.querySelectorAll<HTMLElement>('[data-panel-trigger]')].find(node=>node.dataset.panelTrigger===useUi.getState().panel)??settingsTrigger.current;finderActive.current=true;useUi.getState().set({panel:null});setFinderOpen(true);};
 /** Panel shortcuts (⌥ + letter): toggle the panel, or focus it when docked. Not while typing or in a dialog. */
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(!event.altKey||event.metaKey||event.ctrlKey||event.shiftKey||event.repeat||event.defaultPrevented)return;const target=event.target instanceof HTMLElement?event.target:null;if(target?.closest('input,textarea,select,[contenteditable=true]')||document.querySelector('[role="dialog"]:not([data-editor-panel]),[role="menu"]'))return;
  const entry=panelEntries.find(e=>e.value.shortcut&&event.code===`Key${e.value.shortcut.split('+').pop()!.toUpperCase()}`);if(!entry)return;event.preventDefault();
  try{drafts?.flush();}catch(error){notify(error);return;}
  if(api.current?.getPanel(entry.id)){api.current.getPanel(entry.id)!.api.setActive();focusDockedPanel(entry.id);return;}
  const ui=useUi.getState();ui.set({panel:ui.panel===entry.id?null:entry.id});};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[panelEntries,drafts]);
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(!(event.metaKey||event.ctrlKey)||event.altKey||event.shiftKey||event.key.toLowerCase()!=='k'||event.repeat||event.isComposing)return;if(finderActive.current){event.preventDefault();setFinderOpen(false);return;}if(document.querySelector('[role="dialog"][data-state="open"]:not([data-editor-panel])'))return;event.preventDefault();openFinder();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 const restoreSettings=(event:Event)=>{event.preventDefault();settingsTrigger.current?.focus({preventScroll:true});};
 const pin=(id:string)=>{
  try{drafts?.flush();}catch(error){notify(error);return;}
  const def=definition(id),dock=api.current;if(!def||!dock)return;
  if(dock.getPanel(id)){dock.getPanel(id)!.api.setActive();}else dock.addPanel({id,component:'contribution',title:t(def.titleKey),params:{id},position:{direction:def.defaultDock==='bottom'?'below':def.defaultDock??(id.endsWith('layers')?'left':'right'),referencePanel:'workspace'},initialWidth:300,initialHeight:def.preferredHeight??350,minimumWidth:240});
  pinTransfer.current=id;useUi.getState().set({panel:null});
 };
 const applyPreset=(preset:WorkspacePreset)=>{
  const dock=api.current;if(!dock)return;try{drafts?.flush();}catch(error){notify(error);return;}
  const previous=dock.toJSON();try{useUi.getState().set({panel:null});for(const panel of [...dock.panels])if(panel.id!=='workspace')dock.removePanel(panel);
   for(const item of presetPanels(panelEntries,preset)){const def=definition(item.id)!;dock.addPanel({id:item.id,component:'contribution',title:t(def.titleKey),params:{id:item.id},position:{direction:item.side,referencePanel:'workspace'},initialWidth:item.side==='left'?250:320,initialHeight:item.side==='below'?300:undefined,minimumWidth:220});}
   setWorkspacePreset(preset);localStorage.setItem('rewrite:workspace-preset',preset);
  }catch(error){dock.fromJSON(previous);notify(error);}
 };
 const components=useMemo(()=>({
  contribution:({params}:{params:{id:string}})=>{const def=definition(params.id); const View=def?.view as ComponentType|undefined;return View?<div className="panel-content" data-panel-content={params.id} tabIndex={-1}><View/></div>:null;},
  workspace:()=>{const View=workspace?.value.view as ComponentType|undefined;return View?<View/>:<div className={styles.empty}><Box size={28}/><h1>Make room for your ideas.</h1><p>The empty profile is running. Add a workspace module to begin.</p></div>;},
 }),[host]);
 const ready=({api:dock}:DockviewReadyEvent)=>{
  api.current=dock;
  try {const saved=localStorage.getItem('rewrite:layout');if(saved)dock.fromJSON(JSON.parse(saved));}catch{dock.clear();}
  if(!dock.getPanel('workspace'))dock.addPanel({id:'workspace',component:'workspace',title:t(workspace?.value.titleKey??'workspace.empty')});
  for(const panel of [...dock.panels])if(panel.id!=='workspace'&&!definition(panel.id))dock.removePanel(panel);
  dock.getPanel('workspace')!.group.header.hidden=true;
  subscriptions.current.push(dock.onDidLayoutChange(()=>{localStorage.setItem('rewrite:layout',JSON.stringify(dock.toJSON()));}));
 };
 const addTheme=()=>{
  try {const parsed=ThemeSchema.safeParse(JSON.parse(custom));if(!parsed.success)throw Error('Provide a name, color scheme and complete hex color palette. Unknown fields are not allowed.');const value=parsed.data;if(themes.some(t=>t.id===value.id))throw Error('Built-in theme IDs are reserved');
   const list=[...ui.customThemes.filter(t=>t.id!==value.id),value];localStorage.setItem('rewrite:custom-themes',JSON.stringify(list));ui.set({customThemes:list,theme:value.id});setCustomError('');setCustomOpen(false);
  }catch(error){setCustomError(error instanceof SyntaxError?'Enter valid theme JSON.':error instanceof Error?error.message:'Invalid theme.');}
 };
 return <Tooltip.Provider delayDuration={450}>{host.entries(overlays).map(e=>{const View=e.value.view as ComponentType;return <View key={e.id}/>;})}<main className={styles.shell} data-testid="editor-shell" data-mode={ui.mode} data-workspace={workspacePreset} aria-busy={ui.busy}>
  <header className={styles.toolbar}>
   <div className={styles.trafficSpace}/>
   <DropdownMenu.Root><DropdownMenu.Trigger className={styles.projectButton} aria-label="Project menu">Projects <ChevronDown size={13}/></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className={styles.menu} sideOffset={12}>
    {host.entries(menus).map(e=><DropdownMenu.Item key={e.id} className={styles.menuItem} onSelect={()=>execute(e.value.command)}>{t(e.value.titleKey)}</DropdownMenu.Item>)}
   </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
   <span className={styles.divider}/><strong className={styles.projectTitle}>{ui.title}{ui.dirty&&<span aria-label="Unsaved changes" className={styles.dirty}/>}</strong>
   <div className={styles.tools}>{host.entries(tools).filter(e=>e.value.group==='add').map(tool=><DropdownMenu.Root key={tool.id}><DropdownMenu.Trigger className={styles.addButton} aria-label={t(tool.value.titleKey)} disabled={ui.mode!=='edit'||ui.busy}><Plus size={16}/><span>{t(tool.value.titleKey)}</span><ChevronDown size={13}/></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className={styles.menu} sideOffset={12} align="start" data-testid="add-menu">
     {addGroups.map(group=>{const item=(e:typeof group.items[number])=><DropdownMenu.Item key={e.id} className={styles.menuItem} data-create={e.id} onSelect={()=>{void host.execute(tool.value.command,e.id).catch(notify);}}><Icon name={e.value.icon??'box'}/>{t(e.value.titleKey)}</DropdownMenu.Item>;
      return group.items.length===1?item(group.items[0]):<DropdownMenu.Sub key={group.category}><DropdownMenu.SubTrigger className={styles.menuItem}><Icon name={group.category}/>{t(`create.category.${group.category}`)}<ChevronRight size={14}/></DropdownMenu.SubTrigger><DropdownMenu.Portal><DropdownMenu.SubContent className={styles.menu} sideOffset={6} aria-label={t(`create.category.${group.category}`)}>{group.items.map(item)}</DropdownMenu.SubContent></DropdownMenu.Portal></DropdownMenu.Sub>;})}
    </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>)}{host.entries(tools).filter(e=>e.value.group==='edit').map(e=><Tip key={e.id} label={t(e.value.titleKey)}><button aria-label={t(e.value.titleKey)} disabled={ui.mode!=='edit'||ui.busy} onClick={()=>execute(e.value.command)}><Icon name={e.value.icon}/></button></Tip>)}</div>
   <div className={styles.playback}>{host.entries(tools).filter(e=>e.value.group==='play').map(e=><Tip key={e.id} label={t(e.value.titleKey)}><button aria-label={t(e.value.titleKey)} disabled={ui.busy||(e.value.icon==='play'?ui.mode!=='edit':e.value.icon==='step'?ui.mode!=='paused':ui.mode==='edit')} onClick={()=>execute(e.value.command)}><Icon name={e.value.icon}/></button></Tip>)}</div>
   <div ref={panelRow} className={`${styles.panelButtons} ${styles.compact}`} data-compact="true">{panelEntries.map(entry=>{
    const View=entry.value.view as ComponentType;return <Popover.Root key={entry.id} open={ui.panel===entry.id} onOpenChange={open=>{
     if(open&&api.current?.getPanel(entry.id)){api.current.getPanel(entry.id)!.api.setActive();focusDockedPanel(entry.id);return;}if(open)ui.set({panel:entry.id});else if(useUi.getState().panel===entry.id)ui.set({panel:null});
    }}><Popover.Trigger asChild><button data-panel-trigger={entry.id} aria-label={t(entry.value.titleKey)} aria-keyshortcuts={entry.value.shortcut} title={`${t(entry.value.titleKey)}${entry.value.shortcut?` (${shortcutLabel(entry.value.shortcut)})`:''}`} className={ui.panel===entry.id?styles.active:''}><Icon name={entry.value.icon}/><span>{t(entry.value.titleKey)}</span></button></Popover.Trigger>
     <Popover.Portal><Popover.Content onEscapeKeyDown={event=>{if(drafts?.discardFocused())event.preventDefault();}} onInteractOutside={event=>{if(document.body.dataset.assetDrag){event.preventDefault();return;}if(drafts?.pending)try{drafts.flush();}catch{event.preventDefault();}}} data-editor-panel="true" aria-label={t(entry.value.titleKey)} className={styles.popover} style={{width:entry.value.preferredWidth??310,maxWidth:'calc(100vw - 32px)'}} align="end" sideOffset={16} collisionPadding={16} onOpenAutoFocus={e=>{e.preventDefault();const root=(e.target as HTMLElement).querySelector<HTMLElement>('[data-panel-content]');if(root)focusPanelContent(root);}} onCloseAutoFocus={e=>{if(pinTransfer.current===entry.id){e.preventDefault();pinTransfer.current=null;focusDockedPanel(entry.id);}else if(finderActive.current||useUi.getState().panel)e.preventDefault();}}>
      <div className={styles.panelHeader}><strong>{t(entry.value.titleKey)}</strong><button aria-label={`Pin ${t(entry.value.titleKey)}`} onClick={()=>pin(entry.id)}><Pin size={15}/></button><Popover.Close aria-label="Close panel"><X size={15}/></Popover.Close></div><div className="panel-content" data-panel-content={entry.id} tabIndex={-1}><View/></div>
     </Popover.Content></Popover.Portal>
    </Popover.Root>;
   })}</div>
   <DropdownMenu.Root><DropdownMenu.Trigger aria-label={t('workspace.choose')} title={t('workspace.choose')} className={styles.workspacePicker}><LayoutTemplate size={17}/><span>{t(`workspace.preset.${workspacePreset}`)}</span><ChevronDown size={12}/></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className={styles.menu} align="end" sideOffset={10}><DropdownMenu.Label className={styles.menuLabel}>{t('workspace.choose')}</DropdownMenu.Label>{workspacePresets.map(preset=><DropdownMenu.Item key={preset} className={styles.menuItem} onSelect={()=>applyPreset(preset)}><LayoutTemplate size={15}/>{t(`workspace.preset.${preset}`)}{workspacePreset===preset&&<Check size={14}/>}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
   <DropdownMenu.Root><DropdownMenu.Trigger ref={settingsTrigger} aria-label="Editor settings"><Settings size={19}/></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className={styles.menu} sideOffset={12} align="end" onCloseAutoFocus={event=>{if(finderActive.current||moduleOpen||customOpen||contrastOpen||settingsOpen)event.preventDefault();}}>
    <DropdownMenu.Item className={styles.menuItem} onSelect={openFinder}>{t('panels.find')} <kbd>⌘ / Ctrl K</kbd></DropdownMenu.Item>
    {preferences&&<DropdownMenu.Item className={styles.menuItem} onSelect={()=>setSettingsOpen(true)}><Settings size={15}/>{t('settings.title')}… <kbd>⌘ / Ctrl ,</kbd></DropdownMenu.Item>}
    <DropdownMenu.Label className={styles.menuLabel}>Appearance</DropdownMenu.Label>
    {[...themes.map(t=>({id:t.id,name:t.name})),{id:'system',name:'System'},...ui.customThemes.map(t=>({id:t.id,name:t.name}))].map(theme=><DropdownMenu.Item key={theme.id} className={styles.menuItem} onSelect={()=>ui.set({theme:theme.id})}><SunMoon size={15}/>{theme.name}{ui.theme===theme.id&&<Check size={15}/>}</DropdownMenu.Item>)}
    <DropdownMenu.Item className={styles.menuItem} onSelect={()=>setContrastOpen(true)}>{t('theme.contrast')}</DropdownMenu.Item>
    <DropdownMenu.Item className={styles.menuItem} onSelect={()=>setCustomOpen(true)}>Custom theme…</DropdownMenu.Item>
    <DropdownMenu.Separator className={styles.separator}/><DropdownMenu.Item className={styles.menuItem} onSelect={()=>setModuleOpen(true)}><Puzzle size={15}/>Modules</DropdownMenu.Item>
    <DropdownMenu.Item className={styles.menuItem} onSelect={()=>applyPreset('canvas')}>Reset panel layout</DropdownMenu.Item>
   </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
  </header>
  <section className={styles.workspace}><DockviewReact components={components as Record<string,React.FunctionComponent<IDockviewPanelProps>>} onReady={ready} className="editor-dock" theme={{name:'editor',className:'editor-dock-theme'}}/></section>
  <footer className={styles.footer}><span>{ui.mode==='edit'?'Scene':ui.mode==='paused'?'Preview paused':'Preview running'}</span><span>{[...host.states.values()].filter(s=>s==='active').length} modules active</span></footer>
  {ui.notice&&<div className={styles.notice} role="alert"><span>{ui.notice}</span><button aria-label="Dismiss message" onClick={()=>ui.set({notice:''})}><X size={16}/></button></div>}
  <Dialog.Root open={moduleOpen} onOpenChange={setModuleOpen}><Dialog.Portal><Dialog.Overlay className={styles.overlay}/><Dialog.Content className={styles.dialog} onCloseAutoFocus={restoreSettings}><Dialog.Title>Modules</Dialog.Title><Dialog.Description>Installed feature modules and their current activation state. Module changes require a restart.</Dialog.Description>
   {[...host.states].map(([id,state])=><div className={styles.moduleRow} key={id}><Puzzle size={17}/><span>{id}</span><span>{state}</span></div>)}
   {host.diagnostics.map((d,i)=><p key={i} role="alert">{d.owner}: {d.message}</p>)}<Dialog.Close className={styles.closeDialog} aria-label="Close modules"><X size={18}/></Dialog.Close>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
  <Dialog.Root open={customOpen} onOpenChange={setCustomOpen}><Dialog.Portal><Dialog.Overlay className={styles.overlay}/><Dialog.Content className={styles.dialog} onCloseAutoFocus={restoreSettings}><Dialog.Title>Custom theme</Dialog.Title><Dialog.Description>Paste a theme JSON with a name, color scheme and complete color palette.</Dialog.Description>
   {customError&&<p role="alert" className={styles.themeError}>{customError}</p>}<textarea aria-label="Theme JSON" value={custom} onChange={e=>setCustom(e.target.value)} placeholder={JSON.stringify(themes[0],null,2)}/>
   {(()=>{const parsed=ThemeSchema.safeParse((()=>{try{return JSON.parse(custom);}catch{return null;}})());return parsed.success?<ContrastReport theme={parsed.data}/>:null;})()}
   <button onClick={addTheme}>Apply theme</button><Dialog.Close className={styles.closeDialog} aria-label="Close theme"><X size={18}/></Dialog.Close>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
  {preferences&&<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} entries={settingEntries} store={preferences} onCloseAutoFocus={restoreSettings} projectSections={projectSettingSections}/>}
  <PanelFinder open={finderOpen} onOpenChange={setFinderOpen} entries={panelEntries.map(e=>({id:e.id,title:t(e.value.titleKey),shortcut:e.value.shortcut}))} choose={id=>{finderChoice.current=id;setFinderOpen(false);}} closed={()=>{finderActive.current=false;const id=finderChoice.current;finderChoice.current=null;if(id)showPanel(id);else{const target=finderReturn.current?.isConnected?finderReturn.current:finderFallback.current;target?.focus({preventScroll:true});}}}/>
  <Dialog.Root open={contrastOpen} onOpenChange={setContrastOpen}><Dialog.Portal><Dialog.Overlay className={styles.overlay}/><Dialog.Content className={styles.dialog} onCloseAutoFocus={restoreSettings}><Dialog.Title>{t('theme.contrast')}</Dialog.Title><Dialog.Description>{t('theme.contrastDescription')}</Dialog.Description><ContrastReport theme={resolveTheme(ui.theme,systemDark,ui.customThemes)}/><Dialog.Close className={styles.closeDialog} aria-label={t('theme.closeContrast')}><X size={18}/></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
 </main></Tooltip.Provider>;
}
