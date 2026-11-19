import {PhysicsSession,PhysicsSettingsSchema,defaultPhysicsSettings} from '@rewrite/physics';
import {matterProvider} from '@rewrite/physics-matter';
import {physicsActions} from '@rewrite/interactions';
import type {PlayerPlugin} from '../plugin';
/**
 * Matter physics for exported games: one session per scene, contacts as `physics.enter` / `physics.exit` events for both
 * objects (the other object as the event, the contact as data), `physics` controls for rules and scripts, and pointer
 * dragging of draggable bodies.
 */
export default {id: 'matter', create(c) {
 let physics: PhysicsSession | undefined;
 const unpoint = c.pointer((phase, x, y) => physics?.pointer(phase, x, y));
 return {
  systems() {
   physics = new PhysicsSession(c.entities, PhysicsSettingsSchema.parse(c.bundle.project.extensions['physics.world'] ?? defaultPhysicsSettings), matterProvider, {
    bounds: () => c.bundle.project.stage ?? {width: 960, height: 540},
    event: e => { for (const [id, other] of [[e.a, e.b], [e.b, e.a]]) c.emit({type: `physics.${e.phase}`, sourceId: id, event: other, silent: e.silent, ...(e.contact ? {data: e.contact} : {})}); },
   });
   c.services.set('physics', physics.controls);
   return [physics.system];
  },
  /** Push / set velocity / spin / move / gravity rules (they act through the player's `physics` service). */
  actions: physicsActions,
  errors: () => physics?.errors ?? [],
  clear() { physics = undefined; },
  dispose() { unpoint(); },
 };
}} satisfies PlayerPlugin;
