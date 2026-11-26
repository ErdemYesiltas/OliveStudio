import { useState } from 'react';
import { t } from './i18n';
import { builtInParticles, extractParticleSettings, particlePresetsSchema, type ParticlePreset, type ParticleSettings } from './particlePresets';
import { particleSettings, validationMessage, type ParticleObject } from './scene';

export function ParticlePresets({ node, items, change, apply }: {
  node: ParticleObject;
  items: ParticlePreset[];
  change: (items: ParticlePreset[]) => void;
  apply: (settings: ParticleSettings) => void;
}) {
  const [selected, select] = useState('');
  const [name, setName] = useState('');
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  const active = [...builtInParticles, ...items].find(item => item.id === selected);
  function run(operation: () => void) {
    setError('');
    try { operation(); } catch (error) { setError(validationMessage(error)); }
  }
  return <div className="particle-presets">
    <select aria-label={t('particlePreset')} value={active?.id ?? ''} onChange={event => select(event.target.value)}>
      <option value="">{t('particlePreset')}</option>
      <optgroup label={t('particleBuiltinPresets')}>{builtInParticles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
      {!!items.length && <optgroup label={t('particleProjectPresets')}>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>}
    </select>
    <div className="inline-row">
      <button type="button" disabled={!active} onClick={() => active && apply(active.settings)}>{t('particleApplyPreset')}</button>
      <button type="button" disabled={!items.some(item => item.id === selected)} onClick={() => run(() => {
        change(items.filter(item => item.id !== selected)); select('');
      })}>{t('particleRemovePreset')}</button>
    </div>
    <label>{t('particlePresetName')} <input maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
    <button type="button" disabled={!name.trim() || items.length >= 64} onClick={() => run(() => {
      const id = crypto.randomUUID();
      change(particlePresetsSchema.parse([...items, { id, name, settings: extractParticleSettings(node) }]));
      select(id);
      setName('');
    })}>{t('particleSavePreset')}</button>
    <details>
      <summary>{t('particlePresetJSON')}</summary>
      <textarea aria-label={t('particlePresetJSON')} value={json} maxLength={20000} rows={5} onChange={event => setJson(event.target.value)} />
      <div className="inline-row">
        <button type="button" onClick={() => setJson(JSON.stringify(extractParticleSettings(node), null, 2))}>{t('particleExportPreset')}</button>
        <button type="button" disabled={!json.trim()} onClick={() => run(() => apply(particleSettings.parse(JSON.parse(json))))}>{t('particleImportPreset')}</button>
      </div>
    </details>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
