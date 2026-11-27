import { ArrowLeft, ArrowRight, Clapperboard, Copy, Layers3, Minus, Play, Plus, Square, Star, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { IconButton, PanelHeader } from './chrome';
import { RequiredText } from './Inspector';
import { t } from './i18n';
import { dropOne, valueSource } from './valueDrag';
import { WorldMap } from './WorldMap';
import type { World } from './world';
import { canDeleteScene, sceneLimit, sceneLinkModes, sceneRecord, sceneTransitionKinds, type Project, type SceneLink, type ScenePlayback } from './project';

type Transition = NonNullable<SceneLink['transition']>;
const instant: Transition = { kind: 'instant', ms: 300 };

function TransitionFields({ value, change, disabled, back, linkName }: {
  value: Transition; change: (transition: Transition) => void; disabled: boolean; back?: boolean; linkName?: string;
}) {
  const label = t(back ? 'sceneBackTransition' : 'sceneTransition');
  const durationLabel = t(back ? 'sceneBackTransitionDuration' : 'sceneTransitionDuration');
  return <div className="scenes-transition-fields">
    <label>{label}<select aria-label={linkName ? `${label} · ${linkName}` : label} value={value.kind} disabled={disabled}
      onChange={event => {
        const kind = sceneTransitionKinds.find(kind => kind === event.currentTarget.value);
        if (kind) change({ ...value, kind });
      }}>{sceneTransitionKinds.map(kind => <option value={kind} key={kind}>{t(`sceneTransition_${kind}`)}</option>)}</select></label>
    {value.kind !== 'instant' && <input key={value.ms} type="number" aria-label={linkName ? `${durationLabel} · ${linkName}` : durationLabel}
      title={durationLabel} min={0} max={10000} defaultValue={value.ms} disabled={disabled} onBlur={event => {
        const input = event.currentTarget;
        const ms = Number.isFinite(input.valueAsNumber) ? Math.round(Math.min(10000, Math.max(0, input.valueAsNumber))) : value.ms;
        input.value = String(ms);
        if (ms !== value.ms) change({ ...value, ms });
      }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />}
  </div>;
}

export function ScenesPanel({ project, sceneId, editable, playback, open, add, rename, setStartup, remove, setLinks, preview, navigate, goBack, changeWorld, gameplay, addDirectorCue }: {
  project: Project; sceneId: string; editable: boolean; playback?: ScenePlayback;
  open: (id: string) => void; add: (copy: boolean) => void; rename: (name: string) => void;
  setStartup: () => void; remove: () => void; setLinks: (update: (links: SceneLink[]) => SceneLink[]) => void;
  preview: () => void; navigate: (link: SceneLink) => void; goBack: () => void;
  changeWorld: (world: World) => void;
  gameplay: ReactNode;
  addDirectorCue?: (link: SceneLink) => void;
}) {
  const [mode, setMode] = useState<SceneLink['mode']>('replace');
  const [targetId, setTargetId] = useState('');
  const [transitions, setTransitions] = useState<Partial<Record<SceneLink['mode'], Transition>>>({});
  const [backTransition, setBackTransition] = useState(instant);
  const scene = sceneRecord(project, sceneId);
  const targets = project.scenes.filter(item => item.id !== scene.id);
  const available = targets.filter(item => !scene.links.some(link => link.target === item.id && link.mode === mode));
  const target = available.find(item => item.id === targetId)?.id ?? available[0]?.id ?? '';
  const transition = transitions[mode] ?? instant;
  const addLink = (target: string) => setLinks(links => [...links, {
    target, mode, transition: transition.kind === 'instant' ? undefined : transition,
    backTransition: mode === 'push' && backTransition.kind !== 'instant' ? backTransition : undefined,
  }]);

  return <section className="panel" aria-label={t('scenes')}>
    <PanelHeader icon={Layers3} label={t('scenes')} description={t('scenesHint')}>
      <div className="panel-tools">
        <IconButton icon={playback ? Square : Play} label={t(playback ? 'stopSceneFlow' : 'previewSceneFlow')}
          disabled={!editable && !playback} onClick={preview} />
        <IconButton icon={Plus} label={t('addProjectScene')} disabled={!editable || project.scenes.length >= sceneLimit} onClick={() => add(false)} />
        <IconButton icon={Copy} label={t('duplicateProjectScene')} disabled={!editable || project.scenes.length >= sceneLimit} onClick={() => add(true)} />
        <IconButton icon={Star} label={t('setStartupScene')} disabled={!editable || project.startup === sceneId} onClick={setStartup} />
        <IconButton icon={Trash2} label={t('deleteProjectScene')} description={t('deleteProjectSceneHint')}
          disabled={!editable || !canDeleteScene(project, sceneId)} onClick={remove} />
      </div>
    </PanelHeader>
    <div className="panel-body scenes-body">
      {playback ? <>
        <strong role="status">{t('activePreviewScene', { name: sceneRecord(project, playback.main).name })}</strong>
        {!!playback.stack?.length && <button type="button" className="bundle-command" onClick={goBack}>
          <ArrowLeft size={14} aria-hidden="true" />{t('sceneGoBack', { name: sceneRecord(project, playback.stack.at(-1)!.main).name })}
        </button>}
        {playback.added.length > 0 && <div role="status">
          {t('addedPreviewScenes', { names: playback.added.map(id => sceneRecord(project, id).name).join(', ') })}
        </div>}
        {[playback.main, ...playback.added].flatMap(id => sceneRecord(project, id).links.map(link => {
          const active = playback.added.includes(link.target);
          const disabled = link.mode === 'remove' ? !active : link.target === playback.main || (link.mode === 'add' && active);
          return <button key={JSON.stringify([id, link.mode, link.target])} className="bundle-command" type="button"
            disabled={disabled} onClick={() => navigate(link)}>
            <ArrowRight size={14} aria-hidden="true" />{t('sceneLinkTitle', { mode: t(`sceneLink_${link.mode}`), name: sceneRecord(project, link.target).name })}
          </button>;
        }))}
      </> : <>
        <div className="scenes-list" role="group" aria-label={t('scenes')}>
          {project.scenes.map(record => <button key={record.id} type="button" className="tree-object"
            aria-pressed={record.id === scene.id} aria-description={record.id === project.startup ? t('startupScene') : undefined}
            disabled={!editable} onClick={() => open(record.id)} {...(editable && valueSource('scene', record.id))}>
            <Layers3 size={14} aria-hidden="true" /><span>{record.name}</span>
            {record.id === project.startup && <Star className="tree-lock" size={12} aria-hidden="true" />}
          </button>)}
        </div>
        <fieldset className="scenes-field" disabled={!editable}>
          <label>{t('sceneName')} <RequiredText key={scene.id} value={scene.name} commit={name => rename(name.slice(0, 100))} /></label>
        </fieldset>
        <details>
          <summary>{t('worldMap')}</summary>
          <fieldset disabled={!editable}>
            <WorldMap project={project} active={scene.id} edit={changeWorld} select={open} />
          </fieldset>
        </details>
        <details>
          <summary>{t('gameplayLab')}</summary>
          <fieldset disabled={!editable}>{gameplay}</fieldset>
        </details>
        <details open>
          <summary>{t('sceneLinks')}</summary>
          {scene.links.map(link => {
            const matches = (item: SceneLink) => item.mode === link.mode && item.target === link.target;
            const name = t('sceneLinkTitle', { mode: t(`sceneLink_${link.mode}`), name: sceneRecord(project, link.target).name });
            const update = (field: 'transition' | 'backTransition', value: Transition) =>
              setLinks(links => links.map(item => matches(item) ? { ...item, [field]: value } : item));
            return <div className="scenes-link" key={JSON.stringify([link.mode, link.target])}>
              <div className="scenes-link-heading">
                <span>{name}</span>
                {addDirectorCue && <IconButton icon={Clapperboard} label={t('directorAddCue')} description={name}
                  onClick={() => addDirectorCue(link)} />}
                <IconButton icon={Minus} label={t('removeSceneLink')} description={name} disabled={!editable}
                  onClick={() => setLinks(links => links.filter(item => !matches(item)))} />
              </div>
              <div className="scenes-link-controls">
                <TransitionFields value={link.transition ?? instant} change={value => update('transition', value)}
                  disabled={!editable} linkName={name} />
                {link.mode === 'push' && <TransitionFields back value={link.backTransition ?? instant}
                  change={value => update('backTransition', value)} disabled={!editable} linkName={name} />}
              </div>
            </div>;
          })}
          <div className="scenes-link-controls">
            <select aria-label={t('sceneLinkMode')} value={mode} disabled={!editable}
              onChange={event => setMode(sceneLinkModes.find(item => item === event.target.value) ?? 'replace')}>
              {sceneLinkModes.map(item => <option key={item} value={item}>{t(`sceneLink_${item}`)}</option>)}
            </select>
            <select aria-label={t('sceneLinkTarget')} value={target} disabled={!editable || !available.length} onChange={event => setTargetId(event.target.value)}
              {...dropOne('scene', id => editable && scene.links.length < 60 && available.some(item => item.id === id),
                addLink)}>
              {!target && <option value="">{t('noSceneLinkTarget')}</option>}
              {available.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <TransitionFields value={transition} disabled={!editable} change={value => setTransitions(current => ({ ...current, [mode]: value }))} />
            {mode === 'push' && <TransitionFields back value={backTransition} disabled={!editable} change={setBackTransition} />}
            <IconButton icon={Plus} label={t('addSceneLink')} disabled={!editable || !target || scene.links.length >= 60}
              onClick={() => addLink(target)} />
          </div>
        </details>
      </>}
    </div>
  </section>;
}
