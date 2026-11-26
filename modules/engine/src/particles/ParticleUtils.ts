import {
  Texture,
  Color as PixiColor,
  type PointData,
  type BLEND_MODES,
  Assets,
} from 'pixi.js';
import { PropertyNode, type ValueStep } from './PropertyNode.js';
import type { EmitterConfigV3 } from './EmitterConfig.js';
import type { BehaviorConfigs } from './behaviors/BehaviorTypes.js';

/**
 * How behaviors turn a string into a `Texture`.
 *
 * Aliased rather than called directly so a host can point texture resolution at
 * its own loader by reassigning it.
 */
export const GetTextureFromString: (d: string) => Texture = Texture.from;

/**
 * An RGB(A) colour split into channels, so a colour list can be interpolated
 * component by component rather than as a packed integer.
 */
export interface Color {
  /** Red, `0`–`255`. */
  r: number;
  /** Green, `0`–`255`. */
  g: number;
  /** Blue, `0`–`255`. */
  b: number;
  /** Alpha, `0`–`255`; omitted when fully opaque. */
  a?: number;
}

/**
 * One segment of a GreenSock-style custom ease curve, as produced by their
 * CustomEase tool.
 */
export interface EaseSegment {
  /** Control point value for the segment's quadratic. */
  cp: number;
  /** Value at the start of the segment. */
  s: number;
  /** Value at the end of the segment. */
  e: number;
}

/**
 * An easing function: takes progress `0`–`1` and returns eased progress `0`–`1`.
 *
 * @example
 * ```ts
 * const quadIn: SimpleEase = (time) => time * time;
 * ```
 */
export type SimpleEase = (time: number) => number;

/** Whether the library logs its own errors and warnings. */
export const verbose = false;

/** Degrees-to-radians factor; configs are authored in degrees, maths runs in radians. */
export const DEG_TO_RADS = Math.PI / 180;

/** Blend modes PixiJS 8 accepts; anything else is rejected by {@link getBlendMode}. */
const BlendModeSet = new Set<BLEND_MODES>([
  'inherit',
  'normal',
  'add',
  'multiply',
  'screen',
  'darken',
  'lighten',
  'erase',
  'color-dodge',
  'color-burn',
  'linear-burn',
  'linear-dodge',
  'linear-light',
  'hard-light',
  'soft-light',
  'pin-light',
  'difference',
  'exclusion',
  'overlay',
  'saturation',
  'color',
  'luminosity',
  'normal-npm',
  'add-npm',
  'screen-npm',
  'none',
  'subtract',
  'divide',
  'vivid-light',
  'hard-mix',
  'negation',
  'min',
  'max',
]);

/**
 * Rotates a point around the origin, in place.
 *
 * Returns immediately for a zero angle, which is the common case for an
 * unrotated emitter and skips two trig calls per particle.
 *
 * @param angle - Rotation in radians.
 * @param p - The point to rotate; mutated in place.
 */
export function rotatePoint(angle: number, p: PointData): void {
  if (!angle) return;

  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const xnew = p.x * c - p.y * s;
  const ynew = p.x * s + p.y * c;

  p.x = xnew;
  p.y = ynew;
}

/**
 * Packs three `0`–`255` channels into a single `0xRRGGBB` integer.
 *
 * @returns The colour as `0xRRGGBB`.
 */
export function combineRGBComponents(
  r: number,
  g: number,
  b: number,
): number {
  return (r << 16) | (g << 8) | b;
}

/**
 * Magnitude of a point treated as a vector.
 *
 * @param point - The vector to measure.
 */
export function length(point: PointData): number {
  return Math.sqrt(point.x * point.x + point.y * point.y);
}

/**
 * Scales a vector to unit length, in place.
 *
 * @param point - The vector to normalise; mutated in place. A zero vector
 * produces `NaN` components — callers are expected not to pass one.
 */
export function normalize(point: PointData): void {
  const oneOverLen = 1 / length(point);

  point.x *= oneOverLen;
  point.y *= oneOverLen;
}

/**
 * Multiplies both components of a point by a scalar, in place.
 *
 * @param point - The vector to scale; mutated in place.
 * @param value - The scalar.
 */
export function scaleBy(point: PointData, value: number): void {
  point.x *= value;
  point.y *= value;
}

/**
 * Parses a hex colour string into `0`–`255` channels.
 *
 * Accepts `#AARRGGBB`, `#RRGGBB`, `0xAARRGGBB`, `0xRRGGBB`, `AARRGGBB` and
 * `RRGGBB`. `a` is left `undefined` when the colour is fully opaque, so an
 * opaque value carries no alpha through interpolation.
 *
 * @param color - The colour string.
 * @param _output - Accepted for signature compatibility with earlier versions;
 * a new object is always returned.
 */
export function hexToRGB(color: string, _output?: Color): Color {
  const temp = PixiColor.shared.setValue(color);
  return {
    r: temp.red * 255,
    g: temp.green * 255,
    b: temp.blue * 255,
    a: temp.alpha === 1 ? undefined : temp.alpha * 255,
  };
}

/**
 * Compiles GreenSock CustomEase segments into a {@link SimpleEase}.
 *
 * Segments are assumed evenly spaced across `0`–`1`, so the active one is found
 * by a multiply and a floor rather than a search. Matches the output of the
 * tool at http://www.greensock.com/customease/.
 *
 * @param segments - Segment list from the CustomEase tool.
 * @returns An easing function over `0`–`1`; it may leave that range if the
 * authored curve does.
 */
export function generateEase(segments: EaseSegment[]): SimpleEase {
  const qty = segments.length;
  const oneOverQty = 1 / qty;

  return (time: number): number => {
    const i = (qty * time) | 0;

    const t = (time - i * oneOverQty) * qty;
    const s = segments[i] || segments[qty - 1];

    return s.s + t * (2 * (1 - t) * (s.cp - s.s) + t * (s.e - s.s));
  };
}

/**
 * Validates a blend mode name, falling back to `'normal'`.
 *
 * @param name - The requested blend mode.
 * @returns `name` when PixiJS supports it, otherwise `'normal'`.
 */
export function getBlendMode(name: BLEND_MODES): BLEND_MODES {
  if (!BlendModeSet.has(name)) {
    return 'normal';
  }

  return name;
}

/**
 * Flattens a colour gradient into an evenly spaced stepped list.
 *
 * Trades gradient smoothness for a fixed, small number of colour changes, which
 * is what makes a long gradient affordable where per-frame interpolation is not.
 *
 * No node is emitted for time `1`: in a stepped list the particle has already
 * died by the time that step would apply.
 *
 * @param list - Keyframes from time `0` to time `1`.
 * @param numSteps - How many steps to produce. Non-numeric or non-positive
 * values fall back to `10`.
 * @returns The first node of the stepped list.
 */
export function createSteppedGradient(
  list: ValueStep<string>[],
  numSteps = 10,
): PropertyNode<Color> {
  if (typeof numSteps !== 'number' || numSteps <= 0) {
    numSteps = 10;
  }
  const first = new PropertyNode<Color>(hexToRGB(list[0].value), list[0].time);

  first.isStepped = true;
  let currentNode = first;
  let current = list[0];
  let nextIndex = 1;
  let next = list[nextIndex];

  for (let i = 1; i < numSteps; ++i) {
    let lerp = i / numSteps;

    while (lerp > next.time) {
      current = next;
      next = list[++nextIndex];
    }

    lerp = (lerp - current.time) / (next.time - current.time);
    const curVal = hexToRGB(current.value);
    const nextVal = hexToRGB(next.value);
    const output: Color = {
      r: (nextVal.r - curVal.r) * lerp + curVal.r,
      g: (nextVal.g - curVal.g) * lerp + curVal.g,
      b: (nextVal.b - curVal.b) * lerp + curVal.b,
    };

    currentNode.next = new PropertyNode(output, i / numSteps);
    currentNode = currentNode.next;
  }

  return first;
}

/**
 * Resolves textures and asset aliases into a `Texture[]`, checking they share a
 * source.
 *
 * The shared-source check is not a nicety: `ParticleContainer` batches on one
 * source, so a mixed list would silently cost a draw call per switch. Failing
 * here turns that into an authoring error instead.
 *
 * @param textures - One texture/alias or a list of them.
 * @returns The resolved textures, in input order.
 * @throws {Error} When the resolved textures do not all share one source.
 */
export function parseTextures(
  textures: Texture[] | string[] | (Texture | string)[] | string | Texture,
): Texture[] {
  const images = (Array.isArray(textures) ? textures : [textures]).map((v) => {
    if (typeof v === 'string') {
      return Assets.get(v) as Texture;
    }
    return v;
  });

  const isAllFromSameSource = images.every(
    (image) => image && image.source === images[0].source,
  );

  if (!isAllFromSameSource) {
    throw new Error('All particle images must use the same source');
  }

  return images;
}

/**
 * Unwraps an animated-texture frame entry to the texture it names, dropping the
 * repeat `count` an {@link AnimatedParticleArt} frame may carry.
 *
 * @param texture - A texture, an alias, or a `{ texture, count }` descriptor.
 */
export function parsingAnimatedTextures(
  texture: string | Texture | { texture: string | Texture; count: number },
): string | Texture {
  if (typeof texture === 'object' && 'texture' in texture) {
    return texture.texture;
  }
  return texture;
}

/** Removes duplicate textures while preserving first-seen order. */
function getUniqueTextures(textures: Texture[]): Texture[] {
  return Array.from(new Set(textures));
}

/**
 * Collects the textures an emitter config will use, by inspecting its texture
 * behaviors.
 *
 * Lets a caller warm or validate an effect's art without instantiating the
 * emitter. Only the last matching texture behavior wins, which mirrors the fact
 * that a config declaring two of them would have one overwrite the other at
 * runtime anyway.
 *
 * @param config - The emitter config to inspect.
 * @returns The textures the config references; empty when it declares no
 * texture behavior.
 */
export function getTexturesFromConfig(config: EmitterConfigV3): Texture[] {
  return config.behaviors.reduce((textures, b) => {
    const behavior = b as BehaviorConfigs;
    if (behavior.type === 'textureSingle') {
      return parseTextures(behavior.config.texture);
    }
    if (behavior.type === 'textureOrdered') {
      const parsedTextures = parseTextures(behavior.config.textures);
      return getUniqueTextures(parsedTextures);
    }
    if (behavior.type === 'textureRandom') {
      return parseTextures(behavior.config.textures);
    }
    if (behavior.type === 'animatedSingle') {
      const parsedTextures = parseTextures(
        behavior.config.anim.textures.map(parsingAnimatedTextures),
      );
      return getUniqueTextures(parsedTextures);
    }
    if (behavior.type === 'animatedRandom') {
      const parsedTextures = parseTextures(
        behavior.config.anims.flatMap((anim) =>
          anim.textures.map(parsingAnimatedTextures),
        ),
      );

      return getUniqueTextures(parsedTextures);
    }
    return textures;
  }, [] as Texture[]);
}
