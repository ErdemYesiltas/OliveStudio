import 'pixi.js/advanced-blend-modes';
import {BlurFilter, ColorMatrixFilter, Graphics, NoiseFilter, type BLEND_MODES, type Container, type Filter} from 'pixi.js';
import {DropShadowFilter} from 'pixi-filters/drop-shadow';
import {GlowFilter} from 'pixi-filters/glow';
import {OutlineFilter} from 'pixi-filters/outline';
import {PixelateFilter} from 'pixi-filters/pixelate';
import {z} from 'zod';
import {BaseEffect, EffectScope, effectEntries} from '@olivestudio/engine';
import type {ComponentDefinition, Json} from '@rewrite/sdk';
import type {DecoratedEntity, SceneDecorator} from './visuals';
import {createShaderFilter, resolveShader, shaderType} from './shaders';

/**
 * Per-entity look: blend mode and a filter stack (applied to the entity and its whole subtree), plus a shape mask.
 * Applied by a scene decorator shared by the editor viewport and the exported `effects` runtime chunk.
 */
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const blendModes = ['normal', 'add', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion'] as const;
export const EffectsSchema = z.object({
 blendMode: z.enum(blendModes), blur: z.number().min(0).max(100),
 brightness: z.number().min(0).max(3), contrast: z.number().min(0).max(3), saturation: z.number().min(0).max(3), hue: z.number().min(-180).max(180), noise: z.number().min(0).max(1),
 shadowAlpha: z.number().min(0).max(1), shadowColor: Color, shadowX: z.number().min(-500).max(500), shadowY: z.number().min(-500).max(500), shadowBlur: z.number().min(0).max(50),
 glowStrength: z.number().min(0).max(20), glowColor: Color, glowDistance: z.number().int().min(1).max(64),
 outlineWidth: z.number().min(0).max(32), outlineColor: Color, pixelate: z.number().min(0).max(256),
}).strict();
export type EffectsData = z.infer<typeof EffectsSchema>;
export const effectsDefaults: EffectsData = {blendMode: 'normal', blur: 0, brightness: 1, contrast: 1, saturation: 1, hue: 0, noise: 0, shadowAlpha: 0, shadowColor: '#000000', shadowX: 4, shadowY: 4, shadowBlur: 2, glowStrength: 0, glowColor: '#ffd27a', glowDistance: 12, outlineWidth: 0, outlineColor: '#ffffff', pixelate: 0};
export const MaskSchema = z.object({shape: z.enum(['rect', 'ellipse']), width: z.number().positive().max(10000), height: z.number().positive().max(10000), offsetX: z.number().min(-10000).max(10000), offsetY: z.number().min(-10000).max(10000), radius: z.number().min(0).max(5000), inverse: z.boolean()}).strict();
export type MaskData = z.infer<typeof MaskSchema>;

type Field = ComponentDefinition['fields'][number];
const n = (...keys: string[]): Field[] => keys.map(key => ({key, titleKey: `effects.${key}`, kind: 'number' as const}));
const on = (key: keyof EffectsData) => (v: Json) => Number((v as Record<string, Json> | null)?.[key]) > 0;
export const effectsDefinition: ComponentDefinition = {
 type: 'pixi.effects', version: 1, titleKey: 'component.effects', defaults: () => ({...effectsDefaults}), parse: v => EffectsSchema.parse(v) as Json,
 fields: [
  {key: 'blendMode', titleKey: 'effects.blendMode', kind: 'enum', options: blendModes.map(value => ({value, titleKey: `blend.${value}`}))},
  ...n('blur', 'brightness', 'contrast', 'saturation', 'hue', 'noise', 'pixelate', 'shadowAlpha'),
  {key: 'shadowColor', titleKey: 'effects.shadowColor', kind: 'color', visible: on('shadowAlpha')}, ...n('shadowX', 'shadowY', 'shadowBlur').map(f => ({...f, visible: on('shadowAlpha')})),
  ...n('glowStrength'), {key: 'glowColor', titleKey: 'effects.glowColor', kind: 'color', visible: on('glowStrength')}, {...n('glowDistance')[0], visible: on('glowStrength')},
  ...n('outlineWidth'), {key: 'outlineColor', titleKey: 'effects.outlineColor', kind: 'color', visible: on('outlineWidth')},
 ],
};
export const maskDefinition: ComponentDefinition = {
 type: 'pixi.mask', version: 1, titleKey: 'component.mask', defaults: () => ({shape: 'rect', width: 200, height: 200, offsetX: 0, offsetY: 0, radius: 0, inverse: false}), parse: v => MaskSchema.parse(v) as Json,
 fields: [{key: 'shape', titleKey: 'mask.shape', kind: 'enum', options: [{value: 'rect', titleKey: 'shape.rect'}, {value: 'ellipse', titleKey: 'shape.ellipse'}]}, ...['width', 'height', 'offsetX', 'offsetY', 'radius'].map(key => ({key, titleKey: `mask.${key}`, kind: 'number' as const, ...(key === 'radius' ? {visible: (v: Json) => (v as {shape?: string} | null)?.shape !== 'ellipse'} : {})})), {key: 'inverse', titleKey: 'mask.inverse', kind: 'boolean'}],
};

export type EffectKind = 'color' | 'blur' | 'outline' | 'glow' | 'shadow' | 'pixelate' | 'noise';
const visualSettings = {
 blend: EffectsSchema.pick({blendMode: true}), color: EffectsSchema.pick({brightness: true, contrast: true, saturation: true, hue: true}),
 blur: EffectsSchema.pick({blur: true}), outline: EffectsSchema.pick({outlineWidth: true, outlineColor: true}),
 glow: EffectsSchema.pick({glowStrength: true, glowColor: true, glowDistance: true}),
 shadow: EffectsSchema.pick({shadowAlpha: true, shadowColor: true, shadowX: true, shadowY: true, shadowBlur: true}),
 pixelate: EffectsSchema.pick({pixelate: true}), noise: EffectsSchema.pick({noise: true}),
};
export const visualEffectTypes = ['blend', 'color', 'blur', 'outline', 'glow', 'shadow', 'pixelate', 'noise'] as const;
function visualEffect<T extends keyof typeof visualSettings>(type: T) {
 return z.strictObject({type: z.literal(type), effectId: z.string().min(1).optional(), enabled: z.boolean().default(true), settings: visualSettings[type]});
}
export const VisualEffectSchema = z.discriminatedUnion('type', [
 visualEffect('blend'), visualEffect('color'), visualEffect('blur'), visualEffect('outline'),
 visualEffect('glow'), visualEffect('shadow'), visualEffect('pixelate'), visualEffect('noise'),
]);
export type VisualEffect = z.output<typeof VisualEffectSchema>;

function selectEffectSettings(type: VisualEffect['type'], settings: EffectsData) {
 return Object.fromEntries(Object.keys(visualSettings[type].shape).map(key => [key, settings[key as keyof EffectsData]]));
}

export function makeVisualEffect(type: VisualEffect['type']): VisualEffect {
 const settings: EffectsData = { ...effectsDefaults, blendMode: 'multiply', brightness: 1.2, blur: 4, outlineWidth: 2,
  glowStrength: 2, shadowAlpha: 0.5, pixelate: 6, noise: 0.15 };
 return VisualEffectSchema.parse({type, settings: selectEffectSettings(type, settings)});
}

export function migrateVisualEffects(input: unknown): unknown {
 if (Array.isArray(input)) return input;
 const old = EffectsSchema.safeParse(input);
 if (!old.success) return input;
 return visualEffectTypes.flatMap(type => {
  const settings = selectEffectSettings(type, old.data);
  return Object.entries(settings).some(([key, value]) => value !== effectsDefaults[key as keyof EffectsData]) ?
   [{type, enabled: true, settings}] : [];
 });
}

/** Filter kinds in a fixed order (colour → blur → outline/glow → shadow → pixelate → noise); neutral values add none. */
export function effectPlan(p: EffectsData): EffectKind[] {
 const plan: EffectKind[] = [];
 if (p.brightness !== 1 || p.contrast !== 1 || p.saturation !== 1 || p.hue !== 0) plan.push('color');
 if (p.blur > 0) plan.push('blur');
 if (p.outlineWidth > 0) plan.push('outline');
 if (p.glowStrength > 0) plan.push('glow');
 if (p.shadowAlpha > 0) plan.push('shadow');
 if (p.pixelate >= 2) plan.push('pixelate');
 if (p.noise > 0) plan.push('noise');
 return plan;
}
export function effectFilters(p: EffectsData): Filter[] {
 return effectPlan(p).map(kind => {
  switch (kind) {
   case 'color': {
    const m = new ColorMatrixFilter();
    if (p.brightness !== 1) m.brightness(p.brightness, true);
    if (p.contrast !== 1) m.contrast(p.contrast - 1, true);
    if (p.saturation !== 1) m.saturate(p.saturation - 1, true);
    if (p.hue !== 0) m.hue(p.hue, true);
    return m;
   }
   case 'blur': return new BlurFilter({strength: p.blur, quality: 4});
   case 'outline': return new OutlineFilter({thickness: p.outlineWidth, color: p.outlineColor, quality: 0.2});
   case 'glow': return new GlowFilter({outerStrength: p.glowStrength, distance: p.glowDistance, color: p.glowColor, quality: 0.2});
   case 'shadow': return new DropShadowFilter({offset: {x: p.shadowX, y: p.shadowY}, color: p.shadowColor, alpha: p.shadowAlpha, blur: p.shadowBlur});
   case 'pixelate': return new PixelateFilter(p.pixelate);
   case 'noise': return new NoiseFilter({noise: p.noise, seed: 0.5});
  }
 });
}

class ObjectFilterEffect extends BaseEffect<Container> {
 constructor(private readonly filter: Filter) { super(); }

 protected onAttach(view: Container) {
  view.filters = [...view.filters ?? [], this.filter];
  this.addTeardown(() => {
   if (!view.destroyed) {
    const remaining = view.filters?.filter(filter => filter !== this.filter);
    view.filters = remaining?.length ? remaining : null;
   }
   this.filter.destroy();
  });
 }
}

const blendOwners = new WeakMap<Container, {effect: ObjectBlendEffect; mode: BLEND_MODES}>();
class ObjectBlendEffect extends BaseEffect<Container> {
 constructor(private readonly mode: BLEND_MODES) { super(); }

 protected onAttach(view: Container) {
  const previous = blendOwners.get(view)?.mode ?? view.blendMode;
  blendOwners.set(view, {effect: this, mode: previous});
  view.blendMode = this.mode;
  this.addTeardown(() => {
   if (blendOwners.get(view)?.effect !== this) return;
   blendOwners.delete(view);
   if (!view.destroyed && view.blendMode === this.mode) view.blendMode = previous;
  });
 }
}

/**
 * The decorator both hosts use. Filters are cached per node and destroyed on change or `clear()`. `shaders` reads the
 * project's shader library so a `pixi.shader` component adds its custom filter last (WebGL only).
 */
export function createEffectsDecorator(options: {shaders?: () => unknown; shaderTime?: () => number} = {}): SceneDecorator & {remove(view: Container): void} {
 const applied = new Map<Container, {key: string; effects: string[]; mask?: Graphics}>();
 const remove = (view: Container) => {
  const entry = applied.get(view);
  if (!entry) return;
  applied.delete(view);
  const scope = EffectScope.for(view);
  for (const effect of entry.effects) scope.remove(effect);
  if (entry.mask && !entry.mask.destroyed) {
   if (!view.destroyed) view.mask = null;
   entry.mask.destroy();
  }
 };
 return {
  apply(entities: readonly DecoratedEntity[], node: (id: string) => Container | undefined, renderer?) {
   const library = options.shaders?.(), gpu = renderer?.name === 'webgpu';
   for (const e of entities) {
    const effects = e.components.find(c => c.type === 'pixi.effects' && c.version === 1), mask = e.components.find(c => c.type === 'pixi.mask' && c.version === 1), custom = e.components.find(c => c.type === shaderType && c.version === 1);
    if (!effects && !mask && !custom) continue;
    const view = node(e.id);
    if (!view || view.destroyed) continue;
    const shader = custom && !gpu && options.shaders ? resolveShader(library, custom.data) : null;
    const key = JSON.stringify([effects?.data ?? null, mask?.data ?? null, shader]), previous = applied.get(view);
    if (previous?.key === key) continue;
    if (previous) remove(view);
    const fx = effects ? VisualEffectSchema.array().safeParse(migrateVisualEffects(effects.data)) : null;
    const shape = mask ? MaskSchema.safeParse(mask.data) : null;
    const scope = EffectScope.for(view);
    const attached: string[] = [];
    const attach = (id: string, effect: BaseEffect<Container>) => {
     scope.attach(id, effect);
     attached.push(id);
    };
    for (const {effect, key} of effectEntries(fx?.success ? fx.data : [])) {
     if (!effect.enabled) continue;
     if (effect.type === 'blend') attach(key, new ObjectBlendEffect(effect.settings.blendMode));
     else for (const filter of effectFilters({...effectsDefaults, ...effect.settings})) attach(key, new ObjectFilterEffect(filter));
    }
    if (shader) attach(shaderType, new ObjectFilterEffect(createShaderFilter(shader.source, shader.data, options.shaderTime)));
    let graphic: Graphics | undefined;
    if (shape?.success) {
     const m = shape.data, x = m.offsetX - m.width / 2, y = m.offsetY - m.height / 2;
     graphic = new Graphics({label: 'mask'});
     if (m.shape === 'ellipse') graphic.ellipse(m.offsetX, m.offsetY, m.width / 2, m.height / 2); else graphic.roundRect(x, y, m.width, m.height, m.radius);
     graphic.fill(0xffffff);
     view.addChild(graphic);
     view.setMask({mask: graphic, inverse: m.inverse});
    }
    applied.set(view, {key, effects: attached, mask: graphic});
   }
  },
  remove,
  clear() { for (const view of applied.keys()) remove(view); },
 };
}
