import type { Particle } from '../Particle.js';
import { PropertyList } from '../PropertyList.js';
import { PropertyNode, type ValueList } from '../PropertyNode.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';

/**
 * Drives particle opacity along a keyframed list over the particle's lifetime.
 *
 * The list is interpolated (or stepped, when the config says so) against
 * `agePercent`, so a fade-in/fade-out is two keys and a peak rather than code.
 *
 * @example
 * ```ts
 * {
 *   type: 'alpha',
 *   config: {
 *     alpha: {
 *       list: [
 *         { value: 0, time: 0 },
 *         { value: 1, time: 0.25 },
 *         { value: 0, time: 1 },
 *       ],
 *     },
 *   },
 * }
 * ```
 */
export class AlphaBehavior implements IEmitterBehavior {
  public static type = 'alpha' as const;

  public order = BehaviorOrder.Normal;
  private list: PropertyList<number>;

  /**
   * @param config.alpha - Opacity keyframes, `0` (transparent) to `1` (opaque).
   */
  constructor(config: {
    alpha: ValueList<number>;
  }) {
    this.list = new PropertyList(false);
    this.list.reset(PropertyNode.createList(config.alpha));
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;

    while (next) {
      next.alpha = this.list.first!.value;
      next = next.next!;
    }
  }

  updateParticle(particle: Particle): undefined {
    particle.alpha = this.list.interpolate!(particle.agePercent);
  }
}

/**
 * Sets one fixed opacity at spawn and never touches it again.
 *
 * Cheaper than {@link AlphaBehavior}: no `updateParticle`, so it costs nothing
 * per frame. Use it whenever the opacity does not change over the life.
 *
 * @example
 * ```ts
 * { type: 'alphaStatic', config: { alpha: 0.75 } }
 * ```
 */
export class StaticAlphaBehavior implements IEmitterBehavior {
  public static type = 'alphaStatic' as const;

  public order = BehaviorOrder.Normal;
  private value: number;

  /** @param config.alpha - Opacity, `0` (transparent) to `1` (opaque). */
  constructor(config: {
    alpha: number;
  }) {
    this.value = config.alpha;
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;

    while (next) {
      next.alpha = this.value;
      next = next.next!;
    }
  }
}
