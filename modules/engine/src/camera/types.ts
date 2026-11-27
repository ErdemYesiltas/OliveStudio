import type { Application, Size } from 'pixi.js';
import type { CameraEase } from './easing.js';

/**
 * How a camera move settled. Returned by `panTo` / `zoomTo` / `rotateTo` /
 * `focus` / `reset` / `shake` so a sequenced flow can tell a natural finish from
 * an interruption:
 * - `'completed'`  — the tween ran to its end (or `ms: 0` applied instantly).
 * - `'superseded'` — a newer move (or {@link CameraFollowOptions follow}) replaced it mid-flight.
 * - `'stopped'`    — `stop()` or `dispose()` killed it.
 *
 * `await`-and-ignore callers are unaffected; the value is purely informational.
 */
export type CameraMoveResult = 'completed' | 'superseded' | 'stopped';

/** Shared tween options for camera moves. `ms` of 0/undefined applies instantly. */
export interface CameraTweenOptions {
  /** Tween duration in milliseconds. Omit or `0` for an instant, non-animated change. */
  ms?: number;
  /** GSAP ease string (e.g. `"power2.out"`). Defaults to `"power2.out"`. */
  ease?: string;
}

/** Options for {@link Camera.focus} — frame a world-space rectangle. */
export interface CameraFocusOptions extends CameraTweenOptions {
  /** Explicit zoom. When omitted, the rectangle is fitted to the viewport. */
  zoom?: number;
}

/** Options for {@link Camera.shake}. A transient positional (and optional angular) jitter. */
export interface CameraShakeOptions {
  /** Peak positional amplitude in pixels. Defaults to `8`. */
  intensity?: number;
  /** Total duration in milliseconds. Defaults to `300`. */
  ms?: number;
  /** Easing of the amplitude decay. Defaults to linear. */
  ease?: CameraEase;
  /** Peak angular amplitude in degrees. Defaults to `0` (no rotation). */
  rotation?: number;
}

/** Options for {@link Camera.follow} — smoothly track a display object. */
export interface CameraFollowOptions {
  /**
   * Smoothing duration in milliseconds. Lower = snappier,
   * higher = a laggier, more cinematic chase. Defaults to `300`.
   */
  ms?: number;
  /** GSAP ease for the smoothing. Defaults to `"power2.out"`. */
  ease?: string;
  /** Pixel offset added to the tracked point — e.g. lead the camera ahead of the target. */
  offset?: { x?: number; y?: number };
  /**
   * Keep the target on screen by zooming out (down to `minZoom`) when it nears the
   * viewport edge — e.g. while the camera is edge-locked at a world boundary — and
   * zooming back to the follow's starting scale when it returns. Needs a `viewport`.
   * Defaults to `false`.
   */
  keepInView?: boolean;
  /** Safe-area inset in pixels for {@link keepInView} (target kept this far from the edge). Defaults to `0`. */
  margin?: number;
}

/** Construction options for {@link Camera}. */
export interface CameraOptions {
  /**
   * Viewport size used to centre {@link Camera.focus} / {@link Camera.follow}. A
   * fixed {@link Size} or a getter (e.g. `() => app.screen`). When omitted, focus
   * keeps the current base position and follow centres on `(0, 0)`.
   */
  viewport?: Size | (() => Size);
  /**
   * Use the application's ticker to advance moves and following. Register this camera
   * in `app.cameras` under {@link name} on construction, and
   * remove it on `dispose`. Both `app` and `name` must be set to register; omit
   * them for a standalone camera. Lets {@link CameraStrategy} resolve it by name.
   */
  app?: Application;
  /** Registry name under `app.cameras` (requires {@link app}). */
  name?: string;
  /**
   * Keep the visible viewport inside the target's content bounds (read from
   * `target.getLocalBounds()`), so the world edge is never crossed. Zoom-aware:
   * the centred point is inset by half a viewport (in world units) at the current
   * scale; when the content is smaller than the viewport it centres on the content.
   * `reset` bypasses it. Needs a `viewport`. Defaults to `false`.
   */
  edgeLock?: boolean;
  /** Minimum scale — applies to every zoom (`zoomTo`/`focus`/`follow`). */
  minZoom?: number;
  /** Maximum scale — applies to every zoom (`zoomTo`/`focus`/`follow`). */
  maxZoom?: number;
}
