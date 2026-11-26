import type { Particle } from '../../Particle.js';
import type { SpawnShape } from './SpawnShape.js';

/**
 * Spawns particles at a uniformly random point inside an axis-aligned rectangle.
 *
 * Width and height are clamped to at least `1`, so a zero-size rectangle
 * degenerates to a line or point rather than producing `NaN`.
 *
 * @example
 * ```ts
 * { type: 'rect', data: { x: 0, y: 0, w: 10, h: 100 } }
 * ```
 */
export class Rectangle implements SpawnShape {
  public static type = 'rect' as const;
  /** Left edge, in emitter-local coordinates. */
  public x: number;
  /** Top edge, in emitter-local coordinates. */
  public y: number;
  /** Width; clamped to a minimum of `1`. */
  public w: number;
  /** Height; clamped to a minimum of `1`. */
  public h: number;

  /**
   * @param config.x - Left edge, in emitter-local coordinates.
   * @param config.y - Top edge, in emitter-local coordinates.
   * @param config.w - Width; values below `1` are clamped up.
   * @param config.h - Height; values below `1` are clamped up.
   */
  constructor(config: {
    x: number;
    y: number;
    w: number;
    h: number;
  }) {
    this.x = config.x;
    this.y = config.y;
    this.w = Math.max(config.w, 1);
    this.h = Math.max(config.h, 1);
  }

  getRandPos(particle: Particle): void {
    particle.x = Math.random() * this.w + this.x;
    particle.y = Math.random() * this.h + this.y;
  }
}
