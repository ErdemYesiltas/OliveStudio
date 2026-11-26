import { Color as PixiColor } from 'pixi.js';
import type { Particle } from '../Particle.js';
import type { Color } from '../ParticleUtils.js';
import { PropertyList } from '../PropertyList.js';
import { PropertyNode, type ValueList } from '../PropertyNode.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';

/**
 * Drives particle tint along a keyframed colour list over the particle's lifetime.
 *
 * Interpolation happens per channel, so a red→green→blue list sweeps rather than
 * cutting. Values are written through `PixiColor.shared`, which is a singleton —
 * the tint is consumed immediately by the assignment and must not be held.
 *
 * @example
 * ```ts
 * {
 *   type: 'color',
 *   config: {
 *     color: {
 *       list: [
 *         { value: '#ff0000', time: 0 },
 *         { value: '#00ff00', time: 0.5 },
 *         { value: '#0000ff', time: 1 },
 *       ],
 *     },
 *   },
 * }
 * ```
 */
export class ColorBehavior implements IEmitterBehavior {
  public static type = 'color' as const;

  public order = BehaviorOrder.Normal;
  private list: PropertyList<Color>;

  /** @param config.color - Colour keyframes as 6-digit hex codes. */
  constructor(config: {
    color: ValueList<string>;
  }) {
    this.list = new PropertyList(true);
    this.list.reset(PropertyNode.createList(config.color));
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;
    const color = this.list.first!.value;

    while (next) {
      next.tint = PixiColor.shared.setValue(color);
      next = next.next;
    }
  }

  updateParticle(particle: Particle): undefined {
    const color = this.list.interpolate!(particle.agePercent);
    particle.tint = PixiColor.shared.setValue(color);
  }
}

/**
 * Sets one fixed tint at spawn and never touches it again.
 *
 * Cheaper than {@link ColorBehavior}: the colour is parsed once at construction
 * and there is no `updateParticle`, so it costs nothing per frame.
 *
 * @example
 * ```ts
 * { type: 'colorStatic', config: { color: '#ffff00' } }
 * ```
 */
export class StaticColorBehavior implements IEmitterBehavior {
  public static type = 'colorStatic' as const;

  public order = BehaviorOrder.Normal;
  private value: PixiColor;

  /** @param config.color - Colour as a 6-digit hex code. */
  constructor(config: {
    color: string;
  }) {
    const color = new PixiColor(config.color);

    this.value = color;
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;

    while (next) {
      next.tint = this.value;
      next = next.next;
    }
  }
}
