import type { SimpleEase, Color } from './ParticleUtils.js';
import type { PropertyNode } from './PropertyNode.js';

/**
 * Two-node numeric interpolation — the fast path when a list has exactly one
 * segment, so no scan for the active keyframe is needed.
 */
function intValueSimple(this: PropertyList<number>, lerp: number): number {
  if (this.ease) lerp = this.ease(lerp);

  // @ts-expect-error event this.first is undefinedable, but the doubled linked list was ensure it's a cycle
  return (this.first.next.value - this.first.value) * lerp + this.first.value;
}

/** Two-node colour interpolation; the {@link intValueSimple} fast path per channel. */
function intColorSimple(this: PropertyList<Color>, lerp: number): Color {
  if (this.ease) lerp = this.ease(lerp);

  // @ts-expect-error doubled linked list cycle
  const curVal = this.first.value;
  // @ts-expect-error doubled linked list cycle
  const nextVal = this.first.next.value;
  const r = (nextVal.r - curVal.r) * lerp + curVal.r;
  const g = (nextVal.g - curVal.g) * lerp + curVal.g;
  const b = (nextVal.b - curVal.b) * lerp + curVal.b;

  return { r, g, b };
}

/**
 * Multi-segment numeric interpolation: walks to the segment containing `lerp`,
 * then rescales `lerp` into that segment's own `0`–`1` range.
 */
function intValueComplex(this: PropertyList<number>, lerp: number): number {
  if (this.ease) lerp = this.ease(lerp);

  let current = this.first!;
  let next = current.next!;

  while (lerp > next.time) {
    current = next;
    next = next.next!;
  }

  lerp = (lerp - current.time) / (next.time - current.time);

  return (next.value - current.value) * lerp + current.value;
}

/** Multi-segment colour interpolation; {@link intValueComplex} per channel. */
function intColorComplex(this: PropertyList<Color>, lerp: number): Color {
  if (this.ease) lerp = this.ease(lerp);

  let current = this.first!;
  let next = current.next!;

  while (lerp > next.time) {
    current = next;
    next = next.next!;
  }

  lerp = (lerp - current.time) / (next.time - current.time);
  const curVal = current.value;
  const nextVal = next.value;
  const r = (nextVal.r - curVal.r) * lerp + curVal.r;
  const g = (nextVal.g - curVal.g) * lerp + curVal.g;
  const b = (nextVal.b - curVal.b) * lerp + curVal.b;

  return { r, g, b };
}

/** Stepped numeric lookup: holds the current keyframe's value until the next one is due. */
function intValueStepped(this: PropertyList<number>, lerp: number): number {
  if (this.ease) lerp = this.ease(lerp);

  let current = this.first!;

  while (current.next && lerp > current.next.time) {
    current = current.next;
  }

  return current.value;
}

/** Stepped colour lookup; {@link intValueStepped} for colours. */
function intColorStepped(this: PropertyList<Color>, lerp: number): Color {
  if (this.ease) lerp = this.ease(lerp);

  let current = this.first!;

  while (current.next && lerp > current.next.time) {
    current = current.next;
  }
  const curVal = current.value;

  return curVal;
}

/**
 * Evaluates one keyframed property against a particle's normalised age.
 *
 * The interpolation function is chosen **once** in {@link PropertyList.reset}
 * from the shape of the list — two nodes, stepped, or multi-segment — and stored
 * on the instance. That keeps the per-particle, per-frame call a direct
 * invocation with no branching on list shape.
 */
export class PropertyList<V extends number | Color> {
  /** Head of the keyframe list. */
  public first: PropertyNode<V> | undefined;
  /**
   * Resolves the value at a given progress. Assigned by
   * {@link PropertyList.reset}; `undefined` until then.
   *
   * @param lerp - Progress, `0`–`1`.
   * @returns The value at that progress.
   */
  public interpolate: ((lerp: number) => V) | undefined;
  /**
   * Easing applied to `lerp` before lookup, taken from the first node.
   *
   * @param lerp - Progress, `0`–`1`.
   * @returns The eased progress, also `0`–`1`.
   */
  public ease: SimpleEase | undefined;
  /** Whether this list holds colours, which interpolate per channel. */
  private isColor: boolean;

  /** @param isColor - `true` when the list holds `{ r, g, b }` values. */
  constructor(isColor = false) {
    this.first = undefined;
    this.isColor = !!isColor;
    this.interpolate = undefined;
    this.ease = undefined;
  }

  /**
   * Points the list at a new keyframe chain and picks the matching
   * {@link PropertyList.interpolate} implementation.
   *
   * Must be called before the list is evaluated — `interpolate` is `undefined`
   * until it runs.
   *
   * @param first - Head of the keyframe list, as built by
   * {@link PropertyNode.createList}. Its `isStepped` and `ease` are read here.
   */
  public reset(first: PropertyNode<V>): void {
    this.first = first;
    const isSimple = first.next && first.next.time >= 1;

    // The three `@ts-expect-error`s below are all the same thing: `isColor` is a runtime flag,
    // so TS cannot tie it to `V` and prove the colour variant matches a `PropertyList<number>`
    // (or the reverse). Narrowing it properly means making `isColor` a discriminant on the
    // class, which changes every construction site.
    if (!first.next) {
      this.interpolate = () => first.value;
    } else if (isSimple) {
      // @ts-expect-error — see above.
      this.interpolate = this.isColor ? intColorSimple : intValueSimple;
    } else if (first.isStepped) {
      // @ts-expect-error — see above.
      this.interpolate = this.isColor ? intColorStepped : intValueStepped;
    } else {
      // @ts-expect-error — see above.
      this.interpolate = this.isColor ? intColorComplex : intValueComplex;
    }
    this.ease = this.first.ease;
  }
}
