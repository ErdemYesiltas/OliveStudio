import type { Particle } from '../Particle.js';

/**
 * The contract every behavior instance implements; its class must match
 * {@link IEmitterBehaviorClass}.
 *
 * A behavior is one isolated concern applied to particles — spawn position,
 * colour ramp, movement, texture. `order` and `initParticles` are required;
 * `updateParticle` and `recycleParticle` are opt-in, so a spawn-only behavior
 * costs nothing per frame.
 */
export interface IEmitterBehavior {
  /**
   * When this behavior runs relative to the others. Lower runs earlier, and
   * `0` ({@link BehaviorOrder.Spawn}) is special: it runs *before* the emitter's
   * own transform is applied. Everything else is sorted numerically.
   */
  order: number;
  /**
   * Initialises a freshly spawned wave of particles.
   *
   * Particles arrive as a linked list; walk it with `particle.next` rather than
   * expecting an array — the emitter never allocates one.
   *
   * @param first - The first (and possibly only) particle of the new wave.
   */
  initParticles(first: Particle): void;
  /**
   * Advances one particle by `deltaSec`.
   *
   * @param particle - The particle to update.
   * @param deltaSec - Elapsed time in seconds.
   * @returns `true` to recycle the particle immediately; anything else keeps it alive.
   */
  updateParticle?(particle: Particle, deltaSec: number): undefined | boolean;
  /**
   * Called as a particle is recycled, for behaviors holding per-particle state.
   *
   * @param particle - The particle being recycled.
   * @param natural - `true` when the particle reached the end of its life,
   * `false` when the emitter is being cleaned up.
   */
  recycleParticle?(particle: Particle, natural: boolean): void;
}

/**
 * The static side of a behavior — what `Emitter.registerBehavior` needs to look
 * one up by name and build it from a JSON config block.
 */
export interface IEmitterBehaviorClass {
  /** Unique discriminator the behavior is registered and addressed by. */
  type: string;
  /**
   * Constructs the behavior from its own config block.
   *
   * @param config - Behavior-specific configuration. Untyped here because the
   * registry is open; {@link BehaviorConfigs} recovers the pairing for authors.
   */
  new (config: never): IEmitterBehavior;
}

/**
 * Conventional {@link IEmitterBehavior.order} values.
 *
 * Any number works — these are the three positions that mean something. Only
 * `Spawn` is handled specially; the rest are a plain numeric sort, and behaviors
 * sharing a value are assumed not to interfere with each other, so their
 * relative order is unspecified.
 */
export enum BehaviorOrder {
  /**
   * Initial placement and rotation. Runs **before** the emitter's own
   * rotation/translation, so a spawn shape works in local space.
   */
  Spawn = 0,
  /** Anything whose timing does not matter. */
  Normal = 2,
  /** Runs last, for behaviors that must read values other behaviors wrote. */
  Late = 5,
}
