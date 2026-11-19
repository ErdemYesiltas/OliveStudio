import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import {X,Search} from 'lucide-react';
import {t,shortcutLabel} from './strings';
import styles from './Shell.module.css';
export function PanelFinder({open,onOpenChange,entries,choose,closed}:{open:boolean;onOpenChange(value:boolean):void;entries:readonly {id:string;title:string;shortcut?:string}[];choose(id:string):void;closed():void}){
 const [query,setQuery]=useState(''),[index,setIndex]=useState(0),input=useRef<HTMLInputElement>(null),selected=useRef<HTMLButtonElement>(null),listId=useId();
 const filtered=useMemo(()=>entries.filter(e=>(e.title+' '+e.id).toLowerCase().includes(query.trim().toLowerCase())),[query,entries]);const active=Math.min(index,Math.max(0,filtered.length-1));
 useEffect(()=>{if(open){setQuery('');setIndex(0);}},[open]);
 useEffect(()=>{if(open)selected.current?.scrollIntoView({block:'nearest'});},[active,query,open]);
 return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className={styles.overlay}/><Dialog.Content className={styles.dialog} data-testid="panel-finder" onOpenAutoFocus={e=>{e.preventDefault();input.current?.focus();}} onCloseAutoFocus={e=>{e.preventDefault();closed();}}>
  <Dialog.Title>{t('panels.find')}</Dialog.Title><Dialog.Description>{t('panels.description')}</Dialog.Description>
  <div className={styles.finderSearch}><Search size={16}/><input ref={input} autoComplete="off" spellCheck={false} role="combobox" aria-label={t('panels.search')} aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={filtered[active]?`${listId}-${active}`:undefined} value={query} onChange={e=>{setQuery(e.target.value);setIndex(0);}} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setIndex(i=>Math.max(0,Math.min(filtered.length-1,i+(e.key==='ArrowDown'?1:-1))));}if(e.key==='Enter'){e.preventDefault();if(filtered[active])choose(filtered[active].id);}}}/></div>
  <div role="listbox" tabIndex={-1} id={listId} aria-label={t('panels.results')} className={styles.finderResults}>{filtered.map((entry,i)=><button key={entry.id} ref={i===active?selected:undefined} id={`${listId}-${i}`} role="option" aria-selected={i===active} tabIndex={-1} onMouseDown={e=>e.preventDefault()} onMouseMove={()=>setIndex(i)} aria-keyshortcuts={entry.shortcut} onClick={()=>choose(entry.id)}>{entry.title}{entry.shortcut&&<kbd aria-hidden="true">{shortcutLabel(entry.shortcut)}</kbd>}</button>)}</div>
  {!filtered.length&&<p role="status">{t('panels.empty')}</p>}<Dialog.Close className={styles.closeDialog} aria-label={t('panels.close')}><X size={18}/></Dialog.Close>
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
