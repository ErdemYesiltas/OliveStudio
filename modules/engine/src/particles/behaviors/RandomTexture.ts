import type { Texture } from 'pixi.js';
import type { Particle } from '../Particle.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';
import { parseTextures } from '../ParticleUtils.js';

/**
 * Gives each particle a texture picked at random from a list.
 *
 * Strings are resolved through {@link ParticleUtils.GetTextureFromString}.
 * Keep every entry on one source: particles batch by texture source, so mixing
 * sheets here costs a draw call per switch.
 *
 * @example
 * ```ts
 * {
 *   type: 'textureRandom',
 *   config: { textures: ['myTex1Id', 'myTex2Id', 'myTex3Id', 'myTex4Id'] },
 * }
 * ```
 */
export class RandomTextureBehavior implements IEmitterBehavior {
  public static type = 'textureRandom' as const;

  public order = BehaviorOrder.Normal;
  private textures: Texture[];

  /**
   * @param config.textures - The pool to draw from, as instances or asset
   * aliases. A single value is accepted and treated as a one-entry pool.
   */
  constructor(config: {
    textures: Texture[] | string[] | string | Texture;
  }) {
    this.textures = parseTextures(config.textures);
  }

  initParticles(first: Particle): void {
    let next: Particle | undefined = first;

    while (next) {
      const index = Math.floor(Math.random() * this.textures.length);

      next.texture = this.textures[index];

      next = next.next;
    }
  }
}
