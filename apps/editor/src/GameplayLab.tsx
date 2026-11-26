import { useState } from 'react';
import { CharacterSchema, LabSchema } from '@rewrite/production-tools/contracts';
import { trajectory } from '@rewrite/production-tools/runtime';
import type { Project } from './project';
import type { SceneObject } from './scene';
import { validationMessage } from './scene';
import { t, type MessageKey } from './i18n';

export type Character = SceneObject['character'] & {};
type Lab = NonNullable<Project['gameplayLab']>;
const defaults = CharacterSchema.parse({});

export function GameplayLab({ selected, lab, store, apply, platform, install, buttons }: {
  selected?: SceneObject;
  lab: Lab;
  store: (value: Lab) => void;
  apply: (value: Character) => void;
  platform: () => void;
  install: (value: Character) => void;
  buttons: readonly string[];
}) {
  const [settings, setSettings] = useState(() => selected?.character ?? defaults);
  const [trial, setTrial] = useState<'jump' | 'dash'>('jump');
  const [preset, setPreset] = useState('');
  const [error, setError] = useState('');
  const run = (command: () => void) => {
    setError('');
    try { command(); } catch (error) { setError(validationMessage(error)); }
  };
  const fields = (Object.keys(defaults) as (keyof Character)[]).filter(key => key !== 'mode');
  const path = trajectory(settings, 1, trial);
  const xs = path.map(point => point.x), ys = path.map(point => point.y);
  const minX = Math.min(0, ...xs) - 20, minY = Math.min(0, ...ys) - 20;
  const viewBox = [minX, minY, Math.max(...xs, 100) - minX + 20, Math.max(...ys, 30) - minY + 20].join(' ');
  return <section className="gameplay-lab" aria-label={t('gameplayLab')}>
    <div className="inline-row">
      <select aria-label={t('gameplayLabMode')} value={settings.mode} onChange={event =>
        setSettings({ ...settings, mode: event.target.value === 'platformer' ? 'platformer' : 'topdown' })}>
        <option value="platformer">{t('platformerKit')}</option><option value="topdown">{t('topdownKit')}</option>
      </select>
      <select aria-label={t('gameplayLabTrial')} value={trial} onChange={event => setTrial(event.target.value === 'jump' ? 'jump' : 'dash')}>
        <option value="jump">{t('gameplayLabJump')}</option><option value="dash">{t('gameplayLabDash')}</option>
      </select>
    </div>
    <svg viewBox={viewBox} role="img" aria-label={t('gameplayLabTrial')}>
      <line x1={minX} y1={0} x2={Math.max(...xs, 100) + 20} y2={0} stroke="var(--line)" />
      <polyline points={path.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="var(--accent)" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="inline-row">
      <button type="button" onClick={() => run(() => install(settings))}>
        {t(settings.mode === 'platformer' ? 'installPlatformer' : 'installTopdown')}
      </button>
      <button type="button" disabled={!selected || selected.type === 'Camera2D'} onClick={() => run(() => apply(settings))}>{t('applyCharacter')}</button>
      <button type="button" disabled={selected?.type !== 'Graphics'} onClick={() => run(platform)}>{t('applyPlatform')}</button>
    </div>
    <form className="world-portal-form" onSubmit={event => {
      event.preventDefault();
      run(() => {
        store(LabSchema.parse({ ...lab, presets: [...lab.presets, { id: crypto.randomUUID(), name: preset, values: settings }] }));
        setPreset('');
      });
    }}>
      <div className="inline-row">
        <select aria-label={t('gameplayLabPreset')} value="" onChange={event => {
          const item = lab.presets.find(preset => preset.id === event.target.value);
          if (item) setSettings(item.values);
        }}>
          <option value="">{t('gameplayLabPreset')}</option>
          {lab.presets.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
        <input aria-label={t('gameplayLabPresetName')} value={preset} maxLength={100} onChange={event => setPreset(event.target.value)} />
        <button type="submit" disabled={!preset.trim() || lab.presets.length >= 100}>{t('gameplayLabSavePreset')}</button>
      </div>
    </form>
    <details><summary>{t('gameplayLabTuning')}</summary>
      <div className="world-portal-form">
        {fields.map(key => <label key={key}>{t(`character_${key}` as MessageKey)}
          <input type={typeof defaults[key] === 'number' ? 'number' : 'text'} step="any" list={typeof defaults[key] === 'string' ? 'character-actions' : undefined}
            defaultValue={String(settings[key])} key={String(settings[key])} onBlur={event => {
              const input = event.currentTarget;
              const value = typeof defaults[key] === 'number' ? input.valueAsNumber : input.value.trim();
              const result = CharacterSchema.safeParse({ ...settings, [key]: value });
              if (result.success) { setError(''); setSettings(result.data); }
              else { input.value = String(settings[key]); setError(validationMessage(result.error)); }
            }} />
        </label>)}
        <datalist id="character-actions">{buttons.map(action => <option key={action} value={action} />)}</datalist>
      </div>
    </details>
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
