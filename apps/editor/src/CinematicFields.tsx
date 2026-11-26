import { Link2, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { type Clip, type Cue, cueLimit, nestedLimit } from './cinematics';
import { IconButton } from './chrome';
import { Numeric } from './Inspector';
import { t } from './i18n';
import type { SceneObject } from './scene';
import { selectionTree } from './selection';
import { timelineLimits } from './timeline';
import { dropOne } from './valueDrag';

export type CueTargets = {
  nodes: SceneObject[];
  globals: readonly { id: string; name: string }[];
  scenes: readonly { id: string; name: string }[];
};
const cueKinds = ['message', 'audio', 'visibility', 'camera', 'global', 'scene', 'clip'] as const;

function defaultCue(kind: Cue['kind'], data: Pick<Cue, 'id' | 'time' | 'name'>): Cue {
  switch (kind) {
    case 'message': return { ...data, kind, message: '' };
    case 'audio': return { ...data, kind, action: 'play', target: '' };
    case 'visibility': return { ...data, kind, visible: true, target: '' };
    case 'global': return { ...data, kind, target: '', value: '' };
    case 'scene': return { ...data, kind, target: '' };
    case 'camera': return { ...data, kind };
    case 'clip': return { ...data, time: Math.max(0.01, data.time), kind, target: '', fade: 0.3 };
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <label className="cinematic-field"><span>{label}</span>{children}</label>;
}

export function CinematicFields({ clip, playhead, targets, clips, candidates, editable, change }: {
  clip: Clip; playhead: number; targets: CueTargets; clips: readonly Clip[]; candidates: readonly Clip[]; editable: boolean;
  change: (update: (clip: Clip) => Clip) => void;
}) {
  return <div className="cinematic-fields">
    <details>
      <summary>{t('timelineNested')}</summary>
      <fieldset disabled={!editable}>
        <Row label={t('timelineAddNested')}>
          <select value="" aria-label={t('timelineAddNested')} disabled={clip.nested.length >= nestedLimit || !candidates.length}
            onChange={event => {
              const target = candidates.find(item => item.id === event.target.value);
              if (!target) return;
              const id = crypto.randomUUID();
              change(current => ({ ...current, nested: [...current.nested, { id, clip: target.id, start: playhead, speed: 1 }] }));
            }}>
            <option value="">{t('timelineChooseClip')}</option>
            {candidates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Row>
        {clip.nested.map((item, index) => {
          const patch = (fields: Partial<typeof item>) => change(current => ({ ...current,
            nested: current.nested.map(previous => previous.id === item.id ? { ...previous, ...fields } : previous) }));
          return <section key={item.id} className="timeline-item" aria-label={t('timelineNestedIndex', { index: index + 1 })}>
            <div className="timeline-item-header">
              <Link2 size={14} aria-hidden="true" />
              <span>{candidates.find(candidate => candidate.id === item.clip)?.name ?? t('timelineChooseClip')}</span>
              <IconButton icon={Trash2} label={t('timelineRemoveNested')} onClick={() => change(current =>
                ({ ...current, nested: current.nested.filter(previous => previous.id !== item.id) }))} />
            </div>
            <Row label={t('timelineNestedStart')}><Numeric label={t('timelineNestedStart')} min={0} max={timelineLimits.time}
              value={item.start} commit={start => patch({ start })} /></Row>
            <Row label={t('timelineSpeed')}><Numeric label={t('timelineSpeed')} min={0.25} max={4}
              value={item.speed} commit={speed => patch({ speed })} /></Row>
          </section>;
        })}
      </fieldset>
    </details>
    <details>
      <summary>{t('timelineCues')}</summary>
      <fieldset disabled={!editable}>
        <div className="timeline-item-header">{t('timelineCues')}
          <IconButton icon={Plus} label={t('timelineAddCue')} disabled={clip.cues.length >= cueLimit} onClick={() => {
            const id = crypto.randomUUID();
            change(current => ({ ...current, cues: [...current.cues, defaultCue('message',
              { id, time: playhead, name: t('timelineCueIndex', { index: current.cues.length + 1 }) })] }));
          }} />
        </div>
        {clip.cues.map((item, index) => <CueFields key={item.id} item={item} index={index}
          targets={targets} clips={clips} change={item => change(current =>
            ({ ...current, cues: current.cues.map(previous => previous.id === item.id ? item : previous) }))}
          remove={() => change(current => ({ ...current, cues: current.cues.filter(previous => previous.id !== item.id) }))} />)}
      </fieldset>
    </details>
  </div>;
}

function CueFields({ item, index, targets, clips, change, remove }: {
  item: Cue; index: number; targets: CueTargets; clips: readonly Clip[]; change: (item: Cue) => void; remove: () => void;
}) {
  const options = item.kind === 'clip' ? clips : item.kind === 'scene' ? targets.scenes : item.kind === 'global' ? targets.globals :
    [...selectionTree(targets.nodes).values()].filter(({ node }) => item.kind !== 'audio' || node.type === 'AudioSource')
      .map(({ node }) => ({ id: node.id, name: node.label }));
  const dragKind = item.kind === 'scene' || item.kind === 'global' ? item.kind :
    item.kind === 'audio' || item.kind === 'visibility' ? 'object' : undefined;
  return <section className="timeline-item" aria-label={t('timelineCueIndex', { index: index + 1 })}>
    <div className="timeline-item-header"><span>{item.name}</span>
      <IconButton icon={Trash2} label={t('timelineRemoveCue')} onClick={remove} />
    </div>
    <Row label={t('name')}><input key={item.name} defaultValue={item.name} maxLength={80} onBlur={event => {
      const next = event.currentTarget.value.trim();
      if (next && next !== item.name) change({ ...item, name: next });
      else event.currentTarget.value = item.name;
    }} /></Row>
    <Row label={t('timelineCueTime')}><Numeric label={t('timelineCueTime')} value={item.time} min={item.kind === 'clip' ? 0.01 : 0}
      max={timelineLimits.time} commit={time => change({ ...item, time })} /></Row>
    <Row label={t('timelineCueAction')}><select aria-label={t('timelineCueAction')} value={item.kind} onChange={event => {
      const kind = cueKinds.find(kind => kind === event.target.value);
      if (kind) change(defaultCue(kind, { id: item.id, time: item.time, name: item.name }));
    }}>
      {cueKinds.map(kind => <option key={kind} value={kind}>{t(`timelineCue_${kind}`)}</option>)}
    </select></Row>
    {'target' in item && <Row label={t('timelineCueTarget')}>
      <select aria-label={t('timelineCueTarget')} value={item.target} onChange={event => change({ ...item, target: event.target.value })}
        {...(dragKind && dropOne(dragKind, id => id !== item.target && options.some(option => option.id === id),
          target => change({ ...item, target })))}>
        <option value="">{t('timelineChooseTarget')}</option>
        {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        {item.target && !options.some(option => option.id === item.target) && <option value={item.target}>{t('timelineMissingTarget')}</option>}
      </select>
    </Row>}
    {item.kind === 'clip' && <Row label={t('timelineCrossfade')}>
      <Numeric label={t('timelineCrossfade')} value={item.fade} min={0} max={8} commit={fade => change({ ...item, fade })} />
    </Row>}
    {item.kind === 'audio' && <Row label={t('timelineAudioAction')}><select value={item.action}
      onChange={event => change({ ...item, action: event.target.value === 'stop' ? 'stop' : 'play' })}>
      <option value="play">{t('timelineCuePlay')}</option><option value="stop">{t('timelineCueStop')}</option>
    </select></Row>}
    {item.kind === 'visibility' && <Row label={t('visible')}><input type="checkbox" checked={item.visible}
      onChange={event => change({ ...item, visible: event.target.checked })} /></Row>}
    {item.kind === 'global' && <Row label={t('timelineKeyValue')}><input key={item.value} defaultValue={item.value} maxLength={1000}
      onBlur={event => { if (item.value !== event.currentTarget.value) change({ ...item, value: event.currentTarget.value }); }} /></Row>}
    {item.kind === 'message' && <Row label={t('timelineCueMessage')}><input key={item.message} defaultValue={item.message} maxLength={200}
      onBlur={event => { if (item.message !== event.currentTarget.value) change({ ...item, message: event.currentTarget.value }); }} /></Row>}
  </section>;
}
