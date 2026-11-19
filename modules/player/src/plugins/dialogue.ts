import {DialogueSession, dialogueActions, readLibrary, dialogueSection} from '@rewrite/dialogue';
import {createDialogueBox} from '@rewrite/dialogue/box';
import type {PlayerPlugin} from '../plugin';
/**
 * Dialogues for exported games: one session per scene with the on-screen box, Start / Stop dialogue rules,
 * `dialogue.event` / `dialogue.end` events and the `dialogue` service scripts use.
 */
export default {id: 'dialogue', create(c) {
 const library = () => readLibrary(c.bundle.project.extensions[dialogueSection]);
 let session: DialogueSession | undefined, box: ReturnType<typeof createDialogueBox> | undefined;
 const close = () => { box?.dispose(); box = undefined; session?.dispose(); session = undefined; c.services.delete('dialogue'); };
 return {
  systems() {
   close();
   session = new DialogueSession({library, globals: () => c.globals(), emit: e => c.emit(e), silent: () => false, localize: key => c.language?.()?.text(key)});
   if (c.host) box = createDialogueBox(c.host, session);
   const s = session;
   c.services.set('dialogue', {name: (id: string) => library().items.find(d => d.id === id)?.name, start: (id: string) => s.start(id), advance: () => s.advance(), choose: (i: number) => s.choose(i), stop: () => s.stop(), view: () => s.view()});
   return [{id: 'dialogue', dispose() {}}];
  },
  actions: dialogueActions(library, () => session),
  clear: close,
  dispose: close,
 };
}} satisfies PlayerPlugin;
