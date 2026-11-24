import {Dialog} from 'radix-ui';
import {useEffect, useMemo, useState, type ReactNode} from 'react';
import {Box, FilePlus2, FolderOpen, FolderSearch, LayoutGrid, Search, Sparkles, Trash2, X, Pin, PinOff} from 'lucide-react';
import {useUi} from './state';
import styles from './Hub.module.css';

type View = 'projects' | 'examples';
const ago = (time: number, t: (key: string) => string) => {
 const s = Math.max(0, (Date.now() - time) / 1000);
 if (s < 60) return t('hub.justNow');
 const [n, unit] = s < 3600 ? [s / 60, 'minutes'] : s < 86400 ? [s / 3600, 'hours'] : s < 86400 * 30 ? [s / 86400, 'days'] : [0, ''];
 return unit ? t(`hub.ago.${unit}`).replace('{n}', String(Math.floor(n))) : new Date(time).toLocaleDateString();
};

/**
 * The Hub: a start screen like Unity Hub. Projects lists recently opened projects (open, show in Finder, remove from
 * the list); Examples copies a bundled example to a new folder and opens it. Closing it shows the editor.
 */
export function createHub(bridge: {text(key: string): string; report(error: unknown): void; open(path: string): Promise<boolean>; create(id: string): Promise<boolean>; openFile(): Promise<boolean>; newProject(): Promise<boolean>}) {
 const t = bridge.text;
 return function Hub() {
  const open = useUi(s => s.hub), busy = useUi(s => s.busy), set = useUi(s => s.set);
  const [view, setView] = useState<View>('projects'), [query, setQuery] = useState(''), [projects, setProjects] = useState<HubProject[] | null>(null), [examples, setExamples] = useState<HubExample[]>([]);
  const refresh = () => { void window.platform.hub.list().then(setProjects, bridge.report); };
  useEffect(() => { if (!open) return; setView('projects'); setQuery(''); refresh(); void window.platform.hub.examples().then(setExamples, bridge.report); }, [open]);
  const run = (work: () => Promise<boolean>) => { void work().then(done => { if (done) set({hub: false}); else refresh(); }, error => { bridge.report(error); refresh(); }); };
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => (projects ?? []).filter(p => !needle || p.name.toLowerCase().includes(needle) || p.path.toLowerCase().includes(needle)), [projects, needle]);
  const shownExamples = useMemo(() => examples.filter(e => !needle || [e.title, e.description, ...e.tags].some(x => x.toLowerCase().includes(needle))), [examples, needle]);
  const nav = (key: View, icon: ReactNode) => <button className={styles.navItem} aria-current={view === key ? 'page' : undefined} onClick={() => { setView(key); setQuery(''); }}>{icon}<span>{t(`hub.${key}`)}</span></button>;
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) set({hub: false}); }}><Dialog.Portal>
   <Dialog.Content className={styles.hub} data-testid="hub" aria-describedby={undefined}>
    <aside className={styles.side}>
     <div className={styles.brand}><span className={styles.logo}><Box size={18}/></span><Dialog.Title className={styles.title}>{t('hub.title')}</Dialog.Title></div>
     <nav aria-label={t('hub.sections')}>{nav('projects', <FolderOpen size={16}/>)}{nav('examples', <Sparkles size={16}/>)}</nav>
     <button className={styles.continue} onClick={() => set({hub: false})}>{t('hub.continue')}</button>
    </aside>
    <section className={styles.main} aria-label={t(`hub.${view}`)}>
     <header className={styles.header}>
      <h2>{t(`hub.${view}`)}</h2>
      {view === 'projects' && <div className={styles.actions}>
       <button disabled={busy} onClick={() => run(bridge.openFile)}><FolderSearch size={15}/>{t('hub.openFile')}</button>
       <button className={styles.primary} disabled={busy} onClick={() => run(bridge.newProject)}><FilePlus2 size={15}/>{t('hub.newProject')}</button>
      </div>}
      <Dialog.Close className={styles.close} aria-label={t('hub.close')}><X size={16}/></Dialog.Close>
     </header>
     <label className={styles.search}><Search size={15} aria-hidden="true"/><input type="search" aria-label={t(`hub.search.${view}`)} placeholder={t(`hub.search.${view}`)} value={query} onChange={e => setQuery(e.target.value)}/></label>
     {view === 'projects' ? <div className={styles.list} role="list" aria-label={t('hub.recent')} data-testid="hub-projects">
      {projects !== null && !projects.length && <div className={styles.empty}><p>{t('hub.empty')}</p><button onClick={() => setView('examples')}><LayoutGrid size={15}/>{t('hub.browseExamples')}</button></div>}
      {projects !== null && projects.length > 0 && !shown.length && <p className={styles.empty}>{t('hub.noMatch')}</p>}
      {shown.map(p => <div key={p.path} role="listitem" className={styles.row} data-missing={!p.exists || undefined} data-pinned={p.pinned || undefined}>
       <button className={styles.rowOpen} disabled={busy || !p.exists} aria-label={t('hub.openNamed').replace('{name}', p.name)} onClick={() => run(() => bridge.open(p.path))}>
        <span className={styles.thumb}>{p.thumbnail ? <img src={p.thumbnail} alt=""/> : <Box size={22}/>}</span>
        <span className={styles.rowText}><strong>{p.pinned && <Pin size={12} aria-hidden="true"/>} {p.name}</strong><small title={p.path}>{p.path}</small></span>
        <span className={styles.rowMeta}>{p.exists ? <><span>{ago(p.modifiedAt ?? p.openedAt, t)}</span><small>{t(p.scenes === 1 ? 'hub.scene' : 'hub.scenes').replace('{n}', String(p.scenes))}</small></> : <span className={styles.missing}>{t('hub.missing')}</span>}</span>
       </button>
       {p.exists && <button className={styles.icon} aria-label={t('hub.revealNamed').replace('{name}', p.name)} title={t('hub.reveal')} onClick={() => { void window.platform.hub.reveal(p.path).catch(bridge.report); }}><FolderOpen size={15}/></button>}
       <button className={styles.icon} aria-label={t(p.pinned ? 'hub.unpinNamed' : 'hub.pinNamed').replace('{name}', p.name)} aria-pressed={Boolean(p.pinned)} title={t(p.pinned ? 'hub.unpin' : 'hub.pin')} onClick={() => { void window.platform.hub.pin(p.path, !p.pinned).then(refresh, bridge.report); }}>{p.pinned ? <PinOff size={15}/> : <Pin size={15}/>}</button>
       <button className={styles.icon} aria-label={t('hub.removeNamed').replace('{name}', p.name)} title={t('hub.remove')} onClick={() => { void window.platform.hub.remove(p.path).then(refresh, bridge.report); }}><Trash2 size={15}/></button>
      </div>)}
     </div> : <div className={styles.grid} role="list" aria-label={t('hub.examples')} data-testid="hub-examples">
      {shownExamples.map(e => <article key={e.id} role="listitem" className={styles.card} data-example={e.id}>
       <div className={styles.cardImage}>{e.thumbnail ? <img src={e.thumbnail} alt=""/> : <Sparkles size={28}/>}</div>
       <div className={styles.cardBody}><h3>{e.title}</h3><p>{e.description}</p><div className={styles.tags}>{e.tags.map(tag => <span key={tag}>{tag}</span>)}</div></div>
       <button className={styles.primary} disabled={busy} aria-label={t('hub.createNamed').replace('{name}', e.title)} onClick={() => run(() => bridge.create(e.id))}><FilePlus2 size={15}/>{t('hub.create')}</button>
      </article>)}
      {!shownExamples.length && <p className={styles.empty}>{t('hub.noMatch')}</p>}
     </div>}
    </section>
   </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
 };
}
