import type { Particle } from '../Particle.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';

/**
 * Spawns every particle at the emitter's own position.
 *
 * The default when no other spawn behavior is configured — it deliberately does
 * nothing, leaving the particle at the origin the emitter's transform then moves.
 *
 * @example
 * ```ts
 * { type: 'spawnPoint', config: {} }
 * ```
 */
export class PointSpawnBehavior implements IEmitterBehavior {
  public static type = 'spawnPoint' as const;

  order = BehaviorOrder.Spawn;

  // A point spawn leaves every particle where the emitter put it; the interface still wants
  // the hook, so the empty body is the implementation.
  initParticles(_first: Particle): undefined {}
}
