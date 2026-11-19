import {Container, Graphics, Mesh, MeshPlane, NineSliceSprite, Particle, ParticleContainer, Point, Rectangle, RopeGeometry, Texture, TilingSprite} from 'pixi.js';
import {z} from 'zod';
import type {ComponentDefinition, Json} from '@rewrite/sdk';
import type {VisualAdapter, VisualContext, VisualFrame} from './visuals';
import {acquireTexture, releaseTexture} from './textures';

/**
 * Texture-backed Pixi objects beyond Sprite: tiling, nine-slice, plane mesh, rope and particles. Motion (scroll,
 * waves, particles) is a pure function of runtime time, so Pause, Step and scene restarts match the editor Preview
 * and the exported player exactly; editing shows time 0.
 */
const Asset = z.uuid().or(z.literal(''));
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Size = z.number().positive().max(10000);
const Unit = z.number().min(0).max(1);
const common = {assetId: Asset, alpha: Unit, tint: Color};
const anchored = {width: Size, height: Size, anchorX: Unit, anchorY: Unit};

export const TilingSpriteSchema = z.object({...common, ...anchored, tileScale: z.number().min(0.01).max(100), scrollX: z.number().min(-10000).max(10000), scrollY: z.number().min(-10000).max(10000)}).strict();
export const NineSliceSchema = z.object({...common, ...anchored, left: z.number().min(0).max(4096), top: z.number().min(0).max(4096), right: z.number().min(0).max(4096), bottom: z.number().min(0).max(4096)}).strict();
const wave = {amplitude: z.number().min(0).max(2000), waveLength: z.number().min(1).max(10000), speed: z.number().min(-100).max(100)};
export const MeshPlaneSchema = z.object({...common, width: Size, height: Size, columns: z.number().int().min(2).max(64), rows: z.number().int().min(2).max(64), ...wave}).strict();
export const RopeSchema = z.object({...common, length: Size, thickness: z.number().min(1).max(2000), points: z.number().int().min(2).max(256), ...wave}).strict();
export const ParticlesSchema = z.object({
 ...common, count: z.number().int().min(1).max(5000), lifetime: z.number().min(0.05).max(60), speed: z.number().min(0).max(10000),
 direction: z.number().min(-360).max(360), spread: z.number().min(0).max(360), gravity: z.number().min(-10000).max(10000),
 size: z.number().min(1).max(2000), endScale: z.number().min(0).max(10), endAlpha: Unit, seed: z.number().int().min(0).max(2 ** 31 - 1),
 /** `continuous` emits forever (pre-warmed at time 0 with autoplay); `burst` emits every particle once. */
 emission: z.enum(['continuous', 'burst']).default('continuous'), autoplay: z.boolean().default(true),
 /** Runtime only (play/burst and stop actions). Never authored. */
 startedAt: z.number().nullable().optional(), stoppedAt: z.number().nullable().optional(),
}).strict();
export type ParticlesData = z.infer<typeof ParticlesSchema>;

type Field = ComponentDefinition['fields'][number];
const n = (...keys: string[]): Field[] => keys.map(key => ({key, titleKey: `field.${key}`, kind: 'number' as const}));
const texture: Field = {key: 'assetId', titleKey: 'field.assetId', kind: 'asset', assetType: 'pixi.texture'};
const look: Field[] = [...n('alpha'), {key: 'tint', titleKey: 'field.tint', kind: 'color'}];
const def = (type: string, titleKey: string, schema: z.ZodType, defaults: Record<string, Json>, fields: Field[]): ComponentDefinition =>
 ({type, version: 1, titleKey, exclusiveGroup: 'render.visual', defaults: () => ({...defaults}), parse: v => schema.parse(v) as Json, fields});
const base = {assetId: '', alpha: 1, tint: '#ffffff'};
export const tilingSpriteDefinition = def('pixi.tilingSprite', 'component.tilingSprite', TilingSpriteSchema, {...base, width: 300, height: 200, anchorX: .5, anchorY: .5, tileScale: 1, scrollX: 0, scrollY: 0}, [texture, ...n('width', 'height', 'anchorX', 'anchorY', 'tileScale', 'scrollX', 'scrollY'), ...look]);
export const nineSliceDefinition = def('pixi.nineSlice', 'component.nineSlice', NineSliceSchema, {...base, width: 240, height: 120, anchorX: .5, anchorY: .5, left: 16, top: 16, right: 16, bottom: 16}, [texture, ...n('width', 'height', 'anchorX', 'anchorY', 'left', 'top', 'right', 'bottom'), ...look]);
export const meshPlaneDefinition = def('pixi.mesh', 'component.mesh', MeshPlaneSchema, {...base, width: 300, height: 200, columns: 12, rows: 8, amplitude: 12, waveLength: 200, speed: 0.5}, [texture, ...n('width', 'height', 'columns', 'rows', 'amplitude', 'waveLength', 'speed'), ...look]);
export const ropeDefinition = def('pixi.rope', 'component.rope', RopeSchema, {...base, length: 400, thickness: 40, points: 24, amplitude: 30, waveLength: 240, speed: 0.5}, [texture, ...n('length', 'thickness', 'points', 'amplitude', 'waveLength', 'speed'), ...look]);
export const particlesDefinition = def('pixi.particles', 'component.particles', ParticlesSchema, {...base, tint: '#ffd27a', count: 120, lifetime: 2, speed: 160, direction: -90, spread: 60, gravity: 120, size: 12, endScale: 0.2, endAlpha: 0, seed: 1, emission: 'continuous', autoplay: true}, [texture, {key: 'emission', titleKey: 'field.emission', kind: 'enum', options: [{value: 'continuous', titleKey: 'emission.continuous'}, {value: 'burst', titleKey: 'emission.burst'}]}, {key: 'autoplay', titleKey: 'field.autoplay', kind: 'boolean'}, ...n('count', 'lifetime', 'speed', 'direction', 'spread', 'gravity', 'size', 'endScale', 'endAlpha', 'seed'), ...look]);
export const objectDefinitions = [tilingSpriteDefinition, nineSliceDefinition, meshPlaneDefinition, ropeDefinition, particlesDefinition];

/** Vertical wave offset at `x` (scene units) for a runtime time. */
export const waveAt = (p: {amplitude: number; waveLength: number; speed: number}, x: number, time: number) =>
 p.amplitude ? p.amplitude * Math.sin(2 * Math.PI * (x / p.waveLength - p.speed * Math.max(0, time))) : 0;

/** Deterministic 0…1 hash so particle paths depend only on (seed, particle, cycle). */
function random(seed: number, a: number, b: number, salt: number) {
 let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(a + 1, 0xc2b2ae35) ^ Math.imul(b + 7, 0x27d4eb2f) ^ Math.imul(salt + 13, 0x165667b1);
 h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
 return (h >>> 0) / 4294967296;
}
/**
 * Emitter state of particle `i` at a time. Continuous: particle `i` is reborn every `lifetime` with phase `i/count`;
 * with autoplay and no start it is pre-warmed (steady state at time 0, what the editor shows). Burst: every particle
 * is born at the start and lives once. After `stoppedAt` nothing new is born; living particles finish. Pure in
 * (data, i, time), so Pause/Step and the exported player match.
 */
export function particleState(p: ParticlesData, i: number, time: number) {
 const L = p.lifetime, t = Math.max(0, time), hidden = {x: 0, y: 0, scale: 0, alpha: 0, alive: false};
 let age: number, cycle: number;
 if (p.emission === 'burst') {
  const start = p.startedAt ?? (p.autoplay ? 0 : null);
  if (start == null) return hidden;
  age = t - start; cycle = Math.round(start * 1000);
  if (age < 0 || age >= L) return hidden;
 } else if (p.startedAt == null) {
  if (!p.autoplay) return hidden;
  const shifted = t + L * (1 - i / p.count); cycle = Math.floor(shifted / L); age = shifted - cycle * L;
 } else {
  const a = t - p.startedAt - L * i / p.count;
  if (a < 0) return hidden;
  cycle = Math.floor(a / L); age = a - cycle * L;
 }
 if (p.stoppedAt != null && t - age > p.stoppedAt) return hidden;
 const angle = (p.direction + (random(p.seed, i, cycle, 1) - 0.5) * p.spread) * Math.PI / 180, speed = p.speed * (0.5 + random(p.seed, i, cycle, 2) * 0.5), k = age / L;
 return {x: Math.cos(angle) * speed * age, y: Math.sin(angle) * speed * age + 0.5 * p.gravity * age * age, scale: 1 + (p.endScale - 1) * k, alpha: 1 + (p.endAlpha - 1) * k, alive: true};
}
/** Conservative emitter bounds for selection and hit testing. */
export function particleBounds(p: ParticlesData) {
 const reach = p.speed * p.lifetime, fall = 0.5 * p.gravity * p.lifetime * p.lifetime, half = p.size * Math.max(1, p.endScale) / 2;
 const minY = Math.min(-reach, -reach + fall, 0) - half, maxY = Math.max(reach, reach + fall, 0) + half;
 return new Rectangle(-reach - half, minY, 2 * (reach + half), maxY - minY);
}

type Build = {view: Container; update(data: never, frame: VisualFrame): void; dispose(): void};
/** Shared shell: texture lease, placeholder until ready, rebuild hook and diagnostics. */
function textured(type: string, schema: z.ZodType, key: (p: never) => unknown, size: (p: never) => {x: number; y: number; width: number; height: number}, build: (p: never, texture: Texture, context: VisualContext) => Build, url: (assetId: string) => string | undefined, optional = false): VisualAdapter {
 return {
  type, version: 1,
  key: data => key(schema.parse(data) as never),
  create(data, context) {
   let p = schema.parse(data) as {assetId: string; alpha: number; tint: string}, dead = false, error: string | null = null, built: Build | undefined;
   const view = new Container(), placeholder = new Graphics(), src = p.assetId ? url(p.assetId) : undefined;
   view.addChild(placeholder);
   const drawPlaceholder = () => { placeholder.clear(); if (built) return; const b = size(p as never); placeholder.rect(b.x, b.y, b.width, b.height).fill('#4d3747').stroke({color: '#d29bbd', width: 1}); };
   const ready = (texture: Texture) => { if (dead) return; built = build(p as never, texture, context); view.addChild(built.view); drawPlaceholder(); built.update(p as never, context.frame()); context.changed(); };
   if (src) void acquireTexture(src).then(({texture}) => ready(texture), e => { if (!dead) { error = String(e); context.changed(); } });
   else if (optional) ready(Texture.WHITE);
   else error = p.assetId ? 'Missing image' : null;
   drawPlaceholder();
   return {
    view,
    update(next, frame) { p = schema.parse(next) as typeof p; if (built) built.update(p as never, frame); else drawPlaceholder(); },
    diagnostics: () => ({ready: Boolean(built), error}),
    dispose() { if (dead) return; dead = true; view.destroy({children: true, context: true}); built?.dispose(); if (src) releaseTexture(src); },
   };
  },
 };
}
type Tiling = z.infer<typeof TilingSpriteSchema>; type Nine = z.infer<typeof NineSliceSchema>; type Plane = z.infer<typeof MeshPlaneSchema>; type Rope = z.infer<typeof RopeSchema>;
const box = (p: {width: number; height: number; anchorX: number; anchorY: number}) => ({x: -p.anchorX * p.width, y: -p.anchorY * p.height, width: p.width, height: p.height});

/** Every object adapter, for the editor (`studio`) and the exported player (`objects` runtime chunk). */
export function createObjectAdapters(url: (assetId: string) => string | undefined): VisualAdapter[] {
 const tiling = textured('pixi.tilingSprite', TilingSpriteSchema, (p: Tiling) => p.assetId, box, (_: Tiling, texture) => {
  const sprite = new TilingSprite({texture});
  return {view: sprite, dispose() {}, update(p: Tiling, frame) {
   sprite.anchor.set(p.anchorX, p.anchorY); sprite.width = p.width; sprite.height = p.height; sprite.tileScale.set(p.tileScale); sprite.alpha = p.alpha; sprite.tint = p.tint;
   const time = Math.max(0, frame.time); sprite.tilePosition.set(p.scrollX * time, p.scrollY * time);
  }} satisfies Build;
 }, url);
 const nine = textured('pixi.nineSlice', NineSliceSchema, (p: Nine) => p.assetId, box, (_: Nine, texture) => {
  const sprite = new NineSliceSprite({texture});
  return {view: sprite, dispose() {}, update(p: Nine) {
   sprite.leftWidth = p.left; sprite.topHeight = p.top; sprite.rightWidth = p.right; sprite.bottomHeight = p.bottom;
   sprite.width = p.width; sprite.height = p.height; sprite.position.set(-p.anchorX * p.width, -p.anchorY * p.height); sprite.alpha = p.alpha; sprite.tint = p.tint;
  }} satisfies Build;
 }, url);
 const plane = textured('pixi.mesh', MeshPlaneSchema, (p: Plane) => [p.assetId, p.columns, p.rows], (p: Plane) => ({x: -p.width / 2, y: -p.height / 2, width: p.width, height: p.height}), (first: Plane, texture) => {
  const mesh = new MeshPlane({texture, verticesX: first.columns, verticesY: first.rows}), plane = mesh.geometry, rest = Float32Array.from(plane.positions);
  return {view: mesh, dispose() { plane.destroy(); }, update(p: Plane, frame) {
   const sx = p.width / texture.width, sy = p.height / texture.height, positions = plane.positions;
   mesh.scale.set(sx, sy); mesh.position.set(-p.width / 2, -p.height / 2); mesh.alpha = p.alpha; mesh.tint = p.tint;
   for (let i = 0; i < positions.length; i += 2) positions[i + 1] = rest[i + 1] + waveAt(p, rest[i] * sx, frame.time) / sy;
   plane.getBuffer('aPosition').update();
  }} satisfies Build;
 }, url);
 const rope = textured('pixi.rope', RopeSchema, (p: Rope) => [p.assetId, p.points, p.thickness], (p: Rope) => ({x: -p.length / 2, y: -p.thickness / 2 - p.amplitude, width: p.length, height: p.thickness + 2 * p.amplitude}), (first: Rope, texture) => {
  const points = Array.from({length: first.points}, () => new Point()), geometry = new RopeGeometry({width: first.thickness, points, textureScale: 0}), mesh = new Mesh({geometry, texture});
  return {view: mesh, dispose() { geometry.destroy(); }, update(p: Rope, frame) {
   points.forEach((point, i) => { const x = -p.length / 2 + p.length * i / (points.length - 1); point.set(x, waveAt(p, x + p.length / 2, frame.time)); });
   geometry.updateVertices(); mesh.alpha = p.alpha; mesh.tint = p.tint;
  }} satisfies Build;
 }, url);
 const particles = textured('pixi.particles', ParticlesSchema, (p: ParticlesData) => [p.assetId, p.count], particleBounds, (first: ParticlesData, texture) => {
  const view = new Container(), hit = new Graphics(), container = new ParticleContainer({dynamicProperties: {vertex: true, position: true, color: true, rotation: false, uvs: false}});
  const items = Array.from({length: first.count}, () => new Particle({texture, anchorX: .5, anchorY: .5}));
  container.addParticle(...items); view.addChild(hit, container);
  return {view, dispose() {}, update(p: ParticlesData, frame) {
   const bounds = particleBounds(p), scale = p.size / Math.max(texture.width, texture.height);
   container.boundsArea = bounds; hit.clear().rect(bounds.x, bounds.y, bounds.width, bounds.height).fill({color: 0, alpha: 0});
   items.forEach((item, i) => { const s = particleState(p, i, frame.time); item.x = s.x; item.y = s.y; item.scaleX = item.scaleY = scale * s.scale; item.tint = p.tint; item.alpha = s.alive ? p.alpha * s.alpha : 0; });
  }} satisfies Build;
 }, url, true);
 return [tiling, nine, plane, rope, particles];
}
