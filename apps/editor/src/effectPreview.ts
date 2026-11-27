import { cameraFilterValue, defaultCameraEase, type CameraEase, type CameraMotionData,
  type CameraOpticalEffect, type CameraPostFXData } from '@olivestudio/engine/runtime-camera';
import type { ObjectEffectData } from './objectEffects';

export type LightPulsePreview = Extract<ObjectEffectData, { type: 'lightPulse' }>;
export type EffectPreviewSettings = CameraPostFXData | LightPulsePreview;
export type EffectPreviewMode = 'once' | 'loop';
export const effectPreviewKey = (id: string, key: string) => JSON.stringify([id, key]);
type PreviewBase = { id: string };
export type EffectPreview = PreviewBase & (
  | { type: 'shake'; duration: number; amplitude: number; rotation: number; ease?: CameraEase; useDepth?: boolean; distribution?: CameraEase }
  | { type: 'optics'; settings: CameraOpticalEffect }
  | { type: 'projection'; settings: Extract<CameraPostFXData, { type: 'viewport' | 'limits' | 'framing' }> }
  | { type: 'zoom'; zoom: number; min: number; max: number; transition: number; ease: CameraEase }
  | { type: 'motion'; motion: CameraMotionData }
  | { type: 'lightPulse'; amount: number; frequency: number }
);

export function effectPreviewFor(id: string, effect: EffectPreviewSettings): EffectPreview {
  switch (effect.type) {
    case 'lightPulse': case 'shake': return { ...effect, id };
    case 'zoom': return { type: 'zoom', id,
      transition: effect.duration ?? 0, zoom: effect.value, min: effect.min, max: effect.max, ease: effect.ease ?? defaultCameraEase };
    case 'move': case 'follow': case 'focus': case 'rotate':
      return { type: 'motion', id, motion: { ...effect, enabled: true } };
    case 'viewport': case 'limits': case 'framing':
      return { type: 'projection', id, settings: { ...effect, enabled: true } };
    default:
      return { type: 'optics', id, settings: { ...effect, enabled: true } };
  }
}

export function previewNeedsClock(effect: EffectPreview, elapsed: number) {
  switch (effect.type) {
    case 'projection': return false;
    case 'zoom': return elapsed < effect.transition;
    case 'motion': return (effect.motion.type === 'follow' && effect.motion.mode === 'tracking') || elapsed < effect.motion.duration;
    case 'optics': return effect.settings.type === 'shockwave' ? elapsed < (previewDuration(effect) ?? 0) :
      ['crt', 'glitch', 'heatHaze', 'reflection', 'parallax'].includes(effect.settings.type);
    case 'shake': return elapsed < effect.duration;
    default: return true;
  }
}

export function previewDuration(effect: EffectPreview) {
  switch (effect.type) {
    case 'shake': return effect.duration;
    case 'zoom': return effect.transition;
    case 'motion': return (effect.motion.type === 'follow' && effect.motion.mode === 'tracking') ||
      (effect.motion.type === 'rotate' && effect.motion.mode === 'object') ? undefined : effect.motion.duration;
    case 'optics': return effect.settings.type === 'shockwave' ? Number(cameraFilterValue(effect.settings, 'duration')) : undefined;
  }
}

export const defaultPreviewMode = (effect: EffectPreviewSettings): EffectPreviewMode =>
  effect.type === 'shake' || effect.type === 'shockwave' ? 'loop' : 'once';

export function previewEffectType(effect: EffectPreview) {
  if (effect.type === 'motion') return effect.motion.type;
  if (effect.type === 'optics' || effect.type === 'projection') return effect.settings.type;
  return effect.type;
}
