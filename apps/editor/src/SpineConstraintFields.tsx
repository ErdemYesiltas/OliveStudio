import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { addSpineConstraint, moveSpineConstraint, orderedSpineConstraints, removeSpineConstraint,
  replaceSpineSection, spineConstraintKinds, type SpineConstraint, type SpineConstraintKind, type SpineDocument } from '@olivestudio/engine/spine-format';
import { IconButton } from './chrome';
import { t, type MessageKey } from './i18n';
import { validationMessage } from './scene';
import { SpineNumber } from './SpineNumber';

type NumberSpec = readonly [string, number, number?, number?];
export const spinePhysicsTrackNumbers: readonly NumberSpec[] = [
  ['inertia', 1, 0, 1], ['strength', 100, 0], ['damping', 1, 0], ['mass', 1, 0.0001],
  ['wind', 0], ['gravity', 0], ['mix', 1, 0, 1],
];
const numbers: Record<SpineConstraintKind, readonly NumberSpec[]> = {
  ik: [['mix', 1, 0, 1], ['softness', 0, 0]],
  transform: [['rotation', 0], ['x', 0], ['y', 0], ['scaleX', 0], ['scaleY', 0], ['shearY', 0],
    ['mixRotate', 1, 0, 1], ['mixX', 1, 0, 1], ['mixY', 1, 0, 1], ['mixScaleX', 1, 0, 1], ['mixScaleY', 1, 0, 1], ['mixShearY', 1, 0, 1]],
  path: [['position', 0], ['spacing', 0], ['rotation', 0], ['mixRotate', 1, 0, 1], ['mixX', 1, 0, 1], ['mixY', 1, 0, 1]],
  physics: [['x', 0], ['y', 0], ['rotate', 0], ['scaleX', 0], ['shearX', 0], ['limit', 5000, 0], ['fps', 60, 1],
    ...spinePhysicsTrackNumbers],
};
const flags: Record<SpineConstraintKind, readonly [string, boolean][]> = {
  ik: [['bendPositive', true], ['compress', false], ['stretch', false], ['uniform', false]],
  transform: [['local', false], ['relative', false]],
  path: [],
  physics: spinePhysicsTrackNumbers.map(([key]) => [`${key}Global`, false]),
};
const pathModes = {
  positionMode: ['percent', 'fixed'], spacingMode: ['length', 'fixed', 'percent', 'proportional'], rotateMode: ['tangent', 'chain', 'chainScale'],
} as const;
const label = (field: string) => t(`spineConstraint_${field}` as MessageKey);
const fieldNumber = (entry: SpineConstraint, field: string, defaultValue: number) => {
  const value = entry[field];
  if (typeof value === 'number') return value;
  if (field === 'mixY' && typeof entry.mixX === 'number') return entry.mixX;
  if (field === 'mixScaleY' && typeof entry.mixScaleX === 'number') return entry.mixScaleX;
  return defaultValue;
};

export function SpineConstraintFields({ document, disabled, change, report }: {
  document: SpineDocument; disabled: boolean; change: (value: SpineDocument) => void; report: (error: string) => void;
}) {
  const [kind, setKind] = useState<SpineConstraintKind>('ik');
  const [name, setName] = useState('');
  const [newName, setNewName] = useState('');
  const constraints = document[kind] ?? [];
  const selected = constraints.find(item => item.name === name) ?? constraints[0];
  const kinds = orderedSpineConstraints(document);
  const ordered = kinds.findIndex(item => item.constraint === selected);
  const bones = document.bones.map(bone => bone.name);
  const slots = (document.slots ?? []).map(slot => slot.name);
  const canCreate = (kind !== 'ik' && kind !== 'transform' || bones.length > 1) && (kind !== 'path' || slots.length > 0);
  const apply = (update: () => SpineDocument) => {
    try { change(update()); report(''); return true; }
    catch (error) { report(validationMessage(error)); return false; }
  };
  const patch = (key: string, value: string | number | boolean | string[]) =>
    apply(() => replaceSpineSection(document, kind, constraints.map(item => item === selected ? { ...item, [key]: value } : item)));
  const constrained = Array.isArray(selected?.bones) ? selected.bones.filter((name): name is string => typeof name === 'string') : [];
  const selection = kind === 'physics' ? 'bone' : 'target';
  const targets = kind === 'path' ? slots : bones.filter(bone => !constrained.includes(bone));
  const eligible = kind === 'path' ? bones : bones.filter(bone => bone !== selected?.target);

  return <>
    <label>{t('spineConstraintType')}<select value={kind} disabled={disabled} onChange={event => setKind(event.currentTarget.value as SpineConstraintKind)}>
      {spineConstraintKinds.map(kind => <option key={kind} value={kind}>{t(`spineSection_${kind}`)}</option>)}
    </select></label>
    <label>{t('spineConstraint')}<select value={selected?.name ?? ''} disabled={disabled || !selected} onChange={event => setName(event.currentTarget.value)}>
      {!selected && <option value="">—</option>}{constraints.map(item => <option key={item.name}>{item.name}</option>)}
    </select></label>
    <form className="spine-studio-add" onSubmit={event => {
      event.preventDefault();
      const name = newName.trim();
      if (!canCreate || !name || constraints.some(item => item.name === name)) return;
      const constraint = kind === 'physics' ? { name, bone: bones.at(-1)!, rotate: 1 } :
        { name, bones: [bones.at(-1)!], target: kind === 'path' ? slots[0] : bones[0] };
      if (apply(() => addSpineConstraint(document, kind, constraint))) { setNewName(''); setName(name); }
    }}>
      <input aria-label={t('spineConstraintName')} placeholder={t('spineConstraintName')} value={newName} disabled={disabled || !canCreate}
        maxLength={120} onChange={event => setNewName(event.currentTarget.value)} />
      <IconButton icon={Plus} type="submit" label={t('spineAddConstraint')}
        disabled={disabled || !canCreate || !newName.trim() || constraints.some(item => item.name === newName.trim())} />
    </form>
    {!canCreate && <small>{t('spineConstraintNeedsTarget')}</small>}
    {selected && <>
      <label>{t('spineConstraintOrder')}<select value={ordered} disabled={disabled}
        onChange={event => apply(() => moveSpineConstraint(document, kind, selected.name, Number(event.currentTarget.value)))}>
        {kinds.map((item, i) => <option key={`${item.kind}:${item.constraint.name}`} value={i}>{i + 1}</option>)}
      </select></label>
      <label>{kind === 'physics' ? t('rigBone') : t('spineConstraintTarget')}
        <select value={String(selected[selection] ?? '')} disabled={disabled} onChange={event => patch(selection, event.currentTarget.value)}>
          {!targets.includes(String(selected[selection])) && <option value={String(selected[selection] ?? '')}>{String(selected[selection] ?? '—')}</option>}
          {targets.map(item => <option key={item}>{item}</option>)}
        </select>
      </label>
      {kind !== 'physics' && <fieldset className="spine-key" disabled={disabled}>
        <legend>{t('spineConstrainedBones')}</legend>
        {eligible.map(bone => {
          const checked = constrained.includes(bone);
          const parent = document.bones.find(b => b.name === bone)?.parent;
          const formsChain = kind !== 'ik' || !constrained.length || parent === constrained[0] ||
            document.bones.find(b => b.name === constrained[0])?.parent === bone;
          return <label key={bone}>{bone}<input type="checkbox" checked={checked}
            disabled={checked ? constrained.length < 2 : kind === 'ik' && (constrained.length > 1 || !formsChain)}
            onChange={() => patch('bones', checked ? constrained.filter(item => item !== bone) :
              kind === 'ik' && parent !== constrained[0] ? [bone, ...constrained] : [...constrained, bone])} /></label>;
        })}
      </fieldset>}
      {kind === 'path' && Object.entries(pathModes).map(([field, choices]) => <label key={field}>{label(field)}
        <select value={choices.find(choice => choice.toLowerCase() === String(selected[field]).toLowerCase()) ?? choices[0]}
          disabled={disabled} onChange={event => patch(field, event.currentTarget.value)}>
          {choices.map(choice => <option key={choice} value={choice}>{label(choice)}</option>)}
        </select>
      </label>)}
      {numbers[kind].map(([field, fallback, min, max]) => <SpineNumber key={`${kind}/${selected.name}/${field}`}
        label={label(field)} value={fieldNumber(selected, field, fallback)} min={min} max={max} disabled={disabled}
        change={value => patch(field, value)} />)}
      {([['skin', false] as const, ...flags[kind]]).map(([field, fallback]) => <label key={field}>{label(field)}
        <input type="checkbox" disabled={disabled} checked={Boolean(selected[field] ?? fallback)}
          onChange={event => patch(field, event.currentTarget.checked)} />
      </label>)}
      {!!selected.skin && !!document.skins?.length && <fieldset className="spine-key" disabled={disabled}>
        <legend>{t('spineConstraintSkins')}</legend>
        {document.skins.map(skin => {
          const entries = Array.isArray(skin[kind]) ? skin[kind] : [];
          const checked = entries.includes(selected.name);
          return <label key={skin.name}>{skin.name}<input type="checkbox" checked={checked} onChange={() =>
            apply(() => replaceSpineSection(document, 'skins', document.skins!.map(item => item === skin ? {
              ...item, [kind]: checked ? entries.filter(name => name !== selected.name) : [...entries, selected.name],
            } : item)))} /></label>;
        })}
      </fieldset>}
      <IconButton icon={Trash2} label={t('spineRemoveConstraint')} disabled={disabled}
        onClick={() => apply(() => removeSpineConstraint(document, kind, selected.name))} />
    </>}
  </>;
}
