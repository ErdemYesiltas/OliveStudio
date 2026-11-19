/**
 * In-game debug overlay (F3): frame rate and time, objects, scene, physics, motion, audio, scripts, timers and
 * globals, drawn as a small DOM panel over the game. Shared by Preview and exported games (where the project opts in).
 */
export interface DebugStats {
 scene: string; objects: {active: number; total: number}; bodies?: number; tweens?: number; animations?: number; voices?: number; scripts?: number; timers?: number;
 globals?: Record<string, unknown>;
}
const style = 'position:absolute;left:8px;top:8px;z-index:20;pointer-events:none;font:11px/1.45 ui-monospace,Menlo,monospace;color:#e8f6ff;background:rgba(8,12,20,.78);border:1px solid rgba(124,243,255,.35);border-radius:6px;padding:6px 8px;white-space:pre;max-width:46%;max-height:70%;overflow:hidden';
export function createDebugOverlay(host: HTMLElement, read: () => DebugStats | null) {
 const panel = document.createElement('div');
 panel.setAttribute('role', 'status'); panel.setAttribute('aria-label', 'Debug overlay'); panel.dataset.debugOverlay = 'true'; panel.style.cssText = style; panel.hidden = true;
 if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
 host.appendChild(panel);
 let frames: number[] = [], last = 0;
 const api = {
  get visible() { return !panel.hidden; },
  toggle(force?: boolean) { panel.hidden = !(force ?? panel.hidden); if (!panel.hidden) api.frame(performance.now(), true); host.dataset.debugOverlay = String(!panel.hidden); },
  /** Call once per drawn frame; refreshes the text about four times a second. */
  frame(now = performance.now(), force = false) {
   if (frames.length && now - frames[frames.length - 1] > 1000) frames = [];
   frames.push(now); if (frames.length > 120) frames.shift();
   if (panel.hidden || (!force && now - last < 250)) return;
   last = now;
   const s = read(), span = frames.length > 1 ? (frames[frames.length - 1] - frames[0]) / (frames.length - 1) : 0, fps = span > 0 ? Math.round(1000 / span) : 0;
   if (!s) { panel.textContent = `FPS ${fps}`; return; }
   const lines = [`FPS ${fps}  ·  ${span.toFixed(1)} ms`, `Scene ${s.scene}`, `Objects ${s.objects.active} / ${s.objects.total}`];
   const counts = ([['Bodies', s.bodies], ['Tweens', s.tweens], ['Animations', s.animations], ['Voices', s.voices], ['Scripts', s.scripts], ['Timers', s.timers]] as const).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} ${v}`);
   if (counts.length) lines.push(counts.join('  ·  '));
   const globals = Object.entries(s.globals ?? {});
   if (globals.length) lines.push('', ...globals.slice(0, 12).map(([k, v]) => `${k} = ${typeof v === 'string' ? JSON.stringify(v) : v}`), ...(globals.length > 12 ? [`… ${globals.length - 12} more`] : []));
   panel.textContent = lines.join('\n');
   host.dataset.debugStats = JSON.stringify({fps, ...s, globals: undefined});
  },
  dispose() { panel.remove(); delete host.dataset.debugOverlay; delete host.dataset.debugStats; },
 };
 return api;
}
