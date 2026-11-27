import type { Container } from 'pixi.js';
import { BaseEffect, EffectScope } from '../effects/BaseEffect.js';
import { effectEntries } from '../effects/identity.js';
import type { RuntimeCameraState } from '../runtime-camera.js';
import type { Camera } from './Camera.js';
import type { CameraFilterContext, CameraLayerEffects } from './CameraDepth.js';
import { CameraPostFXSchema, type CameraMotionData, type CameraPostFXData, type CameraPostFXType, type CameraProjection } from './postFXSettings.js';

import type { CameraFilterData } from './filterSettings.js';

type EffectData<T extends CameraPostFXType> = Extract<CameraPostFXData, { type: T }>;

export abstract class CameraEffect extends BaseEffect<Camera> {
  settings?: CameraPostFXData;
  private restorePreview?: () => void;

  protected onAttach(_camera: Camera): void {}

  preview(present: (settings: CameraPostFXData) => () => void): void {
    this.reset();
    if (this.settings) this.restorePreview = present(this.settings);
  }

  reset(): void {
    const restore = this.restorePreview;
    this.restorePreview = undefined;
    restore?.();
  }

  updateSettings(data: CameraPostFXData) {
    if (!this.isAttached || this.settings?.type !== data.type) return false;
    const parsed = CameraPostFXSchema.safeParse(data);
    if (!parsed.success) return false;
    this.settings = parsed.data;
    return true;
  }

  protected override onDestroy(): void { this.reset(); }
}

export abstract class CameraPostFX extends CameraEffect {
  contribute(_frame: CameraLayerEffects): void {}
}

export class DepthBlurFX extends CameraPostFX {
  constructor(readonly settings: EffectData<'depth'>) { super(); }

  override contribute(frame: CameraLayerEffects) {
    if (this.settings.enabled) (frame.optics ??= []).push(this.settings);
  }
}

export class CurveFX extends CameraPostFX {
  private readonly layerDepth = Symbol('Curve depth');

  constructor(readonly settings: EffectData<'curve'>) { super(); }

  protected override dependencies() {
    return this.settings.useDepth ? [{
      key: this.layerDepth,
      create: () => new DepthBlurFX({ type: 'depth', enabled: true, useDepth: true, scale: 0, distance: 0,
        distribution: this.settings.distribution, filter: 'none', strength: 25 }),
    }] : [];
  }

  override updateSettings(data: CameraPostFXData) {
    if (data.type !== 'curve' || data.useDepth !== this.settings.useDepth) return false;
    return super.updateSettings(data);
  }

  override contribute(frame: CameraLayerEffects) {
    (frame.optics ??= []).push(this.settings);
  }
}

export class TiltShiftFX extends CameraPostFX {
  constructor(readonly settings: EffectData<'tiltShift'>) { super(); }

  override contribute(frame: CameraLayerEffects) {
    (frame.optics ??= []).push(this.settings);
  }
}

export class CameraShakeFX extends CameraPostFX {
  constructor(readonly settings: EffectData<'shake'>) { super(); }

  override contribute(frame: CameraLayerEffects) {
    if (this.settings.useDepth) frame.shakeLayers = true;
  }

  trigger(state: RuntimeCameraState, time: number) {
    if (!this.isAttached) return;
    const { amplitude, duration, rotation, ease, useDepth, distribution = 'none' } = this.settings;
    const shake = { startedAt: time, duration, amplitude, rotation, ease };
    if (useDepth) (state.layerShakes ??= []).push({ ...shake, distribution });
    else (state.shakes ??= []).push(shake);
  }
}

export class CameraZoomFX extends CameraPostFX {
  constructor(readonly settings: EffectData<'zoom'>) { super(); }
}

export class CameraLimitsFX extends CameraPostFX {
  constructor(readonly settings: EffectData<'limits'>) { super(); }
}

class CameraViewportFX extends CameraPostFX {
  constructor(readonly settings: EffectData<'viewport'>) { super(); }
}

class CameraFramingFX extends CameraPostFX {
  constructor(readonly settings: EffectData<'framing'>) { super(); }
}

export class CameraMotionFX extends CameraPostFX {
  constructor(readonly settings: CameraMotionData) { super(); }
}

class CameraFilterFX extends CameraPostFX {
  constructor(readonly settings: CameraFilterData) { super(); }

  override contribute(frame: CameraLayerEffects) {
    (frame.optics ??= []).push(this.settings);
  }
}

export function createCameraPostFX(data: CameraPostFXData): CameraPostFX {
  switch (data.type) {
    case 'tiltShift': return new TiltShiftFX(data);
    case 'depth': return new DepthBlurFX(data);
    case 'curve': return new CurveFX(data);
    case 'shake': return new CameraShakeFX(data);
    case 'zoom': return new CameraZoomFX(data);
    case 'limits': return new CameraLimitsFX(data);
    case 'viewport': return new CameraViewportFX(data);
    case 'framing': return new CameraFramingFX(data);
    case 'move': case 'follow': case 'focus': case 'rotate': return new CameraMotionFX(data);
    default: return new CameraFilterFX(data);
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
      if (effect instanceof CameraViewportFX) frame.viewportRelative = true;
      if (effect instanceof CameraFramingFX) frame.framing = effect.settings;
    }
    return frame;
  }

  motions(): CameraMotionData[] {
    return [...this.activeEffects()].flatMap(effect => effect instanceof CameraMotionFX ? [effect.settings] : []);
  }

  triggerShake(state: RuntimeCameraState, time: number) {
    state.shakes = [];
    state.layerShakes = [];
    for (const effect of this.activeEffects()) if (effect instanceof CameraShakeFX) effect.trigger(state, time);
  }

  remove(id: string) {
    this.effects.remove(id);
  }

  configure(data: readonly CameraPostFXData[] = [], previewKeys?: ReadonlySet<string>) {
    const enabled = effectEntries(data).filter(({ key, effect }) => effect.enabled && !previewKeys?.has(key));
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
      if (previous && previous.effect === this.get(id)) {
        if (previous.signature === signature) continue;
        if (previous.effect.updateSettings(settings)) {
          previous.signature = signature;
          continue;
        }
      }
      const effect = createCameraPostFX(settings);
      this.attach(id, effect);
      this.authored.set(id, { signature, effect });
    }
  }

  private *activeEffects() {
    const ordered = this.order.map(id => this.get(id));
    const authored = new Set(ordered);
    for (const effect of this.effects.values()) {
      if (effect instanceof CameraPostFX && effect.settings?.enabled !== false && !authored.has(effect)) yield effect;
    }
    for (const effect of ordered) if (effect instanceof CameraPostFX && effect.settings?.enabled !== false) yield effect;
  }

  apply(layers?: readonly Container[], perspectiveLayers?: readonly Container[], shakeLayers = false, filters?: CameraFilterContext) {
    const frame: CameraLayerEffects = { shakeLayers, filters };
    for (const effect of this.activeEffects()) effect.contribute(frame);
    this.camera.applyLayerEffects(frame, layers, perspectiveLayers);
  }

  destroy() {
    this.effects.clear();
    this.authored.clear();
    this.order = [];
  }
}
