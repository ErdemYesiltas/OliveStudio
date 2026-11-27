export type ScriptConsoleLine = {level: 'info' | 'warn' | 'error'; message: string; at: number};

/** Preview output of `game.log`/`console` and script errors, shown under the editor (last 200 lines). */
export const scriptConsole = (() => {
 let lines: readonly ScriptConsoleLine[] = [], version = 0;
 const listeners = new Set<() => void>(), emit = () => { version++; for (const fn of listeners) fn(); };
 return {
  log(level: 'info' | 'warn' | 'error', message: string) { lines = [...lines, {level, message, at: Date.now()}].slice(-200); emit(); },
  clear() { lines = []; emit(); },
  replace(output: readonly ScriptConsoleLine[]) { lines = output; emit(); },
  lines: () => lines,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  snapshot: () => version,
 };
})();
