import type { Particle } from '../../Particle.js';

/**
 * A shape that can produce a random spawn position for `ShapeSpawnBehavior`.
 *
 * Implementations are registered on the behavior by `type` and instantiated from
 * the matching config block, so a game can add its own shape without touching
 * the emitter.
 */
export interface SpawnShape {
  /**
   * Assigns a random position inside the shape to `particle`.
   *
   * Rotation may be set as well when the shape has a direction (a chain segment,
   * a torus arc). Writing any other particle property here is out of contract —
   * spawn position is the whole job.
   *
   * @param particle - The particle being spawned; mutated in place.
   */
  getRandPos(particle: Particle): void;
}

/**
 * The static side of a {@link SpawnShape} — what `ShapeSpawnBehavior` needs to
 * look a shape up by name and construct it from JSON.
 */
export interface SpawnShapeClass {
  /** Discriminator the shape is registered and addressed by (`'rect'`, `'torus'`, …). */
  type: string;
  /**
   * Constructs the shape from its own config block.
   *
   * @param config - Shape-specific configuration, matching whatever the concrete
   * shape declares. Untyped here because the registry is open.
   */
  new (config: never): SpawnShape;
}
