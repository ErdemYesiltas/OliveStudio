import { useEffect, useMemo, useRef, useState } from 'react';
import { Bone, Braces, Eye, Plus, Redo2, Save, Trash2, Undo2, X } from 'lucide-react';
import { parseSpineDocument, removeSpineBoneBranch, renameSpineBone, reparentSpineBone, replaceSpineSection, spineBoneParents, spineDocumentSchema, spineRelativePath, spineSections,
  type SpineBone, type SpineDocument, type SpineSection } from '@olivestudio/engine/spine-format';
import { AnimatedAssetPreview } from './AnimatedAssetPreview';
import { loadAnimation } from './animationAssets';
import { SpineInheritanceSelect, SpineMotionFields } from './SpineMotionFields';
import { SpineAttachmentFields } from './SpineAttachmentFields';
import { SpineConstraintFields } from './SpineConstraintFields';
import { SpineDeformFields, type SpineDeformSelection } from './SpineDeformFields';
import { SpineTimelineFields } from './SpineTimelineFields';
import { SpineSetupCanvas } from './SpineSetupCanvas';
import { SpineDopesheet } from './SpineDopesheet';
import { spineRebasePoint, spineSetupSkeleton } from './spinePose';
import { addSpineAtlasImage, removeSpineAtlasPage, replaceSpineAtlasImage, spineAssetBase64, spineAtlasInfo, spineEventAudioChanges,
  type SpineReferenceChange, type SpineReferenceChanges } from './spineAssets';
import { assetMime, type Asset, type EmbeddedMedia } from './assets';
import { IconButton } from './chrome';
import { t } from './i18n';
import { validationMessage } from './scene';

const listSections: readonly SpineSection[] = ['bones', 'slots', 'skins', 'ik', 'transform', 'path', 'physics'];
const rawSections = [...spineSections, 'source'] as const;
const sections = ['setup', 'attachments', 'constraints', 'motion', 'deform', 'tracks', 'dopesheet', ...rawSections] as const;
type Section = typeof sections[number];
const isRaw = (section: Section): section is typeof rawSections[number] => (rawSections as readonly Section[]).includes(section);
const transforms = ['x', 'y', 'rotation', 'length', 'scaleX', 'scaleY', 'shearX', 'shearY'] as const;
const format = (value: unknown) => JSON.stringify(value, null, 2);
const message = (section: Section) => t(`spineSection_${section}`);
type Draft = { document: SpineDocument; renames: SpineReferenceChanges; audio?: EmbeddedMedia['audio']; files?: EmbeddedMedia['files'] };
type DraftHistory = { past: Draft[]; present?: Draft; future: Draft[] };

export function SpineStudio({ asset, libraryAssets, save, close, initialClip }: {
  asset: Asset; libraryAssets: readonly Asset[];
  save: (data: string, original: Asset, renames: SpineReferenceChanges, media: EmbeddedMedia) => void;
  close: () => void;
  initialClip?: { animation: string | null; skin: string | null };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [history, setHistory] = useState<DraftHistory>({ past: [], future: [] });
  const document = history.present?.document;
  const [section, setSection] = useState<Section>(initialClip ? 'dopesheet' : 'setup');
  const [boneName, setBone] = useState('');
  const [newName, setNewName] = useState('');
  const [drawingBone, setDrawingBone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ asset: Asset; revision: number; animation?: string; skin?: string; time?: number }>({ asset, revision: 0 });
  const [setupPreview, setSetupPreview] = useState<Asset>(asset);
  const [deform, setDeform] = useState<SpineDeformSelection>();
  const [attachmentSkin, setAttachmentSkin] = useState<string>();
  const [original, setOriginal] = useState<SpineDocument>();
  const originalText = useMemo(() => original && format(original), [original]);
  const [text, setText] = useState('');
  const [textDirty, setTextDirty] = useState(false);
  const [clipName, setClipName] = useState(initialClip?.animation ?? '');
  const [dopesheetTime, setDopesheetTime] = useState(0);
  const files = history.present?.files;
  const atlas = useMemo(() => spineAtlasInfo(files), [files]);
  const selected = document?.bones.find(item => item.name === boneName) ?? document?.bones[0];
  const animation = document?.animations && (Object.hasOwn(document.animations, clipName) ? clipName : Object.keys(document.animations)[0]);
  const editingClip = section === 'motion' || section === 'deform' || section === 'tracks' || section === 'dopesheet';

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const request = new AbortController();
    void fetch(asset.url, { signal: request.signal }).then(response => response.text()).then(json => {
      const parsed = parseSpineDocument(json);
      if (request.signal.aborted) return;
      spineAtlasInfo(asset.media?.files);
      setOriginal(parsed);
      setHistory({ past: [], present: { document: parsed, renames: { skins: [], animations: [] },
        audio: asset.media?.audio, files: asset.media?.files }, future: [] });
    }).catch(failure => { if (!request.signal.aborted) setError(validationMessage(failure)); });
    return () => request.abort();
  }, [asset.url, asset.media]);

  useEffect(() => {
    if (!document || !asset.media || !files || section !== 'setup') return;
    const media = { ...asset.media, files };
    const timer = setTimeout(() => {
      try {
        const text = format(document);
        setSetupPreview(text === originalText && files === asset.media?.files ? asset : {
          ...asset, media, url: `data:application/json;base64,${spineAssetBase64(new TextEncoder().encode(text))}`,
        });
      } catch (error) { setError(validationMessage(error)); }
    }, 120);
    return () => clearTimeout(timer);
  }, [asset, document, files, originalText, section]);

  function setDocument(document: SpineDocument, change?: SpineReferenceChange, media?: Pick<Draft, 'audio' | 'files'>) {
    setHistory(current => {
      const { present } = current;
      if (!present || (present.document === document && !media)) return current;
      const renames = change?.kind === 'skin' ?
        { ...present.renames, skins: [...present.renames.skins, { from: change.from, to: change.to }] } :
        change?.kind === 'animation' ?
          { ...present.renames, animations: [...present.renames.animations, { from: change.from, to: change.to }] } :
          change?.kind === 'event' ? { ...present.renames, events: [...present.renames.events ?? [], { from: change.from, to: change.to }] } :
            present.renames;
      const audio = media?.audio ?? (present.document.events === document.events ? present.audio :
        usedEventAudio(document, present.audio, spineEventAudioChanges(present.document.events, document.events)));
      return { past: [...current.past.slice(-99), present],
        present: { document, renames, audio, files: media?.files ?? present.files }, future: [] };
    });
  }

  function moveHistory(direction: 'undo' | 'redo') {
    if (busy || (textDirty && (direction === 'redo' || !applyText()))) return;
    setHistory(current => {
      if (!current.present) return current;
      if (direction === 'undo') {
        const present = current.past.at(-1);
        return present ? { past: current.past.slice(0, -1), present, future: [current.present, ...current.future] } : current;
      }
      const [present, ...future] = current.future;
      return present ? { past: [...current.past, current.present], present, future } : current;
    });
    setError('');
  }

  function selectSection(next: Section) {
    if (!document || next === section) return;
    if (textDirty && !applyText()) return;
    setSection(next);
    setTextDirty(false);
    setError('');
  }

  function rawValue(value: SpineDocument) {
    return section === 'source' ? value : !isRaw(section) ? {} :
      (value[section] ?? (listSections.includes(section) ? [] : {}));
  }

  function applyText(): SpineDocument | undefined {
    if (!document) return;
    if (!textDirty || !isRaw(section)) return document;
    try {
      const next = section === 'source' ? parseSpineDocument(text) : replaceSpineSection(document, section, JSON.parse(text));
      setDocument(next);
      setTextDirty(false);
      setError('');
      return next;
    } catch (error) {
      setError(validationMessage(error));
    }
  }

  function patchBones(bones: SpineBone[]) {
    if (!document) return;
    try {
      setDocument(spineDocumentSchema.parse({ ...document, bones }));
      setError('');
      return true;
    } catch (error) {
      setError(validationMessage(error));
      return false;
    }
  }

  async function apply(keep: boolean) {
    if (busy) return;
    const next = applyText();
    if (!next) return;
    setBusy(true);
    setError('');
    try {
      const data = spineAssetBase64(new TextEncoder().encode(format(next)));
      if (!asset.media || !history.present || !files) throw new Error(t('unsupportedAnimationAsset'));
      const audio = usedEventAudio(next, history.present.audio, spineEventAudioChanges(history.present.document.events, next.events));
      const media = { ...asset.media, files, audio: audio.length ? audio : undefined };
      const candidate = { ...asset, media, url: `data:application/json;base64,${data}` };
      const source = await loadAnimation(candidate);
      source.dispose();
      if (keep) {
        save(data, asset, { ...history.present.renames, eventAudio: spineEventAudioChanges(original?.events, next.events) }, media);
        close();
      }
      else if (section === 'setup') setSetupPreview(candidate);
      else setPreview(previous => ({ asset: candidate, revision: previous.revision + 1,
        animation: editingClip ? animation : undefined,
        skin: section === 'deform' ? deform?.skin : section === 'attachments' ? attachmentSkin : undefined,
        time: section === 'deform' ? deform?.time : section === 'dopesheet' ? dopesheetTime : undefined }));
    } catch (failure) {
      setError(validationMessage(failure));
    } finally { setBusy(false); }
  }

  async function linkEventAudio(name: string, sound: Asset) {
    if (busy || !document || !document.events?.[name] || !assetMime(sound.path)?.startsWith('audio/')) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(sound.url);
      if (!response.ok) throw new Error(t('previewUnavailable'));
      const blob = await response.blob();
      if (!blob.size || blob.size > 24 * 1024 * 1024) throw new Error(t('assetLimit'));
      const parts = sound.path.split('/').at(-1)!.split('.');
      const extension = parts.pop()!;
      const stem = parts.join('.').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || 'sound';
      const path = `events/${crypto.randomUUID()}/${stem}.${extension.toLowerCase()}`;
      const next = replaceSpineSection(document, 'events', {
        ...document.events, [name]: { ...document.events[name], audio: path },
      });
      const audio = usedEventAudio(next, history.present?.audio);
      if (audio.length >= 128) throw new Error(t('assetLimit'));
      setDocument(next, undefined, { audio: [...audio, { path, data: spineAssetBase64(new Uint8Array(await blob.arrayBuffer())) }] });
    } catch (error) { setError(validationMessage(error)); }
    finally { setBusy(false); }
  }

  async function addTexture(image: Asset) {
    if (busy || !document || !files) return;
    setBusy(true);
    setError('');
    try {
      const next = await addSpineAtlasImage(files, image);
      setDocument(document, undefined, { files: next.files });
      return next.region;
    } catch (error) { setError(validationMessage(error)); }
    finally { setBusy(false); }
  }

  function removeTexture(page: string) {
    if (busy || !document || !files) return;
    setError('');
    try { setDocument(document, undefined, { files: removeSpineAtlasPage(document, files, page) }); }
    catch (error) { setError(validationMessage(error)); }
  }

  async function replaceTexture(page: string, image: Asset, premultiplied: boolean) {
    if (busy || !document || !files) return;
    setBusy(true);
    setError('');
    try {
      const next = await replaceSpineAtlasImage(files, page, image, premultiplied);
      if (next !== files) setDocument(document, undefined, { files: next });
    } catch (error) { setError(validationMessage(error)); }
    finally { setBusy(false); }
  }

  const dirty = textDirty || (!!document && format(document) !== originalText) || (!!files && files !== asset.media?.files);
  function cancel() {
    if (!busy && (!dirty || window.confirm(t('spineDiscardDraft')))) close();
  }

  return <dialog ref={dialog} className="spine-studio" aria-label={t('spineStudio')}
    onKeyDown={event => {
      const key = event.key.toLowerCase();
      if (!(event.metaKey || event.ctrlKey) || event.altKey || !['z', 'y'].includes(key)) return;
      event.stopPropagation();
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      moveHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    }}
    onCancel={event => { event.preventDefault(); cancel(); }}>
    <header className="spine-studio-header">
      <Bone size={18} aria-hidden="true" /><strong>{asset.name ?? asset.path}</strong>
      <span className="spine-studio-version">{document?.skeleton.spine}</span>
      <IconButton icon={Undo2} label={t('spineUndoDraft')} disabled={busy || (!history.past.length && !textDirty)}
        aria-keyshortcuts="Meta+Z Control+Z" onClick={() => moveHistory('undo')} />
      <IconButton icon={Redo2} label={t('spineRedoDraft')} disabled={busy || textDirty || !history.future.length}
        aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y" onClick={() => moveHistory('redo')} />
      <IconButton icon={X} label={t('spineCloseStudio')} disabled={busy} onClick={cancel} />
    </header>
    <div className="spine-studio-grid" data-dopesheet={section === 'dopesheet' || undefined}>
      <nav aria-label={t('spineDocumentSections')}>
        {sections.map(id => <button key={id} className="bundle-command" type="button" aria-pressed={section === id}
          disabled={!document || busy} onClick={() => selectSection(id)}>{message(id)}</button>)}
      </nav>
      <section className="spine-studio-preview" aria-label={t('assetAnimationPreview')}>
        {section === 'setup' ? <AnimatedAssetPreview key="setup" asset={setupPreview} scrub setupPose /> :
          <AnimatedAssetPreview key={preview.revision} asset={preview.asset} scrub
            preferredAnimation={editingClip ? animation : preview.animation} preferredSkin={preview.skin ?? initialClip?.skin ?? undefined}
            preferredTime={section === 'dopesheet' ? dopesheetTime : preview.time} />}
      </section>
      <section className="spine-studio-fields" aria-label={message(section)}>
        {document && (section === 'setup' && selected ? <>
          <IconButton icon={Plus} label={t('spineDrawBone')} description={t('spineDrawBoneHint')}
            disabled={busy} aria-pressed={drawingBone} onClick={() => setDrawingBone(value => !value)} />
          <SpineSetupCanvas bones={document.bones} selected={selected.name} disabled={busy} select={setBone} report={setError}
            draw={drawingBone ? bone => {
              const names = new Set(document.bones.map(item => item.name));
              let name = 'bone';
              for (let suffix = 2; names.has(name); suffix++) name = `bone-${suffix}`;
              if (patchBones([...document.bones, { ...bone, name }])) {
                setBone(name);
                setDrawingBone(false);
              }
            } : undefined}
            move={(name, position) => patchBones(document.bones.map(bone => bone.name === name ? { ...bone, ...position } : bone))} />
          <label>{t('rigBone')}
            <select value={selected.name} disabled={busy} onChange={event => setBone(event.currentTarget.value)}>
              {document.bones.map(bone => <option key={bone.name}>{bone.name}</option>)}
            </select>
          </label>
          <label>{t('spineRenameBone')}
            <input key={selected.name} defaultValue={selected.name} maxLength={120} disabled={busy}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
              onBlur={event => {
                const name = event.currentTarget.value.trim();
                if (name === selected.name) { event.currentTarget.value = name; return; }
                try { setDocument(renameSpineBone(document, selected.name, name)); setBone(name); setError(''); }
                catch (error) { event.currentTarget.value = selected.name; setError(validationMessage(error)); }
              }} />
          </label>
          {selected.parent && <label>{t('spineBoneParent')}
            <select value={selected.parent} disabled={busy} onChange={event => {
              const parent = event.currentTarget.value;
              try { setDocument(reparentSpineBone(document, selected.name, parent)); setError(''); }
              catch (error) { setError(validationMessage(error)); }
            }}>
              {spineBoneParents(document.bones, selected.name).map(bone => <option key={bone.name}>{bone.name}</option>)}
            </select>
          </label>}
          {selected.parent && <SpineInheritanceSelect value={selected.inherit} disabled={busy}
            change={inherit => patchBones(document.bones.map(bone => bone === selected ? { ...bone, inherit } : bone))} />}
          {selected.parent && <IconButton icon={Trash2} label={t('spineRemoveBoneBranch')} description={t('spineRemoveBoneBranchHint')}
            disabled={busy} onClick={() => {
              try {
                let skeleton: ReturnType<typeof spineSetupSkeleton> | undefined;
                const next = removeSpineBoneBranch(document, selected.name, (from, to, point, delta) => {
                  skeleton ??= spineSetupSkeleton(document.bones);
                  return spineRebasePoint(skeleton, from, to, point, delta);
                });
                setDocument(next);
                setBone(selected.parent!);
                setError('');
              } catch (error) { setError(validationMessage(error)); }
            }} />}
          {transforms.map(key => {
            const value = selected[key] ?? (key.startsWith('scale') ? 1 : 0);
            return <label key={key}>{t(`spineBone_${key}`)}
              <input key={`${selected.name}:${value}`} type="number" step="any" defaultValue={value}
                min={key === 'length' ? 0 : undefined} disabled={busy} onBlur={event => {
                  const number = event.currentTarget.valueAsNumber;
                  if (!Number.isFinite(number) || !event.currentTarget.checkValidity()) { event.currentTarget.value = String(value); return; }
                  if (number !== value) patchBones(document.bones.map(bone => bone === selected ? { ...bone, [key]: number } : bone));
                }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
            </label>;
          })}
          <form className="spine-studio-add" onSubmit={event => {
            event.preventDefault();
            const name = newName.trim();
            if (name && patchBones([...document.bones, { name, parent: selected.name, length: 32 }])) {
              setBone(name);
              setNewName('');
            }
          }}>
            <input aria-label={t('name')} placeholder={t('name')} disabled={busy} value={newName}
              onChange={event => setNewName(event.currentTarget.value)} />
            <IconButton icon={Plus} type="submit" label={t('rigAddBone')} disabled={busy || !newName.trim()} />
          </form>
        </> : section === 'attachments' ? <SpineAttachmentFields document={document} atlas={atlas} disabled={busy}
          change={setDocument} report={setError} onSkinSelection={setAttachmentSkin}
          imageAssets={libraryAssets.filter(item => item.kind === 'image')} addTexture={addTexture} removeTexture={removeTexture}
          replaceTexture={(page, image, premultiplied) => void replaceTexture(page, image, premultiplied)} />
          : section === 'constraints' ? <SpineConstraintFields document={document}
          disabled={busy} change={setDocument} report={setError} /> : section === 'deform' ? <SpineDeformFields document={document}
          animation={animation ?? ''} selectAnimation={setClipName} change={setDocument} report={setError} disabled={busy} onSelection={setDeform} />
          : section === 'tracks' ? <SpineTimelineFields document={document} animation={animation ?? ''} disabled={busy}
            selectAnimation={setClipName} change={setDocument} report={setError}
            audioAssets={libraryAssets.filter(item => item.kind === 'audio')} eventAudio={history.present?.audio}
            linkEventAudio={(name, sound) => void linkEventAudio(name, sound)} />
          : section === 'dopesheet' ? <SpineDopesheet document={document} animation={animation ?? ''} disabled={busy}
            selectAnimation={setClipName} change={setDocument} report={setError} seek={setDopesheetTime} cursor={dopesheetTime} />
          : section === 'motion' && selected ? <SpineMotionFields document={document} animation={animation ?? ''}
          bone={selected.name} disabled={busy} selectBone={setBone} selectAnimation={setClipName} change={setDocument} report={setError} /> : <>
          <label htmlFor="spine-studio-json">{message(section)}</label>
          <textarea id="spine-studio-json" spellCheck={false} disabled={busy}
            value={textDirty ? text : format(rawValue(document))}
            onChange={event => { setText(event.currentTarget.value); setTextDirty(true); }} />
          <button type="button" className="bundle-command" disabled={busy || !textDirty} onClick={() => applyText()}>
            <Braces size={15} aria-hidden="true" />{t('spineStageJson')}
          </button>
        </>)}
        {error && <pre className="spine-studio-error error" role="alert">{error}</pre>}
      </section>
    </div>
    <footer className="spine-studio-actions">
      <button type="button" className="bundle-command" disabled={!document || busy} onClick={() => void apply(false)}>
        <Eye size={16} aria-hidden="true" />{t('spinePreviewDraft')}
      </button>
      <button type="button" className="bundle-command" disabled={!document || !dirty || busy} onClick={() => void apply(true)}>
        <Save size={16} aria-hidden="true" />{t('spineSaveDraft')}
      </button>
    </footer>
  </dialog>;
}

function usedEventAudio(document: SpineDocument, audio: EmbeddedMedia['audio'], changes?: SpineReferenceChanges['eventAudio']) {
  const paths = new Set(Object.values(document.events ?? {}).map(event => spineRelativePath(event.audio)));
  const files = new Map(audio?.map(file => [file.path, file]));
  for (const { from, to } of changes ?? []) {
    const fromPath = spineRelativePath(from);
    const toPath = spineRelativePath(to);
    const source = fromPath ? files.get(fromPath) : undefined;
    if (source && toPath && !files.has(toPath) && assetMime(source.path) === assetMime(toPath)) {
      files.set(toPath, { ...source, path: toPath });
    }
  }
  return [...files.values()].filter(file => paths.has(file.path));
}
