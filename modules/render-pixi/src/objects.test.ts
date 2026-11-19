import {expect, it} from 'vitest';
import {objectDefinitions, particleBounds, particleState, waveAt, ParticlesSchema, NineSliceSchema, type ParticlesData} from './objects';
import {shapePoints} from './display';
import {ShapeSchema} from './contracts';

it('object defaults parse and stay in the shared render.visual group', () => {
 for (const d of objectDefinitions) {
  expect(d.parse(d.defaults())).toEqual(d.defaults());
  expect(d.exclusiveGroup).toBe('render.visual');
  expect(d.fields.every(f => f.key in (d.defaults() as object))).toBe(true);
 }
 expect(() => NineSliceSchema.parse({...(objectDefinitions[1].defaults() as object), left: -1})).toThrow();
});

it('particles are a pure function of time: deterministic, steady at time 0, inside their bounds', () => {
 const p = ParticlesSchema.parse(objectDefinitions[4].defaults()) as ParticlesData;
 const at = (t: number) => Array.from({length: p.count}, (_, i) => particleState(p, i, t));
 expect(at(1.234)).toEqual(at(1.234));
 expect(at(0).filter(s => s.x !== 0 || s.y !== 0).length).toBeGreaterThan(p.count / 2);
 expect(at(0)).toEqual(at(-5));
 const b = particleBounds(p);
 for (const t of [0, 0.4, 1.7, 9.99]) for (const s of at(t)) {
  expect(s.x).toBeGreaterThanOrEqual(b.x); expect(s.x).toBeLessThanOrEqual(b.x + b.width);
  expect(s.y).toBeGreaterThanOrEqual(b.y); expect(s.y).toBeLessThanOrEqual(b.y + b.height);
  expect(s.alpha).toBeGreaterThanOrEqual(0); expect(s.alpha).toBeLessThanOrEqual(1);
 }
 expect(at(0.5)).not.toEqual(at(0.5).map((_, i) => particleState({...p, seed: 2}, i, 0.5)));
});

it('waves start from the authored pose and move with time', () => {
 const p = {amplitude: 10, waveLength: 100, speed: 1};
 expect(waveAt(p, 25, 0)).toBeCloseTo(10);
 expect(waveAt(p, 25, 0.25)).toBeCloseTo(0);
 expect(waveAt({...p, amplitude: 0}, 25, 3)).toBe(0);
});

it('shape kinds: older shapes stay rounded rectangles; outlines are centred', () => {
 expect(ShapeSchema.parse({width: 10, height: 10, color: '#ffffff', rounded: 2})).toMatchObject({kind: 'rect', strokeWidth: 0, sides: 5});
 expect(shapePoints({kind: 'triangle', width: 100, height: 80, sides: 3, innerRadius: .5})).toEqual([0, -40, 50, 40, -50, 40]);
 const hex = shapePoints({kind: 'polygon', width: 100, height: 100, sides: 6, innerRadius: .5});
 expect(hex).toHaveLength(12); expect(hex.slice(0, 2)).toEqual([0, -50]);
 const star = shapePoints({kind: 'star', width: 100, height: 100, sides: 5, innerRadius: .4});
 expect(star).toHaveLength(20); expect(Math.hypot(star[2], star[3])).toBeCloseTo(20);
 expect(() => ShapeSchema.parse({width: 10, height: 10, color: '#ffffff', rounded: 2, kind: 'blob'})).toThrow();
});
