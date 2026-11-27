import { Clapperboard, Code2, Copy, ListTree, Play, Plus, Square, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { IconButton } from './chrome';
import { compileExpression, type DirectorStep } from '@olivestudio/engine/aperion-director';
import { directorSourceLimit, directorTemplates, parseDirectorSource, type DirectorDefinition } from './directorModel';
import { DirectorSteps } from './DirectorSteps';
import type { CueTargets } from './CinematicFields';
import { t } from './i18n';
import { validationMessage } from './scene';

type JsonDraft = { base: string; text: string };

export type DirectorPreview = { name: string; status: 'running' | 'completed' | 'stopped' | 'failed'; error?: string };

export function DirectorFields({ items, editable, targets, change, preview, stop, playback, cue, cueHint }: {
  items: readonly DirectorDefinition[];
  editable: boolean;
  targets: CueTargets;
  change: (items: DirectorDefinition[]) => void;
  preview: (name: string) => void;
  stop: () => void;
  playback?: DirectorPreview;
  cue?: (name: string) => void;
  cueHint: string;
}) {
  const [drafts, setDrafts] = useState<Record<string, JsonDraft>>({});
  const [selected, select] = useState<string>();
  const item = items.find(item => item.id === selected) ?? items[0];
  const nameTaken = (name: string) => items.some(item => item.name === name);
  function add(copy?: DirectorDefinition) {
    let index = copy ? 1 : items.length + 1;
    const title = () => copy ? t('directorCopyName', { name: copy.name.slice(0, 100), index }) : t('directorName', { index });
    while (nameTaken(title())) index++;
    const next: DirectorDefinition = {
      source: '{ "type": "sequence", "children": [] }', ...copy, id: crypto.randomUUID(), name: title(),
      event: '', whenExpr: '',
    };
    select(next.id);
    change([...items, next]);
  }

  return <details className="director-panel">
    <summary>{t('directorCompositions')} <span className="director-count">{items.length}</span></summary>
    <div className="director-workspace">
      <div className="director-library">
        <div className="director-toolbar">
          <button type="button" className="director-command" disabled={!editable || items.length >= 32} onClick={() => add()}>
            <Plus size={15} aria-hidden="true" />{t('directorNew')}
          </button>
        </div>
        {items.length > 0 && <div className="director-compositions" aria-label={t('directorCompositions')}>
          {items.map(composition => <button key={composition.id} type="button" aria-pressed={item?.id === composition.id}
            title={composition.name} onClick={() => select(composition.id)}>
            <span>{composition.name}</span>
            {composition.event && <small title={composition.event}>{composition.event}</small>}
          </button>)}
        </div>}
      </div>
      {item ? <CompositionFields key={item.id} item={item} editable={editable} targets={{ ...targets, compositions: items }}
        draft={drafts[item.id]} setDraft={draft => setDrafts(current => {
          const next = { ...current };
          if (draft) next[item.id] = draft;
          else delete next[item.id];
          return next;
        })}
        nameTaken={name => items.some(other => other.id !== item.id && other.name === name)}
        patch={fields => change(items.map(other => other.id === item.id ? { ...other, ...fields } : other))}
        duplicate={items.length >= 32 ? undefined : () => add(item)}
        remove={() => {
          select(items[items.indexOf(item) + 1]?.id ?? items[items.indexOf(item) - 1]?.id);
          change(items.filter(other => other.id !== item.id));
        }}
        preview={() => preview(item.name)} playback={playback?.name === item.name ? playback : undefined}
        running={playback?.status === 'running'} canStop={!!playback && playback.status !== 'stopped'} stop={stop} cue={cue && (() => cue(item.name))} cueHint={cueHint} /> :
        <p className="director-note">{t('directorEmpty')}</p>}
    </div>
  </details>;
}

function CompositionFields({ item, targets, nameTaken, patch, duplicate, remove, preview, stop, running, canStop, playback, cue, cueHint, editable, draft, setDraft }: {
  item: DirectorDefinition;
  targets: CueTargets;
  editable: boolean;
  draft?: JsonDraft;
  setDraft: (draft?: JsonDraft) => void;
  nameTaken: (name: string) => boolean;
  patch: (fields: Partial<DirectorDefinition>) => void;
  duplicate?: () => void;
  remove: () => void;
  preview: () => void;
  stop: () => void;
  running: boolean;
  canStop: boolean;
  playback?: DirectorPreview;
  cue?: () => void;
  cueHint: string;
}) {
  const eventList = useId();
  const [mode, setMode] = useState<'steps' | 'json'>(draft ? 'json' : 'steps');
  const [issue, setIssue] = useState('');
  const [triggerError, setTriggerError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const parsed = useMemo(() => {
    try { return { document: parseDirectorSource(item.source) }; }
    catch (error) { return { error: validationMessage(error) }; }
  }, [item.source]);
  const sourceText = draft?.base === item.source ? draft.text : item.source;
  const pending = sourceText !== item.source;
  const json = mode === 'json' || !parsed.document;

  function saveSource(source: string) {
    try {
      parseDirectorSource(source);
      setIssue('');
      setDraft(undefined);
      if (source !== item.source) patch({ source });
    } catch (error) { setIssue(validationMessage(error)); }
  }

  function editSteps(root: DirectorStep) {
    if (!parsed.document) return;
    const next = parsed.document.vars === undefined ? root : { ...parsed.document, root };
    saveSource(JSON.stringify(next, null, 2));
  }

  return <section aria-label={item.name}><fieldset disabled={!editable} className="director-composition">
    <header className="director-toolbar">
      <input className="director-name" aria-label={t('name')} key={item.name} defaultValue={item.name} maxLength={128}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        onBlur={event => {
          const input = event.currentTarget;
          const name = input.value.trim();
          if (name && name !== item.name && !nameTaken(name)) patch({ name });
          else input.value = item.name;
        }} />
      <IconButton icon={Play} label={t('directorPreview')}
        disabled={running || pending || !parsed.document || !!triggerError} onClick={preview} />
      <IconButton icon={Square} label={t('directorStop')} disabled={!canStop} onClick={stop} />
      <IconButton icon={Clapperboard} label={t('directorCueAtPlayhead')} description={cueHint} disabled={!cue || pending || !parsed.document}
        onClick={cue} />
      <IconButton icon={Copy} label={t('directorDuplicate')} description={t('directorDuplicateHint')} disabled={!duplicate} onClick={duplicate} />
      <IconButton icon={Trash2} label={t('directorRemove')} aria-expanded={confirmRemove} onClick={() => setConfirmRemove(!confirmRemove)} />
    </header>
    {confirmRemove && <div className="director-confirm">
      <span>{t('directorRemovePrompt')}</span>
      <button type="button" onClick={() => setConfirmRemove(false)}>{t('cancel')}</button>
      <button type="button" onClick={remove}>{t('directorRemove')}</button>
    </div>}
    {playback && <p role={playback.error ? 'alert' : 'status'} className={playback.error ? 'director-error' : 'director-note'}>
      {playback.error ?? t(`directorPreview_${playback.status}`)}
    </p>}
    <details className="director-trigger">
      <summary>{t('directorStart')} <span>{item.event || t('directorManual')}</span></summary>
      <div className="director-trigger-fields">
        <label className="director-field"><span>{t('directorEvent')}</span>
          <input key={item.event} list={eventList} maxLength={128} defaultValue={item.event} placeholder="scene:ready"
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            onBlur={event => {
              const name = event.currentTarget.value.trim();
              if (name !== item.event) patch({ event: name });
            }} />
          <datalist id={eventList}>
            <option value="scene:ready">{t('directorOnSceneReady')}</option>
            <option value="physics.enter">{t('directorOnContact')}</option>
            <option value="physics.exit">{t('directorOnContactEnd')}</option>
            <option value="spine.event">{t('directorOnSpineEvent')}</option>
            <option value="spine.complete">{t('directorOnSpineComplete')}</option>
          </datalist>
        </label>
        <label className="director-field"><span>{t('directorCondition')}</span>
          <input key={item.whenExpr} aria-invalid={!!triggerError} maxLength={1000} defaultValue={item.whenExpr} placeholder="sceneId == &quot;main&quot;"
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            onBlur={event => {
              const whenExpr = event.currentTarget.value.trim();
              try {
                if (whenExpr) compileExpression(whenExpr);
                setTriggerError('');
                if (whenExpr !== item.whenExpr) patch({ whenExpr });
              } catch (error) { setTriggerError(validationMessage(error)); }
            }} />
        </label>
        <p className="director-note">{t('directorTriggerHint')}</p>
        {triggerError && <p role="alert" className="director-error">{triggerError}</p>}
      </div>
    </details>
    <div className="director-mode">
      <button type="button" aria-pressed={!json} disabled={pending || !parsed.document} onClick={() => setMode('steps')}>
        <ListTree size={14} aria-hidden="true" />{t('directorSteps')}
      </button>
      <button type="button" aria-pressed={json} onClick={() => { setMode('json'); setIssue(''); }}>
        <Code2 size={14} aria-hidden="true" />{t('directorAdvanced')}
      </button>
    </div>
    {json ? <>
      <label className="director-source"><span>{t('directorSource')}</span>
        <textarea value={sourceText} spellCheck={false} rows={10} maxLength={directorSourceLimit}
          onChange={event => setDraft({ base: item.source, text: event.currentTarget.value })} />
      </label>
      <label className="director-field"><span>{t('directorInsertTemplate')}</span>
        <select value="" onChange={event => {
          const key = Object.keys(directorTemplates).find(key => key === event.currentTarget.value) as keyof typeof directorTemplates | undefined;
          if (!key) return;
          try {
            const document = parseDirectorSource(sourceText);
            const root = document.root;
            const template = directorTemplates[key];
            const next = root.type === 'sequence' && Array.isArray(root.children) ?
              { ...root, children: [...root.children, template] } : { type: 'sequence', children: [root, template] };
            const text = JSON.stringify(document.vars === undefined ? next : { ...document, root: next }, null, 2);
            if (text.length > directorSourceLimit) throw new Error(t('directorJsonTooLarge'));
            setDraft({ base: item.source, text });
            setIssue('');
          } catch (error) { setIssue(validationMessage(error)); }
        }}>
          <option value="">{t('directorChooseTemplate')}</option>
          {Object.keys(directorTemplates).map(key => <option key={key} value={key}>{key}</option>)}
        </select>
      </label>
      <div className="director-toolbar">
        <button type="button" disabled={!pending} onClick={() => saveSource(sourceText)}>{t('directorApplyJson')}</button>
        {pending && <button type="button" onClick={() => { setDraft(undefined); setIssue(''); }}>{t('directorDiscardJson')}</button>}
      </div>
    </> : parsed.document && <DirectorSteps root={parsed.document.root} targets={targets} name={item.name} change={editSteps} />}
    {(issue || parsed.error) && <p role="alert" className="director-error">{issue || parsed.error}</p>}
  </fieldset></section>;
}
