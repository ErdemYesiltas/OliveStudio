import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArchiveRestore, ArrowRight, Bone, Boxes, FilePlus2, FolderOpen, FolderSearch, GitBranch, Image, Leaf, Pin, PinOff, Search, Sparkles, Theater, X } from 'lucide-react';
import { IconButton } from './chrome';
import { locale, t } from './i18n';

const startupKey = 'olive.hub.startup';
export const showHubAtStartup = () => !!window.oliveFiles && !window.oliveHost?.bound && localStorage.getItem(startupKey) !== 'off';

type Props = {
  busy: boolean;
  error?: string;
  close: () => void;
  create: () => void;
  open: () => void;
  openRecent: (id: string) => void;
  openExample: (id: 'grove' | 'gallery' | 'theatre' | 'tavern' | 'photo' | 'rig') => void;
  autoRecovery: boolean;
  setAutoRecovery: (enabled: boolean) => void;
  saveRecovery: () => Promise<void> | undefined;
  openRecovery: (id: string) => void;
  history: ReactNode;
};

const examples = [
  { id: 'grove', icon: Leaf, title: 'hubGroveTitle', description: 'hubGroveDescription' },
  { id: 'gallery', icon: Boxes, title: 'hubGalleryTitle', description: 'hubGalleryDescription' },
  { id: 'theatre', icon: Theater, title: 'hubTheatreTitle', description: 'hubTheatreDescription' },
  { id: 'tavern', icon: Theater, title: 'hubTavernTitle', description: 'hubTavernDescription' },
  { id: 'photo', icon: Image, title: 'hubPhotoTitle', description: 'hubPhotoDescription' },
  { id: 'rig', icon: Bone, title: 'hubRigTitle', description: 'hubRigDescription' },
] as const;

export function Hub({ busy, close, create, open, openRecent, openExample, error, autoRecovery, setAutoRecovery, saveRecovery, openRecovery, history }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<'projects' | 'examples' | 'recovery' | 'history'>('projects');
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<RecentScene[]>();
  const [startup, setStartup] = useState(showHubAtStartup);
  const [failure, setFailure] = useState<string>();
  const [copies, setCopies] = useState<RecoveryCopy[]>();
  const [checkpointing, setCheckpointing] = useState(false);
  const bridge = window.oliveFiles?.hub;
  const recovery = window.oliveFiles?.recovery;

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    void bridge?.list().then(result => { if (active) setRecent(result); },
      detail => { if (active) setFailure(String(detail)); });
    return () => { active = false; };
  }, [bridge]);
  useEffect(() => {
    if (section !== 'recovery' || !recovery) return;
    let active = true;
    void recovery.list().then(result => { if (active) setCopies(result); }, detail => { if (active) setFailure(String(detail)); });
    return () => { active = false; };
  }, [section, recovery]);

  async function manageRecovery(operation: () => Promise<void> | undefined) {
    if (!recovery) return;
    setCheckpointing(true);
    setFailure(undefined);
    try { await operation(); setCopies(await recovery.list()); }
    catch (detail) { setFailure(String(detail)); }
    finally { setCheckpointing(false); }
  }

  function navigate(target: typeof section) {
    setSection(target);
    setQuery('');
    setFailure(undefined);
  }

  async function manage(id: string, action: 'pin' | 'remove' | 'reveal') {
    if (!bridge) return;
    setFailure(undefined);
    try {
      await bridge.action(id, action);
      if (action !== 'reveal') setRecent(await bridge.list());
    } catch (detail) {
      setFailure(String(detail));
    }
  }

  const matches = (...parts: string[]) => parts.join(' ').toLocaleLowerCase(locale)
    .includes(query.trim().toLocaleLowerCase(locale));
  const projects = recent?.filter(item => matches(item.name, item.path));
  const featured = examples.filter(item => (item.id === 'grove' || (bridge && (item.id === 'gallery' || !window.oliveHost?.bound))) && matches(t(item.title), t(item.description)));
  const title = t(section === 'projects' ? 'hubProjects' : section === 'examples' ? 'hubExamples' : section === 'history' ? 'projectHistory' : 'hubRecovery');
  const search = t(section === 'projects' ? 'hubSearchProjects' : section === 'examples' ? 'hubSearchExamples' : 'recoverySearch');
  return <dialog className="hub" ref={dialog} aria-labelledby="hub-title" onCancel={event => {
    event.preventDefault();
    if (!busy) close();
  }}>
    <aside className="hub-sidebar">
      <h1 id="hub-title"><Leaf size={20} aria-hidden="true" />{t('hubTitle')}</h1>
      <nav aria-label={t('hubSections')}>
        <button type="button" aria-current={section === 'projects' ? 'page' : undefined} onClick={() => navigate('projects')}>
          <FolderOpen size={16} aria-hidden="true" />{t('hubProjects')}
        </button>
        <button type="button" aria-current={section === 'examples' ? 'page' : undefined} onClick={() => navigate('examples')}>
          <Sparkles size={16} aria-hidden="true" />{t('hubExamples')}
        </button>
        {recovery && <button type="button" aria-current={section === 'recovery' ? 'page' : undefined} onClick={() => navigate('recovery')}>
          <ArchiveRestore size={16} aria-hidden="true" />{t('hubRecovery')}
        </button>}
        {history && <button type="button" aria-current={section === 'history' ? 'page' : undefined} onClick={() => navigate('history')}>
          <GitBranch size={16} aria-hidden="true" />{t('projectHistory')}
        </button>}
      </nav>
      <label className="hub-startup"><input type="checkbox" checked={startup} onChange={event => {
        setStartup(event.target.checked);
        localStorage.setItem(startupKey, event.target.checked ? 'on' : 'off');
      }} />{t('hubShowAtStartup')}</label>
      <button className="hub-continue" type="button" disabled={busy} onClick={close}>
        {t('hubContinue')}<ArrowRight size={15} aria-hidden="true" />
      </button>
    </aside>
    <section className="hub-content" aria-label={title}>
      <header className="hub-header">
        <h2>{title}</h2>
        <div className="hub-actions">
          <button type="button" disabled={busy} onClick={open}><FolderSearch size={15} aria-hidden="true" />{t('hubOpenProject')}</button>
          <button type="button" disabled={busy} className="hub-primary" onClick={create}>
            <FilePlus2 size={15} aria-hidden="true" />{t('hubNewProject')}
          </button>
        </div>
        <IconButton icon={X} label={t('dismiss')} disabled={busy} onClick={close} />
      </header>
      {section !== 'history' && <label className="hub-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" aria-label={search} placeholder={search} value={query} onChange={event => setQuery(event.target.value)} />
      </label>}
      {(error || failure) && <p className="error hub-error" role="alert">{error ?? failure}</p>}
      <div className="hub-scroll">
        {section === 'history' ? history : section === 'projects' ? <>
          <ul className="hub-projects" aria-label={t('hubRecent')}>
            {projects?.map(item => <li key={item.id}>
              <button className="hub-project" type="button" disabled={busy || !item.exists}
                aria-label={t('hubOpenNamed', { name: item.name })} onClick={() => openRecent(item.id)}>
                <FolderOpen size={18} aria-hidden="true" />
                <span><strong>{item.name}</strong><small title={item.path}>{item.path}</small></span>
                <small>{item.exists ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(item.lastOpened) : t('hubMissing')}</small>
              </button>
              {item.exists && <IconButton icon={FolderSearch} label={t('hubReveal', { name: item.name })}
                disabled={busy} onClick={() => void manage(item.id, 'reveal')} />}
              <IconButton icon={item.pinned ? PinOff : Pin} label={t(item.pinned ? 'hubUnpin' : 'hubPin', { name: item.name })}
                disabled={busy} onClick={() => void manage(item.id, 'pin')} />
              <IconButton icon={X} label={t('hubRemove', { name: item.name })} disabled={busy}
                onClick={() => void manage(item.id, 'remove')} />
            </li>)}
          </ul>
          {recent?.length === 0 && <div className="hub-empty">
            <p>{t('hubNoProjects')}</p>
            <button type="button" onClick={() => navigate('examples')}>{t('hubBrowseExamples')}</button>
          </div>}
          {!!recent?.length && projects?.length === 0 && <p className="hub-empty">{t('hubNoMatches')}</p>}
        </> : section === 'examples' ? <div className="hub-examples">
          {featured.map(({ id, title, description, icon: Icon }) => <article key={id}>
            <div className="hub-example-icon" data-example={id}><Icon size={32} aria-hidden="true" /></div>
            <h3>{t(title)}</h3>
            <p>{t(description)}</p>
            <button type="button" disabled={busy} aria-label={t('hubOpenNamed', { name: t(title) })} onClick={() => openExample(id)}>
              {t('hubOpenExample')}<ArrowRight size={14} aria-hidden="true" />
            </button>
          </article>)}
          {!featured.length && <p className="hub-empty">{t('hubNoMatches')}</p>}
        </div> : <>
          <div className="hub-recovery-actions">
            <label><input type="checkbox" checked={autoRecovery} onChange={event => setAutoRecovery(event.target.checked)} />{t('recoveryAutomatic')}</label>
            <button type="button" disabled={busy || checkpointing} onClick={() => void manageRecovery(saveRecovery)}>{t('recoveryCheckpoint')}</button>
          </div>
          <ul className="hub-projects" aria-label={title}>
            {copies?.filter(copy => matches(copy.name)).map(copy => <li key={copy.id}>
              <button className="hub-project" type="button" disabled={busy} onClick={() => openRecovery(copy.id)}>
                <ArchiveRestore size={18} aria-hidden="true" /><strong>{copy.name}</strong>
                <small>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(copy.at)}</small>
              </button>
              <IconButton icon={X} label={t('hubRemove', { name: copy.name })} disabled={busy || checkpointing}
                onClick={() => void manageRecovery(() => recovery?.remove(copy.id))} />
            </li>)}
          </ul>
          {copies?.length === 0 && <p className="hub-empty">{t('recoveryEmpty')}</p>}
        </>}
      </div>
    </section>
  </dialog>;
}
