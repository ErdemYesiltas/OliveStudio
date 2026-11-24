import {InputSession, InputMapSchema, defaultInputMap, inputSection} from '@rewrite/input';
import type {PlayerPlugin} from '../plugin';
/** Input map for exported games: listens after Start, polls gamepads every frame, releases everything when hidden. */
export default {id: 'input', create(c) {
 const map = InputMapSchema.parse(c.bundle.project.extensions[inputSection] ?? defaultInputMap);
 let session: InputSession | undefined, detach: (() => void) | undefined;
 return {
  unlock() {
   if (session) return;
   session = new InputSession(map, {emit: e => c.emit(e), setGlobal: (id, value) => { try { c.globals()?.set(id, value); } catch (e) { c.report(String(e)); } }});
   c.services.set('input',session);
   detach = session.attach(document.documentElement);
  },
  systems: () => [{id: 'input', update: () => session?.update(), dispose() {}}],
  dispose() { c.services.delete('input');detach?.(); detach = undefined; session = undefined; },
 };
}} satisfies PlayerPlugin;
