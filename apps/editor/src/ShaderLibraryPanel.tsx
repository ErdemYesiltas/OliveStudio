import { Copy, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { checkShader, colorHex, parseUniforms, shaderPresets, uniformValue, type ShaderData, type ShaderLibrary } from '@rewrite/render-pixi/shaders';
import { IconButton, PanelHeader } from './chrome';
import { t } from './i18n';

export function ShaderLibraryPanel({ library, editable, selected, used, change, bind }: {
  library: ShaderLibrary;
  editable: boolean;
  selected?: { label: string; shader?: ShaderData };
  used: ReadonlySet<string>;
  change(library: ShaderLibrary): void;
  bind(shader?: ShaderData): void;
}) {
  const [id, setId] = useState('');
  const source = library.items.find(item => item.id === id) ?? library.items[0];
  const [draft, setDraft] = useState('');
  const [name, setName] = useState('');
  useEffect(() => { setDraft(source?.source ?? ''); setName(source?.name ?? ''); }, [source]);
  const changeShader = (patch: Partial<ShaderLibrary['items'][number]>) => {
    if (source) change({ ...library, items: library.items.map(item => item.id === source.id ? { ...item, ...patch } : item) });
  };
  function add(source: string, label: string) {
    const ids = new Set(library.items.map(item => item.name));
    let name = label, number = 2;
    while (ids.has(name)) name = label.slice(0, 70) + ' ' + number++;
    const id = crypto.randomUUID();
    change({ ...library, items: [...library.items, { id, name, source }] });
    setId(id);
  }
  const diagnostics = source ? checkShader(source.source) : [];
  const canAdd = editable && library.items.length < 200;
  const assigned = selected?.shader?.shaderId === source?.id ? selected?.shader : undefined;
  const setUniform = (key: string, value: ShaderData['values'][string]) => {
    if (assigned) bind({ ...assigned, values: { ...assigned.values, [key]: value } });
  };
  return <section className="panel" aria-label={t('shaderPanel')}>
    <PanelHeader icon={Sparkles} label={t('shaderPanel')} description={t('shader.helpTitle')}>
      <div className="panel-tools content-tabs">
        <IconButton label={t('shader.new')} icon={Plus} disabled={!canAdd}
          onClick={() => add('vec4 effect(vec2 uv) { return tex(uv); }', t('shader.untitled'))} />
        <IconButton label={t('shader.duplicate')} icon={Copy} disabled={!canAdd || !source} onClick={() => source && add(source.source, source.name)} />
        <IconButton label={t('shader.delete')} icon={Trash2} disabled={!editable || !source || used.has(source.id)}
          onClick={() => change({ ...library, items: library.items.filter(item => item.id !== source?.id) })} />
      </div>
    </PanelHeader>
    <div className="panel-body shared-tool-body shader-library">
      <div className="inline-row">
        <select aria-label={t('shader.library')} value={source?.id ?? ''} onChange={e => setId(e.target.value)}>
          {!source && <option value="">{t('shader.empty')}</option>}
          {library.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select aria-label={t('shader.newFrom')} disabled={!canAdd} value="" onChange={event => {
          const preset = shaderPresets.find(item => item.id === event.target.value);
          if (preset) add(preset.source, preset.name);
        }}>
          <option value="">{t('shader.newFrom')}</option>
          {shaderPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        </select>
        {source && <input aria-label={t('shader.name')} value={name} maxLength={80} disabled={!editable}
          onChange={e => setName(e.target.value)} onBlur={() => {
            if (name.trim() && name.trim() !== source.name) changeShader({ name: name.trim() });
            else setName(source.name);
          }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />}
      </div>
      {source && <>
        <textarea aria-label={t('shader.source')} rows={9} value={draft} disabled={!editable} maxLength={20000}
          spellCheck={false} onChange={e => setDraft(e.target.value)} />
        <div className="inline-row">
          <IconButton icon={Save} label={t('saveShader')} disabled={!editable || draft === source.source} onClick={() => changeShader({ source: draft })} />
          <span role="status">{diagnostics.length ? t('shader.hasErrors') : t('shader.compiled')}</span>
          <button type="button" disabled={!editable || !selected || diagnostics.length > 0}
            onClick={() => bind({ shaderId: source.id, padding: 0, values: {} })}>{t('shader.applySelection')}</button>
          {selected?.shader && <button type="button" disabled={!editable} onClick={() => bind(undefined)}>{t('removeShader')}</button>}
        </div>
        {diagnostics.length > 0 && <ul>{diagnostics.map((error, index) => <li key={index}>{error.line} · {error.message}</li>)}</ul>}
        {assigned && <fieldset>
          <legend>{selected?.label}</legend>
          <label className="field">{t('shader.padding')} <input type="number" min={0} max={512} defaultValue={assigned.padding}
            key={selected?.label + ':' + assigned.padding} disabled={!editable} onBlur={event => {
              if (event.currentTarget.validity.valid && Number.isFinite(event.currentTarget.valueAsNumber))
                bind({ ...assigned, padding: event.currentTarget.valueAsNumber });
            }} /></label>
          {parseUniforms(source.source).map(spec => {
            const value = uniformValue(spec, assigned.values);
            return <label className="field" key={spec.name}>{spec.name}
              {spec.color && Array.isArray(value) ? <input type="color" value={colorHex(value)} disabled={!editable}
                onChange={event => setUniform(spec.name, event.target.value)} /> : typeof value === 'number' ?
                <input type="range" value={value} min={spec.min} max={spec.max} step="any" disabled={!editable}
                  onChange={event => setUniform(spec.name, event.currentTarget.valueAsNumber)} /> :
                <input defaultValue={value.join(', ')} key={value.join(',')} disabled={!editable} onBlur={event => {
                  const parts = event.currentTarget.value.split(',').map(Number);
                  if (parts.length === value.length && parts.every(Number.isFinite)) setUniform(spec.name, parts);
                  else event.currentTarget.value = value.join(', ');
                }} />}
            </label>;
          })}
        </fieldset>}
      </>}
    </div>
  </section>;
}
