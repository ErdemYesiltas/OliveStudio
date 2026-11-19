import {z} from 'zod';
import {slot} from '@rewrite/sdk';

/**
 * Provider-neutral 2D physics: project world settings, body / collider / joint components, what a provider builds, and
 * the runtime controls rules and scripts use. Units are pixels, seconds and degrees.
 */
export const physicsLayerCount = 16;
export const PhysicsSettingsSchema = z.object({
 gravityX: z.number().min(-10000).max(10000), gravityY: z.number().min(-10000).max(10000),
 /** Simulation speed (1 = real time; 0 freezes bodies, joints and contacts). */
 timeScale: z.number().min(0).max(4).default(1),
 /** Resting bodies sleep (cheaper; they wake when touched or pushed). */
 sleeping: z.boolean().default(false),
 /** Solver passes per step: more is stiffer stacks and joints, slower. */
 positionIterations: z.number().int().min(1).max(30).default(8), velocityIterations: z.number().int().min(1).max(30).default(6),
 /** Static walls around the stage (left, right, top, bottom) so nothing leaves the screen. */
 walls: z.boolean().default(false),
 /** Names of the collision layers (index = layer); bodies pick a layer and the layers they collide with. */
 layers: z.array(z.string().trim().min(1).max(30)).min(1).max(physicsLayerCount).default(['Default']),
 /** Collision matrix: per layer, the layers it may collide with (bit mask; a missing row collides with all). Two layers collide only when both rows allow it; a body's own mask narrows it further. */
 collisions: z.array(z.number().int().min(0).max(2 ** physicsLayerCount - 1)).max(physicsLayerCount).optional(),
}).strict();
export type PhysicsSettings = z.infer<typeof PhysicsSettingsSchema>;
export const defaultPhysicsSettings: PhysicsSettings = {gravityX: 0, gravityY: 980, timeScale: 1, sleeping: false, positionIterations: 8, velocityIterations: 6, walls: false, layers: ['Default']};
export const physicsSection = 'physics.world';

/** Static never moves; dynamic is simulated; kinematic follows its transform (tweens, animations, scripts) and pushes dynamic bodies. */
export const bodyTypes = ['static', 'dynamic', 'kinematic'] as const;
export const RigidBodySchema = z.object({
 bodyType: z.enum(bodyTypes), density: z.number().min(.000001).max(1), friction: z.number().min(0).max(1), restitution: z.number().min(0).max(1),
 airFriction: z.number().min(0).max(1), lockRotation: z.boolean(),
 velocityX: z.number().min(-10000).max(10000), velocityY: z.number().min(-10000).max(10000), angularVelocity: z.number().min(-3600).max(3600),
 /** Friction before sliding starts (Matter's static friction). */
 frictionStatic: z.number().min(0).max(10).default(.5),
 /** Gravity multiplier for this body (0 floats, 2 falls twice as fast, −1 rises). */
 gravityScale: z.number().min(-10).max(10).default(1),
 /** Mass in kg-like units (0 = from density × area). */
 mass: z.number().min(0).max(100000).default(0),
 /** Collision layer (index into the project's layers) and the layers it collides with (bit mask). */
 layer: z.number().int().min(0).max(physicsLayerCount - 1).default(0), mask: z.number().int().min(0).max(2 ** physicsLayerCount - 1).default(2 ** physicsLayerCount - 1),
 /** Same positive group: always collide; same negative group: never collide (e.g. parts of one ragdoll); 0 = layers decide. */
 group: z.number().int().min(-1000).max(1000).default(0),
 /** Players can drag it with the pointer while the game runs. */
 draggable: z.boolean().default(false),
 /** Fast small bodies: smaller sub-steps against tunnelling through thin walls. */
 bullet: z.boolean().default(false),
}).strict();
export type RigidBodyData = z.infer<typeof RigidBodySchema>;
export const defaultRigidBody: RigidBodyData = {bodyType: 'dynamic', density: .001, friction: .1, restitution: 0, airFriction: .01, lockRotation: false, velocityX: 0, velocityY: 0, angularVelocity: 0, frictionStatic: .5, gravityScale: 1, mass: 0, layer: 0, mask: 2 ** physicsLayerCount - 1, group: 0, draggable: false, bullet: false};

const offset = {offsetX: z.number().min(-10000).max(10000), offsetY: z.number().min(-10000).max(10000), sensor: z.boolean()};
export const BoxColliderSchema = z.object({width: z.number().positive().max(10000), height: z.number().positive().max(10000), ...offset,
 /** Rounded corners (px). */
 chamfer: z.number().min(0).max(5000).default(0)}).strict();
export const CircleColliderSchema = z.object({radius: z.number().positive().max(5000), ...offset}).strict();
/** A pill: a box whose short sides are half circles (characters slide over steps). */
export const CapsuleColliderSchema = z.object({width: z.number().positive().max(10000), height: z.number().positive().max(10000), ...offset}).strict();
/** A polygon from points `x,y x,y …` around the object's origin; concave outlines are split into convex parts (one compound body). */
export const PolygonColliderSchema = z.object({points: z.string().max(2000), ...offset}).strict();
export const colliderTypes = ['physics.boxCollider2d', 'physics.circleCollider2d', 'physics.capsuleCollider2d', 'physics.polygonCollider2d'] as const;
/** `points` text → vertices; throws for fewer than 3 or bad numbers. */
export function parsePoints(text: string) {
 const points = text.trim().split(/[\s;]+/).filter(Boolean).map(pair => { const [x, y] = pair.split(',').map(Number); if (!Number.isFinite(x) || !Number.isFinite(y)) throw Error(`Bad polygon point "${pair}" (use x,y x,y …)`); return {x, y}; });
 if (points.length < 3 || points.length > 64) throw Error('A polygon collider needs 3–64 points');
 return points;
}

/** All layers. */
const ALL = 2 ** physicsLayerCount - 1;
/** A layer's row of the collision matrix (which layers it may collide with). */
export const matrixRow = (settings: Pick<PhysicsSettings, 'collisions'>, layer: number) => settings.collisions?.[layer] ?? ALL;
/** Whether two layers collide by the matrix (both rows must allow it). */
export const layersCollide = (settings: Pick<PhysicsSettings, 'collisions'>, a: number, b: number) => Boolean(matrixRow(settings, a) & 2 ** b) && Boolean(matrixRow(settings, b) & 2 ** a);
/** The matrix with one pair switched on or off (kept symmetric); rows for layers 0…count-1. */
export function setLayerPair(settings: Pick<PhysicsSettings, 'collisions'>, count: number, a: number, b: number, on: boolean): number[] {
 const rows = Array.from({length: count}, (_, i) => matrixRow(settings, i));
 for (const [x, y] of [[a, b], [b, a]]) rows[x] = on ? rows[x] | 2 ** y : rows[x] & ~(2 ** y) & ALL;
 return rows;
}
/** A body's collision filter mask after the project's matrix. */
export const filterMask = (settings: Pick<PhysicsSettings, 'collisions'>, layer: number, mask: number) => mask & matrixRow(settings, layer);

type Point = {x: number; y: number};
const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const signedArea = (p: readonly Point[]) => p.reduce((s, v, i) => { const w = p[(i + 1) % p.length]; return s + v.x * w.y - w.x * v.y; }, 0) / 2;
/** The convex hull (monotone chain), counter-clockwise in y-up terms. */
export function convexHull(points: readonly Point[]): Point[] {
 const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y), lower: Point[] = [], upper: Point[] = [];
 for (const v of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], v) <= 0) lower.pop(); lower.push(v); }
 for (const v of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], v) <= 0) upper.pop(); upper.push(v); }
 return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
const convex = (p: readonly Point[]) => p.every((v, i) => cross(p[(i + p.length - 1) % p.length], v, p[(i + 1) % p.length]) >= -1e-9);
const segmentsCross = (a: Point, b: Point, c: Point, d: Point) => { const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d); return (d1 > 0 && d2 < 0 || d1 < 0 && d2 > 0) && (d3 > 0 && d4 < 0 || d3 < 0 && d4 > 0); };
const selfIntersecting = (p: readonly Point[]) => { for (let i = 0; i < p.length; i++) for (let j = i + 2; j < p.length; j++) { if (i === 0 && j === p.length - 1) continue; if (segmentsCross(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])) return true; } return false; };
const inTriangle = (p: Point, a: Point, b: Point, c: Point) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
/**
 * Convex parts of a polygon outline: the outline itself when convex, otherwise ear-clipped triangles merged back into
 * convex polygons (Hertel–Mehlhorn), so a concave collider keeps its real shape. Self-crossing outlines fall back to
 * their convex hull. Every part is counter-clockwise (positive area).
 */
export function convexParts(points: readonly Point[]): Point[][] {
 let p = points.filter((v, i) => { const w = points[(i + 1) % points.length]; return Math.abs(v.x - w.x) > 1e-9 || Math.abs(v.y - w.y) > 1e-9; });
 if (p.length < 3) return [points.map(v => ({...v}))];
 if (signedArea(p) < 0) p = [...p].reverse();
 for (let changed = true; changed && p.length > 3;) { changed = false; for (let i = 0; i < p.length; i++) if (Math.abs(cross(p[(i + p.length - 1) % p.length], p[i], p[(i + 1) % p.length])) < 1e-9) { p = p.filter((_, j) => j !== i); changed = true; break; } }
 if (selfIntersecting(p)) return [convexHull(p)];
 if (Math.abs(signedArea(p)) < 1e-9) return [p];
 if (convex(p)) return [p];
 // Ear clipping into triangles (indices into p).
 const left = p.map((_, i) => i), triangles: number[][] = [];
 for (let guard = 0; left.length > 3 && guard < 10000; guard++) {
  let clipped = false;
  for (let k = 0; k < left.length; k++) {
   const ia = left[(k + left.length - 1) % left.length], ib = left[k], ic = left[(k + 1) % left.length], a = p[ia], b = p[ib], c = p[ic];
   if (cross(a, b, c) <= 1e-12) continue;
   if (left.some(i => i !== ia && i !== ib && i !== ic && inTriangle(p[i], a, b, c))) continue;
   triangles.push([ia, ib, ic]); left.splice(k, 1); clipped = true; break;
  }
  if (!clipped) return [convexHull(p)];
 }
 triangles.push([...left]);
 // Hertel–Mehlhorn: merge neighbours across a shared edge while the result stays convex.
 const polys = triangles.map(t => [...t]);
 for (let merged = true; merged;) {
  merged = false;
  outer: for (let x = 0; x < polys.length; x++) for (let y = x + 1; y < polys.length; y++) {
   const A = polys[x], B = polys[y];
   for (let i = 0; i < A.length; i++) {
    const u = A[i], v = A[(i + 1) % A.length], j = B.indexOf(v);
    if (j < 0 || B[(j + 1) % B.length] !== u) continue;
    const joined = [...Array.from({length: A.length}, (_, k) => A[(i + 1 + k) % A.length]), ...Array.from({length: B.length - 2}, (_, k) => B[(j + 2 + k) % B.length])];
    if (!convex(joined.map(n => p[n]))) continue;
    polys[x] = joined; polys.splice(y, 1); merged = true; break outer;
   }
  }
 }
 return polys.map(poly => poly.map(n => ({...p[n]})));
}

/** Distance keeps the length (stiff), spring pulls toward it, pin joins the anchors (a hinge), rope only stops stretching past its length. */
export const jointKinds = ['distance', 'spring', 'pin', 'rope'] as const;
export const JointSchema = z.object({
 kind: z.enum(jointKinds),
 /** The other body's entity ID, or '' for a fixed point in the world (`targetAnchor` then is a world position). */
 target: z.string().max(100),
 anchorX: z.number().min(-10000).max(10000), anchorY: z.number().min(-10000).max(10000),
 targetAnchorX: z.number().min(-1e6).max(1e6), targetAnchorY: z.number().min(-1e6).max(1e6),
 /** Rest length in px (0 = the distance when the scene starts). */
 length: z.number().min(0).max(100000),
 stiffness: z.number().min(0).max(1), damping: z.number().min(0).max(1),
 /** Whether the two joined bodies still collide with each other. */
 collideConnected: z.boolean(),
}).strict();
export type JointData = z.infer<typeof JointSchema>;
export const defaultJoint: JointData = {kind: 'distance', target: '', anchorX: 0, anchorY: 0, targetAnchorX: 0, targetAnchorY: 0, length: 0, stiffness: 1, damping: 0, collideConnected: true};

/** One part of a body's shape in the body's local space (pixels, degrees). */
export type ShapePart = ({kind: 'box'; width: number; height: number; chamfer: number} | {kind: 'circle'; radius: number} | {kind: 'polygon'; points: {x: number; y: number}[]}) & {x: number; y: number; angle: number; sensor: boolean};
export interface PhysicsBodySpec {
 entityId: string; colliderId: string; settings: RigidBodyData; parts: ShapePart[]; x: number; y: number; rotation: number;
 /** Collision filter (Matter: category bit, mask, group). */
 filter: {category: number; mask: number; group: number};
}
export interface JointSpec {id: string; kind: JointData['kind']; a: string; b: string | null; anchorA: {x: number; y: number}; anchorB: {x: number; y: number}; length: number; stiffness: number; damping: number; collideConnected: boolean}
export interface PhysicsPose {entityId: string; x: number; y: number; rotation: number; velocityX: number; velocityY: number; angularVelocity: number; sleeping?: boolean}
/** A contact: the bodies, whether a sensor took part, and (on enter) where and how hard. */
export interface ContactEvent {phase: 'enter' | 'exit'; a: string; b: string; sensor: boolean; contact?: {x: number; y: number; normalX: number; normalY: number; depth: number; speed: number}}
export interface RayHit {entityId: string; x: number; y: number; normalX: number; normalY: number; distance: number}
export interface PhysicsWorld {
 add(spec: PhysicsBodySpec): void; remove(entityId: string): void; step(seconds: number): void; poses(): readonly PhysicsPose[]; dispose(): void;
 addJoint?(spec: JointSpec): void; removeJoint?(id: string): void;
 /** Runtime control (velocities in px/s, angles in degrees). */
 setVelocity?(id: string, x: number, y: number): void; setAngularVelocity?(id: string, degreesPerSecond: number): void;
 applyForce?(id: string, x: number, y: number): void; applyImpulse?(id: string, x: number, y: number): void;
 /** Teleport (dynamic) or move with velocity over `seconds` (kinematic, so it pushes what it touches). */
 setPose?(id: string, x: number, y: number, rotation: number, seconds?: number): void;
 body?(id: string): {mass: number; velocityX: number; velocityY: number; angularVelocity: number; sleeping: boolean} | undefined;
 setGravity?(x: number, y: number): void; setTimeScale?(scale: number): void;
 raycast?(from: {x: number; y: number}, to: {x: number; y: number}): RayHit[];
 point?(x: number, y: number): string[]; region?(minX: number, minY: number, maxX: number, maxY: number): string[];
 /** Pointer dragging (a stiff spring to the pointer). */
 drag?(id: string | null, point?: {x: number; y: number}): void;
}
export interface PhysicsProvider {id: string; create(settings: PhysicsSettings, contact: (event: ContactEvent) => void, options?: {bounds?: {width: number; height: number}}): PhysicsWorld}
export const physicsProviders = slot<PhysicsProvider>('physics.providers');
export interface PhysicsEvent extends ContactEvent {colliderA: string; colliderB: string; time: number; silent: boolean}
/** What rules and scripts can do to a running physics world (object IDs; px, px/s, degrees). */
export interface PhysicsControls {
 setVelocity(id: string, x: number, y: number): void; setAngularVelocity(id: string, degreesPerSecond: number): void;
 applyForce(id: string, x: number, y: number): void; applyImpulse(id: string, x: number, y: number): void;
 teleport(id: string, x: number, y: number): void;
 body(id: string): {mass: number; velocityX: number; velocityY: number; angularVelocity: number; sleeping: boolean} | undefined;
 gravity(): {x: number; y: number}; setGravity(x: number, y: number): void;
 raycast(x1: number, y1: number, x2: number, y2: number): RayHit[];
 objectsAt(x: number, y: number): string[]; objectsIn(x: number, y: number, width: number, height: number): string[];
}
