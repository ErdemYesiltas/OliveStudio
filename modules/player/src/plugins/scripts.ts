import {createSceneScripts,connectScriptServices,scriptLanguage,loadScriptEngine,type ScriptHost,type ScriptSession,type ScriptExtension} from '@rewrite/scripts/session';
import {ScriptLibrarySchema, emptyLibrary, scriptsSection} from '@rewrite/scripts/contracts';
import {GlobalsSchema, defaultGlobals, globalsSection} from '@rewrite/interactions';
import {InputMapSchema, defaultInputMap, inputSection} from '@rewrite/input';
import type {QuickJSWASMModule} from 'quickjs-emscripten-core';
import type {PlayerPlugin} from '../plugin';
/**
 * Behaviour scripts for exported games: the QuickJS engine loads before Start, each scene gets its own sandbox.
 * Script errors stop only that script and go to the browser console; they never end the game.
 */
export default {id: 'scripts', create(c) {
 const project = c.bundle.project, library = ScriptLibrarySchema.parse(project.extensions[scriptsSection] ?? emptyLibrary());
 const names = {
  globals: GlobalsSchema.parse(project.extensions[globalsSection] ?? defaultGlobals).items.map(g => ({id: g.id, name: g.name})),
  scenes: project.scenes.map(s => ({id: s.id, name: s.name})),
  actions: InputMapSchema.parse(project.extensions[inputSection] ?? defaultInputMap).actions.map(a => ({id: a.id, name: a.name})),
 };
 let engine: QuickJSWASMModule | undefined, session: ScriptSession | undefined;
 c.pointer((phase, x, y) => { session?.pointer(phase, x, y); return false; });
 const controls=connectScriptServices({
  physics:()=>c.services.get('physics') as ScriptHost['physics'],
  navigation:()=>c.services.get('navigation') as ScriptHost['navigation'],
  dialogue:()=>c.services.get('dialogue') as ScriptHost['dialogue'],
  achievements:()=>c.services.get('achievements') as ScriptHost['achievements'],
  audio:()=>c.controllers.get('audio') as ScriptHost['audio'],
  animation:()=>c.controllers.get('animation') as ScriptHost['animation'],
 });
 const log = (level: 'info' | 'warn' | 'error', message: string) => { console[level === 'info' ? 'log' : level](`[script] ${message}`); c.publish({type: 'script.log', value: {level, message}}); };
 return {
  async init() { engine = await loadScriptEngine(); c.services.set('scripts.session', () => session); },
  systems(scene) {
   session?.dispose(); session = undefined;
   if (!engine) throw Error('The script engine did not load');
   const next=createSceneScripts(engine,library,scene,{
    ...controls,language:scriptLanguage(()=>c.language?.(),c.globals),
    extensions:c.services.get('scripts.extensions') as ScriptExtension[]|undefined,
    emit:c.emit,entities:c.entities,time:c.time,stage:project.stage??{width:960,height:540},names,globals:c.globals(),
    camera:c.camera,spawn:c.spawn,destroy:c.destroy,setActive:c.setActive,changeScene:c.changeScene,
    addScene:c.addScene,removeScene:c.removeScene,invoke:c.invoke,log,
   },message=>log('error',message));
   if (!next.count && !library.items.length) { next.dispose(); return []; }
   session = next;
   return [next.system];
  },
  interaction(event) { session?.observe(event); },
  listens: (type, id) => session?.listens(type, id) ?? false,
  event(e) { if (e.type === 'script.message') { const v = e.value as {message: string; data?: unknown}; session?.broadcast(v.message, v.data ?? null); } },
  clear() { session = undefined; },
  dispose() { session?.dispose(); session = undefined; },
 };
}} satisfies PlayerPlugin;
