import Matter from 'matter-js';
import {providers,type EditorModule} from '@rewrite/sdk';
import {physicsProviders,type PhysicsProvider,type ContactEvent,type PhysicsBodySpec,type JointSpec,type RayHit,type ShapePart} from '@rewrite/physics/contracts';

/** Gravity and forces: pixels per second² × this = Matter units (calibrated so 980 falls like 980 px/s²). */
const FORCE = .000001;
const rad = (deg: number) => deg * Math.PI / 180, deg = (r: number) => r * 180 / Math.PI;
const rotate = (p: {x: number; y: number}, angle: number) => ({x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle)});
/** Convex hull (monotone chain) so concave outlines never need poly-decomp. */
export function convexHull(points: readonly {x: number; y: number}[]) {
 const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y), cross = (o: typeof p[0], a: typeof p[0], b: typeof p[0]) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
 const lower: typeof p = [], upper: typeof p = [];
 for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, q) <= 0) lower.pop(); lower.push(q); }
 for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, q) <= 0) upper.pop(); upper.push(q); }
 return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
/** Where segment a→b first crosses a convex outline, with the edge's outward normal. */
function segmentHit(a: {x: number; y: number}, b: {x: number; y: number}, vertices: readonly {x: number; y: number}[]) {
 let best: {t: number; nx: number; ny: number} | undefined;
 const dx = b.x - a.x, dy = b.y - a.y;
 for (let i = 0; i < vertices.length; i++) {
  const p = vertices[i], q = vertices[(i + 1) % vertices.length], ex = q.x - p.x, ey = q.y - p.y, den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) continue;
  const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den, u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1 || (best && t >= best.t)) continue;
  const len = Math.hypot(ex, ey) || 1; let nx = ey / len, ny = -ex / len;
  if (nx * dx + ny * dy > 0) { nx = -nx; ny = -ny; }
  best = {t, nx, ny};
 }
 return best;
}

interface Tracked {body: Matter.Body; spec: PhysicsBodySpec; originOffset: {x: number; y: number}; angleOffset: number}
export const matterProvider: PhysicsProvider = {id: 'matter', create(settings, contact, options = {}) {
 const engine = Matter.Engine.create({enableSleeping: settings.sleeping, positionIterations: settings.positionIterations ?? 8, velocityIterations: settings.velocityIterations ?? 6});
 engine.gravity.x = settings.gravityX; engine.gravity.y = settings.gravityY; engine.gravity.scale = FORCE; engine.timing.timeScale = settings.timeScale ?? 1;
 const tracked = new Map<string, Tracked>(), ids = new Map<Matter.Body, string>(), joints = new Map<string, {constraint: Matter.Constraint; spec: JointSpec}>(), pairs = new Map<string, Omit<ContactEvent, 'phase' | 'contact'>>();
 let dead = false, dragging: {id: string; constraint: Matter.Constraint} | undefined, nextGroup = -1;
 const owner = (body: Matter.Body) => ids.get(body.parent ?? body) ?? ids.get(body);
 const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());
 const contacts = (phase: ContactEvent['phase'], event: Matter.IEventCollision<Matter.Engine>) => {
  if (dead) return;
  for (const pair of event.pairs) {
   const a = owner(pair.bodyA), b = owner(pair.bodyB);
   if (!a || !b || a === b) continue;
   const key = pairKey(a, b);
   if (phase === 'enter') {
    if (pairs.has(key)) continue;
    const value = {a, b, sensor: pair.bodyA.isSensor || pair.bodyB.isSensor}; pairs.set(key, value);
    const c = pair.collision, support = c.supports?.[0] ?? {x: (pair.bodyA.position.x + pair.bodyB.position.x) / 2, y: (pair.bodyA.position.y + pair.bodyB.position.y) / 2};
    const va = Matter.Body.getVelocity(pair.bodyA.parent ?? pair.bodyA), vb = Matter.Body.getVelocity(pair.bodyB.parent ?? pair.bodyB);
    contact({phase, ...value, contact: {x: support.x, y: support.y, normalX: c.normal.x, normalY: c.normal.y, depth: c.depth, speed: Math.abs(((va.x - vb.x) * c.normal.x + (va.y - vb.y) * c.normal.y) * 60)}});
   } else { const value = pairs.get(key); if (value) { pairs.delete(key); contact({phase, ...value}); } }
  }
 };
 const enter = (e: Matter.IEventCollision<Matter.Engine>) => contacts('enter', e), exit = (e: Matter.IEventCollision<Matter.Engine>) => contacts('exit', e);
 Matter.Events.on(engine, 'collisionStart', enter); Matter.Events.on(engine, 'collisionEnd', exit);
 if (options.bounds) {
  const {width: w, height: h} = options.bounds, t = 400, wall = (x: number, y: number, ww: number, hh: number) => Matter.Bodies.rectangle(x, y, ww, hh, {isStatic: true, label: 'wall'});
  Matter.Composite.add(engine.world, [wall(w / 2, -t / 2, w + 2 * t, t), wall(w / 2, h + t / 2, w + 2 * t, t), wall(-t / 2, h / 2, t, h + 2 * t), wall(w + t / 2, h / 2, t, h + 2 * t)]);
 }
 const get = (id: string) => { const t = tracked.get(id); if (!t) throw Error('This object has no physics body'); return t; };
 const dynamic = (id: string) => { const t = get(id); if (t.spec.settings.bodyType !== 'dynamic') throw Error('Only dynamic bodies can be pushed'); return t; };
 const part = (p: ShapePart, origin: {x: number; y: number}, angle: number, base: Matter.IChamferableBodyDefinition): Matter.Body => {
  const at = {x: origin.x + rotate(p, angle).x, y: origin.y + rotate(p, angle).y}, a = angle + rad(p.angle), o = {...base, isSensor: p.sensor};
  if (p.kind === 'circle') return Matter.Bodies.circle(at.x, at.y, p.radius, o);
  if (p.kind === 'box') return Matter.Bodies.rectangle(at.x, at.y, p.width, p.height, {...o, angle: a, ...(p.chamfer > 0 ? {chamfer: {radius: Math.min(p.chamfer, p.width / 2, p.height / 2)}} : {})});
  const world = convexHull(p.points).map(v => { const r = rotate(v, a); return {x: at.x + r.x, y: at.y + r.y}; }), centre = Matter.Vertices.centre(world);
  return Matter.Bodies.fromVertices(centre.x, centre.y, [world], o);
 };
 const tunnel = () => [...tracked.values()].some(t => t.spec.settings.bullet);
 const world = {
  add(spec: PhysicsBodySpec) {
   if (dead) throw Error('Physics world disposed');
   if (tracked.has(spec.entityId)) throw Error('Duplicate physics body');
   if (!spec.parts.length) throw Error('A physics body needs a collider');
   const s = spec.settings, angle = rad(spec.rotation), base: Matter.IChamferableBodyDefinition = {isStatic: s.bodyType !== 'dynamic', density: s.density, friction: s.friction, frictionStatic: s.frictionStatic, restitution: s.restitution, frictionAir: s.airFriction, collisionFilter: spec.filter, slop: .05};
   const parts = spec.parts.map(p => part(p, spec, angle, base));
   const body = parts.length === 1 ? parts[0] : Matter.Body.create({parts, ...base});
   if (parts.length > 1) for (const p of parts) p.collisionFilter = {...spec.filter};
   if (s.mass > 0 && s.bodyType === 'dynamic') Matter.Body.setMass(body, s.mass);
   if (s.lockRotation) Matter.Body.setInertia(body, Infinity);
   const originOffset = rotate({x: spec.x - body.position.x, y: spec.y - body.position.y}, -body.angle), angleOffset = angle - body.angle;
   if (s.bodyType === 'dynamic') { Matter.Body.setVelocity(body, {x: s.velocityX / 60, y: s.velocityY / 60}); Matter.Body.setAngularVelocity(body, s.lockRotation ? 0 : rad(s.angularVelocity) / 60); }
   tracked.set(spec.entityId, {body, spec, originOffset, angleOffset}); ids.set(body, spec.entityId);
   Matter.Composite.add(engine.world, body);
  },
  remove(id: string) {
   const t = tracked.get(id); if (!t || dead) return;
   for (const [key, pair] of pairs) if (pair.a === id || pair.b === id) { pairs.delete(key); contact({phase: 'exit', ...pair}); }
   for (const [jid, j] of joints) if (j.spec.a === id || j.spec.b === id) world.removeJoint(jid);
   if (dragging?.id === id) world.drag(null);
   Matter.Composite.remove(engine.world, t.body); tracked.delete(id); ids.delete(t.body);
  },
  step(dt: number) {
   if (dead) return;
   if (!Number.isFinite(dt) || dt <= 0 || dt > 1 / 60 + 1e-8) throw Error('Matter step must be between 0 and 1/60 seconds');
   for (const j of joints.values()) if (j.spec.kind === 'rope') { const c = j.constraint, pa = Matter.Constraint.pointAWorld(c), pb = Matter.Constraint.pointBWorld(c); c.stiffness = Math.hypot(pa.x - pb.x, pa.y - pb.y) > j.spec.length ? 1 : 0; }
   const substeps = tunnel() ? 4 : 1;
   for (let i = 0; i < substeps; i++) {
    for (const t of tracked.values()) { const g = t.spec.settings.gravityScale; if (t.spec.settings.bodyType !== 'dynamic' || g === 1 || t.body.isSleeping) continue; Matter.Body.applyForce(t.body, t.body.position, {x: t.body.mass * engine.gravity.x * FORCE * (g - 1), y: t.body.mass * engine.gravity.y * FORCE * (g - 1)}); }
    Matter.Engine.update(engine, dt * 1000 / substeps);
   }
  },
  poses() {
   if (dead) return [];
   return [...tracked].map(([entityId, t]) => {
    const v = Matter.Body.getVelocity(t.body), o = rotate(t.originOffset, t.body.angle);
    return {entityId, x: t.body.position.x + o.x, y: t.body.position.y + o.y, rotation: deg(t.body.angle + t.angleOffset), velocityX: v.x * 60, velocityY: v.y * 60, angularVelocity: deg(Matter.Body.getAngularVelocity(t.body)) * 60, sleeping: t.body.isSleeping};
   });
  },
  addJoint(spec: JointSpec) {
   if (dead || joints.has(spec.id)) return;
   const a = get(spec.a), b = spec.b ? get(spec.b) : undefined, worldOf = (t: Tracked, anchor: {x: number; y: number}) => { const pose = world.poses().find(p => p.entityId === t.spec.entityId)!, r = rotate(anchor, rad(pose.rotation)); return {x: pose.x + r.x, y: pose.y + r.y}; };
   const wa = worldOf(a, spec.anchorA), wb = b ? worldOf(b, spec.anchorB) : spec.anchorB, length = spec.kind === 'pin' ? 0 : spec.length > 0 ? spec.length : Math.hypot(wa.x - wb.x, wa.y - wb.y);
   const constraint = Matter.Constraint.create({bodyA: a.body, pointA: {x: wa.x - a.body.position.x, y: wa.y - a.body.position.y}, ...(b ? {bodyB: b.body, pointB: {x: wb.x - b.body.position.x, y: wb.y - b.body.position.y}} : {pointB: {...wb}}),
    length, stiffness: spec.kind === 'spring' ? Math.min(spec.stiffness, .2) : spec.kind === 'rope' ? 0 : Math.max(spec.stiffness, .001), damping: spec.damping});
   if (!spec.collideConnected && b && !a.spec.filter.group && !b.spec.filter.group) { const g = nextGroup--; for (const t of [a, b]) for (const p of t.body.parts) p.collisionFilter = {...p.collisionFilter, group: g}; }
   joints.set(spec.id, {constraint, spec: {...spec, length}}); Matter.Composite.add(engine.world, constraint);
  },
  removeJoint(id: string) { const j = joints.get(id); if (!j) return; Matter.Composite.remove(engine.world, j.constraint); joints.delete(id); },
  setVelocity(id: string, x: number, y: number) { const t = dynamic(id); Matter.Sleeping.set(t.body, false); Matter.Body.setVelocity(t.body, {x: x / 60, y: y / 60}); },
  setAngularVelocity(id: string, dps: number) { const t = dynamic(id); Matter.Sleeping.set(t.body, false); if (!t.spec.settings.lockRotation) Matter.Body.setAngularVelocity(t.body, rad(dps) / 60); },
  applyForce(id: string, x: number, y: number) { const t = dynamic(id); Matter.Sleeping.set(t.body, false); Matter.Body.applyForce(t.body, t.body.position, {x: x * FORCE, y: y * FORCE}); },
  applyImpulse(id: string, x: number, y: number) { const t = dynamic(id); Matter.Sleeping.set(t.body, false); const v = Matter.Body.getVelocity(t.body); Matter.Body.setVelocity(t.body, {x: v.x + x / t.body.mass / 60, y: v.y + y / t.body.mass / 60}); },
  setPose(id: string, x: number, y: number, rotation: number, seconds?: number) {
   const t = get(id), angle = rad(rotation) - t.angleOffset, o = rotate(t.originOffset, angle), at = {x: x - o.x, y: y - o.y};
   if (seconds && seconds > 0) {
    // Kinematic: move with velocity so contacts push dynamic bodies instead of overlapping them.
    const steps = seconds * 60;
    Matter.Body.setVelocity(t.body, {x: (at.x - t.body.position.x) / steps, y: (at.y - t.body.position.y) / steps}); Matter.Body.setAngularVelocity(t.body, (angle - t.body.angle) / steps);
   }
   // Matter 0.20 keeps the velocity when `updateVelocity` is set (its typings predate the argument).
   const move = Matter.Body as unknown as {setPosition(b: Matter.Body, p: {x: number; y: number}, update?: boolean): void; setAngle(b: Matter.Body, a: number, update?: boolean): void};
   move.setPosition(t.body, at, Boolean(seconds)); move.setAngle(t.body, angle, Boolean(seconds)); Matter.Sleeping.set(t.body, false);
   if (!seconds && !t.body.isStatic) Matter.Body.setVelocity(t.body, {x: 0, y: 0});
  },
  body(id: string) { const t = tracked.get(id); if (!t) return undefined; const v = Matter.Body.getVelocity(t.body); return {mass: t.body.mass, velocityX: v.x * 60, velocityY: v.y * 60, angularVelocity: deg(Matter.Body.getAngularVelocity(t.body)) * 60, sleeping: t.body.isSleeping}; },
  setGravity(x: number, y: number) { engine.gravity.x = x; engine.gravity.y = y; for (const t of tracked.values()) Matter.Sleeping.set(t.body, false); },
  setTimeScale(scale: number) { engine.timing.timeScale = Math.max(0, Math.min(4, scale)); },
  raycast(from: {x: number; y: number}, to: {x: number; y: number}): RayHit[] {
   const bodies = [...tracked.values()].map(t => t.body), best = new Map<string, RayHit>(), length = Math.hypot(to.x - from.x, to.y - from.y);
   for (const hit of Matter.Query.ray(bodies, from, to, 1)) {
    const parts = hit.bodyA.parts.length > 1 ? hit.bodyA.parts.slice(1) : [hit.bodyA], id = owner(hit.bodyA);
    if (!id) continue;
    for (const p of parts) {
     const h = Matter.Vertices.contains(p.vertices, from) ? {t: 0, nx: 0, ny: 0} : segmentHit(from, to, p.vertices);
     if (!h) continue;
     const distance = h.t * length, prev = best.get(id);
     if (!prev || distance < prev.distance) best.set(id, {entityId: id, x: from.x + (to.x - from.x) * h.t, y: from.y + (to.y - from.y) * h.t, normalX: h.nx, normalY: h.ny, distance});
    }
   }
   return [...best.values()].sort((a, b) => a.distance - b.distance);
  },
  point(x: number, y: number) { return [...new Set(Matter.Query.point([...tracked.values()].map(t => t.body), {x, y}).map(owner).filter((id): id is string => Boolean(id)))]; },
  region(minX: number, minY: number, maxX: number, maxY: number) { return [...new Set(Matter.Query.region([...tracked.values()].map(t => t.body), {min: {x: minX, y: minY}, max: {x: maxX, y: maxY}}).map(owner).filter((id): id is string => Boolean(id)))]; },
  drag(id: string | null, point?: {x: number; y: number}) {
   if (dead) return;
   if (!id || !point) { if (dragging) Matter.Composite.remove(engine.world, dragging.constraint); dragging = undefined; return; }
   if (dragging?.id === id) { dragging.constraint.pointB = {...point}; return; }
   if (dragging) world.drag(null);
   const t = dynamic(id); Matter.Sleeping.set(t.body, false);
   const local = rotate({x: point.x - t.body.position.x, y: point.y - t.body.position.y}, -t.body.angle);
   const constraint = Matter.Constraint.create({bodyA: t.body, pointA: rotate(local, t.body.angle), pointB: {...point}, length: 0, stiffness: .2, damping: .1});
   dragging = {id, constraint}; Matter.Composite.add(engine.world, constraint);
  },
  dispose() {
   if (dead) return;
   dead = true; Matter.Events.off(engine, 'collisionStart', enter); Matter.Events.off(engine, 'collisionEnd', exit);
   Matter.Composite.clear(engine.world, false); Matter.Engine.clear(engine); pairs.clear(); tracked.clear(); ids.clear(); joints.clear(); dragging = undefined;
  },
 };
 return world;
}};
export const matterModule: EditorModule = {manifest: {id: 'matter', version: '1.0.0', apiVersion: 1, requires: {physics: '^1'}, entries: {runtime: '@rewrite/physics-matter'}}, activate(c) {
 c.contribute(physicsProviders, 'matter.adapter', matterProvider);
 c.contribute(providers, 'matter.descriptor', {id: 'matter', service: 'physics', version: '1.0.0', capabilities: ['box', 'circle', 'capsule', 'polygon', 'compound', 'sensors', 'kinematic', 'filters', 'joints', 'queries', 'drag', 'sleeping', 'fixed-step', 'rotation-lock'], targets: ['html', 'macos'], runtimeEntry: '@rewrite/physics-matter'});
}};
