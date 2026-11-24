import {shouldInterruptAfterDeadline, type QuickJSWASMModule} from 'quickjs-emscripten-core';
import {loadScriptEngine, scriptEngineReady} from '@rewrite/scripts/session';
import type {MachineInfo} from '@rewrite/behavior/contracts';
import type {BehaviorProvider} from '@rewrite/behavior';
import {xstateSource, xstateVersion} from './index';

// Editor only: XState's declarations for the script editor (never part of a game).
const declarationFiles = import.meta.glob('../node_modules/xstate/dist/declarations/src/**/*.d.ts', {query: '?raw', import: 'default', eager: true}) as Record<string, string>;
/** Monaco extra libraries: XState's types as \`xstate\` plus the \`behavior\` script API. */
export const xstateEditorLibraries = (): {uri: string; source: string}[] => [
 ...Object.entries(declarationFiles).map(([path, source]) => ({uri: `file:///node_modules/xstate/${path.replace(/^.*?node_modules\/xstate\//, '')}`, source})),
 {uri: 'file:///node_modules/xstate/package.json', source: JSON.stringify({name: 'xstate', version: xstateVersion, types: 'dist/declarations/src/index.d.ts'})},
 {uri: 'file:///scripts/behavior-api.d.ts', source: `/** XState v5 (state machines for Behavior components). */
declare const xstate: typeof import('xstate');
/** Running behaviors of the scene's objects. */
declare const behavior: {
  /** Send an event to an object's behavior: behavior.send(enemy, 'hit', {damage: 2}). */
  send(target: GameObject | string, event: string | {type: string; [key: string]: unknown}, data?: Record<string, unknown>): boolean;
  /** Active leaf states, e.g. ['movement.walking', 'attack.ready']. */
  states(target: GameObject | string): string[];
  /** Whether a state path (or one of its children) is active. */
  matches(target: GameObject | string, path: string): boolean;
  /** The actor's snapshot (read only: change it through events). */
  checkpoint(target: GameObject | string): {formatVersion:1;machineId:string;dataVersion:number;data:unknown};
  restore(target:GameObject | string,value:{formatVersion:1;machineId:string;dataVersion:number;data:unknown}):unknown;
  snapshot(target: GameObject | string): import('xstate').AnyMachineSnapshot | null;
};
/** What a machine's context factory receives: context: ({input}) => ({...}). */
interface BehaviorInput { self: GameObject; params: Record<string, unknown> }
`},
];

/**
 * Reads a machine script without running a game: evaluates it next to XState in a throwaway sandbox (no `game`; `param`
 * returns defaults) and reports the machine's id, version, state paths, initial states and handled event types.
 */
export function describeMachine(module: QuickJSWASMModule, code: string, name = 'script'): MachineInfo {
 const runtime = module.newRuntime();
 runtime.setMemoryLimit(32 * 1024 * 1024); runtime.setMaxStackSize(512 * 1024);
 runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 500));
 const vm = runtime.newContext();
 const empty = (error: string): MachineInfo => ({id: '', version: null, states: [], initial: [], events: [], error});
 try {
  const stubs = vm.evalCode('globalThis.console = {log() {}, warn() {}, error() {}}; globalThis.setTimeout = globalThis.setInterval = () => 0; globalThis.clearTimeout = globalThis.clearInterval = () => {};', 'stubs.js');
  if (stubs.error) stubs.error.dispose(); else stubs.value.dispose();
  const lib = vm.evalCode(xstateSource, 'xstate.js');
  if (lib.error) { const e = vm.dump(lib.error) as {message?: string}; lib.error.dispose(); return empty(`XState did not load: ${e?.message ?? String(e)}`); }
  lib.value.dispose();
  const result = vm.evalCode(`"use strict";
globalThis.xstate = globalThis.XState;
globalThis.param = {number: (v = 0) => v, bool: (v = false) => v, text: (v = '') => v, color: (v = '#ffffff') => v, choice: (options, v) => v === undefined ? Array.from(options || [])[0] : v, object: () => null};
globalThis.game = new Proxy({}, {get() { throw new Error('game is only available while the game runs'); }});
globalThis.behavior = globalThis.game;
const module = {exports: {}};
(function (exports, module) {${code}\n})(module.exports, module);
const m = module.exports.machine;
if (!m || typeof m.provide !== 'function' || !m.root) throw new Error('no machine export (export const machine = xstate.setup({...}).createMachine({...}))');
const states = [], events = new Set();
const visit = node => { for (const t of Object.keys(node.config.on || {})) if (t && !t.startsWith('xstate.')) events.add(t); for (const child of Object.values(node.states || {})) { states.push(child.path.join('.')); visit(child); } };
visit(m.root);
const leaves = (value, prefix) => typeof value === 'string' ? [prefix ? prefix + '.' + value : value] : Object.entries(value || {}).flatMap(([k, v]) => { const here = prefix ? prefix + '.' + k : k; const inner = leaves(v, here); return inner.length ? inner : [here]; });
let initial = [];
try { initial = leaves(m.getInitialSnapshot({self: {send() {}}}, {self: new Proxy({}, {get: () => 0}), params: {}}).value, ''); } catch {}
JSON.stringify({id: m.id, version: m.version == null ? null : String(m.version), states, initial, events: [...events].sort()});`, `${name}.ts`);
  if (result.error) { const e = vm.dump(result.error) as {message?: string}; result.error.dispose(); return empty(`${name}: ${e?.message ?? String(e)}`); }
  const info = JSON.parse(vm.getString(result.value)) as MachineInfo; result.value.dispose();
  return info;
 } finally { vm.dispose(); runtime.dispose(); }
}

/** The Behavior provider the editor module uses: XState v5 machines read in the shared script engine. */
export const xstateBehaviorProvider: BehaviorProvider = {
 id: 'xstate', version: xstateVersion,
 describe: (code, name) => { const engine = scriptEngineReady(); if (!engine) { void loadScriptEngine(); return null; } return describeMachine(engine, code, name); },
 prepare: async () => { await loadScriptEngine(); },
};
