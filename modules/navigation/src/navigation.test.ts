import {describe, expect, it} from 'vitest';
import type {Entity} from '@rewrite/scene';
import {NavigationSession, buildField, clearLine, findPath, navAgentDefinition, obstacles, walkable, type NavField} from './index';

const t = (x: number, y: number, extra = {}) => ({id: `t${x}${y}${Math.random()}`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1, ...extra}});
const entity = (id: string, x: number, y: number, ...components: {type: string; data: unknown}[]): Entity => ({id, name: id, parentId: null, active: true, components: [t(x, y), ...components.map((c, i) => ({id: `${id}-${i}`, version: 1, ...c}))]} as Entity);
const grid = (data = {}) => ({type: 'navigation.grid', data: {cellSize: 10, width: 200, height: 100, clearance: 0, diagonal: true, show: true, ...data}});
const box = (w: number, h: number) => ({type: 'physics.boxCollider2d', data: {width: w, height: h, offsetX: 0, offsetY: 0, sensor: false, chamfer: 0}});
const body = (bodyType: string) => ({type: 'physics.rigidBody2d', data: {bodyType}});
const agent = (data = {}) => ({type: 'navigation.agent', data: {speed: 100, arriveDistance: 2, follow: '', repath: .5, face: false, ...data}});
// A wall from x 93..107, y 0..80 leaves a gap at the bottom (y 80..100).
const wallScene = (extra: Entity[] = []) => [entity('grid', 100, 50, grid()), entity('wall', 100, 40, box(14, 80)), ...extra];
const length = (from: {x: number; y: number}, path: {x: number; y: number}[]) => path.reduce((sum, p, i) => sum + Math.hypot(p.x - (i ? path[i - 1] : from).x, p.y - (i ? path[i - 1] : from).y), 0);

describe('navigation grid', () => {
 it('blocks cells under static colliders only, inflated by clearance', () => {
  const f = buildField(wallScene())!;
  expect([f.cols, f.rows, f.cell]).toEqual([20, 10, 10]);
  expect(walkable(f, {x: 100, y: 40})).toBe(false); expect(walkable(f, {x: 100, y: 90})).toBe(true); expect(walkable(f, {x: 80, y: 40})).toBe(true);
  const wide = buildField([entity('grid', 100, 50, grid({clearance: 12})), entity('wall', 100, 40, box(14, 80))])!;
  expect(walkable(wide, {x: 85, y: 40})).toBe(false); expect(walkable(wide, {x: 75, y: 40})).toBe(true);
  const moving = buildField([entity('grid', 100, 50, grid()), entity('crate', 100, 40, box(14, 80), body('dynamic')), entity('pad', 50, 50, {type: 'physics.boxCollider2d', data: {width: 20, height: 20, offsetX: 0, offsetY: 0, sensor: true, chamfer: 0}})])!;
  expect(moving.blocked.every(v => v === 0)).toBe(true);
  expect(obstacles([entity('static', 0, 0, box(4, 4), body('static'))])).toHaveLength(1);
  expect(buildField([entity('x', 0, 0)])).toBeNull();
 });
 it('follows rotation, scale and parents when placing obstacles', () => {
  const rotated = buildField([entity('grid', 100, 50, grid()), {...entity('wall', 100, 50, box(80, 14)), components: [t(100, 50, {rotation: 90}), {id: 'b', type: 'physics.boxCollider2d', version: 1, data: box(80, 14).data}]} as Entity])!;
  expect(walkable(rotated, {x: 100, y: 20})).toBe(false); expect(walkable(rotated, {x: 70, y: 50})).toBe(true);
  const parent = entity('parent', 50, 0), child = {...entity('child', 50, 50, box(14, 14)), parentId: 'parent'} as Entity;
  const f = buildField([entity('grid', 100, 50, grid()), parent, child])!;
  expect(walkable(f, {x: 100, y: 50})).toBe(false);
 });
 it('finds a short path around the wall, through the gap', () => {
  const f = buildField(wallScene())!, from = {x: 20, y: 20}, to = {x: 180, y: 20};
  const path = findPath(f, from, to)!;
  expect(path[path.length - 1]).toEqual(to);
  expect(path.some(p => p.y > 80)).toBe(true);
  for (let i = 0; i < path.length; i++) expect(clearLine(f, i ? path[i - 1] : from, path[i])).toBe(true);
  expect(length(from, path)).toBeLessThan(260);
  expect(findPath(f, from, from)).toEqual([]);
  expect(findPath(f, from, {x: 40, y: 20})).toEqual([{x: 40, y: 20}]);
 });
 it('moves blocked or outside goals to the nearest open cell and reports no way', () => {
  const f = buildField(wallScene())!;
  const into = findPath(f, {x: 20, y: 20}, {x: 100, y: 40})!; const end = into[into.length - 1];
  expect(walkable(f, end)).toBe(true); expect(Math.abs(end.x - 100)).toBeLessThanOrEqual(15);
  expect(findPath(f, {x: 20, y: 20}, {x: 900, y: 20})!.at(-1)!.x).toBeLessThan(200);
  const sealed = buildField([entity('grid', 100, 50, grid()), entity('wall', 100, 50, box(14, 120))])!;
  expect(findPath(sealed, {x: 20, y: 20}, {x: 180, y: 20})).toBeNull();
  const blocked: NavField = {...sealed, blocked: new Uint8Array(sealed.blocked.length).fill(1)};
  expect(findPath(blocked, {x: 20, y: 20}, {x: 30, y: 20})).toBeNull();
 });
 it('never cuts corners with diagonals and walks grid lines without them', () => {
  const f = buildField([entity('grid', 100, 50, grid({diagonal: false}))])!;
  const path = findPath(f, {x: 5, y: 5}, {x: 195, y: 95})!;
  expect(path).toEqual([{x: 195, y: 95}]);
  const corner = buildField([entity('grid', 100, 50, grid()), entity('a', 55, 45, box(8, 8)), entity('b', 45, 55, box(8, 8))])!;
  const around = findPath(corner, {x: 45, y: 45}, {x: 55, y: 55})!;
  expect(around.length).toBeGreaterThan(1);
 });
});

describe('navigation session', () => {
 const run = (entities: Entity[], physics?: {setVelocity(id: string, x: number, y: number): void; body(id: string): unknown}) => {
  const events: string[] = [];
  const s = new NavigationSession({entities: () => entities, emit: e => events.push(`${e.type}:${e.sourceId}`), silent: () => false, physics: physics ? () => physics : undefined});
  s.system.start!(); return {s, events};
 };
 const pos = (e: Entity) => e.components[0].data as {x: number; y: number; rotation: number};
 it('walks an agent to a point along the path and fires arrived once', () => {
  const walker = entity('walker', 20, 20, agent({speed: 200, face: true})), {s, events} = run(wallScene([walker]));
  expect(s.controls.moveTo('walker', 180, 20)).toBe(true);
  expect(s.controls.state('walker')).toMatchObject({moving: true, target: {x: 180, y: 20}});
  for (let i = 0; i < 200; i++) s.system.update!(1 / 60);
  expect(pos(walker)).toMatchObject({x: 180, y: 20}); expect(events).toEqual(['navigation.arrived:walker']);
  expect(s.controls.state('walker')).toMatchObject({moving: false});
  expect(Math.abs(pos(walker).rotation)).toBeLessThan(90);
  expect(s.controls.moveTo('walker', 180, 20)).toBe(true); expect(events).toHaveLength(2);
 });
 it('drives dynamic bodies by velocity and stops them on arrival', () => {
  const calls: [string, number, number][] = [], walker = entity('walker', 20, 50, agent({speed: 100}), body('dynamic'));
  const {s} = run([entity('grid', 100, 50, grid()), walker], {setVelocity: (id, x, y) => calls.push([id, x, y]), body: id => id === 'walker' ? {} : undefined});
  s.controls.moveTo('walker', 120, 50); s.system.update!(1 / 60);
  expect(calls.at(-1)).toEqual(['walker', 100, 0]);
  pos(walker).x = 119.5; s.system.update!(1 / 60);
  expect(calls.at(-1)).toEqual(['walker', 0, 0]);
 });
 it('follows a moving target, re-planning, and arrives when close', () => {
  const prey = entity('prey', 180, 90), hunter = entity('hunter', 20, 20, agent({speed: 300, follow: 'prey', repath: .1}));
  const {s, events} = run(wallScene([prey, hunter]));
  for (let i = 0; i < 120; i++) s.system.update!(1 / 60);
  expect(Math.hypot(pos(hunter).x - 180, pos(hunter).y - 90)).toBeLessThan(12); expect(events).toContain('navigation.arrived:hunter');
  pos(prey).x = 20; pos(prey).y = 90;
  for (let i = 0; i < 120; i++) s.system.update!(1 / 60);
  expect(Math.hypot(pos(hunter).x - 20, pos(hunter).y - 90)).toBeLessThan(12);
  s.controls.follow('hunter', null); expect(s.controls.state('hunter')).toMatchObject({moving: false});
 });
 it('places children in parent space and rejects objects without an agent', () => {
  const parent = entity('parent', 50, 0), child = {...entity('kid', 0, 20, agent({speed: 1000})), parentId: 'parent'} as Entity;
  const {s} = run([entity('grid', 100, 50, grid()), parent, child]);
  s.controls.moveTo('kid', 150, 20); for (let i = 0; i < 30; i++) s.system.update!(1 / 60);
  expect(pos(child)).toMatchObject({x: 100, y: 20});
  expect(() => s.controls.moveTo('parent', 1, 1)).toThrow(/Nav Agent/);
  expect(s.controls.findPath(5, 5, 15, 5)).toEqual([{x: 15, y: 5}]); expect(s.controls.walkable(-5, 5)).toBe(false);
 });
 it('remaps the followed object when copied', () => {
  expect(navAgentDefinition.remapReferences!({speed: 1, arriveDistance: 1, follow: 'a', repath: 1, face: false}, {entities: new Map([['a', 'b']]), components: new Map()})).toMatchObject({follow: 'b'});
 });
});
