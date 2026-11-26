import type { Particle } from '../../Particle.js';
import { rotatePoint } from '../../ParticleUtils.js';
import type { SpawnShape } from './SpawnShape.js';

/**
 * Spawns particles in a filled circle or a ring, optionally aiming them outward.
 *
 * `innerRadius` is what makes it a ring: leave it at `0` and the shape fills;
 * set it and particles land only in the band between the two radii. With
 * `affectRotation` on, each particle's rotation is offset by its own angle, so a
 * directional texture points away from the centre.
 *
 * Registered under both `'torus'` and `'circle'`.
 *
 * The radius is picked uniformly between the two bounds rather than by area, so
 * a filled circle is denser toward the centre. That is the historical behaviour
 * and reads well for most effects; use a thin ring when even coverage matters.
 *
 * @example
 * ```ts
 * {
 *   type: 'torus',
 *   data: { radius: 30, x: 0, y: 0, innerRadius: 10, rotation: true },
 * }
 * ```
 */
export class Torus implements SpawnShape {
  public static type = 'torus' as const;
  /** Centre X, in emitter-local coordinates. */
  public x: number;
  /** Centre Y, in emitter-local coordinates. */
  public y: number;
  /** Circle radius, or the outer radius of a ring; clamped to a minimum of `1`. */
  public radius: number;
  /** Inner radius of a ring; `0` fills the circle. */
  public innerRadius: number;
  /** Whether each particle's rotation is offset to point away from the centre. */
  public rotation: boolean;

  /**
   * @param config.radius - Circle radius, or the ring's outer radius. Spelled in
   * full — older config revisions called this `r`.
   * @param config.x - Centre X. Defaults to `0`.
   * @param config.y - Centre Y. Defaults to `0`.
   * @param config.innerRadius - Ring inner radius; omit or `0` for a filled circle.
   * @param config.affectRotation - Point particles away from the centre. Defaults to `false`.
   */
  constructor(config: {
    radius: number;
    x: number;
    y: number;
    innerRadius?: number;
    affectRotation?: boolean;
  }) {
    this.x = config.x || 0;
    this.y = config.y || 0;
    this.radius = Math.max(config.radius, 1);
    this.innerRadius = config.innerRadius || 0;
    this.rotation = !!config.affectRotation;
  }

  getRandPos(particle: Particle): void {
    if (this.innerRadius !== this.radius) {
      particle.x =
        Math.random() * (this.radius - this.innerRadius) + this.innerRadius;
    } else {
      particle.x = this.radius;
    }
    particle.y = 0;

    const angle = Math.random() * Math.PI * 2;

    if (this.rotation) {
      particle.rotation += angle;
    }
    rotatePoint(angle, particle);

    particle.x += this.x;
    particle.y += this.y;
  }
}
