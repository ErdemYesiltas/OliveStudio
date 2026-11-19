import {z} from 'zod';
import type {ComponentDefinition, Json, RuntimeSystem} from '@rewrite/sdk';
import {transform, type Entity} from '@rewrite/scene';
import {colliderOutlines, worldTransform} from '@rewrite/physics';
import {isActive, type ActionDefinition, type InteractionCatalog, type InteractionEvent, type TriggerDefinition} from '@rewrite/interactions';

/**
 * Grid pathfinding. A **Nav Grid** object covers a rectangle of the world (centred on the object) in
 * square cells; static colliders and solid tilemaps block the cells they touch, inflated by `clearance` so agents keep
 * their distance. A **Nav Agent** walks its object along paths (8 directions, no corner cutting, smoothed by line of
 * sight): towards a point (`moveTo`), or after another object (`follow`, re-planned as it moves). Reaching the end fires
 * `navigation.arrived`. Objects with a dynamic body are driven by velocity, others by position.
 */
export const navGridType = 'navigation.grid';
export const navAgentType = 'navigation.agent';
export const NavGridSchema = z.object({
 cellSize: z.number().int().min(4).max(256), width: z.number().min(16).max(20000), height: z.number().min(16).max(20000),
 clearance: z.number().min(0).max(256), diagonal: z.boolean(),
 /** Draw the cells (blocked ones tinted) in the editor and Preview. */
 show: z.boolean(),
}).strict();
export type NavGrid = z.infer<typeof NavGridSchema>;
export const NavAgentSchema = z.object({
 speed: z.number().min(0).max(5000), arriveDistance: z.number().min(0).max(500),
 /** Object to chase (empty: only scripts and rules move it). */
 follow: z.string().max(64),
 /** Seconds between new paths while following. */
 repath: z.number().min(.05).max(10),
 /** Turn to face the walking direction. */
 face: z.boolean(),
}).strict();
export type NavAgent = z.infer<typeof NavAgentSchema>;
const remapFollow = (v: Json, ids: {entities: ReadonlyMap<string, string>}) => { const a = NavAgentSchema.parse(v); return {...a, follow: a.follow ? ids.entities.get(a.follow) ?? a.follow : ''}; };
export const navGridDefinition: ComponentDefinition = {
 type: navGridType, version: 1, titleKey: 'component.navGrid', uniqueInScene: 'Nav Grid',
 defaults: () => ({cellSize: 24, width: 960, height: 540, clearance: 12, diagonal: true, show: true}), parse: v => NavGridSchema.parse(v),
 fields: [...(['cellSize', 'width', 'height', 'clearance'] as const).map(key => ({key, titleKey: `nav.${key}`, kind: 'number' as const})), {key: 'diagonal', titleKey: 'nav.diagonal', kind: 'boolean'}, {key: 'show', titleKey: 'nav.show', kind: 'boolean'}],
};
export const navAgentDefinition: ComponentDefinition = {
 type: navAgentType, version: 1, titleKey: 'component.navAgent',
 defaults: () => ({speed: 160, arriveDistance: 4, follow: '', repath: .5, face: false}), parse: v => NavAgentSchema.parse(v),
 fields: [{key: 'speed', titleKey: 'nav.speed', kind: 'number'}, {key: 'arriveDistance', titleKey: 'nav.arriveDistance', kind: 'number'}, {key: 'follow', titleKey: 'nav.follow', kind: 'string', visible: () => false}, {key: 'repath', titleKey: 'nav.repath', kind: 'number', visible: v => Boolean((v as {follow?: string} | null)?.follow)}, {key: 'face', titleKey: 'nav.face', kind: 'boolean'}],
 remapReferences: (v, ids) => remapFollow(v, ids),
};

export interface Point {x: number; y: number}
export interface NavField {gridId: string; originX: number; originY: number; cell: number; cols: number; rows: number; diagonal: boolean; blocked: Uint8Array}
const toWorld = (byId: ReadonlyMap<string, Entity>, id: string) => {
 const w = worldTransform(byId, id), a = w.rotation * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
 return (p: Point): Point => { const x = (p.x - w.pivotX) * w.scaleX, y = (p.y - w.pivotY) * w.scaleY; return {x: w.x + x * cos - y * sin, y: w.y + x * sin + y * cos}; };
};
/** Whether an object's colliders stay put: no Rigid Body on it or above it, or a static one. */
function isStatic(byId: ReadonlyMap<string, Entity>, entity: Entity) {
 for (let e: Entity | undefined = entity, n = 0; e && n < 64; e = e.parentId ? byId.get(e.parentId) : undefined, n++) {
  const body = e.components.find(c => c.type === 'physics.rigidBody2d');
  if (body) return (body.data as {bodyType?: string}).bodyType === 'static';
 }
 return true;
}
const inside = (p: Point, poly: readonly Point[]) => { let hit = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit; } return hit; };
const segmentDistance = (p: Point, a: Point, b: Point) => { const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0; return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
const near = (p: Point, poly: readonly Point[], r: number) => { for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segmentDistance(p, poly[i], poly[j]) <= r) return true; return false; };
/** The obstacles of a scene as world polygons: static, non-sensor colliders and solid tilemaps of active objects. */
export function obstacles(entities: readonly Entity[]): Point[][] {
 const byId = new Map(entities.map(e => [e.id, e])), out: Point[][] = [];
 for (const o of colliderOutlines(entities.filter(e => isActive(e, entities) && isStatic(byId, e)))) { if (o.sensor || o.points.length < 3) continue; const world = toWorld(byId, o.entityId); out.push(o.points.map(world)); }
 return out;
}
/** Rasterizes a Nav Grid object's area: a cell is blocked when its centre lies in an obstacle or within `clearance` of one. */
export function buildField(entities: readonly Entity[], gridId?: string): NavField | null {
 const owner = entities.find(e => (!gridId || e.id === gridId) && e.components.some(c => c.type === navGridType));
 if (!owner) return null;
 const grid = NavGridSchema.parse(owner.components.find(c => c.type === navGridType)!.data), byId = new Map(entities.map(e => [e.id, e])), centre = toWorld(byId, owner.id)({x: transform(owner).pivotX ?? 0, y: transform(owner).pivotY ?? 0});
 const cols = Math.max(1, Math.ceil(grid.width / grid.cellSize)), rows = Math.max(1, Math.ceil(grid.height / grid.cellSize)), blocked = new Uint8Array(cols * rows), cell = grid.cellSize;
 const origin = {x: centre.x - cols * cell / 2, y: centre.y - rows * cell / 2};
 for (const poly of obstacles(entities)) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const c0 = Math.max(0, Math.floor((minX - grid.clearance - origin.x) / cell)), c1 = Math.min(cols - 1, Math.floor((maxX + grid.clearance - origin.x) / cell));
  const r0 = Math.max(0, Math.floor((minY - grid.clearance - origin.y) / cell)), r1 = Math.min(rows - 1, Math.floor((maxY + grid.clearance - origin.y) / cell));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
   const i = r * cols + c; if (blocked[i]) continue;
   const p = {x: origin.x + (c + .5) * cell, y: origin.y + (r + .5) * cell};
   if (inside(p, poly) || (grid.clearance > 0 && near(p, poly, grid.clearance))) blocked[i] = 1;
  }
 }
 return {gridId: owner.id, originX: origin.x, originY: origin.y, cell, cols, rows, diagonal: grid.diagonal, blocked};
}
export const cellOf = (f: NavField, p: Point) => { const c = Math.floor((p.x - f.originX) / f.cell), r = Math.floor((p.y - f.originY) / f.cell); return c >= 0 && r >= 0 && c < f.cols && r < f.rows ? r * f.cols + c : -1; };
export const centerOf = (f: NavField, i: number): Point => ({x: f.originX + (i % f.cols + .5) * f.cell, y: f.originY + (Math.floor(i / f.cols) + .5) * f.cell});
export const walkable = (f: NavField, p: Point) => { const i = cellOf(f, p); return i >= 0 && !f.blocked[i]; };
/** Nearest open cell to `i` (breadth-first, bounded), or -1. */
function nearestOpen(f: NavField, i: number, limit = 4096) {
 if (i < 0) return -1; if (!f.blocked[i]) return i;
 const seen = new Uint8Array(f.blocked.length), queue = [i]; seen[i] = 1;
 for (let q = 0; q < queue.length && q < limit; q++) {
  const at = queue[q], c = at % f.cols, r = Math.floor(at / f.cols);
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= f.cols || nr >= f.rows) continue; const n = nr * f.cols + nc; if (seen[n]) continue; if (!f.blocked[n]) return n; seen[n] = 1; queue.push(n); }
 }
 return -1;
}
const clampToField = (f: NavField, p: Point): Point => ({x: Math.min(f.originX + f.cols * f.cell - .001, Math.max(f.originX, p.x)), y: Math.min(f.originY + f.rows * f.cell - .001, Math.max(f.originY, p.y))});
/**
 * Whether a straight walk between two points stays on open cells: sampled every quarter cell with a small box around
 * the line, so it never slips between two blocked cells that only touch at a corner.
 */
export function clearLine(f: NavField, a: Point, b: Point) {
 const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (f.cell / 4)), r = f.cell * .3;
 for (let i = 0; i <= steps; i++) {
  const t = steps ? i / steps : 0, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
  for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) { const at = cellOf(f, {x: x + dx, y: y + dy}); if (at >= 0 && f.blocked[at]) return false; }
  if (cellOf(f, {x, y}) < 0) return false;
 }
 return true;
}
/**
 * Waypoints from `from` to `to` (the start itself excluded): an empty list when already there, null when no way exists.
 * A blocked or outside goal is moved to the nearest open cell; a start inside an inflated obstacle steps out first.
 */
export function findPath(f: NavField, from: Point, to: Point): Point[] | null {
 const start = nearestOpen(f, cellOf(f, clampToField(f, from))), goal = nearestOpen(f, cellOf(f, clampToField(f, to)));
 if (start < 0 || goal < 0) return null;
 const exact = cellOf(f, to) === goal ? to : centerOf(f, goal);
 if (start === goal) return Math.hypot(exact.x - from.x, exact.y - from.y) < 1e-6 ? [] : [exact];
 const n = f.blocked.length, g = new Float64Array(n).fill(Infinity), came = new Int32Array(n).fill(-1), closed = new Uint8Array(n), heap: [number, number][] = [];
 const gc = goal % f.cols, gr = Math.floor(goal / f.cols);
 const h = (i: number) => { const dx = Math.abs(i % f.cols - gc), dy = Math.abs(Math.floor(i / f.cols) - gr); return f.diagonal ? Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy) : dx + dy; };
 const push = (i: number, score: number) => { heap.push([score, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
 const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = k * 2 + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top[1]; };
 const moves = f.diagonal ? [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]] : [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];
 g[start] = 0; push(start, h(start));
 while (heap.length) {
  const at = pop(); if (closed[at]) continue; if (at === goal) break; closed[at] = 1;
  const c = at % f.cols, r = Math.floor(at / f.cols);
  for (const [dc, dr, cost] of moves) {
   const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= f.cols || nr >= f.rows) continue;
   const next = nr * f.cols + nc; if (f.blocked[next] || closed[next]) continue;
   if (dc && dr && (f.blocked[r * f.cols + nc] || f.blocked[nr * f.cols + c])) continue;
   const score = g[at] + cost; if (score >= g[next]) continue;
   g[next] = score; came[next] = at; push(next, score + h(next));
  }
 }
 if (came[goal] < 0) return null;
 const cells: number[] = []; for (let i = goal; i !== start; i = came[i]) cells.push(i);
 const points = [from, ...cells.reverse().map(i => centerOf(f, i))]; points[points.length - 1] = exact;
 const out: Point[] = []; let i = 0;
 while (i < points.length - 1) { let j = points.length - 1; while (j > i + 1 && !clearLine(f, points[i], points[j])) j--; out.push(points[j]); i = j; }
 return out;
}

/** What scripts and rules can ask of the running navigation. */
export interface NavigationControls {
 findPath(x1: number, y1: number, x2: number, y2: number): Point[] | null;
 /** Send an agent to a point; false when there is no way. */
 moveTo(id: string, x: number, y: number): boolean;
 follow(id: string, target: string | null): void;
 stop(id: string): void;
 walkable(x: number, y: number): boolean;
 /** Re-read obstacles (after moving or adding static colliders). */
 rebuild(): void;
 state(id: string): {moving: boolean; remaining: number; target: Point | null} | undefined;
}
interface Walk {path: Point[]; index: number; target: Point | null; follow: string; timer: number; arrived: boolean}
export interface NavigationHost {
 entities(): readonly Entity[];
 emit(event: InteractionEvent): void;
 silent(): boolean;
 /** Dynamic bodies are driven by velocity (px/s) when physics runs. */
 physics?(): {setVelocity(id: string, x: number, y: number): void; body(id: string): unknown} | undefined;
}
/** Runs a scene's agents: plans paths on the scene's Nav Grid and moves agents along them each frame. */
export class NavigationSession {
 readonly system: RuntimeSystem;
 readonly controls: NavigationControls;
 private field: NavField | null = null;
 private walks = new Map<string, Walk>();
 private host: NavigationHost;
 constructor(host: NavigationHost) {
  this.host = host;
  this.system = {id: 'navigation', start: () => { this.rebuild(); for (const e of this.agents()) { const a = this.agent(e); if (a?.follow) this.walk(e.id).follow = a.follow; } }, update: dt => this.update(dt), spawned: ids => { for (const e of this.agents()) if (ids.includes(e.id)) { const a = this.agent(e); if (a?.follow) this.walk(e.id).follow = a.follow; } }, removed: ids => { for (const id of ids) this.walks.delete(id); }, dispose: () => { this.walks.clear(); this.field = null; }};
  this.controls = {
   findPath: (x1, y1, x2, y2) => this.field ? findPath(this.field, {x: x1, y: y1}, {x: x2, y: y2}) : null,
   moveTo: (id, x, y) => this.moveTo(id, {x, y}),
   follow: (id, target) => { this.need(id); const w = this.walk(id); w.follow = target ?? ''; w.timer = 0; w.arrived = false; if (!target) this.halt(id); },
   stop: id => { const w = this.walks.get(id); if (w) { w.follow = ''; w.target = null; } this.halt(id); },
   walkable: (x, y) => this.field ? walkable(this.field, {x, y}) : false,
   rebuild: () => this.rebuild(),
   state: id => { const w = this.walks.get(id); if (!w) return this.agentEntity(id) ? {moving: false, remaining: 0, target: null} : undefined; return {moving: w.index < w.path.length, remaining: w.path.length - w.index, target: w.target}; },
  };
 }
 get grid() { return this.field; }
 rebuild() { this.field = buildField(this.host.entities()); }
 private agents() { const all = this.host.entities(); return all.filter(e => e.components.some(c => c.type === navAgentType)); }
 private agentEntity(id: string) { return this.host.entities().find(e => e.id === id && e.components.some(c => c.type === navAgentType)); }
 private agent(e: Entity) { const c = e.components.find(c => c.type === navAgentType), p = c && NavAgentSchema.safeParse(c.data); return p?.success ? p.data : undefined; }
 private need(id: string) { if (!this.agentEntity(id)) throw Error('This object has no Nav Agent'); if (!this.field) throw Error('The scene has no Nav Grid'); }
 private walk(id: string) { let w = this.walks.get(id); if (!w) { w = {path: [], index: 0, target: null, follow: '', timer: 0, arrived: false}; this.walks.set(id, w); } return w; }
 private position(id: string) { const all = this.host.entities(); return worldTransform(new Map(all.map(e => [e.id, e])), id); }
 private moveTo(id: string, target: Point) {
  this.need(id); const from = this.position(id), path = findPath(this.field!, from, target), w = this.walk(id);
  w.follow = ''; w.arrived = false;
  if (!path) { w.path = []; w.index = 0; w.target = null; this.halt(id); return false; }
  w.path = path; w.index = 0; w.target = path.length ? path[path.length - 1] : target;
  if (!path.length) this.arrive(id, w);
  return true;
 }
 private halt(id: string) { const w = this.walks.get(id); if (w) { w.path = []; w.index = 0; } const p = this.host.physics?.(); if (p?.body(id)) p.setVelocity(id, 0, 0); }
 private arrive(id: string, w: Walk) { this.halt(id); if (w.arrived) return; w.arrived = true; this.host.emit({type: 'navigation.arrived', sourceId: id, silent: this.host.silent()}); }
 private update(dt: number) {
  if (!this.field || dt <= 0) return;
  const all = this.host.entities(), byId = new Map(all.map(e => [e.id, e])), physics = this.host.physics?.();
  for (const [id, w] of this.walks) {
   const e = byId.get(id), a = e && this.agent(e);
   if (!e || !a || !isActive(e, all)) continue;
   const here = worldTransform(byId, id);
   if (w.follow) {
    const target = byId.get(w.follow);
    if (target && isActive(target, all)) {
     const goal = worldTransform(byId, w.follow), gap = Math.hypot(goal.x - here.x, goal.y - here.y);
     if (gap <= Math.max(a.arriveDistance, this.field.cell * .75)) { if (w.index < w.path.length || !w.arrived) this.arrive(id, w); }
     else {
      if (gap > Math.max(a.arriveDistance, this.field.cell) * 1.5) w.arrived = false;
      w.timer -= dt;
      if (w.timer <= 0 || w.index >= w.path.length) { w.timer = a.repath; const path = findPath(this.field, here, goal); w.path = path ?? []; w.index = 0; w.target = goal; }
     }
    }
   }
   if (w.index >= w.path.length) continue;
   let next = w.path[w.index], dx = next.x - here.x, dy = next.y - here.y, d = Math.hypot(dx, dy);
   const step = a.speed * dt, last = w.index === w.path.length - 1;
   if (d <= Math.max(step, last ? a.arriveDistance : 1e-3)) {
    w.index++;
    if (w.index >= w.path.length) { if (!physics?.body(id)) this.place(byId, e, next.x, next.y, a.face ? Math.atan2(dy, dx) : null); this.arrive(id, w); continue; }
    next = w.path[w.index]; dx = next.x - here.x; dy = next.y - here.y; d = Math.hypot(dx, dy);
   }
   if (d < 1e-6) continue;
   const ux = dx / d, uy = dy / d;
   if (physics?.body(id)) { physics.setVelocity(id, ux * a.speed, uy * a.speed); if (a.face) this.place(byId, e, null, null, Math.atan2(uy, ux)); }
   else this.place(byId, e, here.x + ux * Math.min(step, d), here.y + uy * Math.min(step, d), a.face ? Math.atan2(uy, ux) : null);
  }
 }
 /** Writes a world position / heading into the object's transform (parent space for children). */
 private place(byId: ReadonlyMap<string, Entity>, e: Entity, x: number | null, y: number | null, heading: number | null) {
  const t = e.components.find(c => c.type === 'scene.transform2d'); if (!t) return;
  const data = t.data as Record<string, number>, parent = e.parentId ? worldTransform(byId, e.parentId) : null;
  if (x !== null && y !== null) {
   if (!parent) { data.x = x; data.y = y; }
   else { const a = -parent.rotation * Math.PI / 180, dx = x - parent.x, dy = y - parent.y; data.x = (dx * Math.cos(a) - dy * Math.sin(a)) / (parent.scaleX || 1) + parent.pivotX; data.y = (dx * Math.sin(a) + dy * Math.cos(a)) / (parent.scaleY || 1) + parent.pivotY; }
  }
  if (heading !== null) data.rotation = heading * 180 / Math.PI - (parent?.rotation ?? 0);
 }
}

const agentRefs = (c: InteractionCatalog) => c.entities.filter(e => e.components.some(x => x.type === navAgentType)).map(e => ({id: e.id, name: e.name}));
export const navigationTriggers: TriggerDefinition[] = [{type: 'navigation.arrived', titleKey: 'interaction.navArrived', entityReference: true, references: agentRefs}];
/** Rule actions: walk an agent to a point (x, y in world pixels), or stop it. */
export const navigationActions = (controls: () => NavigationControls | undefined): ActionDefinition[] => {
 const live = () => { const c = controls(); if (!c) throw Error('Navigation is not running in this scene'); return c; };
 return [
  {type: 'navigation.moveTo', titleKey: 'interaction.navMoveTo', entityReference: true, references: agentRefs, execute: a => { live().moveTo(a.targetId, a.x ?? 0, a.y ?? 0); }},
  {type: 'navigation.stop', titleKey: 'interaction.navStop', entityReference: true, references: agentRefs, execute: a => live().stop(a.targetId)},
 ];
};
/** Whether a scene needs the navigation runtime. */
export const usesNavigation = (entities: readonly Entity[]) => entities.some(e => e.components.some(c => c.type === navAgentType || c.type === navGridType));
