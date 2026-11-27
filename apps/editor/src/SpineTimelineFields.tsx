import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Play, Plus, RotateCcw, Square, Trash2 } from 'lucide-react';
import { deleteSpineKeys, removeSpineEvent, renameSpineEvent, replaceSpineSection, replaceSpineTrack, retimeSpineKeys, spineDrawOrderOffsets, spineKeyDrawOrder, spineRelativePath, spineSkinAttachments, spineTrackKeys,
  type SpineDocument, type SpineTrackKey } from '@olivestudio/engine/spine-format';
import { IconButton } from './chrome';
import { t, type MessageKey } from './i18n';
import { validationMessage } from './scene';
import { SpineNumber } from './SpineNumber';
import { RenameValue } from './SpineAttachmentFields';
import { SpineCurveFields, type SpineCurveComponent } from './SpineCurveFields';
import { SpineColorFields, spineColorValue } from './SpineColorFields';
import { spinePhysicsTrackNumbers } from './SpineConstraintFields';
import { assetMime, type Asset, type EmbeddedMedia } from './assets';
import { DirectorAudio } from './directorAudio';
import type { SpineReferenceChange } from './spineAssets';

const categories = ['slots', 'constraints', 'sequence', 'events', 'drawOrder'] as const;
type Category = typeof categories[number];
type Field =
  { type: 'number'; key: string; label: MessageKey; value: number; min?: number; max?: number; step?: number } |
  { type: 'select'; key: string; label: MessageKey; value: string; choices: string[] } |
  { type: 'check'; key: string; label: MessageKey; value: boolean } |
  { type: 'text'; key: string; label: MessageKey; value: string } |
  { type: 'color'; key: string; label: MessageKey; value: string; alpha?: boolean };
type Track = { path: string[]; name: string; fields: Field[]; curve?: boolean };
const trackName = (name: string) => t(`spineTimeline_${name}` as MessageKey);
const numeric = (key: string, value = 1, min?: number, max?: number): Field =>
  ({ type: 'number', key, label: `spineConstraint_${key}` as MessageKey, value, min, max });
const mix = ['mixRotate', 'mixX', 'mixY'];
const sequenceModes = ['hold', 'once', 'loop', 'pingpong', 'onceReverse', 'loopReverse', 'pingpongReverse'];
const timeOf = (key: SpineTrackKey) => key.time ?? 0;
const channelName = (item: string) => `spineTimeline_${item}` as MessageKey;

function timelineTracks(document: SpineDocument, category: Category): Track[] {
  switch (category) {
    case 'slots': {
      const skins = (document.skins ?? []).map(skin => spineSkinAttachments(document, skin.name));
      return (document.slots ?? []).flatMap(slot => {
        const names = ['', ...new Set(skins.flatMap(skin => Object.keys(skin[slot.name] ?? {})))];
        const make = (channel: string, fields: Field[], curve = true): Track =>
          ({ path: ['slots', slot.name, channel], name: `${slot.name} · ${trackName(channel)}`, fields, curve });
        const color = (key: string, alpha = false): Field => ({ type: 'color', key, alpha,
          label: key === 'light' ? 'spineTimeline_light' : key === 'dark' ? 'spineTimeline_dark' : 'spineTimeline_color',
          value: key === 'dark' ? String(slot.dark ?? '000000') : String(slot.color ?? 'ffffffff') });
        return [
          make('attachment', [{ type: 'select', key: 'name', label: 'spineAttachment', value: slot.attachment ?? '', choices: names }], false),
          make('rgba', [color('color', true)]), make('rgb', [color('color')]),
          make('rgba2', [color('light', true), color('dark')]), make('rgb2', [color('light'), color('dark')]),
          make('alpha', [{ type: 'number', key: 'value', label: 'spineTimeline_alpha', value: 1, min: 0, max: 1 }]),
        ];
      });
    }
    case 'constraints': {
      const ik = (document.ik ?? []).map(({ name }) => ({ path: ['ik', name], name: `${name} · IK`, curve: true,
        fields: [numeric('mix', 1, 0, 1), numeric('softness', 0, 0), ...['bendPositive', 'compress', 'stretch'].map(key =>
          ({ type: 'check' as const, key, label: `spineConstraint_${key}` as MessageKey, value: key === 'bendPositive' }))] }));
      const transform = (document.transform ?? []).map(({ name }) => ({
        path: ['transform', name], name: `${name} · ${t('spineSection_transform')}`, curve: true,
        fields: [...mix, 'mixScaleX', 'mixScaleY', 'mixShearY'].map(key => numeric(key, 1, 0, 1)),
      }));
      const path = (document.path ?? []).flatMap(({ name }) => ['position', 'spacing', 'mix'].map(channel => ({
        path: ['path', name, channel], name: `${name} · ${trackName(channel)}`, curve: true,
        fields: channel === 'mix' ? mix.map(key => numeric(key, 1, 0, 1)) :
          [{ type: 'number' as const, key: 'value', label: `spineConstraint_${channel}` as MessageKey, value: 0 }],
      })));
      const physics = (document.physics?.length ? [null, ...document.physics] : []).flatMap(constraint => {
        const name = constraint?.name ?? '';
        const label = name || t('spineTimeline_globalPhysics');
        return [...spinePhysicsTrackNumbers.map(([channel, fallback, min, max]): Track => {
          const setup = constraint?.[channel];
          const value = typeof setup === 'number' && (min === undefined || setup >= min) &&
            (max === undefined || setup <= max) ? setup : fallback;
          return { path: ['physics', name, channel], name: `${label} · ${trackName(channel)}`, curve: true,
            fields: [{ ...numeric(channel, value, min, max), key: 'value' }] };
        }), { path: ['physics', name, 'reset'], name: `${label} · ${trackName('reset')}`, fields: [] }];
      });
      return [...ik, ...transform, ...path, ...physics];
    }
    case 'sequence':
      return (document.skins ?? []).flatMap(({ name: skin }) => Object.entries(spineSkinAttachments(document, skin)).flatMap(([slot, entries]) =>
        Object.entries(entries).filter(([, attachment]) => attachment.sequence).map(([name, attachment]) => {
          const sequence = attachment.sequence as { count?: number };
          return { path: ['attachments', skin, slot, name, 'sequence'], name: `${skin} / ${slot} / ${name}`, fields: [
            { type: 'select', key: 'mode', label: 'spineSequenceMode', value: 'hold', choices: sequenceModes },
            { type: 'number', key: 'index', label: 'spineSequenceIndex', value: 0, min: 0, max: Math.max(0, (sequence.count ?? 1) - 1), step: 1 },
            { type: 'number', key: 'delay', label: 'spineSequenceDelay', value: 0.1, min: 0.0001 },
          ] };
        })));
    case 'events': {
      const events = Object.keys(document.events ?? {});
      return events.length ? [{ path: ['events'], name: t('spineTimeline_events'),
        fields: [{ type: 'select', key: 'name', label: 'spineTimeline_event', value: events[0], choices: events }] }] : [];
    }
    case 'drawOrder': return document.slots?.length ? [{ path: ['drawOrder'], name: t('spineTimeline_drawOrder'), fields: [] }] : [];
  }
}

export function SpineTimelineFields({ document, animation, disabled, selectAnimation, change, report, audioAssets, eventAudio, linkEventAudio }: {
  document: SpineDocument; animation: string; disabled: boolean; selectAnimation: (name: string) => void;
  change: (document: SpineDocument, reference?: SpineReferenceChange) => void; report: (error: string) => void;
  audioAssets: readonly Asset[]; eventAudio: EmbeddedMedia['audio']; linkEventAudio: (name: string, sound: Asset) => void;
}) {
  const [category, selectCategory] = useState<Category>('slots');
  const [target, selectTarget] = useState(0);
  const [frame, selectFrame] = useState(0);
  const [eventName, setEventName] = useState('');
  const [eventDefinition, selectEventDefinition] = useState('');
  const result = useMemo(() => {
    try {
      const tracks = timelineTracks(document, category);
      const track = tracks[target] ?? tracks[0];
      return { track, tracks, keys: track && animation ? spineTrackKeys(document, animation, track.path) : [] };
    } catch (error) { return { error: validationMessage(error), tracks: [], keys: [] }; }
  }, [document, animation, category, target]);
  const { track, tracks, keys, error } = result;
  const row = Math.min(frame, keys.length - 1);
  const key = keys[row];
  const nextKey = keys[row + 1];
  const slots = document.slots?.map(slot => slot.name) ?? [];
  const commit = (build: () => SpineDocument, reference?: SpineReferenceChange) => {
    try { change(build(), reference); report(''); return true; }
    catch (error) { report(validationMessage(error)); return false; }
  };
  const apply = (keys: SpineTrackKey[]) => track && commit(() => replaceSpineTrack(document, animation, track.path, keys));
  const patch = (patch: SpineTrackKey) => apply(keys.map((key, index) => index === row ? patch : key));
  const hasBezier = keys.some(key => Array.isArray(key.curve));
  const fields = track?.fields ?? [];
  const event = category === 'events' && typeof key?.name === 'string' ? document.events?.[key.name] : undefined;
  const definitions = Object.keys(document.events ?? {});
  const currentDefinition = definitions.includes(eventDefinition) ? eventDefinition : definitions[0];
  const definition = currentDefinition ? document.events?.[currentDefinition] : undefined;
  const audioPath = spineRelativePath(definition?.audio);
  const sound = audioPath ? eventAudio?.find(file => file.path === audioPath) : undefined;
  const audioPreview = useMemo(() => new DirectorAudio(() => undefined, () => ({ volume: 1, muted: false })), []);
  useEffect(() => () => audioPreview.stopCues(), [audioPreview, category, currentDefinition, sound]);
  const updateDefinition = (patch: Record<string, unknown>) =>
    commit(() => replaceSpineSection(document, 'events', { ...document.events, [currentDefinition]: { ...definition, ...patch } }));
  const eventFields: Field[] = event ? [
    { type: 'number', label: 'spineTimeline_int', key: 'int', value: Number(event.int ?? 0), step: 1 },
    { type: 'number', label: 'spineTimeline_float', key: 'float', value: Number(event.float ?? 0) },
    { type: 'text', label: 'spineTimeline_string', key: 'string', value: String(event.string ?? '') },
    ...(event.audio ? [
      { type: 'number' as const, label: 'spineTimeline_volume' as const, key: 'volume', value: Number(event.volume ?? 1), min: 0, max: 1 },
      { type: 'number' as const, label: 'spineTimeline_balance' as const, key: 'balance', value: Number(event.balance ?? 0), min: -1, max: 1 },
    ] : []),
  ] : [];
  return <>
    <label>{t('assetAnimation')}<select value={animation} disabled={disabled || !animation} onChange={event => {
      selectAnimation(event.currentTarget.value); selectFrame(0);
    }}>
      {!animation && <option value="">—</option>}{Object.keys(document.animations ?? {}).map(name => <option key={name}>{name}</option>)}
    </select></label>
    <label>{t('spineTimelineGroup')}<select value={category} disabled={disabled} onChange={event => {
      selectCategory(event.currentTarget.value as Category); selectTarget(0); selectFrame(0);
    }}>
      {categories.map(category => <option key={category} value={category}>{t(channelName(category))}</option>)}
    </select></label>
    {category === 'events' && <form className="spine-studio-add" onSubmit={event => {
      event.preventDefault();
      const name = eventName.trim();
      if (!name || name === '__proto__' || Object.hasOwn(document.events ?? {}, name)) return;
      try {
        change(replaceSpineSection(document, 'events', { ...document.events, [name]: {} }));
        selectEventDefinition(name); setEventName(''); report('');
      } catch (error) { report(validationMessage(error)); }
    }}>
      <input aria-label={t('spineNewEvent')} placeholder={t('spineNewEvent')} disabled={disabled} value={eventName} maxLength={120}
        onChange={event => setEventName(event.currentTarget.value)} />
      <IconButton icon={Plus} type="submit" label={t('spineAddEvent')}
        disabled={disabled || !eventName.trim() || eventName.trim() === '__proto__' || Object.hasOwn(document.events ?? {}, eventName.trim())} />
    </form>}
    {category === 'events' && definition && <fieldset className="spine-key" disabled={disabled}>
      <legend>{t('spineEventDefinition')}</legend>
      <label>{t('spineTimeline_event')}<select value={currentDefinition} onChange={event => selectEventDefinition(event.target.value)}>
        {definitions.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <RenameValue label={t('spineRenameEvent')} value={currentDefinition} disabled={disabled} rename={name => {
        if (!commit(() => renameSpineEvent(document, currentDefinition, name), { kind: 'event', from: currentDefinition, to: name })) return false;
        selectEventDefinition(name);
        return true;
      }} />
      <SpineNumber key={currentDefinition + ':int'} label={t('spineEventDefaultInt')} value={Number(definition.int ?? 0)} step={1}
        change={int => updateDefinition({ int })} />
      <SpineNumber key={currentDefinition + ':float'} label={t('spineEventDefaultFloat')} value={Number(definition.float ?? 0)}
        change={float => updateDefinition({ float })} />
      <TrackValue key={currentDefinition + ':string'} field={{ type: 'text', key: 'string', label: 'spineEventDefaultText', value: '' }}
        value={definition.string} disabled={disabled} change={string => updateDefinition({ string })} />
      <label>{t('spineEventAudioPath')}<input key={currentDefinition + ':' + String(definition.audio ?? '')}
        defaultValue={typeof definition.audio === 'string' ? definition.audio : ''}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        onBlur={event => {
          const audio = event.currentTarget.value.trim();
          if (audio !== (definition.audio ?? '')) updateDefinition({ audio: audio || undefined });
        }} /></label>
      {!!audioAssets.length && <label>{t('spineEventAudioAsset')}<select value="" onChange={event => {
        const sound = audioAssets.find(asset => asset.alias === event.currentTarget.value);
        if (sound) linkEventAudio(currentDefinition, sound);
      }}>
        <option value="" disabled>{t('spineChooseEventAudio')}</option>
        {audioAssets.map(asset => <option key={asset.alias} value={asset.alias}>{asset.name ?? asset.path}</option>)}
      </select></label>}
      {definition.audio ? <>
        <SpineNumber label={t('spineEventDefaultVolume')} value={Number(definition.volume ?? 1)} min={0} max={1}
          change={volume => updateDefinition({ volume })} />
        <SpineNumber label={t('spineEventDefaultBalance')} value={Number(definition.balance ?? 0)} min={-1} max={1}
          change={balance => updateDefinition({ balance })} />
        {sound && <div className="panel-tools">
          <IconButton icon={Play} label={t('spinePlayEventAudio')} onClick={() => {
            audioPreview.stopCues();
            audioPreview.playCue(sound.path, Number(definition.volume ?? 1), Number(definition.balance ?? 0),
              `data:${assetMime(sound.path)};base64,${sound.data}`);
          }} />
          <IconButton icon={Square} label={t('spineStopEventAudio')} onClick={() => audioPreview.stopCues()} />
        </div>}
      </> : null}
      <IconButton icon={Trash2} label={t('spineRemoveEvent')} description={t('spineRemoveEventHint')} onClick={() => {
        if (commit(() => removeSpineEvent(document, currentDefinition), { kind: 'event', from: currentDefinition, to: null })) {
          selectEventDefinition(definitions.find(name => name !== currentDefinition) ?? '');
          selectFrame(0);
        }
      }} />
    </fieldset>}
    {error ? <small className="error" role="alert">{error}</small> : !track ? <small>{t('spineTimelineNoTrack')}</small> : <>
      <label>{t('spineTimelineTrack')}<select value={tracks.indexOf(track)} disabled={disabled}
        onChange={event => { selectTarget(Number(event.currentTarget.value)); selectFrame(0); }}>
        {tracks.map((track, index) => <option key={JSON.stringify(track.path)} value={index}>{track.name}</option>)}
      </select></label>
      <button type="button" className="bundle-command" disabled={disabled || !animation} onClick={() => {
        const next = keys.length ? Math.round((timeOf(keys.at(-1)!) + 0.25) * 1000) / 1000 : 0;
        const seed = category === 'events' ? { name: currentDefinition } :
          Object.fromEntries(fields.map(field => [field.key, field.type === 'color' ? spineColorValue(field.value, field.alpha) : field.value]));
        if (apply([...keys, { ...seed, time: next }])) selectFrame(keys.length);
      }}><Plus size={15} aria-hidden="true" />{t('spineAddKey')}</button>
      <label>{t('spineTimelineKey')}<select value={row} disabled={disabled || !key} onChange={event => selectFrame(Number(event.currentTarget.value))}>
        {!key && <option value={-1}>—</option>}{keys.map((key, index) => <option key={index} value={index}>{index + 1} · {timeOf(key)} s</option>)}
      </select></label>
      {key && <>
        <SpineNumber label={t('spinePreviewTime')} value={timeOf(key)} min={0} disabled={disabled} change={time => {
          if (hasBezier) commit(() => retimeSpineKeys(document, animation, [{ path: track.path, index: row }], { offset: time - timeOf(key) }));
          else if (patch({ ...key, time })) selectFrame(keys.filter((key, index) => index !== row &&
            (timeOf(key) < time || timeOf(key) === time && index < row)).length);
        }} />
        {fields.map(field => <TrackValue key={`${JSON.stringify(track.path)}:${row}:${field.key}`} field={field} value={key[field.key]}
          disabled={disabled} change={value => patch({ ...key, [field.key]: value })} />)}
        {eventFields.map(field => <div className="spine-event-key-field" key={`${row}:${field.key}`}>
          <TrackValue field={field} value={key[field.key]} disabled={disabled} change={value => patch({ ...key, [field.key]: value })} />
          <IconButton icon={RotateCcw} label={t('spineEventResetField', { field: t(field.label) })}
            disabled={disabled || !Object.hasOwn(key, field.key)} onClick={() => {
              const { [field.key]: _override, ...rest } = key;
              patch(rest);
            }} />
        </div>)}
        {category === 'drawOrder' && <DrawOrderFields setup={slots} value={key} disabled={disabled} change={offsets => patch({ ...key, offsets })} />}
        {track.curve && <SpineCurveFields curve={key.curve} start={timeOf(key)} end={nextKey ? timeOf(nextKey) : undefined} disabled={disabled}
          components={nextKey ? timelineCurveComponents(fields, key, nextKey) : []} change={curve => {
            const { curve: _previous, ...rest } = key;
            patch(curve === undefined ? rest : { ...rest, curve });
          }} />}
        <IconButton icon={Trash2} label={t('spineRemoveKey')} disabled={disabled} onClick={() => {
          const removed = hasBezier ? commit(() => deleteSpineKeys(document, animation, [{ path: track.path, index: row }])) :
            apply(keys.filter((_, index) => index !== row));
          if (removed) selectFrame(Math.max(0, row - 1));
        }} />
      </>}
    </>}
  </>;
}

function timelineCurveComponents(fields: Field[], current: SpineTrackKey, next: SpineTrackKey): SpineCurveComponent[] {
  return fields.flatMap(field => {
    if (field.type === 'number') {
      const read = (frame: SpineTrackKey) => {
        const value = frame[field.key];
        if (typeof value === 'number') return value;
        if (field.key === 'mixY' && typeof frame.mixX === 'number') return frame.mixX;
        if (field.key === 'mixScaleY' && typeof frame.mixScaleX === 'number') return frame.mixScaleX;
        return field.label === 'spineTimeline_alpha' ? 0 : field.value;
      };
      return [{ label: t(field.label), from: read(current), to: read(next) }];
    }
    if (field.type !== 'color') return [];
    const from = spineColorValue(String(current[field.key] ?? field.value), field.alpha);
    const to = spineColorValue(String(next[field.key] ?? field.value), field.alpha);
    const channels = ['spineColorRed', 'spineColorGreen', 'spineColorBlue', 'spineTimeline_alpha'] as const;
    return channels.slice(0, field.alpha ? 4 : 3).map((channel, index) => ({
      label: t('spineColorComponent', { color: t(field.label), channel: t(channel) }),
      from: parseInt(from.slice(index * 2, index * 2 + 2), 16) / 255,
      to: parseInt(to.slice(index * 2, index * 2 + 2), 16) / 255,
    }));
  });
}

function TrackValue({ field, value, disabled, change }: {
  field: Field; value: unknown; disabled: boolean; change: (value: unknown) => void;
}) {
  const title = t(field.label);
  switch (field.type) {
    case 'number': return <SpineNumber label={title} value={typeof value === 'number' ? value : field.value}
      disabled={disabled} min={field.min} max={field.max} step={field.step} change={change} />;
    case 'check': return <label>{title}<input type="checkbox" checked={typeof value === 'boolean' ? value : field.value} disabled={disabled}
      onChange={event => change(event.currentTarget.checked)} /></label>;
    case 'select': {
      const selected = value === null ? '' : typeof value === 'string' ? value : field.value;
      return <label>{title}<select value={selected} disabled={disabled}
        onChange={event => change(field.key === 'name' && !event.currentTarget.value ? null : event.currentTarget.value)}>
        {!field.choices.includes(selected) && <option>{selected}</option>}
        {field.choices.map(choice => <option key={choice} value={choice}>{field.key === 'mode' ? trackName(choice) : choice || '—'}</option>)}
      </select></label>;
    }
    case 'text': {
      const text = String(value ?? field.value);
      return <label>{title}<input key={text} defaultValue={text} disabled={disabled}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        onBlur={event => { if (event.currentTarget.value !== text) change(event.currentTarget.value); }} /></label>;
    }
    case 'color': return <SpineColorFields label={title} value={String(value ?? field.value)} alpha={field.alpha} disabled={disabled} change={change} />;
  }
}

function DrawOrderFields({ setup, value, disabled, change }: {
  setup: string[]; value: SpineTrackKey; disabled: boolean; change: (offsets: ReturnType<typeof spineDrawOrderOffsets>) => void;
}) {
  let order: string[];
  try { order = spineKeyDrawOrder(setup, value); }
  catch (error) { return <small role="alert" className="error">{validationMessage(error)}</small>; }
  const move = (index: number, direction: number) => {
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    change(spineDrawOrderOffsets(setup, order));
  };
  return <ol className="spine-draw-order">
    {order.map((slot, index) => <li key={slot}>
      <span>{slot}</span>
      <IconButton icon={ArrowUp} label={t('spineSlotEarlier', { slot })} disabled={disabled || !index} onClick={() => move(index, -1)} />
      <IconButton icon={ArrowDown} label={t('spineSlotLater', { slot })} disabled={disabled || index === order.length - 1} onClick={() => move(index, 1)} />
    </li>)}
  </ol>;
}
