import {beforeAll, expect, it} from 'vitest';
import type {QuickJSWASMModule} from 'quickjs-emscripten-core';
import type {Entity} from '@rewrite/scene';
import {compileScript} from './compile';
import {loadScriptEngine, ScriptSession, type Script3D, type ScriptHost} from './session';
import type {ScriptLibrary} from './contracts';

let engine: QuickJSWASMModule;
beforeAll(async () => { engine = await loadScriptEngine(); });

const t3 = (x = 0, y = 0, z = 0, q: [number, number, number, number] = [0, 0, 0, 1]) => ({x, y, z, qx: q[0], qy: q[1], qz: q[2], qw: q[3], scaleX: 1, scaleY: 1, scaleZ: 1});
const object3d = (id: string, name: string, parentId: string | null, transform = t3(), extra: Entity['components'] = []): Entity => ({id, name, active: true, parentId, spatial: 'scene3d.transform', components: [{id: `${id}-t`, type: 'scene3d.transform', version: 1, data: transform}, ...extra]} as unknown as Entity);
const behaviour = (scriptId: string) => ({id: `b-${scriptId}`, type: 'scripts.behaviour', version: 1, data: {scriptId, params: {}, refs: {}}}) as unknown as Entity['components'][number];
const library = (...scripts: {id: string; name: string; source: string}[]): ScriptLibrary => ({version: 1, items: scripts.map(s => ({...s, ...compileScript(s.source, s.name)}))});
const session = (entities: Entity[], source: string, space3d?: Script3D) => {
 const log: string[] = [];
 const h: ScriptHost = {entities: () => entities, time: () => 0, stage: {width: 960, height: 540}, names: {globals: [], scenes: []}, setActive: () => {}, changeScene: () => {}, invoke: () => {}, log: (level, message) => { log.push(`${level}: ${message}`); }, ...space3d ? {space3d} : {}};
 const s = new ScriptSession(engine, library({id: 's', name: 'S', source}), h, message => log.push(`report: ${message}`));
 return {s, log};
};
const data = (e: Entity) => e.components[0].data as ReturnType<typeof t3>;

it('moves, turns and scales 3D objects through position, rotation (Euler degrees) and scale', () => {
 const cube = object3d('c', 'Cube', 'view', t3(), [behaviour('s')]);
 const {s, log} = session([cube], `export function update(self: GameObject3D, dt: number) {
  self.position.y += 1; self.position.x = 2;
  self.rotation.y += 60;
  self.scale = 2; self.scale.z = 3;
  game.log(self.is3D, self.position.y, Math.round(self.rotation.y));
}`);
 for (let i = 0; i < 4; i++) s.system.update!(1 / 60);
 const d = data(cube);
 expect(log.filter(l => l.startsWith('report'))).toEqual([]);
 expect([d.x, d.y, d.z]).toEqual([2, 4, 0]);
 expect([d.scaleX, d.scaleY, d.scaleZ]).toEqual([2, 2, 3]);
 // 240° about +Y: the kept Euler counts past 90° and 180° instead of flipping to another solution.
 expect(log.at(-1)).toBe('info: true 4 240');
 expect(Math.hypot(d.qx, d.qy, d.qz, d.qw)).toBeCloseTo(1, 9);
 expect(d.qy).toBeCloseTo(Math.sin(240 * Math.PI / 360), 9); expect(d.qw).toBeCloseTo(Math.cos(240 * Math.PI / 360), 9);
});

it('reads Euler angles again after something else turned the object, and normalizes written quaternions', () => {
 const cube = object3d('c', 'Cube', 'view', t3(), [behaviour('s')]);
 const {s, log} = session([cube], `export function update(self: GameObject3D) {
  if (!self.state.done) { self.quaternion = {x: 0, y: 0, z: 2, w: 2}; self.state.done = true; }
  game.log(Math.round(self.rotation.z), JSON.stringify(self.quaternion));
}`);
 s.system.update!(1 / 60);
 expect(log[0]).toMatch(/^info: 90 /);
 const d = data(cube);
 expect(d.qz).toBeCloseTo(Math.SQRT1_2, 9); expect(d.qw).toBeCloseTo(Math.SQRT1_2, 9);
 // A tween or drag turns it meanwhile: the next read follows the transform, not the cached angle.
 Object.assign(d, {qx: 0, qy: 0, qz: 0, qw: 1});
 s.system.update!(1 / 60);
 expect(log[1]).toMatch(/^info: 0 /);
});

it('gives world positions through 3D parents and turns toward objects and points with lookAt', () => {
 const group = object3d('g', 'Group', 'view', {...t3(10, 0, 0, [0, Math.SQRT1_2, 0, Math.SQRT1_2]), scaleX: 2, scaleY: 2, scaleZ: 2});
 const eye = object3d('e', 'Eye', 'g', t3(0, 0, 1), [behaviour('s')]);
 const target = object3d('t', 'Target', 'view', t3(12, 0, -10));
 const {s, log} = session([group, eye, target], `export function update(self: GameObject3D) {
  const w = self.worldPosition; game.log([w.x, w.y, w.z].map(v => Math.abs(v) < 1e-9 ? '0.000' : v.toFixed(3)).join(' '));
  game.log(self.lookAt(game.find('Target')!), self.lookAt({x: w.x, y: w.y, z: w.z}));
}`);
 s.system.update!(1 / 60);
 // The group turns 90° about +Y and doubles: local (0, 0, 1) lands at (12, 0, 0).
 expect(log[0]).toBe('info: 12.000 0.000 0.000');
 expect(log[1]).toBe('info: true false');
 // +Z of the eye, taken to world space through the group's turn, now points from (12,0,0) toward (12,0,-10): −Z.
 const d = data(eye), parent = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
 const mul = (a: number[], b: number[]) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
 const [x, y, z, w] = mul(parent, [d.qx, d.qy, d.qz, d.qw]), forward = {x: 2 * (x * z + w * y), y: 2 * (y * z - w * x), z: 1 - 2 * (x * x + y * y)};
 expect(forward.x).toBeCloseTo(0, 6); expect(forward.y).toBeCloseTo(0, 6); expect(forward.z).toBeCloseTo(-1, 6);
});

it('refuses bad values and 3D calls on 2D objects with readable errors', () => {
 const flat = {id: 'f', name: 'Flat', active: true, parentId: null, components: [{id: 'f-t', type: 'scene.transform2d', version: 1, data: {x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1}}, behaviour('s')]} as unknown as Entity;
 const {s, log} = session([flat], `export function update(self: GameObject) { game.log(self.is3D, self.rotation); (self as any).position.x = 1; }`);
 s.system.update!(1 / 60);
 expect(log[0]).toBe('info: false 0');
 expect(log[1]).toMatch(/Flat is not a 3D object/);
 const cube = object3d('c', 'Cube', 'view', t3(), [behaviour('s')]);
 const bad = session([cube], `export function update(self: GameObject3D) { self.scale.x = 0; }`);
 bad.s.system.update!(1 / 60);
 expect(bad.log[0]).toMatch(/Scale cannot be 0/);
 expect(data(cube).scaleX).toBe(1);
});

it('raycasts through the 3D views, follows hover and drop events, and unloads and loads models', async () => {
 const model = {id: 'm', type: 'pixi3d.modelRenderer', version: 1, data: {assetId: 'castle', loaded: true}} as unknown as Entity['components'][number];
 const castle = object3d('c', 'Castle', 'view', t3(), [model, behaviour('s')]);
 const states = new Map<string, 'ready' | 'loading'>([['c', 'ready']]), rays: number[][] = [];
 const space3d: Script3D = {
  raycast: (x, y) => { rays.push([x, y]); return x > 100 ? {entityId: 'c', point: {x: 1, y: 2, z: 3}, normal: {x: 0, y: 1, z: 0}, uv: {u: .5, v: .25}, distance: 7} : null; },
  model: id => (model.data as {loaded: boolean}).loaded ? {state: states.get(id) ?? 'loading'} : {state: 'unloaded'},
  stats: () => ({resources: 1, refs: 1, loaded: 1, pendingUnloads: 0}),
 };
 const {s, log} = session([castle], `export function onPointerDown(self: GameObject3D, x: number, y: number) {
  const hit = game.raycast(x, y); game.log(hit ? hit.object.name + ' ' + hit.point.z + ' ' + hit.uv!.v : 'miss', game.pointer3d ? 'p' : '-');
}
export function onPointerEnter(self: GameObject3D) { game.log('enter', self.name); }
export function onPointerLeave(self: GameObject3D) { game.log('leave', self.name); }
export function onDragEnd(self: GameObject3D) { game.log('dropped', self.name); }
export function onMessage(self: GameObject3D, message: string) {
  if (message === 'unload') { self.model.unload(); game.log(self.model.state, JSON.stringify(game.assets.stats())); }
  if (message === 'load') self.model.load().then(o => game.log('back', o.name, self.model.state));
}`, space3d);
 s.pointer('down', 200, 10);
 s.pointer('down', 50, 10);
 expect(log.slice(0, 2)).toEqual(['info: Castle 3 0.25 p', 'info: miss -']);
 s.observe({type: 'pixi3d.pointerEnter', sourceId: 'c', silent: false});
 s.observe({type: 'pixi3d.pointerLeave', sourceId: 'other', silent: false});
 s.observe({type: 'pixi3d.dragEnd', sourceId: 'c', silent: false});
 expect(log.slice(2)).toEqual(['info: enter Castle', 'info: dropped Castle']);
 s.broadcast('unload');
 expect((model.data as {loaded: boolean}).loaded).toBe(false);
 expect(log.at(-1)).toBe('info: unloaded {"resources":1,"refs":1,"loaded":1,"pendingUnloads":0}');
 states.set('c', 'loading');
 s.broadcast('load');
 expect((model.data as {loaded: boolean}).loaded).toBe(true);
 s.system.update!(1 / 60);
 expect(log.at(-1)).not.toMatch(/back/);
 states.set('c', 'ready');
 s.system.update!(1 / 60);
 expect(log.at(-1)).toBe('info: back Castle ready');
 expect(log.filter(l => l.startsWith('report'))).toEqual([]);
});

it('says plainly when the scene has no 3D view', () => {
 const cube = object3d('c', 'Cube', 'view', t3(), [behaviour('s')]);
 const {s, log} = session([cube], `export function update(self: GameObject3D) { game.log(JSON.stringify(game.assets.stats())); game.raycast(1, 1); }`);
 s.system.update!(1 / 60);
 expect(log[0]).toBe('info: null');
 expect(log[1]).toMatch(/There is no 3D view in this scene/);
});

it('moves a 3D object under another one keeping its world place, back to the view with null, and refuses bad parents', () => {
 const view = {id: 'view', name: '3D View', active: true, parentId: null, components: [{id: 'v-t', type: 'scene.transform2d', version: 1, data: {x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1}}]} as unknown as Entity;
 const other = {...view, id: 'view2', name: 'Other view'} as Entity;
 const car = object3d('car', 'Car', 'view', {...t3(5, 0, 0, [0, Math.SQRT1_2, 0, Math.SQRT1_2]), scaleX: 2, scaleY: 2, scaleZ: 2});
 const crate = object3d('crate', 'Crate', 'view', t3(5, 1, -2), [behaviour('s')]);
 const lid = object3d('lid', 'Lid', 'crate', t3(0, 0.5, 0));
 const far = object3d('far', 'Far', 'view2', t3());
 const {s, log} = session([view, other, car, crate, lid, far], `export function onMessage(self: GameObject3D, message: string) {
  const w = () => { const p = self.worldPosition; return [p.x, p.y, p.z].map(v => Math.abs(v) < 1e-9 ? 0 : +v.toFixed(6)).join(','); };
  const before = w();
  if (message === 'ride') { self.parent = game.find('Car'); game.log(before, w(), self.parent!.name); }
  if (message === 'off') { self.parent = null; game.log(w(), self.parent!.name); }
  if (message === 'bad') for (const name of ['Lid', 'Far', 'Crate']) { try { self.parent = game.find(name); } catch (e) { game.log((e as Error).message); } }
}`);
 s.broadcast('ride');
 expect(crate.parentId).toBe('car');
 expect(log.at(-1)).toBe('info: 5,1,-2 5,1,-2 Car');
 // Under the car (turned 90° about +Y, scaled 2) the crate's local pose is the world one undone by the car's.
 const d = data(crate);
 expect(d.x).toBeCloseTo(1, 9); expect(d.y).toBeCloseTo(0.5, 9); expect(d.z).toBeCloseTo(0, 9); expect(d.scaleX).toBeCloseTo(0.5, 9);
 s.broadcast('off');
 expect(crate.parentId).toBe('view'); expect(log.at(-1)).toBe('info: 5,1,-2 3D View');
 expect([d.x, d.y, d.z].map(v => +v.toFixed(9))).toEqual([5, 1, -2]); expect(d.scaleX).toBeCloseTo(1, 9);
 s.broadcast('bad');
 expect(log.slice(-3).map(l => l.replace(/^report: /, ''))).toEqual([expect.stringContaining("can't go under its own child"), expect.stringContaining('is not a 3D object in the same view'), expect.stringContaining("can't go under itself")]);
 expect(crate.parentId).toBe('view');
});

it('hands script-made geometry to the 3D host as checked copies, with computed normals, packing and morph weights', () => {
 const mesh = {id: 'mesh', type: 'pixi3d.mesh', version: 1, data: {}} as unknown as Entity['components'][number];
 const shape = object3d('shape', 'Shape', 'view', t3(), [mesh, behaviour('s')]);
 const defined = new Map<string, import('./session').ScriptGeometryData>(), shown: [string, string][] = [], morphs: number[][] = [];
 const space3d: Script3D = {raycast: () => null, model: () => ({state: 'unloaded'}), stats: () => null, defineGeometry: (id, d) => { defined.set(id, d); }, setMeshGeometry: (e, id) => { shown.push([e, id]); }, setMorph: (_e, w) => { morphs.push([...w]); }};
 const {s, log} = session([shape], `export function onMessage(self: GameObject3D, message: string) {
  if (message === 'make') {
    const big = new Float32Array(30); const view = new Float32Array(big.buffer, 8, 9); view.set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const g = game.geometry({positions: view, colors: [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1], morphTargets: [{positions: [0, 0, 1, 0, 0, 1, 0, 0, 1]}], format: {colors: 'unorm8'}});
    self.mesh.geometry = g; self.mesh.morph = [0.25];
    game.log(String(g), g.morphTargets, self.mesh.geometry === g, JSON.stringify(self.mesh.morph));
  }
  if (message === 'bad') for (const spec of [{positions: [0, 0]}, {positions: [0, 0, 0, 1, 0, 0, 0, 1, NaN]}, {positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 7]}, {positions: [0, 0, 0, 2, 0, 0, 0, 1, 0], format: {positions: 'snorm16'}}, {positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], uvs: [0, 0]}])
    try { game.geometry(spec as any); } catch (e) { game.log((e as Error).message); }
  if (message === 'clear') { self.mesh.geometry = null; game.log(self.mesh.geometry); }
}`, space3d);
 s.broadcast('make');
 expect(log.at(-1)).toBe('info: Geometry(3 vertices) 1 true [0.25]');
 const [id, d] = [...defined][0];
 expect(Array.from(d.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
 // One triangle in the XY plane, counter-clockwise: its computed normal is +Z.
 expect(Array.from(d.normals)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
 expect(d.format).toEqual({positions: 'float32', normals: 'float32', colors: 'unorm8'});
 expect(d.morphTargets?.[0].positions.length).toBe(9);
 expect(shown).toEqual([['shape', id]]); expect(morphs).toEqual([[0.25]]);
 s.broadcast('bad');
 expect(log.slice(-5).map(l => l.replace('info: geometry: ', ''))).toEqual([
  'positions need x, y, z for each vertex', expect.stringContaining('finite number'), expect.stringContaining('points past the last vertex'), expect.stringContaining('within −1…1'), expect.stringContaining('uvs need 2 numbers per vertex')]);
 expect(defined.size).toBe(1);
 s.broadcast('clear');
 expect(shown.at(-1)).toEqual(['shape', '']); expect(log.at(-1)).toBe('info: null');
 expect(log.filter(l => l.startsWith('report'))).toEqual([]);
});

it('takes per-frame particle and batch writes as checked float views, and refuses the wrong component, sizes and values', () => {
 const particles = {id: 'pc', type: 'pixi3d.particles', version: 1, data: {count: 3, driver: 'script'}} as unknown as Entity['components'][number];
 const emitter = object3d('e', 'Emitter', 'view', t3(), [{id: 'ec', type: 'pixi3d.particles', version: 1, data: {count: 3, driver: 'emitter'}} as never]);
 const batch = object3d('b', 'Clay', 'view', t3(), [{id: 'bc', type: 'pixi3d.batch', version: 1, data: {size: 2}} as never]);
 const sparks = object3d('p', 'Sparks', 'view', t3(), [particles, behaviour('s')]);
 const wrote: [string, number[], number][] = [], shapes: string[][] = [];
 const space3d: Script3D = {raycast: () => null, model: () => ({state: 'unloaded'}), stats: () => null, defineGeometry: () => {}, writeParticles: (e, d, n) => { wrote.push([e, Array.from(d), n]); }, setBatchGeometries: (_e, ids) => { shapes.push([...ids]); }, writeBatch: (e, d, n) => { wrote.push([e, Array.from(d), n]); }};
 const {s, log} = session([sparks, emitter, batch], `export function onMessage(self: GameObject3D, message: string) {
  if (message === 'go') {
    const big = new Float32Array(20); big.set([1, 2, 3, 0.5, 1, 0, 0, 1], 4);
    self.particles.write(new Float32Array(big.buffer, 16, 8), 1);
    self.particles.write([0, 0, 0, 1, 1, 1, 1, 1, 9, 9, 9, 1, 0, 0, 0, 1]);
    const clay = game.find<GameObject3D>('Clay')!, g = game.geometry({positions: [0, 0, 0, 1, 0, 0, 0, 1, 0]});
    clay.batch.geometries = [g, null];
    clay.batch.write([0, 1, 2, 3, 0, 0, 0, 1, 1, 0.5, 0.5, 0.5], 1);
    game.log(self.particles.count, clay.batch.size);
  }
  if (message === 'bad') {
    const tries: (() => void)[] = [
      () => game.find<GameObject3D>('Emitter')!.particles.write([0, 0, 0, 1, 1, 1, 1, 1]),
      () => self.particles.write(new Float32Array(32), 4),
      () => self.particles.write(new Float32Array(8), 2),
      () => game.find<GameObject3D>('Clay')!.batch.write(new Float32Array(36), 3),
    ];
    const nan = new Float32Array(8); nan[2] = NaN; tries.push(() => self.particles.write(nan, 1));
    for (const t of tries) { try { t(); } catch (e) { game.log((e as Error).message); } }
  }
}`, space3d);
 s.broadcast('go');
 expect(log.at(-1)).toBe('info: 3 2');
 expect(wrote[0]).toEqual(['p', [1, 2, 3, 0.5, 1, 0, 0, 1], 1]);
 expect(wrote[1][2]).toBe(2); expect(wrote[1][1].length).toBe(16);
 expect(shapes[0][1]).toBe(''); expect(shapes[0][0]).toMatch(/-g1$/);
 expect(wrote[2]).toEqual(['b', [0, 1, 2, 3, 0, 0, 0, 1, 1, 0.5, 0.5, 0.5], 1]);
 s.broadcast('bad');
 expect(log.slice(-5).map(l => l.replace(/^info: /, ''))).toEqual([
  expect.stringContaining('"Driven by" to A script'), expect.stringContaining('its pool holds 3'), expect.stringContaining('2 items need 16 numbers'), expect.stringContaining('it has 2 slots'), expect.stringContaining('value 2 is not a finite number')]);
 expect(wrote.length).toBe(3);
});
