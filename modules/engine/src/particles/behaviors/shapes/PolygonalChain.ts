import type { PointData } from 'pixi.js';
import type { SpawnShape } from './SpawnShape.js';

/** One line segment of a {@link PolygonalChain}, with its length cached. */
export interface Segment {
  /** Start point. */
  p1: PointData;
  /** End point. */
  p2: PointData;
  /** Segment length, precomputed for the weighted pick. */
  l: number;
}

/**
 * Spawns particles at a random point along a chain of line segments.
 *
 * Close the chain and particles land on a polygon's perimeter rather than its
 * interior. Segments are weighted by length, so a long edge receives
 * proportionally more particles than a short one — without that, a chain of
 * uneven segments would bunch up on the short ones.
 *
 * @example
 * ```ts
 * {
 *   type: 'polygonalChain',
 *   data: [
 *     [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }],
 *     [{ x: 0, y: -10 }, { x: 10, y: 0 }, { x: 20, y: -10 }],
 *   ],
 * }
 * ```
 */
export class PolygonalChain implements SpawnShape {
  public static type = 'polygonalChain' as const;
  /** Flattened segment list; every chain contributes its own segments here. */
  private segments: Segment[];
  /** Sum of all segment lengths — the range the random pick is drawn from. */
  private totalLength: number;
  /**
   * Running total of segment lengths, so the weighted pick is a scan for the
   * first entry above a random number rather than a per-segment probability.
   */
  private countingLengths: number[];

  /**
   * @param data - Either one chain (a flat list of points) or several (a list of
   * point lists). An empty or missing value degenerates to a zero-length
   * segment at the origin rather than throwing.
   */
  constructor(data: PointData[] | PointData[][]) {
    this.segments = [];
    this.countingLengths = [];
    this.totalLength = 0;
    this.init(data);
  }

  /**
   * Flattens the input into segments and precomputes the length tables.
   *
   * @param data - One chain or a list of chains.
   */
  private init(data: PointData[] | PointData[][]): undefined {
    if (!data || !data.length) {
      this.segments.push({ p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, l: 0 });
    } else if (Array.isArray(data[0])) {
      for (let i = 0; i < data.length; ++i) {
        const chain = data[i] as PointData[];
        let prevPoint = chain[0] as PointData;

        for (let j = 1; j < chain.length; ++j) {
          const second = chain[j] as PointData;

          this.segments.push({ p1: prevPoint, p2: second, l: 0 });
          prevPoint = second;
        }
      }
    } else {
      let prevPoint = data[0] as PointData;

      for (let i = 1; i < data.length; ++i) {
        const second = data[i] as PointData;

        this.segments.push({ p1: prevPoint, p2: second, l: 0 });
        prevPoint = second;
      }
    }

    for (let i = 0; i < this.segments.length; ++i) {
      const { p1, p2 } = this.segments[i];
      const segLength = Math.sqrt(
        (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y),
      );

      this.segments[i].l = segLength;
      this.totalLength += segLength;
      this.countingLengths.push(this.totalLength);
    }
  }

  /**
   * Writes a length-weighted random point on the chain into `out`.
   *
   * @param out - Target to write `x`/`y` into; mutated in place.
   */
  public getRandPos(out: PointData): undefined {
    const rand = Math.random() * this.totalLength;
    let chosenSeg!: Segment;
    let lerp = 0;

    if (this.segments.length === 1) {
      chosenSeg = this.segments[0];
      lerp = rand;
    } else {
      for (let i = 0; i < this.countingLengths.length; ++i) {
        if (rand < this.countingLengths[i]) {
          chosenSeg = this.segments[i];
          lerp = i === 0 ? rand : rand - this.countingLengths[i - 1];
          break;
        }
      }
    }

    lerp /= chosenSeg.l || 1;
    const { p1, p2 } = chosenSeg;

    out.x = p1.x + lerp * (p2.x - p1.x);
    out.y = p1.y + lerp * (p2.y - p1.y);
  }
}
