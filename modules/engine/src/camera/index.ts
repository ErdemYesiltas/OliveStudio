export { Camera } from './Camera.js';
export { CameraPlugin } from './CameraPlugin.js';
export { CameraService } from './CameraService.js';
export { CameraStrategy, type CameraStep } from './CameraStrategy.js';
export type { CameraCurveOptions, CameraDepthOptions, CameraLayerEffects, CameraTheaterCurvature, CameraTheaterOptions } from './CameraDepth.js';
export { BaseEffect, EffectScope, type EffectDependency, type EffectKey } from '../effects/BaseEffect.js';
export { CameraEffect, CameraPostFX, CameraPostFXs, createCameraPostFX, CameraShakeFX, CameraZoomFX, CameraLimitsFX, CameraMotionFX, CurveFX, DepthBlurFX, TiltShiftFX } from './CameraPostFXs.js';
export type {
  CameraOptions,
  CameraTweenOptions,
  CameraFocusOptions,
  CameraShakeOptions,
  CameraFollowOptions,
  CameraMoveResult,
} from './types.js';

export { CameraFrameClip } from './CameraFrameClip.js';
