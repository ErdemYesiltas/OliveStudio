import { Observable } from 'rxjs';
import { Rectangle } from 'pixi.js';
import type { DirectorStep } from '../aperion-director/DirectorTypes.js';
import type { IStepStrategy, StepContext } from '../aperion-director/strategies/IStepStrategy.js';
import type { Camera } from './Camera.js';
import type { CameraShakeOptions } from './types.js';

/**
 * Director step shape for {@link CameraStrategy}. Exactly one operation per step
 * (checked in precedence order: `reset → shake → focus → zoom → rotate → pan`). All
 * fields are JSON-serialisable, so camera moves can live in server-data
 * compositions alongside `audio`, `delay`, and `parallel` steps.
 *
 * ```jsonc
 * { "type": "camera", "shake": { "intensity": 8, "ms": 400 } }
 * { "type": "camera", "zoom": 1.2, "ms": 600 }
 * { "type": "camera", "focus": { "x": 100, "y": 80, "width": 600, "height": 400, "zoom": 1.2 }, "ms": 600 }
 * { "type": "camera", "reset": true, "ms": 400 }
 * ```
 */
export interface CameraStep extends DirectorStep {
  type: 'camera';
  /** Resolver key selecting which camera to drive. Omit for the resolver's default. */
  camera?: string;
  /** Return to the identity view. */
  reset?: boolean;
  /** Transient jitter. `ms` falls back to the step-level `ms`. */
  shake?: CameraShakeOptions;
  /** Frame a world-space rectangle (`zoom` optional — fits when absent). */
  focus?: { x: number; y: number; width: number; height: number; zoom?: number };
  /** Absolute zoom around the current pivot. */
  zoom?: number;
  /** Absolute rotation (degrees) around the current pivot. */
  rotate?: number;
  /** Centre the view on a world point (no zoom change). */
  pan?: { x: number; y: number };
  /** Tween duration (ms) shared by move ops. */
  ms?: number;
  /** GSAP ease for move ops. */
  ease?: string;
}

/**
 * Bridges {@link Camera} into the director without coupling the two: the camera
 * stays a standalone view controller, and this strategy drives it from
 * composition steps. It resolves the target camera from `app.cameras` (the
 * {@link CameraPlugin} registry), so register it once with no arguments:
 *
 * @example
 * new Camera(worldLayer, { app, name: 'main', viewport: () => app.screen }); // auto-registers
 * app.director.registerStrategy(new CameraStrategy());
 *
 * // Now compositions can include camera steps (`camera` selects the registry name):
 * app.director.run([
 *   { type: 'camera', shake: { intensity: 8, ms: 400 } },
 *   { type: 'parallel', children: [
 *     { type: 'camera', camera: 'reel', zoom: 1.2, ms: 600 },
 *     { type: 'audio', play: { layer: 'sfx', alias: 'bigwin' } },
 *   ] },
 *   { type: 'delay', ms: 1500 },
 *   { type: 'camera', reset: true, ms: 400 },
 * ]);
 */
export class CameraStrategy implements IStepStrategy<CameraStep> {
  readonly type = 'camera';

  run(step: CameraStep, ctx: StepContext): Observable<void> {
    return new Observable<void>((sub) => {
      const camera = ctx.app.cameras?.get(step.camera);
      if (!camera) {
        console.warn(`[Director] CameraStrategy: no camera for "${step.camera ?? '(default)'}" — skipping`);
        sub.next();
        sub.complete();
        return undefined;
      }

      let cancelled = false;
      this._dispatch(camera, step).then(
        () => {
          if (cancelled) return;
          sub.next();
          sub.complete();
        },
        (err) => {
          if (!cancelled) sub.error(err);
        },
      );

      return () => {
        cancelled = true;
        camera.stop();
      };
    });
  }

  private _dispatch(camera: Camera, step: CameraStep): Promise<unknown> {
    const tween = { ms: step.ms, ease: step.ease };
    if (step.reset) return camera.reset(tween);
    if (step.shake) return camera.shake({ ...step.shake, ms: step.shake.ms ?? step.ms });
    if (step.focus) {
      const { x, y, width, height, zoom } = step.focus;
      return camera.focus(new Rectangle(x, y, width, height), { zoom, ...tween });
    }
    if (step.zoom !== undefined) return camera.zoomTo(step.zoom, tween);
    if (step.rotate !== undefined) return camera.rotateTo(step.rotate, tween);
    if (step.pan) return camera.panTo(step.pan, tween);
    return Promise.resolve();
  }
}
