import type { NetworkPlayer } from '@rewrite/multiplayer/contracts';
import { Box } from 'lucide-react';
import { ObjectPhysicsFields } from './PhysicsPanel';
import { hasPhysics, objectPhysicsSchema } from './physicsModel';
import { selectionTree } from './selection';
import { ObjectBehavior, ObjectScript } from './ScriptsPanel';
import { ParticlePresets } from './EmitterPresets';
import { ParticlePreview } from './ParticlePreview';
import type { ParticlePreset } from './particlePresets';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { screenAnchors } from '@olivestudio/engine/screen';
import { effectEntries } from '@olivestudio/engine';
import { cameraBlurFilters, CameraPostFXSchema, type CameraDepthBlur, type CameraPostFXData, type CameraPostFXType } from '@olivestudio/engine/runtime-camera';
import { alignments, directions, fits, justifications, objectPositions, overflows } from '@rewrite/layout/contracts';
import { blendModes } from '@rewrite/render-pixi/effects';
import { effectTypesFor, makeObjectEffect, type ObjectEffectData } from './objectEffects';
import { alternateTestZoom, type EffectPreview } from './effectPreview';
import { widgetGlobalType, widgetKinds, type WidgetData } from '@olivestudio/engine/widgets';
import type { Globals } from '@rewrite/interactions';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceBetween,
  AlignLeft, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceBetween, Anchor, AudioLines, Bold, Camera, ChevronRight, Contrast,
  Crosshair, Eye, Film, Fingerprint, FlipHorizontal2, FlipVertical2, Gauge, Globe, Headphones, Image, Lightbulb, Lock, LockOpen,
  Grid2X2, Monitor, Move, Network, Palette, Paintbrush, Play, Repeat, RotateCcw, RotateCw, Scaling, Shapes, Sparkles, Spline, Square, Table2, Tag,
  TextCursorInput, Trash2, Type, Volume2, type LucideIcon,
} from 'lucide-react';
import { audioBuses, audioRolloffs, type AudioTransport, type SourceStatus } from './audio';
import type { Asset } from './assets';
import { hint, IconButton } from './chrome';
import { objectTypeKey, t, type MessageKey } from './i18n';
import { isAnimationObject, type AnimationObject } from './sceneAnimation';
import type { AudioSourceObject, CameraObject, ParticleObject, SceneObject } from './scene';
import { objectAsset } from './assetLibrary';
import { TexturePicker } from './TexturePicker';
import { defaultFlexContainer, defaultFlexItem, type FlexContainer, type FlexItem } from './layout';
import type { Alignment } from './selection';
import { dropOne } from './valueDrag';

type Point = { x: number; y: number };
type Props = {
  node: SceneObject;
  roots: SceneObject[];
  topLevel: boolean;
  layoutChild: boolean;
  assets: Map<string, Asset>;
  textureErrors: ReadonlySet<string>;
  update: (change: (node: SceneObject) => SceneObject) => void;
  locked: boolean;
  inheritedLock: boolean;
  toggleLock: () => void;
  flip: (axis: 'x' | 'y') => void;
  pivotAt: (point: Point) => void;
  movementActions: readonly string[];
  globals: Globals['items'];
  physicsLayers: readonly string[];
  physicsFit: () => { width: number; height: number; offsetX: number; offsetY: number } | undefined;
  restartParticles: (id: string) => void;
  testEffect?: (effect: EffectPreview) => void;
  stopEffectTest: () => void;
  readOnly: boolean;
  audioStatus?: SourceStatus;
  audioEnabled: boolean;
  audioTransport: AudioTransport;
  playAudio: () => void;
  stopAudio: () => void;
  sectionHistory: Map<string, string>;
  particlePresets?: { items: ParticlePreset[]; change: (items: ParticlePreset[]) => void };
};

type DetailKey = { [Key in MessageKey]: `${Key}Hint` extends MessageKey ? Key : never }[MessageKey];

const busLabels = { music: 'audioBusMusic', sfx: 'audioBusEffects', ui: 'audioBusUI' } as const;
const sourceStatuses = { loading: 'audioLoading', playing: 'audioPlaying', paused: 'audioPaused', error: 'audioUnavailable' } as const;

function PropertyLabel({ title, icon: Icon }: { title: string; icon: LucideIcon }) {
  return <span className="property-label"><Icon size={14} aria-hidden="true" />
    <span>{title}</span>
  </span>;
}

function Section({ name, icon, initial = false, children, instance, title }: {
  name: DetailKey; icon: LucideIcon; initial?: boolean; children: ReactNode; instance?: string; title?: string;
}) {
  const [open, setOpen] = useState(initial);
  return <details data-inspector-section={name} data-inspector-effect={instance} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary aria-description={t(`${name}Hint`)} {...hint(title ?? t(name), t(`${name}Hint`))}>
      <ChevronRight className="disclosure" size={12} aria-hidden="true" /><PropertyLabel title={title ?? t(name)} icon={icon} />
    </summary>
    <div className="fields">{children}</div>
  </details>;
}

function Field({ name, icon, children, controlId, axis }: {
  name: DetailKey; icon: LucideIcon; children: ReactNode; controlId?: string; axis?: 'x' | 'y';
}) {
  const title = axis ? t('axis', { title: t(name), axis: axis.toUpperCase() }) : t(name);
  const label = <PropertyLabel title={title} icon={icon} />;
  const tooltip = hint(title, t(`${name}Hint`));
  if (controlId) return <div className="field" {...tooltip}><label htmlFor={controlId}>{label}</label><div className="field-value">{children}</div></div>;
  return <label className="field" {...tooltip}>{label}<span className="field-value">{children}</span></label>;
}

export function Numeric({ id, label, value, placeholder, commit, min, max, disabled, step = 'any' }: {
  id?: string; label?: string; value?: number; placeholder?: string; commit: (value: number) => void; min?: number; max?: number; disabled?: boolean; step?: 'any' | number;
}) {
  return <input id={id} type="number" aria-label={label} key={value} defaultValue={value} placeholder={placeholder} min={min} max={max} step={step} disabled={disabled}
    onBlur={event => {
      const input = event.currentTarget;
      if (input.value === '' || !input.validity.valid || !Number.isFinite(input.valueAsNumber)) input.value = value === undefined ? '' : String(value);
      else if (input.valueAsNumber !== value) commit(input.valueAsNumber);
    }}
    onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'Escape') {
        event.currentTarget.value = value === undefined ? '' : String(value);
        event.currentTarget.blur();
      }
    }} />;
}

function Coordinates({ name, icon, value, commit }: {
  name: DetailKey; icon: LucideIcon; value: Point; commit: (value: Point) => void;
}) {
  return (['x', 'y'] as const).map(axis => <Field key={axis} name={name} icon={icon} axis={axis}>
    <Numeric value={value[axis]} commit={next => commit({ ...value, [axis]: next })} />
  </Field>);
}

function ColorField({ name, icon, value, commit }: {
  name: DetailKey; icon: LucideIcon; value: string; commit: (value: string) => void;
}) {
  const id = useId();
  return <Field name={name} icon={icon} controlId={id}>
    <span className="inspector-color">
      <input id={id} type="color" value={value} onChange={event => commit(event.target.value)} />
      <code aria-hidden="true">{value.toUpperCase()}</code>
    </span>
  </Field>;
}

export function RequiredText({ value, commit, label }: { value: string; commit: (value: string) => void; label?: string }) {
  return <input key={value} aria-label={label} defaultValue={value} onBlur={event => {
    const next = event.currentTarget.value.trim();
    if (!next) event.currentTarget.value = value;
    else if (next !== value) commit(next);
  }} onKeyDown={event => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      event.currentTarget.value = value;
      event.currentTarget.blur();
    }
  }} />;
}

function AnimationFields({ node, assets, update }: Pick<Props, 'assets' | 'update'> & { node: AnimationObject }) {
  const asset = node.asset ? assets.get(node.asset) : undefined;
  const [details, setDetails] = useState<{ asset: Asset; animations: string[]; skins: string[] }>();
  const kind = node.type === 'Spine' ? 'spine' : 'sheet';

  useEffect(() => {
    if (!asset?.media || asset.kind !== kind) return;
    let active = true;
    void fetch(asset.url).then(response => response.json()).then(json => {
      if (!active) return;
      const animations = Object.keys(json.animations ?? {}).filter(name => kind === 'spine' || json.animations[name]?.length);
      const skins = kind === 'spine' && Array.isArray(json.skins) ?
        json.skins.flatMap((skin: { name?: unknown }) => typeof skin.name === 'string' ? [skin.name] : []) : [];
      setDetails({ asset, animations, skins });
    }).catch(() => {});
    return () => { active = false; };
  }, [asset, kind]);

  const assign = (alias: string | null) => update(object => {
    if (object.type === 'Spine') return { ...object, asset: alias, animation: null, skin: null };
    return object.type === 'AnimatedSprite' ? { ...object, asset: alias, animation: null } : object;
  });
  const playback = (patch: Partial<Pick<AnimationObject, 'animation' | 'playing' | 'loop' | 'speed'>>) =>
    update(object => isAnimationObject(object) ? { ...object, ...patch } : object);
  const { animations = [], skins = [] } = details?.asset === asset && details ? details : {};
  return <Section name="sceneAnimation" icon={Film} initial>
    <Field name="animationAsset" icon={Image}><select value={node.asset ?? ''} onChange={event => assign(event.target.value || null)}
      {...dropOne('asset', alias => alias !== node.asset && assets.get(alias)?.kind === kind, assign)}>
      <option value="">{t('chooseAnimationAsset')}</option>
      {node.asset && asset?.kind !== kind && <option value={node.asset}>{t('missingAssetOption', { alias: node.asset })}</option>}
      {Array.from(assets.values()).filter(item => item.kind === kind).map(item =>
        <option key={item.alias} value={item.alias} title={item.alias}>{item.name ?? item.alias}</option>)}
    </select></Field>
    {node.type === 'Spine' && <Field name="assetSkin" icon={Palette}>
      <select value={node.skin ?? ''} disabled={!skins.length} onChange={event => update(object =>
        object.type === 'Spine' ? { ...object, skin: event.target.value || null } : object)}>
        <option value="">{t('defaultSkin')}</option>
        {node.skin && !skins.includes(node.skin) && <option value={node.skin}>{node.skin}</option>}
        {skins.map(name => <option key={name}>{name}</option>)}
      </select>
    </Field>}
    <Field name="assetAnimation" icon={Film}>
      <select value={node.animation ?? ''} disabled={!animations.length}
        onChange={event => playback({ animation: event.target.value || null })}>
        <option value="">{t('defaultAnimation')}</option>
        {node.animation && !animations.includes(node.animation) && <option value={node.animation}>{node.animation}</option>}
        {animations.map(name => <option key={name}>{name}</option>)}
      </select>
    </Field>
    <Field name="playInScene" icon={Play}><input type="checkbox" checked={node.playing}
      onChange={event => playback({ playing: event.target.checked })} /></Field>
    <Field name="loopAnimation" icon={Repeat}><input type="checkbox" checked={node.loop}
      onChange={event => playback({ loop: event.target.checked })} /></Field>
    <NumberField name={node.type === 'Spine' ? 'playbackSpeed' : 'framesPerSecond'} icon={Gauge}
      value={node.speed} min={0.01} max={120} commit={speed => playback({ speed })} />
    {node.type === 'AnimatedSprite' && <Coordinates name="anchor" icon={Anchor} value={node.anchor} commit={anchor =>
      update(object => object.type === 'AnimatedSprite' ? { ...object, anchor } : object)} />}
  </Section>;
}

function NumberField({ name, value, commit, min, max, integer, icon = Scaling }: {
  name: DetailKey; value: number; commit: (value: number) => void; min?: number; max?: number; integer?: boolean; icon?: LucideIcon;
}) {
  const id = useId();
  const pointer = useRef<number | null>(null);
  const [draft, setDraft] = useState<number>();
  const numeric = <Numeric id={id} value={draft ?? value} min={min} max={max} step={integer ? 1 : 'any'} commit={commit} />;
  return <Field name={name} icon={icon} controlId={id}>
    {min !== undefined && max !== undefined ? <span className="inspector-range">
      <input type="range" aria-label={t(name)} min={min} max={max} step={integer ? 1 : 'any'} value={draft ?? value}
        onPointerDown={event => {
          if (event.button !== 0) return;
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onChange={event => {
          const next = event.currentTarget.valueAsNumber;
          if (pointer.current === null) commit(next);
          else setDraft(next);
        }}
        onPointerUp={event => {
          if (pointer.current !== event.pointerId) return;
          pointer.current = null;
          setDraft(undefined);
          if (event.currentTarget.valueAsNumber !== value) commit(event.currentTarget.valueAsNumber);
        }}
        onLostPointerCapture={() => {
          pointer.current = null;
          setDraft(undefined);
        }} />
      {numeric}
    </span> : numeric}
  </Field>;
}

function TilemapFields({ node, update }: Pick<Props, 'update'> & { node: Extract<SceneObject, { type: 'Tilemap' }> }) {
  const [invalid, setInvalid] = useState(false);
  const { columns, rows, tiles } = node;
  const text = tiles.join(', ');
  const resize = (width: number, height: number) => update(object => object.type !== 'Tilemap' ? object : {
    ...object, columns: width, rows: height,
    tiles: object.tiles.length ? Array.from({ length: width * height }, (_, index) => {
      const x = index % width;
      const y = Math.floor(index / width);
      return x < columns && y < rows ? tiles[y * columns + x] ?? -1 : -1;
    }) : [],
  });
  const size = (key: 'tileWidth' | 'tileHeight', value: number) =>
    update(object => object.type === 'Tilemap' ? { ...object, [key]: value } : object);
  return <Section name="tileGrid" icon={Table2} initial>
    <NumberField name="columns" integer min={1} max={32} value={columns} commit={value => resize(value, rows)} />
    <NumberField name="rows" integer min={1} max={32} value={rows} commit={value => resize(columns, value)} />
    <NumberField name="tileWidth" integer min={1} max={1024} value={node.tileWidth} commit={value => size('tileWidth', value)} />
    <NumberField name="tileHeight" integer min={1} max={1024} value={node.tileHeight} commit={value => size('tileHeight', value)} />
    <Field name="tileCollision" icon={Box}>
      <select aria-label={t('tileCollision')} value={node.collision ?? 'none'} onChange={event => {
        const collision = event.target.value === 'solid' ? 'solid' : 'none';
        update(object => object.type === 'Tilemap' ? { ...object, collision } : object);
      }}>
        <option value="none">{t('physics_noBody')}</option>
        <option value="solid">{t('physics_solid')}</option>
      </select>
    </Field>
    <Field name="tileIndices" icon={Table2}>
      <textarea key={text} defaultValue={text} placeholder={t('tileIndicesPlaceholder')} onChange={() => setInvalid(false)} onBlur={event => {
        const input = event.currentTarget;
        if (input.value === text) return;
        const values = input.value.trim().split(/[\s,]+/).filter(Boolean).map(Number);
        if (values.length > columns * rows || values.some(value => !Number.isInteger(value) || value < -1 || value > 65535)) {
          setInvalid(true);
          input.value = text;
        } else {
          input.value = values.join(', ');
          if (input.value !== text) update(object => object.type === 'Tilemap' ? { ...object, tiles: values } : object);
        }
      }} />
    </Field>
    {invalid && <small className="error" role="status">{t('tileCellCount')}</small>}
  </Section>;
}

type ParticleNumberKey = { [Key in keyof ParticleObject]: ParticleObject[Key] extends number ? Key : never }[keyof ParticleObject];

function ParticleFields({ node, update, restartParticles, particlePresets, assets }: Pick<Props, 'update' | 'restartParticles' | 'particlePresets' | 'assets'> & { node: ParticleObject }) {
  const [preview, showPreview] = useState(false);
  const change = (patch: Partial<Omit<ParticleObject, 'type'>>) => update(object =>
    object.type === 'Particles' ? { ...object, ...patch } : object);
  const numeric = (name: ParticleNumberKey & DetailKey, min?: number, max?: number, integer = false) =>
    <NumberField name={name} value={node[name]} min={min} max={max} integer={integer}
      commit={value => change({ [name]: value })} />;
  return <>
    <Section name="emission" icon={Sparkles} initial>
      <Field name="playInScene" icon={Play}><input type="checkbox" checked={node.playing}
        onChange={event => change({ playing: event.target.checked })} /></Field>
      <IconButton icon={RotateCcw} label={t('restartParticles')} description={t('restartParticlesHint')}
        disabled={!node.playing} onClick={() => restartParticles(node.id)} />
      <Field name="emissionMode" icon={Repeat}>
        <select value={node.emission} onChange={event => change({ emission: event.target.value === 'burst' ? 'burst' : 'continuous' })}>
          <option value="continuous">{t('continuousEmission')}</option><option value="burst">{t('burstEmission')}</option>
        </select>
      </Field>
      {numeric('count', 1, 500, true)}
      {numeric('lifetime', 0.01, 30)}
      {numeric('lifetimeVariance', 0, 0.99)}
      {node.emission === 'continuous' && numeric('frequency', 0, 30)}
      {numeric('waveSize', 0, 500, true)}
      {numeric('spawnChance', 0, 1)}
    </Section>
    <Section name="particleSpawn" icon={Crosshair}>
      <Field name="spawnShape" icon={Shapes}><select value={node.spawnShape} onChange={event => {
        const value = event.target.value;
        if (value === 'point' || value === 'circle' || value === 'rectangle') change({ spawnShape: value });
      }}><option value="point">{t('spawnPoint')}</option><option value="circle">{t('spawnCircle')}</option>
        <option value="rectangle">{t('rectangle')}</option></select></Field>
      {node.spawnShape === 'circle' && numeric('spawnRadius', 1, 1024)}
      {node.spawnShape === 'rectangle' && <>{numeric('spawnWidth', 1, 2048)}{numeric('spawnHeight', 1, 2048)}</>}
    </Section>
    <Section name="particleMotion" icon={Move}>
      {numeric('speed', 0, 1000)}
      {numeric('speedVariance', 0, 1)}
      {numeric('direction')}
      {numeric('spread', 0, 360)}
      {numeric('gravity', -2000, 2000)}
      {numeric('rotationSpeed', -3600, 3600)}
    </Section>
    <Section name="particleAppearance" icon={Palette}>
      {numeric('size', 0.01, 256)}
      {numeric('sizeVariance', 0, 1)}
      {numeric('endScale', 0, 8)}
      {numeric('startAlpha', 0, 1)}
      {numeric('endAlpha', 0, 1)}
      <ColorField name="startColor" icon={Palette} value={node.startColor} commit={startColor => change({ startColor })} />
      <ColorField name="endColor" icon={Palette} value={node.endColor} commit={endColor => change({ endColor })} />
    </Section>
    {particlePresets && <Section name="particlePresets" icon={Sparkles}>
      <ParticlePresets key={node.id} node={node} {...particlePresets} apply={change} />
    </Section>}
    <details data-inspector-section="particlePreview" onToggle={event => showPreview(event.currentTarget.open)}>
      <summary>{t('particlePreview')}</summary>
      {preview && <ParticlePreview node={node} texture={node.texture ? assets.get(node.texture)?.url : undefined} />}
    </details>
  </>;
}

function AudioSourceFields({ node, assets, update, audioStatus, audioEnabled, audioTransport, playAudio, stopAudio }: {
  node: AudioSourceObject;
} & Pick<Props, 'assets' | 'update' | 'audioStatus' | 'audioEnabled' | 'audioTransport' | 'playAudio' | 'stopAudio'>) {
  const change = (patch: Partial<Omit<AudioSourceObject, 'type'>>) =>
    update(object => object.type === 'AudioSource' ? { ...object, ...patch } : object);
  const missing = node.asset && assets.get(node.asset)?.kind !== 'audio';
  const playing = audioStatus?.state === 'playing' || audioStatus?.state === 'loading' || audioStatus?.state === 'paused';
  return <>
    <Section name="audioSourceSettings" icon={Volume2} initial>
      <Field name="audioClip" icon={AudioLines}>
        <select value={node.asset ?? ''} onChange={event => change({ asset: event.target.value || null })}
          {...dropOne('asset', alias => alias !== node.asset && assets.get(alias)?.kind === 'audio', asset => change({ asset }))}>
          <option value="">{t('audioNoClip')}</option>
          {missing && <option value={node.asset!}>{t('missingAssetOption', { alias: node.asset! })}</option>}
          {Array.from(assets.values()).filter(asset => asset.kind === 'audio').map(asset =>
            <option key={asset.alias} value={asset.alias} title={asset.alias}>{asset.name ?? asset.alias}</option>)}
        </select>
      </Field>
      <div className="panel-tools audio-source-controls" role="group" aria-label={t('audioSourcePlayback')}>
        <IconButton icon={Play} label={t('audioPlaySource')} description={t('audioPlaySourceHint')} onClick={playAudio}
          disabled={!node.asset || !!missing || !audioEnabled || audioTransport === 'paused' || (playing && (node.loop || node.voiceLimit === 1))} />
        <IconButton icon={Square} label={t('audioStopSource')} description={t('audioStopSourceHint')} onClick={stopAudio} disabled={!playing} />
        {audioStatus && <span role="status">{audioStatus.message ?? t(sourceStatuses[audioStatus.state])}</span>}
      </div>
      <Field name="audioEnabled" icon={Eye}><input type="checkbox" checked={node.visible}
        onChange={event => change({ visible: event.target.checked })} /></Field>
      <NumberField name="audioVolume" icon={Volume2} value={node.volume} min={0} max={1} commit={volume => change({ volume })} />
      <NumberField name="audioRate" icon={Gauge} value={node.rate} min={0.25} max={4} commit={rate => change({ rate })} />
      <Field name="audioAutoplay" icon={Play}><input type="checkbox" checked={node.autoplay}
        onChange={event => change({ autoplay: event.target.checked })} /></Field>
      <Field name="audioLoop" icon={Repeat}><input type="checkbox" checked={node.loop}
        onChange={event => change({ loop: event.target.checked })} /></Field>
      {!node.loop && <NumberField name="audioVoiceLimit" icon={AudioLines} value={node.voiceLimit} min={1} max={16} integer
        commit={voiceLimit => change({ voiceLimit })} />}
      <Field name="audioBus" icon={AudioLines}>
        <select value={node.bus} onChange={event => {
          const bus = audioBuses.find(value => value === event.target.value);
          if (bus) change({ bus });
        }}>
          {audioBuses.map(bus => <option key={bus} value={bus}>{t(busLabels[bus])}</option>)}
        </select>
      </Field>
      <NumberField name="audioPan" icon={Headphones} value={node.pan} min={-1} max={1} commit={pan => change({ pan })} />
    </Section>
    <Section name="audioSpatialSettings" icon={Headphones} initial>
      <Field name="audioSpatial" icon={Crosshair}><input type="checkbox" checked={node.spatial}
        onChange={event => change({ spatial: event.target.checked })} /></Field>
      {node.spatial && <>
        <NumberField name="audioMinDistance" value={node.minDistance} min={0} icon={Crosshair}
          commit={distance => change({ minDistance: Math.min(distance, node.maxDistance - 1) })} />
        <NumberField name="audioMaxDistance" value={node.maxDistance} min={1} icon={Crosshair}
          commit={distance => change({ maxDistance: Math.min(100000, Math.max(node.minDistance + 1, distance)) })} />
        <Field name="audioRolloff" icon={Gauge}>
          <select value={node.rolloff} onChange={event => {
            const rolloff = audioRolloffs.find(value => value === event.target.value);
            if (rolloff) change({ rolloff });
          }}>
            {audioRolloffs.map(rolloff => <option key={rolloff} value={rolloff}>{t(`audioRolloff_${rolloff}`)}</option>)}
          </select>
        </Field>
        <NumberField name="audioPanAmount" icon={Headphones} value={node.panAmount} min={0} max={1} commit={panAmount => change({ panAmount })} />
      </>}
    </Section>
  </>;
}

function NetworkFields({ player, actions, update }: {
  player: NetworkPlayer; actions: readonly string[]; update: Props['update'];
}) {
  const patch = (value: Partial<NetworkPlayer>) => update(node => ({ ...node, networkPlayer: { ...player, ...value } }));
  return <Section name="networkPlayerSettings" icon={Network} initial>
    <NumberField name="networkSpeed" value={player.speed} min={1} max={2000} commit={speed => patch({ speed })} />
    {(['left', 'right', 'up', 'down'] as const).map(key => <Field key={key} name={`networkMove_${key}`} icon={Move}>
      <select value={player[key]} onChange={event => patch({ [key]: event.target.value })}>
        <option value="">{t('networkNoAction')}</option>
        {actions.map(action => <option key={action} value={action}>{action}</option>)}
        {!!player[key] && !actions.includes(player[key]) && <option value={player[key]}>{player[key]}</option>}
      </select>
    </Field>)}
    <button type="button" onClick={() => update(node => {
      const { networkPlayer: _player, ...other } = node;
      return other;
    })}>{t('networkRemoveTemplate')}</button>
  </Section>;
}

function LightFields({ node, inWorld, update }: Pick<Props, 'update'> & { node: Extract<SceneObject, { type: 'Light2D' }>; inWorld: boolean }) {
  const change = (patch: Partial<typeof node.light>) =>
    update(object => object.type === 'Light2D' ? { ...object, light: { ...object.light, ...patch } } : object);
  return <Section name="lightSettings" icon={Lightbulb} initial>
    {!inWorld && <small>{t('lightHudNotice')}</small>}
    <ColorField name="lightColor" icon={Palette} value={node.light.color} commit={color => change({ color })} />
    <NumberField name="lightRadius" icon={Scaling} min={1} max={5000} value={node.light.radius}
      commit={radius => change({ radius })} />
    <NumberField name="lightIntensity" icon={Gauge} min={0} max={1} value={node.light.intensity}
      commit={intensity => change({ intensity })} />
    <NumberField name="lightFlicker" icon={Sparkles} min={0} max={1} value={node.light.flicker}
      commit={flicker => change({ flicker })} />
    <Field name="lightShadows" icon={Shapes}><input type="checkbox" checked={node.light.shadows}
      onChange={event => change({ shadows: event.target.checked })} /></Field>
  </Section>;
}

const cameraEffectNames = {
  perspective: 'cameraPerspective', depth: 'cameraDepth', curve: 'cameraCurve', shake: 'cameraShake',
  zoom: 'cameraZoomEffect', limits: 'cameraLimits',
} satisfies Record<CameraPostFXType, DetailKey>;
const cameraEffectTypes = Object.keys(cameraEffectNames) as CameraPostFXType[];

function EffectList<K extends string, T extends { type: K; enabled: boolean; effectId?: string }>({
  effects, types, names, create, change, fields, preview, readOnly,
}: {
  effects: readonly T[]; types: readonly K[]; names: Record<K, DetailKey>;
  readOnly: boolean; preview?: (effect: T) => ReactNode;
  create: (type: K) => T; change: (effects: T[]) => void; fields: (effect: T, replace: (effect: T) => void) => ReactNode;
}) {
  return <Section name="objectEffects" icon={Sparkles} initial>
    <Field name="effectAdd" icon={Sparkles}>
      <select value="" disabled={readOnly || !types.length} onChange={event => {
        const type = types.find(type => type === event.currentTarget.value);
        if (type) change([...effects, { ...create(type), effectId: crypto.randomUUID() }]);
      }}>
        <option value="">{t('effectChoose')}</option>
        {types.map(type => <option value={type} key={type}>{t(names[type])}</option>)}
      </select>
    </Field>
    {effectEntries(effects).map(({ effect, key, occurrence }, index) => {
      const name = names[effect.type];
      const title = occurrence === 1 ? t(name) : t('effectInstance', { name: t(name), number: occurrence });
      const replace = (next: T) => change(effects.map((item, i) => i === index ? next : item));
      return <Section name={name} icon={Sparkles} key={key} instance={key} title={title}>
        <Field name="effectEnabled" icon={Eye}>
          <input type="checkbox" checked={effect.enabled} disabled={readOnly} onChange={event => replace({ ...effect, enabled: event.currentTarget.checked })} />
        </Field>
        <fieldset className="fields effect-fields" disabled={readOnly || !effect.enabled}>{fields(effect, replace)}</fieldset>
        {effect.enabled && preview?.(effect)}
        <div className="panel-tools"><IconButton icon={Trash2} label={t('effectRemove', { name: title })} disabled={readOnly}
          onClick={() => change(effects.filter((_, i) => i !== index))} /></div>
      </Section>;
    })}
  </Section>;
}

const cameraBlurLabels = {
  none: 'cameraBlurNone', gaussian: 'cameraBlurGaussian', kawase: 'cameraBlurKawase', motion: 'cameraBlurMotion',
} satisfies Record<CameraDepthBlur['filter'], MessageKey>;

function CameraFields({ node, roots, update }: Pick<Props, 'roots' | 'update'> & { node: CameraObject }) {
  const { camera } = node;
  function candidates(items: SceneObject[]): SceneObject[] {
    return items.flatMap(item => item.screenSpace || item.id === node.id ? [] :
      [item, ...(item.type === 'Container' ? candidates(item.children) : [])]);
  }
  const objects = candidates(roots);
  const change = (patch: Partial<CameraObject['camera']>) => update(object =>
    object.type === 'Camera2D' ? { ...object, camera: { ...object.camera, ...patch } } : object);
  const numeric = (property: 'offsetX' | 'offsetY' | 'smoothing' | 'deadzoneWidth' | 'deadzoneHeight',
    name: DetailKey, min: number, max: number) => <NumberField name={name} value={camera[property]} min={min} max={max}
      commit={value => change({ [property]: value })} />;
  return <>
    <Section name="cameraSettings" icon={Camera} initial>
      <Field name="cameraViewportRelative" icon={Monitor}><input type="checkbox" checked={camera.viewportRelative ?? false}
        onChange={event => change({ viewportRelative: event.target.checked })} /></Field>
      <Field name="cameraRotate" icon={RotateCw}><input type="checkbox" checked={camera.rotate}
        onChange={event => change({ rotate: event.target.checked })} /></Field>
      <Field name="cameraTarget" icon={Crosshair}><select value={camera.target} onChange={event => change({ target: event.target.value })}
        {...dropOne('object', id => id !== camera.target && objects.some(item => item.id === id), target => change({ target }))}>
        <option value="">{t('cameraNoTarget')}</option>
        {camera.target && !objects.some(item => item.id === camera.target) && <option value={camera.target}>{t('cameraMissingTarget')}</option>}
        {objects.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></Field>
      {camera.target && <>
        {numeric('offsetX', 'cameraOffsetX', -100000, 100000)}
        {numeric('offsetY', 'cameraOffsetY', -100000, 100000)}
        {numeric('smoothing', 'cameraSmoothing', 0, 60)}
        {numeric('deadzoneWidth', 'cameraDeadzoneWidth', 0, 100000)}
        {numeric('deadzoneHeight', 'cameraDeadzoneHeight', 0, 100000)}
        <Field name="cameraKeepInView" icon={Crosshair}><input type="checkbox" checked={camera.keepInView ?? false}
          onChange={event => change({ keepInView: event.currentTarget.checked })} /></Field>
        {camera.keepInView && <NumberField name="cameraSafeMargin" value={camera.safeMargin ?? 0} min={0} max={1000}
          commit={safeMargin => change({ safeMargin })} />}
      </>}
    </Section>
  </>;
}

function CameraEffects({ node, update, testEffect, stopEffectTest, readOnly }:
  Pick<Props, 'update' | 'testEffect' | 'stopEffectTest' | 'readOnly'> & { node: CameraObject }) {
  return <EffectList readOnly={readOnly} effects={node.camera.postFXs ?? []} types={cameraEffectTypes} names={cameraEffectNames}
      create={type => CameraPostFXSchema.parse({ type })}
      change={postFXs => update(item => item.type === 'Camera2D' ?
        { ...item, camera: { ...item.camera, postFXs: postFXs.length ? postFXs : undefined } } : item)}
      fields={cameraEffectFields} preview={effect => <>
        {effect.type === 'shake' && testEffect && <EffectTestForm
          key={JSON.stringify(effect)} stop={stopEffectTest} play={values => testEffect({
            type: 'shake', id: node.id, amplitude: Number(values.get('amplitude')), duration: Number(values.get('duration')),
            rotation: Number(values.get('rotation')),
          })}>
          <EffectTestNumber name="testShakeStrength" field="amplitude" value={effect.amplitude} min={0} max={500} />
          <EffectTestNumber name="testEffectDuration" field="duration" value={effect.duration} min={0.05} max={10} />
          <EffectTestNumber name="testShakeRotation" field="rotation" value={effect.rotation} min={0} max={90} />
        </EffectTestForm>}
        {effect.type === 'zoom' && testEffect && (effect.min < effect.max ? <EffectTestForm key={JSON.stringify(effect)} stop={stopEffectTest}
          play={values => testEffect({ type: 'zoom', id: node.id, zoom: Number(values.get('zoom')), min: effect.min, max: effect.max,
            duration: Number(values.get('duration')) })}>
          <EffectTestNumber name="testCameraZoom" field="zoom"
            value={alternateTestZoom(Math.max(effect.min, Math.min(effect.max, effect.value)), effect.min, effect.max)}
            min={effect.min} max={effect.max} />
          <EffectTestNumber name="testEffectDuration" field="duration" value={2} min={0.1} max={10} />
        </EffectTestForm> : <p className="empty">{t('testZoomFixedRange')}</p>)}
      </>} />;
}

function EffectTestNumber({ name, field, value, min, max }: {
  name: DetailKey; field: string; value: number; min: number; max: number;
}) {
  return <Field name={name} icon={Gauge}>
    <input type="number" name={field} defaultValue={value} min={min} max={max} step="any" required />
  </Field>;
}

function EffectTestForm({ children, play, stop }: { children: ReactNode; play: (values: FormData) => void; stop: () => void }) {
  return <form className="effect-test" aria-label={t('effectTest')} onSubmit={event => {
    event.preventDefault();
    play(new FormData(event.currentTarget));
  }}>
    <span className="property-label">{t('effectTest')}</span>
    {children}
    <div className="panel-tools">
      <IconButton type="submit" icon={Play} label={t('runEffectTest')} description={t('runEffectTestHint')} />
      <IconButton icon={Square} label={t('stopEffectTest')} onClick={stop} />
    </div>
  </form>;
}

function cameraEffectFields(effect: CameraPostFXData, replace: (effect: CameraPostFXData) => void) {
  switch (effect.type) {
    case 'perspective': return <>
      <NumberField name="cameraPerspectiveScale" value={effect.scale} min={0} max={100} integer
        commit={scale => replace({ ...effect, scale })} />
      <NumberField name="cameraPerspectiveDistance" icon={Move} value={effect.distance} min={0} max={240} integer
        commit={distance => replace({ ...effect, distance })} />
      <NumberField name="cameraPerspectiveZIndex" icon={Box} value={effect.zIndex} min={-32} max={32} integer
        commit={zIndex => replace({ ...effect, zIndex })} />
    </>;
    case 'depth': return <>
      <Field name="cameraDepthFilter" icon={Eye}>
        <select value={effect.filter} onChange={event => {
          const filter = cameraBlurFilters.find(value => value === event.currentTarget.value);
          if (filter) replace({ ...effect, filter });
        }}>
          {cameraBlurFilters.map(filter => <option key={filter} value={filter}>{t(cameraBlurLabels[filter])}</option>)}
        </select>
      </Field>
      {effect.filter !== 'none' && <NumberField name="cameraDepthStrength" icon={Gauge} value={effect.strength} min={0} max={100} integer
        commit={strength => replace({ ...effect, strength })} />}
    </>;
    case 'curve': return <>
      <NumberField name="cameraCurveAngle" icon={RotateCw} value={effect.angle} min={0} max={90} integer
        commit={angle => replace({ ...effect, angle })} />
      <Field name="cameraCurveDirection" icon={Spline}>
        <select value={effect.direction}
          onChange={event => replace({ ...effect, direction: event.currentTarget.value === 'convex' ? 'convex' : 'concave' })}>
          <option value="concave">{t('cameraCurveConcave')}</option>
          <option value="convex">{t('cameraCurveConvex')}</option>
        </select>
      </Field>
    </>;
    case 'shake': return <>
      <NumberField name="cameraShakeAmplitude" value={effect.amplitude} min={0} max={500}
        commit={amplitude => replace({ ...effect, amplitude })} />
      <NumberField name="cameraShakeDuration" value={effect.duration} min={0.05} max={10}
        commit={duration => replace({ ...effect, duration })} />
      <NumberField name="cameraShakeRotation" value={effect.rotation} min={0} max={90}
        commit={rotation => replace({ ...effect, rotation })} />
    </>;
    case 'zoom': return <>
      <NumberField name="cameraZoom" value={Math.max(effect.min, Math.min(effect.max, effect.value))}
        min={effect.min} max={Math.max(effect.min, effect.max)} commit={value => replace({ ...effect, value })} />
      <NumberField name="cameraMinZoom" value={effect.min} min={0.05} max={Math.max(effect.min, effect.max)}
        commit={min => replace({ ...effect, min, value: Math.max(min, effect.value) })} />
      <NumberField name="cameraMaxZoom" value={effect.max} min={effect.min} max={20}
        commit={max => replace({ ...effect, max, value: Math.min(max, effect.value) })} />
    </>;
    case 'limits': return <>
      <Field name="cameraLimitMode" icon={Scaling}>
        <select value={effect.mode} onChange={event => replace({ ...effect,
          mode: event.currentTarget.value === 'world' ? 'world' : 'rectangle' })}>
          <option value="rectangle">{t('cameraLimitRectangle')}</option>
          <option value="world">{t('cameraLimitWorld')}</option>
        </select>
      </Field>
      {effect.mode === 'rectangle' && ([
        ['left', 'cameraLimitLeft'], ['top', 'cameraLimitTop'], ['right', 'cameraLimitRight'], ['bottom', 'cameraLimitBottom'],
      ] as const).map(([key, name]) => <NumberField key={key} name={name} value={effect[key]} min={-1e6} max={1e6}
        commit={value => replace({ ...effect, [key]: value })} />)}
    </>;
  }
}

function HUDFields({ node, update }: Pick<Props, 'node' | 'update'>) {
  return <Section name="hudSettings" icon={Monitor} initial={!!node.screenSpace}>
    <Field name="hudEnabled" icon={Monitor}><input type="checkbox" checked={!!node.screenSpace} onChange={event => {
      const enabled = event.target.checked;
      update(object => ({ ...object, screenSpace: enabled ? { anchor: 'top-left' } : undefined }));
    }} /></Field>
    {node.screenSpace && <Field name="hudAnchor" icon={Anchor}>
      <select value={node.screenSpace.anchor} onChange={event => {
        const anchor = screenAnchors.find(item => item === event.target.value);
        if (anchor) update(object => ({ ...object, screenSpace: { anchor } }));
      }}>{screenAnchors.map(anchor => <option key={anchor} value={anchor}>{t(`hudAnchor_${anchor}`)}</option>)}</select>
    </Field>}
  </Section>;
}

type FlexOption = FlexContainer['direction'] | FlexContainer['justify'] | FlexContainer['align'] |
  FlexItem['alignSelf'] | FlexItem['fit'] | FlexItem['position'] | typeof overflows[number] | typeof objectPositions[number] | 'px' | '%';
const flexOptionLabel = (choice: FlexOption) => t(choice === '%' ? 'flexOption_percent' : `flexOption_${choice}`);

function FlexChoice<Value extends FlexOption>({ name, value, choices, change }: {
  name: DetailKey; value: Value; choices: readonly Value[]; change: (value: Value) => void;
}) {
  return <Field name={name} icon={Grid2X2}><select value={value} onChange={event => {
    const next = choices.find(choice => choice === event.target.value);
    if (next) change(next);
  }}>
    {choices.map(choice => <option key={choice} value={choice}>{flexOptionLabel(choice)}</option>)}
  </select></Field>;
}

const lengthAxes = ['width', 'height'] as const;
function LayoutDimensions({ layout, change }: {
  layout: Pick<FlexContainer, 'width' | 'height' | 'widthUnit' | 'heightUnit'>;
  change: (patch: Partial<Pick<FlexContainer, 'width' | 'height' | 'widthUnit' | 'heightUnit'>>) => void;
}) {
  return lengthAxes.map(axis => {
    const unit = `${axis}Unit` as const;
    return <div className="flex-dimension" key={axis}>
      <Field name={axis === 'width' ? 'flexWidth' : 'flexHeight'} icon={Scaling}><Numeric value={layout[axis]}
        min={0} max={layout[unit] === '%' ? 100 : 10000} commit={value => change({ [axis]: value })} /></Field>
      <FlexChoice name={axis === 'width' ? 'flexWidthUnit' : 'flexHeightUnit'} value={layout[unit]} choices={['px', '%']}
        change={value => change({ [unit]: value, [axis]: value === '%' ? Math.min(100, layout[axis]) : layout[axis] })} />
    </div>;
  });
}

function LayoutContainerFields({ node, update }: Pick<Props, 'update'> & { node: Extract<SceneObject, { type: 'Container' }> }) {
  const layout = node.layout;
  const change = (patch: Partial<FlexContainer>) => update(item => item.type === 'Container' && item.layout ?
    { ...item, layout: { ...item.layout, ...patch } } : item);
  return <Section name="flexContainer" icon={Grid2X2} initial={!!layout}>
    <Field name="flexEnabled" icon={Grid2X2}><input type="checkbox" checked={!!layout} onChange={event => {
      const enabled = event.target.checked;
      update(item => item.type === 'Container' ? { ...item, layout: enabled ? defaultFlexContainer() : undefined } : item);
    }} /></Field>
    {layout && <>
      <FlexChoice name="flexDirection" value={layout.direction} choices={directions} change={direction => change({ direction })} />
      <FlexChoice name="flexJustify" value={layout.justify} choices={justifications} change={justify => change({ justify })} />
      <FlexChoice name="flexAlign" value={layout.align} choices={alignments} change={align => change({ align })} />
      <Field name="flexWrap" icon={Repeat}><input type="checkbox" checked={layout.wrap}
        onChange={event => change({ wrap: event.target.checked })} /></Field>
      <LayoutDimensions layout={layout} change={change} />
      <NumberField name="flexGap" value={layout.gap} min={0} max={2000} commit={gap => change({ gap })} />
      <NumberField name="flexPadding" value={layout.padding} min={0} max={2000} commit={padding => change({ padding })} />
      <NumberField name="flexAnchorX" value={layout.anchorX} min={0} max={1} commit={anchorX => change({ anchorX })} />
      <NumberField name="flexAnchorY" value={layout.anchorY} min={0} max={1} commit={anchorY => change({ anchorY })} />
      <ColorField name="flexBackground" icon={Palette} value={layout.background} commit={background => change({ background })} />
      <NumberField name="flexBackgroundAlpha" value={layout.backgroundAlpha} min={0} max={1} commit={backgroundAlpha => change({ backgroundAlpha })} />
      <NumberField name="flexBorderWidth" value={layout.borderWidth} min={0} max={200} commit={borderWidth => change({ borderWidth })} />
      {layout.borderWidth > 0 && <ColorField name="flexBorderColor" icon={Palette} value={layout.borderColor} commit={borderColor => change({ borderColor })} />}
      <NumberField name="flexCornerRadius" value={layout.borderRadius} min={0} max={2000} commit={borderRadius => change({ borderRadius })} />
      <FlexChoice name="flexOverflow" value={layout.overflow ?? (layout.clip ? 'hidden' : 'visible')} choices={overflows}
        change={overflow => change({ overflow, clip: overflow === 'hidden' })} />
    </>}
  </Section>;
}

function LayoutItemFields({ node, update }: Pick<Props, 'node' | 'update'>) {
  const layout = node.layoutItem ?? defaultFlexItem();
  const change = (patch: Partial<FlexItem>) => update(item => ({ ...item, layoutItem: { ...layout, ...patch } }));
  return <Section name="flexItem" icon={Grid2X2} initial>
    <FlexChoice name="flexPosition" value={layout.position} choices={['flow', 'absolute']} change={position => change({ position })} />
    {layout.position === 'absolute' ? <>
      <Field name="flexLeft" icon={Move}><Numeric value={layout.left} min={-10000} max={10000} commit={left => change({ left })} /></Field>
      <Field name="flexTop" icon={Move}><Numeric value={layout.top} min={-10000} max={10000} commit={top => change({ top })} /></Field>
    </> : <>
      <NumberField name="flexGrow" value={layout.grow} min={0} max={100} commit={grow => change({ grow })} />
      <NumberField name="flexShrink" value={layout.shrink} min={0} max={100} commit={shrink => change({ shrink })} />
      <FlexChoice name="flexAlignSelf" value={layout.alignSelf} choices={['auto', ...alignments]} change={alignSelf => change({ alignSelf })} />
    </>}
    <LayoutDimensions layout={layout} change={change} />
    <Field name="flexMargin" icon={Scaling}><Numeric value={layout.margin} min={-2000} max={2000} commit={margin => change({ margin })} /></Field>
    <FlexChoice name="flexFit" value={layout.fit} choices={fits} change={fit => change({ fit })} />
    <FlexChoice name="flexObjectPosition" value={layout.objectPosition ?? 'center'} choices={objectPositions}
      change={objectPosition => change({ objectPosition })} />
  </Section>;
}

const objectEffectNames = {
  blend: 'effectBlend', color: 'effectColor', blur: 'effectBlur', outline: 'effectOutline', glow: 'effectGlow',
  shadow: 'effectShadow', pixelate: 'effectPixelate', noise: 'effectNoise',
  audioGain: 'effectAudioGain', listenerOffset: 'effectListenerOffset', lightPulse: 'effectLightPulse',
} satisfies Record<ObjectEffectData['type'], DetailKey>;

function EffectsFields({ node, update, testEffect, stopEffectTest, readOnly }: Pick<Props, 'node' | 'update' | 'testEffect' | 'stopEffectTest' | 'readOnly'>) {
  const types = effectTypesFor(node.type);
  return <EffectList readOnly={readOnly} effects={node.effects ?? []} types={types} names={objectEffectNames} create={makeObjectEffect}
    change={effects => update(item => ({ ...item, effects: effects.length ? effects : undefined }))}
    fields={objectEffectFields} preview={effect => effect.type === 'lightPulse' && testEffect && <EffectTestForm stop={stopEffectTest}
        play={values => testEffect({ type: 'lightPulse', id: node.id, amount: effect.amount, frequency: effect.frequency,
          duration: Number(values.get('duration')) })}>
        <EffectTestNumber name="testEffectDuration" field="duration" value={Math.min(10, Math.max(2, 2 / effect.frequency))}
          min={0.1} max={10} />
      </EffectTestForm>} />;
}

function objectEffectFields(effect: ObjectEffectData, replace: (effect: ObjectEffectData) => void) {
  if (!('settings' in effect)) {
    switch (effect.type) {
      case 'audioGain': return <NumberField name="effectGain" value={effect.gain} min={0} max={4}
        commit={gain => replace({ ...effect, gain })} />;
      case 'listenerOffset': return <>
        <NumberField name="effectOffsetX" value={effect.x} min={-1000} max={1000} commit={x => replace({ ...effect, x })} />
        <NumberField name="effectOffsetY" value={effect.y} min={-1000} max={1000} commit={y => replace({ ...effect, y })} />
      </>;
      case 'lightPulse': return <>
        <NumberField name="effectPulseAmount" value={effect.amount} min={0} max={1} commit={amount => replace({ ...effect, amount })} />
        <NumberField name="effectPulseFrequency" value={effect.frequency} min={0.1} max={10} commit={frequency => replace({ ...effect, frequency })} />
      </>;
    }
  }
  switch (effect.type) {
    case 'blend': return <Field name="effectsBlend" icon={Palette}>
      <select value={effect.settings.blendMode} onChange={event => {
        const blendMode = blendModes.find(mode => mode === event.currentTarget.value);
        if (blendMode) replace({ ...effect, settings: { blendMode } });
      }}>
        {blendModes.map(mode => <option key={mode} value={mode}>{t(`blendMode_${mode}`)}</option>)}
      </select>
    </Field>;
    case 'color': return ([
      ['brightness', 0, 3], ['contrast', 0, 3], ['saturation', 0, 3], ['hue', -180, 180],
    ] as const).map(([field, min, max]) => <NumberField key={field} name={`effect_${field}`}
      value={effect.settings[field]} min={min} max={max}
      commit={value => replace({ ...effect, settings: { ...effect.settings, [field]: value } })} />);
    case 'blur': return <NumberField name="effect_blur" value={effect.settings.blur} min={0} max={100}
      commit={blur => replace({ ...effect, settings: { blur } })} />;
    case 'pixelate': return <NumberField name="effect_pixelate" value={effect.settings.pixelate} min={0} max={256}
      commit={pixelate => replace({ ...effect, settings: { pixelate } })} />;
    case 'noise': return <NumberField name="effect_noise" value={effect.settings.noise} min={0} max={1}
      commit={noise => replace({ ...effect, settings: { noise } })} />;
    case 'outline': return <>
      <NumberField name="effect_outlineWidth" value={effect.settings.outlineWidth} min={0} max={32}
        commit={outlineWidth => replace({ ...effect, settings: { ...effect.settings, outlineWidth } })} />
      <ColorField name="effect_outlineColor" icon={Palette} value={effect.settings.outlineColor}
        commit={outlineColor => replace({ ...effect, settings: { ...effect.settings, outlineColor } })} />
    </>;
    case 'glow': return <>
      <NumberField name="effect_glowStrength" value={effect.settings.glowStrength} min={0} max={20}
        commit={glowStrength => replace({ ...effect, settings: { ...effect.settings, glowStrength } })} />
      <ColorField name="effect_glowColor" icon={Palette} value={effect.settings.glowColor}
        commit={glowColor => replace({ ...effect, settings: { ...effect.settings, glowColor } })} />
      <NumberField name="effect_glowDistance" value={effect.settings.glowDistance} min={1} max={64} integer
        commit={glowDistance => replace({ ...effect, settings: { ...effect.settings, glowDistance } })} />
    </>;
    case 'shadow': return <>
      {([
        ['shadowAlpha', 0, 1], ['shadowX', -500, 500], ['shadowY', -500, 500], ['shadowBlur', 0, 50],
      ] as const).map(([field, min, max]) => <NumberField key={field} name={`effect_${field}`}
        value={effect.settings[field]} min={min} max={max}
        commit={value => replace({ ...effect, settings: { ...effect.settings, [field]: value } })} />)}
      <ColorField name="effect_shadowColor" icon={Palette} value={effect.settings.shadowColor}
        commit={shadowColor => replace({ ...effect, settings: { ...effect.settings, shadowColor } })} />
    </>;
  }
}

function WidgetFields({ node, update, globals }: Pick<Props, 'update' | 'globals'> & {
  node: Extract<SceneObject, { type: 'UIWidget' }>;
}) {
  const { widget } = node;
  const { kind } = widget;
  const change = (patch: Partial<WidgetData>) => update(item => item.type === 'UIWidget' ? { ...item, widget: { ...item.widget, ...patch } } : item);
  const globalType = widgetGlobalType(kind);
  const bindings = globals.filter(item => item.type === globalType);
  const list = kind === 'list' || kind === 'scrollBox' || kind === 'radio';
  return <Section name="widgetSettings" icon={Monitor} initial>
    <Field name="widgetKind" icon={Shapes}><select value={kind} onChange={event => {
      const next = widgetKinds.find(value => value === event.currentTarget.value);
      if (!next) return;
      const keepBinding = widgetGlobalType(next) === globalType;
      const text = widget.text === t(`widget_${kind}`) ? t(`widget_${next}`) : widget.text;
      change({ kind: next, text, globalId: keepBinding ? widget.globalId : '', value: next === 'radio' ? 0 : widget.value });
    }}>{widgetKinds.map(value => <option key={value} value={value}>{t(`widget_${value}`)}</option>)}</select></Field>
    {(kind === 'button' || kind === 'checkbox' || kind === 'switch') && <Field name="widgetText" icon={Type}>
      <RequiredText value={widget.text} commit={text => change({ text: text.slice(0, 120) })} />
    </Field>}
    {list && <Field name="widgetItems" icon={Table2}>
      <textarea key={JSON.stringify(widget.items)} rows={4} defaultValue={widget.items.join('\n')} onBlur={event => {
        const items = event.currentTarget.value.split('\n').map(item => item.trim().slice(0, 120)).filter(Boolean).slice(0, 50);
        if (JSON.stringify(items) !== JSON.stringify(widget.items)) change({ items });
      }} />
    </Field>}
    {kind !== 'checkbox' && kind !== 'switch' && kind !== 'radio' &&
      <NumberField name="widgetWidth" value={widget.width} min={24} max={2000} commit={width => change({ width })} />}
    <NumberField name="widgetHeight" value={widget.height} min={16} max={2000} commit={height => change({ height })} />
    {(kind === 'slider' || kind === 'progress') && <NumberField name="widgetValue" value={widget.value}
      min={0} max={100} commit={value => change({ value })} />}
    {kind === 'radio' && <Field name="widgetSelection" icon={Table2}><select disabled={!widget.items.length}
      value={Math.min(widget.items.length - 1, Math.round(widget.value))} onChange={event => change({ value: Number(event.currentTarget.value) })}>
      {widget.items.map((item, index) => <option key={index} value={index}>{item}</option>)}
    </select></Field>}
    {(kind === 'checkbox' || kind === 'switch') && <Field name="widgetChecked" icon={Eye}>
      <input type="checkbox" checked={widget.checked} onChange={event => change({ checked: event.currentTarget.checked })} />
    </Field>}
    {globalType && <Field name="widgetGlobal" icon={Globe}><select value={widget.globalId} onChange={event => change({ globalId: event.currentTarget.value })}>
      <option value="">{t('widgetNoGlobal')}</option>
      {widget.globalId && !bindings.some(item => item.id === widget.globalId) && <option value={widget.globalId}>{t('widgetMissingGlobal')}</option>}
      {bindings.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></Field>}
    <ColorField name="widgetBackground" icon={Palette} value={widget.background} commit={background => change({ background })} />
    {kind !== 'button' && kind !== 'list' && kind !== 'scrollBox' &&
      <ColorField name="widgetAccent" icon={Palette} value={widget.accent} commit={accent => change({ accent })} />}
    <ColorField name="widgetTextColor" icon={Palette} value={widget.textColor} commit={textColor => change({ textColor })} />
  </Section>;
}

const alignIcons: Record<Alignment, LucideIcon> = {
  left: AlignStartVertical, centerX: AlignCenterVertical, right: AlignEndVertical,
  top: AlignStartHorizontal, centerY: AlignCenterHorizontal, bottom: AlignEndHorizontal,
  spacingX: AlignHorizontalSpaceBetween, spacingY: AlignVerticalSpaceBetween,
};

function FlipTools({ flip, disabled = false }: { flip: Props['flip']; disabled?: boolean }) {
  return <>
    <IconButton icon={FlipHorizontal2} label={t('flipHorizontal')} description={t('flipHorizontalHint')}
      disabled={disabled} onClick={() => flip('x')} />
    <IconButton icon={FlipVertical2} label={t('flipVertical')} description={t('flipVerticalHint')}
      disabled={disabled} onClick={() => flip('y')} />
  </>;
}

export function MultiInspector({ nodes, locked, movableCount, layoutChildren, positionableCount, update, align, flip, toggleLock, canToggleLock, lockAction }: {
  nodes: readonly SceneObject[]; locked: ReadonlySet<string>; movableCount: number;
  layoutChildren: ReadonlySet<string>; positionableCount: number;
  update: (change: (node: SceneObject, index: number) => SceneObject) => void;
  align: (command: Alignment) => void; flip: Props['flip']; toggleLock: () => void; canToggleLock: boolean; lockAction: boolean;
}) {
  const editable = nodes.filter(node => !locked.has(node.id));
  const prefix = useRef<HTMLInputElement>(null);
  const mixed = (read: (node: SceneObject) => number, forPosition: boolean) => {
    const values = editable.filter(node => !forPosition || !layoutChildren.has(node.id)).map(read);
    return values.every(value => value === values[0]) ? values[0] : undefined;
  };
  const numeric = (name: DetailKey, icon: LucideIcon, read: (node: SceneObject) => number,
    write: (node: SceneObject, value: number) => SceneObject, axis?: 'x' | 'y', min?: number, max?: number) => {
    const value = mixed(read, name === 'position');
    return <Field key={`${name}-${axis ?? ''}`} name={name} icon={icon} axis={axis}>
      <Numeric value={value} placeholder={value === undefined ? t('mixedValue') : undefined}
        commit={value => update(node => name === 'position' && layoutChildren.has(node.id) ? node : write(node, value))} min={min} max={max} />
    </Field>;
  };
  return <div>
    <div className="selection-title selection-actions">
      <strong>{t('objectsSelected', { count: nodes.length })}</strong>
      <IconButton icon={lockAction ? Lock : LockOpen} label={t(lockAction ? 'lockObjects' : 'unlockObjects')}
        disabled={!canToggleLock} onClick={toggleLock} />
    </div>
    <fieldset disabled={!editable.length}>
      <Section name="identity" icon={Fingerprint} initial>
        <Field name="batchName" icon={Tag}>
          <input ref={prefix} placeholder={t('batchNamePlaceholder')} onKeyDown={event => {
            if (event.key === 'Enter') {
              const label = event.currentTarget.value.trim();
              if (label) update((node, i) => ({ ...node, label: `${label} ${i + 1}` }));
            }
          }} />
        </Field>
        <div className="panel-tools">
          <IconButton icon={Tag} label={t('applyBatchName')} onClick={() => {
            const label = prefix.current?.value.trim();
            if (label) update((node, i) => ({ ...node, label: `${label} ${i + 1}` }));
          }} />
        </div>
      </Section>
      <Section name="transform" icon={Move} initial>
        <fieldset className="field-group" disabled={!editable.some(node => !layoutChildren.has(node.id))}>
          {(['x', 'y'] as const).map(axis => numeric('position', Move, node => node.position[axis],
            (node, value) => ({ ...node, position: { ...node.position, [axis]: value } }), axis))}
        </fieldset>
        {numeric('rotation', RotateCw, node => node.rotation, (node, rotation) => ({ ...node, rotation }))}
        {(['x', 'y'] as const).map(axis => numeric('scale', Scaling, node => node.scale[axis],
          (node, value) => ({ ...node, scale: { ...node.scale, [axis]: value } }), axis))}
        {numeric('opacity', Contrast, node => node.alpha, (node, alpha) => ({ ...node, alpha }), undefined, 0, 1)}
        <div className="panel-tools selection-buttons">
          <FlipTools flip={flip} disabled={!movableCount} />
          {(Object.keys(alignIcons) as Alignment[]).map(command => <IconButton key={command} icon={alignIcons[command]}
            label={t(`align_${command}`)} disabled={positionableCount < (command.startsWith('spacing') ? 3 : 2)}
            onClick={() => align(command)} />)}
        </div>
      </Section>
    </fieldset>
  </div>;
}

export function Inspector({ node, roots, topLevel, layoutChild, assets, textureErrors, update, restartParticles, sectionHistory, locked, inheritedLock, toggleLock, flip, pivotAt, movementActions, globals, physicsLayers, physicsFit, particlePresets, testEffect, stopEffectTest, readOnly, ...audio }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const textureId = useId();
  const { id } = node;

  useLayoutEffect(() => {
    const last = sectionHistory.get(id);
    if (!last) return;
    const section = root.current?.querySelector<HTMLDetailsElement>(last.startsWith('effect:') ?
      `details[data-inspector-effect="${CSS.escape(last.slice(7))}"]` : `details[data-inspector-section="${CSS.escape(last)}"]`);
    if (!section) return;
    for (let current: HTMLDetailsElement | null = section; current;
      current = current.parentElement?.closest<HTMLDetailsElement>('details') ?? null) current.open = true;
    const heading = section.querySelector('summary');
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'nearest' });
  }, [id, sectionHistory]);

  const remember = (target: EventTarget) => {
    if (!(target instanceof Element)) return;
    const section = target.closest<HTMLDetailsElement>('details[data-inspector-section]');
    const name = section?.dataset.inspectorEffect ? `effect:${section.dataset.inspectorEffect}` : section?.dataset.inspectorSection;
    if (name) sectionHistory.set(id, name);
  };
  const common = (patch: Partial<Pick<SceneObject,
    'label' | 'position' | 'rotation' | 'scale' | 'pivot' | 'skew' | 'visible' | 'alpha' | 'tint'>>) =>
    update(object => ({ ...object, ...patch }));
  const anchor = (point: Point) => update(object => 'anchor' in object ? { ...object, anchor: point } : object);
  const texture = (alias: string | null) => update(object => 'texture' in object ? { ...object, texture: alias } : object);
  const text = (patch: Partial<Pick<Extract<SceneObject, { type: 'Text' }>, 'text' | 'style'>>) =>
    update(object => 'text' in object ? { ...object, ...patch } : object);
  const worldNodes = selectionTree(roots.filter(root => !root.screenSpace));
  const inWorld = worldNodes.has(node.id);
  const physicsTargets = [...worldNodes.values()].flatMap(({ node: candidate }) =>
    candidate.id !== node.id && hasPhysics(candidate) ? [{ id: candidate.id, label: candidate.label }] : []);
  const alias = objectAsset(node);
  const expected = node.type === 'Spine' ? 'spine' : node.type === 'AnimatedSprite' ? 'sheet' :
    node.type === 'AudioSource' ? 'audio' : 'image';
  const missing = alias && assets.get(alias)?.kind !== expected;
  const dimensions = (name: 'width' | 'height', value: number) => <NumberField name={name} value={value} min={0.01}
    commit={size => update(object => 'width' in object ? { ...object, [name]: size } : object)} />;
  const mesh = (name: 'bend' | 'columns' | 'rows' | 'segments' | 'length' | 'thickness', value: number,
    min: number, max?: number, integer = false) => <NumberField name={name} value={value} min={min} max={max} integer={integer}
    commit={next => update(object => (object.type === 'MeshPlane' || object.type === 'MeshRope') && name in object ?
      { ...object, [name]: next } : object)} />;

  return <div ref={root} onClickCapture={event => remember(event.target)} onFocusCapture={event => remember(event.target)}>
    <div className="selection-title selection-actions"><strong>{node.label}</strong><span className="sr-only">{t(objectTypeKey[node.type])}</span>
      <IconButton icon={locked ? LockOpen : Lock} label={t(locked ? 'unlockObjects' : 'lockObjects')}
        description={inheritedLock ? t('inheritedLock') : undefined} disabled={readOnly || inheritedLock} onClick={toggleLock} />
    </div>
    <fieldset disabled={readOnly || locked}>
    <Section name="identity" icon={Fingerprint} initial>
      <Field name="name" icon={Tag}><RequiredText value={node.label} commit={label => common({ label })} /></Field>
      <Field name="type" icon={Shapes}><input value={t(objectTypeKey[node.type])} readOnly /></Field>
    </Section>
    <Section name="transform" icon={Move} initial>
      <fieldset className="field-group" disabled={layoutChild}>
        <Coordinates name="position" icon={Move} value={node.position} commit={position => common({ position })} />
      </fieldset>
      <Field name="rotation" icon={RotateCw}><Numeric label={t('rotation')} value={node.rotation} commit={rotation => common({ rotation })} /></Field>
      <Coordinates name="scale" icon={Scaling} value={node.scale} commit={scale => common({ scale })} />
      <Coordinates name="pivot" icon={Crosshair} value={node.pivot} commit={pivot => common({ pivot })} />
      <Field name="pivotPreset" icon={Crosshair}>
        <span className="pivot-presets">
          {(['top', 'middle', 'bottom'] as const).flatMap((row, y) => (['left', 'center', 'right'] as const).map((col, x) =>
            <IconButton key={`${row}-${col}`} icon={Crosshair}
              label={t('pivotPresetAt', { row: t(`pivotRow_${row}`), col: t(`pivotColumn_${col}`) })}
              description={t('pivotPresetHint')} disabled={layoutChild} onClick={() => pivotAt({ x: x / 2, y: y / 2 })} />))}
        </span>
      </Field>
      <div className="panel-tools"><FlipTools flip={flip} /></div>
      <Coordinates name="skew" icon={Spline} value={node.skew} commit={skew => common({ skew })} />
    </Section>
    <ObjectScript id={node.id} behaviour={node.behaviour} />
    {node.type !== 'Camera2D' && <ObjectBehavior id={node.id} behavior={node.behavior} />}
    {node.networkPlayer && <NetworkFields player={node.networkPlayer} actions={movementActions} update={update} />}
    {inWorld && node.type !== 'Camera2D' && node.type !== 'AudioListener' && node.type !== 'AudioSource' && node.type !== 'Light2D' &&
      <Section name="objectPhysics" icon={Box}>
        <ObjectPhysicsFields value={node.physics} layers={physicsLayers} targets={physicsTargets} fit={physicsFit}
          change={physics => update(object => {
            if (!physics) {
              const { physics: _removed, ...remaining } = object;
              return remaining;
            }
            const result = objectPhysicsSchema.safeParse(physics);
            return result.success ? { ...object, physics: result.data } : object;
          })} />
      </Section>}
    {node.type === 'Light2D' && <LightFields node={node} inWorld={inWorld} update={update} />}
    {inWorld && node.type !== 'Camera2D' && node.type !== 'AudioListener' && node.type !== 'AudioSource' && node.type !== 'Light2D' &&
      <Section name="shadowSettings" icon={Lightbulb}>
        <Field name="shadowCaster" icon={Shapes}>
          <select value={node.shadowCaster ?? 'automatic'} onChange={event => {
            const next = event.target.value;
            update(object => ({ ...object, shadowCaster: next === 'off' || next === 'bounds' ? next : undefined }));
          }}>
            <option value="automatic">{t('shadowCasterAutomatic')}</option>
            <option value="bounds">{t('shadowCasterBounds')}</option>
            <option value="off">{t('shadowCasterOff')}</option>
          </select>
        </Field>
      </Section>}
    {node.type === 'Camera2D' && <CameraFields node={node} roots={roots} update={update} />}
    {node.type === 'Container' && <LayoutContainerFields node={node} update={update} />}
    {layoutChild && <LayoutItemFields node={node} update={update} />}
    {node.type === 'UIWidget' && <WidgetFields node={node} update={update} globals={globals} />}
    {topLevel && node.type !== 'Camera2D' && node.type !== 'Light2D' && <HUDFields node={node} update={update} />}
    {node.type === 'AudioSource' && <AudioSourceFields node={node} assets={assets} update={update} {...audio} />}
    {node.type === 'AudioListener' && <Section name="audioListenerSettings" icon={Headphones} initial>
      <Field name="audioEnabled" icon={Eye}><input type="checkbox" checked={node.visible}
        onChange={event => common({ visible: event.target.checked })} /></Field>
    </Section>}
    {node.type !== 'AudioSource' && node.type !== 'AudioListener' && <Section name="appearance" icon={Eye}>
      <Field name="visible" icon={Eye}><input type="checkbox" checked={node.visible} onChange={event => common({ visible: event.target.checked })} /></Field>
      <NumberField name="opacity" icon={Contrast} value={node.alpha} min={0} max={1} commit={alpha => common({ alpha })} />
      {node.type !== 'Light2D' && <ColorField name="tint" icon={Palette} value={node.tint} commit={tint => common({ tint })} />}
    </Section>}
    {'texture' in node && <Section name="texture" icon={Image} initial={node.type !== 'Sprite'}>
      <Field name="textureAlias" icon={Image} controlId={textureId}>
        <TexturePicker id={textureId} value={node.texture} assets={assets} choose={texture} />
      </Field>
      {'anchor' in node && <Coordinates name="anchor" icon={Anchor} value={node.anchor} commit={anchor} />}
      {(node.type === 'TilingSprite' || node.type === 'NineSliceSprite') && <>{dimensions('width', node.width)}{dimensions('height', node.height)}</>}
      {node.type === 'TilingSprite' && <>
        <Coordinates name="tilePosition" icon={Move} value={node.tilePosition} commit={tilePosition => update(object =>
          object.type === 'TilingSprite' ? { ...object, tilePosition } : object)} />
        <Coordinates name="tileScale" icon={Scaling} value={node.tileScale} commit={tileScale => update(object =>
          object.type === 'TilingSprite' ? { ...object, tileScale } : object)} />
      </>}
      {node.type === 'NineSliceSprite' && (['leftWidth', 'topHeight', 'rightWidth', 'bottomHeight'] as const).map(edge =>
        <Field name={edge} key={edge} icon={Scaling}><Numeric label={t(edge)} min={0} value={node[edge]}
          commit={size => update(object => object.type === 'NineSliceSprite' ? { ...object, [edge]: size } : object)} /></Field>)}
    </Section>}
    {node.type === 'Graphics' && <Section name="geometry" icon={Shapes} initial>
      <Field name="shape" icon={Shapes}><select value={node.shape} onChange={event => {
        const shape = event.target.value === 'ellipse' ? 'ellipse' : 'rectangle';
        update(object => object.type === 'Graphics' ? { ...object, shape } : object);
      }}><option value="rectangle">{t('rectangle')}</option><option value="ellipse">{t('ellipse')}</option></select></Field>
      {dimensions('width', node.width)}{dimensions('height', node.height)}
      <ColorField name="fill" icon={Paintbrush} value={node.fill} commit={fill =>
        update(object => object.type === 'Graphics' ? { ...object, fill } : object)} />
    </Section>}
    {node.type === 'MeshPlane' && <Section name="geometry" icon={Shapes} initial>
      {dimensions('width', node.width)}{dimensions('height', node.height)}
      {mesh('columns', node.columns, 2, 64, true)}{mesh('rows', node.rows, 2, 64, true)}
      {mesh('bend', node.bend, -1024, 1024)}
    </Section>}
    {node.type === 'MeshRope' && <Section name="geometry" icon={Shapes} initial>
      {mesh('length', node.length, 0.01)}{mesh('thickness', node.thickness, 0.01)}
      {mesh('segments', node.segments, 2, 64, true)}{mesh('bend', node.bend, -1024, 1024)}
    </Section>}
    {node.type === 'Tilemap' && <TilemapFields node={node} update={update} />}
    {node.type === 'Particles' && <ParticleFields node={node} update={update} restartParticles={restartParticles} particlePresets={particlePresets} assets={assets} />}
    {isAnimationObject(node) && <AnimationFields node={node} assets={assets} update={update} />}
    {alias && (missing || textureErrors.has(alias)) && <p className="error inset" role="status">
      {t(expected === 'audio' ? 'audioMissing' : expected === 'image' ?
        (missing ? 'textureMissing' : 'textureFailed') : (missing ? 'animationMissing' : 'animationFailed'))} · {alias}
    </p>}
    {'text' in node && <Section name="text" icon={Type} initial={node.type === 'BitmapText'}>
      <Field name="content" icon={TextCursorInput}><textarea key={node.text} defaultValue={node.text} onBlur={event => {
        if (event.target.value !== node.text) text({ text: event.target.value });
      }} /></Field>
      <Coordinates name="anchor" icon={Anchor} value={node.anchor} commit={anchor} />
      <Field name="font" icon={Type}><RequiredText value={node.style.fontFamily} commit={fontFamily => text({ style: { ...node.style, fontFamily } })} /></Field>
      <Field name="fontSize" icon={Scaling}><Numeric label={t('fontSize')} value={node.style.fontSize} min={0.01} commit={fontSize => text({ style: { ...node.style, fontSize } })} /></Field>
      <Field name="fontWeight" icon={Bold}><select value={node.style.fontWeight} onChange={event =>
        text({ style: { ...node.style, fontWeight: event.target.value === 'bold' ? 'bold' : 'normal' } })}>
        <option value="normal">{t('normal')}</option><option value="bold">{t('bold')}</option>
      </select></Field>
      <ColorField name="fill" icon={Paintbrush} value={node.style.fill} commit={fill => text({ style: { ...node.style, fill } })} />
      <Field name="alignment" icon={AlignLeft}><select value={node.style.align} onChange={event => {
        const align = event.target.value;
        if (align === 'left' || align === 'center' || align === 'right') text({ style: { ...node.style, align } });
      }}><option value="left">{t('left')}</option><option value="center">{t('center')}</option><option value="right">{t('right')}</option></select></Field>
    </Section>}
    </fieldset>
    {node.type === 'Camera2D' ?
      <CameraEffects node={node} update={update} readOnly={readOnly || locked} testEffect={testEffect} stopEffectTest={stopEffectTest} /> :
      <EffectsFields node={node} update={update} readOnly={readOnly || locked} testEffect={testEffect} stopEffectTest={stopEffectTest} />}
  </div>;
}
