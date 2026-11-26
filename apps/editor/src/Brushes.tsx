import { useState } from 'react';
import { BrushSchema } from '@rewrite/production-tools/contracts';
import type { z } from 'zod';
import type { Prefab } from './prefabs';
import { validationMessage } from './scene';
import { t } from './i18n';

export type Brush = z.output<typeof BrushSchema>;

export function Brushes({ items, prefabs, active, tilemap, edit, select, editable, erase, setErase }: {
  items: Brush[];
  prefabs: readonly Prefab[];
  active?: Brush;
  tilemap: boolean;
  edit: (items: Brush[]) => void;
  select: (id: string) => void;
  editable: boolean;
  erase: boolean;
  setErase: (value: boolean) => void;
}) {
  const [error, setError] = useState('');
  const brush = active ?? items[0];
  function save(value: unknown) {
    setError('');
    try {
      const next = BrushSchema.parse(value);
      edit(items.some(item => item.id === next.id) ? items.map(item => item.id === next.id ? next : item) : [...items, next]);
      select(next.id);
    } catch (error) { setError(validationMessage(error)); }
  }
  return <fieldset disabled={!editable} className="brush-editor">
    <div className="inline-row">
      <select aria-label={t('brushChoose')} value={active?.id ?? ''} onChange={event => select(event.target.value)}>
        <option value="">{t('brushOff')}</option>
        {items.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select>
      <button type="button" disabled={!prefabs.length || items.length >= 100} onClick={() => save({
        id: crypto.randomUUID(), name: t('brushPrefab'), kind: 'prefab', prefabId: prefabs[0]?.id,
      })}>{t('brushPrefab')}</button>
      <button type="button" disabled={items.length >= 100} onClick={() => save({
        id: crypto.randomUUID(), name: t('brushTerrain'), kind: 'terrain',
      })}>{t('brushTerrain')}</button>
      <label><input type="checkbox" checked={erase} onChange={event => setErase(event.target.checked)} />{t('brushErase')}</label>
    </div>
    {brush && <div className="world-portal-form" key={brush.id}>
      <label>{t('brushName')} <input defaultValue={brush.name} maxLength={100} onBlur={event => save({ ...brush, name: event.currentTarget.value })} /></label>
      {brush.kind === 'prefab' ? <>
        <label>{t('prefabs')} <select value={brush.prefabId} onChange={event => save({ ...brush, prefabId: event.target.value })}>
          {!prefabs.some(item => item.id === brush.prefabId) && <option value={brush.prefabId}>—</option>}
          {prefabs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {([{ key: 'spacing', label: 'brushSpacing', min: 4, max: 1000 },
          { key: 'seed', label: 'brushSeed', min: 0, max: 4294967295 },
          { key: 'jitter', label: 'brushJitter', min: 0, max: 500 },
          { key: 'scaleMin', label: 'brushScaleMin', min: 0.05, max: 10 },
          { key: 'scaleMax', label: 'brushScaleMax', min: 0.05, max: 10 },
          { key: 'rotation', label: 'brushRotation', min: 0, max: 180 }] as const).map(({ key, label, min, max }) =>
          <label key={key}>{t(label)} <input type="number" min={min} max={max} step={key === 'seed' ? 1 : 'any'} defaultValue={brush[key]}
            onBlur={event => {
              const input = event.currentTarget;
              if (input.validity.valid && Number.isFinite(input.valueAsNumber) && input.valueAsNumber !== brush[key]) save({ ...brush, [key]: input.valueAsNumber });
              else input.value = String(brush[key]);
            }} /></label>)}
      </> : <>
        {!tilemap && <p className="empty">{t('brushSelectTilemap')}</p>}
        <label><input type="checkbox" checked={brush.solid} onChange={event => save({ ...brush, solid: event.target.checked })} />{t('brushSolid')}</label>
        <label>{t('brushTerrainMasks')} <input defaultValue={brush.terrainTiles.join(', ')}
          onBlur={event => save({ ...brush, terrainTiles: event.currentTarget.value.split(',').map(value => Number(value.trim())) })} /></label>
      </>}
      <button type="button" onClick={() => { edit(items.filter(item => item.id !== brush.id)); if (active) select(''); }}>{t('brushDelete')}</button>
    </div>}
    {error && <p role="alert" className="error">{error}</p>}
  </fieldset>;
}
