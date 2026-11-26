import { Download, Globe, GripVertical, Plus, Save, X } from 'lucide-react';
import { useState } from 'react';
import { defaultValue, GlobalsSchema, globalTypes, parseGlobal, type Global, type Globals, type GlobalValue } from '@rewrite/interactions';
import { hint, IconButton, PanelHeader } from './chrome';
import { Numeric } from './Inspector';
import { gameSlots, type GameSave, type GameSlot, type GlobalValues } from './globals';
import { t } from './i18n';
import { valueSource } from './valueDrag';

function ValueField({ item, value, label, disabled, change, invalid }: {
  item: Global; value: GlobalValue; label: string; disabled?: boolean; change: (value: GlobalValue) => void; invalid: () => void;
}) {
  if (typeof value === 'number') return <Numeric label={label} value={value} disabled={disabled} commit={change} />;
  if (typeof value === 'boolean') return <input type="checkbox" aria-label={label} checked={value} disabled={disabled}
    onChange={event => change(event.target.checked)} />;
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  function commit(input: HTMLInputElement | HTMLTextAreaElement) {
    try { change(parseGlobal(item.type, input.value)); }
    catch { input.value = raw; invalid(); }
  }
  if (typeof value === 'object') return <textarea key={raw} aria-label={label} defaultValue={raw} rows={2} disabled={disabled}
    onBlur={event => commit(event.currentTarget)} onKeyDown={event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.currentTarget.blur();
      }
    }} />;
  return <input key={raw} aria-label={label} defaultValue={raw} maxLength={1000} disabled={disabled}
    onBlur={event => commit(event.currentTarget)} onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'Escape') { event.currentTarget.value = raw; event.currentTarget.blur(); }
    }} />;
}

export function GlobalsPanel({ definition, values, config, editable, playing, change, setRevision, setCurrent, save, load, message }: {
  definition: Globals; values: GlobalValues; config?: GameSave; editable: boolean; playing: boolean;
  change: (globals: Globals) => void; setRevision: (revision: number) => void; setCurrent: (id: string, value: GlobalValue) => void;
  save: (slot: GameSlot) => void; load: (slot: GameSlot) => void; message: string;
}) {
  const [slot, setSlot] = useState<GameSlot>(1);
  const [error, setError] = useState('');

  function write(items: Globals['items']) {
    const result = GlobalsSchema.safeParse({ version: 1, items });
    if (!result.success) {
      setError(t('globalsInvalidName'));
      return false;
    }
    setError('');
    change(result.data);
    return true;
  }

  function update(id: string, patch: Partial<Global>) {
    return write(definition.items.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  function add() {
    if (definition.items.length >= 64) return;
    const names = new Set(definition.items.map(item => item.name));
    let index = 1;
    while (names.has(`global_${index}`)) index++;
    write([...definition.items, { id: crypto.randomUUID(), name: `global_${index}`, type: 'number', initial: 0 }]);
  }

  return <section className="panel" aria-label={t('globalsPanel')}>
    <PanelHeader icon={Globe} label={t('globalsPanel')} description={t('globalsPanelHint')}>
      <IconButton icon={Plus} label={t('addGlobal')} disabled={!editable || definition.items.length >= 64} onClick={add} />
    </PanelHeader>
    <div className="panel-body scenes-body input-panel">
      <div className="input-binding-tools">
        {config ? <label className="input-settings">{t('gameSaveRevision')}
          <Numeric value={config.revision} min={1} max={9999} step={1} disabled={!editable} commit={setRevision} />
        </label> : <button className="bundle-command" type="button" disabled={!editable} onClick={() => setRevision(1)}>
          {t('enableGameSaves')}
        </button>}
        {playing && config && <>
          <select aria-label={t('gameSaveSlot')} value={slot} onChange={event => {
            const next = gameSlots.find(item => item === Number(event.target.value));
            if (next) setSlot(next);
          }}>
            {gameSlots.map(item => <option value={item} key={item}>{t('gameSaveSlotName', { index: item })}</option>)}
          </select>
          <IconButton icon={Save} label={t('saveGameSlot')} onClick={() => save(slot)} />
          <IconButton icon={Download} label={t('loadGameSlot')} onClick={() => load(slot)} />
        </>}
      </div>
      {message && <p role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {definition.items.map((item, index) => <div className="input-action" key={item.id}>
        <div className="input-action-header">
          {editable && <span className="value-drag-handle" {...hint(t('dragGlobal', { name: item.name }))}
            {...valueSource('global', item.id)}><GripVertical size={16} aria-hidden="true" /></span>}
          <input key={item.name} aria-label={t('globalName', { index: index + 1 })} defaultValue={item.name} disabled={!editable}
            onBlur={event => {
              const name = event.currentTarget.value.trim();
              if (name !== item.name && !update(item.id, { name })) event.currentTarget.value = item.name;
            }} onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') { event.currentTarget.value = item.name; event.currentTarget.blur(); }
            }} />
          <select aria-label={t('globalType', { name: item.name })} value={item.type} disabled={!editable}
            onChange={event => {
              const type = globalTypes.find(option => option === event.target.value);
              if (type) update(item.id, { type, initial: defaultValue(type) });
            }}>
            {globalTypes.map(type => <option key={type} value={type}>{t(`globalType_${type}`)}</option>)}
          </select>
          <IconButton icon={X} label={t('removeGlobal', { name: item.name })} disabled={!editable}
            onClick={() => write(definition.items.filter(other => other.id !== item.id))} />
        </div>
        <label className="input-settings">{t('globalInitial')}
          <ValueField item={item} value={item.initial} label={t('globalInitialFor', { name: item.name })}
            disabled={!editable} change={initial => { if (JSON.stringify(item.initial) !== JSON.stringify(initial)) update(item.id, { initial }); }}
            invalid={() => setError(t('globalsInvalidValue'))} />
        </label>
        {playing && <label className="input-settings">{t('globalCurrent')}
          <ValueField item={item} value={Object.hasOwn(values, item.name) ? values[item.name] : item.initial}
            label={t('globalCurrentFor', { name: item.name })} change={value => { setError(''); setCurrent(item.id, value); }}
            invalid={() => setError(t('globalsInvalidValue'))} />
        </label>}
      </div>)}
    </div>
  </section>;
}
