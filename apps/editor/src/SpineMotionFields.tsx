import { useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { deleteSpineKeys, duplicateSpineAnimation, removeSpineAnimation, renameSpineAnimation, replaceSpineBoneKeys, replaceSpineSection, retimeSpineKeys, spineBoneChannels, spineBoneKeys,
  spineInheritanceModes, type SpineBoneChannel, type SpineDocument, type SpineInheritanceMode, type SpineKey } from '@olivestudio/engine/spine-format';
import { IconButton } from './chrome';
import { RenameValue } from './SpineAttachmentFields';
import type { SpineReferenceChange } from './spineAssets';
import { t } from './i18n';
import { validationMessage } from './scene';
import { SpineNumber } from './SpineNumber';
import { SpineCurveFields } from './SpineCurveFields';

const channels = Object.keys(spineBoneChannels) as SpineBoneChannel[];
const defaultValue = (channel: SpineBoneChannel) => channel.startsWith('scale') ? 1 : 0;
const seconds = (key: SpineKey) => key.time ?? 0;

export function SpineInheritanceSelect({ value, disabled, change }: {
  value?: string; disabled?: boolean; change: (value: SpineInheritanceMode) => void;
}) {
  const selected = spineInheritanceModes.find(mode => mode.toLowerCase() === value?.toLowerCase()) ?? 'normal';
  return <label>{t('spineTrack_inherit')}<select value={selected} disabled={disabled}
    onChange={event => change(event.currentTarget.value as SpineInheritanceMode)}>
    {spineInheritanceModes.map(mode => <option key={mode} value={mode}>{t(`spineInherit_${mode}`)}</option>)}
  </select></label>;
}

export function SpineMotionFields({ document, animation, bone, disabled, selectAnimation, selectBone, change, report }: {
  document: SpineDocument; animation: string; bone: string; disabled: boolean;
  selectAnimation: (name: string) => void; selectBone: (name: string) => void;
  change: (value: SpineDocument, reference?: SpineReferenceChange) => void; report: (error: string) => void;
}) {
  const [channel, setChannel] = useState<SpineBoneChannel>('rotate');
  const [newName, setNewName] = useState('');
  let keys: SpineKey[] = [];
  let problem = '';
  try { if (animation) keys = spineBoneKeys(document, animation, bone, channel); }
  catch (error) { problem = validationMessage(error); }
  const names = Object.keys(document.animations ?? {});
  const axes = spineBoneChannels[channel];
  const duration = Math.max(1, seconds(keys.at(-1) ?? {}));
  const update = (build: () => SpineDocument) => {
    try {
      change(build());
      report('');
    } catch (error) { report(validationMessage(error)); }
  };
  const edit = (keys: SpineKey[]) => update(() => replaceSpineBoneKeys(document, animation, bone, channel, keys));
  const modify = (index: number, change: (key: SpineKey) => SpineKey) =>
    edit(keys.map((key, i) => i === index ? change(key) : key));
  const path = ['bones', bone, channel];
  const hasBezier = keys.some(key => Array.isArray(key.curve));

  return <>
    <label>{t('assetAnimation')}
      <select value={animation} disabled={disabled || !names.length} onChange={event => selectAnimation(event.currentTarget.value)}>
        {!names.length && <option value="">—</option>}
        {names.map(name => <option key={name}>{name}</option>)}
      </select>
    </label>
    {animation && <RenameValue label={t('spineRenameClip')} value={animation} disabled={disabled} rename={name => {
      try {
        change(renameSpineAnimation(document, animation, name), { kind: 'animation', from: animation, to: name });
        selectAnimation(name);
        report('');
        return true;
      } catch (error) { report(validationMessage(error)); return false; }
    }} />}
    <form className="spine-studio-add" onSubmit={event => {
      event.preventDefault();
      const name = newName.trim();
      if (!name || names.includes(name)) return;
      try {
        change(replaceSpineSection(document, 'animations', { ...document.animations, [name]: {} }));
        selectAnimation(name);
        setNewName('');
        report('');
      } catch (error) { report(validationMessage(error)); }
    }}>
      <input aria-label={t('spineClipName')} placeholder={t('spineClipName')} value={newName} disabled={disabled} maxLength={120}
        onChange={event => setNewName(event.currentTarget.value)} />
      <IconButton icon={Plus} type="submit" label={t('spineAddClip')} disabled={disabled || !newName.trim() || names.includes(newName.trim())} />
      <IconButton icon={Copy} type="button" label={t('spineDuplicateClip')}
        disabled={disabled || !animation || !newName.trim() || names.includes(newName.trim())} onClick={() => {
          const name = newName.trim();
          try {
            change(duplicateSpineAnimation(document, animation, name));
            selectAnimation(name);
            setNewName('');
            report('');
          } catch (error) { report(validationMessage(error)); }
        }} />
      <IconButton icon={Trash2} type="button" label={t('spineRemoveClip')} description={t('spineRemoveClipHint')}
        disabled={disabled || !animation} onClick={() => {
          try {
            change(removeSpineAnimation(document, animation), { kind: 'animation', from: animation, to: null });
            selectAnimation(names.find(name => name !== animation) ?? '');
            report('');
          } catch (error) { report(validationMessage(error)); }
        }} />
    </form>
    <label>{t('rigBone')}
      <select value={bone} disabled={disabled} onChange={event => selectBone(event.currentTarget.value)}>
        {document.bones.map(item => <option key={item.name}>{item.name}</option>)}
      </select>
    </label>
    <label>{t('spineTrack')}
      <select value={channel} disabled={disabled} onChange={event => setChannel(event.currentTarget.value as SpineBoneChannel)}>
        {channels.map(value => <option key={value} value={value}>{t(`spineTrack_${value}`)}</option>)}
      </select>
    </label>
    {problem ? <pre className="spine-studio-error error" role="alert">{problem}</pre> : <>
      {!!keys.length && <div className="spine-key-ruler" aria-hidden="true">
        {keys.map(key => <i key={seconds(key)} style={{ left: `${100 * seconds(key) / duration}%` }} />)}
      </div>}
      {keys.map((key, index) => <fieldset key={`${animation}:${bone}:${channel}:${seconds(key)}`} className="spine-key" disabled={disabled}>
        <legend>{t('spineKeyNumber', { index: index + 1 })}</legend>
        <SpineNumber label={t('spinePreviewTime')} value={seconds(key)} min={0} change={time => {
          if (hasBezier) update(() => retimeSpineKeys(document, animation, [{ path, index }], { offset: time - seconds(key) }));
          else modify(index, key => ({ ...key, time }));
        }} />
        {channel === 'inherit' ? <SpineInheritanceSelect value={key.inherit}
          change={inherit => modify(index, key => ({ ...key, inherit }))} /> : <>
          {axes.map(axis => <SpineNumber key={axis} label={t(`spineKey_${axis}`)} value={key[axis] ?? defaultValue(channel)}
            change={value => modify(index, key => ({ ...key, [axis]: value }))} />)}
          <SpineCurveFields curve={key.curve} start={seconds(key)} end={keys[index + 1] ? seconds(keys[index + 1]) : undefined}
            components={axes.map(axis => ({
              label: t(`spineKey_${axis}`), from: key[axis] ?? defaultValue(channel),
              to: keys[index + 1]?.[axis] ?? defaultValue(channel),
            }))}
            change={curve => modify(index, ({ curve: _previous, ...rest }) => curve === undefined ? rest : { ...rest, curve })} />
        </>}
        <IconButton icon={Trash2} label={t('spineRemoveKey')} onClick={() => {
          if (hasBezier) update(() => deleteSpineKeys(document, animation, [{ path, index }]));
          else edit(keys.filter((_, i) => i !== index));
        }} />
      </fieldset>)}
      <button type="button" className="bundle-command" disabled={disabled || !animation}
        onClick={() => edit([...keys, { time: keys.length ? Math.round((seconds(keys.at(-1)!) + .25) * 1000) / 1000 : 0,
          ...(channel === 'inherit' ? { inherit: keys.at(-1)?.inherit ?? document.bones.find(item => item.name === bone)?.inherit ?? 'normal' } :
            Object.fromEntries(axes.map(axis => [axis, defaultValue(channel)]))) }])}>
        <Plus size={15} aria-hidden="true" />{t('spineAddKey')}
      </button>
    </>}
  </>;
}
