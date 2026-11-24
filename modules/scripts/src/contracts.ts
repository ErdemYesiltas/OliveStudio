import {z} from 'zod';

/**
 * Behaviour scripts, pure parts: the project's script library (TypeScript source plus the compiled JavaScript the
 * sandbox runs), the component that attaches a script to an object, and the API declaration the editor shows.
 */

/** Project section with every script; compiled code is kept so games run without a compiler. */
export const scriptsSection = 'scripts.library';
export const behaviourType = 'scripts.behaviour';
export const ScriptNameSchema = z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9 _-]+$/, 'Script names use letters, digits, spaces, _ and -');
export const ScriptSchema = z.object({
 id: z.string().min(1), name: ScriptNameSchema,
 source: z.string().max(200_000),
 /** JavaScript for the sandbox (CommonJS exports), empty while the source has errors. */
 code: z.string().max(400_000),
 /** Compile error shown in the editor and reported before Play/Export. */
 error: z.string().max(2000).optional(),
}).strict();
export type Script = z.infer<typeof ScriptSchema>;
/** Inspector values handed to the script as `self.params` (over the script's own `params` export). */
export const ParamValueSchema = z.union([z.number().finite(), z.string().max(500), z.boolean()]);
export const ParamNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/, 'Parameter names use letters, digits and _ and start with a letter');
export const BehaviourSchema = z.object({
 scriptId: z.string(),
 params: z.record(ParamNameSchema, ParamValueSchema).refine(p => Object.keys(p).length <= 32, 'At most 32 parameters'),
 /** Object parameters (\`param.object()\`): entity IDs in the same scene, remapped when objects are copied. */
 refs: z.record(ParamNameSchema, z.string().max(100)).refine(p => Object.keys(p).length <= 32, 'At most 32 references').default({}),
}).strict();
export type Behaviour = z.infer<typeof BehaviourSchema>;
export const ScriptLibrarySchema = z.object({version: z.literal(1), items: z.array(ScriptSchema).max(200),
 /** Scene scripts: one per scene (scene ID → script and its parameters), running for the whole scene. */
 scenes: z.record(z.string().min(1), BehaviourSchema).optional(),
}).strict().superRefine((v, c) => {
 if (new Set(v.items.map(s => s.id)).size !== v.items.length) c.addIssue({code: 'custom', message: 'Script IDs must be unique'});
 if (new Set(v.items.map(s => s.name.toLowerCase())).size !== v.items.length) c.addIssue({code: 'custom', message: 'Script names must be unique'});
});
export type ScriptLibrary = z.infer<typeof ScriptLibrarySchema>;
export const emptyLibrary = (): ScriptLibrary => ({version: 1, items: []});

/** One Inspector field, read from a script's \`params\` export (\`param.number(120, {min: 0})\` or a plain value). */
export interface ParamField {name: string; kind: 'number' | 'bool' | 'text' | 'color' | 'choice' | 'object'; default: number | string | boolean | null; min?: number; max?: number; step?: number; options?: string[]; label?: string}



/** Starting point for a new script: every hook the runtime calls, documented. */
export const scriptTemplate = `// Runs inside the game, once per object this script is attached to.
// \`self\` is that object; \`game\` finds others and changes scenes; \`globals\` holds the project's globals.

/** Defaults for this script's parameters (the Properties panel can override them per object). */
export const params = {speed: param.number(120, {min: 0, max: 600})};

/** Once, before any update or event in the scene (the scene script's start runs first). */
export function start(self: GameObject) {
  self.state.direction = 1;
}

/** Every frame; dt is the time since the last frame in seconds. */
export function update(self: GameObject, dt: number) {
  self.x += self.params.speed * self.state.direction * dt;
  if (self.x > game.stage.width - 50 || self.x < 50) self.state.direction *= -1;
}

/** The object was clicked or tapped. Globals (Globals panel) read and write like fields, e.g. \`globals.score += 1\`. */
export function onClick(self: GameObject) {
  game.log(self.name, 'clicked');
}
`;

/** Hooks the runtime calls, in the order the docs list them. */
export const hookNames = ['start', 'update', 'onClick', 'onCollision', 'onInput', 'onGlobal', 'onCollisionExit', 'onMessage', 'onMarker', 'onComplete', 'onBeat', 'onSoundEnd', 'onPointerDown', 'onPointerMove', 'onPointerUp', 'onTimer', 'onArrive', 'onDialogue', 'onPointerEnter', 'onPointerLeave', 'onDragEnd'] as const;

/** Declarations for the editor (Monaco extra lib): the sandbox API, nothing else exists (no DOM, no network, no imports). */
export const apiDeclarations = `
type ParamValue = number | string | boolean;
type GlobalValue = number | boolean | string | GlobalValue[] | {[key: string]: GlobalValue};
/** A ray's hit: the object, the point, the surface normal and the distance from the start. */
interface RayHit {object: GameObject; x: number; y: number; normalX: number; normalY: number; distance: number}
/** Where and how hard two bodies met (world px, px/s). */
interface Contact {x: number; y: number; normalX: number; normalY: number; depth: number; speed: number}
/** A Rigid Body while the game runs (velocity px/s, angular °/s; forces and impulses scale with mass). */
interface PhysicsBody {velocity: {x: number; y: number}; angularVelocity: number; readonly mass: number; readonly sleeping: boolean; applyForce(x: number, y: number): void; applyImpulse(x: number, y: number): void; /** Adds velocity regardless of mass. */ push(x: number, y: number): void; teleport(x: number, y: number): void}
/** Project globals (Globals panel), read and written like fields: \`globals.score += 10\`, \`globals.paused = true\`, \`globals.inventory.push('key')\`, \`globals.player.hp -= 1\` (lists and objects write back when changed in place). Each one keeps its declared type; a change runs onGlobal hooks and Global changes rules. */
interface Globals {}
declare const globals: Globals;
/** RxJS 7 (rx.map, rx.filter, rx.timer, …). Timers and delays follow the game clock: they pause with Preview. */
declare const rx: typeof import('rxjs');
type Observable<T> = import('rxjs').Observable<T>;
/** An Audio Source as a sound: live volume and rate, fades on the game clock, beats from its BPM. */
interface SoundHandle {
  play(): void;
  stop(): void;
  /** Starts it (if stopped) from silence. */
  fadeIn(seconds?: number): void;
  /** Stops it at the end. */
  fadeOut(seconds?: number): void;
  fadeTo(volume: number, seconds?: number): void;
  volume: number;
  rate: number;
  readonly playing: boolean;
  readonly state: string;
  readonly beat: number;
  readonly position: number;
  readonly beat$: Observable<number>;
  readonly bar$: Observable<number>;
  readonly ended$: Observable<GameObject>;
}
/** An Animation component's timeline. */
interface TimelineHandle {
  /** Restart from the beginning (or end when reversed), optionally on another clip by name. */
  play(): void;
  /** Switch to this clip (the active one if none was named) from the pose it has now, blending over seconds (default 0.3): numbers and colours blend, on/off and text switch at once. */
  crossFade(seconds?: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Jump to a time in seconds (no markers fire). */
  seek(time: number): void;
  /** 1 = normal, 2 = double speed (0.01–100). */
  speed(value: number): void;
  /** Flip the direction (it keeps playing from where it is). */
  reverse(): void;
  readonly time: number;
  readonly playing: boolean;
  readonly duration: number;
  readonly time$: Observable<number>;
  readonly markers$: Observable<string>;
  readonly complete$: Observable<GameObject>;
}
/** An object in the running scene. Changes affect the play session only, never the project. */
interface GameObject {
  readonly id: string;
  readonly name: string;
  /** Physics (needs a Rigid Body): velocity, forces, impulses. Collisions call onCollision(self, other, contact) and onCollisionExit(self, other). */
  readonly body: PhysicsBody;
  /** Position of the object's centre in pixels (x right, y down). */
  x: number;
  y: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** Negative values mirror the object (flip). */
  scaleX: number;
  scaleY: number;
  /** Shear in degrees (−89 to 89): skewX tilts the vertical axis, skewY the horizontal one. */
  skewX: number;
  skewY: number;
  /** Opacity of the object's visual, 0–1. */
  alpha: number;
  /** Hidden objects (and their children) stop updating and receiving clicks. */
  active: boolean;
  /** True for objects in a 3D view: use them as GameObject3D (game.find<GameObject3D>(name)). */
  readonly is3D: boolean;
  /** The text of a Text or Bitmap Text object (throws on other objects). */
  text: string;
  /** Remove this object and its children from the game (its scripts stop; IDs are not reused). */
  destroy(): void;
  /** This script's parameters: its \`params\` export overridden by the Properties panel. */
  readonly params: Record<string, any>;
  /** Free storage for this object and script, kept for the whole scene. */
  state: Record<string, any>;
  /** The parent object, or null at the top of the scene. */
  readonly parent: GameObject | null;
  /** Direct children, in Layers order. */
  readonly children: GameObject[];
  /** This object's Audio Source as a sound. */
  sound(): SoundHandle;
  /** This object's Animation component as a timeline (clip by name; the active clip if omitted). */
  timeline(clip?: string): TimelineHandle;
  /** Play or stop this object's sound, tween or animation (the first one if kind is omitted). */
  play(kind?: 'audio' | 'tween' | 'animation' | 'timer'): void;
  stop(kind?: 'audio' | 'tween' | 'animation' | 'timer'): void;
}
/** Vertex data for game.geometry: numbers per vertex (positions/normals 3, uvs 2, colors/colors1 4 as r, g, b, a 0–1), triangles as indices; normals are computed when missing. */
interface GeometrySpec {
  positions: ArrayLike<number>; normals?: ArrayLike<number>; uvs?: ArrayLike<number>; colors?: ArrayLike<number>; colors1?: ArrayLike<number>; indices?: ArrayLike<number>;
  /** Shapes as offsets from positions (and normals) for every vertex; Mesh 3D's morph weights blend them in (at most 8). */
  morphTargets?: {positions: ArrayLike<number>; normals?: ArrayLike<number>}[];
  /** How it is stored on the GPU: snorm16 positions (within −1…1), snorm8 normals, unorm8 colours; default float32. */
  format?: {positions?: 'float32' | 'snorm16'; normals?: 'float32' | 'snorm8'; colors?: 'float32' | 'unorm8'};
}
/** A shape the host keeps for this play session; give it to any number of Mesh 3D objects. */
interface GeometryRef {readonly id: string; readonly vertexCount: number; readonly morphTargets: number}
/** 3D vectors read and write one axis at a time (\`self.position.y += 1\`); set() writes all three. */
interface Vec3 {x: number; y: number; z: number; set(x: number, y?: number, z?: number): Vec3}
/** A hit in a 3D view: the object, the world point, and the surface normal and UV on triangle meshes (null on simple shapes). */
interface Hit3D {readonly object: GameObject3D; readonly point: {x: number; y: number; z: number}; readonly normal: {x: number; y: number; z: number} | null; readonly uv: {u: number; v: number} | null; readonly distance: number}
/** An object in a 3D view (Transform 3D): world units, Euler degrees in XYZ order like the Inspector. Use \`self: GameObject3D\` in its hooks. */
interface GameObject3D extends Omit<GameObject, 'rotation' | 'x' | 'y' | 'scaleX' | 'scaleY' | 'skewX' | 'skewY' | 'is3D' | 'children' | 'parent'> {
  readonly is3D: true;
  /** Local position (parent space); assign {x, y, z} to set all three. */
  get position(): Vec3; set position(v: {x: number; y: number; z: number});
  /** Local rotation in degrees; \`self.rotation.y += 90 * dt\` turns it about +Y. */
  get rotation(): Vec3; set rotation(v: {x: number; y: number; z: number});
  /** Local rotation as a unit quaternion (normalized when written). */
  quaternion: {x: number; y: number; z: number; w: number};
  /** Local scale per axis; assign a number to scale all three. */
  get scale(): Vec3; set scale(v: number | {x: number; y: number; z: number});
  /** Direct children (in a 3D view they are 3D objects too). */
  readonly children: GameObject3D[];
  /** The parent object; set another 3D object of the same view (or null for the view's top level) to move this one under it, keeping its place in the world. */
  parent: GameObject3D | GameObject | null;
  /** Where the object is in the view's world (read only). */
  readonly worldPosition: {readonly x: number; readonly y: number; readonly z: number};
  /** Turn +Z (or '-Z') toward an object or a world point; yawOnly keeps it upright. False when the target is on top of it. */
  lookAt(target: GameObject | {x: number; y: number; z: number}, options?: {yawOnly?: boolean; axis?: '+Z' | '-Z'}): boolean;
  /** A Particles 3D whose "Driven by" is A script: write 8 numbers per particle (x, y, z, size, r, g, b, alpha; colours 0–1) every frame; count is its pool. */
  readonly particles: {write(data: Float32Array | ArrayLike<number>, count?: number): void; readonly count: number};
  /** A Batch 3D: the shapes its items pick from (by index), and 12 numbers per item (shape index, x, y, z, qx, qy, qz, qw, scale, r, g, b); size is its slots. */
  readonly batch: {geometries: (GeometryRef | null)[]; write(data: Float32Array | ArrayLike<number>, count?: number): void; readonly size: number};
  /** The Mesh 3D: the shape it shows (null = its stand-in cube) and morph weights, one 0–1 number per morph target. */
  readonly mesh: {geometry: GeometryRef | null; morph: number[]};
  /** The Model 3D: unload() frees its GPU resources (the object stays, drawing nothing); load() brings it back and resolves when it is drawn. */
  readonly model: {readonly state: 'unloaded' | 'loading' | 'ready' | 'error'; readonly error: string | null; unload(): void; load(): Promise<GameObject3D>};
}
/** A scene script's \`self\`: the scene has no position, only parameters and state. */
interface SceneSelf {
  readonly name: string;
  readonly params: Record<string, any>;
  state: Record<string, any>;
}
interface ParamOptions { label?: string }
/** Typed parameters for \`export const params = {...}\`: each becomes a field in the Properties panel. */
declare const param: {
  number(defaultValue?: number, options?: ParamOptions & {min?: number; max?: number; step?: number}): number;
  bool(defaultValue?: boolean, options?: ParamOptions): boolean;
  text(defaultValue?: string, options?: ParamOptions): string;
  /** #rrggbb */
  color(defaultValue?: string, options?: ParamOptions): string;
  choice<T extends string>(options: readonly T[], defaultValue?: T, extra?: ParamOptions): T;
  /** An object of the same scene, picked in the Properties panel (null when none is set). */
  /** \`param.object<GameObject3D>()\` for a 3D object. */
  object<T extends GameObject | GameObject3D = GameObject>(options?: ParamOptions): T | null;
};
declare const game: {
  /** Seconds since the scene started. */
  readonly time: number;
  /** Stage size in pixels. */
  readonly stage: {readonly width: number; readonly height: number};
  /** The first active-or-not object with this name, or null. */
  find<T extends GameObject | GameObject3D = GameObject>(name: string): T | null;
  /** Every object with this name. */
  findAll<T extends GameObject | GameObject3D = GameObject>(name: string): T[];
  /** Project globals (same object as \`globals\`). */
  readonly globals: Globals;
  /** World physics: gravity (px/s², settable) and queries in world pixels (bodies only). */
  readonly physics: {gravity: {x: number; y: number}; raycast(x1: number, y1: number, x2: number, y2: number): RayHit | null; raycastAll(x1: number, y1: number, x2: number, y2: number): RayHit[]; objectsAt(x: number, y: number): GameObject[]; objectsIn(x: number, y: number, width: number, height: number): GameObject[]};
  /** Achievements and leaderboards (project Achievements panel), kept on the player's device. */
  readonly achievements: {unlock(name: string): boolean; unlocked(name: string): boolean; list(): {name: string; unlocked: boolean}[]};
  readonly leaderboard: {submit(board: string, score: number, name?: string): number; top(board: string): {name: string; score: number}[]};
  /** Dialogues (project Dialogues panel): start one by name, continue, pick a choice, close; current is the line on screen or null. Events and the end call onDialogue(self, event, dialogue) ('end' when it closes). */
  readonly dialogue: {start(name: string): void; advance(): void; choose(index: number): void; stop(): void; readonly current: {dialogue: string; speaker: string; text: string; choices: string[]} | null};
  /** Pathfinding on the scene's Nav Grid (world pixels). moveTo / follow / stop need a Nav Agent on the object; reaching the end calls onArrive(self). */
  readonly navigation: {findPath(x1: number, y1: number, x2: number, y2: number): {x: number; y: number}[] | null; moveTo(target: GameObject, x: number, y: number): boolean; follow(target: GameObject, chase: GameObject | null): void; stop(target: GameObject): void; walkable(x: number, y: number): boolean; rebuild(): void; state(target: GameObject): {moving: boolean; remaining: number; target: {x: number; y: number} | null} | undefined};
  /** The scene camera (Camera 2D object, else the stage centre): follow an object (null stops), shake (px, seconds), zoom (>1 magnifies), look at a world point (stops following). x/y are the world point at the screen centre. */
  readonly camera: {follow(target: GameObject | null): void; stopFollowing(): void; shake(strength?: number, seconds?: number): void; lookAt(x: number, y: number): void; zoom: number; readonly x: number; readonly y: number; readonly rotation: number};
  /** Whether an input action (Input panel) is held down. */
  isDown(action: string): boolean;
  /** Switch to the scene with this name at the end of the frame. */
  changeScene(name: string): void;
  /** Load the scene with this name into the running one (its objects, rules and object scripts join; its scene script does not run). Once per scene; removeScene takes its objects out again. */
  addScene(name: string): void;
  /** Remove the objects addScene brought in (copies spawned from them stay). */
  removeScene(name: string): void;
  /** A copy of the prefab with this name (or else the scene object with this name, e.g. a hidden template) placed at (x, y), with its children, bodies, tweens and scripts. Its scripts start on the next frame. */
  spawn(name: string, x?: number, y?: number): GameObject;
  /** The mouse or touch in world pixels (after the camera) and whether it is pressed. onPointerDown / onPointerMove / onPointerUp(self, x, y) run on every script. */
  readonly pointer: {readonly x: number; readonly y: number; readonly down: boolean};
  /** A shape from arrays for Mesh 3D objects (\`self.mesh.geometry = game.geometry({...})\`); kept for the play session, not saved. */
  geometry(spec: GeometrySpec): GeometryRef;
  /** The closest 3D object under a world-pixel point (e.g. game.pointer.x, game.pointer.y), or null. Hover hooks: onPointerEnter(self) / onPointerLeave(self); a Draggable 3D drop calls onDragEnd(self). */
  raycast(x: number, y: number): Hit3D | null;
  /** The 3D hit under the mouse or touch right now, or null. */
  readonly pointer3d: Hit3D | null;
  /** Shared 3D model files: how many are cached, how many objects use them, how many are ready, and unloads still waiting. */
  readonly assets: {stats(): {resources: number; refs: number; loaded: number; pendingUnloads: number} | null};
  /** Calls onMessage(self, message, data) on every script in the scene (after the current hook). */
  send(message: string, data?: unknown): void;
  log(...values: unknown[]): void;
  random(): number;
  /** Localized text by key (Localization panel) in the current language; values fill {{placeholders}}, count picks a plural form. Returns the key when missing. */
  t(key: string, values?: Record<string, string | number>): string;
  /** Current language code (e.g. "en"). */
  readonly language: string;
  setLanguage(id: string): void;
  /** Bus volumes on top of the project mix (0–1) and crossfades between two objects' sounds. */
  readonly audio: {bus(name: 'music' | 'sfx' | 'ui'): {volume: number}; crossfade(from: GameObject | null, to: GameObject | null, seconds?: number): void};
  /** Every frame, after timers and before update hooks. */
  readonly frame$: Observable<{dt: number; time: number}>;
  /** Event streams, optionally for one object. */
  on(type: 'click' | 'collision' | 'collisionExit', target?: GameObject): Observable<GameObject>;
  on(type: 'input', target?: GameObject): Observable<{action: string; phase: 'pressed' | 'released'}>;
  on(type: 'global', target?: GameObject): Observable<{name: string; value: GlobalValue}>;
  on(type: 'message', target?: GameObject): Observable<{message: string; data: any}>;
  on(type: 'marker', target?: GameObject): Observable<{object: GameObject; name: string}>;
  on(type: 'complete', target?: GameObject): Observable<GameObject>;
  on(type: 'beat', target?: GameObject): Observable<{object: GameObject; beat: number; bar: boolean}>;
  on(type: 'soundEnd', target?: GameObject): Observable<GameObject>;
};
declare function setTimeout(fn: (...args: any[]) => void, ms?: number, ...args: any[]): number;
declare function setInterval(fn: (...args: any[]) => void, ms?: number, ...args: any[]): number;
declare function clearTimeout(id: number): void;
declare function clearInterval(id: number): void;
declare const console: {log(...values: unknown[]): void; warn(...values: unknown[]): void; error(...values: unknown[]): void};
`;

/** Typed \`globals\` for the editor: one field per project global (merged into the \`Globals\` interface). */
/** A TypeScript type for a JSON value (list and object globals are typed from their initial value). */
export function jsonType(value: unknown, depth = 0): string {
 if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return typeof value;
 if (depth > 4 || value === null || typeof value !== 'object') return 'unknown';
 if (Array.isArray(value)) { const items = [...new Set(value.map(v => jsonType(v, depth + 1)))]; return items.length === 0 ? 'any[]' : items.length === 1 ? (items[0].includes(' ') || items[0].startsWith('{') ? `Array<${items[0]}>` : `${items[0]}[]`) : `Array<${items.join(' | ')}>`; }
 const fields = Object.entries(value).map(([k, v]) => `${k}: ${jsonType(v, depth + 1)}`);
 return `{${fields.join('; ')}${fields.length ? '; ' : ''}[key: string]: any}`;
}
export const globalsDeclaration = (globals: readonly {name: string; type: string; initial?: unknown}[]) => `interface Globals {\n${globals.map(g => `  ${g.name}: ${g.type === 'list' || g.type === 'object' ? jsonType(g.initial ?? (g.type === 'list' ? [] : {})) : g.type};`).join('\n')}\n}\n`;

/** Starting points for New script (Scripts panel): each compiles as is and explains what to set up. */
export const scriptTemplates: readonly {id: string; title: string; name: string; source: string}[] = [
 {id: 'blank', title: 'Starter (moves back and forth)', name: 'Script', source: scriptTemplate},
 {id: 'topdown', title: 'Top-down mover (input actions)', name: 'TopDownMover', source: `// Moves the object with four input actions. Create them in the Input panel (e.g. arrows or WASD) and type
// their names in this script's fields in Properties.
export const params = {
  speed: param.number(220, {min: 0, max: 1000}),
  left: param.text('left'), right: param.text('right'), up: param.text('up'), down: param.text('down'),
};

export function update(self: GameObject, dt: number) {
  const p = self.params;
  const x = (game.isDown(p.right) ? 1 : 0) - (game.isDown(p.left) ? 1 : 0);
  const y = (game.isDown(p.down) ? 1 : 0) - (game.isDown(p.up) ? 1 : 0);
  const length = Math.hypot(x, y) || 1;
  self.x += x / length * p.speed * dt;
  self.y += y / length * p.speed * dt;
}
`},
 {id: 'platformer', title: 'Platformer (physics, jump)', name: 'PlatformerController', source: `// Runs and jumps a Rigid Body (Properties → Add component → Rigid Body 2D and a collider). Create the input
// actions in the Input panel and type their names below.
export const params = {
  speed: param.number(260, {min: 0, max: 1000}),
  jump: param.number(520, {min: 0, max: 2000}),
  left: param.text('left'), right: param.text('right'), jumpAction: param.text('jump'),
};

export function update(self: GameObject) {
  const p = self.params, body = self.body;
  body.velocity = {x: ((game.isDown(p.right) ? 1 : 0) - (game.isDown(p.left) ? 1 : 0)) * p.speed, y: body.velocity.y};
  // Resting on something: hardly any vertical speed. A new press (not a held key) jumps.
  const grounded = Math.abs(body.velocity.y) < 0.5, pressed = game.isDown(p.jumpAction);
  if (grounded && pressed && !self.state.held) body.velocity = {x: body.velocity.x, y: -p.jump};
  self.state.held = pressed;
}
`},
 {id: 'follow', title: 'Follow the pointer', name: 'FollowPointer', source: `// Eases towards the mouse or finger; set ease to 1 to stick to it.
export const params = {ease: param.number(8, {min: 0.5, max: 60})};

export function update(self: GameObject, dt: number) {
  const k = Math.min(1, self.params.ease * dt);
  self.x += (game.pointer.x - self.x) * k;
  self.y += (game.pointer.y - self.y) * k;
}
`},
 {id: 'hover', title: 'Hover and spin', name: 'HoverSpin', source: `// Bobs up and down around its start and turns; good for pickups and coins.
export const params = {
  height: param.number(12, {min: 0, max: 200}),
  speed: param.number(2, {min: 0, max: 20}),
  spin: param.number(90, {min: -720, max: 720}),
};

export function start(self: GameObject) { self.state.y = self.y; self.state.t = 0; }

export function update(self: GameObject, dt: number) {
  self.state.t += dt;
  self.y = self.state.y + Math.sin(self.state.t * self.params.speed) * self.params.height;
  self.rotation += self.params.spin * dt;
}
`},
 {id: 'clicker', title: 'Click counter (global)', name: 'ClickCounter', source: `// Adds to a number global on every click (create it in the Globals panel, e.g. score) and pops the object.
export const params = {global: param.text('score'), amount: param.number(1)};

export function onClick(self: GameObject) {
  const g = globals as unknown as Record<string, number>;
  g[self.params.global] = (g[self.params.global] ?? 0) + self.params.amount;
  self.scaleX = self.scaleY = 1.2;
  setTimeout(() => { self.scaleX = self.scaleY = 1; }, 120);
}
`},
 {id: 'spawner', title: 'Spawner (every few seconds)', name: 'Spawner', source: `// Places a copy of a prefab (or a hidden template object) by name every few seconds, at a random spot around this
// object. Copies remove themselves after their lifetime.
export const params = {
  prefab: param.text('Enemy'),
  every: param.number(2, {min: 0.1, max: 60}),
  spread: param.number(200, {min: 0, max: 2000}),
  lifetime: param.number(10, {min: 0, max: 600}),
};

export function start(self: GameObject) { self.state.next = 0; }

export function update(self: GameObject, dt: number) {
  self.state.next -= dt;
  if (self.state.next > 0) return;
  self.state.next = self.params.every;
  const copy = game.spawn(self.params.prefab, self.x + (game.random() - 0.5) * self.params.spread, self.y);
  if (self.params.lifetime > 0) setTimeout(() => copy.destroy(), self.params.lifetime * 1000);
}
`},
];
