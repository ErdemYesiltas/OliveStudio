import type { Texture } from 'pixi.js';
import type { Particle } from '../Particle.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';
import { parseTextures } from '../ParticleUtils.js';

/**
 * Walks a texture list in order, one per particle, looping back to the first.
 *
 * The cursor is behavior state, not per-wave: it carries across spawns, so a
 * four-texture list cycles evenly however the waves are sized. Strings resolve
 * through {@link ParticleUtils.GetTextureFromString}.
 *
 * @example
 * ```ts
 * {
 *   type: 'textureOrdered',
 *   config: { textures: ['myTex1Id', 'myTex2Id', 'myTex3Id', 'myTex4Id'] },
 * }
 * ```
 */
export class OrderedTextureBehavior implements IEmitterBehavior {
  public static type = 'textureOrdered' as const;

  public order = BehaviorOrder.Normal;
  private textures: Texture[];
  private index: number;

  /** @param config.textures - Textures to cycle through, as instances or asset aliases. */
  constructor(config: {
    textures: (Texture | string)[];
  }) {
    this.index = 0;
    this.textures = parseTextures(config.textures);
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;

    while (next) {
      next.texture = this.textures[this.index];
      if (++this.index >= this.textures.length) {
        this.index = 0;
      }
      next = next.next;
    }
  }
}
