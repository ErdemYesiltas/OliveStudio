import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import 'monaco-editor/editor/editor.main';
import * as monaco from 'monaco-editor/editor/editor.api';
import {typescriptDefaults, ScriptTarget, ModuleKind, ModuleResolutionKind} from 'monaco-editor/languages/features/typescript/register';
/** RxJS declarations for `rx` (the sandbox runs the same 7.8 bundle). */
const rxjsTypes = import.meta.glob('../node_modules/rxjs/dist/types/**/*.d.ts', {query: '?raw', import: 'default', eager: true}) as Record<string, string>;
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker';
import {compileScript} from './compile';
import {describeScript, loadScriptEngine, scriptEngineReady, type DebugInstance} from './session';
import {scriptDebugger} from './debug';
import {apiDeclarations, globalsDeclaration, BehaviourSchema, ScriptNameSchema, scriptTemplate, scriptTemplates, type Behaviour, type ParamField, type Script, type ScriptLibrary} from './contracts';

/** What the panel and inspector need from the studio. */
export interface ScriptsBridge {
 text(key: string): string; report(error: unknown): void; useEditable(): boolean;
 /** The source may also be edited while the game runs (live reload); defaults to useEditable. */
 useSourceEditable?(): boolean;
 /** The project's script library (subscribes to document changes). */
 useLibrary(): ScriptLibrary; library(): ScriptLibrary;
 /** One undo step changing the library. */
 change(label: string, mutate: (library: ScriptLibrary) => void): void;
 /** The selected object and whether it already has a script. */
 useSelection(): {id: string; name: string; scripted: boolean} | null;
 /** Adds the Script component (with this script) to the selected object. */
 attach(scriptId: string): void;
 setBehaviour(entityId: string, componentId: string, value: Behaviour): void;
 open(): void;
 /** Objects of the open scene (object parameters) and the scene itself (scene script). */
 useEntities(): readonly {id: string; name: string}[];
 useScene(): {id: string; name: string};
 /** Project globals, so the editor types \`globals.name\` for each one. */
 useGlobals?(): readonly {name: string; type: string; initial?: unknown}[];
}

let configured = false;
/** Workers, the TypeScript service and the `game` API declarations, once per window. */
function configure() {
 if (configured) return;
 configured = true;
 (globalThis as {MonacoEnvironment?: monaco.Environment}).MonacoEnvironment = {getWorker: (_id, label) => label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker()};
 typescriptDefaults.setCompilerOptions({target: ScriptTarget.ES2020, module: ModuleKind.ESNext, moduleResolution: ModuleResolutionKind.NodeJs, lib: ['es2020'], strict: false, noImplicitAny: false, allowNonTsExtensions: true, isolatedModules: true});
 typescriptDefaults.setDiagnosticsOptions({noSemanticValidation: false, noSyntaxValidation: false});
 for (const [path, source] of Object.entries(rxjsTypes)) typescriptDefaults.addExtraLib(source, `file:///node_modules/rxjs/${path.replace(/^.*?node_modules\/rxjs\//, '')}`);
 typescriptDefaults.addExtraLib(JSON.stringify({name: 'rxjs', version: '7.8.2', types: 'dist/types/index.d.ts'}), 'file:///node_modules/rxjs/package.json');
 typescriptDefaults.addExtraLib(apiDeclarations, 'file:///scripts/game-api.d.ts');
}
/** Extra declarations for the script editor (sandbox providers' globals, e.g. a state-machine library). Returns a disposer. */
export function addScriptLibrary(source: string, uri: string) { configure(); return typescriptDefaults.addExtraLib(source, uri); }
const modelUri = (id: string) => monaco.Uri.parse(`file:///scripts/${encodeURIComponent(id)}.ts`);
const dark = () => { const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number) ?? [0, 0, 0]; return (bg[0] * 299 + bg[1] * 587 + bg[2] * 114) / 1000 < 128; };

/** Panel selection shared with the inspector's "Edit script" button. */
let current = '';
const currentListeners = new Set<() => void>();
const setCurrent = (id: string) => { current = id; for (const fn of currentListeners) fn(); };
const useCurrent = () => useSyncExternalStore(fn => { currentListeners.add(fn); return () => { currentListeners.delete(fn); }; }, () => current);

/** Preview output of `game.log`/`console` and script errors, shown under the editor (last 200 lines). */
export const scriptConsole = (() => {
 let lines: {level: 'info' | 'warn' | 'error'; message: string; at: number}[] = [], version = 0;
 const listeners = new Set<() => void>(), emit = () => { version++; for (const fn of listeners) fn(); };
 return {
  log(level: 'info' | 'warn' | 'error', message: string) { lines = [...lines, {level, message, at: Date.now()}].slice(-200); emit(); },
  clear() { lines = []; emit(); },
  lines: () => lines,
  use() { useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => version); return lines; },
 };
})();

export function ScriptConsole({text:t,standalone=false}:{text(key:string):string;standalone?:boolean}) {
  const lines = scriptConsole.use(), end = useRef<HTMLDivElement>(null);
  useEffect(() => { if(end.current)end.current.scrollTop=end.current.scrollHeight; }, [lines]);
  return <section className={standalone ? "scripts-console dock-console" : "scripts-console"} aria-label={t('scripts.console')}>
   <div className="scripts-console-head">{!standalone&&<span>{t('scripts.console')}</span>}<button disabled={!lines.length} onClick={() => scriptConsole.clear()}>{t('scripts.clearConsole')}</button></div>
   <div ref={end} role="log" data-testid={standalone ? "preview-console" : "script-console"}>{lines.length ? lines.map((l, i) => <div key={i} className={`scripts-line ${l.level}`} data-level={l.level}>{l.message}</div>) : <div className="scripts-line muted">{t('scripts.consoleEmpty')}</div>}</div>
  </section>;
 }

/** Typing is saved (compiled, one undo step) after a short pause; Play and blur save immediately. */
let pending: (() => void) | null = null, timer: ReturnType<typeof setTimeout> | undefined;
export function flushScriptEdits() { clearTimeout(timer); const run = pending; pending = null; run?.(); }

export function uniqueScriptName(library: ScriptLibrary, base = 'Script') {
 const names = new Set(library.items.map(s => s.name.toLowerCase()));
 for (let i = 1; ; i++) { const name = i === 1 ? base : `${base} ${i}`; if (!names.has(name.toLowerCase())) return name; }
}
export function newScript(library: ScriptLibrary, name = uniqueScriptName(library), source = scriptTemplate) {
 return {id: crypto.randomUUID(), name, source, ...compileScript(source, name)};
}

/** Inspector fields per compiled code, read in a throwaway sandbox once the engine is loaded. */
const fieldCache = new Map<string, {fields: ParamField[]; error?: string}>();
let engineVersion = 0;
const engineListeners = new Set<() => void>();
function useScriptFields(script: Script | undefined, report: (error: unknown) => void) {
 useSyncExternalStore(fn => { engineListeners.add(fn); return () => { engineListeners.delete(fn); }; }, () => engineVersion);
 const engine = scriptEngineReady();
 useEffect(() => { if (!engine) void loadScriptEngine().then(() => { engineVersion++; for (const fn of engineListeners) fn(); }, report); }, [engine]);
 if (!script?.code || !engine) return null;
 let described = fieldCache.get(script.code);
 if (!described) { described = describeScript(engine, script.code, script.name); fieldCache.set(script.code, described); if (fieldCache.size > 200) fieldCache.delete(fieldCache.keys().next().value!); }
 return described;
}

export function createScriptViews(bridge: ScriptsBridge) {
 const t = bridge.text;
 const create = (name?: string, source?: string) => { const lib = bridge.library(), script = newScript(lib, name, source); bridge.change('New script', l => { l.items.push(script); }); setCurrent(script.id); return script; };

 function ScriptsPanel() {
  const library = bridge.useLibrary(), editable = bridge.useEditable(), sourceEditable = bridge.useSourceEditable?.() ?? editable, selection = bridge.useSelection(), selectedId = useCurrent();
  const script = library.items.find(s => s.id === selectedId) ?? library.items[0];
  const host = useRef<HTMLDivElement>(null), editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const currentScript = useRef<string | undefined>(undefined); currentScript.current = script?.id;
  const debugVersion = useSyncExternalStore(scriptDebugger.subscribe, scriptDebugger.snapshot);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  // A hit in another script shows that script.
  useEffect(() => { const hit = scriptDebugger.hit; if (hit && hit.scriptId !== currentScript.current && library.items.some(s => s.id === hit.scriptId)) { flushScriptEdits(); setCurrent(hit.scriptId); } }, [debugVersion]);
  const globals = bridge.useGlobals?.() ?? [], globalTypes = globals.map(g => `${g.name}:${g.type}:${g.type === "list" || g.type === "object" ? JSON.stringify(g.initial) : ""}`).join(",");
  useEffect(() => { configure(); const lib = typescriptDefaults.addExtraLib(globalsDeclaration(globals), 'file:///scripts/globals.d.ts'); return () => lib.dispose(); }, [globalTypes]);
  useEffect(() => {
   configure();
   void loadScriptEngine().catch(bridge.report);
   const instance = editor.current = monaco.editor.create(host.current!, {language: 'typescript', theme: dark() ? 'vs-dark' : 'vs', automaticLayout: true, minimap: {enabled: false}, glyphMargin: true, fontSize: 13, tabSize: 2, scrollBeyondLastLine: false, fixedOverflowWidgets: true, ariaLabel: t('scripts.editor')});
   const blur = instance.onDidBlurEditorText(flushScriptEdits);
   // Breakpoints: click the glyph margin left of the line numbers, or F9 on the cursor's line.
   const toggle = (line: number) => { const id = currentScript.current; if (id) scriptDebugger.toggle(id, line); };
   const gutter = instance.onMouseDown(e => { if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) toggle(e.target.position.lineNumber); });
   instance.addCommand(monaco.KeyCode.F9, () => { const at = instance.getPosition(); if (at) toggle(at.lineNumber); });
   return () => { flushScriptEdits(); blur.dispose(); gutter.dispose(); instance.dispose(); editor.current = null; };
  }, []);
  // One model per script (each is its own module); the editor shows the current one.
  useEffect(() => {
   const instance = editor.current;
   if (!instance) return;
   for (const s of library.items) { const model = monaco.editor.getModel(modelUri(s.id)); if (!model) monaco.editor.createModel(s.source, 'typescript', modelUri(s.id)); else if (model.getValue() !== s.source && !pending) model.setValue(s.source); }
   for (const model of monaco.editor.getModels()) if (model.uri.path.startsWith('/scripts/') && model.uri.path !== '/scripts/game-api.d.ts' && !library.items.some(s => model.uri.toString() === modelUri(s.id).toString())) model.dispose();
   const model = script ? monaco.editor.getModel(modelUri(script.id)) : null;
   if (instance.getModel() !== model) instance.setModel(model);
   instance.updateOptions({readOnly: !sourceEditable || !script});
  }, [library, script?.id, sourceEditable]);
  // Breakpoint dots and the paused line (after the editor has its model).
  useEffect(() => {
   const instance = editor.current; if (!instance) return;
   const id = script?.id, hit = scriptDebugger.hit, valid = scriptDebugger.controller ? scriptDebugger.valid.get(id ?? '') : undefined;
   const marks: monaco.editor.IModelDeltaDecoration[] = id ? scriptDebugger.lines(id).map(line => ({range: new monaco.Range(line, 1, line, 1), options: {glyphMarginClassName: valid && !valid.includes(line) ? 'script-breakpoint unverified' : 'script-breakpoint', glyphMarginHoverMessage: {value: t(valid && !valid.includes(line) ? 'scripts.breakpointInvalid' : 'scripts.breakpoint')}}})) : [];
   if (hit && hit.scriptId === id) { marks.push({range: new monaco.Range(hit.line, 1, hit.line, 1), options: {isWholeLine: true, className: 'script-hit-line'}}); instance.revealLineInCenterIfOutsideViewport(hit.line); }
   decorations.current?.clear(); decorations.current = instance.createDecorationsCollection(marks);
  }, [script?.id, debugVersion, library, editable]);
  useEffect(() => {
   const instance = editor.current;
   if (!instance || !script) return;
   const id = script.id, sub = instance.onDidChangeModelContent(() => {
    const source = instance.getValue();
    pending = () => { const lib = bridge.library(), item = lib.items.find(s => s.id === id); if (!item || item.source === source) return; const compiled = compileScript(source, item.name); bridge.change('Edit script', l => { const s = l.items.find(x => x.id === id); if (s) { s.source = source; s.code = compiled.code; if (compiled.error) s.error = compiled.error; else delete s.error; } }); };
    clearTimeout(timer); timer = setTimeout(flushScriptEdits, 400);
   });
   return () => sub.dispose();
  }, [script?.id]);
  const rename = (value: string) => {
   if (!script) return;
   const name = ScriptNameSchema.parse(value);
   if (library.items.some(s => s.id !== script.id && s.name.toLowerCase() === name.toLowerCase())) throw Error(t('scripts.nameTaken'));
   flushScriptEdits();
   const compiled = compileScript(script.source, name);
   bridge.change('Rename script', l => { const s = l.items.find(x => x.id === script.id)!; s.name = name; s.code = compiled.code; if (compiled.error) s.error = compiled.error; else delete s.error; });
   setRenaming(null);
  };
  const run = (work: () => void) => { try { work(); } catch (error) { bridge.report(error); } };
  return <div className="panel-body scripts-panel" data-testid="scripts-panel">
   <div className="scripts-toolbar">
    {renaming !== null && script
     ? <input aria-label={t('scripts.name')} value={renaming} autoFocus onChange={e => setRenaming(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(() => rename(renaming)); if (e.key === 'Escape') setRenaming(null); }} onBlur={() => run(() => rename(renaming))}/>
     : <select aria-label={t('scripts.script')} value={script?.id ?? ''} disabled={!library.items.length} onChange={e => { flushScriptEdits(); setCurrent(e.target.value); }}>{!library.items.length && <option value="">{t('scripts.none')}</option>}{library.items.map(s => <option key={s.id} value={s.id}>{s.error ? `⚠ ${s.name}` : s.name}</option>)}</select>}
    <button disabled={!editable} onClick={() => run(() => { flushScriptEdits(); create(); })}>{t('scripts.new')}</button>
    <select aria-label={t('scripts.fromTemplate')} value="" disabled={!editable} onChange={e => { const template = scriptTemplates.find(x => x.id === e.target.value); if (template) run(() => { flushScriptEdits(); create(uniqueScriptName(bridge.library(), template.name), template.source); }); }}><option value="">{t('scripts.fromTemplate')}</option>{scriptTemplates.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
    <button disabled={!editable || !script} onClick={() => setRenaming(script?.name ?? '')}>{t('scripts.rename')}</button>
    <button disabled={!editable || !script} onClick={() => run(() => { if (!script) return; flushScriptEdits(); bridge.change('Delete script', l => { l.items = l.items.filter(s => s.id !== script.id); }); setCurrent(''); })}>{t('scripts.delete')}</button>
   </div>
   <div className="scripts-attach">
    <span>{selection ? `${t('scripts.selected')}: ${selection.name}` : t('scripts.selectObject')}</span>
    <button disabled={!editable || !script || !selection || selection.scripted} onClick={() => run(() => { flushScriptEdits(); if (script) bridge.attach(script.id); })}>{selection?.scripted ? t('scripts.hasScript') : t('scripts.attach')}</button>
   </div>
   <SceneScript/>
   {script && <p className={`scripts-status${script.error ? ' error' : ''}`} role="status" data-testid="script-status">{script.error ?? t('scripts.compiled')}</p>}
   {!library.items.length && <p className="panel-empty">{t('scripts.empty')}</p>}
   <div className="scripts-editor" ref={host} data-testid="script-editor" hidden={!script}/>
   <DebuggerView/>
   <ScriptConsole text={t}/>
  </div>;
 }

 /** Breakpoints, the paused line's locals, watch expressions and every running script's state. */
 function DebuggerView() {
  useSyncExternalStore(scriptDebugger.subscribe, scriptDebugger.snapshot);
  const library = bridge.useLibrary(), c = scriptDebugger.controller, hit = scriptDebugger.hit, paused = Boolean(c?.paused());
  const [draft, setDraft] = useState(''), [live, setLive] = useState<{instances: DebugInstance[]; watches: string[]}>({instances: [], watches: []});
  const watchKey = scriptDebugger.watches.join('\n');
  useEffect(() => {
   if (!c) { setLive({instances: [], watches: []}); return; }
   const read = () => { try { setLive({instances: c.instances(), watches: c.watch(scriptDebugger.watches)}); } catch { /* session ended */ } };
   read(); const timer = setInterval(read, 250); return () => clearInterval(timer);
  }, [c, watchKey]);
  const name = (id: string) => library.items.find(s => s.id === id)?.name ?? id;
  const breakpoints = [...scriptDebugger.breakpoints].flatMap(([id, lines]) => lines.map(line => ({id, line, valid: !c || (scriptDebugger.valid.get(id) ?? []).includes(line)})));
  const add = () => { scriptDebugger.addWatch(draft); setDraft(''); };
  return <details className="scripts-debugger" open data-testid="script-debugger">
   <summary>{t('scripts.debugger')}</summary>
   <div className="scripts-debug-head">
    <span role="status" data-testid="debug-status">{hit ? t('scripts.pausedAt').replace('{where}', `${name(hit.scriptId)}:${hit.line}`).replace('{hook}', hit.hook || '—') : c ? t(paused ? 'scripts.debugPaused' : 'scripts.debugRunning') : t('scripts.debugIdle')}</span>
    <button disabled={!c || !paused} onClick={() => c?.resume()}>{t('scripts.continue')}</button>
    <button disabled={!c || !paused} onClick={() => c?.step()}>{t('scripts.stepFrame')}</button>
    <button disabled={!breakpoints.length} onClick={() => scriptDebugger.clear()}>{t('scripts.clearBreakpoints')}</button>
   </div>
   <div className="scripts-debug-grid">
    <section aria-label={t('scripts.breakpoints')}><h4>{t('scripts.breakpoints')}</h4>
     {breakpoints.length ? breakpoints.map(b => <div key={`${b.id}:${b.line}`} className="scripts-debug-row" data-valid={b.valid}><button className="link" onClick={() => { flushScriptEdits(); setCurrent(b.id); }}>{`${name(b.id)}:${b.line}`}</button>{!b.valid && <small>{t('scripts.breakpointInvalid')}</small>}<button aria-label={`${t('scripts.removeBreakpoint')} ${name(b.id)}:${b.line}`} onClick={() => scriptDebugger.toggle(b.id, b.line)}>×</button></div>) : <p className="panel-empty">{t('scripts.breakpointHelp')}</p>}
    </section>
    {hit && <section aria-label={t('scripts.locals')}><h4>{t('scripts.locals')}</h4>
     {Object.keys(hit.locals).length ? Object.entries(hit.locals).map(([k, v]) => <div key={k} className="scripts-debug-row" data-local={k}><code>{k}</code><span>{v}</span></div>) : <p className="panel-empty">{t('scripts.noLocals')}</p>}
    </section>}
    <section aria-label={t('scripts.watch')}><h4>{t('scripts.watch')}</h4>
     {scriptDebugger.watches.map((w, i) => <div key={w} className="scripts-debug-row" data-watch={w}><code>{w}</code><span>{hit?.watches[w] ?? live.watches[i] ?? '—'}</span><button aria-label={`${t('scripts.removeWatch')} ${w}`} onClick={() => scriptDebugger.removeWatch(w)}>×</button></div>)}
     <div className="scripts-debug-add"><input aria-label={t('scripts.watchExpression')} placeholder={t('scripts.watchHint')} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }}/><button disabled={!draft.trim()} onClick={add}>{t('scripts.addWatch')}</button></div>
    </section>
    <section aria-label={t('scripts.objects')}><h4>{t('scripts.objects')}</h4>
     {live.instances.length ? live.instances.map((o, i) => <div key={i} className="scripts-debug-row" data-object={o.object}><span>{`${o.object} · ${o.script}`}</span><code>{o.state}</code></div>) : <p className="panel-empty">{t(c ? 'scripts.noObjects' : 'scripts.objectsIdle')}</p>}
    </section>
   </div>
  </details>;
 }


/** Fields from the script's params export: per-object (or per-scene) values override the script's defaults. */
 function ParamsEditor({value, script, save, owner}: {value: Behaviour; script: Script | undefined; save(next: Behaviour): void; owner: string}) {
  const editable = bridge.useEditable(), entities = bridge.useEntities(), described = useScriptFields(script, bridge.report);
  if (!script || script.error) return null;
  if (!described) return <p className="panel-empty">{t('scripts.readingParams')}</p>;
  if (described.error) return <p className="component-warning">{described.error}</p>;
  const names = new Set(described.fields.map(f => f.name)), stale = [...Object.keys(value.params), ...Object.keys(value.refs)].filter(k => !names.has(k));
  const set = (name: string, v: number | string | boolean) => save({...value, params: {...value.params, [name]: v}});
  const reset = (name: string) => { const params = {...value.params}, refs = {...value.refs}; delete params[name]; delete refs[name]; save({...value, params, refs}); };
  return <div className="script-params" data-testid={`script-params-${owner}`}>
   {!described.fields.length && <p className="panel-empty">{t('scripts.noParams')}</p>}
   {described.fields.map(f => {
    const label = f.label ?? f.name, overridden = f.kind === 'object' ? f.name in value.refs : f.name in value.params, current = f.kind === 'object' ? value.refs[f.name] ?? '' : value.params[f.name] ?? f.default;
    return <div className="field script-param" key={f.name} data-param={f.name} data-overridden={overridden}>
     <span title={f.name}>{label}</span>
     <span className="script-param-input">
      {f.kind === 'number' && <NumberField label={label} value={Number(current)} field={f} disabled={!editable} commit={v => set(f.name, v)}/>}
      {f.kind === 'bool' && <input type="checkbox" aria-label={label} checked={Boolean(current)} disabled={!editable} onChange={e => set(f.name, e.target.checked)}/>}
      {f.kind === 'text' && <TextField label={label} value={String(current ?? '')} disabled={!editable} commit={v => set(f.name, v)}/>}
      {f.kind === 'color' && <TextField label={label} type="color" value={String(current ?? '#ffffff')} disabled={!editable} commit={v => set(f.name, v)}/>}
      {f.kind === 'choice' && <select aria-label={label} value={String(current)} disabled={!editable} onChange={e => set(f.name, e.target.value)}>{(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}</select>}
      {f.kind === 'object' && <select aria-label={label} value={String(current)} disabled={!editable} onChange={e => { if (!e.target.value) return reset(f.name); save({...value, refs: {...value.refs, [f.name]: e.target.value}}); }}><option value="">{t('scripts.noObject')}</option>{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}{current && !entities.some(e => e.id === current) && <option value={String(current)}>{t('scripts.missingObject')}</option>}</select>}
      {overridden && <button aria-label={`${t('scripts.resetParam')} ${label}`} title={t('scripts.resetParam')} disabled={!editable} onClick={() => reset(f.name)}>↺</button>}
     </span>
    </div>;
   })}
   {stale.map(k => <div className="field script-param stale" key={`stale-${k}`}><span>{k}</span><span className="script-param-input"><small>{t('scripts.unusedParam')}</small><button aria-label={`${t('scripts.removeParam')} ${k}`} disabled={!editable} onClick={() => reset(k)}>×</button></span></div>)}
  </div>;
 }
 function NumberField({label, value, field, disabled, commit}: {label: string; value: number; field: ParamField; disabled: boolean; commit(v: number): void}) {
  const [draft, setDraft] = useState<string | null>(null), shown = draft ?? String(value), slider = field.min !== undefined && field.max !== undefined;
  const done = (text: string) => { setDraft(null); let v = Number(text); if (!Number.isFinite(v)) return; if (field.min !== undefined) v = Math.max(field.min, v); if (field.max !== undefined) v = Math.min(field.max, v); if (v !== value) commit(v); };
  return <>
   {slider && <input type="range" aria-label={`${label} slider`} min={field.min} max={field.max} step={field.step ?? 'any'} value={Number(shown)} disabled={disabled} onChange={e => setDraft(e.target.value)} onPointerUp={e => done((e.target as HTMLInputElement).value)} onKeyUp={e => done((e.target as HTMLInputElement).value)}/>}
   <input type="number" aria-label={label} min={field.min} max={field.max} step={field.step ?? 'any'} value={shown} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={e => done(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') done((e.target as HTMLInputElement).value); }}/>
  </>;
 }
 function TextField({label, value, disabled, commit, type = 'text'}: {label: string; value: string; disabled: boolean; commit(v: string): void; type?: string}) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = () => { if (draft !== null && draft !== value) commit(draft); setDraft(null); };
  return <input type={type} aria-label={label} value={draft ?? value} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={done} onKeyDown={e => { if (e.key === 'Enter') done(); }}/>;
 }

 /** The open scene's script: runs for the whole scene (no object), with its own parameters. */
 function SceneScript() {
  const library = bridge.useLibrary(), editable = bridge.useEditable(), scene = bridge.useScene(), value = library.scenes?.[scene.id], script = library.items.find(s => s.id === value?.scriptId);
  const save = (next: Behaviour | null) => { try { bridge.change(next ? 'Edit scene script' : 'Remove scene script', l => { const scenes = {...l.scenes}; if (next) scenes[scene.id] = BehaviourSchema.parse(next); else delete scenes[scene.id]; l.scenes = scenes; }); } catch (error) { bridge.report(error); } };
  return <details className="scripts-scene" data-testid="scene-script" open={Boolean(value)}>
   <summary>{`${t('scripts.sceneScript')} · ${scene.name}${script ? ` · ${script.name}` : ''}`}</summary>
   <label className="field"><span>{t('scripts.sceneScript')}</span><select aria-label={t('scripts.sceneScript')} value={value?.scriptId ?? ''} disabled={!editable} onChange={e => { flushScriptEdits(); save(e.target.value ? {scriptId: e.target.value, params: {}, refs: {}} : null); }}><option value="">{t('scripts.noSceneScript')}</option>{library.items.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   {value?.scriptId && !script && <p className="component-warning">{t('scripts.missing')}</p>}
   {script?.error && <p className="component-warning">{script.error}</p>}
   {value && <ParamsEditor value={value} script={script} save={save} owner="scene"/>}
  </details>;
 }

 /** Script component: which script, its parameters, and a shortcut to the editor. */
 function ScriptInspector({entityId, component}: {entityId: string; component: {id: string; data: unknown}}) {
  const library = bridge.useLibrary(), editable = bridge.useEditable(), value = BehaviourSchema.parse(component.data), script = library.items.find(s => s.id === value.scriptId);
  const save = (next: Behaviour) => { try { bridge.setBehaviour(entityId, component.id, BehaviourSchema.parse(next)); } catch (error) { bridge.report(error); } };
  return <div className="script-inspector" data-testid="script-inspector">
   <label className="field"><span>{t('scripts.script')}</span><select aria-label={t('scripts.script')} value={value.scriptId} disabled={!editable} onChange={e => save({...value, scriptId: e.target.value})}><option value="">{t('scripts.choose')}</option>{library.items.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   {!value.scriptId && <p className="component-warning">{t('scripts.noScript')}</p>}
   {value.scriptId && !script && <p className="component-warning">{t('scripts.missing')}</p>}
   {script?.error && <p className="component-warning">{script.error}</p>}
   <ParamsEditor value={value} script={script} save={save} owner="object"/>
   <div className="panel-actions">
    {script ? <button onClick={() => { setCurrent(script.id); bridge.open(); }}>{t('scripts.edit')}</button>
     : <button disabled={!editable} onClick={() => { try { const created = create(); save({...value, scriptId: created.id}); bridge.open(); } catch (error) { bridge.report(error); } }}>{t('scripts.newAndEdit')}</button>}
   </div>
  </div>;
 }
 /** Shows a script in the Scripts panel (the panel opens through the bridge). */
 const openScript = (id: string) => { flushScriptEdits(); setCurrent(id); bridge.open(); };
 return {ScriptsPanel, ScriptInspector, ParamsEditor, openScript, createScript: create};
}
