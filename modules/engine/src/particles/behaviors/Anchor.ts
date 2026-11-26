import type { Particle } from '../Particle.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';

/**
 * Sets a fixed anchor point on every particle at spawn.
 *
 * The anchor decides which point of the texture sits on the particle's position
 * — `0.5, 0.5` centres it, the Pixi default of `0, 0` hangs it from the top-left.
 *
 * @example
 * ```ts
 * { type: 'anchorStatic', config: { x: 0.5, y: 0.5 } }
 * ```
 */
export class StaticAnchorBehavior implements IEmitterBehavior {
  public static type = 'anchorStatic' as const;

  public order = BehaviorOrder.Normal;
  private x: number;
  private y: number;

  /**
   * @param config.x - Horizontal anchor, normally `0`–`1`.
   * @param config.y - Vertical anchor, normally `0`–`1`.
   */
  constructor(config: {
    x: number;
    y: number;
  }) {
    this.x = config.x;
    this.y = config.y;
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;

    while (next) {
      next.anchorX = this.x;
      next.anchorY = this.y;

      next = next.next;
    }
  }
}
