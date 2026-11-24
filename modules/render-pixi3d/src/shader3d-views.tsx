import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Material3D} from '@pixi/3d';
import type {Json} from '@rewrite/sdk';
import type {Entity, SceneService} from '@rewrite/scene';
import type {ProjectService} from '@rewrite/project';
import {ShaderItemSchema, ShaderLibrarySchema, Shader3DSchema, ShaderMaterial3D, emptyShaderLibrary, fingerprint, paramTypes, shader3dType, shaderBits, shaderHash, shaderKinds, shaderProblems, shaderSection, shaderSections, type ShaderItem, type ShaderKind, type ShaderLibrary, type ShaderParam} from './shader3d';
import {shaderValidator, type ShaderBackend, type ShaderCheck} from './shader3d-validator';

export interface Shader3DBridge {
 project: ProjectService; scene: SceneService; text(key: string): string; report(error: unknown): void; useEditable(): boolean;
 selection(): readonly string[]; useSelection(): readonly string[]; openPanel(): void; textures(): readonly {id: string; name: string}[];
}
/** Starting code per kind, both languages, small enough to read at a glance. */
export const shaderStarters: Record<ShaderKind, Pick<ShaderItem, 'params' | 'wgsl' | 'glsl'>> = {
 extra: {params: [{name: 'tint', type: 'color', default: '#ff9a3c'}, {name: 'amount', type: 'float', default: .5}],
  wgsl: {header: '', material: '  albedo = mix(albedo, material.tint.rgb, material.amount);', preLighting: '', perLight: '', postLighting: ''},
  glsl: {header: '', material: '  albedo = mix(albedo, material.tint.rgb, material.amount);', preLighting: '', perLight: '', postLighting: ''}},
 material: {params: [{name: 'tint', type: 'color', default: '#59d8ff'}],
  wgsl: {header: '', material: '  albedo = material.tint.rgb * (0.6 + 0.4 * sin(material.time * 2.0));\n  alpha = 1.0;', preLighting: '', perLight: '', postLighting: ''},
  glsl: {header: '', material: '  albedo = material.tint.rgb * (0.6 + 0.4 * sin(material.time * 2.0));\n  alpha = 1.0;', preLighting: '', perLight: '', postLighting: ''}},
 lighting: {params: [{name: 'bands', type: 'float', default: 3}],
  wgsl: {header: '', material: '', preLighting: '  var lit = vec3<f32>(0.0);', perLight: '    lit += floor(nDotL * attenuation * shadow * material.bands + 0.5) / material.bands * light.color;', postLighting: '  finalColor = albedo * (lit + vec3<f32>(0.15));'},
  glsl: {header: '', material: '', preLighting: '  vec3 lit = vec3(0.0);', perLight: '    lit += floor(nDotL * attenuation * shadow * material.bands + 0.5) / material.bands * light.color;', postLighting: '  finalColor = albedo * (lit + vec3(0.15));'}},
};
let current = '';
const listeners = new Set<() => void>();
const choose = (id: string) => { current = id; for (const l of listeners) l(); };
const useCurrent = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => current);
const backendName = (b: ShaderBackend) => b === 'webgpu' ? 'WebGPU (WGSL)' : 'WebGL (GLSL)';
/** Compiles a shader on both backends in the hidden checker, on a plain cube (the panel's quick check; Play checks each object as drawn). */
export function checkInPanel(item: ShaderItem): Promise<Record<ShaderBackend, ShaderCheck>> {
 const build = () => ({material: item.kind === 'extra' ? new Material3D({extraBits: shaderBits(item)}) : new ShaderMaterial3D(item, '#ffffff'), attributes: {uv: true, color: false, color1: false}, code: {webgl: fingerprint(item, 'glsl'), webgpu: fingerprint(item, 'wgsl')}});
 const key = `panel|${shaderHash(item)}|${item.kind}`, v = shaderValidator();
 return Promise.all((['webgl', 'webgpu'] as const).map(b => v.check(key, b, build))).then(([webgl, webgpu]) => ({webgl, webgpu}));
}

/**
 * 3D Shaders panel (the project's pixi3d.shaders: kind, parameters, WGSL and GLSL code, live compile on both renderers)
 * and the Shader 3D Inspector (choose a shader, set its parameters). Every edit is one document transaction.
 */
export function createShader3DViews(bridge: Shader3DBridge) {
 const {project, scene, text: t} = bridge;
 const library = (): ShaderLibrary => { const parsed = ShaderLibrarySchema.safeParse(project.document.current.extensions[shaderSection] ?? emptyShaderLibrary()); return parsed.success ? parsed.data : emptyShaderLibrary(); };
 const useLibrary = () => { useSyncExternalStore(project.document.subscribe, () => project.document.current.extensions[shaderSection]); return library(); };
 const edit = (label: string, change: (lib: ShaderLibrary) => void) => {
  try { project.document.transact(label, d => { const lib = ShaderLibrarySchema.parse(d.extensions[shaderSection] ?? emptyShaderLibrary()); change(lib); d.extensions[shaderSection] = ShaderLibrarySchema.parse(lib) as unknown as Json; }); } catch (error) { bridge.report(error); }
 };
 const usages = (id: string) => project.document.current.scenes.reduce((n, s) => n + s.entities.filter(e => e.components.some(c => c.type === shader3dType && (c.data as {shaderId?: string}).shaderId === id)).length, 0);
 const unique = (name: string, lib: ShaderLibrary) => { let n = name, i = 2; while (lib.items.some(x => x.name === n)) n = `${name} ${i++}`; return n; };
 const create = (kind: ShaderKind) => { const id = crypto.randomUUID(); edit(t('shader3d.new'), lib => { lib.items.push(ShaderItemSchema.parse({id, name: unique(t(`shader3d.kind.${kind}`), lib), kind, ...structuredClone(shaderStarters[kind])})); }); choose(id); return id; };
 const applyTo = (ids: readonly string[], shaderId: string) => {
  try { scene.document.transact(t('shader3d.apply'), d => { for (const id of ids) { const e = d.entities.find(x => x.id === id); if (!e || !e.components.some(c => c.type === 'pixi3d.primitive' || c.type === 'pixi3d.mesh')) continue; const existing = e.components.find(c => c.type === shader3dType); if (existing) existing.data = {shaderId, values: {}}; else e.components.push({id: crypto.randomUUID(), type: shader3dType, version: 1, data: {shaderId, values: {}}}); } }); } catch (error) { bridge.report(error); }
 };

 function Panel() {
  const editable = bridge.useEditable(), lib = useLibrary(), selection = bridge.useSelection(), id = useCurrent(), item = lib.items.find(x => x.id === id) ?? lib.items[0];
  const [lang, setLang] = useState<'wgsl' | 'glsl'>('wgsl'), [draft, setDraft] = useState<ShaderItem | undefined>(item), timer = useRef<ReturnType<typeof setTimeout>>(undefined), [checks, setChecks] = useState<Record<ShaderBackend, ShaderCheck> | null>(null);
  useEffect(() => { setDraft(item); }, [item?.id]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (next: ShaderItem) => { const parsed = ShaderItemSchema.safeParse(next); if (!parsed.success) return; edit(t('shader3d.edit'), l => { const i = l.items.findIndex(x => x.id === next.id); if (i >= 0) l.items[i] = parsed.data; }); };
  const change = (next: ShaderItem) => { setDraft(next); clearTimeout(timer.current); timer.current = setTimeout(() => commit(next), 400); };
  const shown = draft && draft.id === item?.id ? draft : item, parsed = shown ? ShaderItemSchema.safeParse(shown) : undefined;
  const schemaError = parsed && !parsed.success ? parsed.error.issues[0]?.message : undefined, problems = parsed?.success ? shaderProblems(parsed.data) : [];
  // Compile both halves in the hidden checker whenever the code settles (results are cached per content).
  useEffect(() => { setChecks(null); if (!parsed?.success || problems.length) return; let live = true; const h = setTimeout(() => { void checkInPanel(parsed.data).then(r => { if (live) setChecks(r); }); }, 450); return () => { live = false; clearTimeout(h); }; }, [parsed?.success ? shaderHash(parsed.data) : '', problems.length]);
  const used = item ? usages(item.id) : 0;
  const setParam = (i: number, p: ShaderParam | null) => { if (!shown) return; const params = [...shown.params]; if (p) params[i] = p; else params.splice(i, 1); change({...shown, params}); };
  return <div className="panel-body shader-panel shader3d-panel" data-testid="shader3d-panel">
   <div className="shader-side"><div className="shader-list" role="listbox" aria-label={t('shader3d.library')}>
    {lib.items.map(x => <button key={x.id} role="option" aria-selected={x.id === item?.id} onClick={() => choose(x.id)}>{x.name} <small>{t(`shader3d.kind.${x.kind}`)}</small></button>)}
    {!lib.items.length && <p className="panel-empty">{t('shader3d.empty')}</p>}
   </div>
    <select aria-label={t('shader3d.new')} value="" disabled={!editable} onChange={e => { if (e.target.value) create(e.target.value as ShaderKind); }}>
     <option value="">{t('shader3d.newOfKind')}</option>{shaderKinds.map(k => <option key={k} value={k}>{t(`shader3d.kind.${k}`)}</option>)}
    </select>
   </div>
   {shown ? <div className="shader-editor">
    <div className="shader-head">
     <input aria-label={t('shader3d.name')} value={shown.name} maxLength={100} disabled={!editable} onChange={e => change({...shown, name: e.target.value})}/>
     <span className="shader3d-kind">{t(`shader3d.kind.${shown.kind}`)}</span>
     <button disabled={!editable || !selection.length} onClick={() => applyTo(selection, shown.id)}>{t('shader3d.applySelection')}</button>
     <button disabled={!editable || used > 0} title={used ? t('shader3d.inUse').replace('{count}', String(used)) : undefined} onClick={() => { edit(t('shader3d.delete'), l => { l.items = l.items.filter(i => i.id !== shown.id); }); choose(''); }}>{t('shader3d.delete')}</button>
    </div>
    <p className="shader-help">{t(`shader3d.help.${shown.kind}`)}</p>
    <fieldset className="shader3d-params" disabled={!editable}><legend>{t('shader3d.params')}</legend>
     {shown.params.map((p, i) => <div key={i} className="shader3d-param">
      <input aria-label={t('shader3d.paramName')} value={p.name} onChange={e => setParam(i, {...p, name: e.target.value} as ShaderParam)}/>
      <select aria-label={t('shader3d.paramType')} value={p.type} onChange={e => { const type = e.target.value as ShaderParam['type']; setParam(i, {name: p.name, type, default: type === 'float' ? 0 : type === 'color' ? '#ffffff' : type === 'vec2' ? [0, 0] : type === 'vec4' ? [0, 0, 0, 0] : ''} as ShaderParam); }}>{paramTypes.map(x => <option key={x} value={x}>{x}</option>)}</select>
      <button aria-label={t('shader3d.removeParam')} onClick={() => setParam(i, null)}>×</button>
     </div>)}
     <button onClick={() => setParam(shown.params.length, {name: `value${shown.params.length + 1}`, type: 'float', default: 0})}>{t('shader3d.addParam')}</button>
    </fieldset>
    <div className="shader3d-tabs" role="tablist">{(['wgsl', 'glsl'] as const).map(l => <button key={l} role="tab" aria-selected={lang === l} onClick={() => setLang(l)}>{l === 'wgsl' ? 'WGSL · WebGPU' : 'GLSL · WebGL'}</button>)}</div>
    {shaderSections(shown.kind).map(section => {
     const value = shown[lang][section as keyof ShaderItem['wgsl']], bad = checks ? (lang === 'wgsl' ? checks.webgpu : checks.webgl).errors.filter(e => e.section === section).map(e => e.line) : [];
     return <label key={section} className="shader3d-section"><span>{t(`shader3d.section.${section}`)}</span>
      <div className="shader-code"><pre aria-hidden="true" className="shader-gutter">{value.split('\n').map((_, i) => <span key={i} data-bad={bad.includes(i + 1) || undefined}>{i + 1}{'\n'}</span>)}</pre>
       <textarea aria-label={`${lang} ${section}`} spellCheck={false} rows={Math.max(2, value.split('\n').length + 1)} value={value} disabled={!editable} data-testid={`shader3d-${lang}-${section}`}
        onChange={e => change({...shown, [lang]: {...shown[lang], [section]: e.target.value}})}/></div></label>;
    })}
    <div className="shader-status" role="status" data-testid="shader3d-status" data-ok={Boolean(checks && checks.webgl.state !== 'failed' && checks.webgpu.state !== 'failed' && !problems.length && !schemaError)}>
     {schemaError ? <div className="shader-problem">{schemaError}</div> : problems.length ? problems.map((p, i) => <div key={i} className="shader-problem">{p}</div>)
      : !checks ? <span>{t('shader3d.checking')}</span>
      : (['webgpu', 'webgl'] as const).map(b => <div key={b} className={checks[b].state === 'failed' ? 'shader-problem' : undefined}>{backendName(b)}: {checks[b].state === 'ok' ? t('shader3d.compiled') : checks[b].state === 'unavailable' ? `${t('shader3d.unavailable')}${checks[b].details?.reason ? ` (${checks[b].details!.reason})` : ''}` : checks[b].errors.slice(0, 4).map(e => `${e.section ? `${t(`shader3d.section.${e.section}`)} ${t('shader3d.line')} ${e.line}: ` : ''}${e.message}`).join(' · ')}</div>)}
     <span>{t('shader3d.usedBy').replace('{count}', String(used))}</span>
    </div>
   </div> : <p className="panel-empty">{t('shader3d.pick')}</p>}
  </div>;
 }

 function Inspector({entity, component}: {entity: Entity; component: Entity['components'][number]}) {
  const editable = bridge.useEditable(), lib = useLibrary(), data = Shader3DSchema.parse(component.data), item = lib.items.find(x => x.id === data.shaderId), textures = useMemo(() => bridge.textures(), []);
  const write = (label: string, next: typeof data) => { try { scene.document.transact(label, d => { const c = d.entities.find(e => e.id === entity.id)?.components.find(c => c.id === component.id); if (c) c.data = Shader3DSchema.parse(next) as unknown as Json; }); } catch (error) { bridge.report(error); } };
  const set = (name: string, v: Json) => write(t('shader3d.tune'), {...data, values: {...data.values, [name]: v as never}});
  return <div className="shader-inspector" data-testid="shader3d-inspector">
   <label className="field"><span>{t('shader3d.shader')}</span><select aria-label={t('shader3d.shader')} value={data.shaderId} disabled={!editable} onChange={e => write(t('shader3d.apply'), {shaderId: e.target.value, values: {}})}>
    <option value="">{t('shader3d.none')}</option>{data.shaderId && !item && <option value={data.shaderId}>{t('shader3d.missing')}</option>}
    {lib.items.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
   </select></label>
   {item?.params.map(p => {const v = data.values[p.name] ?? p.default;
    if (p.type === 'color') return <label key={p.name} className="field"><span>{p.name}</span><input type="color" aria-label={p.name} disabled={!editable} value={String(v)} onChange={e => set(p.name, e.target.value)}/></label>;
    if (p.type === 'float') return <label key={p.name} className="field"><span>{p.name}</span><input type="number" aria-label={p.name} step={0.05} disabled={!editable} value={Number(v)} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) set(p.name, n); }}/></label>;
    if (p.type === 'texture') return <label key={p.name} className="field"><span>{p.name}</span><select aria-label={p.name} disabled={!editable} value={String(v)} onChange={e => set(p.name, e.target.value)}><option value="">{t('shader3d.none')}</option>{textures.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>;
    const a = v as number[]; return <label key={p.name} className="field shader-uniform"><span>{p.name}</span><span className="shader-vector">{a.map((x, i) => <input key={i} type="number" aria-label={`${p.name} ${'xyzw'[i]}`} disabled={!editable} value={x} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) set(p.name, a.map((y, j) => j === i ? n : y)); }}/>)}</span></label>;
   })}
   <div className="shader-inspector-actions">{item && <button onClick={() => { choose(item.id); bridge.openPanel(); }}>{t('shader3d.editCode')}</button>}</div>
  </div>;
 }
 return {Panel, Inspector};
}
