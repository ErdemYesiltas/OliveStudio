import { Circle, Clapperboard, Diamond, Pause, Play, Plus, Square, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { hint, IconButton, PanelHeader } from './chrome';
import { Numeric } from './Inspector';
import { locale, t } from './i18n';
import type { SceneView } from './runtime';
import { findObject, validationMessage, type SceneObject } from './scene';
import { audioTween, authoredValue, defaultTransport, timelineEases, timelineLimits, timelineProperties, tweenValue, type TimelineTransport, type TweenKey, type TweenTrack } from './timeline';
import { DirectorFields, type DirectorPreview } from './DirectorFields';
import { cinematicSession } from './playCinematic';
import { CinematicFields, type CueTargets } from './CinematicFields';
import { TimelineCurve } from './TimelineCurve';
import { changeClip, clipLimit, clipList, compileClip, cueLimit, emptyCinematics, mainClip, removeClip,
  type Clip, type ClipData, type DirectedClip, type OnionSkin } from './cinematics';

import type { RecordTarget } from './timelineRecording';
import { valueDrop } from './valueDrag';
const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type TimelinePreviewCommand =
  | { action: 'play'; clip: DirectedClip; position: number; transport: TimelineTransport; fade: number }
  | { action: 'seek'; clip: DirectedClip; position: number }
  | { action: 'pause' | 'stop' }
  | { action: 'onion'; settings?: OnionSkin }
  | { action: 'record'; target?: RecordTarget };

export function TimelinePanel({ data, targets, selected, editable, visible, view, change, layoutChildren, locked, record, prefabEditing }: {
  data: ClipData; targets: CueTargets; selected?: SceneObject; editable: boolean; visible: boolean;
  view: RefObject<SceneView | null>;
  layoutChildren: ReadonlySet<string>; locked: ReadonlySet<string>; prefabEditing?: boolean;
  record: (target?: RecordTarget) => void;
  change: (update: (data: ClipData) => ClipData) => void;
}) {
  const { nodes } = targets;
  const clips = useMemo(() => clipList(data, t('timelineMainClip')), [data.timeline, data.cinematics]);
  const [currentId, setClip] = useState(mainClip);
  const current = clips.find(clip => clip.id === currentId) ?? clips[0];
  const compiled = useMemo(() => new Map(clips.map(clip => [clip.id, compileClip(clips, clip.id)!])), [clips]);
  const directed = compiled.get(current.id)!;
  const { tracks } = current;
  const duration = directed.duration;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState<string>();
  const [property, setProperty] = useState<TweenTrack['property']>('x');
  const [transport, setTransport] = useState(defaultTransport);
  const [fade, setFade] = useState(0.3);
  const [armed, setArmed] = useState(false);
  const [onion, setOnion] = useState(false);
  const [onionSettings, setOnionSettings] = useState<OnionSkin>({ before: 1, after: 1, spacing: 6 });
  const preview = useRef<SceneView | null>(null);
  const directorSession = useRef<ReturnType<typeof cinematicSession>>(undefined);
  const [directorPreview, setDirectorPreview] = useState<DirectorPreview>();
  const directorPreviewRun = useRef<object>(undefined);
  const [revealedCue, revealCue] = useState<string>();
  function stopDirector() {
    directorPreviewRun.current = undefined;
    setDirectorPreview(current => current && current.status !== 'stopped' ? { name: current.name, status: 'stopped' } : current);
    directorSession.current?.dispose();
    directorSession.current = undefined;
  }

  function session(runtime: SceneView) {
    return directorSession.current ??= cinematicSession(runtime, data);
  }
  const timeRef = useRef(0);
  const track = tracks.find(item => item.id === active) ?? tracks[0];
  const target = track && findObject(nodes, track.target);
  const canPreview = editable && (directed.cues.length > 0 || directed.lanes.some(({ track }) => findObject(nodes, track.target)));
  const managedPosition = (id: string) => layoutChildren.has(id) && (property === 'x' || property === 'y');
  const waitingOnLayout = !!selected && managedPosition(selected.id);
  const canAddTrack = (id: string) => !locked.has(id) && !managedPosition(id) &&
    (!audioTween(property) || findObject(nodes, id)?.type === 'AudioSource') &&
    !tracks.some(item => item.target === id && item.property === property);
  const library = data.cinematics ?? emptyCinematics;
  const playhead = Math.min(timelineLimits.time, Math.round(time * 100) / 100);

  function setPosition(position: number) {
    timeRef.current = position;
    setTime(position);
  }

  useLayoutEffect(() => {
    record(armed && visible && editable ? { id: current.id, time: playhead, clip: directed } : undefined);
    return () => record(undefined);
  }, [armed, visible, editable, current.id, playhead, directed, record]);
  useEffect(() => {
    if (!visible) {
      stopDirector();
      preview.current?.stopTimeline();
      preview.current = null;
      setArmed(false);
      setPlaying(false);
      setPosition(0);
    }
  }, [visible]);
  useEffect(() => {
    if (!preview.current) return;
    stopDirector();
    const position = Math.min(timeRef.current, directed.duration);
    preview.current.seekTimeline(directed, position);
    setPosition(position);
    setPlaying(false);
  }, [compiled, nodes]);
  useEffect(() => {
    if (!visible) return;
    const settings = onion ? onionSettings : undefined;
    view.current?.setOnionSkin(settings);
  }, [onion, onionSettings, visible, view]);
  useEffect(() => () => {
    directorPreviewRun.current = undefined;
    directorSession.current?.dispose();
    preview.current?.stopTimeline();
  }, []);
  useEffect(() => { if (!editable) stopDirector(); }, [editable]);

  function start(clip: DirectedClip, position: number, seconds = 0) {
    const runtime = view.current;
    if (!runtime) return;
    preview.current = runtime;
    const director = prefabEditing ? undefined : session(runtime);
    director?.pause(false);
    runtime.playTimeline(clip, position, (position, ended) => {
      setPosition(position);
      if (ended) setPlaying(false);
    }, { transport, fade: seconds, cue: director?.run });
    setPlaying(true);
  }

  function playback() {
    if (playing) {
      view.current?.pauseTimeline();
      directorSession.current?.pause(true);
      setPlaying(false);
      return;
    }
    const atEnd = transport.reverse ? time <= 0 : time >= duration;
    start(directed, atEnd ? (transport.reverse ? duration : 0) : time);
  }

  function seek(position: number) {
    const runtime = view.current;
    if (!runtime) return;
    preview.current = runtime;
    stopDirector();
    runtime.seekTimeline(directed, position);
    setPlaying(false);
    setPosition(position);
  }

  function stop() {
    stopDirector();
    preview.current?.stopTimeline();
    preview.current = null;
    setPlaying(false);
    setPosition(0);
  }

  function selectClip(id: string) {
    if (id === current.id) return;
    const next = compiled.get(id);
    if (!next) return;
    setClip(id);
    setArmed(false);
    if (preview.current && fade > 0 && next.lanes.length > 0) {
      start(next, transport.reverse ? next.duration : 0, fade);
    } else stop();
  }

  function editClip(update: (clip: Clip) => Clip) { change(data => changeClip(data, current.id, update)); }

  function createClip() {
    const id = crypto.randomUUID();
    const name = t('timelineNewClipName', { index: library.clips.length + 1 });
    stop();
    setArmed(false);
    change(data => {
      const library = data.cinematics ?? emptyCinematics;
      return { ...data, cinematics: { ...library, clips: [...library.clips, { id, name, tracks: [], cues: [], nested: [] }] } };
    });
    setClip(id);
  }

  function transportChange(patch: Partial<typeof transport>) {
    if (preview.current) seek(time);
    setTransport(current => ({ ...current, ...patch }));
  }

  function addTracks(objects: SceneObject[]) {
    const added = objects.map(object => {
      const value = authoredValue(object, property);
      return { id: crypto.randomUUID(), target: object.id, property, keys: [0, 1].map(time =>
        ({ id: crypto.randomUUID(), time, value, ease: 'linear' as const })) };
    });
    editClip(clip => ({ ...clip, tracks: [...clip.tracks, ...added] }));
    setActive(added[0].id);
  }

  function updateKeys(update: (keys: TweenKey[]) => TweenKey[]) {
    editClip(clip => ({ ...clip, tracks: clip.tracks.map(item => item.id === track?.id ?
      { ...item, keys: update(item.keys).sort((a, b) => a.time - b.time) } : item) }));
  }

  function editKey(id: string, patch: Partial<TweenKey>) {
    updateKeys(keys => keys.map(key => key.id === id ? { ...key, ...patch } : key));
  }

  const atKey = track?.keys.some(key => Math.abs(key.time - playhead) < 1e-9);

  return <section className="panel" aria-label={t('timeline')}>
    <PanelHeader icon={Clapperboard} label={t('timeline')} description={t('timelineHint')}>
      <div className="panel-tools" role="group" aria-label={t('timelinePlayback')}>
        <IconButton icon={playing ? Pause : Play} label={t(playing ? 'timelinePause' : 'timelinePlay')}
          disabled={!canPreview || armed} onClick={playback} />
        <IconButton icon={Circle} label={t('timelineRecord')} description={t('timelineRecordHint')}
          aria-pressed={armed} className="timeline-record" disabled={!editable} onClick={() => {
            if (!armed) seek(time);
            setArmed(!armed);
          }} />
        <IconButton icon={Square} label={t('timelineStop')} disabled={!preview.current && !playing} onClick={() => { setArmed(false); stop(); }} />
      </div>
    </PanelHeader>
    <div className="panel-body timeline-body">
      {!prefabEditing && <div className="timeline-row">
        <select aria-label={t('timelineClip')} value={current.id} onChange={event => selectClip(event.target.value)}>
          {clips.map(clip => <option key={clip.id} value={clip.id}>{clip.name}</option>)}
        </select>
        <IconButton icon={Plus} label={t('timelineAddClip')} disabled={!editable || library.clips.length >= clipLimit} onClick={createClip} />
        {current.id !== mainClip && <>
          <input aria-label={t('timelineClipName')} key={current.name + current.id} defaultValue={current.name} maxLength={80}
            disabled={!editable} onBlur={event => {
              const next = event.currentTarget.value.trim();
              if (next && next !== current.name) editClip(clip => ({ ...clip, name: next }));
              else event.currentTarget.value = current.name;
            }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          <IconButton icon={Trash2} label={t('timelineRemoveClip')} disabled={!editable} onClick={() => {
            stop();
            setArmed(false);
            setClip(mainClip);
            change(data => ({ ...data, cinematics: removeClip(library, current.id) }));
          }} />
        </>}
        <label><input type="checkbox" disabled={!editable} checked={library.autoplay === current.id} onChange={event => {
          const checked = event.target.checked;
          change(data => ({ ...data, cinematics: { ...library, autoplay: checked ? current.id : undefined } }));
        }} />{t('timelineAutoplay')}</label>
      </div>}
      <div className="timeline-row timeline-options">
        <label>{t('timelineSpeed')} <Numeric label={t('timelineSpeed')} value={transport.speed} min={0.25} max={4}
          commit={speed => transportChange({ speed })} /></label>
        <label><input type="checkbox" checked={transport.reverse} onChange={event => transportChange({ reverse: event.target.checked })} />{t('timelineReverse')}</label>
        <label><input type="checkbox" checked={transport.loop} onChange={event => transportChange({ loop: event.target.checked })} />{t('timelineLoop')}</label>
        <label>{t('timelineCrossfade')} <Numeric label={t('timelineCrossfade')} value={fade} min={0} max={8} commit={setFade} /></label>
        <label><input type="checkbox" checked={onion} onChange={event => setOnion(event.target.checked)} />{t('timelineOnion')}</label>
        {onion && (['before', 'after', 'spacing'] as const).map(key => <label key={key}>{t(`timelineOnion_${key}`)}
          <Numeric label={t(`timelineOnion_${key}`)} value={onionSettings[key]} step={1} min={key === 'spacing' ? 1 : 0}
            max={key === 'spacing' ? 30 : 5} commit={value => setOnionSettings(current => ({ ...current, [key]: value }))} /></label>)}
      </div>
      <div className="timeline-row">
        <input className="timeline-scrubber" type="range" min={0} max={duration} step={0.01} value={time}
          aria-label={t('timelinePlayhead')} disabled={!canPreview && !armed} onChange={event => seek(event.target.valueAsNumber)} />
        <output>{t('timelineSeconds', { time: number.format(time), duration: number.format(duration) })}</output>
      </div>
      <div className="timeline-row" {...valueDrop('object', ids => {
        if (!editable) return;
        const objects = [...new Set(ids)].flatMap(id => {
          const object = findObject(nodes, id);
          return object && canAddTrack(id) ? [object] : [];
        });
        if (objects.length && tracks.length + objects.length <= timelineLimits.tracks) return objects;
      }, addTracks)}>
        <select aria-label={t('timelineProperty')} disabled={!editable} value={property} onChange={event => {
          const next = timelineProperties.find(item => item === event.target.value);
          if (next) setProperty(next);
        }}>
          {timelineProperties.map(item => <option key={item} value={item}>{t(`timelineProp_${item}`)}</option>)}
        </select>
        <IconButton icon={Plus} label={t('timelineAddTrack')} description={t(waitingOnLayout ? 'flexPositionManaged' : 'timelineAddTrackHint')}
          disabled={!editable || !selected || !canAddTrack(selected.id) || tracks.length >= timelineLimits.tracks}
          onClick={() => selected && addTracks([selected])} />
        {track && <>
          <select aria-label={t('timelineTrack')} value={track.id} onChange={event => setActive(event.target.value)}>
            {tracks.map(item => <option key={item.id} value={item.id}>
              {findObject(nodes, item.target)?.label ?? t('timelineMissingTarget')} · {t(`timelineProp_${item.property}`)}
            </option>)}
          </select>
          <IconButton icon={Trash2} label={t('timelineRemoveTrack')} disabled={!editable}
            onClick={() => editClip(clip => ({ ...clip, tracks: clip.tracks.filter(item => item.id !== track.id) }))} />
          <IconButton icon={Diamond} label={t('timelineAddKey')} disabled={!editable || !target || atKey || track.keys.length >= timelineLimits.keys}
            onClick={() => {
              if (!target) return;
              const value = tweenValue(track, playhead, authoredValue(target, track.property));
              updateKeys(keys => [...keys, { id: crypto.randomUUID(), time: playhead, value, ease: 'linear' }]);
            }} />
        </>}
      </div>
      {track && <TimelineCurve key={track.id} track={track} duration={duration} time={time} editable={editable} seek={seek} update={editKey} />}
      {track && <fieldset className="timeline-keys" disabled={!editable} aria-label={t('timelineKeys')}>
        <div aria-hidden="true">{t('timelineKeyTime')}</div><div aria-hidden="true">{t('timelineKeyValue')}</div>
        <div aria-hidden="true">{t('timelineEase')}</div><div />
        {track.keys.map((key, index) => {
          const labels = {
            time: t('timelineKeyLabel', { field: t('timelineKeyTime'), index: index + 1 }),
            value: t('timelineKeyLabel', { field: t('timelineKeyValue'), index: index + 1 }),
            ease: t('timelineKeyLabel', { field: t('timelineEase'), index: index + 1 }),
          };
          return <div key={key.id} className="timeline-key-row">
            <Numeric key={labels.time} label={labels.time} value={key.time} min={0} max={timelineLimits.time} commit={time => {
              if (track.keys.every(item => item.id === key.id || item.time !== time)) editKey(key.id, { time });
            }} />
            <Numeric label={labels.value} value={key.value}
              min={track.property === 'rate' ? 0.25 : track.property === 'alpha' || track.property === 'volume' ? 0 : undefined}
              max={track.property === 'rate' ? 4 : track.property === 'alpha' || track.property === 'volume' ? 1 : undefined}
              commit={value => editKey(key.id, { value })} />
            <select aria-label={labels.ease} value={key.ease} disabled={!index} {...hint(t('timelineEase'), t('timelineEaseHint'))}
              onChange={event => {
                const ease = timelineEases.find(item => item === event.target.value);
                if (ease) editKey(key.id, { ease });
              }}>
              {timelineEases.map(item => <option key={item} value={item}>{t(`timelineEase_${item}`)}</option>)}
            </select>
            <IconButton icon={X} label={t('timelineKeyLabel', { field: t('timelineRemoveKey'), index: index + 1 })}
              disabled={track.keys.length <= 1} onClick={() => updateKeys(keys => keys.filter(item => item.id !== key.id))} />
          </div>;
        })}
      </fieldset>}
      {!prefabEditing && <DirectorFields items={library.director ?? []} editable={editable} targets={{ ...targets, clips }} playback={directorPreview}
        cueHint={t('directorCueHint', { clip: current.name, time: number.format(playhead) })}
        cue={current.cues.length < cueLimit ? composition => {
          const id = crypto.randomUUID();
          editClip(clip => ({ ...clip, cues: [...clip.cues, {
            id, kind: 'director', name: composition.slice(0, 80).trim(), time: playhead, composition,
          }] }));
          revealCue(id);
        } : undefined}
        change={items => change(previous => {
          const metadata = previous.cinematics ?? emptyCinematics;
          const byId = new Map(items.map(item => [item.id, item.name]));
          const renamed = new Map(metadata.director?.map(({ id, name }) => [name, byId.get(id)]));
          const renameCues = <T extends { cues: Clip['cues'] }>(clip: T): T => ({
            ...clip, cues: clip.cues.map(cue => cue.kind === 'director' && renamed.get(cue.composition) ?
              { ...cue, composition: renamed.get(cue.composition)! } : cue),
          });
          return { ...previous, cinematics: { ...metadata, director: items,
            main: renameCues(metadata.main), clips: metadata.clips.map(renameCues) } };
        })}
        preview={name => {
          const run = {};
          try {
            const runtime = view.current;
            if (!runtime) throw new Error(t('directorPreviewUnavailable'));
            preview.current = runtime;
            const control = session(runtime).play(name);
            if (!control) throw new Error(t('directorPreviewUnavailable'));
            directorPreviewRun.current = run;
            setDirectorPreview({ name, status: 'running' });
            void control.finished.then(
              () => { if (directorPreviewRun.current === run) setDirectorPreview({ name, status: 'completed' }); },
              error => {
                if (directorPreviewRun.current === run) setDirectorPreview({ name, status: 'failed', error: validationMessage(error) });
              },
            );
          } catch (error) {
            setDirectorPreview({ name, status: 'failed', error: validationMessage(error) });
          }
        }} stop={stop} />}
      {!prefabEditing && <CinematicFields clip={current} playhead={playhead}
        targets={{ ...targets, compositions: library.director }} clips={clips} revealedCue={revealedCue}
        candidates={clips.filter(clip => clip.id !== current.id && !referencesClip(clips, clip.id, current.id))}
        editable={editable} change={editClip} />}
    </div>
  </section>;
}

function referencesClip(clips: readonly Clip[], from: string, target: string): boolean {
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  const visited = new Set<string>();
  function visit(id: string): boolean {
    if (id === target) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return byId.get(id)?.nested.some(item => visit(item.clip)) ?? false;
  }
  return visit(from);
}
