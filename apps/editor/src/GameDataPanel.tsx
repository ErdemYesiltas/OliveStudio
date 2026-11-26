import { useState } from 'react';
import { importCSV, tableCSV } from '@rewrite/production-tools/models';
import type { Project } from './project';
import { selectionTree } from './selection';
import { validationMessage } from './scene';
import { bindingFields, emptyGameData, parseGameData, type GameData } from './gameData';
import { t } from './i18n';

type Table = GameData['tables'][number];
type Field = GameData['tables'][number]['fields'][number];

export function GameDataPanel({ project, editable, save }: { project: Project; editable: boolean; save: (data: GameData) => void }) {
  const data = project.gameData ?? emptyGameData;
  const [id, select] = useState('');
  const [csv, setCSV] = useState('');
  const [error, setError] = useState('');
  const [bindingTarget, setBindingTarget] = useState('');
  const table = data.tables.find(item => item.id === id) ?? data.tables[0];
  const entities = project.scenes.flatMap(scene => [...selectionTree(scene.objects).values()].map(({ node }) => ({ scene, node })));
  const activeEntity = entities.find(({ node }) => node.id === bindingTarget)?.node;
  const fields = bindingFields.filter(([, key]) => key !== 'text' || activeEntity?.type === 'Text' || activeEntity?.type === 'BitmapText');
  const run = (edit: (copy: GameData) => void) => {
    if (!editable) return;
    setError('');
    try { const draft = structuredClone(data); edit(draft); save(parseGameData(project, draft)); }
    catch (error) { setError(validationMessage(error)); }
  };
  const editTable = (edit: (table: Table, draft: GameData) => void) => run(draft => {
    const current = draft.tables.find(item => item.id === table?.id);
    if (current) edit(current, draft);
  });
  function parseField(field: Field, value: string) {
    if (field.kind === 'number') return value.trim() ? Number(value) : field.default;
    if (field.kind === 'boolean') return value === 'true';
    return value;
  }
  return <section className="game-data" aria-label={t('gameData')}>
    <form className="inline-row" onSubmit={event => {
      event.preventDefault();
      const name = new FormData(event.currentTarget).get('name')?.toString().trim() ?? '';
      if (!name) return;
      const id = crypto.randomUUID();
      run(draft => { draft.tables.push({ id, name, fields: [{ key: 'value', label: t('dataValue'), kind: 'number', default: 0 }], rows: [] }); });
      select(id);
      event.currentTarget.reset();
    }}>
      <select aria-label={t('dataTable')} value={table?.id ?? ''} onChange={event => { select(event.target.value); setCSV(''); }}>
        {!table && <option value="">{t('dataTable')}</option>}
        {data.tables.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select>
      <input name="name" required aria-label={t('dataTableName')} maxLength={100} disabled={!editable} />
      <button type="submit" disabled={!editable || data.tables.length >= 100}>{t('dataAddTable')}</button>
    </form>
    {table && <fieldset disabled={!editable} key={table.id}>
      <form className="inline-row" onSubmit={event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        editTable(current => {
          const key = String(fields.get('key')), kind = String(fields.get('kind')) as Field['kind'];
          const field: Field = { key, label: String(fields.get('label')), kind, default: kind === 'number' ? 0 : kind === 'boolean' ? false : '' };
          if (kind === 'ref' || kind === 'asset') field.target = String(fields.get('target')).trim();
          current.fields.push(field);
        });
      }}>
        <input name="key" aria-label={t('dataKey')} required maxLength={40} placeholder={t('dataKey')} />
        <input name="label" aria-label={t('dataLabel')} required maxLength={100} placeholder={t('dataLabel')} />
        <select name="kind" aria-label={t('dataType')}>{(['number', 'string', 'boolean', 'asset', 'ref'] as const).map(kind =>
          <option value={kind} key={kind}>{t(`dataType_${kind}`)}</option>)}</select>
        <input name="target" aria-label={t('dataTargetType')} placeholder={t('dataTargetType')} />
        <button type="submit">{t('dataAddField')}</button>
        <button type="button" onClick={() => editTable(current => current.rows.push({ id: crypto.randomUUID(), values: {} }))}>{t('dataAddRow')}</button>
      </form>
      <div className="game-data-grid"><table>
        <thead><tr><th>{t('dataRowId')}</th>{table.fields.map(field => <th key={field.key}>{field.label}</th>)}<th /></tr></thead>
        <tbody>{table.rows.map(row => <tr key={row.id}>
          <th>{row.id}</th>
          {table.fields.map(field => {
            const value = row.values[field.key] ?? field.default;
            const edit = (value: string) => editTable(current => {
              const target = current.rows.find(item => item.id === row.id);
              if (target) target.values[field.key] = parseField(field, value);
            });
            return <td key={field.key}>{field.kind === 'boolean' ?
              <input type="checkbox" aria-label={field.label} checked={value === true} onChange={event => edit(String(event.target.checked))} /> :
              <input type={field.kind === 'number' ? 'number' : 'text'} step="any" aria-label={field.label}
                key={String(value)} defaultValue={String(value)} onBlur={event => { if (event.currentTarget.value !== String(value)) edit(event.currentTarget.value); }} />}</td>;
          })}
          <td><button type="button" onClick={() => editTable((current, draft) => {
            current.rows = current.rows.filter(item => item.id !== row.id);
            draft.bindings = draft.bindings.filter(binding => binding.tableId !== current.id || binding.rowId !== row.id);
          })}>{t('dataRemoveRow')}</button></td>
        </tr>)}</tbody>
      </table></div>
      <details><summary>{t('dataCSV')}</summary>
        <textarea aria-label={t('dataCSV')} value={csv} onChange={event => setCSV(event.target.value)} rows={5} />
        <div className="inline-row">
          <button type="button" onClick={() => setCSV(tableCSV(table))}>{t('dataCopyCSV')}</button>
          <button type="button" disabled={!csv.trim()} onClick={() => editTable(current => { current.rows = importCSV(current, csv); })}>{t('dataImportCSV')}</button>
        </div>
      </details>
      <details><summary>{t('dataBindings')}</summary>
        <form className="world-portal-form" onSubmit={event => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const [group, property] = String(values.get('property')).split(':');
          editTable((current, draft) => {
            draft.bindings.push({ tableId: current.id, rowId: String(values.get('row')), field: String(values.get('field')),
              entityId: bindingTarget, componentId: bindingTarget + ':' + group, property });
          });
        }}>
          <label>{t('dataRowId')} <select name="row" required>{table.rows.map(row => <option key={row.id}>{row.id}</option>)}</select></label>
          <label>{t('dataKey')} <select name="field" required>{table.fields.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
          <label>{t('dataObject')} <select value={bindingTarget} required onChange={event => setBindingTarget(event.target.value)}>
            <option value="">—</option>
            {entities.filter(({ node }) => node.type !== 'Camera2D').map(({ scene, node }) => <option key={node.id} value={node.id}>
              {scene.name} / {node.label}
            </option>)}
          </select></label>
          <label>{t('dataProperty')} <select name="property">{fields.map(([group, key]) => <option key={key} value={group + ':' + key}>{key}</option>)}</select></label>
          <button type="submit" disabled={!activeEntity || !table.rows.length}>{t('dataBind')}</button>
        </form>
        {data.bindings.filter(binding => binding.tableId === table.id).map(binding =>
          <div className="inline-row" key={binding.componentId + ':' + binding.property}>
            <span>{binding.field} → {entities.find(({ node }) => node.id === binding.entityId)?.node.label ?? '—'}.{binding.property}</span>
            <button type="button" onClick={() => run(draft => {
              draft.bindings = draft.bindings.filter(item => item.componentId !== binding.componentId || item.property !== binding.property);
            })}>{t('dataUnbind')}</button>
          </div>)}
      </details>
    </fieldset>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
