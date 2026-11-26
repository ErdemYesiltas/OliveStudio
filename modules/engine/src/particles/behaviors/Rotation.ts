import type { Particle } from '../Particle.js';
import { DEG_TO_RADS } from '../ParticleUtils.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';

/**
 * Spins particles: a random starting angle, a random spin rate, and an optional
 * constant angular acceleration.
 *
 * The start angle is **added** to whatever rotation the spawn behavior already
 * set, so a burst keeps its outward aim and gets a spin on top. Angles are
 * configured in degrees and converted once at construction; positive speeds turn
 * counter-clockwise.
 *
 * With `accel` set, the angle advances by the midpoint of the old and new spin
 * rate rather than the new one, which keeps an accelerating spin smooth instead
 * of overshooting each step.
 *
 * @example
 * ```ts
 * {
 *   type: 'rotation',
 *   config: { minStart: 0, maxStart: 180, minSpeed: 30, maxSpeed: 45, accel: 20 },
 * }
 * ```
 */
export class RotationBehavior implements IEmitterBehavior {
  public static type = 'rotation' as const;

  public order = BehaviorOrder.Normal;
  private minStart: number;
  private maxStart: number;
  private minSpeed: number;
  private maxSpeed: number;
  private accel: number;

  /**
   * @param config.minStart - Lowest starting angle in degrees; `0` faces right, `90` up.
   * @param config.maxStart - Highest starting angle in degrees.
   * @param config.minSpeed - Lowest spin rate in degrees per second; positive is counter-clockwise.
   * @param config.maxSpeed - Highest spin rate in degrees per second.
   * @param config.accel - Constant angular acceleration in degrees per second squared;
   * `0` keeps each particle's spin rate constant and takes the cheaper update path.
   */
  constructor(config: {
    minStart: number;
    maxStart: number;
    minSpeed: number;
    maxSpeed: number;
    accel: number;
  }) {
    this.minStart = config.minStart * DEG_TO_RADS;
    this.maxStart = config.maxStart * DEG_TO_RADS;
    this.minSpeed = config.minSpeed * DEG_TO_RADS;
    this.maxSpeed = config.maxSpeed * DEG_TO_RADS;
    this.accel = config.accel * DEG_TO_RADS;
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;

    while (next) {
      if (this.minStart === this.maxStart) {
        next.rotation += this.maxStart;
      } else {
        next.rotation +=
          Math.random() * (this.maxStart - this.minStart) + this.minStart;
      }
      next.config.rotSpeed =
        Math.random() * (this.maxSpeed - this.minSpeed) + this.minSpeed;

      next = next.next;
    }
  }

  updateParticle(particle: Particle, deltaSec: number): undefined {
    if (this.accel) {
      const oldSpeed = particle.config.rotSpeed;

      particle.config.rotSpeed += this.accel * deltaSec;
      particle.rotation +=
        ((particle.config.rotSpeed + oldSpeed) / 2) * deltaSec;
    } else {
      particle.rotation += particle.config.rotSpeed * deltaSec;
    }
  }
}

/**
 * Adds a random starting angle and nothing else.
 *
 * Cheaper than {@link RotationBehavior}: no `updateParticle`, so it costs
 * nothing per frame. Like the full behavior, the angle is **added** to the spawn
 * rotation rather than replacing it.
 *
 * @example
 * ```ts
 * { type: 'rotationStatic', config: { min: 0, max: 180 } }
 * ```
 */
export class StaticRotationBehavior implements IEmitterBehavior {
  public static type = 'rotationStatic' as const;

  public order = BehaviorOrder.Normal;
  private min: number;
  private max: number;

  /**
   * @param config.min - Lowest starting angle in degrees; `0` faces right, `90` up.
   * @param config.max - Highest starting angle in degrees.
   */
  constructor(config: {
    min: number;
    max: number;
  }) {
    this.min = config.min * DEG_TO_RADS;
    this.max = config.max * DEG_TO_RADS;
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;

    while (next) {
      if (this.min === this.max) {
        next.rotation += this.max;
      } else {
        next.rotation += Math.random() * (this.max - this.min) + this.min;
      }

      next = next.next;
    }
  }
}

/**
 * Pins every particle to one fixed angle, discarding any rotation a spawn shape
 * applied.
 *
 * This is the behavior to reach for when a spawn shape aims particles outward
 * but the artwork must stay upright. It runs one step past
 * {@link BehaviorOrder.Late} precisely so it overwrites, rather than is
 * overwritten by, the other rotation behaviors.
 *
 * @example
 * ```ts
 * { type: 'noRotation', config: { rotation: 0 } }
 * ```
 */
export class NoRotationBehavior implements IEmitterBehavior {
  public static type = 'noRotation' as const;

  public order = BehaviorOrder.Late + 1;

  private rotation: number;

  /** @param config.rotation - Locked angle in degrees; `0` (the default) faces right. */
  constructor(config: {
    rotation?: number;
  }) {
    this.rotation = (config.rotation || 0) * DEG_TO_RADS;
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;

    while (next) {
      next.rotation = this.rotation;

      next = next.next;
    }
  }
}
