import {type DialogueSession, dialogueActions, readLibrary, dialogueSection} from '@rewrite/dialogue';
import {createSceneDialogue} from '@rewrite/dialogue/box';
import type {PlayerPlugin} from '../plugin';
/**
 * Dialogues for exported games: one session per scene with the on-screen box, Start / Stop dialogue rules,
 * `dialogue.event` / `dialogue.end` events and the `dialogue` service scripts use.
 */
export default {id: 'dialogue', create(c) {
 const library = () => readLibrary(c.bundle.project.extensions[dialogueSection]);
 let session:DialogueSession|undefined;
 const close=()=>{session=undefined;c.services.delete('dialogue');};
 return {
  systems(){
   const runtime=createSceneDialogue({
    library,globals:c.globals,emit:c.emit,silent:()=>c.simulation.paused,
    localize:(key,count)=>c.language?.()?.text(key,{...c.globals()?.snapshot(),...(count===undefined?{}:{count})}),
   },c.host);
   session=runtime.session;
   c.services.set('dialogue',session);
   return [runtime.system];
  },
  actions: dialogueActions(library, () => session),
  clear: close,
  dispose: close,
 };
}} satisfies PlayerPlugin;
