import type { Texture } from 'pixi.js';
import type { Particle } from '../Particle.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';
import { GetTextureFromString } from '../ParticleUtils.js';

/**
 * Gives every particle the same texture.
 *
 * A string is resolved once at construction through
 * {@link ParticleUtils.GetTextureFromString}, so the per-particle path is a
 * plain assignment.
 *
 * @example
 * ```ts
 * { type: 'textureSingle', config: { texture: Texture.from('myTexId') } }
 * ```
 */
export class SingleTextureBehavior implements IEmitterBehavior {
  public static type = 'textureSingle' as const;

  public order = BehaviorOrder.Normal;
  private texture: Texture;

  /**
   * @param config.texture - The texture every particle gets, as an instance or
   * an asset alias to resolve.
   */
  constructor(config: {
    texture: Texture | string;
  }) {
    this.texture =
      typeof config.texture === 'string'
        ? GetTextureFromString(config.texture)
        : config.texture;
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;

    while (next) {
      next.texture = this.texture;

      next = next.next;
    }
  }
}
