import { Point } from 'pixi.js';
import type { Particle } from '../Particle.js';
import { rotatePoint, scaleBy, length } from '../ParticleUtils.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';

/**
 * Moves particles under a constant acceleration — gravity, wind, a magnet.
 *
 * Each particle starts at a random speed between `minStart` and `maxStart`,
 * aimed along whatever rotation the spawn behavior gave it, and is then
 * integrated against `accel` every frame. Position is advanced by the **midpoint**
 * of the old and new velocity rather than the new one, which keeps a falling
 * particle's arc correct instead of overshooting each step.
 *
 * Runs at {@link BehaviorOrder.Late} so its `rotate` write lands after any
 * rotation behavior that was configured alongside it.
 *
 * @example
 * ```ts
 * {
 *   type: 'moveAcceleration',
 *   config: {
 *     accel: { x: 0, y: 2000 },
 *     minStart: 600,
 *     maxStart: 600,
 *     rotate: true,
 *   },
 * }
 * ```
 */
export class AccelerationBehavior implements IEmitterBehavior {
  public static type = 'moveAcceleration' as const;

  public order = BehaviorOrder.Late;
  private minStart: number;
  private maxStart: number;
  private accel: { x: number; y: number };
  private rotate: boolean;
  private maxSpeed: number;

  /**
   * @param config.minStart - Lowest initial speed, in world units per second.
   * @param config.maxStart - Highest initial speed, in world units per second.
   * @param config.accel - Constant acceleration in the parent's coordinate
   * space, in world units per second squared.
   * @param config.rotate - Turn each particle to face its direction of travel.
   * The spawn rotation still sets the initial direction, but this overrides any
   * dynamic rotation behavior afterwards. Defaults to `false`.
   * @param config.maxSpeed - Speed ceiling; `0` (the default) is unlimited.
   */
  constructor(config: {
    minStart: number;
    maxStart: number;
    accel: { x: number; y: number };
    rotate?: boolean;
    maxSpeed?: number;
  }) {
    this.minStart = config.minStart;
    this.maxStart = config.maxStart;
    this.accel = config.accel;
    this.rotate = !!config.rotate;
    this.maxSpeed = config.maxSpeed ?? 0;
  }

  initParticles(first: Particle) {
    let next: Particle | undefined = first;

    while (next) {
      const speed =
        Math.random() * (this.maxStart - this.minStart) + this.minStart;

      if (!next.config.velocity) {
        next.config.velocity = new Point(speed, 0);
      } else {
        (next.config.velocity as Point).set(speed, 0);
      }

      rotatePoint(next.rotation, next.config.velocity);

      next = next.next!;
    }
  }

  updateParticle(particle: Particle, deltaSec: number): undefined {
    const vel = particle.config.velocity;
    const oldVX = vel.x;
    const oldVY = vel.y;

    vel.x += this.accel.x * deltaSec;
    vel.y += this.accel.y * deltaSec;
    if (this.maxSpeed) {
      const currentSpeed = length(vel);

      if (currentSpeed > this.maxSpeed) {
        scaleBy(vel, this.maxSpeed / currentSpeed);
      }
    }

    particle.x += ((oldVX + vel.x) / 2) * deltaSec;
    particle.y += ((oldVY + vel.y) / 2) * deltaSec;
    if (this.rotate) {
      particle.rotation = Math.atan2(vel.y, vel.x);
    }
  }
}
