import {describe, expect, it} from 'vitest';
import type {Entity} from '@rewrite/scene';
import {flickerAt, lightDefinition, occluders, visibility, type Point} from './index';

const inside = (p: Point, poly: readonly Point[]) => { let hit = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit; } return hit; };
const entity = (id: string, x: number, y: number, components: {type: string; data: unknown}[], extra: Partial<Entity> = {}): Entity => ({id, name: id, parentId: null, active: true, components: [{id: `${id}-t`, type: 'scene.transform2d', version: 1, data: {x, y, rotation: 0, scaleX: 1, scaleY: 1}}, ...components.map((c, i) => ({id: `${id}-${i}`, version: 1, ...c}))], ...extra} as Entity);
const box = (w: number, h: number) => ({type: 'physics.boxCollider2d', data: {width: w, height: h, offsetX: 0, offsetY: 0, sensor: false, chamfer: 0}});

describe('lighting', () => {
 it('casts shadows from static, active, non-sensor colliders only', () => {
  const walls = occluders([
   entity('wall', 100, 0, [box(20, 20)]),
   entity('crate', 0, 100, [box(20, 20), {type: 'physics.rigidBody2d', data: {bodyType: 'dynamic'}}]),
   entity('pad', 0, -100, [{type: 'physics.boxCollider2d', data: {width: 20, height: 20, offsetX: 0, offsetY: 0, sensor: true, chamfer: 0}}]),
   entity('off', -100, 0, [box(20, 20)], {active: false}),
  ]);
  expect(walls).toHaveLength(1);
  expect(Math.min(...walls[0].map(p => p.x))).toBeCloseTo(90); expect(Math.max(...walls[0].map(p => p.x))).toBeCloseTo(110);
 });
 it('lights everything in reach without walls and leaves a shadow behind a wall', () => {
  const open = visibility({x: 0, y: 0}, 100, []);
  expect(inside({x: 95, y: 0}, open)).toBe(true); expect(inside({x: 0, y: -95}, open)).toBe(true);
  const wall = [{x: 40, y: -20}, {x: 60, y: -20}, {x: 60, y: 20}, {x: 40, y: 20}];
  const lit = visibility({x: 0, y: 0}, 100, [wall]);
  expect(inside({x: 30, y: 0}, lit)).toBe(true);
  expect(inside({x: 80, y: 0}, lit)).toBe(false);
  expect(inside({x: 80, y: 60}, lit)).toBe(true);
  expect(inside({x: -80, y: 0}, lit)).toBe(true);
 });
 it('ignores walls out of reach and walls the light sits inside', () => {
  const far = [{x: 500, y: -10}, {x: 520, y: -10}, {x: 520, y: 10}, {x: 500, y: 10}];
  expect(visibility({x: 0, y: 0}, 100, [far])).toHaveLength(4);
  const around = [{x: -10, y: -10}, {x: 10, y: -10}, {x: 10, y: 10}, {x: -10, y: 10}];
  expect(inside({x: 50, y: 0}, visibility({x: 0, y: 0}, 100, [around]))).toBe(true);
 });
 it('flickers within its range and is steady at zero', () => {
  expect(flickerAt(0, 3, 1)).toBe(1);
  const values = Array.from({length: 200}, (_, i) => flickerAt(.5, i / 30, 2));
  expect(Math.min(...values)).toBeGreaterThanOrEqual(.5); expect(Math.max(...values)).toBeLessThanOrEqual(1); expect(new Set(values.map(v => v.toFixed(2))).size).toBeGreaterThan(10);
  expect(lightDefinition.parse({color: '#ffffff', radius: 10, intensity: .5, flicker: 0, shadows: true})).toMatchObject({shadows: true});
  expect(() => lightDefinition.parse({color: 'red', radius: 10, intensity: .5, flicker: 0, shadows: true})).toThrow();
 });
});
