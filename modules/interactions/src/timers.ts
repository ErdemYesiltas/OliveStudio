import {z} from 'zod';
import type {ComponentDefinition, RuntimeSystem} from '@rewrite/sdk';
import type {Entity} from '@rewrite/scene';

/**
 * Timer (like Godot's): counts `seconds` of game time, then fires "Timer finished" (rules, state machines and the
 * object's `onTimer` script hook). `repeat` starts it over; `autostart` runs it when the scene (or the spawned copy)
 * starts, otherwise a rule or script starts it. It counts only while its object is active.
 */
export const timerType = 'interactions.timer';
export const TimerSchema = z.object({seconds: z.number().min(.01).max(86400).default(1), repeat: z.boolean().default(false), autostart: z.boolean().default(true)}).strict();
export type TimerData = z.infer<typeof TimerSchema>;
export const timerDefinition: ComponentDefinition = {
 type: timerType, version: 1, titleKey: 'component.timer', defaults: () => TimerSchema.parse({}), parse: v => TimerSchema.parse(v),
 fields: [{key: 'seconds', titleKey: 'timer.seconds', kind: 'number'}, {key: 'repeat', titleKey: 'timer.repeat', kind: 'boolean'}, {key: 'autostart', titleKey: 'timer.autostart', kind: 'boolean'}],
};
interface Running {entityId: string; running: boolean; elapsed: number}
const activeIn = (byId: ReadonlyMap<string, Entity>, id: string) => { for (let e = byId.get(id), n = 0; e && n < 128; e = e.parentId ? byId.get(e.parentId) : undefined, n++) if (!e.active) return false; return byId.has(id); };

/** The play session's timers, stepped on the fixed 1/60 s game clock so Pause, Step and exported games agree. */
export class TimerSession {
 private timers = new Map<string, Running>();
 private dead = false;
 readonly system: RuntimeSystem;
 constructor(private entities: () => readonly Entity[], private fire: (componentId: string, silent: boolean) => void, private silent: () => boolean = () => false) {
  this.system = {id: 'timers', start: () => this.scan(), fixedUpdate: dt => this.step(dt), spawned: () => this.scan(), removed: () => this.scan(), dispose: () => { this.dead = true; this.timers.clear(); }};
 }
 /** Picks up timers of new objects (autostart ones start at once) and forgets those of removed ones. */
 private scan() {
  if (this.dead) return;
  const seen = new Set<string>();
  for (const e of this.entities()) for (const c of e.components) {
   if (c.type !== timerType || c.version !== 1) continue;
   seen.add(c.id);
   if (!this.timers.has(c.id)) this.timers.set(c.id, {entityId: e.id, running: TimerSchema.parse(c.data).autostart, elapsed: 0});
  }
  for (const id of [...this.timers.keys()]) if (!seen.has(id)) this.timers.delete(id);
 }
 private step(dt: number) {
  if (this.dead || !this.timers.size) return;
  const entities = this.entities(), byId = new Map(entities.map(e => [e.id, e])), silent = this.silent();
  for (const [id, t] of this.timers) {
   if (!t.running || !activeIn(byId, t.entityId)) continue;
   const component = byId.get(t.entityId)?.components.find(c => c.id === id), data = component ? TimerSchema.safeParse(component.data) : undefined;
   if (!data?.success) continue;
   t.elapsed += dt;
   for (let fired = 0; t.running && t.elapsed + 1e-9 >= data.data.seconds; fired++) {
    if (fired >= 8) { t.elapsed = 0; break; }
    t.elapsed -= data.data.seconds;
    if (!data.data.repeat) { t.running = false; t.elapsed = 0; }
    this.fire(id, silent);
   }
  }
 }
 /** Start (or restart) from zero. */
 play(id: string) { const t = this.timers.get(id); if (t) { t.running = true; t.elapsed = 0; } }
 stop(id: string) { const t = this.timers.get(id); if (t) { t.running = false; t.elapsed = 0; } }
 get diagnostics() { return Object.fromEntries([...this.timers].map(([id, t]) => [id, {running: t.running, elapsed: Math.round(t.elapsed * 1000) / 1000}])); }
}
