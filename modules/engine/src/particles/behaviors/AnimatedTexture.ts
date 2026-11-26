import { Texture } from 'pixi.js';
import type { Particle } from '../Particle.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';
import { parseTextures } from '../ParticleUtils.js';

/**
 * Normalises an authored framerate. A negative value means "stretch the animation across the
 * particle's lifetime"; zero means the config left it out, which falls back to 60fps.
 */
function resolveFramerate(framerate: number): number {
  if (framerate < 0) return -1;
  return framerate > 0 ? framerate : 60;
}


/** One authored animation a particle can play. */
export interface AnimatedParticleArt {
  /**
   * Frames per second. `-1` ties playback to the particle's lifetime instead, so
   * the animation always finishes exactly as the particle dies — useful when
   * life is randomised and the art must still land on its last frame.
   */
  framerate: -1 | number;
  /** Repeat when the animation ends. Defaults to `false`. */
  loop?: boolean;
  /**
   * Frames, as textures or asset aliases. An entry may instead be
   * `{ texture, count }` to hold one frame for several ticks without repeating
   * it in the list. Strings resolve through
   * {@link ParticleUtils.GetTextureFromString}.
   *
   * @example
   * ```ts
   * [{ texture: 'myFirstTex', count: 5 }, 'mySecondTex']
   * ```
   */
  textures: (string | Texture | { texture: string | Texture; count: number })[];
}

/** An {@link AnimatedParticleArt} after texture resolution and duration maths. */
export interface ParsedAnimatedParticleArt {
  /** Flattened frame list, with `count` entries already expanded. */
  textures: Texture[];
  /** Total run time in seconds; `0` when the framerate is lifetime-bound. */
  duration: number;
  /** Resolved framerate, or `-1` for lifetime-bound playback. */
  framerate: number;
  /** Whether playback loops. Forced `false` for lifetime-bound playback. */
  loop: boolean;
}

/**
 * Resolves an authored frame list into a flat texture array, expanding
 * `{ texture, count }` entries into repeated frames.
 *
 * @param textures - Frames as textures, asset aliases, or repeat descriptors.
 * @returns One texture per frame of playback.
 */
export function getAnimatedTextures(
  textures: (string | Texture | { texture: string | Texture; count: number })[],
): Texture[] {
  const textureList = textures.map((texture) => {
    if (typeof texture === 'string' || texture instanceof Texture) {
      return texture;
    }
    return texture.texture;
  });
  const parsedTextures = parseTextures(textureList);

  const outTextures: Texture[] = [];

  for (let j = 0; j < textures.length; ++j) {
    const config = textures[j];
    const texture = parsedTextures[j];

    if (typeof config === 'string' || config instanceof Texture) {
      outTextures.push(texture);
    } else {
      for (let dupe = config.count || 1; dupe > 0; --dupe) {
        outTextures.push(texture);
      }
    }
  }

  return outTextures;
}

/**
 * Gives each particle one animation picked at random from a list, and plays it.
 *
 * Every animation is resolved once at construction, so the per-particle cost is
 * an index and the per-frame cost is a frame lookup. See
 * {@link AnimatedParticleArt} for what an entry may contain.
 *
 * @example
 * ```ts
 * {
 *   type: 'animatedRandom',
 *   config: {
 *     anims: [
 *       { framerate: 25, loop: true, textures: ['frame1', 'frame2', 'frame3'] },
 *       { framerate: 25, loop: true, textures: ['frame3', 'frame2', 'frame1'] },
 *     ],
 *   },
 * }
 * ```
 */
export class RandomAnimatedTextureBehavior implements IEmitterBehavior {
  public static type = 'animatedRandom' as const;

  public order = BehaviorOrder.Normal;
  private anims: ParsedAnimatedParticleArt[];

  /**
   * @param config.anims - The pool of animations; each particle draws one at spawn.
   * A framerate of `0` is treated as `60`, and a negative one as lifetime-bound.
   */
  constructor(config: {
    anims: AnimatedParticleArt[];
  }) {
    this.anims = [];
    for (let i = 0; i < config.anims.length; ++i) {
      const anim = config.anims[i];
      const textures = getAnimatedTextures(anim.textures);

      const framerate = resolveFramerate(anim.framerate);
      const parsedAnim: ParsedAnimatedParticleArt = {
        textures,
        duration: framerate > 0 ? textures.length / framerate : 0,
        framerate,
        loop: framerate > 0 ? !!anim.loop : false,
      };

      this.anims.push(parsedAnim);
    }
  }

  initParticles(first: Particle): void {
    let next: Particle | undefined = first;

    while (next) {
      const index = Math.floor(Math.random() * this.anims.length);
      const anim = (next.config.anim = this.anims[index]);

      next.texture = anim.textures[0];
      next.config.animElapsed = 0;

      if (anim.framerate === -1) {
        next.config.animDuration = next.maxLife;
        next.config.animFramerate = anim.textures.length / next.maxLife;
      } else {
        next.config.animDuration = anim.duration;
        next.config.animFramerate = anim.framerate;
      }

      next = next.next;
    }
  }

  /**
   * Advances the particle's own animation clock and picks the matching frame.
   *
   * Two guards against floating-point drift: a non-looping animation is parked
   * a hair short of its duration rather than exactly on it, and the frame index
   * is nudged up by an epsilon before truncation so a frame boundary does not
   * land one frame early. The final `||` chain is the last resort if the maths
   * still overruns the list.
   */
  updateParticle(particle: Particle, deltaSec: number): undefined {
    const config = particle.config;
    const anim = config.anim;

    config.animElapsed += deltaSec;
    if (config.animElapsed >= config.animDuration) {
      if (config.anim.loop) {
        config.animElapsed %= config.animDuration;
      } else {
        config.animElapsed = config.animDuration - 0.000001;
      }
    }

    const frame = (config.animElapsed * config.animFramerate + 0.0000001) | 0;

    particle.texture =
      anim.textures[frame] ||
      anim.textures[anim.textures.length - 1] ||
      Texture.EMPTY;
  }
}

/**
 * Plays one shared animation on every particle.
 *
 * The single-animation counterpart to {@link RandomAnimatedTextureBehavior};
 * see {@link AnimatedParticleArt} for the config shape.
 *
 * @example
 * ```ts
 * {
 *   type: 'animatedSingle',
 *   config: {
 *     anim: { framerate: 25, loop: true, textures: ['frame1', 'frame2', 'frame3'] },
 *   },
 * }
 * ```
 */
export class SingleAnimatedTextureBehavior implements IEmitterBehavior {
  public static type = 'animatedSingle' as const;

  public order = BehaviorOrder.Normal;
  private anim: ParsedAnimatedParticleArt;

  /**
   * @param config.anim - The animation every particle plays. A framerate of `0`
   * is treated as `60`, and a negative one as lifetime-bound.
   */
  constructor(config: {
    anim: AnimatedParticleArt;
  }) {
    const anim = config.anim;
    const textures = getAnimatedTextures(anim.textures);

    const framerate = resolveFramerate(anim.framerate);

    this.anim = {
      textures,
      duration: framerate > 0 ? textures.length / framerate : 0,
      framerate,
      loop: framerate > 0 ? !!anim.loop : false,
    };
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;
    const anim = this.anim;

    while (next) {
      next.texture = anim.textures[0];
      next.config.animElapsed = 0;

      if (anim.framerate === -1) {
        next.config.animDuration = next.maxLife;
        next.config.animFramerate = anim.textures.length / next.maxLife;
      } else {
        next.config.animDuration = anim.duration;
        next.config.animFramerate = anim.framerate;
      }

      next = next.next;
    }
  }

  /**
   * Advances the particle's own animation clock and picks the matching frame.
   *
   * Carries the same floating-point guards as
   * {@link RandomAnimatedTextureBehavior.updateParticle}: a non-looping
   * animation parks just short of its duration, and the frame index is nudged
   * up by an epsilon before truncation.
   */
  updateParticle(particle: Particle, deltaSec: number): undefined {
    const anim = this.anim;
    const config = particle.config;

    config.animElapsed += deltaSec;
    if (config.animElapsed >= config.animDuration) {
      if (anim.loop) {
        config.animElapsed %= config.animDuration;
      } else {
        config.animElapsed = config.animDuration - 0.000001;
      }
    }

    const frame = (config.animElapsed * config.animFramerate + 0.0000001) | 0;

    particle.texture =
      anim.textures[frame] ||
      anim.textures[anim.textures.length - 1] ||
      anim.textures[0];
  }
}
