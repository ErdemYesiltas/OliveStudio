import {ScriptSession, loadScriptEngine, type AudioControls, type TimelineControls, type ScriptPhysics, type ScriptNavigation, type ScriptExtension} from '@rewrite/scripts/session';
import {ScriptLibrarySchema, emptyLibrary, scriptsSection} from '@rewrite/scripts/contracts';
import {GlobalsSchema, defaultGlobals, globalsSection} from '@rewrite/interactions';
import {InputMapSchema, defaultInputMap, inputSection} from '@rewrite/input';
import type {QuickJSWASMModule} from 'quickjs-emscripten-core';
import type {PlayerPlugin} from '../plugin';
/**
 * Behaviour scripts for exported games: the QuickJS engine loads before Start, each scene gets its own sandbox.
 * Script errors stop only that script and go to the browser console; they never end the game.
 */
/** Scripts reach physics through the 'physics' service of the physics plugin (looked up per call: scenes replace it). */
const physicsFor = (c: Parameters<PlayerPlugin['create']>[0]): ScriptPhysics => {
 const get = () => { const p = c.services.get('physics') as ScriptPhysics | undefined; if (!p) throw Error('Physics is not running in this scene'); return p; };
 return {setVelocity: (id, x, y) => get().setVelocity(id, x, y), setAngularVelocity: (id, d) => get().setAngularVelocity(id, d), applyForce: (id, x, y) => get().applyForce(id, x, y), applyImpulse: (id, x, y) => get().applyImpulse(id, x, y), teleport: (id, x, y) => get().teleport(id, x, y), body: id => get().body(id), gravity: () => get().gravity(), setGravity: (x, y) => get().setGravity(x, y), raycast: (...a) => get().raycast(...a), objectsAt: (x, y) => get().objectsAt(x, y), objectsIn: (...a) => get().objectsIn(...a)};
};
/** Pathfinding through the 'navigation' service of the navigation plugin (only when the game has a Nav Grid). */
const navigationFor = (c: Parameters<PlayerPlugin['create']>[0]): ScriptNavigation => {
 const get = () => { const n = c.services.get('navigation') as ScriptNavigation | undefined; if (!n) throw Error('Navigation is not running in this scene (add a Nav Grid)'); return n; };
 return {findPath: (...a) => get().findPath(...a), moveTo: (id, x, y) => get().moveTo(id, x, y), follow: (id, t) => get().follow(id, t), stop: id => get().stop(id), walkable: (x, y) => get().walkable(x, y), rebuild: () => get().rebuild(), state: id => get().state(id)};
};
/** Achievements through the achievements plugin's service. */
const achievementsFor = (c: Parameters<PlayerPlugin['create']>[0]) => {
 type A = {unlock(k: string): boolean; unlocked(k: string): boolean; submit(b: string, s: number, n?: string): number; top(b: string): {name: string; score: number}[]; list(): {id: string; name: string; unlocked: boolean}[]};
 const get = () => { const a = c.services.get('achievements') as A | undefined; if (!a) throw Error('This game has no achievements'); return a; };
 return {unlock: (k: string) => get().unlock(k), unlocked: (k: string) => get().unlocked(k), submit: (b: string, s: number, n?: string) => get().submit(b, s, n), top: (b: string) => get().top(b), list: () => get().list()};
};
/** Dialogues through the dialogue plugin's 'dialogue' service. */
const dialogueFor = (c: Parameters<PlayerPlugin['create']>[0]) => {
 type D = {name(id: string): string | undefined; start(id: string): void; advance(): void; choose(i: number): void; stop(): void; view(): {dialogue: string; speaker: string; text: string; choices: {text: string}[]} | null};
 const get = () => { const d = c.services.get('dialogue') as D | undefined; if (!d) throw Error('This game has no dialogues'); return d; };
 return {name: (id: string) => (c.services.get('dialogue') as D | undefined)?.name(id), start: (id: string) => get().start(id), advance: () => get().advance(), choose: (i: number) => get().choose(i), stop: () => get().stop(), view: () => (c.services.get('dialogue') as D | undefined)?.view() ?? null};
};
export default {id: 'scripts', create(c) {
 const project = c.bundle.project, library = ScriptLibrarySchema.parse(project.extensions[scriptsSection] ?? emptyLibrary());
 const names = {
  globals: GlobalsSchema.parse(project.extensions[globalsSection] ?? defaultGlobals).items.map(g => ({id: g.id, name: g.name})),
  scenes: project.scenes.map(s => ({id: s.id, name: s.name})),
  actions: InputMapSchema.parse(project.extensions[inputSection] ?? defaultInputMap).actions.map(a => ({id: a.id, name: a.name})),
 };
 let engine: QuickJSWASMModule | undefined, session: ScriptSession | undefined;
 c.pointer((phase, x, y) => { session?.pointer(phase, x, y); return false; });
 /** The animation controller comes from another plugin and may be created after this one: look it up per call. */
 const animation = () => { const a = c.controllers.get('animation') as unknown as Partial<TimelineControls> | undefined; if (!a?.state) throw Error('Timelines are unavailable'); return a as TimelineControls; };
 const audio = () => { const a = c.controllers.get('audio') as unknown as Partial<AudioControls> | undefined; if (!a?.fade) throw Error('Audio is unavailable'); return a as AudioControls; };
 const sounds: AudioControls = {play: id => audio().play(id), stop: id => audio().stop(id), fade: (id, to, s, stop) => audio().fade(id, to, s, stop), setBus: (bus, v) => audio().setBus(bus, v), bus: bus => audio().bus(bus), state: id => audio().state(id)};
 const timelines: TimelineControls = {play: (id, clip, fade) => animation().play(id, clip, fade), pause: id => animation().pause(id), resume: id => animation().resume(id), seekPlayer: (id, t) => animation().seekPlayer(id, t), setSpeed: (id, v) => animation().setSpeed(id, v), reverse: id => animation().reverse(id), state: id => animation().state(id)};
 const log = (level: 'info' | 'warn' | 'error', message: string) => { console[level === 'info' ? 'log' : level](`[script] ${message}`); c.publish({type: 'script.log', value: {level, message}}); };
 return {
  async init() { engine = await loadScriptEngine(); c.services.set('scripts.session', () => session); },
  systems(scene) {
   session?.dispose(); session = undefined;
   if (!engine) throw Error('The script engine did not load');
   const next = new ScriptSession(engine, library, {extensions: c.services.get('scripts.extensions') as ScriptExtension[] | undefined, emit: e => c.emit(e), entities: c.entities, time: c.time, stage: project.stage ?? {width: 960, height: 540}, scene: {name: scene.name, behaviour: library.scenes?.[scene.id]}, names, standby: library.items.length > 0, globals: c.globals(), physics: physicsFor(c), navigation: navigationFor(c), dialogue: dialogueFor(c), achievements: achievementsFor(c), language: {current: () => c.language?.()?.language ?? '', set: id => { const l = c.language?.(); if (!l) throw Error('This game has no localization'); l.setLanguage(id); }, t: (key, values) => c.language?.()?.text(key, {...c.globals()?.snapshot(), ...values as Record<string, string | number>})}, animation: timelines, audio: sounds, camera: c.camera, spawn: c.spawn, destroy: c.destroy, setActive: c.setActive, changeScene: c.changeScene, addScene: c.addScene, removeScene: c.removeScene, invoke: c.invoke, log}, message => log('error', message));
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
