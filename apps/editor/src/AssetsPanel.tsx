import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type Ref } from 'react';
import {
  AudioLines, Bone, Boxes, Film, ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Import, LayoutGrid, Link2, List,
  ListChecks, PackageOpen, Play, RefreshCw, Search, Square, X,
} from 'lucide-react';
import {
  allAssets, assetDragType, builtInRoot, extension, folderDragType, libraryName, projectRoot, assetUsers,
  type createCatalog, type LibraryAction, type LibraryItem,
} from './assetLibrary';
import type { AudioStatus } from './audio';
import { hint, IconButton, PanelHeader } from './chrome';
import { locale, t } from './i18n';
import type { Scene } from './scene';
import { startValueDrag } from './valueDrag';

type Catalog = ReturnType<typeof createCatalog>;
type FolderNode = Catalog['folders'] extends Map<string, infer F> ? F : never;
type Mode = 'create' | 'rename' | 'move';
const projectParent = (id: string) => id === projectRoot ? null : id;

export type AssetsPanelHandle = { reveal: (alias: string, openContainingFolder?: boolean) => void };

type Props = {
  ref?: Ref<AssetsPanelHandle>;
  catalog: Catalog; scene: Scene; referencedObjects: Scene['objects']; editable: boolean; canAssign: boolean; audio: AudioStatus;
  packing: boolean; loaded: boolean; importing?: boolean; error?: string; rebuild?: () => void;
  importFiles?: (folder: string | null, files?: File[]) => void;
  createSpine: (folder: string | null) => void;
  bundlesOpen: boolean;
  toggleBundles: () => void;
  createBundle: () => void;
  onBundleSelectionChange: (aliases: string[]) => void;
  inspect: (aliases: string[]) => void;
  mutate: (action: LibraryAction) => void;
  assign: (alias: string) => void; play: (alias: string) => void; stop: () => void;
};

export function AssetsPanel({
  ref, catalog, scene, referencedObjects, editable, canAssign, audio, packing, loaded, importing, error, rebuild,
  importFiles, createSpine, bundlesOpen, toggleBundles, createBundle, onBundleSelectionChange, inspect, mutate, assign, play, stop,
}: Props) {
  const { folders, entries } = catalog;
  const [folder, setFolder] = useState(allAssets);
  const [expanded, setExpanded] = useState(new Set([projectRoot, builtInRoot]));
  const [item, setItem] = useState<LibraryItem>();
  const [selectedAliases, setSelectedAliases] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const selectionAnchor = useRef<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'image' | 'audio' | 'animated' | 'generated'>('all');
  const [layout, setLayout] = useState(() => localStorage.getItem('olive.assets.layout') === 'list' ? 'list' : 'grid');
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [form, setForm] = useState<Mode>();
  const [createParent, setCreateParent] = useState(projectRoot);
  const [message, setMessage] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [fileDrop, setFileDrop] = useState(false);
  const [bundleMenu, setBundleMenu] = useState(false);
  const [assignedBundle, setAssignedBundle] = useState<{ id: string; name: string }>();
  const [revealAlias, setRevealAlias] = useState<string>();
  const revealButton = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const currentFolder = folders.has(folder) ? folder : allAssets;
  const writableFolder = folders.get(currentFolder)?.writable ? currentFolder : projectRoot;
  const pathTo = useCallback((id: string) => {
    const path: FolderNode[] = [];
    for (let node = folders.get(id); node; node = folders.get(node.parentId)) path.unshift(node);
    return path;
  }, [folders]);
  const ordered = useMemo(() => [...folders.values()].sort((a, b) => a.name.localeCompare(b.name, locale)), [folders]);
  const search = query.trim().toLocaleLowerCase(locale);
  const visible = useMemo(() => entries.filter(entry => {
    if (filter === 'generated') {
      if (!entry.generated) return false;
    } else if (filter === 'animated' ? entry.kind !== 'spine' && entry.kind !== 'sheet' : filter !== 'all' && filter !== entry.kind) return false;
    if (search) return [...pathTo(entry.folderId).map(node => node.name), entry.name, ...(entry.tags ?? [])]
      .join(' ').toLocaleLowerCase(locale).includes(search);
    if (filter === 'generated') return true;
    return currentFolder === allAssets || entry.folderId === currentFolder;
  }).sort((a, b) => a.name.localeCompare(b.name, locale)), [entries, filter, search, pathTo, currentFolder]);
  const selection = useMemo(() => new Set(selectedAliases), [selectedAliases]);
  const picked = useMemo(() => visible.filter(entry => selection.has(entry.alias)), [visible, selection]);
  const projectSelection = useMemo(() => picked.filter(entry => entry.writable), [picked]);
  const selectedProjects = useMemo(() => projectSelection.map(entry => entry.alias), [projectSelection]);
  const membership = new Set(projectSelection.map(entry => entry.bundleId ?? ''));
  const active = picked.length === 1 ? picked[0] : undefined;
  const activeFolder = item?.type === 'folder' ? folders.get(item.id) : undefined;
  const itemName = active?.name ?? activeFolder?.name;
  const canEditItem = editable && Boolean(active?.writable || (activeFolder?.writable && activeFolder.id !== projectRoot));
  const visibleFolders = search || filter === 'generated' ? [] : ordered.filter(node => node.parentId === currentFolder);
  const isPlaying = (alias: string) => (audio.state === 'loading' || audio.state === 'playing') && audio.alias === alias;
  const toggleAudio = (alias: string) => isPlaying(alias) ? stop() : play(alias);
  const total = t('assetCount', { count: new Intl.NumberFormat(locale).format(entries.length) });

  useEffect(() => onBundleSelectionChange(selectedProjects), [onBundleSelectionChange, selectedProjects]);

  useImperativeHandle(ref, () => ({
    reveal(alias, openContainingFolder) {
      const entry = entries.find(item => item.alias === alias);
      if (!entry) return;
      if (openContainingFolder || !visible.includes(entry)) {
        showFolder(entry.folderId);
        setFilter('all');
      }
      selectionAnchor.current = alias;
      selectAssets([alias]);
      setRevealAlias(alias);
    },
  }));

  useLayoutEffect(() => {
    if (!revealAlias) return;
    revealButton.current?.focus({ preventScroll: true });
    revealButton.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setRevealAlias(undefined);
  }, [revealAlias]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent | globalThis.PointerEvent) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) setMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(undefined); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);

  useEffect(() => {
    const node = dialog.current;
    if (form && node && !node.open) node.showModal();
  }, [form]);

  function clearSelection() {
    setAssignedBundle(undefined);
    setItem(undefined);
    setSelectedAliases([]);
    selectionAnchor.current = undefined;
    inspect([]);
  }

  function selectAssets(aliases: string[]) {
    inspect(aliases);
    setAssignedBundle(undefined);
    setSelectedAliases(aliases);
    setItem(aliases.length === 1 ? { type: 'asset', id: aliases[0] } : undefined);
    setMessage(undefined);
  }

  function pickAsset(alias: string, event: Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>, toggle = false) {
    const from = visible.findIndex(asset => asset.alias === selectionAnchor.current);
    const to = visible.findIndex(asset => asset.alias === alias);
    if (event.shiftKey && from >= 0 && to >= 0) {
      const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1).map(asset => asset.alias);
      selectAssets(event.metaKey || event.ctrlKey ? [...new Set([...selectedAliases, ...range])] : range);
      return;
    }
    selectionAnchor.current = alias;
    if (selectMode || toggle || event.metaKey || event.ctrlKey) {
      selectAssets(selection.has(alias) ? selectedAliases.filter(item => item !== alias) : [...selectedAliases, alias]);
    } else selectAssets([alias]);
  }

  function showFolder(id: string) {
    setFolder(id);
    setQuery('');
    setMessage(undefined);
    setExpanded(previous => new Set([...previous, ...pathTo(id).map(node => node.id)]));
  }

  function openFolder(id: string) {
    showFolder(id);
    clearSelection();
  }

  function change(action: LibraryAction) {
    try {
      mutate(action);
      setMessage(undefined);
      return true;
    } catch (failure) {
      const key = (failure as Error).message;
      setMessage(key === 'assetNameConflict' ? t('assetNameConflict') : key === 'assetMoveCycle' ? t('assetMoveCycle') :
        key === 'assetFolderNotEmpty' ? t('assetFolderNotEmpty') : t('assetNameInvalid'));
      return false;
    }
  }

  async function remove() {
    if (!item || !itemName || !canEditItem) return;
    const users = active ? assetUsers(referencedObjects, active.alias) : [];
    setMenu(undefined);
    if (users.length) {
      setMessage(t('assetInUse', { objects: users.join(', ') }));
      return;
    }
    if (activeFolder && (ordered.some(node => node.parentId === activeFolder.id) ||
      entries.some(entry => entry.folderId === activeFolder.id))) {
      setMessage(t('assetFolderNotEmpty'));
      return;
    }
    const message = t('confirmDeleteAsset', { name: itemName });
    if (await (window.oliveHost?.confirm(message) ?? window.confirm(message)) && change({ type: 'delete', item })) clearSelection();
  }

  function openMenu(event: { clientX: number; clientY: number; currentTarget: HTMLElement }, target?: LibraryItem) {
    if (target?.type === 'folder') { clearSelection(); setItem(target); }
    if (target?.type === 'asset' && !selection.has(target.id)) selectAssets([target.id]);
    const rect = event.currentTarget.getBoundingClientRect();
    setBundleMenu(false);
    setMenu({
      x: Math.max(4, Math.min(event.clientX || rect.left, window.innerWidth - 176)),
      y: Math.max(4, Math.min(event.clientY || rect.bottom, window.innerHeight - 175)),
    });
  }

  function sendToBundle(id: string | null, name: string) {
    mutate({ type: 'bundle', operation: { type: 'assign', aliases: selectedProjects, id } });
    setAssignedBundle({ id: id ?? '', name });
    setMenu(undefined);
  }

  function folderOver(event: DragEvent, target: FolderNode) {
    if (!target.writable || !editable) return;
    const types = event.dataTransfer.types;
    if (!types.includes(folderDragType) && !types.includes(assetDragType) && !types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'move';
    setDropTarget(target.id);
  }

  function folderDrop(event: DragEvent, target: FolderNode) {
    const data = event.dataTransfer;
    if (!target.writable || !editable) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(undefined);
    setFileDrop(false);
    if (data.files.length) {
      importFiles?.(projectParent(target.id), [...data.files]);
      openFolder(target.id);
      return;
    }
    const folderId = data.getData(folderDragType);
    const alias = data.getData(assetDragType);
    if (folderId || alias) change({
      type: 'move', item: folderId ? { type: 'folder', id: folderId } : { type: 'asset', id: alias },
      parent: projectParent(target.id),
    });
  }

  function folderDrag(event: DragEvent, node: FolderNode) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(folderDragType, node.id);
  }

  function showForm(mode: Mode, parent = writableFolder) {
    if (mode === 'create') setCreateParent(parent);
    setMenu(undefined);
    setMessage(undefined);
    setForm(mode);
  }



  function folderTree(parent: string) {
    return <ul>
      {ordered.filter(node => node.parentId === parent).map(node => {
        const hasChildren = ordered.some(child => child.parentId === node.id);
        const open = expanded.has(node.id);
        const target = { type: 'folder', id: node.id } as const;
        return <li key={node.id}>
          <div className="asset-folder-row" data-drop={dropTarget === node.id} data-current={currentFolder === node.id}
            draggable={node.writable && node.id !== projectRoot && editable} onDragStart={event => folderDrag(event, node)}
            onDragOver={event => folderOver(event, node)} onDrop={event => folderDrop(event, node)}
            onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(undefined); }}
            onContextMenu={event => { event.preventDefault(); openMenu(event, target); }}>
            {hasChildren ? <IconButton icon={open ? ChevronDown : ChevronRight}
              label={t(open ? 'collapseAssetFolder' : 'expandAssetFolder', { name: node.name })}
              aria-expanded={open} onClick={() => setExpanded(previous => {
                const next = new Set(previous);
                if (!next.delete(node.id)) next.add(node.id);
                return next;
              })} /> : <span className="asset-folder-spacer" />}
            <button className="asset-folder-button" aria-current={currentFolder === node.id ? 'location' : undefined}
              onClick={() => openFolder(node.id)}>
              {open ? <FolderOpen size={15} /> : <Folder size={15} />}<span>{node.name}</span>
            </button>
          </div>
          {hasChildren && open && folderTree(node.id)}
        </li>;
      })}
    </ul>;
  }

  const displayName = active && form === 'rename' ? active.name.slice(0, active.name.length - extension(active.name).length) : itemName;
  return <section className="panel asset-panel" aria-label={t('assets')} data-file-drop={fileDrop}
    onDragOver={event => {
      if (!importFiles || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = editable ? 'copy' : 'none';
      setFileDrop(editable);
    }}
    onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFileDrop(false); }}
    onDragEnd={() => { setDropTarget(undefined); setFileDrop(false); }}
    onDrop={event => {
      setDropTarget(undefined);
      setFileDrop(false);
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      if (editable && event.dataTransfer.files.length) {
        importFiles?.(projectParent(writableFolder), [...event.dataTransfer.files]);
        if (currentFolder !== allAssets) openFolder(writableFolder);
      }
    }}
    onKeyDown={event => {
      if (event.target instanceof Element && event.target.closest('dialog')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        findInput.current?.focus();
      }
      if (event.target instanceof Element && event.target.closest('input, select, textarea')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && visible.length) {
        event.preventDefault();
        selectAssets(visible.map(asset => asset.alias));
      }
      if (event.key === 'Escape' && !menu && picked.length) clearSelection();
    }}>
    <PanelHeader icon={PackageOpen} label={t('assets')} description={t('assetsHint')}>
      <div className="assets-search"><Search size={14} aria-hidden="true" />
        <input type="search" ref={findInput} aria-label={t('assetSearch')} placeholder={t('assetSearch')}
          {...hint(t('assetSearch'), t('assetSearchHint'))}
          value={query} onChange={event => { clearSelection(); setQuery(event.target.value); }} />
      </div>
      <select className="assets-filter" aria-label={t('assetTypeFilter')} value={filter}
        onChange={event => { clearSelection(); setFilter(event.target.value as typeof filter); }}>
        <option value="all">{t('allAssetTypes')}</option><option value="generated">{t('generatedAssets')}</option><option value="image">{t('imageAssets')}</option>
        <option value="audio">{t('audioAssets')}</option><option value="animated">{t('animatedAssets')}</option>
      </select>
      <span className="panel-aside" role="status">{importing ? t('importingAssets') : packing ? t('packing') : loaded ? total : t('packUnavailable')}</span>
      {(['grid', 'list'] as const).map(mode => <IconButton key={mode} icon={mode === 'grid' ? LayoutGrid : List}
        label={t(mode === 'grid' ? 'gridAssets' : 'listAssets')} aria-pressed={mode === layout}
        onClick={() => { setLayout(mode); localStorage.setItem('olive.assets.layout', mode); }} />)}
      {rebuild && <IconButton icon={RefreshCw} label={t('packReload')} disabled={packing} onClick={rebuild} />}
      {importFiles && <IconButton icon={Import} label={t('importAssets')} description={t('importAssetsHint')} disabled={!editable}
        onClick={() => {
          importFiles(projectParent(writableFolder));
          if (currentFolder !== allAssets) openFolder(writableFolder);
        }} />}
      <IconButton icon={FolderPlus} label={t('newAssetFolder')} disabled={!editable} onClick={() => showForm('create')} />
      <IconButton icon={Bone} label={t('spineCreateEmptyRig')} description={t('spineCreateEmptyRigHint')}
        disabled={!editable} onClick={() => createSpine(projectParent(writableFolder))} />
      <IconButton icon={ListChecks} label={t('selectMultipleAssets')} description={t('selectMultipleHint')}
        aria-pressed={selectMode} onClick={() => setSelectMode(!selectMode)} />
      <button className="bundle-command asset-bundles-button" aria-label={t('assetBundles')}
        aria-description={t('assetBundlesHint')} {...hint(t('assetBundles'), t('assetBundlesHint'))}
        disabled={!editable} aria-pressed={bundlesOpen} onClick={toggleBundles}>
        <Boxes size={15} aria-hidden="true" />{t('bundlesButton')}
      </button>
    </PanelHeader>
    {error && <p className="error inset" role="alert">{error}</p>}
    {audio.state === 'error' && <p className="error inset" role="alert">{audio.alias} · {audio.message}</p>}
    {message && !form && <p className="error inset" role="alert">{message}</p>}
    {picked.length > 1 && <p className="asset-selection-status" role="status">
      {t('assetsSelected', { count: picked.length })}
    </p>}
    {assignedBundle && membership.size === 1 && membership.has(assignedBundle.id) &&
      <p className="asset-selection-status" role="status">{t('bundleSendSuccess', { name: assignedBundle.name })}</p>}

    <div className="assets-workspace">
      <nav className="asset-tree" aria-label={t('assetFolders')}>
        <button className="asset-folder-button asset-tree-root" aria-current={currentFolder === allAssets ? 'location' : undefined}
          onClick={() => openFolder(allAssets)}><PackageOpen size={15} />{t('allAssets')}</button>
        {folderTree(allAssets)}
      </nav>
      <div className="asset-content">
        <nav className="asset-path" aria-label={t('assetDestination')}>
          <button onClick={() => openFolder(allAssets)}>{t('allAssets')}</button>
          {pathTo(currentFolder).map(node => <span key={node.id}><ChevronRight size={12} aria-hidden="true" />
            <button onClick={() => openFolder(node.id)}>{node.name}</button></span>)}
          {selectMode && <div className="asset-selection-tools">
            <button onClick={() => selectAssets(visible.map(asset => asset.alias))} disabled={!visible.length}>{t('selectShownAssets')}</button>
            <button onClick={clearSelection} disabled={!picked.length}>{t('clearAssetSelection')}</button>
          </div>}
        </nav>
        <div className="asset-items" data-layout={layout}>
          {visibleFolders.map(node => {
            const target = { type: 'folder', id: node.id } as const;
            return <article className="asset-card" key={node.id} data-selected={item?.id === node.id} data-drop={dropTarget === node.id}
              draggable={node.writable && node.id !== projectRoot && editable} onDragStart={event => folderDrag(event, node)}
              onDragOver={event => folderOver(event, node)} onDrop={event => folderDrop(event, node)}
              onDragLeave={() => setDropTarget(undefined)}
              onContextMenu={event => { event.preventDefault(); openMenu(event, target); }}>
              <button className="asset-entry" aria-label={t('openAssetFolder', { name: node.name })}
                {...hint(node.name)} onClick={() => { clearSelection(); setItem(target); setMessage(undefined); }}
                onDoubleClick={() => openFolder(node.id)} onKeyDown={event => { if (event.key === 'Enter') openFolder(node.id); }}>
                <span className="asset-icon"><Folder size={24} aria-hidden="true" /></span><span>{node.name}</span>
              </button>
            </article>;
          })}
          {visible.map(asset => {
            const playing = isPlaying(asset.alias);
            const target = { type: 'asset', id: asset.alias } as const;
            const status = playing ? t(audio.state === 'loading' ? 'audioLoading' : 'audioPlaying') : undefined;
            const checked = selection.has(asset.alias);
            return <article key={asset.alias} className="asset-card" data-selected={checked} data-active={playing}
              draggable={editable} onDragStart={event => {
                startValueDrag(event, 'asset', checked ? picked.map(item => item.alias) : [asset.alias], asset.writable ? 'copyMove' : 'copy');
                if (asset.writable) event.dataTransfer.setData(assetDragType, asset.alias);
              }}
              onContextMenu={event => { event.preventDefault(); openMenu(event, target); }}>
              {selectMode && <input type="checkbox" className="asset-select-check" aria-label={t('selectAssetName', { name: asset.name })}
                checked={checked} onChange={() => pickAsset(asset.alias, { metaKey: false, ctrlKey: false, shiftKey: false }, true)} />}
              <button className="asset-entry" ref={asset.alias === revealAlias ? revealButton : undefined}
                aria-pressed={checked} {...hint(asset.name, pathTo(asset.folderId).map(node => node.name).join(' / '))}
                onClick={event => pickAsset(asset.alias, event)}>
                <span className="asset-icon">{asset.kind === 'image' ? <img alt="" loading="lazy" draggable={false} src={asset.url} /> :
                  asset.kind === 'audio' ? <AudioLines size={23} aria-hidden="true" /> : <Film size={23} aria-hidden="true" />}</span><span>{asset.name}</span>
              </button>
              {status && <span className="sr-only" role="status">{status}</span>}
              {asset.kind === 'image' ?
                <IconButton icon={Link2} label={t('assignTexture', { alias: asset.alias })} disabled={!canAssign} onClick={() => assign(asset.alias)} /> : asset.kind === 'audio' ?
                <IconButton icon={playing ? Square : Play} label={t(playing ? 'stopAudio' : 'playAudio', { alias: asset.alias })}
                  onClick={() => toggleAudio(asset.alias)} /> : null}
            </article>;
          })}
          {!visible.length && !visibleFolders.length && <p className="empty">{search || filter !== 'all' ? t('noAssetMatches') : t('emptyAssetFolder')}</p>}
        </div>
      </div>

    </div>
    {menu && <div className="asset-context" ref={menuRef}
      style={{ left: menu.x, top: bundleMenu ? Math.max(4, Math.min(menu.y, window.innerHeight - 300)) : menu.y }}>
      {!!selectedProjects.length && <button disabled={!editable} aria-expanded={bundleMenu}
        onClick={() => setBundleMenu(!bundleMenu)}>
        <span>{t('assignToBundle')}</span>{bundleMenu ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>}
      {bundleMenu && <div className="asset-bundle-destinations" role="group" aria-label={t('bundleDestinations')}>
        <button disabled={!editable} onClick={() => sendToBundle(null, t('bundleDefault'))}>{t('bundleDefault')}</button>
        {(scene.assetLibrary.bundles ?? []).map(bundle => <button key={bundle.id} disabled={!editable}
          onClick={() => sendToBundle(bundle.id, bundle.name)}>{bundle.name}</button>)}
        <button disabled={!editable} onClick={() => { setMenu(undefined); createBundle(); }}>{t('newBundleDestination')}</button>
      </div>}
      <button disabled={!editable} onClick={() => showForm('create', activeFolder?.writable ? activeFolder.id : writableFolder)}>{t('newAssetFolder')}</button>
      <button disabled={!canEditItem} onClick={() => showForm('rename')}>{t('renameAsset')}</button>
      <button disabled={!canEditItem} onClick={() => showForm('move')}>{t('moveAsset')}</button>
      <button disabled={!canEditItem} onClick={remove}>{t('deleteAsset')}</button>
    </div>}
    {form && <dialog className="asset-dialog" ref={dialog} aria-label={t(form === 'create' ? 'newAssetFolder' : form === 'rename' ? 'renameAsset' : 'moveAsset')}
      onClose={() => setForm(undefined)} onCancel={() => setForm(undefined)}>
      <form onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        if (form === 'move') {
          if (item && change({ type: 'move', item, parent: projectParent(String(data.get('parent'))) })) setForm(undefined);
          return;
        }
        const input = String(data.get('name')).trim();
        const suffix = form === 'rename' && active ? extension(active.name) : '';
        const name = suffix && !input.toLowerCase().endsWith(suffix.toLowerCase()) ? input + suffix : input;
        if (!libraryName.safeParse(name).success || !input) {
          setMessage(t('assetNameInvalid'));
          return;
        }
        if (form === 'create') {
          if (change({ type: 'create', id: crypto.randomUUID(), name, parent: projectParent(createParent) })) {
            openFolder(createParent);
            setForm(undefined);
          }
        } else if (item && change({ type: 'rename', item, name })) setForm(undefined);
      }}>
        <label>{t(form === 'move' ? 'assetDestination' : active && form === 'rename' ? 'assetName' : 'folderName')}
          {form === 'move' ? <select name="parent" defaultValue={active?.folderId ?? activeFolder?.parentId ?? projectRoot}>
            {ordered.filter(node => node.writable && node.id !== item?.id)
              .map(node => <option key={node.id} value={node.id}>{pathTo(node.id).map(part => part.name).join(' / ')}</option>)}
          </select> : <span className="asset-name-input">
            <input name="name" defaultValue={form === 'rename' ? displayName : ''} required autoFocus />
            {form === 'rename' && active && <span aria-hidden="true">{extension(active.name)}</span>}
          </span>}
        </label>
        {message && <p className="error">{message}</p>}
        <div className="asset-dialog-actions">
          <IconButton icon={X} label={t('cancel')} onClick={() => { setForm(undefined); setMessage(undefined); }} />
          <button type="submit">{t('libraryApply')}</button>
        </div>
      </form>
    </dialog>}
  </section>;
}
