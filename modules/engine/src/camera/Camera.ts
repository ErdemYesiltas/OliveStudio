import { gsap } from 'gsap';
import { DEG_TO_RAD, Point, Ticker } from 'pixi.js';
import type { Application, Container, Rectangle, Size } from 'pixi.js';
import { tweenOnClock } from '../clock-tween.js';
import { CameraDepth, type CameraCurveOptions, type CameraDepthOptions, type CameraLayerEffects, type CameraTheaterOptions } from './CameraDepth.js';
import { CameraPostFXs } from './CameraPostFXs.js';
import type {
  CameraFocusOptions,
  CameraFollowOptions,
  CameraMoveResult,
  CameraOptions,
  CameraShakeOptions,
  CameraTweenOptions,
} from './types.js';

/** The composed transform a camera drives, before shake offset is added. */
interface CameraState {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  pivotX: number;
  pivotY: number;
  rotation: number;
}

const DEFAULT_EASE = 'power2.out';
const DEFAULT_SHAKE_INTENSITY = 8;
const DEFAULT_SHAKE_MS = 300;
/** Floor for scale so a zoom of `0`/negative can never collapse or mirror the target. */
const MIN_SCALE = 1e-3;

/** Symmetric random offset in `[-amp, amp]`. Non-deterministic — visual jitter only. */
const jitter = (amp: number): number => (Math.random() * 2 - 1) * amp;

/** Clamp `v` to the optional `[min, max]`; an `undefined` bound leaves that side open. */
const clampTo = (v: number, min?: number, max?: number): number => {
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
};

/**
 * A view controller bound to a single {@link Container}. The container is the
 * "world"; the camera reframes it via `position` / `pivot` / `scale` / `rotation`
 * — so attaching a camera to a scene layer pans/zooms the whole scene, while
 * attaching one to a lone display object reframes just that object.
 *
 * Several cameras can coexist (a scene camera, a reel camera). Supply an
 * application to drive a camera from that application's ticker.
 * To drive a camera from server-data compositions, register a {@link CameraStrategy}
 * with the director instead of coupling this class to the director.
 *
 * Shake is composed as a transient offset on top of the base transform, so it
 * never fights an in-flight {@link panTo} / {@link zoomTo} / {@link focus}.
 *
 * Every move returns a `Promise<`{@link CameraMoveResult}`>` that resolves when
 * the move settles: `'completed'` on a natural finish (or immediately for
 * `ms: 0`), `'superseded'` when a newer move/{@link follow} replaces it, and
 * `'stopped'` on `stop()`/`dispose()`. Awaiting-and-ignoring the value keeps the
 * old behaviour; inspect it when a sequenced flow must distinguish an
 * interruption from a real finish.
 *
 * @example
 * const cam = new Camera(app.scene.getLayer('main'), { viewport: () => app.screen });
 * await cam.focus(reelBounds, { zoom: 1.2, ms: 600 });
 * cam.shake({ intensity: 10, ms: 400 });
 * await cam.reset({ ms: 400 });
 */
export class Camera {
  readonly postFXs = new CameraPostFXs(this);
  readonly depth: CameraDepth;
  private readonly _target: Container;
  private readonly _viewport?: Size | (() => Size);
  private readonly _state: CameraState;
  private readonly _shake = { x: 0, y: 0, rotation: 0 };
  private _moveTween: ReturnType<typeof tweenOnClock> | null = null;
  private _shakeTween: ReturnType<typeof tweenOnClock> | null = null;
  // Resolvers for the in-flight tweens. GSAP's `kill()` does not fire `onComplete`,
  // so a superseded/stopped move must settle its promise here or callers awaiting
  // it (including the director) would hang forever.
  private _moveResolve: ((result: CameraMoveResult) => void) | null = null;
  private _shakeResolve: ((result: CameraMoveResult) => void) | null = null;
  private readonly _opts: CameraOptions;
  private _followTick: ((ticker: Ticker) => void) | null = null;
  private _followObject: Container | null = null;
  private _followBaseZoom = 1;
  private readonly _ptGlobal = new Point();
  private readonly _ptLocal = new Point();
  private readonly _ptScreen = new Point();
  private _disposed = false;
  private readonly _app?: Application;
  private readonly _name?: string;
  private readonly _onTargetDestroyed = (): void => this.dispose();
  private readonly _onFollowDestroyed = (): void => this.unfollow();

  constructor(target: Container, options: CameraOptions = {}) {
    this._target = target;
    this.depth = new CameraDepth(target, options.app);
    this._viewport = options.viewport;
    this._opts = options;
    this._state = {
      x: target.x,
      y: target.y,
      scaleX: target.scale.x,
      scaleY: target.scale.y,
      pivotX: target.pivot.x,
      pivotY: target.pivot.y,
      rotation: target.rotation,
    };
    // If the world container is destroyed, the camera is dead weight — tear it down
    // so tweens/ticker callbacks stop touching freed Pixi internals.
    target.once('destroyed', this._onTargetDestroyed);

    // Auto-register in app.cameras when given an app + name (removed in dispose).
    this._app = options.app;
    this._name = options.name;
    if (this._name && this._app?.cameras) this._app.cameras.register(this._name, this);

    this._warnIfLayoutOwned();
  }

  /**
   * The options this camera was built with, as they stand.
   *
   * The read half of {@link configure}: a caller showing `minZoom` has to be able to ask what it
   * is, and one that remembered what it last set would be showing its own history the moment
   * anything else configured the camera.
   *
   * `Readonly` because writing through it would skip the merge `configure` does and let a caller
   * clear a bound it did not mean to touch.
   */
  get options(): Readonly<CameraOptions> {
    return this._opts;
  }

  /**
   * Retune the options a move reads.
   *
   * **Only the ones that are read live.** `minZoom`, `maxZoom` and `edgeLock` are consulted on every
   * move — `_clampMoveTarget` reads them per call — so changing one changes what the next move does.
   * `viewport`, `app` and `name` are wiring settled at construction: a camera registers itself under
   * its name and snapshots nothing else, so re-pointing either would leave the registry disagreeing
   * with the object.
   *
   * Merged rather than replaced, so a caller tuning one bound does not silently clear the other.
   * Nothing is re-clamped on the spot: a camera already past a new `maxZoom` stays there until the
   * next move, which is when the bound is a bound. Snapping it here would move a camera nobody asked
   * to move.
   */
  configure(patch: Pick<CameraOptions, 'minZoom' | 'maxZoom' | 'edgeLock'>): void {
    Object.assign(this._opts, patch);
  }

  /**
   * The container this camera moves.
   *
   * Exposed so a caller can ask *which* camera belongs to a container, rather than reproducing the
   * name one was registered under. A registry name is a convention — `app.scene.camera` defaults to
   * `scene:<layer>` and lets it be overridden — so matching on it means a camera created any other
   * way is invisible, and a tool that then offers to "add" one puts a second camera on a container
   * that already has one. Identity is the thing that cannot be spelled two ways.
   *
   * Read-only: a camera snapshots its target's transform at construction, so retargeting one would
   * mean resetting to a transform that belonged to something else.
   */
  get target(): Container {
    return this._target;
  }

  /**
   * Reports a target whose transform belongs to `@pixi/layout`.
   *
   * A camera owns its target's `position`/`pivot`/`scale`/`rotation` outright, so a yoga-positioned
   * node has two writers: the layout pass places the box, then the camera reframes from a base
   * snapshot that the next layout pass invalidates. `reset()` is where it shows first — it returns
   * to the transform read in this constructor, which on a layout node is whatever it held before
   * yoga first measured it. The same applies to responsive `x`/`y`/`scale` rules on the target.
   *
   * A camera's target should be a container nobody else positions — a scene layer
   * (`app.scene.camera(layer)`) or a world container you own. Only the styles present *now* are
   * visible here, so a style assigned after construction goes unreported.
   */
  private _warnIfLayoutOwned(): void {
    // Both empty cases mean "not in the layout system": `undefined` when nothing ever assigned a
    // style, `null` when a `layout: false` rule detached the node.
    const layout = (this._target as { layout?: unknown }).layout;
    if (layout === undefined || layout === null) return;
    console.warn(
      `[Camera] target "${this._target.label ?? this._target.constructor.name}" has a '@pixi/layout' style. `
      + 'The layout pass positions it and the camera reframes it — they fight over the same transform. '
      + 'Point the camera at a container the layout system does not own.',
    );
  }

  /**
   * Centre the view on world point `{ x, y }` (no zoom change). Like {@link focus}
   * but without scaling — it pivots to the point and pins it at the viewport
   * anchor (centre). With no viewport configured, the point lands at the current
   * anchor instead.
   */
  panTo(point: { x: number; y: number }, opts: CameraTweenOptions = {}): Promise<CameraMoveResult> {
    const a = this._anchor();
    return this._move({ pivotX: point.x, pivotY: point.y, x: a.x, y: a.y }, opts);
  }

  /** Present a frame computed by a host that owns the authored camera pose. */
  applyPose(pose: { position: { x: number; y: number }; pivot: { x: number; y: number }; scale: number; angle: number }) {
    if (this._disposed) return;
    Object.assign(this._state, {
      x: pose.position.x, y: pose.position.y, pivotX: pose.pivot.x, pivotY: pose.pivot.y,
      scaleX: pose.scale, scaleY: pose.scale, rotation: pose.angle * DEG_TO_RAD,
    });
    this._apply();
  }

  /** Apply depth to the target's top-level layers in their original order. */
  applyDepth({ minScale, maxScale, distance, zIndex }: CameraDepthOptions, layers?: readonly Container[]) {
    if (this._disposed) return;
    this.depth.apply({ minScale, maxScale, distance, zIndex }, layers, this._viewportSize().width);
  }

  /** Curve the supplied layers in world order, with the full angle on the last layer. */
  applyCurve(curve: CameraCurveOptions, layers?: readonly Container[],
    depth?: { options: CameraDepthOptions; layers?: readonly Container[] }) {
    this.applyLayerEffects({ perspective: depth?.options, curve }, layers, depth?.layers);
  }

  /** Compose perspective, curve and background blur on the supplied top-level layers. */
  applyLayerEffects({ perspective, curve, blur, blurs = [] }: CameraLayerEffects,
    layers?: readonly Container[], perspectiveLayers?: readonly Container[]) {
    if (this._disposed) return;
    if (curve && (!Number.isFinite(curve.angle) || curve.angle < 0 || curve.angle > 90)) {
      throw new RangeError('Camera curve angle must be between 0 and 90 degrees');
    }
    if (blur) blurs = [blur, ...blurs];
    if (blurs.some(blur => !Number.isFinite(blur.strength) || blur.strength < 0 || blur.strength > 100)) {
      throw new RangeError('Camera depth blur strength must be between 0 and 100');
    }
    this.depth.apply(perspective, perspectiveLayers, this._viewportSize().width, { curve, blurs, visualRoots: layers });
  }

  /** Apply depth and compose theater skew and warp using the supplied radius in pixels. */
  applyTheater(options: CameraTheaterOptions, layers?: readonly Container[]) {
    if (this._disposed) return;
    this.depth.apply(options, layers, this._viewportSize().width || this.depth.worldBounds().width);
  }

  /** Restore the target hierarchy, order and authored transforms. */
  clearDepth() {
    this.depth.clear();
  }

  /** Zoom to an absolute `scale` around the current pivot (clamped to `minZoom`/`maxZoom`). */
  zoomTo(scale: number, opts: CameraTweenOptions = {}): Promise<CameraMoveResult> {
    return this._move({ scaleX: scale, scaleY: scale }, opts);
  }

  /** Rotate the view to an absolute angle (degrees) around the current pivot. */
  rotateTo(degrees: number, opts: CameraTweenOptions = {}): Promise<CameraMoveResult> {
    return this._move({ rotation: degrees * DEG_TO_RAD }, opts);
  }

  /**
   * Frame a world-space rectangle: pivot to its centre, scale to `zoom` (or fit
   * it to the viewport), and position it at the viewport centre.
   */
  focus(bounds: Rectangle, opts: CameraFocusOptions = {}): Promise<CameraMoveResult> {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const vp = this._viewportSize();
    const hasViewport = vp.width > 0 && vp.height > 0;
    const fit =
      hasViewport && bounds.width > 0 && bounds.height > 0
        ? Math.min(vp.width / bounds.width, vp.height / bounds.height)
        : 1;
    const zoom = opts.zoom ?? fit; // floored/clamped to minZoom/maxZoom in _clampMoveTarget
    return this._move(
      {
        pivotX: cx,
        pivotY: cy,
        scaleX: zoom,
        scaleY: zoom,
        // Without a viewport we can't centre — keep the current base position
        // rather than snapping to (0,0) and zeroing the frame.
        ...(hasViewport ? { x: vp.width / 2, y: vp.height / 2 } : {}),
      },
      opts,
    );
  }

  /**
   * Return to the identity view: position `(0,0)`, pivot `(0,0)`, scale `1`, no
   * rotation. Bypasses clamping — `reset` is an explicit hard reset, so the
   * configured bounds don't pull it off identity.
   */
  reset(opts: CameraTweenOptions = {}): Promise<CameraMoveResult> {
    return this._move(
      { x: 0, y: 0, pivotX: 0, pivotY: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      opts,
      false,
    );
  }

  /**
   * Transient jitter layered on top of the base transform. Amplitude decays
   * linearly to zero over `ms`, leaving the base transform untouched.
   */
  shake(opts: CameraShakeOptions = {}): Promise<CameraMoveResult> {
    const intensity = opts.intensity ?? DEFAULT_SHAKE_INTENSITY;
    const ms = opts.ms ?? DEFAULT_SHAKE_MS;
    const rotation = (opts.rotation ?? 0) * DEG_TO_RAD;

    this._settleShake();
    return new Promise<CameraMoveResult>((resolve) => {
      this._shakeResolve = resolve;
      const progress = { t: 0 };
      this._shakeTween = tweenOnClock(this._app?.ticker, progress, {
        t: 1,
        duration: ms / 1000,
        ease: 'none',
        onUpdate: () => {
          const decay = 1 - progress.t;
          this._shake.x = jitter(intensity * decay);
          this._shake.y = jitter(intensity * decay);
          this._shake.rotation = rotation ? jitter(rotation * decay) : 0;
          this._apply();
        },
        onComplete: () => {
          this._shake.x = this._shake.y = this._shake.rotation = 0;
          this._apply();
          this._shakeTween = null;
          this._shakeResolve = null;
          resolve('completed');
        },
      });
    });
  }

  /**
   * Continuously track `object`, keeping it at the viewport centre with a smooth
   * (eased) chase driven by GSAP's ticker. Cancels any in-flight move and replaces
   * a previous follow. Zoom/rotate can run concurrently; call {@link unfollow} to stop.
   *
   * Respects `clamp`/`edgeLock` (the tracked point is clamped to bounds) and,
   * with `keepInView`, zooms out to keep the target on screen near a boundary.
   *
   * Auto-stops if `object` is destroyed. Requires a `viewport` to centre the
   * target; without one the followed point lands at `(0, 0)`.
   *
   * @example
   * cam.follow(hero, { ms: 350, ease: 'power3.out', offset: { y: -40 }, keepInView: true });
   */
  follow(object: Container, opts: CameraFollowOptions = {}): void {
    this.unfollow();
    this._settleMove();
    if (object.destroyed) return;

    this._followObject = object;
    object.once('destroyed', this._onFollowDestroyed);

    const duration = Math.max(0, opts.ms ?? DEFAULT_SHAKE_MS);
    const ease = gsap.parseEase(opts.ease ?? DEFAULT_EASE);
    const ox = opts.offset?.x ?? 0;
    const oy = opts.offset?.y ?? 0;
    const keepInView = opts.keepInView ?? false;
    const margin = opts.margin ?? 0;
    this._followBaseZoom = this._state.scaleX;
    this._followTick = frame => {
      if (this._target.destroyed || object.destroyed) {
        this.unfollow();
        return;
      }
      // Object's position in the target's local space — intrinsic to the object's
      // place in the hierarchy, so it doesn't drift as the camera moves.
      const local = this._target.toLocal(object.getGlobalPosition(this._ptGlobal), undefined, this._ptLocal);
      const { x: px, y: py } = this._clampPivot(local.x + ox, local.y + oy, this._state.scaleX, this._state.scaleY);
      const ratio = duration ? ease(Math.min(1, frame.deltaMS / duration)) : 1;
      this._state.pivotX += (px - this._state.pivotX) * ratio;
      this._state.pivotY += (py - this._state.pivotY) * ratio;
      if (keepInView) {
        const zoom = this._fitZoom(object, margin);
        this._state.scaleX += (zoom - this._state.scaleX) * ratio;
        this._state.scaleY += (zoom - this._state.scaleY) * ratio;
      }

      const a = this._anchor();
      this._state.x = a.x;
      this._state.y = a.y;
      this._apply();
    };
    (this._app?.ticker ?? Ticker.shared).add(this._followTick);
  }

  /** Stop following. Leaves the camera at its current transform. Safe to call when not following. */
  unfollow(): void {
    if (!this._followTick) return;
    (this._app?.ticker ?? Ticker.shared).remove(this._followTick);
    this._followTick = null;
    if (this._followObject && !this._followObject.destroyed) {
      this._followObject.off('destroyed', this._onFollowDestroyed);
    }
    this._followObject = null;
  }

  /**
   * Kill any in-flight move/shake. A move is left at its current (interpolated)
   * transform; a shake's transient offset is cleared back to the base. Pending
   * move/shake promises resolve with `'stopped'` (not rejected). Does not stop
   * {@link follow}.
   */
  stop(): void {
    this._settleMove('stopped');
    this._settleShake('stopped');
  }

  /** Stop all activity (move, shake, follow) and release references. Unusable afterwards. Idempotent. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.postFXs.destroy();
    this.stop();
    this.unfollow();
    this.clearDepth();
    if (!this._target.destroyed) this._target.off('destroyed', this._onTargetDestroyed);
    if (this._name && this._app?.cameras) this._app.cameras.unregister(this._name);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private _move(to: Partial<CameraState>, opts: CameraTweenOptions, clampTarget = true): Promise<CameraMoveResult> {
    this._settleMove();
    if (clampTarget) this._clampMoveTarget(to);

    if (!opts.ms) {
      Object.assign(this._state, to);
      this._apply();
      return Promise.resolve('completed');
    }

    return new Promise<CameraMoveResult>((resolve) => {
      this._moveResolve = resolve;
      this._moveTween = tweenOnClock(this._app?.ticker, this._state, {
        ...to,
        duration: opts.ms! / 1000,
        ease: opts.ease ?? DEFAULT_EASE,
        onUpdate: () => this._apply(),
        onComplete: () => {
          this._moveTween = null;
          this._moveResolve = null;
          resolve('completed');
        },
      });
    });
  }

  /** Kill the in-flight move and settle its pending promise with `reason`. */
  private _settleMove(reason: CameraMoveResult = 'superseded'): void {
    this._moveTween?.kill();
    this._moveTween = null;
    const resolve = this._moveResolve;
    this._moveResolve = null;
    resolve?.(reason);
  }

  /** Kill the in-flight shake, clear its offset, and settle its pending promise with `reason`. */
  private _settleShake(reason: CameraMoveResult = 'superseded'): void {
    this._shakeTween?.kill();
    this._shakeTween = null;
    if (this._shake.x || this._shake.y || this._shake.rotation) {
      this._shake.x = this._shake.y = this._shake.rotation = 0;
      this._apply();
    }
    const resolve = this._shakeResolve;
    this._shakeResolve = null;
    resolve?.(reason);
  }

  /**
   * Clamp a move target's centred world point (pivot) and zoom to the configured
   * bounds. Position (`x`/`y`) is the fixed viewport anchor, so it's never clamped —
   * `min/maxX/Y` always mean "which world point is centred".
   */
  private _clampMoveTarget(to: Partial<CameraState>): void {
    const o = this._opts;
    // Zoom limits apply to every zoom change, independent of `clamp`/`edgeLock`:
    // MIN_SCALE is the hard floor (never collapse/mirror), with minZoom/maxZoom
    // layered on when configured.
    const lo = Math.max(o.minZoom ?? 0, MIN_SCALE);
    if (to.scaleX !== undefined) to.scaleX = clampTo(to.scaleX, lo, o.maxZoom);
    if (to.scaleY !== undefined) to.scaleY = clampTo(to.scaleY, lo, o.maxZoom);
    // Position (pivot) clamping is opt-in via `edgeLock`.
    if (o.edgeLock && (to.pivotX !== undefined || to.pivotY !== undefined)) {
      const c = this._clampPivot(
        to.pivotX ?? this._state.pivotX,
        to.pivotY ?? this._state.pivotY,
        to.scaleX ?? this._state.scaleX,
        to.scaleY ?? this._state.scaleY,
      );
      if (to.pivotX !== undefined) to.pivotX = c.x;
      if (to.pivotY !== undefined) to.pivotY = c.y;
    }
  }

  /**
   * Edge-lock a centred world point: keep the viewport inside the target's content
   * bounds by insetting the pivot half a viewport (in world units, so it's zoom-aware).
   * No-op unless `edgeLock` is on and a viewport is configured.
   */
  private _clampPivot(px: number, py: number, sx: number, sy: number): { x: number; y: number } {
    if (!this._opts.edgeLock) return { x: px, y: py };
    const vp = this._viewportSize();
    if (vp.width <= 0 || vp.height <= 0) return { x: px, y: py };
    const b = this._target.getLocalBounds();
    return {
      x: this._edge(px, b.minX, b.maxX, vp.width, sx),
      y: this._edge(py, b.minY, b.maxY, vp.height, sy),
    };
  }

  /** One-axis edge-lock: inset `[min, max]` by half a viewport (in world units) at `scale`. */
  private _edge(p: number, min: number, max: number, vpSize: number, scale: number): number {
    if (scale <= 0) return p;
    const half = vpSize / 2 / scale;
    const lo = min + half;
    const hi = max - half;
    // Content narrower than the viewport → centre on the content midpoint.
    return lo > hi ? (min + max) / 2 : clampTo(p, lo, hi);
  }

  /**
   * Target scale that keeps `object` within the viewport (minus `margin`): shrink
   * below the follow's base zoom only as needed, floored at `minZoom`/{@link MIN_SCALE}.
   * Uses the object's current on-screen position (feedback) — converges via smoothing.
   */
  private _fitZoom(object: Container, margin: number): number {
    const vp = this._viewportSize();
    if (vp.width <= 0 || vp.height <= 0) return this._followBaseZoom;
    const s = this._state.scaleX || MIN_SCALE;
    const sp = object.getGlobalPosition(this._ptScreen);
    // Object's offset from centre in WORLD units (scale-independent) → the fit scale
    // (object exactly at the safe edge) is `allow / offset`, which doesn't depend on
    // the current scale, so the feedback converges instead of oscillating.
    const offX = Math.abs(sp.x - vp.width / 2) / s;
    const offY = Math.abs(sp.y - vp.height / 2) / s;
    const allowX = Math.max(0, vp.width / 2 - margin);
    const allowY = Math.max(0, vp.height / 2 - margin);
    const fitX = offX > 0 ? allowX / offX : this._followBaseZoom;
    const fitY = offY > 0 ? allowY / offY : this._followBaseZoom;
    const target = Math.min(this._followBaseZoom, fitX, fitY);
    return clampTo(target, this._opts.minZoom ?? MIN_SCALE, this._followBaseZoom);
  }

  /** Screen point where the pivot is pinned: viewport centre, or the current position with no viewport. */
  private _anchor(): { x: number; y: number } {
    const vp = this._viewportSize();
    return vp.width > 0 && vp.height > 0
      ? { x: vp.width / 2, y: vp.height / 2 }
      : { x: this._state.x, y: this._state.y };
  }

  private _apply(): void {
    // A late tween/ticker callback can fire after the target is destroyed — its
    // transform accessors are gone, so bail rather than throw.
    if (this._target.destroyed) return;
    const s = this._state;
    this._target.position.set(s.x + this._shake.x, s.y + this._shake.y);
    this._target.scale.set(s.scaleX, s.scaleY);
    this._target.pivot.set(s.pivotX, s.pivotY);
    this._target.rotation = s.rotation + this._shake.rotation;
  }

  private _viewportSize(): Size {
    const vp = typeof this._viewport === 'function' ? this._viewport() : this._viewport;
    return vp ?? { width: 0, height: 0 };
  }
}
