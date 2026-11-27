import {
  ArrowDown, ArrowUp, AudioLines, Bone, Box, Camera, Clock, Copy, Eye, GitBranch, Layers, ListOrdered, Radio, Sparkles, Trash2,
} from 'lucide-react';
import { directorAudioActions, directorDialogueActions, directorPhysicsActions, directorSceneActions, type DirectorStep } from '@olivestudio/engine/aperion-director';
import type { ReactNode } from 'react';
import { type CueTargets } from './CinematicFields';
import { IconButton } from './chrome';
import { directorTemplates } from './directorModel';
import { t, type MessageKey } from './i18n';
import { hasPhysics } from './physicsModel';
import { maxDirectorSpineTrack } from '@olivestudio/engine/scene-animation';
import { selectionTree } from './selection';
import { dropOne } from './valueDrag';

type Choice = { id: string; name: string };
type Targets = ReturnType<typeof stepTargets>;
type Patch = (fields: Partial<DirectorStep>) => void;
const groupTypes = ['sequence', 'parallel', 'race'] as const;
const categories = [
  { label: 'directorGroupFlow', types: ['delay', 'sequence', 'parallel', 'race', 'waitFor', 'emit', 'composition'] },
  { label: 'directorGroupScene', types: ['scene', 'camera', 'visibility', 'animation', 'rigClip'] },
  { label: 'directorGroupGame', types: ['audioSource', 'dialogue', 'physics', 'particles', 'global'] },
] as const;
const icons = {
  sequence: ListOrdered, parallel: Layers, race: GitBranch, delay: Clock, emit: Radio, waitFor: Radio,
  camera: Camera, audioSource: AudioLines, physics: Box, particles: Sparkles, visibility: Eye, rigClip: Bone,
} as const;
const cameraOperations = ['zoom', 'pan', 'rotate', 'shake', 'focus', 'reset'] as const;
type CameraOperation = typeof cameraOperations[number];
const cameraLabel = (mode: CameraOperation) => t(`directorCamera_${mode}`);
const stepLabel = (type: string) => categories.some(category => category.types.some(item => item === type)) ?
  t(`directorStep_${type}` as MessageKey) : type;
const isStep = (value: unknown): value is DirectorStep => !!value && typeof value === 'object' && 'type' in value && typeof value.type === 'string';
const group = (step: DirectorStep): DirectorStep[] | undefined =>
  groupTypes.some(type => type === step.type) && Array.isArray(step.children) && step.children.every(isStep) ? step.children : undefined;
const choices = (actions: readonly string[]) => actions.map(id => ({ id, name: t(`directorAction_${id}` as MessageKey) }));

function stepTargets(targets: CueTargets, composition: string) {
  const objects = [...selectionTree(targets.nodes).values()].map(({ node }) => node);
  const select = (filter: (node: typeof objects[number]) => boolean) =>
    objects.filter(filter).map(node => ({ id: node.id, name: node.label }));
  return {
    objects: select(node => node.type !== 'Camera2D'),
    audio: select(node => node.type === 'AudioSource'), physical: select(hasPhysics),
    animated: select(node => node.type === 'Spine' || node.type === 'AnimatedSprite'), spine: select(node => node.type === 'Spine'),
    particles: select(node => node.type === 'Particles'),
    rigs: select(node => node.type === 'Container' && node.rig?.kind === 'skeleton'), clips: targets.clips ?? [],
    globals: targets.globals, dialogues: targets.dialogues ?? [], scenes: targets.scenes, compositions: (targets.compositions ?? [])
      .filter(item => item.name !== composition).map(({ name }) => ({ name, id: name })),
  };
}

function newStep(type: keyof typeof directorTemplates): DirectorStep {
  if (groupTypes.some(item => type === item)) return { type, children: [] };
  if (type === 'camera') return { type, zoom: 1.2, ms: 400 };
  const step: DirectorStep = { ...directorTemplates[type] };
  if ('target' in step) step.target = '';
  if (type === 'composition') step.name = '';
  if (type === 'animation') step.key = '';
  return step;
}

function AddStep({ add }: { add: (step: DirectorStep) => void }) {
  return <label className="director-add-step">
    <span>{t('directorAddStep')}</span>
    <select value="" onChange={event => {
      const type = categories.flatMap(category => [...category.types]).find(type => type === event.currentTarget.value);
      if (type) add(newStep(type));
    }}>
      <option value="">{t('directorChooseStep')}</option>
      {categories.map(category => <optgroup key={category.label} label={t(category.label)}>
        {category.types.map(type => <option key={type} value={type}>{stepLabel(type)}</option>)}
      </optgroup>)}
    </select>
  </label>;
}

export function DirectorSteps({ root, targets, name, change }: {
  root: DirectorStep; targets: CueTargets; name: string; change: (step: DirectorStep) => void;
}) {
  return <div className="director-flow">
    <Step step={root} targets={stepTargets(targets, name)} change={change} depth={0} />
    {!group(root) && <AddStep add={step => change({ type: 'sequence', children: [root, step] })} />}
  </div>;
}

function Step({ step, targets, change, depth, actions }: {
  step: DirectorStep; targets: Targets; change: (step: DirectorStep) => void; depth: number; actions?: ReactNode;
}) {
  const children = depth < 8 ? group(step) : undefined;
  const Icon = Object.hasOwn(icons, step.type) ? icons[step.type as keyof typeof icons] : Box;
  const patch: Patch = fields => change({ ...step, ...fields });
  const fields = depth < 8 && <StepFields step={step} targets={targets} patch={patch} change={change} />;
  return <section className="director-step" aria-label={stepLabel(step.type)}>
    <header className="director-step-header"><Icon size={15} aria-hidden="true" /><strong>{stepLabel(step.type)}</strong>{actions}</header>
    {children ? <>
      <Select label={t('directorGroupMode')} value={step.type} options={groupTypes.map(id => ({ id, name: stepLabel(id) }))}
        change={type => patch({ type })} />
      <p className="director-note">{t(`directorGroupHint_${step.type}` as MessageKey)}</p>
      {children.length > 0 && <ol className="director-step-list">
        {children.map((child, index) => {
          const update = (next: DirectorStep) => patch({ children: children.map((item, i) => i === index ? next : item) });
          const move = (offset: number) => {
            const next = [...children];
            [next[index + offset], next[index]] = [next[index], next[index + offset]];
            patch({ children: next });
          };
          return <li key={index}><Step step={child} targets={targets} depth={depth + 1} change={update} actions={<div className="director-tools">
            <IconButton icon={ArrowUp} label={t('directorMoveUp')} disabled={index === 0} onClick={() => move(-1)} />
            <IconButton icon={ArrowDown} label={t('directorMoveDown')} disabled={index === children.length - 1} onClick={() => move(1)} />
            <IconButton icon={Copy} label={t('directorDuplicateStep')} onClick={() =>
              patch({ children: [...children.slice(0, index + 1), structuredClone(child), ...children.slice(index + 1)] })} />
            <IconButton icon={Trash2} label={t('directorRemoveStep')} onClick={() => patch({ children: children.filter((_, i) => i !== index) })} />
          </div>} /></li>;
        })}
      </ol>}
      <AddStep add={step => patch({ children: [...children, step] })} />
    </> : fields || <p className="director-note">{t('directorAdvancedStep')}</p>}
  </section>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <label className="director-field"><span>{label}</span>{children}</label>;
}

function Select({ label, value, options, change, drag }: {
  label: string; value: unknown; options: readonly Choice[]; change: (value: string) => void; drag?: 'scene' | 'object' | 'global';
}) {
  const current = typeof value === 'string' ? value : '';
  const missing = current && !options.some(option => option.id === current);
  if (value != null && typeof value !== 'string') return <p className="director-note">{t('directorAdvancedStep')}</p>;
  return <Row label={label}><select value={current} aria-invalid={!!missing && !current.startsWith('$')}
    {...(drag && dropOne(drag, id => options.some(option => option.id === id), change))}
    onChange={event => change(event.currentTarget.value)}>
    <option value="" disabled>{t('timelineChooseTarget')}</option>
    {missing && <option value={current}>{current.startsWith('$') ? current : t('directorMissingChoice', { value: current })}</option>}
    {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
  </select></Row>;
}

function Value({ label, value, change, numeric, min, max, optional, integer }: {
  label: string; value: unknown; change: (value: string | number) => void; numeric?: boolean; min?: number; max?: number;
  optional?: boolean; integer?: boolean;
}) {
  if (value != null && typeof value !== 'string' && typeof value !== 'number') return <p className="director-note">{t('directorAdvancedStep')}</p>;
  const text = String(value ?? '');
  const number = numeric && !text.startsWith('$');
  return <Row label={label}><input key={text} type={number ? 'number' : 'text'} min={min} max={max} step={integer ? 1 : 'any'} defaultValue={text}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    onBlur={event => {
      const input = event.currentTarget;
      if (input.value === text) return;
      const next = input.value.trim();
      if (optional && !next) { change(''); return; }
      if (!numeric || /^\$[A-Za-z_]\w*(?:\.\w+)*$/.test(next)) {
        change(numeric ? next : input.value);
        return;
      }
      const value = number ? input.valueAsNumber : Number(next);
      if (!next || !Number.isFinite(value) || integer && !Number.isInteger(value)) { input.value = text; return; }
      change(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, value)));
    }} /></Row>;
}

function AnimationOverrides({ step, patch, spine }: { step: DirectorStep; patch: Patch; spine: boolean }) {
  const value = step.overrides;
  if (value != null && (typeof value !== 'object' || Array.isArray(value))) {
    return <p className="director-note">{t('directorAdvancedStep')}</p>;
  }
  const overrides = (value ?? {}) as Record<string, unknown>;
  const change = (key: string, value: string | number | boolean) => {
    const next = { ...overrides };
    if (value === '') delete next[key];
    else next[key] = value;
    patch({ overrides: Object.keys(next).length ? next : undefined });
  };
  return <>
    <Value label={t('playbackSpeed')} value={overrides.speed} numeric optional min={0.01} max={120}
      change={speed => change('speed', speed)} />
    {overrides.loop != null && typeof overrides.loop !== 'boolean' ?
      <Value label={t('timelineLoop')} value={overrides.loop} change={loop => change('loop', loop)} /> :
      <Row label={t('timelineLoop')}><input type="checkbox" checked={overrides.loop === true}
        onChange={event => change('loop', event.target.checked)} /></Row>}
    {(spine || overrides.mixDuration !== undefined) && <Value label={t('spineMixDuration')} value={overrides.mixDuration}
      numeric optional min={0} change={duration => change('mixDuration', duration)} />}
    {(spine || overrides.track !== undefined) && <Value label={t('spineDirectorTrack')} value={overrides.track ?? 0}
      numeric optional integer min={0} max={maxDirectorSpineTrack} change={track => change('track', track)} />}
    {(overrides.weight !== undefined || spine && overrides.track != null && overrides.track !== 0) &&
      <Value label={t('spineOverlayWeight')} value={overrides.weight} numeric optional min={0} max={1}
        change={weight => change('weight', weight)} />}
  </>;
}

function StepFields({ step, targets, patch, change }: {
  step: DirectorStep; targets: Targets; patch: Patch; change: (step: DirectorStep) => void;
}) {
  const number = (key: string, label: string, value = step[key], min?: number, max?: number) =>
    <Value label={label} numeric value={value} min={min} max={max} change={value => patch({ [key]: value })} />;
  const text = (key: string, label: string) => <Value label={label} value={step[key]} change={value => patch({ [key]: value })} />;
  const target = (options: readonly Choice[], drag: 'object' | 'scene' | 'global' = 'object') =>
    <Select label={t('timelineCueTarget')} value={step.target} options={options} drag={drag} change={target => patch({ target })} />;
  const action = (options: readonly string[]) => <Select label={t('timelineCueAction')} value={step.action} options={choices(options)}
    change={action => patch({ action })} />;
  switch (step.type) {
    case 'delay': return number('ms', t('directorDuration'), step.ms ?? 0, 0);
    case 'emit': return text('event', t('directorSignal'));
    case 'waitFor': return <>{text('event', t('directorSignal'))}{text('whenExpr', t('directorCondition'))}
      {text('condition', t('directorWaitCondition'))}</>;
    case 'composition': return <Select label={t('directorComposition')} value={step.name} options={targets.compositions}
      change={name => patch({ name })} />;
    case 'audioSource': return <>{target(targets.audio)}{action(directorAudioActions)}
      {step.action === 'gain' && number('gain', t('directorAction_gain'), step.gain ?? 1, 0, 4)}</>;
    case 'scene': return <>{action(directorSceneActions)}{step.action !== 'pop' && target(targets.scenes, 'scene')}
      <p className="director-note">{t('directorLiveOnly')}</p></>;
    case 'physics': return <>{action(directorPhysicsActions)}{step.action !== 'gravity' && target(targets.physical)}
      {number('x', step.action === 'angularVelocity' ? t('directorDegreesPerSecond') : 'X', step.x ?? 0, -1e6, 1e6)}
      {step.action !== 'angularVelocity' && number('y', 'Y', step.y ?? 0, -1e6, 1e6)}
      <p className="director-note">{t('directorLiveOnly')}</p></>;
    case 'visibility': return <>{target(targets.objects)}{typeof step.visible === 'boolean' ?
      <Row label={t('visible')}><input type="checkbox" checked={step.visible} onChange={event => patch({ visible: event.currentTarget.checked })} /></Row> :
      text('visible', t('visible'))}</>;
    case 'animation': return <>{target(targets.animated)}{text('key', t('directorAnimationName'))}
      <AnimationOverrides step={step} patch={patch} spine={targets.spine.some(target => target.id === step.target)} />
    </>;
    case 'rigClip': return <>{target(targets.rigs)}
      <Select label={t('timelineClip')} value={step.clip} options={targets.clips} change={clip => patch({ clip })} />
      {number('speed', t('playbackSpeed'), step.speed ?? 1, 0.1, 8)}
      {typeof step.loop === 'string' ? text('loop', t('timelineLoop')) :
        <Row label={t('timelineLoop')}><input type="checkbox" checked={step.loop === true} onChange={event => patch({ loop: event.currentTarget.checked })} /></Row>}
    </>;
    case 'particles': return target(targets.particles);
    case 'dialogue': return <>{action(directorDialogueActions)}
      {step.action === 'start' && <Select label={t('directorStep_dialogue')} value={step.target} options={targets.dialogues}
        change={target => patch({ target })} />}
      <p className="director-note">{t('directorLiveOnly')}</p></>;
    case 'global': return <>{target(targets.globals, 'global')}{text('value', t('timelineKeyValue'))}</>;
    case 'camera': return <CameraFields step={step} change={change} />;
    default: return <p className="director-note">{t('directorAdvancedStep')}</p>;
  }
}

function CameraFields({ step, change }: { step: DirectorStep; change: (step: DirectorStep) => void }) {
  const mode = cameraOperations.find(mode => step[mode] !== undefined);
  const options = cameraOperations.map(id => ({ id, name: cameraLabel(id) }));
  // Combined transforms and variable-driven groups stay intact in Advanced JSON.
  if (!mode || cameraOperations.filter(mode => step[mode] !== undefined).length > 1 ||
    ((mode === 'shake' || mode === 'pan' || mode === 'focus') && (!step[mode] || typeof step[mode] !== 'object'))) {
    return <p className="director-note">{t('directorAdvancedStep')}</p>;
  }
  return <>
    <Select label={t('timelineCueAction')} value={mode} options={options} change={value => {
      const next = { ...step };
      delete next[mode];
      const settings = { zoom: 1.2, pan: { x: 0, y: 0 }, rotate: 0, shake: { intensity: 8 },
        focus: { x: 0, y: 0, width: 320, height: 180 }, reset: true };
      const operation = cameraOperations.find(mode => mode === value);
      if (operation) change({ ...next, [operation]: settings[operation] });
    }} />
    <Value label={t('directorDuration')} numeric value={mode === 'shake' ? step.shake.ms ?? step.ms ?? 300 : step.ms ?? 0} min={0}
      change={ms => change(mode === 'shake' ? { ...step, shake: { ...step.shake, ms } } : { ...step, ms })} />
    {(mode === 'zoom' || mode === 'rotate') && <Value label={cameraLabel(mode)} numeric value={step[mode]}
      min={mode === 'zoom' ? 0.05 : undefined} max={mode === 'zoom' ? 20 : undefined} change={value => change({ ...step, [mode]: value })} />}
    {(mode === 'pan' || mode === 'focus' || mode === 'shake') &&
      (mode === 'focus' ? ['x', 'y', 'width', 'height'] : mode === 'pan' ? ['x', 'y'] : ['intensity']).map(key =>
        <Value key={key} label={t(`directorCameraField_${key}` as MessageKey)} numeric value={step[mode][key] ?? 0}
          min={key === 'width' || key === 'height' ? 1 : key === 'intensity' ? 0 : undefined}
          change={value => change({ ...step, [mode]: { ...step[mode], [key]: value } })} />)}
  </>;
}
