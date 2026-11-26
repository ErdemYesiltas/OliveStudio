import type { Particle } from '../Particle.js';
import { type IEmitterBehavior, BehaviorOrder } from './Behaviors.js';
import type { SpawnShape, SpawnShapeClass } from './shapes/SpawnShape.js';
import { PolygonalChain } from './shapes/PolygonalChain.js';
import { Rectangle } from './shapes/Rectangle.js';
import { Torus } from './shapes/Torus.js';

/**
 * Places (and where the shape has a direction, rotates) particles according to a
 * named spawn shape.
 *
 * The shape registry is open — {@link ShapeSpawnBehavior.registerShape} adds
 * one, so a game contributes its own geometry without forking the behavior.
 * {@link Rectangle}, {@link Torus} (also registered as `'circle'`) and
 * {@link PolygonalChain} ship registered.
 *
 * @example
 * ```ts
 * {
 *   type: 'spawnShape',
 *   config: {
 *     type: 'rect',
 *     data: { x: 0, y: 0, w: 20, h: 300 },
 *   },
 * }
 * ```
 */
export class ShapeSpawnBehavior implements IEmitterBehavior {
  public static type = 'spawnShape' as const;

  /** Registered shape classes, keyed by the name a config addresses them with. */
  private static shapes: { [key: string]: SpawnShapeClass } = Object.create(null);

  /**
   * Registers a shape so configs can name it.
   *
   * Registration is last-wins, which is also how a game overrides a shipped
   * shape — register your own class under the same key.
   *
   * @param shapeClass - The shape constructor, carrying a static `type`.
   * @param typeOverride - Register under this name instead of `shapeClass.type`;
   * the way one class serves several names (`Torus` is also `'circle'`).
   */
  public static registerShape(
    shapeClass: SpawnShapeClass,
    typeOverride?: string,
  ): undefined {
    ShapeSpawnBehavior.shapes[typeOverride || shapeClass.type] = shapeClass;
  }

  order = BehaviorOrder.Spawn;
  private shape: SpawnShape;

  /**
   * @param config.type - Registered shape name.
   * @param config.data - Config forwarded verbatim to that shape's constructor.
   * @throws {Error} When no shape is registered under `config.type` — a typo in
   * a JSON document fails at construction rather than silently spawning
   * everything at the origin.
   */
  constructor(config: {
    type: string;
    data: unknown;
  }) {
    const ShapeClass = ShapeSpawnBehavior.shapes[config.type];

    if (!ShapeClass) {
      throw new Error(`No shape found with type '${config.type}'`);
    }
    this.shape = new ShapeClass(config.data as never);
  }

  initParticles(first: Particle): undefined {
    let next: Particle | undefined = first;

    while (next) {
      this.shape.getRandPos(next);
      next = next.next;
    }
  }
}

ShapeSpawnBehavior.registerShape(PolygonalChain);
ShapeSpawnBehavior.registerShape(Rectangle);
ShapeSpawnBehavior.registerShape(Torus);
ShapeSpawnBehavior.registerShape(Torus, 'circle');
