import { Emitter } from './Emitter.js';
import * as behaviors from './behaviors/index.js';

Emitter.registerBehavior(behaviors.AccelerationBehavior);
Emitter.registerBehavior(behaviors.AlphaBehavior);
Emitter.registerBehavior(behaviors.StaticAlphaBehavior);
Emitter.registerBehavior(behaviors.StaticAnchorBehavior);
Emitter.registerBehavior(behaviors.RandomAnimatedTextureBehavior);
Emitter.registerBehavior(behaviors.SingleAnimatedTextureBehavior);
Emitter.registerBehavior(behaviors.BurstSpawnBehavior);
Emitter.registerBehavior(behaviors.ColorBehavior);
Emitter.registerBehavior(behaviors.StaticColorBehavior);
Emitter.registerBehavior(behaviors.OrderedTextureBehavior);
Emitter.registerBehavior(behaviors.PointSpawnBehavior);
Emitter.registerBehavior(behaviors.RandomTextureBehavior);
Emitter.registerBehavior(behaviors.RotationBehavior);
Emitter.registerBehavior(behaviors.StaticRotationBehavior);
Emitter.registerBehavior(behaviors.NoRotationBehavior);
Emitter.registerBehavior(behaviors.ScaleBehavior);
Emitter.registerBehavior(behaviors.StaticScaleBehavior);
Emitter.registerBehavior(behaviors.ShapeSpawnBehavior);
Emitter.registerBehavior(behaviors.SingleTextureBehavior);
Emitter.registerBehavior(behaviors.SpeedBehavior);
Emitter.registerBehavior(behaviors.StaticSpeedBehavior);

export * as behaviors from './behaviors/index.js';
export * as ParticleUtils from './ParticleUtils.js';
export * from './Particle.js';
export * from './Emitter.js';
export { createParticleEmitter } from './createParticleEmitter.js';
export * from './EmitterConfig.js';
export * from './PropertyList.js';
export * from './PropertyNode.js';
export type {
  BehaviorType,
  BehaviorConfigs,
  BehaviorConfigRecord,
} from './behaviors/BehaviorTypes.js';
export type {
  ShapeType,
  ShapeConfigs,
  ShapeConfigRecord,
} from './behaviors/shapes/ShapeType.js';
