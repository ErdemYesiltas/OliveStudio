import {useState} from 'react';
import {Popover} from 'radix-ui';
import {Search,Layers,Clapperboard,Music,PackageOpen,WandSparkles,ChevronRight,ChevronDown} from 'lucide-react';
import {toolGroups,filterTools,type ToolGroup} from './canvas-tools';
import {t,shortcutLabel} from './strings';
import styles from './Shell.module.css';
const groupIcons={scene:Layers,motion:Clapperboard,audio:Music,build:PackageOpen,automate:WandSparkles};
export function CanvasTools({entries,choose}:{entries:readonly {id:string;title:string;icon:string;shortcut?:string}[];choose(id:string):void}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[group,setGroup]=useState<ToolGroup>('scene');
 const filtered=filterTools(entries,query,group),select=(id:string)=>{setOpen(false);choose(id);};
 return <Popover.Root open={open} onOpenChange={value=>{setOpen(value);if(value)setQuery('');}}><Popover.Trigger className={styles.toolsLauncher} aria-label={t('canvas.tools')}><Layers size={16}/><span>{t('canvas.tools')}</span><ChevronDown size={13}/></Popover.Trigger><Popover.Portal><Popover.Content className={styles.toolsMenu} align="end" sideOffset={12} collisionPadding={12} aria-label={t('canvas.tools')} onCloseAutoFocus={event=>{if(document.querySelector('[data-editor-panel]'))event.preventDefault();}}>
  <label className={styles.toolSearch}><Search size={15}/><input autoComplete="off" aria-label={t('canvas.search')} placeholder={t('canvas.search')} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&filtered[0]){e.preventDefault();select(filtered[0].id);}}}/><kbd>↵</kbd></label>
  <div className={styles.toolBrowser}>{!query.trim()&&<nav aria-label={t('canvas.categories')} className={styles.toolCategories}>{toolGroups.map(id=>{const Icon=groupIcons[id];return <button key={id} aria-pressed={group===id} onClick={()=>setGroup(id)}><Icon size={16}/>{t(`canvas.group.${id}`)}<ChevronRight size={13}/></button>;})}</nav>}
  <div className={styles.toolResults} aria-label={t('canvas.results')}>{filtered.map(entry=><button key={entry.id} data-panel-trigger={entry.id} onClick={()=>select(entry.id)}><span>{entry.title}</span>{entry.shortcut&&<kbd>{shortcutLabel(entry.shortcut)}</kbd>}</button>)}{!filtered.length&&<p role="status">{t('panels.empty')}</p>}</div></div>
 </Popover.Content></Popover.Portal></Popover.Root>;
}
