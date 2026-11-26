import {
  generateEase,
  hexToRGB,
  type EaseSegment,
  type SimpleEase,
  type Color,
} from './ParticleUtils.js';
import type { BasicTweenable } from './EmitterConfig.js';

/** One keyframe of a {@link ValueList}. */
export interface ValueStep<T> {
  /** The colour or number held at this step. */
  value: T;
  /** When it applies, as a fraction of the particle's lifetime (`0`–`1`). */
  time: number;
}

/**
 * A keyframed list of numeric or colour values, evaluated against a particle's
 * normalised age.
 */
export interface ValueList<T> {
  /** Keyframes in ascending `time` order. */
  list: ValueStep<T>[];
  /**
   * Hold each value until the next keyframe instead of blending between them.
   * A stepped list of three colours flashes; an interpolated one sweeps.
   */
  isStepped?: boolean;
  /**
   * Easing applied to the progress value before lookup, so the steps advance
   * non-linearly without moving the keyframes.
   */
  ease?: SimpleEase | EaseSegment[];
}

/**
 * One node of the singly linked list a {@link PropertyList} walks.
 *
 * A linked list rather than an array because interpolation only ever needs the
 * current node and its successor — the per-frame path never indexes.
 */
export class PropertyNode<V> {
  /** The value at this keyframe. */
  public value: V;
  /** Normalised time of this keyframe, `0`–`1`. */
  public time: number;
  /** Next keyframe, or `undefined` at the end of the list. */
  public next: PropertyNode<V> | undefined;
  /**
   * Whether the whole list is stepped rather than interpolated.
   *
   * Only meaningful on the **first** node — {@link PropertyList.reset} reads it
   * there to pick the interpolation function once.
   */
  public isStepped: boolean;
  /** Easing for the whole list; only meaningful on the first node. */
  public ease: SimpleEase | undefined;

  /**
   * @param value - Value at this keyframe.
   * @param time - Normalised time, `0`–`1`.
   * @param ease - Easing for the list. Only read from the first node; an array
   * of segments is compiled to a function by {@link ParticleUtils.generateEase}.
   */
  constructor(value: V, time: number, ease?: SimpleEase | EaseSegment[]) {
    this.value = value;
    this.time = time;
    this.next = undefined;
    this.isStepped = false;
    if (ease) {
      this.ease = typeof ease === 'function' ? ease : generateEase(ease);
    } else {
      this.ease = undefined;
    }
  }

  /**
   * Builds a linked keyframe list from config and returns its head.
   *
   * Accepts both the current `{ list, isStepped, ease }` shape and the legacy
   * `{ start, end }` pair, which is expanded to two keyframes at times `0` and
   * `1`. String values are parsed to `{ r, g, b }` by
   * {@link ParticleUtils.hexToRGB}, which is how a colour list and a numeric
   * list share one implementation.
   *
   * A list whose values never change is collapsed to a single node, so the
   * interpolator can take its cheapest path.
   *
   * @param data - Keyframe config, current or legacy form.
   * @returns The first node of the list.
   */
  public static createList<T extends string | number>(
    data: ValueList<T> | BasicTweenable<T>,
  ): PropertyNode<T extends string ? Color : T> {
    if ('list' in data) {
      const array = data.list;
      let node: PropertyNode<T | Color>;
      const { value, time } = array[0];

      const first = (node = new PropertyNode(
        typeof value === 'string' ? hexToRGB(value) : value,
        time,
        data.ease,
      ));

      if (
        array.length > 2 ||
        (array.length === 2 && array[1].value !== value)
      ) {
        for (let i = 1; i < array.length; ++i) {
          const { value, time } = array[i];

          node.next = new PropertyNode(
            typeof value === 'string' ? hexToRGB(value) : value,
            time,
          );
          node = node.next;
        }
      }
      first.isStepped = !!data.isStepped;

      return first as PropertyNode<T extends string ? Color : T>;
    }

    const start = new PropertyNode(
      typeof data.start === 'string' ? hexToRGB(data.start) : data.start,
      0,
    );

    if (data.end !== data.start) {
      start.next = new PropertyNode(
        typeof data.end === 'string' ? hexToRGB(data.end) : data.end,
        1,
      );
    }

    return start as PropertyNode<T extends string ? Color : T>;
  }
}
