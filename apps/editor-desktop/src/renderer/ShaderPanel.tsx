import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import type {Json} from '@rewrite/sdk';
import type {Entity, SceneService} from '@rewrite/scene';
import type {ProjectService} from '@rewrite/project';
import {ShaderLibrarySchema, ShaderSchema, checkShader, colorHex, emptyShaderLibrary, parseUniforms, shaderPresets, shaderType, shadersSection, uniformValue, type ShaderLibrary, type UniformSpec} from '@rewrite/render-pixi/shaders';

interface Bridge {
 project: ProjectService; scene: SceneService; text(key: string): string; report(error: unknown): void; useEditable(): boolean;
 selection(): readonly string[]; useSelection(): readonly string[]; openPanel(): void;
}
let current = '';
const listeners = new Set<() => void>();
const choose = (id: string) => { current = id; for (const l of listeners) l(); };
const useCurrent = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => current);

/**
 * Shader panel (code, presets, compile errors, apply to the selection) and the `pixi.shader` Inspector (pick a shader,
 * tune its uniforms). Shaders live in the project's `pixi.shaders` library; editing one updates every object using it.
 */
export function createShaderViews(bridge: Bridge) {
 const {project, scene, text: t} = bridge;
 const library = (): ShaderLibrary => { const parsed = ShaderLibrarySchema.safeParse(project.document.current.extensions[shadersSection] ?? emptyShaderLibrary()); return parsed.success ? parsed.data : emptyShaderLibrary(); };
 const useLibrary = () => { useSyncExternalStore(project.document.subscribe, () => project.document.current.extensions[shadersSection]); return library(); };
 const edit = (label: string, change: (lib: ShaderLibrary) => void) => {
  try { project.document.transact(label, d => { const lib = ShaderLibrarySchema.parse(d.extensions[shadersSection] ?? emptyShaderLibrary()); change(lib); d.extensions[shadersSection] = ShaderLibrarySchema.parse(lib) as unknown as Json; }); } catch (error) { bridge.report(error); }
 };
 const usages = (id: string) => project.document.current.scenes.reduce((n, s) => n + s.entities.filter(e => e.components.some(c => c.type === shaderType && (c.data as {shaderId?: string}).shaderId === id)).length, 0);
 const unique = (name: string, lib: ShaderLibrary) => { let n = name, i = 2; while (lib.items.some(x => x.name === n)) n = `${name} ${i++}`; return n; };
 const create = (presetId: string) => {
  const preset = shaderPresets.find(p => p.id === presetId), id = crypto.randomUUID();
  edit(t('shader.new'), lib => { lib.items.push({id, name: unique(preset?.name ?? t('shader.untitled'), lib), source: preset?.source ?? 'vec4 effect(vec2 uv) {\n  return tex(uv);\n}'}); });
  choose(id); return id;
 };
 const applyTo = (ids: readonly string[], shaderId: string) => {
  try {
   scene.document.transact(t('shader.apply'), d => {
    for (const id of ids) {
     const e = d.entities.find(x => x.id === id); if (!e) continue;
     const existing = e.components.find(c => c.type === shaderType);
     if (existing) existing.data = {...(existing.data as Record<string, Json>), shaderId, values: {}};
     else e.components.push({id: crypto.randomUUID(), type: shaderType, version: 1, data: {shaderId, values: {}, padding: 0}});
    }
   });
  } catch (error) { bridge.report(error); }
 };

 function ShaderPanel() {
  const editable = bridge.useEditable(), lib = useLibrary(), selection = bridge.useSelection(), id = useCurrent();
  const item = lib.items.find(x => x.id === id) ?? lib.items[0];
  const [draft, setDraft] = useState(item?.source ?? ''), [name, setName] = useState(item?.name ?? '');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined), editing = useRef(item?.id);
  useEffect(() => { if (editing.current !== item?.id || draft === undefined) { editing.current = item?.id; setDraft(item?.source ?? ''); setName(item?.name ?? ''); } }, [item?.id]);
  useEffect(() => { if (item && item.source !== draft && !timer.current) setDraft(item.source); }, [item?.source]);
  const commit = (source: string) => { clearTimeout(timer.current); timer.current = undefined; if (!item || item.source === source) return; const target = item.id; edit(t('shader.edit'), l => { const x = l.items.find(i => i.id === target); if (x) x.source = source; }); };
  const change = (source: string) => { setDraft(source); clearTimeout(timer.current); timer.current = setTimeout(() => commit(source), 350); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const problems = useMemo(() => checkShader(draft), [draft]), uniforms = useMemo(() => parseUniforms(draft), [draft]);
  const lines = draft.split('\n').length, used = item ? usages(item.id) : 0;
  const key = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
   if (e.key !== 'Tab') return; e.preventDefault();
   const el = e.currentTarget, start = el.selectionStart, end = el.selectionEnd, next = `${draft.slice(0, start)}  ${draft.slice(end)}`;
   change(next); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
  };
  return <div className="panel-body shader-panel" data-testid="shader-panel">
   <div className="shader-side"><div className="shader-list" role="listbox" aria-label={t('shader.library')}>
    {lib.items.map(x => <button key={x.id} role="option" aria-selected={x.id === item?.id} onClick={() => { if (item) commit(draft); choose(x.id); }}>{x.name}{checkShader(x.source).length ? <span className="shader-bad" aria-label={t('shader.hasErrors')}>●</span> : null}</button>)}
    {!lib.items.length && <p className="panel-empty">{t('shader.empty')}</p>}
   </div>
    <select aria-label={t('shader.new')} value="" disabled={!editable} onChange={e => { if (e.target.value) create(e.target.value); }}>
     <option value="">{t('shader.newFrom')}</option><option value="blank">{t('shader.blank')}</option>
     {shaderPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
   </div>
   {item ? <div className="shader-editor">
    <div className="shader-head">
     <input aria-label={t('shader.name')} value={name} maxLength={80} disabled={!editable} onChange={e => setName(e.target.value)} onBlur={() => { const next = name.trim(); if (next && next !== item.name) edit(t('shader.rename'), l => { const x = l.items.find(i => i.id === item.id); if (x) x.name = next; }); else setName(item.name); }}/>
     <button disabled={!editable || !selection.length || problems.length > 0} onClick={() => { commit(draft); applyTo(selection, item.id); }}>{t('shader.applySelection')}</button>
     <button disabled={!editable} onClick={() => { commit(draft); const copy = crypto.randomUUID(); edit(t('shader.duplicate'), l => { l.items.push({id: copy, name: unique(item.name, l), source: draft}); }); choose(copy); }}>{t('shader.duplicate')}</button>
     <button disabled={!editable || used > 0} title={used ? t('shader.inUse').replace('{count}', String(used)) : undefined} onClick={() => { edit(t('shader.delete'), l => { l.items = l.items.filter(i => i.id !== item.id); }); choose(''); }}>{t('shader.delete')}</button>
    </div>
    <div className="shader-code">
     <pre aria-hidden="true" className="shader-gutter">{Array.from({length: lines}, (_, i) => <span key={i} data-bad={problems.some(p => p.line === i + 1) || undefined}>{i + 1}{'\n'}</span>)}</pre>
     <textarea aria-label={t('shader.source')} rows={lines + 1} spellCheck={false} value={draft} disabled={!editable} onChange={e => change(e.target.value)} onBlur={() => commit(draft)} onKeyDown={key} data-testid="shader-source"/>
    </div>
    <div className="shader-status" role="status" data-testid="shader-status" data-ok={!problems.length}>
     {problems.length ? problems.slice(0, 6).map((p, i) => <div key={i} className="shader-problem">{t('shader.line').replace('{line}', String(p.line))}: {p.message}</div>)
      : <span>{t('shader.compiled')} · {t('shader.uniforms').replace('{count}', String(uniforms.length))} · {t('shader.usedBy').replace('{count}', String(used))}</span>}
    </div>
    <details className="shader-help"><summary>{t('shader.helpTitle')}</summary><p>{t('shader.help')}</p></details>
   </div> : <p className="panel-empty">{t('shader.pick')}</p>}
  </div>;
 }

 function UniformControl({spec, value, set, disabled}: {spec: UniformSpec; value: number | number[]; set(v: Json): void; disabled: boolean}) {
  if (spec.color) return <label className="field"><span>{spec.name}</span><input type="color" aria-label={spec.name} disabled={disabled} value={colorHex(value as number[])} onChange={e => set(e.target.value)}/></label>;
  if (typeof value === 'number') {
   const step = (spec.max - spec.min) / 200;
   return <label className="field shader-uniform"><span>{spec.name}</span><input type="range" aria-label={`${spec.name} slider`} min={spec.min} max={spec.max} step={step} disabled={disabled} value={value} onChange={e => set(Number(e.target.value))}/><input type="number" aria-label={spec.name} step={step} disabled={disabled} value={Number(value.toPrecision(4))} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) set(v); }}/></label>;
  }
  return <label className="field shader-uniform"><span>{spec.name}</span><span className="shader-vector">{value.map((v, i) => <input key={i} type="number" aria-label={`${spec.name} ${'xyzw'[i]}`} disabled={disabled} value={Number(v.toPrecision(4))} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) set(value.map((x, j) => j === i ? n : x)); }}/>)}</span></label>;
 }

 function ShaderInspector({entity, component}: {entity: Entity; component: Entity['components'][number]}) {
  const editable = bridge.useEditable(), lib = useLibrary(), data = ShaderSchema.parse(component.data), item = lib.items.find(x => x.id === data.shaderId);
  const specs = useMemo(() => item ? parseUniforms(item.source) : [], [item?.source]), problems = item ? checkShader(item.source) : [];
  const write = (label: string, next: typeof data) => { try { scene.document.transact(label, d => { const c = d.entities.find(e => e.id === entity.id)?.components.find(c => c.id === component.id); if (c) c.data = ShaderSchema.parse(next) as unknown as Json; }); } catch (error) { bridge.report(error); } };
  return <div className="shader-inspector" data-testid="shader-inspector">
   <label className="field"><span>{t('shader.shader')}</span><select aria-label={t('shader.shader')} value={data.shaderId} disabled={!editable} onChange={e => { if (e.target.value === '+') { const id = create('blank'); write(t('shader.apply'), {...data, shaderId: id, values: {}}); bridge.openPanel(); return; } write(t('shader.apply'), {...data, shaderId: e.target.value, values: {}}); }}>
    <option value="">{t('shader.none')}</option>{data.shaderId && !item && <option value={data.shaderId}>{t('shader.missing')}</option>}
    {lib.items.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="+">{t('shader.newBlank')}</option>
   </select></label>
   {problems.length > 0 && <p className="component-warning">{t('shader.broken')}</p>}
   {specs.map(spec => <UniformControl key={spec.name} spec={spec} disabled={!editable} value={uniformValue(spec, data.values)} set={v => write(t('shader.tune'), {...data, values: {...data.values, [spec.name]: v as never}})}/>)}
   <div className="shader-inspector-actions">
    {item && <button onClick={() => { choose(item.id); bridge.openPanel(); }}>{t('shader.editCode')}</button>}
    {Object.keys(data.values).length > 0 && <button disabled={!editable} onClick={() => write(t('shader.reset'), {...data, values: {}})}>{t('shader.resetValues')}</button>}
   </div>
  </div>;
 }
 return {ShaderPanel, ShaderInspector};
}
