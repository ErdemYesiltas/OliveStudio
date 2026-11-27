import type {DebugHit, DebugInstance} from './session';

/** What the running Preview offers the debugger view (absent while editing). */
export type DebugSettings = { breakpoints: Record<string, number[]>; watches: string[] };

export interface DebugController {resume(): void; step(): void; instances(): DebugInstance[]; watch(expressions: readonly string[]): string[]; paused(): boolean}

/**
 * Editor-only debugger state shared by the Scripts panel and the Preview session: breakpoints per script (this
 * computer only, never in the project), watch expressions, the last hit and the running session's controls.
 */
class ScriptDebugger {
 readonly breakpoints = new Map<string, number[]>();
 /** Lines that can stop, per script, as the running session reported them. */
 valid = new Map<string, number[]>();
 watches: string[] = [];
 hit: DebugHit | null = null;
 controller: DebugController | null = null;
 private version = 0;
 private listeners = new Set<() => void>();
 constructor() { try { const raw = JSON.parse(localStorage.getItem('rewrite:script-debugger') ?? '{}') as {breakpoints?: Record<string, number[]>; watches?: string[]}; for (const [id, lines] of Object.entries(raw.breakpoints ?? {})) this.breakpoints.set(id, lines); this.watches = raw.watches ?? []; } catch { /* no saved debugger state */ } }
 subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
 snapshot = () => this.version;
 private changed(save = false) {
  this.version++;
  if (save) try { localStorage.setItem('rewrite:script-debugger', JSON.stringify({breakpoints: Object.fromEntries(this.breakpoints), watches: this.watches})); } catch { /* storage unavailable */ }
  for (const fn of this.listeners) fn();
 }
 settings(): DebugSettings { return {breakpoints: Object.fromEntries(this.breakpoints), watches: this.watches}; }
 setSettings(settings: DebugSettings) {
  if (JSON.stringify(this.settings()) === JSON.stringify(settings)) return;
  this.breakpoints.clear();
  for (const [id, lines] of Object.entries(settings.breakpoints)) this.breakpoints.set(id, lines);
  this.watches = settings.watches;
  this.changed(true);
 }
 lines(scriptId: string) { return this.breakpoints.get(scriptId) ?? []; }
 toggle(scriptId: string, line: number) {
  const lines = this.lines(scriptId), next = lines.includes(line) ? lines.filter(l => l !== line) : [...lines, line].sort((a, b) => a - b);
  if (next.length) this.breakpoints.set(scriptId, next); else this.breakpoints.delete(scriptId);
  this.changed(true);
 }
 clear() { this.breakpoints.clear(); this.changed(true); }
 addWatch(expression: string) { const e = expression.trim(); if (!e || this.watches.includes(e)) return; this.watches = [...this.watches, e]; this.changed(true); }
 removeWatch(expression: string) { this.watches = this.watches.filter(w => w !== expression); this.changed(true); }
 setHit(hit: DebugHit | null) { this.hit = hit; this.changed(); }
 setValid(valid: Record<string, number[]>) { this.valid = new Map(Object.entries(valid)); this.changed(); }
 attach(controller: DebugController | null) { this.controller = controller; if (!controller) { this.hit = null; this.valid = new Map(); } this.changed(); }
 /** Re-render listeners (e.g. after pause/resume). */
 refresh() { this.changed(); }
}
export const scriptDebugger = new ScriptDebugger();
