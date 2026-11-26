import type { Particle } from '../Particle.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';
import { DEG_TO_RADS, rotatePoint } from '../ParticleUtils.js';

/**
 * Fans a wave of particles out from a point or ring at evenly spaced angles.
 *
 * `spacing` is what makes the burst regular: each particle in the wave is placed
 * one step further round from `start`. Set it to `0` and every particle gets a
 * random angle instead, which is the difference between a starburst and a puff.
 * A non-zero `distance` pushes them onto a ring rather than starting them all at
 * the centre.
 *
 * Angles are configured in degrees and converted once at construction.
 *
 * @example
 * ```ts
 * { type: 'spawnBurst', config: { spacing: 90, start: 0, distance: 40 } }
 * ```
 */
export class BurstSpawnBehavior implements IEmitterBehavior {
  public static type = 'spawnBurst' as const;

  order = BehaviorOrder.Spawn;
  private spacing: number;
  private start: number;
  private distance: number;

  /**
   * @param config.spacing - Degrees between consecutive particles in a wave;
   * `0` randomises the angle instead.
   * @param config.start - Angle of the first particle, in degrees. `0` faces
   * right, `90` faces up.
   * @param config.distance - Radius from the emitter to spawn at, forming a
   * ring or arc. `0` spawns everything at the centre.
   */
  constructor(config: {
    spacing: number;
    start: number;
    distance: number;
  }) {
    this.spacing = config.spacing * DEG_TO_RADS;
    this.start = config.start * DEG_TO_RADS;
    this.distance = config.distance;
  }

  initParticles(first: Particle): undefined {
    let count = 0;
    let next: Particle | undefined = first;

    while (next) {
      let angle: number;

      if (this.spacing) {
        angle = this.start + this.spacing * count;
      } else {
        angle = Math.random() * Math.PI * 2;
      }

      next.rotation = angle;
      if (this.distance) {
        next.x = this.distance;
        rotatePoint(angle, next);
      }
      next = next.next;
      ++count;
    }
  }
}
