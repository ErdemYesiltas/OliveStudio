import {expect, it} from 'vitest';
import {makeEntity, pivotKeepingPlace, reparentPreservingWorld, transform, worldPosition, TransformSchema, type Scene} from './index';

const D = Math.PI / 180;
/** Where a local point of the object lands in its parent: x/y place the pivot, rotation/scale/skew turn around it. */
const place = (t: ReturnType<typeof transform>, p: {x: number; y: number}) => { const r = t.rotation * D, kx = (t.skewX ?? 0) * D, ky = (t.skewY ?? 0) * D, a = Math.cos(r + ky) * t.scaleX, b = Math.sin(r + ky) * t.scaleX, c = -Math.sin(r - kx) * t.scaleY, d = Math.cos(r - kx) * t.scaleY, dx = p.x - (t.pivotX ?? 0), dy = p.y - (t.pivotY ?? 0); return {x: t.x + a * dx + c * dy, y: t.y + b * dx + d * dy}; };

it('moves the pivot without moving the object on screen', () => {
 const t = TransformSchema.parse({x: 300, y: 200, rotation: 30, scaleX: 2, scaleY: -1, skewX: 10});
 const moved = pivotKeepingPlace(t, 40, -20);
 expect(moved).toMatchObject({pivotX: 40, pivotY: -20});
 for (const corner of [{x: -50, y: -30}, {x: 50, y: 30}, {x: 40, y: -20}]) { const a = place(t, corner), b = place(moved, corner); expect(b.x).toBeCloseTo(a.x, 5); expect(b.y).toBeCloseTo(a.y, 5); }
 expect(place(moved, {x: 40, y: -20})).toEqual({x: moved.x, y: moved.y});
});

it('places children from the parent origin, reports positions at the pivot and keeps both when reparenting', () => {
 const parent = makeEntity('Parent'), child = makeEntity('Child');
 parent.components[0].data = {x: 400, y: 300, rotation: 90, scaleX: 1, scaleY: 1, pivotX: 50, pivotY: 0};
 child.components[0].data = {x: 50, y: 0, rotation: 0, scaleX: 1, scaleY: 1};
 child.parentId = parent.id;
 const scene = {formatVersion: 1, id: 's', name: 'S', entities: [parent, child]} as unknown as Scene;
 // The child sits at the parent's pivot point, which x/y put at (400, 300).
 const at = worldPosition(scene.entities, child.id)!;
 expect(at.x).toBeCloseTo(400, 6); expect(at.y).toBeCloseTo(300, 6);
 expect(worldPosition(scene.entities, parent.id)).toEqual({x: 400, y: 300});
 const out = reparentPreservingWorld(scene, child.id, null), moved = out.entities.find(e => e.id === child.id)!;
 expect(transform(moved).x).toBeCloseTo(400, 6); expect(transform(moved).y).toBeCloseTo(300, 6); expect(transform(moved).rotation).toBeCloseTo(90, 6);
 const pivoted = {...child, components: [{...child.components[0], data: {x: 50, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 10, pivotY: 5}}]};
 const back = reparentPreservingWorld({...scene, entities: [parent, pivoted]} as Scene, child.id, null).entities.find(e => e.id === child.id)!;
 expect(transform(back)).toMatchObject({pivotX: 10, pivotY: 5});
 expect(transform(back).x).toBeCloseTo(400, 6); expect(transform(back).y).toBeCloseTo(300, 6);
});
