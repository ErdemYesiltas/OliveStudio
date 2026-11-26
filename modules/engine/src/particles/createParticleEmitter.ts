import { ParticleContainer, type Container, type ParticleProperties, type Ticker } from 'pixi.js';
import { Emitter } from './Emitter.js';
import type { EmitterConfigV3 } from './EmitterConfig.js';

/** `ParticleContainerOptions.dynamicProperties` demands the index signature; this adds it. */
type DynamicProperties = ParticleProperties & Record<string, boolean>;

/**
 * Which attributes the backing `ParticleContainer` re-uploads each frame.
 *
 * All five are on by default because a config may drive any of them and a wrong `false` fails
 * silently — the particles simply do not scale, or tint, or swap frames, with nothing logged.
 * Narrowing this per effect is a real optimisation (`uvs` in particular only earns its cost when
 * a texture behaviour animates frames), so a config may override it.
 *
 * Only consulted when this function creates the container. A caller that supplies its own
 * `ParticleContainer` sets the flags there, at construction, because Pixi bakes them into the
 * buffer layout and offers no setter.
 */
const DEFAULT_DYNAMIC: DynamicProperties = {
  position: true,
  /** Covers `scaleX`/`scaleY` and `anchorX`/`anchorY` — there is no separate `scale` flag. */
  vertex: true,
  rotation: true,
  /** Alpha rides here too: `aColor` is packed from `Particle.color`, which folds in alpha. */
  color: true,
  uvs: true,
};

/**
 * Builds one emitter over `target`, in the shape an engine particle driver expects
 * (`start` / `update` / `stopEmitting` / `destroy` / `isComplete`).
 *
 * This is the adapter the engine falls back to when a game registers no factory of its own. It
 * lives here rather than in the engine because it is this package's API that it adapts; the
 * engine only knows the returned shape, so neither package imports the other's types.
 *
 * **`target` is read two ways, by its type.**
 *
 * - A **`ParticleContainer`** is drawn into directly and stays the caller's: its parent, its
 *   z-order, its `dynamicProperties` and its lifetime. `destroy` leaves it standing and empty —
 *   `Emitter.destroy` recycles every live particle, and recycling detaches it — so the same
 *   container can host the next emitter. Pass one when the effect's place in the scene matters,
 *   or when several emitters should share one container and therefore one draw call.
 * - **Any other `Container`** is treated as a plain parent: a `ParticleContainer` is created
 *   under it from `dynamicProperties`, and `destroy` removes it again. The convenient default —
 *   nothing to set up, nothing to clean up.
 *
 * Either way a Pixi 8 emitter renders through a `ParticleContainer`, so every particle in it
 * draws from **one** `TextureSource`. With a supplied container that constraint spans every
 * emitter sharing it, and the source is whichever one the first particle brings.
 *
 * **`autoUpdate` is forced off, whatever the config says.** The caller owns the clock: it calls
 * `update(dtSec)` from the app ticker, the one `app.speed()` scales and `app.pause()` freezes. An
 * `autoUpdate: true` would additionally attach the emitter to its own ticker, advancing it twice
 * per frame and ignoring both controls.
 *
 * @param target - A `ParticleContainer` to draw into, or the container to draw under.
 * @param config - The emitter configuration ({@link EmitterConfigV3}), typed `unknown` because the
 * driver passes it through opaquely.
 * @param dynamicProperties - Container flags, used only when this function creates the container.
 * Defaults to {@link DEFAULT_DYNAMIC}.
 * @param ticker - The clock handed to the emitter, normally `app.ticker`. Since `autoUpdate` is
 * forced off this is inert on the returned handle's own path; it matters for a caller that later
 * reaches past the handle to `playOnceAndDestroy`, which attaches the emitter to it. Defaults to
 * the `Emitter` constructor's own default, `Ticker.shared`.
 * @returns The driver handle: `start`, `update`, `stopEmitting`, `destroy`, `isComplete`.
 */
export function createParticleEmitter(
  target: Container,
  config: unknown,
  dynamicProperties?: DynamicProperties,
  ticker?: Ticker
) {
  const cfg = config as EmitterConfigV3;
  const supplied = target instanceof ParticleContainer;

  if (supplied && dynamicProperties) {
    console.warn(
      '[particles] `dynamicProperties` is ignored for a ParticleContainer target — Pixi fixes ' +
        'those flags at construction. Set them where the container is created.',
    );
  }

  const container = supplied
    ? target
    : target.addChild(
        new ParticleContainer({ dynamicProperties: dynamicProperties ?? DEFAULT_DYNAMIC })
      );

  // `undefined` for `particleImages` keeps the emitter's own "derive them from the config's
  // texture behaviors" path; the same goes for `ticker`, whose default is `Ticker.shared`.
  const emitter = new Emitter(container, cfg, undefined, ticker);
  emitter.autoUpdate = false;

  return {
    start: (): void => {
      emitter.emit = true;
    },
    update: (dtSec: number): void => emitter.update(dtSec),
    stopEmitting: (): void => {
      emitter.emit = false;
    },
    destroy: (): void => {
      emitter.destroy();
      // Only what this function created is destroyed here; a supplied container is the
      // caller's and is left empty for reuse.
      if (!supplied) container.destroy();
    },
    isComplete: (): boolean => emitter.particleCount === 0 && !emitter.emit,
  };
}
