/**
 * Preview profiler: one sample per drawn frame (frame and render time, per-system milliseconds, draw calls, objects,
 * JS heap), kept in a fixed-size ring, and the summaries the Profiler panel shows.
 */
export interface ProfileSample {
 /** performance.now() when the frame was drawn. */
 time: number;
 /** Time since the previous frame (what the player feels). */
 frameMs: number;
 /** Drawing the scene (Pixi render). */
 renderMs: number;
 /** Milliseconds per runtime system in this frame (`scripts`, `physics`, …). */
 systems: Record<string, number>;
 drawCalls: number;
 objects: number;
 /** Fixed 60 Hz steps this frame ran (more than one means the game is catching up). */
 steps: number;
 heapMb?: number;
}
export const categories = ['scripts', 'physics', 'animation', 'audio', 'logic', 'render', 'idle'] as const;
export type Category = typeof categories[number];
export const categoryColors: Record<Category, string> = {scripts: '#f2b84b', physics: '#5bc0eb', animation: '#c38df2', audio: '#7bd389', logic: '#f2798f', render: '#9aa7b8', idle: 'transparent'};
const bySystem: Record<string, Exclude<Category, 'render' | 'idle'>> = {scripts: 'scripts', physics: 'physics', motion: 'physics', animation: 'animation', tween: 'animation', audio: 'audio'};
/** Which bar colour a runtime system belongs to; anything unknown (timers, input, rules…) counts as logic. */
export const categoryOf = (system: string): Exclude<Category, 'render' | 'idle'> => bySystem[system] ?? 'logic';
/** Milliseconds per category in one frame; `idle` is the rest of the frame (waiting for the display). */
export function breakdown(sample: ProfileSample): Record<Category, number> {
 const out = Object.fromEntries(categories.map(c => [c, 0])) as Record<Category, number>;
 for (const [id, ms] of Object.entries(sample.systems)) out[categoryOf(id)] += ms;
 out.render = sample.renderMs;
 out.idle = Math.max(0, sample.frameMs - categories.slice(0, -1).reduce((sum, c) => sum + out[c], 0));
 return out;
}
/** Ring buffer of the last `capacity` frames. */
export class ProfileRecorder {
 private ring: ProfileSample[] = [];
 private listeners = new Set<() => void>();
 private capturePaused=false;
 get paused(){return this.capturePaused;}
 set paused(value:boolean){if(value===this.capturePaused)return;this.capturePaused=value;for(const listener of this.listeners)listener();}
 readonly capacity: number;
 constructor(capacity = 600) { this.capacity = capacity; }
 push(sample: ProfileSample) {
  if (this.paused || !Number.isFinite(sample.frameMs) || sample.frameMs < 0) return;
  this.ring.push(sample); if (this.ring.length > this.capacity) this.ring.splice(0, this.ring.length - this.capacity);
  for (const l of this.listeners) l();
 }
 samples(): readonly ProfileSample[] { return this.ring; }
 clear() { this.ring = []; for (const l of this.listeners) l(); }
 subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}
const percentile = (sorted: readonly number[], p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;
export interface SystemStat {id: string; category: Category; average: number; max: number; share: number}
export interface ProfileSummary {
 frames: number; fps: number; average: number; p95: number; worst: number;
 /** Frames over the budget (1000 / target fps, with a little slack for timer jitter). */
 spikes: number; drawCalls: number; objects: number; heapMb?: number; catchUp: number;
 systems: SystemStat[];
}
/** Averages over the given frames; `target` is the display rate the budget is measured against. */
export function summarize(samples: readonly ProfileSample[], target = 60): ProfileSummary {
 const n = samples.length, frame = samples.map(s => s.frameMs).sort((a, b) => a - b), sum = frame.reduce((a, b) => a + b, 0), budget = 1000 / target * 1.25;
 const totals = new Map<string, {sum: number; max: number}>();
 const add = (id: string, ms: number) => { const t = totals.get(id) ?? {sum: 0, max: 0}; t.sum += ms; t.max = Math.max(t.max, ms); totals.set(id, t); };
 for (const s of samples) { for (const [id, ms] of Object.entries(s.systems)) add(id, ms); add('render', s.renderMs); }
 const work = [...totals.values()].reduce((a, t) => a + t.sum, 0);
 const last = samples[n - 1];
 return {
  frames: n, fps: sum > 0 ? Math.round(n * 1000 / sum) : 0, average: n ? sum / n : 0, p95: percentile(frame, .95), worst: frame[n - 1] ?? 0,
  spikes: samples.filter(s => s.frameMs > budget).length, catchUp: samples.filter(s => s.steps > 1).length,
  drawCalls: n ? Math.round(samples.reduce((a, s) => a + s.drawCalls, 0) / n) : 0, objects: last?.objects ?? 0, heapMb: last?.heapMb,
  systems: [...totals].map(([id, t]) => ({id, category: id === 'render' ? 'render' as const : categoryOf(id), average: n ? t.sum / n : 0, max: t.max, share: work > 0 ? t.sum / work : 0})).sort((a, b) => b.average - a.average),
 };
}
/** CSV of the captured frames, one column per system that appeared. */
export function toCsv(samples: readonly ProfileSample[]) {
 const ids = [...new Set(samples.flatMap(s => Object.keys(s.systems)))].sort();
 const head = ['frame', 'time_ms', 'frame_ms', 'render_ms', ...ids.map(id => `${id}_ms`), 'draw_calls', 'objects', 'steps', 'heap_mb'];
 const f = (v: number | undefined) => v === undefined ? '' : String(Math.round(v * 1000) / 1000);
 const t0 = samples[0]?.time ?? 0;
 return [head.join(','), ...samples.map((s, i) => [String(i), f(s.time - t0), f(s.frameMs), f(s.renderMs), ...ids.map(id => f(s.systems[id] ?? 0)), String(s.drawCalls), String(s.objects), String(s.steps), f(s.heapMb)].join(','))].join('\n') + '\n';
}
/** Counts WebGL draw calls by wrapping the context's draw functions; returns a reader that resets the count. */
export function countDrawCalls(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined) {
 let calls = 0;
 if (!gl) return {take: () => 0, dispose() {}};
 const names = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const, target = gl as unknown as Record<string, unknown>, originals = new Map<string, unknown>();
 for (const name of names) {
  const original = target[name];
  if (typeof original !== 'function' || Object.prototype.hasOwnProperty.call(target, name)) continue;
  originals.set(name, original);
  target[name] = function (this: unknown, ...args: unknown[]) { calls++; return (original as (...a: unknown[]) => unknown).apply(this, args); };
 }
 return {take() { const n = calls; calls = 0; return n; }, dispose() { for (const name of originals.keys()) delete target[name]; originals.clear(); }};
}
