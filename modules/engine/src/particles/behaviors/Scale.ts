import type { Particle } from '../Particle.js';
import { PropertyList } from '../PropertyList.js';
import { PropertyNode, type ValueList } from '../PropertyNode.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';

/**
 * Drives uniform particle scale along a keyframed list over the particle's lifetime.
 *
 * `minMult` adds per-particle variety without a second keyframe list: each
 * particle draws one multiplier between `minMult` and `1` at spawn and keeps it
 * for its whole life, so a wave grows and shrinks together but at different sizes.
 *
 * @example
 * ```ts
 * {
 *   type: 'scale',
 *   config: {
 *     scale: {
 *       list: [
 *         { value: 0, time: 0 },
 *         { value: 1, time: 0.25 },
 *         { value: 0, time: 1 },
 *       ],
 *       isStepped: true,
 *     },
 *     minMult: 0.5,
 *   },
 * }
 * ```
 */
export class ScaleBehavior implements IEmitterBehavior {
  public static type = 'scale' as const;

  public order = BehaviorOrder.Normal;
  private list: PropertyList<number>;
  private minMult: number;

  /**
   * @param config.scale - Scale keyframes; values below `0` make no sense.
   * @param config.minMult - Lower bound of the per-particle multiplier, drawn
   * once between this and `1`. Defaults to `1` (no variation).
   */
  constructor(config: {
    scale: ValueList<number>;
    minMult: number;
  }) {
    this.list = new PropertyList(false);
    this.list.reset(PropertyNode.createList(config.scale));
    this.minMult = config.minMult ?? 1;
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;

    while (next) {
      const mult = Math.random() * (1 - this.minMult) + this.minMult;

      next.config.scaleMult = mult;
      next.scaleX = next.scaleY = this.list.first!.value * mult;

      next = next.next;
    }
  }

  updateParticle(particle: Particle): undefined {
    particle.scaleX = particle.scaleY =
      this.list.interpolate!(particle.agePercent) * particle.config.scaleMult;
  }
}

/**
 * Picks one random scale per particle at spawn and leaves it there.
 *
 * Cheaper than {@link ScaleBehavior}: no `updateParticle`, so it costs nothing
 * per frame. Use it when size varies between particles but not over a life.
 *
 * @example
 * ```ts
 * { type: 'scaleStatic', config: { min: 0.25, max: 0.75 } }
 * ```
 */
export class StaticScaleBehavior implements IEmitterBehavior {
  public static type = 'scaleStatic' as const;

  public order = BehaviorOrder.Normal;
  private min: number;
  private max: number;

  /**
   * @param config.min - Smallest scale, at least `0`.
   * @param config.max - Largest scale, at least `0`.
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
      const scale = Math.random() * (this.max - this.min) + this.min;

      next.scaleX = next.scaleY = scale;

      next = next.next;
    }
  }
}
