import {z} from 'zod';
import type {ComponentDefinition} from '@rewrite/sdk';
import type {Entity} from '@rewrite/scene';
import {colliderOutlines, worldTransform} from '@rewrite/physics';

/**
 * 2D lighting. A scene's **Lighting** object darkens the world to its ambient colour; **Light 2D** objects add round
 * pools of coloured light (radius, intensity, flicker). Lights with **Shadows** are cut by a visibility polygon so
 * static colliders (no Rigid Body or a static one) cast hard shadows. Screen-space HUD objects are never darkened.
 */
export const lightingType = 'pixi.lighting';
export const lightType = 'pixi.light';
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const LightingSchema = z.object({enabled: z.boolean(), ambient: Color}).strict();
export const LightSchema = z.object({
 color: Color, radius: z.number().min(1).max(5000), intensity: z.number().min(0).max(1),
 /** 0 steady … 1 strong torch-like flicker. */
 flicker: z.number().min(0).max(1),
 shadows: z.boolean(),
}).strict();
export type Lighting = z.infer<typeof LightingSchema>;
export type Light = z.infer<typeof LightSchema>;
export const lightingDefinition: ComponentDefinition = {
 type: lightingType, version: 1, titleKey: 'component.lighting', uniqueInScene: 'Lighting',
 defaults: () => ({enabled: true, ambient: '#20243a'}), parse: v => LightingSchema.parse(v),
 fields: [{key: 'enabled', titleKey: 'light.enabled', kind: 'boolean'}, {key: 'ambient', titleKey: 'light.ambient', kind: 'color'}],
};
export const lightDefinition: ComponentDefinition = {
 type: lightType, version: 1, titleKey: 'component.light',
 defaults: () => ({color: '#ffd9a0', radius: 220, intensity: 1, flicker: 0, shadows: false}), parse: v => LightSchema.parse(v),
 fields: [{key: 'color', titleKey: 'light.color', kind: 'color'}, ...(['radius', 'intensity', 'flicker'] as const).map(key => ({key, titleKey: `light.${key}`, kind: 'number' as const})), {key: 'shadows', titleKey: 'light.shadows', kind: 'boolean'}],
};

export interface Point {x: number; y: number}
type Segment = [Point, Point];
const isStatic = (byId: ReadonlyMap<string, Entity>, entity: Entity) => {
 for (let e: Entity | undefined = entity, n = 0; e && n < 64; e = e.parentId ? byId.get(e.parentId) : undefined, n++) {
  const body = e.components.find(c => c.type === 'physics.rigidBody2d');
  if (body) return (body.data as {bodyType?: string}).bodyType === 'static';
 }
 return true;
};
/** World outlines of everything that casts shadows: static, non-sensor colliders and solid tilemaps of active objects. */
export function occluders(entities: readonly Entity[]): Point[][] {
 const byId = new Map(entities.map(e => [e.id, e])), active = (e: Entity) => { for (let x: Entity | undefined = e, n = 0; x && n < 64; x = x.parentId ? byId.get(x.parentId) : undefined, n++) if (!x.active) return false; return true; };
 return colliderOutlines(entities.filter(e => active(e) && isStatic(byId, e))).filter(o => !o.sensor && o.points.length >= 3).map(o => {
  const w = worldTransform(byId, o.entityId), a = w.rotation * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  return o.points.map(p => { const x = (p.x - w.pivotX) * w.scaleX, y = (p.y - w.pivotY) * w.scaleY; return {x: w.x + x * cos - y * sin, y: w.y + x * sin + y * cos}; });
 });
}
const inside = (p: Point, poly: readonly Point[]) => { let hit = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit; } return hit; };
/** Distance along a ray (origin + t·dir) to a segment, or Infinity. */
function hit(o: Point, dx: number, dy: number, [a, b]: Segment) {
 const sx = b.x - a.x, sy = b.y - a.y, den = dx * sy - dy * sx;
 if (Math.abs(den) < 1e-12) return Infinity;
 const t = ((a.x - o.x) * sy - (a.y - o.y) * sx) / den, u = ((a.x - o.x) * dy - (a.y - o.y) * dx) / den;
 return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
}
/**
 * The area a light at `light` reaches within `radius`, as a polygon around it: rays towards every occluder corner (and
 * just beside it) stop at the first edge. Occluders that contain the light are ignored (it would be all shadow).
 */
export function visibility(light: Point, radius: number, polygons: readonly Point[][]): Point[] {
 const r = radius * 1.05, segments: Segment[] = [];
 const box = [{x: light.x - r, y: light.y - r}, {x: light.x + r, y: light.y - r}, {x: light.x + r, y: light.y + r}, {x: light.x - r, y: light.y + r}];
 for (let i = 0; i < 4; i++) segments.push([box[i], box[(i + 1) % 4]]);
 const corners: Point[] = [...box];
 for (const poly of polygons) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  if (maxX < light.x - r || minX > light.x + r || maxY < light.y - r || minY > light.y + r || inside(light, poly)) continue;
  for (let i = 0; i < poly.length; i++) { segments.push([poly[i], poly[(i + 1) % poly.length]]); corners.push(poly[i]); }
 }
 if (segments.length === 4) return box;
 const angles: number[] = [];
 for (const c of corners) { const a = Math.atan2(c.y - light.y, c.x - light.x); angles.push(a - 1e-4, a, a + 1e-4); }
 angles.sort((a, b) => a - b);
 const out: Point[] = [];
 for (const a of angles) {
  const dx = Math.cos(a), dy = Math.sin(a); let best = Infinity;
  for (const s of segments) best = Math.min(best, hit(light, dx, dy, s));
  if (Number.isFinite(best)) out.push({x: light.x + dx * best, y: light.y + dy * best});
 }
 return out;
}
/** Light level multiplier at time `seconds` for a flicker amount (smooth noise, never below 1 − flicker). */
export function flickerAt(amount: number, seconds: number, seed: number) {
 if (amount <= 0) return 1;
 const n = Math.sin(seconds * 7.3 + seed) * .5 + Math.sin(seconds * 13.1 + seed * 2.7) * .3 + Math.sin(seconds * 23.7 + seed * .7) * .2;
 return 1 - amount * (n * .5 + .5);
}
export const hexColor = (v: string) => Number.parseInt(v.slice(1), 16);
