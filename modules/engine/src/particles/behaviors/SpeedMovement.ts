import { Point } from 'pixi.js';
import type { Particle } from '../Particle.js';
import { rotatePoint, normalize, scaleBy } from '../ParticleUtils.js';
import { PropertyList } from '../PropertyList.js';
import { PropertyNode, type ValueList } from '../PropertyNode.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';

/**
 * Moves particles at a keyframed speed along the direction they spawned facing.
 *
 * Direction comes entirely from the particle's starting rotation — this behavior
 * only ever changes the magnitude, re-normalising the stored velocity each frame
 * before scaling it. That is what lets a spawn shape aim the particles and this
 * behavior pace them independently.
 *
 * `minMult` gives per-particle variety: each draws one multiplier between
 * `minMult` and `1` at spawn and keeps it for its whole life.
 *
 * @example
 * ```ts
 * {
 *   type: 'moveSpeed',
 *   config: {
 *     speed: {
 *       list: [
 *         { value: 10, time: 0 },
 *         { value: 100, time: 0.25 },
 *         { value: 0, time: 1 },
 *       ],
 *     },
 *     minMult: 0.8,
 *   },
 * }
 * ```
 */
export class SpeedBehavior implements IEmitterBehavior {
  public static type = 'moveSpeed' as const;

  public order = BehaviorOrder.Late;
  private list: PropertyList<number>;
  private minMult: number;

  /**
   * @param config.speed - Speed keyframes in world units per second, at least `0`.
   * @param config.minMult - Lower bound of the per-particle multiplier, drawn
   * once between this and `1`. Defaults to `1` (no variation).
   */
  constructor(config: {
    speed: ValueList<number>;
    minMult: number;
  }) {
    this.list = new PropertyList(false);
    this.list.reset(PropertyNode.createList(config.speed));
    this.minMult = config.minMult ?? 1;
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;

    while (next) {
      const mult = Math.random() * (1 - this.minMult) + this.minMult;

      next.config.speedMult = mult;
      if (!next.config.velocity) {
        next.config.velocity = new Point(this.list.first!.value * mult, 0);
      } else {
        (next.config.velocity as Point).set(this.list.first!.value * mult, 0);
      }

      rotatePoint(next.rotation, next.config.velocity);

      next = next.next!;
    }
  }

  updateParticle(particle: Particle, deltaSec: number): undefined {
    const speed =
      this.list.interpolate!(particle.agePercent) * particle.config.speedMult;
    const vel = particle.config.velocity;

    normalize(vel);
    scaleBy(vel, speed);
    particle.x += vel.x * deltaSec;
    particle.y += vel.y * deltaSec;
  }
}

/**
 * Moves particles at one random constant speed for their whole life, along the
 * direction they spawned facing.
 *
 * Cheaper than {@link SpeedBehavior}: the velocity vector is built once at spawn
 * and the per-frame step is a plain add, with no interpolation or re-normalising.
 *
 * @example
 * ```ts
 * { type: 'moveSpeedStatic', config: { min: 100, max: 150 } }
 * ```
 */
export class StaticSpeedBehavior implements IEmitterBehavior {
  public static type = 'moveSpeedStatic' as const;

  public order = BehaviorOrder.Late;
  private min: number;
  private max: number;

  /**
   * @param config.min - Slowest initial speed, in world units per second.
   * @param config.max - Fastest initial speed, in world units per second.
   */
  constructor(config: {
    min: number;
    max: number;
  }) {
    this.min = config.min;
    this.max = config.max;
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;

    while (next) {
      const speed = Math.random() * (this.max - this.min) + this.min;

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
    const velocity = particle.config.velocity;

    particle.x += velocity.x * deltaSec;
    particle.y += velocity.y * deltaSec;
  }
}
