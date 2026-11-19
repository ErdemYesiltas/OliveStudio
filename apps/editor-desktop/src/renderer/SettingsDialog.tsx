import {useMemo, useReducer, useEffect, useRef, useState} from 'react';
import {Dialog} from 'radix-ui';
import {Filter, RotateCcw, Search, X} from 'lucide-react';
import type {ComponentType} from 'react';
import type {Json, SettingDefinition, SettingsSectionDefinition, SettingsStore} from '@rewrite/sdk';
import {t} from './strings';
import styles from './Shell.module.css';

type Entry = {id: string; owner: string; value: SettingDefinition};
/**
 * Editor settings contributed by modules, grouped by section (or owner module). Values are machine-local, apply
 * immediately and never touch the project or its undo history.
 */
/**
 * VS Code-style layout: search on top, the section tree on the left (Project, then Editor), every matching setting in
 * one scrolling list on the right. The tree follows the scroll position; picking a section scrolls to it. Project
 * sections (e.g. Game rendering) edit the open project with undo, unlike the machine-local preferences below them.
 * `@modified` (or the filter button) shows only settings changed from their defaults.
 */
export function SettingsDialog({open, onOpenChange, entries, store, onCloseAutoFocus, projectSections = []}: {open: boolean; onOpenChange(open: boolean): void; entries: readonly Entry[]; store: SettingsStore; onCloseAutoFocus(event: Event): void; projectSections?: readonly {id: string; value: SettingsSectionDefinition}[]}) {
 const [, refresh] = useReducer((n: number) => n + 1, 0), [query, setQuery] = useState(''), [modifiedOnly, setModifiedOnly] = useState(false), [active, setActive] = useState(''), list = useRef<HTMLDivElement>(null);
 useEffect(() => store.subscribe(refresh), [store]);
 useEffect(() => { if (!open) { setQuery(''); setModifiedOnly(false); setActive(''); } }, [open]);
 const sections = useMemo(() => {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) { const key = entry.value.section ?? `module.${entry.owner}`; groups.set(key, [...(groups.get(key) ?? []), entry]); }
  return [...groups].map(([key, items]) => ({key, title: t(key) === key ? moduleTitle(key) : t(key), items: [...items].sort((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0))})).sort((a, b) => a.title.localeCompare(b.title));
 }, [entries]);
 const modifiedFilter = modifiedOnly || /(^|\s)@modified(\s|$)/.test(query), needle = query.replace(/@modified/g, '').trim().toLowerCase();
 const visible = sections.map(s => ({...s, items: s.items.filter(e => (!modifiedFilter || !store.isDefault(e.id)) && (!needle || [t(e.value.titleKey), e.value.descriptionKey ? t(e.value.descriptionKey) : '', s.title, e.id].some(text => text.toLowerCase().includes(needle))))})).filter(s => s.items.length);
 const matches = (p: {value: SettingsSectionDefinition}) => !needle || [t(p.value.titleKey), ...(p.value.keywords ?? [])].some(text => text.toLowerCase().includes(needle));
 const projects = modifiedFilter ? [] : projectSections.filter(p => p.value.scope !== 'editor' && matches(p)), editorViews = modifiedFilter ? [] : projectSections.filter(p => p.value.scope === 'editor' && matches(p));
 /** Editor group: module setting sections and custom editor views, by title. */
 const editorGroup = [...visible.map(s => ({key: s.key, title: s.title, count: s.items.length as number | undefined, section: s, view: undefined})), ...editorViews.map(p => ({key: p.id, title: t(p.value.titleKey), count: undefined, section: undefined, view: p.value.view as ComponentType}))].sort((a, b) => a.title.localeCompare(b.title));
 const modified = entries.filter(e => !store.isDefault(e.id)).length, found = visible.reduce((n, s) => n + s.items.length, 0), keys = [...projects.map(p => p.id), ...editorGroup.map(g => g.key)], current = keys.includes(active) ? active : keys[0] ?? '';
 /** The section whose heading was scrolled past last is the current one (the first when at the top). */
 const follow = () => { const box = list.current; if (!box) return; let next = keys[0] ?? ''; for (const el of box.querySelectorAll<HTMLElement>(':scope > section[data-section]')) if (el.offsetTop - box.offsetTop <= box.scrollTop + 12) next = el.dataset.section!; if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) next = keys.at(-1) ?? next; setActive(next); };
 const reveal = (key: string) => { setActive(key); const box = list.current, el = box?.querySelector<HTMLElement>(`:scope > section[data-section="${CSS.escape(key)}"]`); if (box && el) box.scrollTo({top: el.offsetTop - box.offsetTop}); };
 const nav = (key: string, title: string, count?: number) => <button key={key} className={styles.settingsNavItem} aria-current={current === key ? 'true' : undefined} data-nav={key} onClick={() => reveal(key)}><span>{title}</span>{count !== undefined && (needle || modifiedFilter) && <small>{count}</small>}</button>;
 return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className={styles.overlay}/>
  <Dialog.Content className={`${styles.dialog} ${styles.settingsDialog}`} data-testid="settings-dialog" onCloseAutoFocus={onCloseAutoFocus}>
   <header className={styles.settingsHeader}>
    <div><Dialog.Title>{t('settings.title')}</Dialog.Title><Dialog.Description>{t('settings.description')}</Dialog.Description></div>
    <div className={styles.settingsSearch}>
     <Search size={15} aria-hidden="true"/>
     <input type="search" aria-label={t('settings.search')} placeholder={t('settings.searchHint')} value={query} onChange={e => setQuery(e.target.value)}/>
     {(needle || modifiedFilter) && <span className={styles.settingsFound} role="status">{t('settings.found').replace('{n}', String(found))}</span>}
     <button aria-label={t('settings.modifiedOnly')} title={t('settings.modifiedOnly')} aria-pressed={modifiedOnly} onClick={() => setModifiedOnly(v => !v)}><Filter size={14}/></button>
    </div>
   </header>
   <div className={styles.settingsBody}>
    <nav className={styles.settingsNav} aria-label={t('settings.sections')}>
     {projects.length > 0 && <><h4>{t('settings.group.project')}</h4>{projects.map(p => nav(p.id, t(p.value.titleKey)))}</>}
     {editorGroup.length > 0 && <><h4>{t('settings.group.editor')}</h4>{editorGroup.map(g => nav(g.key, g.title, g.count))}</>}
    </nav>
    <div className={styles.settingsList} ref={list} onScroll={follow} data-testid="settings-content">
     {projects.map(p => { const View = p.value.view as ComponentType; return <section key={p.id} aria-label={t(p.value.titleKey)} data-section={p.id} data-project-section="true"><h3>{t(p.value.titleKey)}</h3><View/></section>; })}
     {editorGroup.map(g => g.view ? <section key={g.key} aria-label={g.title} data-section={g.key} data-editor-section="true"><h3>{g.title}</h3><g.view/></section> : <section key={g.key} aria-label={g.title} data-section={g.key}><h3>{g.title}</h3>
      {g.section!.items.map(e => <SettingRow key={e.id} id={e.id} section={g.title} definition={e.value} value={store.get(e.id)} isDefault={store.isDefault(e.id)} set={value => store.set(e.id, value)} reset={() => store.reset(e.id)}/>)}
     </section>)}
     {!editorGroup.length && !projects.length && <p className={styles.settingsEmpty}>{entries.length ? t('settings.noMatch') : t('settings.empty')}</p>}
    </div>
   </div>
   <footer className={styles.settingsFooter}><span>{modified ? t('settings.modifiedCount').replace('{n}', String(modified)) : ''}</span><button disabled={!modified} onClick={() => store.reset()}>{t('settings.resetAll')}</button></footer>
   <Dialog.Close className={styles.closeDialog} aria-label={t('settings.close')}><X size={18}/></Dialog.Close>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
const moduleTitle = (key: string) => { const id = key.replace(/^module\./, ''); return id.charAt(0).toUpperCase() + id.slice(1); };

function SettingRow({id, section, definition: d, value, isDefault, set, reset}: {id: string; section: string; definition: SettingDefinition; value: Json; isDefault: boolean; set(value: Json): void; reset(): void}) {
 const label = t(d.titleKey), help = d.descriptionKey ? t(d.descriptionKey) : '', described = help ? `${id}-help` : undefined;
 let control;
 if (d.kind === 'boolean') control = <label className={styles.settingCheck}><input type="checkbox" role="switch" aria-label={label} aria-describedby={described} checked={value === true} onChange={e => set(e.target.checked)}/>{help && <small id={described}>{help}</small>}</label>;
 else if (d.kind === 'enum') control = <select aria-label={label} aria-describedby={described} value={String(value)} onChange={e => set(e.target.value)}>{(d.options ?? []).map(o => <option key={o.value} value={o.value}>{t(o.titleKey)}</option>)}</select>;
 else if (d.kind === 'number' && d.min !== undefined && d.max !== undefined) control = <span className={styles.settingRange}><input type="range" aria-label={label} aria-describedby={described} min={d.min} max={d.max} step={d.step ?? 'any'} value={Number(value)} onChange={e => set(Number(e.target.value))}/><output>{`${Number(value)}${d.unit ?? ''}`}</output></span>;
 else control = <input key={String(value)} type={d.kind === 'number' ? 'number' : 'text'} aria-label={label} aria-describedby={described} defaultValue={String(value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={e => set(d.kind === 'number' ? Number(e.currentTarget.value) : e.currentTarget.value)}/>;
 return <div className={styles.settingRow} data-setting={id} data-modified={!isDefault}>
  <div className={styles.settingTitle}><span><small>{section}: </small>{label}</span>
   <button className={styles.settingReset} aria-label={`${t('settings.reset')} ${label}`} title={t('settings.reset')} disabled={isDefault} onClick={reset}><RotateCcw size={13}/></button></div>
  {help && d.kind !== 'boolean' && <small id={described} className={styles.settingHelp}>{help}</small>}
  <div className={styles.settingControl}>{control}</div>
 </div>;
}
