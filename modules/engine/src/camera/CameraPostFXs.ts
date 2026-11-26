import type { Container } from 'pixi.js';
import { BaseEffect, EffectScope } from '../effects/BaseEffect.js';
import { effectEntries } from '../effects/identity.js';
import type { RuntimeCameraState } from '../runtime-camera.js';
import type { Camera } from './Camera.js';
import type { CameraLayerEffects } from './CameraDepth.js';
import type { CameraPostFXData, CameraPostFXType, CameraProjection } from './postFXSettings.js';

type EffectData<T extends CameraPostFXType> = Extract<CameraPostFXData, { type: T }>;

export abstract class CameraPostFX extends BaseEffect<Camera> {
  protected onAttach(_camera: Camera): void {}
  contribute(_frame: CameraLayerEffects): void {}
}

export class LayerPerspectiveFX extends CameraPostFX {
  constructor(readonly settings: EffectData<'perspective'>) { super(); }

  override contribute(frame: CameraLayerEffects) {
    const { scale, distance, zIndex } = this.settings;
    const strength = scale / 100;
    const previous = frame.perspective;
    frame.perspective = { distance: (previous?.distance ?? 0) + distance,
      zIndex: previous ? previous.zIndex + zIndex - 1 : zIndex,
      minScale: (previous?.minScale ?? 1) * (1 - 0.5 * strength),
      maxScale: (previous?.maxScale ?? 1) * (1 + 0.25 * strength) };
  }
}

export class DepthBlurFX extends CameraPostFX {
  constructor(readonly settings: EffectData<'depth'>) { super(); }

  override contribute(frame: CameraLayerEffects) {
    (frame.blurs ??= []).push(this.settings);
  }
}

export class CurveFX extends CameraPostFX {
  constructor(readonly settings: EffectData<'curve'>) { super(); }

  override contribute(frame: CameraLayerEffects) {
    const signed = (angle: number, direction: string) => direction === 'convex' ? -angle : angle;
    const sum = signed(this.settings.angle, this.settings.direction) +
      (frame.curve ? signed(frame.curve.angle, frame.curve.direction) : 0);
    frame.curve = { angle: Math.min(90, Math.abs(sum)), direction: sum < 0 ? 'convex' : 'concave' };
  }
}

export class CameraShakeFX extends CameraPostFX {
  constructor(readonly settings: EffectData<'shake'>) { super(); }

  trigger(state: RuntimeCameraState, time: number) {
    if (!this.isAttached) return;
    const { amplitude, duration, rotation } = this.settings;
    (state.shakes ??= []).push({ startedAt: time, duration, amplitude, rotation });
  }
}

export class CameraZoomFX extends CameraPostFX {
  constructor(readonly settings: EffectData<'zoom'>) { super(); }
}

export class CameraLimitsFX extends CameraPostFX {
  constructor(readonly settings: EffectData<'limits'>) { super(); }
}

function createCameraPostFX(data: CameraPostFXData): CameraPostFX {
  switch (data.type) {
    case 'perspective': return new LayerPerspectiveFX(data);
    case 'depth': return new DepthBlurFX(data);
    case 'curve': return new CurveFX(data);
    case 'shake': return new CameraShakeFX(data);
    case 'zoom': return new CameraZoomFX(data);
    case 'limits': return new CameraLimitsFX(data);
  }
}

export class CameraPostFXs {
  private readonly effects: EffectScope<Camera>;
  private readonly authored = new Map<string, { signature: string; effect: CameraPostFX }>();
  private order: string[] = [];

  constructor(private readonly camera: Camera) {
    this.effects = EffectScope.for(camera);
  }

  attach(id: string, effect: CameraPostFX) {
    this.effects.attach(id, effect);
  }

  get(id: string) { return this.effects.get(id); }

  projection(): CameraProjection {
    const frame: CameraProjection = {};
    for (const effect of this.activeEffects()) {
      if (effect instanceof CameraZoomFX) frame.zoom = effect.settings;
      if (effect instanceof CameraLimitsFX) frame.limits = effect.settings;
    }
    return frame;
  }

  triggerShake(state: RuntimeCameraState, time: number) {
    state.shakes = [];
    for (const effect of this.activeEffects()) if (effect instanceof CameraShakeFX) effect.trigger(state, time);
  }

  remove(id: string) {
    this.effects.remove(id);
  }

  configure(data: readonly CameraPostFXData[] = []) {
    const enabled = effectEntries(data).filter(({ effect }) => effect.enabled);
    this.order = enabled.map(({ key }) => key);
    const keep = new Set(this.order);
    for (const [id, entry] of this.authored) {
      if (keep.has(id)) continue;
      if (this.get(id) === entry.effect) this.remove(id);
      this.authored.delete(id);
    }
    for (const { effect: settings, key: id } of enabled) {
      const signature = JSON.stringify(settings);
      const previous = this.authored.get(id);
      if (previous?.signature === signature && previous.effect === this.get(id)) continue;
      const effect = createCameraPostFX(settings);
      this.attach(id, effect);
      this.authored.set(id, { signature, effect });
    }
  }

  private *activeEffects() {
    const ordered = this.order.map(id => this.get(id));
    const authored = new Set(ordered);
    for (const effect of this.effects.values()) {
      if (effect instanceof CameraPostFX && !authored.has(effect)) yield effect;
    }
    for (const effect of ordered) if (effect instanceof CameraPostFX) yield effect;
  }

  apply(layers?: readonly Container[], perspectiveLayers?: readonly Container[]) {
    const frame: CameraLayerEffects = {};
    for (const effect of this.activeEffects()) effect.contribute(frame);
    this.camera.applyLayerEffects(frame, layers, perspectiveLayers);
  }

  destroy() {
    this.effects.clear();
    this.authored.clear();
    this.order = [];
  }
}
