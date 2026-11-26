import { useEffect, useId, useRef, useState } from 'react';
import { Boxes, Check, ChevronRight, File, FileJson, FolderOutput, Pencil, Plus, Trash2 } from 'lucide-react';
import { bundleName, type AssetLibrary, type LibraryAction } from './assetLibrary';
import { hint, IconButton, PanelHeader } from './chrome';
import { locale, t } from './i18n';
import { valueDrop } from './valueDrag';

export function AssetBundles({ library, selection, editable, exportToDisk, mutate, focusRequest, revealAsset }: {
  library: AssetLibrary; selection: string[]; editable: boolean; exportToDisk?: () => Promise<string | null>;
  mutate: (action: LibraryAction) => void; focusRequest: number;
  revealAsset: (alias: string) => void;
}) {
  const nameInput = useRef<HTMLInputElement>(null);
  const memberListId = useId();
  const [expanded, setExpanded] = useState<ReadonlySet<string | null>>(new Set());
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState('');
  const [exporting, setExporting] = useState(false);
  const [directory, setDirectory] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [assignOnCreate, setAssignOnCreate] = useState(true);
  const bundles = library.bundles ?? [];
  const entries = new Map(library.entries.map(entry => [entry.alias, entry]));
  const members = new Map<string | null, AssetLibrary['entries']>();
  for (const entry of library.entries) {
    const id = entry.bundleId ?? null;
    if (!members.has(id)) members.set(id, []);
    members.get(id)!.push(entry);
  }

  function toggle(id: string | null) {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (focusRequest) {
      setEditing(undefined);
      setName('');
      setMessage(undefined);
      nameInput.current?.focus();
    }
  }, [focusRequest]);

  function assign(id: string | null, aliases = selection) {
    mutate({ type: 'bundle', operation: { type: 'assign', aliases, id } });
    setMessage(undefined);
  }

  const bundleDrop = (id: string | null) => valueDrop('asset', aliases => {
    if (!editable) return;
    const changes = aliases.filter(alias => entries.has(alias) && (entries.get(alias)?.bundleId ?? null) !== id);
    if (changes.length) return changes;
  }, aliases => assign(id, aliases));

  const allAssigned = (id: string | null) => selection.every(alias => (entries.get(alias)?.bundleId ?? null) === id);

  async function exportAll() {
    if (!exportToDisk) return;
    setMessage(undefined);
    setDirectory(undefined);
    setExporting(true);
    try {
      const result = await exportToDisk();
      if (result) setDirectory(result);
    } catch (error) {
      setMessage(t('bundleExportFailed', { detail: error instanceof Error ? error.message : String(error) }));
    } finally {
      setExporting(false);
    }
  }

  return <section className="panel bundles-panel" aria-label={t('assetBundles')}>
    <PanelHeader icon={Boxes} label={t('assetBundles')} description={t('assetBundlesHint')}>
      <strong className="bundles-panel-title">{t('bundlesButton')}</strong>
    </PanelHeader>
    <div className="panel-body bundles-panel-body">
      <p className="bundle-guidance">{t('bundleWorkflow')}</p>
      {selection.length > 0 && <p className="bundle-selection">{t('bundleSelection', { count: selection.length })}</p>}
      <div className="bundle-list" role="list" aria-label={t('assetBundles')}>
        {[{ id: null, name: t('bundleDefault') }, ...bundles].map(({ id, name }) => {
          const assigned = allAssigned(id);
          const open = expanded.has(id);
          const contentsId = `${memberListId}-${id ?? 'default'}`;
          const items = members.get(id) ?? [];
          return <div key={id ?? 'default'} role="listitem" className="bundle-item" data-expanded={open || undefined}>
            <div className="bundle-row" {...bundleDrop(id)}>
              <button type="button" className="bundle-row-toggle" aria-label={name} aria-expanded={open}
                aria-controls={contentsId} onClick={() => toggle(id)} {...hint(name, t('bundleContentsHint'))}>
                <ChevronRight className="bundle-disclosure" size={13} aria-hidden="true" />
                <span className="asset-icon bundle-thumbnail" aria-hidden="true"><FileJson size={21} /></span>
                <span className="bundle-row-info">
                  <strong>{name}</strong>
                  <small>{items.length === 1 ? t('singleAsset') : t('assetCount', { count: items.length })}</small>
                </span>
              </button>
              <div className="bundle-row-actions">
                {!!selection.length && <IconButton icon={assigned ? Check : Plus}
                  label={assigned ? t('bundleAssigned') : t('bundleAddTo', { name })}
                  disabled={!editable || assigned} onClick={() => assign(id)} />}
                {id && <><IconButton icon={Pencil} label={t('renameBundle', { name })} disabled={!editable} onClick={() => {
                  setEditing(id);
                  setName(name);
                  setMessage(undefined);
                  nameInput.current?.focus();
                }} />
                <IconButton icon={Trash2} label={t('removeBundle', { name })} description={t('removeBundleHint')}
                  disabled={!editable} onClick={() => {
                    mutate({ type: 'bundle', operation: { type: 'delete', id } });
                    if (editing === id) { setEditing(undefined); setName(''); }
                  }} /></>}
              </div>
            </div>
            <ul id={contentsId} className="bundle-members" aria-label={t('bundleContents', { name })} hidden={!open}>
              {open && (items.length ? items.sort((a, b) => a.name.localeCompare(b.name, locale)).map(entry =>
                <li key={entry.alias}>
                  <button type="button" className="bundle-member" onClick={() => revealAsset(entry.alias)}
                    {...hint(entry.name, t('revealBundleAssetHint'))}>
                    <File size={14} aria-hidden="true" /><span>{entry.name}</span>
                  </button>
                </li>) : <li className="bundle-members-empty">{t('bundleNoAssets')}</li>)}
            </ul>
          </div>;
        })}
      </div>
      <form className="bundle-editor" onSubmit={event => {
        event.preventDefault();
        const parsed = bundleName.safeParse(name.trim().toLowerCase());
        if (!parsed.success) { setMessage(t('bundleNameInvalid')); return; }
        try {
          mutate({ type: 'bundle', operation: { type: 'save', id: editing ?? crypto.randomUUID(), name: parsed.data,
            aliases: !editing && assignOnCreate ? selection : undefined } });
          setEditing(undefined);
          setName('');
          setMessage(undefined);
        } catch (error) {
          setMessage(error instanceof Error && error.message === 'bundleNameConflict' ? t('bundleNameConflict') : t('bundleNameInvalid'));
        }
      }}>
        <label>{t('bundleName')}<input ref={nameInput} value={name} onChange={event => setName(event.target.value)}
          placeholder="ui-icons" disabled={!editable} required /></label>
        <button className="bundle-command" type="submit" disabled={!editable}>
          {editing ? <Pencil size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
          {t(editing ? 'libraryApply' : 'createBundle')}
        </button>
      </form>
      {!editing && selection.length > 0 && <label className="bundle-create-selection">
        <input type="checkbox" checked={assignOnCreate} disabled={!editable}
          onChange={event => setAssignOnCreate(event.target.checked)} />{t('bundleAddOnCreate')}
      </label>}
      {message && <p className="error" role="alert">{message}</p>}
    </div>
    {exportToDisk && <footer className="bundle-footer">
      <div className="bundle-export">
        <div><strong>{t('bundleExportTitle')}</strong><small>{t('bundleExportContents')}</small></div>
        <button className="bundle-command bundle-command-primary" aria-label={t('exportBundles')}
          disabled={!editable || !library.entries.length} onClick={() => void exportAll()}>
          <FolderOutput size={15} aria-hidden="true" />{exporting ? t('packing') : t('exportBundles')}
        </button>
      </div>
      {directory && <p role="status" className="bundle-result">{t('bundleExported', { directory })}</p>}
    </footer>}
  </section>;
}
