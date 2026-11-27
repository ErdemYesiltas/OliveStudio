import { Observable } from 'rxjs';
import type { Ticker } from 'pixi.js';
import { CameraStrategy, type CameraStep } from '@olivestudio/engine/camera';
import { applyCameraShake, cameraEaseProgress, parseCameraEase, type CameraView } from '@olivestudio/engine/runtime-camera';
import type { IStepStrategy, StepContext } from '@olivestudio/engine/aperion-director';

type Pose = Pick<CameraView, 'x' | 'y' | 'zoom' | 'rotation'>;
export class DirectorCamera implements IStepStrategy<CameraStep> {
  readonly type = 'camera';
  private readonly standalone = new CameraStrategy();
  private motion?: { cancel: () => void };
  private pose?: Partial<Pose>;
  private offset?: Partial<Pose>;

  constructor(private readonly base: () => CameraView, private readonly render: () => void) {}

  get active() { return !!this.pose || !!this.offset; }

  apply(view: CameraView): CameraView {
    const base = { ...view, ...this.pose };
    return { ...base, x: base.x + (this.offset?.x ?? 0), y: base.y + (this.offset?.y ?? 0),
      rotation: base.rotation + (this.offset?.rotation ?? 0) };
  }

  reset() {
    this.motion?.cancel();
    this.pose = undefined;
    this.offset = undefined;
  }

  run(step: CameraStep, context: StepContext): Observable<void> {
    if (step.camera && step.camera !== 'scene:world') return this.standalone.run(step, context);
    return new Observable<void>(subscriber => {
      this.motion?.cancel();
      const base = this.base();
      const from = this.apply(base);
      const target: Partial<Pose> = {};
      const duration = Math.max(0, step.shake?.ms ?? step.ms ?? (step.shake ? 300 : 0));
      const ease = parseCameraEase(step.ease ?? 'none')?.ease ?? 'none';
      if (!Number.isFinite(duration)) throw new Error('Invalid Director camera duration');
      if (step.focus) {
        const { x, y, width, height, zoom } = step.focus;
        target.x = x + width / 2;
        target.y = y + height / 2;
        target.zoom = zoom ?? Math.min((base.frame?.width ?? context.app.screen.width) / width,
          (base.frame?.height ?? context.app.screen.height) / height);
      } else if (step.pan) {
        target.x = step.pan.x;
        target.y = step.pan.y;
      }
      if (step.zoom !== undefined) target.zoom = step.zoom;
      if (step.rotate !== undefined) target.rotation = step.rotate;
      if (step.reset) Object.assign(target, { x: base.x, y: base.y, zoom: base.zoom, rotation: base.rotation });
      const keys = Object.keys(target) as (keyof Pose)[];
      if (keys.some(key => !Number.isFinite(target[key]))) throw new Error('Invalid Director camera transform');
      if (!step.shake && !keys.length) { subscriber.complete(); return; }

      let elapsed = 0;
      const tick = (ticker: Ticker) => { if (!context.isPaused()) update(ticker.deltaMS); };
      const motion = { cancel: () => subscriber.complete() };
      const update = (delta: number) => {
        elapsed += delta;
        const ratio = duration ? Math.min(1, elapsed / duration) : 1;
        if (step.shake) {
          const shaken = applyCameraShake(from, { startedAt: 0, duration, amplitude: step.shake.intensity ?? 8,
            rotation: step.shake.rotation, ease: step.shake.ease }, elapsed);
          this.offset = ratio < 1 ? { x: shaken.x - from.x, y: shaken.y - from.y, rotation: shaken.rotation - from.rotation } : undefined;
        } else {
          const progress = cameraEaseProgress(ease, ratio);
          this.pose ??= {};
          for (const key of keys) this.pose[key] = from[key] + (target[key]! - from[key]) * progress;
          if (step.reset && ratio === 1) this.pose = undefined;
        }
        this.render();
        if (ratio === 1) { subscriber.next(); subscriber.complete(); }
      };
      this.motion = motion;
      update(0);
      if (!subscriber.closed) context.ticker.add(tick);
      return () => {
        context.ticker.remove(tick);
        if (this.motion === motion) {
          this.motion = undefined;
          if (this.offset) { this.offset = undefined; this.render(); }
        }
      };
    });
  }
}
