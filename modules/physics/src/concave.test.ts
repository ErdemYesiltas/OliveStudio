import {expect, it} from 'vitest';
import {convexParts, convexHull, filterMask, layersCollide, matrixRow, setLayerPair} from './contracts';

const area = (p: {x: number; y: number}[]) => p.reduce((s, v, i) => { const w = p[(i + 1) % p.length]; return s + v.x * w.y - w.x * v.y; }, 0) / 2;
const isConvex = (p: {x: number; y: number}[]) => p.every((v, i) => { const a = p[(i + p.length - 1) % p.length], b = p[(i + 1) % p.length]; return (v.x - a.x) * (b.y - a.y) - (v.y - a.y) * (b.x - a.x) >= -1e-9; });
const total = (parts: {x: number; y: number}[][]) => parts.reduce((s, p) => s + area(p), 0);

it('keeps convex outlines whole and splits concave ones into convex parts of the same area', () => {
 const square = [{x: 0, y: 0}, {x: 10, y: 0}, {x: 10, y: 10}, {x: 0, y: 10}];
 expect(convexParts(square)).toHaveLength(1);
 const ell = [{x: 0, y: 0}, {x: 60, y: 0}, {x: 60, y: 20}, {x: 20, y: 20}, {x: 20, y: 60}, {x: 0, y: 60}];
 const parts = convexParts(ell);
 expect(parts.length).toBe(2);
 expect(parts.every(isConvex)).toBe(true);
 expect(total(parts)).toBeCloseTo(Math.abs(area(ell)), 6);
 const cup = [{x: -50, y: -50}, {x: -30, y: -50}, {x: -30, y: 30}, {x: 30, y: 30}, {x: 30, y: -50}, {x: 50, y: -50}, {x: 50, y: 50}, {x: -50, y: 50}];
 const cupParts = convexParts(cup);
 expect(cupParts.length).toBeGreaterThanOrEqual(3);
 expect(cupParts.every(p => isConvex(p) && area(p) > 0)).toBe(true);
 expect(total(cupParts)).toBeCloseTo(Math.abs(area(cup)), 6);
 // Clockwise input, collinear points and a flip keep working.
 expect(total(convexParts([...ell].reverse().map(v => ({x: -v.x, y: v.y}))))).toBeCloseTo(Math.abs(area(ell)), 6);
 const straight = convexParts([{x: 0, y: 0}, {x: 5, y: 0}, {x: 10, y: 0}, {x: 10, y: 10}, {x: 0, y: 10}]);
 expect([straight.length, straight[0].length, Math.abs(area(straight[0]))]).toEqual([1, 4, 100]);
 // A self-crossing bow tie falls back to its hull.
 const bow = [{x: 0, y: 0}, {x: 10, y: 10}, {x: 10, y: 0}, {x: 0, y: 10}];
 expect(convexParts(bow)).toEqual([convexHull(bow)]);
});

it('collision matrix: symmetric pairs, missing rows collide with all, body masks narrow it', () => {
 const none = {};
 expect(layersCollide(none, 0, 3)).toBe(true);
 const rows = setLayerPair(none, 3, 1, 2, false);
 expect(rows).toEqual([65535, 65535 & ~4, 65535 & ~2]);
 const settings = {collisions: rows};
 expect([layersCollide(settings, 1, 2), layersCollide(settings, 2, 1), layersCollide(settings, 1, 1), layersCollide(settings, 0, 2)]).toEqual([false, false, true, true]);
 expect(layersCollide({collisions: [65535, 65535 & ~1]}, 0, 1)).toBe(false);
 expect(filterMask(settings, 1, 0b111)).toBe(0b011);
 expect(matrixRow(settings, 9)).toBe(65535);
 expect(setLayerPair(settings, 3, 1, 2, true)).toEqual([65535, 65535, 65535]);
});
