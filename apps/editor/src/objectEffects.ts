import { BaseEffect, uniqueEffectIds } from '@olivestudio/engine';
import { VisualEffectSchema, makeVisualEffect, migrateVisualEffects, visualEffectTypes } from '@rewrite/render-pixi/effects';
import type { Container } from 'pixi.js';
import { z } from 'zod';
import type { SceneObject } from './scene';

const enabled = z.boolean().default(true);
const effectId = z.string().min(1).optional();
const gain = z.strictObject({ type: z.literal('audioGain'), enabled, effectId,
  gain: z.number().min(0).max(4).default(1.5) });
const offset = z.strictObject({ type: z.literal('listenerOffset'), enabled, effectId,
  x: z.number().min(-1000).max(1000).default(32), y: z.number().min(-1000).max(1000).default(0) });
const pulse = z.strictObject({ type: z.literal('lightPulse'), enabled, effectId,
  amount: z.number().min(0).max(1).default(0.4), frequency: z.number().min(0.1).max(10).default(1) });
const modulationSchema = z.discriminatedUnion('type', [gain, offset, pulse]);
type Modulation = z.output<typeof modulationSchema>;
const objectEffectSchema = z.discriminatedUnion('type', [...VisualEffectSchema.options, ...modulationSchema.options]);
export type ObjectEffectData = z.output<typeof objectEffectSchema>;
export const ObjectEffectsSchema = z.preprocess(migrateVisualEffects, objectEffectSchema.array().refine(
  uniqueEffectIds, { message: 'Object effect IDs must be unique' },
));

export function effectTypesFor(type: SceneObject['type']): readonly ObjectEffectData['type'][] {
  switch (type) {
    case 'Camera2D': return [];
    case 'AudioSource': return ['audioGain'];
    case 'AudioListener': return ['listenerOffset'];
    case 'Light2D': return ['lightPulse'];
    default: return visualEffectTypes;
  }
}

export function makeObjectEffect(type: ObjectEffectData['type']): ObjectEffectData {
  switch (type) {
    case 'audioGain': return gain.parse({ type });
    case 'listenerOffset': return offset.parse({ type });
    case 'lightPulse': return pulse.parse({ type });
    default: return makeVisualEffect(type);
  }
}

export function isModulation(effect: ObjectEffectData): effect is Modulation {
  return effect.type === 'audioGain' || effect.type === 'listenerOffset' || effect.type === 'lightPulse';
}

const liveModulations = new WeakMap<Container, Set<Modulation>>();

export function objectModulations<T extends Modulation['type']>(target: Container, type: T): Extract<Modulation, { type: T }>[] {
  return [...liveModulations.get(target) ?? []].filter(
    (effect): effect is Extract<Modulation, { type: T }> => effect.type === type,
  );
}

export class ObjectModulationEffect extends BaseEffect<Container> {
  constructor(private readonly data: Modulation) { super(); }

  protected onAttach(target: Container) {
    const effects = liveModulations.get(target) ?? new Set<Modulation>();
    effects.add(this.data);
    liveModulations.set(target, effects);
    const destroy = () => this.destroy();
    target.once('destroyed', destroy);
    this.addTeardown(() => {
      effects.delete(this.data);
      if (!effects.size) liveModulations.delete(target);
      target.off('destroyed', destroy);
    });
  }
}
