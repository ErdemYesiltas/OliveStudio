import { Particle as PixiParticle, type ParticleContainer } from 'pixi.js';
import type { Emitter } from './Emitter.js';

/**
 * One particle instance, extending Pixi's `Particle` with the lifetime and
 * list-membership fields the emitter and behaviors read.
 *
 * Particles are **pooled and recycled**, never freshly allocated per spawn, and
 * they are held in a doubly linked list rather than an array — hence `next` /
 * `prev`. Application code rarely touches this class directly; behaviors do.
 */
export class Particle extends PixiParticle {
  /** The emitter that owns and recycles this particle. */
  public emitter: Emitter;
  /** Total lifetime in seconds, set at {@link Particle.init}. */
  public maxLife: number;
  /** Elapsed lifetime in seconds. */
  public age: number;
  /** Elapsed lifetime as `0`–`1`; what keyframed behaviors interpolate against. */
  public agePercent: number;
  /** `1 / maxLife`, cached so the per-frame age update is a multiply, not a divide. */
  public oneOverLife: number;
  /** Next particle in the emitter's linked list. */
  public next?: Particle;
  /** Previous particle in the emitter's linked list. */
  public prev?: Particle;
  /**
   * Scratch space for behaviors to keep per-particle state (a velocity vector, a
   * scale multiplier).
   *
   * Deliberately **not** cleared on recycle: a behavior can reuse the object it
   * allocated last time instead of making a new one every spawn. The flip side
   * is that a behavior must overwrite what it reads rather than assume it is
   * unset.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Public scratchpad for custom behaviors.
  public config: { [key: string]: any };

  public parent?: ParticleContainer;

  /**
   * @param emitter - The emitter that will own this particle. Its first
   * configured texture seeds the sprite; the real one is assigned by a texture
   * behavior at spawn.
   */
  constructor(emitter: Emitter) {
    super(emitter.particleImages[0]);

    this.emitter = emitter;
    this.config = {};
    this.anchorX = this.anchorY = 0.5;
    this.maxLife = 0;
    this.age = 0;
    this.agePercent = 0;
    this.oneOverLife = 0;
  }

  /**
   * Resets the particle for a new life, clearing the transform, tint and alpha
   * that the previous use left behind.
   *
   * Behaviors run after this, so anything they set at spawn survives.
   *
   * @param maxLife - Lifetime in seconds.
   */
  public init(maxLife: number): void {
    this.maxLife = maxLife;
    this.age = this.agePercent = 0;
    this.rotation = 0;
    this.x = this.y = 0;
    this.scaleX = this.scaleY = 1;
    this.tint = 0xffffff;
    this.alpha = 1;
    this.oneOverLife = 1 / this.maxLife;
  }

  /**
   * Moves the particle into `parent`, detaching it from its current container first.
   */
  public appendTo(parent: ParticleContainer): void {
    this.parent?.removeParticle(this);
    this.parent = parent;
    parent.addParticle(this);
  }

  /**
   * Moves the particle into `parent` at a specific index, detaching it from its
   * current container first. Index decides draw order within the container.
   */
  public appendAt(parent: ParticleContainer, index: number): void {
    this.parent?.removeParticle(this);
    this.parent = parent;
    parent.addParticleAt(this, index);
  }

  /** Detaches the particle from its container and blanks its alpha. */
  public removeFromParent(): void {
    this.alpha = 0;
    this.parent?.removeParticle(this);
    this.parent = undefined;
  }

  /**
   * Ends this particle's life and hands it back to the emitter's pool.
   *
   * The particle stays allocated — this is a return to the pool, not a free.
   */
  public kill(): void {
    this.emitter.recycle(this);
  }

  /**
   * Permanently tears the particle down: detaches it, unlinks it from its
   * neighbours, and drops its references.
   *
   * Unlike {@link Particle.kill} this is not reversible; the instance must not
   * be used afterwards.
   */
  public destroy(): void {
    this.removeFromParent();
    if (this.next && this.prev) {
      this.next.prev = this.prev;
      this.prev.next = this.next;
    }
    // @ts-expect-error destroy should be safe to do cleanup
    this.emitter = this.next = this.prev = null;
  }
}
