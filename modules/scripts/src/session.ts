import {newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSWASMModule} from 'quickjs-emscripten-core';
import type {RuntimeSystem} from '@rewrite/sdk';
import {transform, type Entity} from '@rewrite/scene';
import {isActive, typeOfGlobal, type ActionContext, type GlobalValue, type InteractionEvent} from '@rewrite/interactions';
// The RxJS UMD bundle runs inside the sandbox (outside the package's exports map, so by path).
import rxjsSource from '../node_modules/rxjs/dist/bundles/rxjs.umd.min.js?raw';
import {BehaviourSchema, ScriptLibrarySchema, behaviourType, type Behaviour, type ParamField, type ScriptLibrary} from './contracts';
/** A breakpoint hit: where (script, line, hook) and that line's locals and watch values as previews. */
export interface DebugHit {scriptId: string; line: number; hook: string; locals: Record<string, string>; watches: Record<string, string>}
export interface DebugInstance {script: string; object: string; entityId: string; state: string}
/** `build` compiles a script with breakpoint calls (the editor passes `instrumentScript`; games never load the compiler). */
export interface DebugOptions {breakpoints: ReadonlyMap<string, readonly number[]>; watches: readonly string[]; hit(hit: DebugHit): void; build(source: string, name: string, scriptId: string, lines: readonly number[]): {code: string; lines: number[]; error?: string}}

/**
 * Behaviour scripts run in QuickJS compiled to WebAssembly: a separate JavaScript engine with its own heap. Scripts see
 * only the `game` API below (no DOM, network, timers, Node or editor objects). Each call into the sandbox has a time
 * limit, the heap and stack are capped, and everything a script does goes through the same runtime paths as
 * interaction actions (play-world data, globals, scene changes, services), never the project document.
 */

let engineFailure:string|undefined;
export const scriptEngineError=()=>engineFailure;
let engine: Promise<QuickJSWASMModule> | undefined, loaded: QuickJSWASMModule | undefined;
/** Loads the engine once (about 1 MB of WebAssembly); later sessions start synchronously. */
export function loadScriptEngine(): Promise<QuickJSWASMModule> {
 engine ??= import('@jitl/quickjs-singlefile-browser-release-sync').then(m => newQuickJSWASMModuleFromVariant(m.default)).then(m => (loaded = m)).catch(error=>{engineFailure=error instanceof Error?error.message:String(error);throw error;});
 return engine;
}
export const scriptEngineReady = () => loaded;

/** Everything a scene's scripts can reach. */
/** Physics for scripts (object IDs; px, px/s, degrees); see PhysicsControls in @rewrite/physics. */
export interface ScriptPhysics {
 setVelocity(id: string, x: number, y: number): void; setAngularVelocity(id: string, degreesPerSecond: number): void;
 applyForce(id: string, x: number, y: number): void; applyImpulse(id: string, x: number, y: number): void; teleport(id: string, x: number, y: number): void;
 body(id: string): {mass: number; velocityX: number; velocityY: number; angularVelocity: number; sleeping: boolean} | undefined;
 gravity(): {x: number; y: number}; setGravity(x: number, y: number): void;
 raycast(x1: number, y1: number, x2: number, y2: number): {entityId: string; x: number; y: number; normalX: number; normalY: number; distance: number}[];
 objectsAt(x: number, y: number): string[]; objectsIn(x: number, y: number, width: number, height: number): string[];
}
export interface ScriptHost extends Pick<ActionContext, 'setActive' | 'changeScene' | 'addScene' | 'removeScene' | 'invoke' | 'globals' | 'camera'> {
 /** Running physics, when the scene has bodies. */
 /** Optional replay seed for game.random and sandbox Math.random. */
 seed?:number;
 physics?: ScriptPhysics;
 /** Achievements and leaderboards. */
 achievements?: {unlock(key: string): boolean; unlocked(key: string): boolean; submit(board: string, score: number, name?: string): number; top(board: string): {name: string; score: number}[]; list(): {id: string; name: string; unlocked: boolean}[]};
 /** Dialogues: open, continue, choose, close, and the line on screen. */
 dialogue?: {name?(id: string): string | undefined; start(idOrName: string): void; advance(): void; choose(index: number): void; stop(): void; view(): {dialogue: string; speaker: string; text: string; choices: {text: string}[]} | null};
 /** Pathfinding (Nav Grid / Nav Agent), when the scene has them. */
 navigation?: ScriptNavigation;
 /** Copy a prefab or a scene object by name into the running world at (x, y); returns the copy's root object ID. */
 spawn?(name: string, x: number, y: number): string;
 /** Remove an object and its children from the running world. */
 destroy?(id: string): void;
 entities(): readonly Entity[];
 /** Keep a sandbox ready even with no scripts in the scene: scripted objects may join later (spawn, addScene). */
 standby?: boolean;
 time(): number;
 stage: {width: number; height: number};
 /** Names → IDs for the `game` API. */
 names: {globals: readonly {id: string; name: string}[]; scenes: readonly {id: string; name: string}[]; actions?: readonly {id: string; name: string}[]};
 log(level: 'info' | 'warn' | 'error', message: string): void;
  /** Runtime audio: play/stop/fades, bus gains and per-source state (the audio session implements it). */
 audio?: AudioControls;
 /** Animation players' timelines (play/pause/seek/speed/reverse and state), by player component ID. */
 animation?: TimelineControls;
 /** The scene being played and its scene script, if any. */
 scene?: {name: string; behaviour?: Behaviour};
 /** Localization (i18next): current language, switching, and a text by key with interpolation values. */
 language?: {current(): string; set(id: string): void; t(key: string, values: Record<string, unknown>): string | undefined};
 /** Sandbox providers for this session (only those the project uses: their code runs inside every sandbox). */
 extensions?: readonly ScriptExtension[];
 /** Interaction events raised from inside the sandbox by providers (e.g. a state machine entering a state). */
 emit?(event: InteractionEvent): void;
}

export interface ScriptExtension {
 id: string;
 componentType: string;
 sources: readonly {file: string; code: string}[];
}
/** What scripts can do with pathfinding (the navigation session implements it; object IDs, world pixels). */
export interface ScriptNavigation {
 findPath(x1: number, y1: number, x2: number, y2: number): {x: number; y: number}[] | null; moveTo(id: string, x: number, y: number): boolean; follow(id: string, target: string | null): void;
 stop(id: string): void; walkable(x: number, y: number): boolean; rebuild(): void; state(id: string): {moving: boolean; remaining: number; target: {x: number; y: number} | null} | undefined;
}
/** What scripts can do with sounds (the audio session implements it). */
export interface AudioControls {
 play(id: string): void; stop(id: string): void; fade(id: string, to: number, seconds: number, stopAfter?: boolean): void;
 setBus(bus: 'music' | 'sfx' | 'ui', gain: number): void; bus(bus: 'music' | 'sfx' | 'ui'): number;
 state(id: string): {state: string; fade: number; beat: number; position: number} | undefined;
}
/** What scripts can do with animation players (the animation session implements it). */
export interface TimelineControls {
 play(id: string, clipId?: string, fade?: number): void; pause(id: string): void; resume(id: string): void; seekPlayer(id: string, time: number): void;
 setSpeed(id: string, speed: number): void; reverse(id: string): void;
 state(id: string): {clipId: string; time: number; total: number; running: boolean; speed: number; direction: number} | undefined;
}
export interface ScriptLimits {callMs: number; memoryBytes: number; stackBytes: number; messagesPerFrame: number}
export const defaultLimits: ScriptLimits = {callMs: 250, memoryBytes: 64 * 1024 * 1024, stackBytes: 1024 * 1024, messagesPerFrame: 256};

/** A provider component's script reference (Script component fields) and its own fields, which only the provider reads. */
const providerData = (value: unknown): {data: Behaviour; extra: string} => {
 const {scriptId, params, refs, ...extra} = (value ?? {}) as Record<string, unknown>;
 return {data: BehaviourSchema.parse({scriptId, params: params ?? {}, refs: refs ?? {}}), extra: JSON.stringify(extra)};
};
const visualTypes = ['pixi.shape', 'pixi.text', 'pixi.bitmapText', 'pixi.sprite', 'spine.renderer'];
const serviceTypes: Record<string, string> = {audio: 'audio.source', tween: 'tween.player', animation: 'animation.player', timer: 'interactions.timer'};
const transformKeys = new Set(['x', 'y', 'rotation', 'scaleX', 'scaleY', 'skewX', 'skewY']);

/** Game-time timers: setTimeout/setInterval (and RxJS timers, delay, interval) follow the play clock and pause with it. */
const timers = String.raw`"use strict";
const __clock = {now: 0}, __timers = new Map();
let __timerSeq = 0;
const __schedule = (fn, ms, every, args) => {
  if (typeof fn !== 'function') throw new TypeError('setTimeout/setInterval need a function');
  const id = ++__timerSeq, delay = Math.max(0, Number(ms) || 0) / 1000;
  __timers.set(id, {at: __clock.now + delay, every: every ? Math.max(delay, 0.001) : 0, fn, args});
  return id;
};
globalThis.setTimeout = (fn, ms, ...args) => __schedule(fn, ms, false, args);
globalThis.setInterval = (fn, ms, ...args) => __schedule(fn, ms, true, args);
globalThis.clearTimeout = globalThis.clearInterval = id => { __timers.delete(id); };
globalThis.__clock = __clock;
globalThis.__runTimers = onError => {
  for (let guard = 0; ; guard++) {
    let next = null;
    for (const entry of __timers) if (entry[1].at <= __clock.now + 1e-9 && (!next || entry[1].at < next[1].at)) next = entry;
    if (!next) return;
    if (guard > 1000) { onError(new Error('More than 1000 timers fired in one frame')); return; }
    const [id, t] = next;
    if (t.every) t.at += t.every; else __timers.delete(id);
    try { t.fn(...t.args); } catch (error) { onError(error); }
  }
};
`;

/** The sandbox side: object wrappers, the `game` API and hook dispatch with per-instance error isolation. */
const prelude = String.raw`"use strict";
const __h = globalThis.__host; delete globalThis.__host;
const __scripts = new Map(), __instances = [], __shared = new Map(), __errors = [];
let __messages = [], __current = '';
const __param = (kind, value, extra) => Object.freeze(Object.assign({__param: kind, default: value}, extra || {}));
globalThis.param = Object.freeze({
  number: (value = 0, o = {}) => __param('number', __num(value), {min: o.min, max: o.max, step: o.step, label: o.label}),
  bool: (value = false, o = {}) => __param('bool', Boolean(value), {label: o.label}),
  text: (value = '', o = {}) => __param('text', String(value), {label: o.label}),
  color: (value = '#ffffff', o = {}) => __param('color', String(value), {label: o.label}),
  choice: (options, value, o = {}) => { const list = Array.from(options || [], String); if (!list.length) throw new TypeError('param.choice needs options'); return __param('choice', value === undefined ? list[0] : String(value), {options: list, label: o.label}); },
  object: (o = {}) => __param('object', null, {label: o.label}),
});
const __defaults = declared => { const out = {}; if (!declared || typeof declared !== 'object') return out; for (const [k, v] of Object.entries(declared)) out[k] = v && typeof v === 'object' && v.__param ? v.default : v; return out; };
const __num = v => { const n = Number(v); if (!Number.isFinite(n)) throw new TypeError('Expected a finite number, got ' + String(v)); return n; };
class GameObject {
  constructor(id, params) { Object.defineProperty(this, 'id', {value: id, enumerable: true}); Object.defineProperty(this, 'params', {value: Object.freeze(params || {}), enumerable: true}); this.state = {}; }
  get name() { return __h.get(this.id, 'name'); }
  /** The object's physics body (Rigid Body): velocity in px/s, forces and impulses in mass × px/s units. */
  get body() {
    const id = this.id, read = () => JSON.parse(__h.phys('body', id));
    return Object.freeze({
      get velocity() { const b = read(); return {x: b.velocityX, y: b.velocityY}; }, set velocity(v) { __h.phys('velocity', id, __num(v.x), __num(v.y)); },
      get angularVelocity() { return read().angularVelocity; }, set angularVelocity(v) { __h.phys('spin', id, __num(v)); },
      get mass() { return read().mass; }, get sleeping() { return read().sleeping; },
      applyForce(x, y) { __h.phys('force', id, __num(x), __num(y)); }, applyImpulse(x, y) { __h.phys('impulse', id, __num(x), __num(y)); },
      push(x, y) { const b = read(); __h.phys('velocity', id, b.velocityX + __num(x), b.velocityY + __num(y)); },
      teleport(x, y) { __h.phys('teleport', id, __num(x), __num(y)); },
    });
  }
  get x() { return __h.get(this.id, 'x'); } set x(v) { __h.set(this.id, 'x', __num(v)); }
  get y() { return __h.get(this.id, 'y'); } set y(v) { __h.set(this.id, 'y', __num(v)); }
  get rotation() { return __h.get(this.id, 'rotation'); } set rotation(v) { __h.set(this.id, 'rotation', __num(v)); }
  get scaleX() { return __h.get(this.id, 'scaleX'); } set scaleX(v) { __h.set(this.id, 'scaleX', __num(v)); }
  get skewX() { return __h.get(this.id, 'skewX'); } set skewX(v) { __h.set(this.id, 'skewX', __num(v)); }
  get skewY() { return __h.get(this.id, 'skewY'); } set skewY(v) { __h.set(this.id, 'skewY', __num(v)); }
  get scaleY() { return __h.get(this.id, 'scaleY'); } set scaleY(v) { __h.set(this.id, 'scaleY', __num(v)); }
  get alpha() { return __h.get(this.id, 'alpha'); } set alpha(v) { __h.set(this.id, 'alpha', Math.max(0, Math.min(1, __num(v)))); }
  get active() { return __h.get(this.id, 'active'); } set active(v) { __h.set(this.id, 'active', Boolean(v)); }
  /** The text of a Text or Bitmap Text object. */
  get text() { return __h.get(this.id, 'text'); } set text(v) { __h.set(this.id, 'text', String(v)); }
  /** Removes this object and its children from the game (scripts on them stop). */
  destroy() { __h.destroy(this.id); }
  get parent() { return __object(__h.parent(this.id)); }
  get children() { return JSON.parse(__h.children(this.id)).map(__object); }
  /** This object's animation player as an RxJS-friendly timeline handle. */
  timeline(clip) {
    const id = this.id, self = this, state = () => JSON.parse(__h.tlState(id)), op = (name, value, clipName) => __h.tl(id, name, clipName === undefined ? '' : String(clipName), value === undefined ? 0 : __num(value));
    return Object.freeze({
      play: () => op('play', 0, clip), crossFade: seconds => op('fade', seconds === undefined ? 0.3 : seconds, clip), pause: () => op('pause'), resume: () => op('resume'), stop: () => op('pause'),
      seek: time => op('seek', time), speed: value => op('speed', value), reverse: () => op('reverse'),
      get time() { return state().time; }, get playing() { return state().running; }, get duration() { return state().total; },
      time$: __frame$.pipe(rxjs.map(() => state().time), rxjs.distinctUntilChanged()),
      markers$: __on('marker', self).pipe(rxjs.map(e => e.name)),
      complete$: __on('complete', self).pipe(rxjs.map(() => self)),
    });
  }
  /** This object's Audio Source as a sound handle (live volume/rate, fades, beats). */
  sound() {
    const id = this.id, self = this, state = () => JSON.parse(__h.sndState(id));
    return Object.freeze({
      play: () => __h.snd(id, 'play', 0, 0), stop: () => __h.snd(id, 'stop', 0, 0),
      fadeIn: (seconds = 1) => __h.snd(id, 'fade', 1, __num(seconds)), fadeOut: (seconds = 1) => __h.snd(id, 'fadeOut', 0, __num(seconds)),
      fadeTo: (volume, seconds = 1) => __h.snd(id, 'fade', __num(volume), __num(seconds)),
      get volume() { return __h.sndGet(id, 'volume'); }, set volume(v) { __h.sndSet(id, 'volume', __num(v)); },
      get rate() { return __h.sndGet(id, 'rate'); }, set rate(v) { __h.sndSet(id, 'rate', __num(v)); },
      get playing() { return state().state === 'playing'; }, get state() { return state().state; }, get beat() { return state().beat; }, get position() { return state().position; },
      beat$: __on('beat', self).pipe(rxjs.map(e => e.beat)),
      bar$: __on('beat', self).pipe(rxjs.filter(e => e.bar), rxjs.map(e => e.beat / 4)),
      ended$: __on('soundEnd', self),
    });
  }
  play(kind) { __h.service(this.id, String(kind || ''), 'play'); }
  stop(kind) { __h.service(this.id, String(kind || ''), 'stop'); }
  toString() { return 'GameObject(' + this.name + ')'; }
}
const __object = id => { if (!id) return null; let o = __shared.get(id); if (!o) { o = new GameObject(id); __shared.set(id, o); } return o; };
const __text = v => { if (typeof v === 'string') return v; if (v instanceof GameObject) return String(v); try { return JSON.stringify(v); } catch (e) { return String(v); } };
const __log = level => (...values) => __h.log(level, values.map(__text).join(' '));
const __stage = Object.freeze(JSON.parse(__h.stage()));
globalThis.rx = rxjs;
rxjs.config.onUnhandledError = error => __errors.push('Unhandled error in a stream: ' + (error && error.message ? error.message : String(error)));
rxjs.asyncScheduler.now = () => __clock.now * 1000;
const __frame$ = new rxjs.Subject(), __events$ = new rxjs.Subject();
/** Project globals (Globals panel), Godot style: \`globals.score += 10\`, \`globals.paused = true\`, \`globals.player = 'Ada'\`. */
/** List and object globals read as live views: changing them in place (push, obj.hp -= 1, delete) writes the whole value back. */
const __liveGlobal = (name, root) => {
  if (root === null || typeof root !== 'object') return root;
  const save = () => __h.setGlobal(name, JSON.stringify(root));
  const wrap = target => new Proxy(target, {
    get: (t, k) => { const v = Reflect.get(t, k); return v !== null && typeof v === 'object' ? wrap(v) : v; },
    set: (t, k, v) => { Reflect.set(t, k, v === undefined ? null : JSON.parse(JSON.stringify(v))); save(); return true; },
    deleteProperty: (t, k) => { Reflect.deleteProperty(t, k); save(); return true; },
  });
  return wrap(root);
};
const __globals = new Proxy({}, {
  get: (_t, name) => typeof name === 'string' ? __liveGlobal(name, JSON.parse(__h.getGlobal(name))) : undefined,
  set: (_t, name, value) => { if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Expected a finite number'); __h.setGlobal(String(name), JSON.stringify(value === undefined ? null : value)); return true; },
  has: (_t, name) => typeof name === 'string' && __h.hasGlobal(name),
  ownKeys: () => JSON.parse(__h.globalNames()),
  getOwnPropertyDescriptor: (_t, name) => typeof name === 'string' && __h.hasGlobal(name) ? {value: JSON.parse(__h.getGlobal(name)), writable: true, enumerable: true, configurable: true} : undefined,
  deleteProperty: () => { throw new TypeError('Globals are declared in the Globals panel'); },
  defineProperty: () => { throw new TypeError('Globals are declared in the Globals panel'); },
});
globalThis.globals = __globals;
const __on = (type, target) => { const id = target && target.id; return __events$.pipe(rxjs.filter(e => e.type === String(type) && (!id || e.id === id)), rxjs.map(e => e.value)); };
globalThis.game = Object.freeze({
  get time() { return __h.time(); },
  stage: __stage,
  find(name) { return __object(__h.find(String(name))); },
  findAll(name) { return JSON.parse(__h.findAll(String(name))).map(__object); },
  /** Project globals by name (same object as the global \`globals\`). */
  globals: __globals,
  /** World physics: gravity (px/s²) and queries in world pixels. */
  physics: Object.freeze({
    get gravity() { return JSON.parse(__h.phys('gravity', '')); }, set gravity(v) { __h.phys('setGravity', '', __num(v.x), __num(v.y)); },
    raycastAll(x1, y1, x2, y2) { return JSON.parse(__h.phys('ray', '', JSON.stringify([__num(x1), __num(y1), __num(x2), __num(y2)]))).map(h => ({...h, object: __object(h.entityId)})); },
    raycast(x1, y1, x2, y2) { return this.raycastAll(x1, y1, x2, y2)[0] ?? null; },
    objectsAt(x, y) { return JSON.parse(__h.phys('at', '', __num(x), __num(y))).map(__object); },
    objectsIn(x, y, width, height) { return JSON.parse(__h.phys('in', '', JSON.stringify([__num(x), __num(y), __num(width), __num(height)]))).map(__object); },
  }),
  /** Achievements and leaderboards (kept on the player's device). */
  achievements: Object.freeze({ unlock(name) { return JSON.parse(__h.ach('unlock', String(name), '')); }, unlocked(name) { return JSON.parse(__h.ach('unlocked', String(name), '')); }, list() { return JSON.parse(__h.ach('list', '', '')); } }),
  leaderboard: Object.freeze({ submit(board, score, name) { return JSON.parse(__h.ach('submit', String(board), JSON.stringify([__num(score), name == null ? 'Player' : String(name)]))); }, top(board) { return JSON.parse(__h.ach('top', String(board), '')); } }),
  /** Dialogues: start by name, advance, choose(index), stop; current is the line on screen. */
  dialogue: Object.freeze({
    start(name) { __h.dlg('start', String(name)); }, advance() { __h.dlg('advance', ''); }, choose(index) { __h.dlg('choose', String(__num(index))); }, stop() { __h.dlg('stop', ''); },
    get current() { const v = __h.dlg('view', ''); return v ? JSON.parse(v) : null; },
  }),
  /** Pathfinding on the Nav Grid: paths as point lists; agents walk with moveTo / follow and call onArrive(self). */
  navigation: Object.freeze({
    findPath(x1, y1, x2, y2) { return JSON.parse(__h.nav('path', '', JSON.stringify([__num(x1), __num(y1), __num(x2), __num(y2)]))); },
    moveTo(target, x, y) { return JSON.parse(__h.nav('move', String(target && target.id || target), JSON.stringify([__num(x), __num(y)]))); },
    follow(target, chase) { __h.nav('follow', String(target && target.id || target), chase == null ? '' : String(chase.id || chase)); },
    stop(target) { __h.nav('stop', String(target && target.id || target), ''); },
    walkable(x, y) { return JSON.parse(__h.nav('walkable', '', JSON.stringify([__num(x), __num(y)]))); },
    rebuild() { __h.nav('rebuild', '', ''); },
    state(target) { const s = __h.nav('state', String(target && target.id || target), ''); return s ? JSON.parse(s) : undefined; },
  }),
  /** The scene camera: follow an object, shake, zoom, look at a world point; x, y, zoom and rotation describe the view. */
  camera: Object.freeze({
    follow(target) { __h.cam('follow', target == null ? '' : String(typeof target === 'object' ? target.id : target)); },
    stopFollowing() { __h.cam('follow', ''); },
    shake(strength, seconds) { __h.cam('shake', __num(strength === undefined ? 12 : strength), __num(seconds === undefined ? 0.5 : seconds)); },
    lookAt(x, y) { __h.cam('look', __num(x), __num(y)); },
    get zoom() { return JSON.parse(__h.cam('view')).zoom; }, set zoom(v) { __h.cam('zoom', __num(v)); },
    get x() { return JSON.parse(__h.cam('view')).x; }, get y() { return JSON.parse(__h.cam('view')).y; }, get rotation() { return JSON.parse(__h.cam('view')).rotation; },
  }),
  isDown(action) { return __h.isDown(String(action)); },
  changeScene(name) { __h.scene(String(name)); },
  addScene(name) { __h.additive('add', String(name)); },
  removeScene(name) { __h.additive('remove', String(name)); },
  /** A copy of the prefab (or else the scene object) with this name, at (x, y); its scripts start on the next frame. */
  spawn(name, x, y) { return __object(__h.spawn(String(name), __num(x === undefined ? 0 : x), __num(y === undefined ? 0 : y))); },
  /** The mouse or touch in world pixels, and whether it is pressed. */
  get pointer() { return JSON.parse(__h.pointer()); },
  send(message, data) { __messages.push([String(message), data === undefined ? null : JSON.parse(JSON.stringify(data))]); },
  log: __log('info'),
  random: Math.random,
  /** Localized text (Localization panel) in the current language; values fill {{placeholders}}, count picks a plural form. */
  t(key, values) { return __h.t(String(key), JSON.stringify(values === undefined ? {} : values)); },
  get language() { return __h.lang(); },
  setLanguage(id) { __h.setLang(String(id)); },
  /** Buses (music, sfx, ui) on top of the project mix, and crossfades between two objects' sounds. */
  audio: Object.freeze({
    bus(name) { const bus = String(name); return Object.freeze({get volume() { return __h.busGet(bus); }, set volume(v) { __h.busSet(bus, __num(v)); }}); },
    crossfade(from, to, seconds = 1) { if (from) __h.snd(from.id, 'fadeOut', 0, __num(seconds)); if (to) __h.snd(to.id, 'fade', 1, __num(seconds)); },
  }),
  /** Every frame (after timers, before update hooks). */
  frame$: __frame$.asObservable(),
  /** click | collision | input | global | message | marker | complete, optionally for one object. */
  on: __on,
});
globalThis.console = Object.freeze({log: __log('info'), warn: __log('warn'), error: __log('error')});
globalThis.__define = (id, name, factory) => {
  const module = {exports: {}};
  factory(module.exports, module);
  const exported = module.exports, hooks = exported.default && typeof exported.default === 'object' ? exported.default : exported;
  __scripts.set(id, {name, hooks});
};
class SceneSelf {
  constructor(name, params) { Object.defineProperty(this, 'name', {value: name, enumerable: true}); Object.defineProperty(this, 'params', {value: Object.freeze(params), enumerable: true}); this.state = {}; }
  toString() { return 'Scene(' + this.name + ')'; }
}
// Sandbox providers (ScriptExtension): a component type whose objects get a provider instance (e.g. a state machine actor)
// built from a script's exports instead of hook calls. Providers see the game events objects' hooks see.
const __kinds = new Map();
globalThis.__kind = (type, factory) => {
  if (__kinds.has(type)) throw new Error('Sandbox provider registered twice: ' + type);
  __kinds.set(type, factory({
    object: id => __object(id), exists: id => __h.exists(id), alive: id => __h.alive(id), preview: (v, depth) => __preview(v, depth),
    report: message => { __errors.push(String(message)); }, emit: (eventType, sourceId, event) => { __h.emit(String(eventType), String(sourceId), event == null ? '' : String(event)); },
    get current() { return __current; }, set current(v) { __current = String(v); },
  }));
};
const __provider = (where, run) => { try { return run(); } catch (error) { __errors.push(where + ': ' + (error && error.message ? error.message : String(error))); } };
globalThis.__attach = (key, scriptId, entityId, params, refs, sceneName, kind, extra) => {
  const script = __scripts.get(scriptId);
  if (!script) return;
  const values = Object.assign(__defaults(script.hooks.params), JSON.parse(params));
  for (const [name, id] of Object.entries(JSON.parse(refs))) values[name] = __h.exists(id) ? __object(id) : null;
  const self = entityId ? new GameObject(entityId, values) : new SceneSelf(sceneName, values);
  if (kind) { const provider = __kinds.get(kind); if (!provider) throw new Error('No sandbox provider for ' + kind); provider.attach({key, scriptId, entityId, name: script.name, exports: script.hooks, self, data: JSON.parse(extra || '{}')}); return; }
  __instances.push({key, scriptId, entityId, name: script.name, hooks: script.hooks, self, started: false, dead: false});
};
const __providers = (method, ...args) => { for (const [type, p] of __kinds) if (typeof p[method] === 'function') __provider(type, () => p[method](...args)); };
const __call = (instance, hook, args) => {
  if (instance.dead) return;
  if (hook !== 'start' && !instance.started) { instance.started = true; __call(instance, 'start', []); if (instance.dead) return; }
  if (hook === 'start') instance.started = true;
  const fn = instance.hooks[hook];
  if (typeof fn !== 'function') return;
  __current = instance.name + '.' + hook;
  try { fn.call(instance.hooks, instance.self, ...args); }
  catch (error) {
    instance.dead = true;
    const where = error && error.stack ? String(error.stack).split('\n').map(l => l.trim()).find(l => /\.ts:\d+/.test(l)) : '';
    const line = where ? /\.ts:(\d+)/.exec(where)[1] : '';
    __errors.push(instance.name + (line ? ' (line ' + line + ')' : '') + ': ' + hook + ' stopped this script — ' + (error && error.message ? error.message : String(error)));
  }
  __current = '';
};
const __live = () => __instances.filter(i => !i.dead && (!i.entityId || __h.alive(i.entityId)));
const __flushMessages = () => {
  let budget = __h.messageLimit();
  while (__messages.length) {
    const batch = __messages; __messages = [];
    for (const [message, data] of batch) { if (--budget < 0) { __messages = []; __errors.push('Too many game.send messages in one frame (limit reached)'); return; } for (const i of __live()) __call(i, 'onMessage', [message, data]); __providers('event', 'onMessage', '', [message, data]); __publish('message', '', {message, data}); }
  }
};
const __drain = () => { if (!__errors.length) return ''; const out = JSON.stringify(__errors); __errors.length = 0; return out; };
globalThis.__drainErrors = () => __drain();
// Every live script's start runs (scene script first, then objects in order) before any update or event reaches the scene.
const __startAll = () => { for (const i of __live()) if (!i.started) __call(i, 'start', []); __providers('start'); };
const __streamError = where => error => __errors.push(where + ': ' + (error && error.message ? error.message : String(error)));
globalThis.__frame = dt => {
  __clock.now += dt;
  __runTimers(__streamError('Timer'));
  __startAll();
  try { __frame$.next({dt, time: __clock.now}); } catch (error) { __streamError('frame$')(error); }
  for (const i of __live()) __call(i, 'update', [dt]);
  __providers('frame', dt);
  __flushMessages(); return __drain();
};
const __publish = (type, id, value) => { try { __events$.next({type, id, value}); } catch (error) { __streamError('game.on(' + type + ')')(error); } };
const __owned = new Set(['onPointerEnter', 'onPointerLeave', 'onDragEnd', 'onClick', 'onCollision', 'onCollisionExit', 'onMarker', 'onComplete', 'onBeat', 'onSoundEnd', 'onTimer', 'onArrive']);
globalThis.__event = (kind, entityId, a, b) => {
  __startAll();
  if (kind === 'broadcast') { __messages.push([String(a), b === null ? null : JSON.parse(b)]); __flushMessages(); return __drain(); }
  const args = () => kind === 'onGlobal' ? [a, __liveGlobal(a, JSON.parse(b))] : kind === 'onInput' || kind === 'onDialogue' || (kind.startsWith('onPointer') && !__owned.has(kind)) ? [a, b] : kind === 'onCollision' ? [__object(a), b ? JSON.parse(b) : null] : kind === 'onCollisionExit' ? [__object(a)] : kind === 'onMarker' || kind === 'onBeat' ? [a] : [];
  for (const i of __live()) {
    if (__owned.has(kind) && i.entityId !== entityId) continue;
    __call(i, kind, args());
  }
  if (__kinds.size) __providers('event', kind, __owned.has(kind) ? entityId : '', args());
  const type = {onClick: 'click', onCollision: 'collision', onCollisionExit: 'collisionExit', onInput: 'input', onGlobal: 'global', onMarker: 'marker', onComplete: 'complete', onBeat: 'beat', onSoundEnd: 'soundEnd'}[kind];
  if (type) __publish(type, entityId, kind === 'onInput' ? {action: a, phase: b} : kind === 'onGlobal' ? {name: a, value: JSON.parse(b)} : kind === 'onMarker' ? {object: __object(entityId), name: a} : kind === 'onBeat' ? {object: __object(entityId), beat: a, bar: a % 4 === 0} : __object(entityId));
  __flushMessages(); return __drain();
};
globalThis.__currentHook = () => __current;
// Debugger: short previews of values, breakpoint snapshots (that line's scope through the eval closure), live objects and watches.
const __preview = (v, depth = 0) => {
  if (v instanceof GameObject) { try { return v.name + ' (object)'; } catch { return '(removed object)'; } }
  if (v instanceof SceneSelf) return v.name + ' (scene)';
  if (typeof v === 'function') return 'ƒ';
  if (v === undefined) return 'undefined';
  if (typeof v === 'number') return String(Number.isFinite(v) ? Number(v.toPrecision(6)) : v);
  if (v === null || typeof v !== 'object') return typeof v === 'string' ? JSON.stringify(v) : String(v);
  if (depth >= 2) return Array.isArray(v) ? 'Array(' + v.length + ')' : '{…}';
  if (Array.isArray(v)) return '[' + v.slice(0, 10).map(x => __preview(x, depth + 1)).join(', ') + (v.length > 10 ? ', …' : '') + ']';
  const keys = Object.keys(v);
  return '{' + keys.slice(0, 12).map(k => k + ': ' + __preview(v[k], depth + 1)).join(', ') + (keys.length > 12 ? ', …' : '') + '}';
};
let __watches = [];
globalThis.__setWatches = json => { __watches = JSON.parse(json); };
globalThis.__bp = (scriptId, line, ev, names) => {
  const locals = {}, watches = {};
  for (const n of names) { try { locals[n] = __preview(ev(n)); } catch {} }
  for (const w of __watches) { try { watches[w] = __preview(ev(w)); } catch (e) { watches[w] = '⚠ ' + ((e && e.message) || String(e)); } }
  __h.hit(JSON.stringify({scriptId, line, hook: __current, locals, watches}));
};
globalThis.__debugInstances = () => JSON.stringify(__instances.filter(i => !i.dead).map(i => ({script: i.name, object: i.self.name, entityId: i.entityId || '', state: __preview(i.self.state)})));
globalThis.__evalWatches = json => JSON.stringify(JSON.parse(json).map(w => { try { return __preview((0, eval)(w)); } catch (e) { return '⚠ ' + ((e && e.message) || String(e)); } }));
globalThis.__clicks = id => __instances.some(i => !i.dead && i.entityId === id && typeof i.hooks.onClick === 'function') || [...__kinds.values()].some(p => typeof p.listens === 'function' && p.listens('onClick', id)) ? '1' : '';
globalThis.__swap = id => { const s = __scripts.get(id); if (s) { for (const i of __instances) if (i.scriptId === id) i.hooks = s.hooks; __providers('swap', id, s.hooks); } };
// Host → provider calls (inspection, sending events): JSON in, {ok, value} or {ok: false, error} out.
globalThis.__providerCall = json => {
  const [type, op, arg] = JSON.parse(json), provider = __kinds.get(type);
  try { if (!provider || typeof provider.call !== 'function') throw new Error('No sandbox provider for ' + type); return JSON.stringify({ok: true, value: provider.call(String(op), arg) ?? null}); }
  catch (error) { return JSON.stringify({ok: false, error: error && error.message ? error.message : String(error)}); }
};
`;

/** One scene's scripts: a QuickJS runtime/context with the scripts defined and attached to their objects. */
export class ScriptSession {
 private runtime: QuickJSRuntime | null = null;
 private vm: QuickJSContext | null = null;
 private frame: QuickJSHandle | null = null;
 private event: QuickJSHandle | null = null;
 private pressed = new Set<string>();
 private dead = false;
 private defined = new Set<string>();
 readonly diagnostics: string[] = [];
 /** Scripts running in this scene, the scene script included (zero: the session does nothing). */
 readonly count: number;

 constructor(module: QuickJSWASMModule, private library: ScriptLibrary, private host: ScriptHost, private report: (message: string) => void, private limits: ScriptLimits = defaultLimits) {
  ScriptLibrarySchema.parse(library);
  const kinds = new Set((host.extensions ?? []).map(x => x.componentType));
  const attached: {entity: {id: string; name: string}; component: {id: string}; data: Behaviour; kind?: string; extra?: string}[] = host.entities().flatMap(e => e.components.filter(c => (c.type === behaviourType || kinds.has(c.type)) && c.version === 1).map(c => c.type === behaviourType ? {entity: e, component: c, data: BehaviourSchema.parse(c.data)} : {entity: e, component: c, ...providerData(c.data), kind: c.type}));
  // The scene script runs first (before the objects' scripts) with an empty entity ID.
  if (host.scene?.behaviour?.scriptId) attached.unshift({entity: {id: '', name: host.scene.name}, component: {id: 'scene'}, data: BehaviourSchema.parse(host.scene.behaviour)});
  this.count = attached.length;
  if (!attached.length && !host.standby) return;
  const runtime = this.runtime = module.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes); runtime.setMaxStackSize(limits.stackBytes);
  const vm = this.vm = runtime.newContext();
  try {
   this.installHost(vm);
   if(host.seed!==undefined)this.evaluate(`{let seed=${host.seed>>>0};Math.random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};}`, 'replay-random.js');
   this.evaluate(timers, 'timers.js');
   this.evaluate(rxjsSource, 'rxjs.js');
   this.evaluate(prelude, 'prelude.js');
   for (const extension of host.extensions ?? []) for (const source of extension.sources) this.evaluate(source.code, source.file);
   const used = new Set(attached.map(a => a.data.scriptId));
   for (const script of library.items.filter(s => used.has(s.id))) {
    this.defined.add(script.id);
    if (script.error || !script.code) throw Error(script.error ?? `${script.name}: script has no compiled code`);
    this.evaluate(`__define(${JSON.stringify(script.id)}, ${JSON.stringify(script.name)}, function (exports, module) {${script.code}\n});`, `${script.name}.ts`);
   }
   for (const a of attached) {
    if (!library.items.some(s => s.id === a.data.scriptId)) throw Error(`${a.entity.name}: the attached script is missing`);
    for (const [name, id] of Object.entries(a.data.refs)) if (!host.entities().some(e => e.id === id)) host.log('warn', `${a.entity.name}: ${name} points to an object that is not in this scene (null)`);
    this.evaluate(`__attach(${[a.component.id, a.data.scriptId, a.entity.id, JSON.stringify(a.data.params), JSON.stringify(a.data.refs), a.entity.name, a.kind ?? '', a.extra ?? '{}'].map(v => JSON.stringify(v)).join(', ')});`, 'attach.js');
   }
   this.frame = vm.getProp(vm.global, '__frame'); this.event = vm.getProp(vm.global, '__event');
  } catch (error) { this.dispose(); throw error; }
 }

 /** Runs `update` hooks once per rendered frame (scripts start on their first update or event). */
 readonly system: RuntimeSystem = {id: 'scripts', update: dt => this.call(this.frame, [dt]), dispose: () => this.dispose(), spawned: ids => this.spawned(ids)};
 private pointerState = {x: 0, y: 0, down: false};
 private readonly sessionKey = Math.random().toString(36).slice(2, 10);
 private pending: string[] = [];
 /** Scripts on spawned objects attach once the current call returns and start on their next update. */
 spawned(ids: readonly string[]) { if (this.vm && !this.dead) this.pending.push(...ids); }
 private attachPending() {
  if (!this.vm || this.dead || !this.pending.length) return;
  const ids = new Set(this.pending); this.pending = [];
  try {
   for (const e of this.host.entities()) {
    if (!ids.has(e.id)) continue;
    for (const c of e.components) {
     const kind = c.type === behaviourType ? '' : (this.host.extensions ?? []).some(x => x.componentType === c.type) ? c.type : null;
     if (kind === null || c.version !== 1) continue;
     const {data, extra} = kind ? providerData(c.data) : {data: BehaviourSchema.parse(c.data), extra: '{}'}, script = this.library.items.find(s => s.id === data.scriptId);
     if (!script || script.error || !script.code) { this.note(`${e.name}: the attached script is missing or has errors`); continue; }
     if (!this.defined.has(script.id)) { this.evaluate(`__define(${JSON.stringify(script.id)}, ${JSON.stringify(script.name)}, function (exports, module) {${this.codeFor(script)}\n});`, `${script.name}.ts`); this.defined.add(script.id); }
     this.evaluate(`__attach(${[c.id, data.scriptId, e.id, JSON.stringify(data.params), JSON.stringify(data.refs), e.name, kind, extra].map(v => JSON.stringify(v)).join(', ')});`, 'attach.js');
    }
   }
  } catch (error) { this.note(`Spawned scripts failed: ${error instanceof Error ? error.message : String(error)}`); }
 }
 private debugOptions?: DebugOptions;
 private instrumented = new Map<string, string>();
 /** A script's code with the debugger's breakpoint calls when it has breakpoints. */
 /**
  * Live edit while playing: scripts whose compiled code changed are defined again and the running objects switch to
  * the new hooks, keeping their `state` and params (`start` does not run again). Scripts with compile errors, or not
  * used in this scene, are left as they are. Returns the names of the scripts that were swapped.
  */
 reload(library: ScriptLibrary): string[] {
  if (!this.vm || this.dead) { this.library = library; return []; }
  const changed = library.items.filter(next => { const prev = this.library.items.find(i => i.id === next.id); return prev && prev.code !== next.code && next.code && !next.error && this.defined.has(next.id); });
  this.library = library;
  try {
   for (const script of changed) {
    this.instrumented.delete(script.id);
    this.evaluate(`__define(${JSON.stringify(script.id)}, ${JSON.stringify(script.name)}, function (exports, module) {${this.codeFor(script)}\n});`, `${script.name}.ts`);
    this.evaluate(`__swap(${JSON.stringify(script.id)});`, 'reload.js');
   }
  } catch (error) { this.note(`Reload: ${error instanceof Error ? error.message : String(error)}`); return []; }
  return changed.map(s => s.name);
 }
 private codeFor(script: ScriptLibrary['items'][number]) { const lines = this.debugOptions?.breakpoints.get(script.id) ?? []; if (!lines.length) return script.code; const built = this.debugOptions!.build(script.source, script.name, script.id, lines); return built.error ? script.code : built.code; }
 /**
  * Debugger (Preview): scripts with breakpoints are redefined with a call at those lines and running objects switch to
  * the new code (their state stays). Returns the lines that can stop, per script. Watches are evaluated at each hit.
  */
 debug(options: DebugOptions): Record<string, number[]> {
  if (!this.vm || this.dead) return {};
  this.debugOptions = options;
  const valid: Record<string, number[]> = {};
  try {
   this.evaluate(`__setWatches(${JSON.stringify(JSON.stringify(options.watches))});`, 'debug.js');
   for (const script of this.library.items) {
    const lines = options.breakpoints.get(script.id) ?? [], built: {code: string; lines: number[]; error?: string} = lines.length ? options.build(script.source, script.name, script.id, lines) : {code: script.code, lines: []};
    valid[script.id] = built.lines;
    const key = built.code;
    if (!this.defined.has(script.id) || this.instrumented.get(script.id) === key || built.error) continue;
    if (!this.instrumented.has(script.id) && !lines.length) continue;
    this.evaluate(`__define(${JSON.stringify(script.id)}, ${JSON.stringify(script.name)}, function (exports, module) {${built.code}\n});`, `${script.name}.ts`);
    this.evaluate(`__swap(${JSON.stringify(script.id)});`, 'debug.js');
    this.instrumented.set(script.id, key);
   }
  } catch (error) { this.note(`Debugger: ${error instanceof Error ? error.message : String(error)}`); }
  return valid;
 }
 private callString(name: string, arg?: string): string | undefined {
  const vm = this.vm; if (!vm || this.dead) return undefined;
  const fn = vm.getProp(vm.global, name), handle = arg === undefined ? undefined : vm.newString(arg);
  this.runtime!.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + this.limits.callMs));
  const result = handle ? vm.callFunction(fn, vm.undefined, handle) : vm.callFunction(fn, vm.undefined);
  this.runtime!.removeInterruptHandler(); handle?.dispose(); fn.dispose();
  if (result.error) { result.error.dispose(); return undefined; }
  const text = vm.getString(result.value); result.value.dispose(); return text;
 }
 /** Whether a script on this object reacts to the event (`onClick` for clicks). */
 listens(type: string, entityId: string) { return type === 'pointer.click' && this.callString('__clicks', entityId) === '1'; }
 /** Every running script instance with a preview of its `state`. */
 instances(): DebugInstance[] { const text = this.callString('__debugInstances'); return text ? JSON.parse(text) as DebugInstance[] : []; }
 /**
  * A request to a sandbox provider (see {@link ScriptExtension}) under the usual call time limit; throws the provider's
  * error. Pending promise jobs and objects spawned meanwhile are handled like any other call.
  */
 provider(componentType: string, op: string, arg: unknown = null): unknown {
  if (!this.vm || this.dead) throw Error('Scripts are not running');
  const text = this.callString('__providerCall', JSON.stringify([componentType, op, arg ?? null]));
  if (text === undefined) throw Error(`Script provider ${componentType} did not answer within ${this.limits.callMs} ms`);
  const result = JSON.parse(text) as {ok: boolean; value?: unknown; error?: string};
  this.drainErrors();
  if (!result.ok) throw Error(result.error ?? 'Provider request failed');
  return result.value;
 }
 private drainErrors() {
  const vm = this.vm; if (!vm || this.dead) return;
  const fn = vm.getProp(vm.global, '__drainErrors'), r = vm.callFunction(fn, vm.undefined); fn.dispose();
  if (r.error) { r.error.dispose(); return; }
  const text = vm.getString(r.value); r.value.dispose();
  if (text) for (const e of JSON.parse(text) as string[]) this.note(e);
  this.attachPending();
  this.flushEmits();
 }
 /** Watch expressions in the scripts' global scope (game, globals, …) as previews. */
 watch(expressions: readonly string[]): string[] { if (!expressions.length) return []; const text = this.callString('__evalWatches', JSON.stringify(expressions)); return text ? JSON.parse(text) as string[] : expressions.map(() => '⚠ unavailable'); }
 /** The mouse or touch in world pixels: game.pointer and onPointerDown / onPointerMove / onPointerUp(self, x, y). */
 pointer(phase: 'down' | 'move' | 'up', x: number, y: number) {
  this.pointerState = {x, y, down: phase === 'down' ? true : phase === 'up' ? false : this.pointerState.down};
  this.call(this.event, [phase === 'down' ? 'onPointerDown' : phase === 'up' ? 'onPointerUp' : 'onPointerMove', '', x, y]);
 }

 /** Feeds interaction events (clicks, collisions, globals, input) to the matching hooks. */
 observe(event: InteractionEvent) {
  if (!this.vm || this.dead) return;
  if (event.type === 'pointer.click') return this.call(this.event, ['onClick', event.sourceId, null, null]);
  if (event.type === 'timer.done') { const owner = this.host.entities().find(e => e.components.some(c => c.id === event.sourceId)); if (owner) this.call(this.event, ['onTimer', owner.id, null, null]); return; }
  if (event.type === 'dialogue.event' || event.type === 'dialogue.end') { const name = this.host.dialogue?.name?.(event.sourceId) ?? event.sourceId; return this.call(this.event, ['onDialogue', '', event.type === 'dialogue.end' ? 'end' : event.event ?? '', name]); }
  if (event.type === 'navigation.arrived') return this.call(this.event, ['onArrive', event.sourceId, null, null]);
  if (event.type === 'physics.enter') return this.call(this.event, ['onCollision', event.sourceId, event.event || null, event.data ? JSON.stringify(event.data) : null]);
  if (event.type === 'physics.exit') return this.call(this.event, ['onCollisionExit', event.sourceId, event.event || null, null]);
  if (event.type === 'global.change') { const g = this.host.names.globals.find(x => x.id === event.sourceId); if (g && this.host.globals) this.call(this.event, ['onGlobal', '', g.name, JSON.stringify(this.host.globals.get(g.id))]); return; }
  if ((event.type === 'audio.beat' && event.event === 'beat') || event.type === 'audio.ended') {
   const owner = this.host.entities().find(e => e.components.some(c => c.id === event.sourceId));
   if (owner) this.call(this.event, event.type === 'audio.beat' ? ['onBeat', owner.id, this.host.audio?.state(event.sourceId)?.beat ?? 0, null] : ['onSoundEnd', owner.id, null, null]);
   return;
  }
  if (event.type === 'animation.marker' || event.type === 'animation.complete') {
   const owner = this.host.entities().find(e => e.components.some(c => c.id === event.sourceId));
   if (owner) this.call(this.event, [event.type === 'animation.marker' ? 'onMarker' : 'onComplete', owner.id, event.event ?? '', null]);
   return;
  }
  if (event.type === 'input.pressed' || event.type === 'input.released') {
   const action = this.host.names.actions?.find(x => x.id === event.sourceId);
   if (event.type === 'input.pressed') this.pressed.add(event.sourceId); else this.pressed.delete(event.sourceId);
   if (action) this.call(this.event, ['onInput', '', action.name, event.type === 'input.pressed' ? 'pressed' : 'released']);
  }
 }

 /** Sends a message to every script's onMessage (timeline marker messages). */
 broadcast(message: string, data: unknown = null) { if (this.vm && !this.dead) this.call(this.event, ['broadcast', '', message, JSON.stringify(data ?? null)]); }

 private call(fn: QuickJSHandle | null, args: (string | number | boolean | null)[]) {
  const vm = this.vm;
  if (!vm || !fn || this.dead) return;
  this.runtime!.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + this.limits.callMs));
  const handles = args.map(a => a === null ? vm.null : typeof a === 'boolean' ? (a ? vm.true : vm.false) : typeof a === 'number' ? vm.newNumber(a) : vm.newString(a));
  const result = vm.callFunction(fn, vm.undefined, ...handles);
  for (const h of handles) if (h !== vm.null && h !== vm.true && h !== vm.false) h.dispose();
  this.runtime!.removeInterruptHandler();
  if (result.error) {
   const error = vm.dump(result.error) as {message?: string; name?: string} | string;
   result.error.dispose();
   const message = typeof error === 'object' && error ? `${error.name ?? 'Error'}: ${error.message ?? ''}` : String(error);
   const current = this.currentHook();
   this.fail(/interrupted/i.test(message) ? `Scripts stopped: ${current || 'a script'} ran longer than ${this.limits.callMs} ms (endless loop?)` : /out of memory/i.test(message) ? `Scripts stopped: ${current || 'a script'} used more than ${Math.round(this.limits.memoryBytes / 1048576)} MB` : `Scripts stopped: ${message}`);
   return;
  }
  const errors = vm.getString(result.value); result.value.dispose();
  // Promise callbacks (async hooks, firstValueFrom…) run now, under the same time limit.
  this.runtime!.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + this.limits.callMs));
  const jobs = this.runtime!.executePendingJobs(1000);
  this.runtime!.removeInterruptHandler();
  if (jobs.error) { const e = vm.dump(jobs.error) as {message?: string}; jobs.error.dispose(); this.note(`Async script code failed: ${e?.message ?? String(e)}`); }
  if (errors) for (const e of JSON.parse(errors) as string[]) this.note(e);
  this.attachPending();
  this.flushEmits();
 }
 private emits: InteractionEvent[] = [];
 private flushing = false;
 /** Provider events raised during the last call, dispatched now that the sandbox is idle (rules may call back in). */
 private flushEmits() {
  if (this.flushing || !this.emits.length) return;
  this.flushing = true;
  try { for (let n = 0; this.emits.length && n < 1000; n++) this.host.emit?.(this.emits.shift()!); this.emits.length = 0; }
  finally { this.flushing = false; }
 }
 private currentHook() { try { const fn = this.vm!.getProp(this.vm!.global, '__currentHook'), r = this.vm!.callFunction(fn, this.vm!.undefined); fn.dispose(); if (r.error) { r.error.dispose(); return ''; } const v = this.vm!.getString(r.value); r.value.dispose(); return v; } catch { return ''; } }
 private note(message: string) { this.diagnostics.push(message); if (this.diagnostics.length > 50) this.diagnostics.shift(); this.report(message); }
 private fail(message: string) { this.note(message); this.dispose(); }

 private evaluate(code: string, file: string) {
  const vm = this.vm!;
  this.runtime!.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + this.limits.callMs));
  const result = vm.evalCode(code, file);
  this.runtime!.removeInterruptHandler();
  if (result.error) {
   const error = vm.dump(result.error) as {message?: string; name?: string; stack?: string};
   result.error.dispose();
   const line = /\.ts:(\d+)/.exec(String(error?.stack ?? ''))?.[1];
   throw Error(`${file.replace(/\.(ts|js)$/, '')}${line ? ` (line ${line})` : ''}: ${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`);
  }
  result.value.dispose();
 }

 private entity(id: string) { return this.host.entities().find(e => e.id === id); }
 private installHost(vm: QuickJSContext) {
  const host = vm.newObject();
  const value = (v: unknown): QuickJSHandle => v === undefined || v === null ? vm.undefined : typeof v === 'number' ? vm.newNumber(v) : typeof v === 'boolean' ? (v ? vm.true : vm.false) : vm.newString(String(v));
  const fn = (name: string, body: (...args: unknown[]) => unknown) => {
   const handle = vm.newFunction(name, (...args) => {
    try { return value(body(...args.map(a => vm.dump(a)))); }
    catch (error) { return {error: vm.newError(error instanceof Error ? error.message : String(error))}; }
   });
   vm.setProp(host, name, handle); handle.dispose();
  };
  const named = (list: readonly {id: string; name: string}[], name: string, kind: string) => { const item = list.find(x => x.name === name); if (!item) throw Error(`No ${kind} named "${name}"`); return item.id; };
  fn('get', (id, key) => {
   const e = this.entity(String(id));
   if (!e) throw Error('This object no longer exists');
   if (key === 'name') return e.name;
   if (key === 'active') return e.active;
   if (key === 'text') { const c = e.components.find(c => c.type === 'pixi.text' || c.type === 'pixi.bitmapText'); if (!c) throw Error(`${e.name} has no text`); return String((c.data as {text?: unknown}).text ?? ''); }
   if (key === 'alpha') { const c = e.components.find(c => visualTypes.includes(c.type)); return Number((c?.data as {alpha?: number} | undefined)?.alpha ?? 1); }
   if (transformKeys.has(String(key))) return transform(e)[key as 'x'] ?? 0;
   throw Error(`Unknown property ${String(key)}`);
  });
  fn('set', (id, key, v) => {
   const e = this.entity(String(id));
   if (!e) throw Error('This object no longer exists');
   if (key === 'active') { this.host.setActive(e.id, Boolean(v)); return; }
   if (key === 'text') { const c = e.components.find(c => c.type === 'pixi.text' || c.type === 'pixi.bitmapText'); if (!c) throw Error(`${e.name} has no text`); (c.data as Record<string, unknown>).text = String(v).slice(0, 10000); return; }
   if (key === 'alpha') { for (const c of e.components) if (visualTypes.includes(c.type)) (c.data as Record<string, unknown>).alpha = Number(v); return; }
   if (!transformKeys.has(String(key))) throw Error(`${String(key)} cannot be changed`);
   const t = e.components.find(c => c.type === 'scene.transform2d');
   if (!t) throw Error(`${e.name} has no transform`);
   (t.data as Record<string, unknown>)[String(key)] = Number(v);
  });
  fn('spawn', (name, x, y) => { if (!this.host.spawn) throw Error('Spawning is unavailable here'); return this.host.spawn(String(name), Number(x), Number(y)); });
  fn('destroy', id => { if (!this.host.destroy) throw Error('Destroying is unavailable here'); if (this.entity(String(id))) this.host.destroy(String(id)); });
  fn('pointer', () => JSON.stringify(this.pointerState));
  // Queued: dispatching while the sandbox is mid-call could re-enter it (and reset its time limit).
  fn('emit', (type, sourceId, event) => { if (this.host.emit && this.emits.length < 1000) this.emits.push({type: String(type), sourceId: String(sourceId), ...(event ? {event: String(event)} : {}), silent: false}); });
  fn('hit', json => { try { this.debugOptions?.hit(JSON.parse(String(json)) as DebugHit); } catch { /* the debugger view is gone */ } });
  fn('exists', id => this.host.entities().some(e => e.id === id));
  fn('parent', id => this.entity(String(id))?.parentId ?? undefined);
  fn('children', id => JSON.stringify(this.host.entities().filter(e => e.parentId === id).map(e => e.id)));
  fn('alive', id => { const all = this.host.entities(), e = all.find(x => x.id === id); return Boolean(e && isActive(e, all)); });
  fn('find', name => this.host.entities().find(e => e.name === name)?.id);
  fn('findAll', name => JSON.stringify(this.host.entities().filter(e => e.name === name).map(e => e.id)));
  fn('t', (key, json) => { const k = String(key), v = JSON.parse(String(json)); return this.host.language?.t(k, v && typeof v === 'object' ? v : {}) ?? k; });
  fn('lang', () => this.host.language?.current() ?? '');
  fn('setLang', id => { if (!this.host.language) throw Error('This game has no localization'); this.host.language.set(String(id)); });
  const globals = () => { if (!this.host.globals) throw Error('Globals are unavailable'); return this.host.globals; };
  const globalId = (name: unknown) => named(this.host.names.globals, String(name), 'global');
  // Values cross the sandbox as JSON (lists and objects included); the store checks types and limits.
  fn('getGlobal', name => JSON.stringify(globals().get(globalId(name))));
  fn('setGlobal', (name, json) => { const store = globals(), id = globalId(name), v = JSON.parse(String(json)) as unknown; if (typeof v === 'number' && !Number.isFinite(v)) throw TypeError('Expected a finite number'); if (v === null || typeOfGlobal(v as GlobalValue) !== store.type(id)) throw TypeError(`${String(name)} is a ${store.type(id)}`); store.set(id, v as GlobalValue); });
  fn('hasGlobal', name => this.host.names.globals.some(g => g.name === String(name)));
  fn('globalNames', () => JSON.stringify(this.host.names.globals.map(g => g.name)));
  fn('isDown', name => this.pressed.has(named(this.host.names.actions ?? [], String(name), 'input action')));
  fn('scene', name => this.host.changeScene(named(this.host.names.scenes, String(name), 'scene')));
  fn('additive', (op, name) => { const id = named(this.host.names.scenes, String(name), 'scene'), host = this.host; if (!host.addScene || !host.removeScene) throw Error('Adding scenes is unavailable here'); if (String(op) === 'add') host.addScene(id); else host.removeScene(id); });
  fn('phys', (op, id, a, b) => {
   const p = this.host.physics; if (!p) throw Error('Physics is not running in this scene');
   const n = (v: unknown) => Number(v), target = String(id), four = () => JSON.parse(String(a)) as [number, number, number, number];
   switch (String(op)) {
    case 'body': { const body = p.body(target); if (!body) throw Error('This object has no physics body'); return JSON.stringify(body); }
    case 'velocity': p.setVelocity(target, n(a), n(b)); return undefined;
    case 'spin': p.setAngularVelocity(target, n(a)); return undefined;
    case 'force': p.applyForce(target, n(a), n(b)); return undefined;
    case 'impulse': p.applyImpulse(target, n(a), n(b)); return undefined;
    case 'teleport': p.teleport(target, n(a), n(b)); return undefined;
    case 'gravity': return JSON.stringify(p.gravity());
    case 'setGravity': p.setGravity(n(a), n(b)); return undefined;
    case 'ray': return JSON.stringify(p.raycast(...four()));
    case 'at': return JSON.stringify(p.objectsAt(n(a), n(b)));
    case 'in': return JSON.stringify(p.objectsIn(...four()));
    default: throw Error(`Unknown physics operation ${String(op)}`);
   }
  });
  fn('ach', (op, key, arg) => {
   const a = this.host.achievements; if (!a) throw Error('Achievements are unavailable here');
   switch (String(op)) {
    case 'unlock': return JSON.stringify(a.unlock(String(key)));
    case 'unlocked': return JSON.stringify(a.unlocked(String(key)));
    case 'list': return JSON.stringify(a.list().map(x => ({name: x.name, unlocked: x.unlocked})));
    case 'submit': { const [score, name] = JSON.parse(String(arg)) as [number, string]; return JSON.stringify(a.submit(String(key), score, name)); }
    case 'top': return JSON.stringify(a.top(String(key)).map(s => ({name: s.name, score: s.score})));
    default: throw Error(`Unknown achievements operation ${String(op)}`);
   }
  });
  fn('dlg', (op, arg) => {
   const d = this.host.dialogue; if (!d) throw Error('Dialogues are unavailable here');
   switch (String(op)) {
    case 'start': d.start(String(arg)); return undefined;
    case 'advance': d.advance(); return undefined;
    case 'choose': d.choose(Number(arg)); return undefined;
    case 'stop': d.stop(); return undefined;
    case 'view': { const v = d.view(); return v ? JSON.stringify({dialogue: v.dialogue, speaker: v.speaker, text: v.text, choices: v.choices.map(c => c.text)}) : undefined; }
    default: throw Error(`Unknown dialogue operation ${String(op)}`);
   }
  });
  fn('nav', (op, id, arg) => {
   const n = this.host.navigation; if (!n) throw Error('Navigation is not running in this scene (add a Nav Grid)');
   const target = String(id), list = () => JSON.parse(String(arg)) as number[];
   switch (String(op)) {
    case 'path': { const [a, b, c, d] = list(); return JSON.stringify(n.findPath(a, b, c, d)); }
    case 'move': { const [x, y] = list(); return JSON.stringify(n.moveTo(target, x, y)); }
    case 'follow': n.follow(target, String(arg) || null); return undefined;
    case 'stop': n.stop(target); return undefined;
    case 'walkable': { const [x, y] = list(); return JSON.stringify(n.walkable(x, y)); }
    case 'rebuild': n.rebuild(); return undefined;
    case 'state': { const s = n.state(target); return s ? JSON.stringify(s) : undefined; }
    default: throw Error(`Unknown navigation operation ${String(op)}`);
   }
  });
  fn('cam', (op, a, b) => {
   const c = this.host.camera; if (!c) throw Error('The game camera is unavailable');
   switch (String(op)) {
    case 'follow': { const id = String(a ?? ''); if (id && !this.entity(id)) throw Error('This object no longer exists'); c.follow(id || null); return undefined; }
    case 'shake': c.shake(Math.max(0, Math.min(200, Number(a))), Math.max(0, Math.min(10, Number(b)))); return undefined;
    case 'look': if (!c.lookAt) throw Error('Camera lookAt is unavailable'); c.lookAt(Number(a), Number(b)); return undefined;
    case 'zoom': if (!c.zoom) throw Error('Camera zoom is unavailable'); c.zoom(Math.max(.05, Math.min(20, Number(a)))); return undefined;
    case 'view': return JSON.stringify(c.view?.() ?? {x: this.host.stage.width / 2, y: this.host.stage.height / 2, zoom: 1, rotation: 0});
    default: throw Error(`Unknown camera operation ${String(op)}`);
   }
  });
  fn('service', (id, kind, method) => {
   const e = this.entity(String(id));
   if (!e) throw Error('This object no longer exists');
   const kinds = kind ? [String(kind)] : Object.keys(serviceTypes);
   if (kind && !serviceTypes[String(kind)]) throw Error(`Unknown kind ${String(kind)}: use audio, tween, animation or timer`);
   const found = kinds.map(k => [k, e.components.find(c => c.type === serviceTypes[k] && c.version === 1)] as const).find(([, c]) => c);
   if (!found) throw Error(`${e.name} has no ${kind || 'sound, tween, animation or timer'}`);
   this.host.invoke(found[0], method === 'stop' ? 'stop' : 'play', found[1]!.id);
  });
  const player = (id: unknown) => {
   const e = this.entity(String(id)), c = e?.components.find(x => x.type === 'animation.player' && x.version === 1);
   if (!e) throw Error('This object no longer exists');
   if (!c) throw Error(`${e.name} has no Animation component`);
   if (!this.host.animation) throw Error('Timelines are unavailable');
   return {component: c, animation: this.host.animation, clips: ((c.data as {clips?: {id: string; name: string}[]}).clips ?? [])};
  };
  fn('tl', (id, op, clipName, value) => {
   const {component, animation, clips} = player(id), n = Number(value);
   if (op === 'play') { const clip = clipName ? clips.find(c => c.name === clipName) : undefined; if (clipName && !clip) throw Error(`No clip named "${String(clipName)}"`); animation.play(component.id, clip?.id); }
   else if (op === 'fade') { const clip = clipName ? clips.find(c => c.name === clipName) : undefined; if (clipName && !clip) throw Error(`No clip named "${String(clipName)}"`); animation.play(component.id, clip?.id, Math.max(0, Math.min(60, n))); }
   else if (op === 'pause') animation.pause(component.id); else if (op === 'resume') animation.resume(component.id);
   else if (op === 'seek') animation.seekPlayer(component.id, n); else if (op === 'speed') animation.setSpeed(component.id, n); else if (op === 'reverse') animation.reverse(component.id);
  });
  fn('tlState', id => { const {component, animation} = player(id); return JSON.stringify(animation.state(component.id) ?? {clipId: '', time: 0, total: 0, running: false, speed: 1, direction: 1}); });
  const sound = (id: unknown) => {
   const e = this.entity(String(id)), c = e?.components.find(x => x.type === 'audio.source' && x.version === 1);
   if (!e) throw Error('This object no longer exists');
   if (!c) throw Error(`${e.name} has no Audio Source`);
   if (!this.host.audio) throw Error('Audio is unavailable');
   return {component: c, audio: this.host.audio};
  };
  fn('snd', (id, op, a, b) => { const {component, audio} = sound(id); if (op === 'play') audio.play(component.id); else if (op === 'stop') audio.stop(component.id); else if (op === 'fadeOut') audio.fade(component.id, 0, Number(b), true); else audio.fade(component.id, Number(a), Number(b), false); });
  fn('sndGet', (id, key) => { const {component} = sound(id); return Number((component.data as Record<string, unknown>)[String(key)]); });
  fn('sndSet', (id, key, v) => { const {component} = sound(id), n = Number(v); if (key === 'volume' && (n < 0 || n > 1)) throw Error('Volume must be 0–1'); if (key === 'rate' && (n < .25 || n > 4)) throw Error('Rate must be 0.25–4'); (component.data as Record<string, unknown>)[String(key)] = n; });
  fn('sndState', id => { const {component, audio} = sound(id); return JSON.stringify(audio.state(component.id) ?? {state: 'stopped', fade: 1, beat: -1, position: 0}); });
  const bus = (name: unknown) => { if (name !== 'music' && name !== 'sfx' && name !== 'ui') throw Error(`Unknown bus "${String(name)}": use music, sfx or ui`); if (!this.host.audio) throw Error('Audio is unavailable'); return {name: name as 'music' | 'sfx' | 'ui', audio: this.host.audio}; };
  fn('busGet', name => { const b = bus(name); return b.audio.bus(b.name); });
  fn('busSet', (name, v) => { const b = bus(name); b.audio.setBus(b.name, Number(v)); });
  fn('time', () => this.host.time());
  fn('stage', () => JSON.stringify(this.host.stage));
  fn('messageLimit', () => this.limits.messagesPerFrame);
  fn('log', (level, message) => this.host.log(level === 'warn' || level === 'error' ? level : 'info', String(message).slice(0, 2000)));
  vm.setProp(vm.global, '__host', host); host.dispose();
 }

 dispose() {
  if (this.dead) return;
  this.dead = true;
  this.frame?.dispose(); this.event?.dispose(); this.frame = this.event = null;
  this.vm?.dispose(); this.runtime?.dispose(); this.vm = null; this.runtime = null;
 }
}

/**
 * Reads a script's \`params\` export as Inspector fields (editor side): the code runs in a throwaway sandbox where only
 * \`param\` exists, so top-level code cannot reach the game. Errors are returned, not thrown.
 */
export function describeScript(module: QuickJSWASMModule, code: string, name = 'script'): {fields: ParamField[]; error?: string} {
 const runtime = module.newRuntime();
 runtime.setMemoryLimit(16 * 1024 * 1024); runtime.setMaxStackSize(512 * 1024);
 runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 200));
 const vm = runtime.newContext();
 try {
  const result = vm.evalCode(`"use strict";
const __num = v => { const n = Number(v); if (!Number.isFinite(n)) throw new TypeError('Expected a finite number'); return n; };
const __p = (kind, value, extra) => Object.assign({__param: kind, default: value}, extra || {});
globalThis.param = {
  number: (value = 0, o = {}) => __p('number', __num(value), {min: o.min, max: o.max, step: o.step, label: o.label}),
  bool: (value = false, o = {}) => __p('bool', Boolean(value), {label: o.label}),
  text: (value = '', o = {}) => __p('text', String(value), {label: o.label}),
  color: (value = '#ffffff', o = {}) => __p('color', String(value), {label: o.label}),
  choice: (options, value, o = {}) => { const list = Array.from(options || [], String); if (!list.length) throw new TypeError('param.choice needs options'); return __p('choice', value === undefined ? list[0] : String(value), {options: list, label: o.label}); },
  object: (o = {}) => __p('object', null, {label: o.label}),
};
const __blocked = new Proxy({}, {get() { throw new Error('game is only available inside hooks'); }});
globalThis.game = __blocked; globalThis.console = {log() {}, warn() {}, error() {}};
const module = {exports: {}};
(function (exports, module) {${code}\n})(module.exports, module);
const e = module.exports, h = e.default && typeof e.default === 'object' ? e.default : e, declared = h.params && typeof h.params === 'object' ? h.params : {};
JSON.stringify(Object.entries(declared).map(([name, v]) => v && typeof v === 'object' && v.__param ? Object.assign({name}, v, {kind: v.__param, __param: undefined}) : {name, kind: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? (/^#[0-9a-fA-F]{6}$/.test(v) ? 'color' : 'text') : 'unsupported', default: v}));`, `${name}.ts`);
  if (result.error) { const e = vm.dump(result.error) as {message?: string}; result.error.dispose(); return {fields: [], error: `${name}: params: ${e?.message ?? String(e)}`}; }
  const raw = JSON.parse(vm.getString(result.value)) as Record<string, unknown>[]; result.value.dispose();
  const bad = raw.find(f => f.kind === 'unsupported' || !/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(String(f.name)));
  if (bad) return {fields: [], error: `${name}: params.${String(bad.name)} must be a number, true/false, text, #colour or a param.* value`};
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  return {fields: raw.slice(0, 32).map((f): ParamField => {
   const field: ParamField = {name: String(f.name), kind: f.kind as ParamField['kind'], default: (f.default ?? null) as ParamField['default']};
   if (num(f.min) !== undefined) field.min = num(f.min); if (num(f.max) !== undefined) field.max = num(f.max); if (num(f.step) !== undefined) field.step = num(f.step);
   if (Array.isArray(f.options)) field.options = f.options.map(String); if (typeof f.label === 'string') field.label = f.label;
   return field;
  })};
 } finally { vm.dispose(); runtime.dispose(); }
}
