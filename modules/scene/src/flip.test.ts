import {expect, it} from 'vitest';
import {TransformSchema, decomposeMatrix, makeEntity, reparentPreservingWorld, transform, type Scene} from './index';

const D = Math.PI / 180;
const matrix = (t: {rotation: number; scaleX: number; scaleY: number; skewX?: number; skewY?: number; x: number; y: number}) => { const r = t.rotation * D, kx = (t.skewX ?? 0) * D, ky = (t.skewY ?? 0) * D; return [Math.cos(r + ky) * t.scaleX, Math.sin(r + ky) * t.scaleX, -Math.sin(r - kx) * t.scaleY, Math.cos(r - kx) * t.scaleY, t.x, t.y] as [number, number, number, number, number, number]; };
const mul = (a: number[], b: number[]) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

it('accepts flipped (negative) scale and skew, refuses zero scale and extreme skew', () => {
 expect(TransformSchema.parse({x: 0, y: 0, rotation: 0, scaleX: -1, scaleY: -2, skewX: 20, skewY: -10})).toMatchObject({scaleX: -1, skewY: -10});
 expect(TransformSchema.safeParse({x: 0, y: 0, rotation: 0, scaleX: 0, scaleY: 1}).success).toBe(false);
 expect(TransformSchema.safeParse({x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 90}).success).toBe(false);
});

it('decomposes any matrix back to the same matrix and keeps a mirrored object mirrored on x', () => {
 for (const t of [{x: 3, y: 4, rotation: 30, scaleX: -2, scaleY: 1}, {x: 0, y: 0, rotation: -70, scaleX: 1.5, scaleY: -.5, skewX: 25, skewY: -15}, {x: 1, y: 2, rotation: 170, scaleX: -1, scaleY: -1, skewX: -40}]) {
  const m = matrix(t), back = matrix(decomposeMatrix(m, t.scaleX < 0));
  back.forEach((v, i) => expect(v).toBeCloseTo(m[i], 9));
 }
 expect(decomposeMatrix(matrix({x: 0, y: 0, rotation: 30, scaleX: -2, scaleY: 1}), true)).toMatchObject({rotation: expect.closeTo(30, 9), scaleX: expect.closeTo(-2, 9), scaleY: expect.closeTo(1, 9)});
});

it('reparents under a flipped, skewed parent without moving the child on screen', () => {
 const parent = makeEntity('Parent'), child = makeEntity('Child');
 parent.components[0].data = {x: 100, y: 50, rotation: 20, scaleX: -1.5, scaleY: 1, skewX: 15};
 child.components[0].data = {x: 300, y: 200, rotation: 10, scaleX: 2, scaleY: 1};
 const scene = {formatVersion: 1, id: 's', name: 'S', entities: [parent, child]} as unknown as Scene;
 const next = reparentPreservingWorld(scene, child.id, parent.id), moved = next.entities.find(e => e.id === child.id)!;
 const world = mul(matrix(transform(parent)), matrix(transform(moved))), before = matrix(transform(child));
 world.forEach((v, i) => expect(v).toBeCloseTo(before[i], 9));
 expect(moved.parentId).toBe(parent.id);
});

it('flips selections on screen around a centre: upright → scaleX −1, rotated keeps its angle mirrored, children of turned parents too, one undo step', async () => {
 const {SceneService, transformDefinition} = await import('./index');
 const service = new SceneService(() => new Map([[transformDefinition.type, transformDefinition]]));
 const a = service.create(), b = service.create(), parent = service.create(), child = service.create();
 const set = (id: string, value: Record<string, number>) => service.setTransform(id, {x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ...value}, transform(service.document.current.entities.find(e => e.id === id)!));
 set(a, {x: 100, y: 50}); set(b, {x: 300, y: 80, rotation: 30, scaleX: 2});
 set(parent, {x: 500, y: 300, rotation: 90}); set(child, {x: 20, y: 0});
 service.reparent(child, parent);
 const doc = () => service.document.current, t = (id: string) => transform(doc().entities.find(e => e.id === id)!);
 service.flip([a, b], 'x', {x: 200, y: 0});
 expect(t(a)).toMatchObject({x: 300, y: 50, rotation: 0, scaleX: -1, scaleY: 1});
 expect(t(b)).toMatchObject({x: 100, y: 80, rotation: -30, scaleX: -2, scaleY: 1});
 service.document.undo();
 expect(t(a)).toMatchObject({x: 100, scaleX: 1}); expect(t(b)).toMatchObject({x: 300, rotation: 30, scaleX: 2});
 service.flip([a], 'y', {x: 0, y: 50});
 expect(t(a)).toMatchObject({x: 100, y: 50, rotation: 0, scaleX: 1, scaleY: -1});
 const before = doc().entities.find(e => e.id === child)!;
 expect(before.parentId).toBe(parent); {
  service.flip([child], 'x', {x: 500, y: 0});
  const p = matrix(t(parent)), world = mul(p, matrix(t(child))), expected = mul([-1, 0, 0, 1, 1000, 0], mul(p, matrix(transform(before))));
  world.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
 }
});
