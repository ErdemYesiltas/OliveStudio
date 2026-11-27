import { NetworkPlayerSchema } from '@rewrite/multiplayer/contracts';
import { LightSchema, LightingSchema } from '@rewrite/lighting';
import { cinematicsSchema } from './cinematics';
import { objectPhysicsSchema } from './physicsModel';
import { BehaviourSchema } from '@rewrite/scripts/contracts';
import { BehaviorSchema } from '@rewrite/behavior/contracts';
import { GraphSchema as LogicGraphSchema } from '@rewrite/interactions';
import { CharacterSchema } from '@rewrite/production-tools/contracts';
import { z } from 'zod';
import { CameraEffectSettingsSchema, migrateCameraEffects } from '@olivestudio/engine/runtime-camera';
import { ScreenSpaceSchema } from '@olivestudio/engine/screen';
import { flexContainerSchema, flexItemSchema, type FlexContainer } from './layout';
import { ObjectEffectsSchema } from './objectEffects';
import { ShaderSchema } from '@rewrite/render-pixi/shaders';
import { widgetSchema } from '@olivestudio/engine/widgets';
import { addLibraryEntries, assetLibrarySchema, emptyLibrary, validateLibrary } from './assetLibrary';
import { importedAssetsSchema } from './assets';
import { audioOptions, audioSourceOptions } from './audio';
import { ConfigRegistry, rendererOptions, rendererSettings } from './config';
import { objectTypeKey, t } from './i18n';
import { timelineSchema } from './timeline';

export const configRegistry = new ConfigRegistry({})
  .register('renderer', rendererOptions, rendererSettings)
  .register('audio', audioOptions, {
    label: 'settingsAudio',
    fields: [
      { key: 'volume', label: 'audioMasterVolume', kind: 'number', min: 0, max: 1, step: 0.01 },
      { key: 'muted', label: 'audioMute', kind: 'boolean' },
      { key: 'music', label: 'audioBusMusic', kind: 'number', min: 0, max: 1, step: 0.01 },
      { key: 'sfx', label: 'audioBusEffects', kind: 'number', min: 0, max: 1, step: 0.01 },
      { key: 'ui', label: 'audioBusUI', kind: 'number', min: 0, max: 1, step: 0.01 },
    ],
  });

export const configSchema = configRegistry.schema.extend({ profiles: configRegistry.profiles.optional() });
export type SceneConfig = z.output<typeof configSchema>;
export type ResolvedSceneConfig = ReturnType<typeof configRegistry.resolve>;

const point = z.strictObject({ x: z.number(), y: z.number() });
const color = z.string().regex(/^#[\da-f]{6}$/i);
const prefabLinkSchema = z.strictObject({
  source: z.string().min(1),
  objects: z.record(z.string(), z.string().min(1)),
  tracks: z.record(z.string(), z.string().min(1)).default({}),
});
export type PrefabLink = z.output<typeof prefabLinkSchema>;
const common = {
  id: z.string().min(1),
  label: z.string().trim().min(1),
  position: point.default({ x: 0, y: 0 }),
  rotation: z.number().default(0),
  scale: point.default({ x: 1, y: 1 }),
  pivot: point.default({ x: 0, y: 0 }),
  skew: point.default({ x: 0, y: 0 }),
  visible: z.boolean().default(true),
  zIndex: z.number().int().min(-100000).max(100000).optional(),
  locked: z.boolean().optional(),
  behaviour: BehaviourSchema.optional(),
  behavior: BehaviorSchema.optional(),
  logicGraph: LogicGraphSchema.optional(),
  character: CharacterSchema.optional(),
  platform: z.strictObject({ width: z.number().positive().max(10000), height: z.number().positive().max(10000) }).optional(),
  brushId: z.uuid().optional(),
  physics: objectPhysicsSchema.optional(),
  networkPlayer: NetworkPlayerSchema.optional(),
  shadowCaster: z.enum(['off', 'bounds']).optional(),
  prefab: prefabLinkSchema.optional(),
  screenSpace: ScreenSpaceSchema.optional(),
  layoutItem: flexItemSchema.optional(),
  effects: ObjectEffectsSchema.optional(),
  alpha: z.number().min(0).max(1).default(1),
  tint: color.default('#ffffff'),
};
const base = z.strictObject({ ...common, shader: ShaderSchema.optional() });
const sprite = base.extend({
  type: z.literal('Sprite'),
  texture: z.string().min(1).nullable().default(null),
  anchor: point.default({ x: 0, y: 0 }),
});
const textFields = base.extend({
  text: z.string().default(t('defaultText')),
  anchor: point.default({ x: 0, y: 0 }),
  style: z.strictObject({
    fontFamily: z.string().trim().min(1).default('system-ui'),
    fontSize: z.number().min(0.01).default(36),
    fontWeight: z.enum(['normal', 'bold']).default('normal'),
    fill: color.default('#ffffff'),
    align: z.enum(['left', 'center', 'right']).default('left'),
  }).prefault({}),
});
const text = textFields.extend({ type: z.literal('Text') });
const bitmapText = textFields.extend({ type: z.literal('BitmapText') });
const dimensions = { width: z.number().positive().default(120), height: z.number().positive().default(80) };
const graphics = base.extend({
  type: z.literal('Graphics'),
  ...dimensions,
  shape: z.enum(['rectangle', 'ellipse']).default('rectangle'),
  fill: color.default('#79a784'),
});
const tiling = sprite.extend({
  type: z.literal('TilingSprite'),
  ...dimensions,
  tilePosition: point.default({ x: 0, y: 0 }),
  tileScale: point.default({ x: 1, y: 1 }),
});
const border = z.number().min(0).default(8);
const nineSlice = sprite.omit({ anchor: true }).extend({
  type: z.literal('NineSliceSprite'),
  ...dimensions,
  leftWidth: border, topHeight: border, rightWidth: border, bottomHeight: border,
});
const imageReference = z.string().min(1).nullable().default(null);
const meshPlane = base.extend({
  type: z.literal('MeshPlane'), texture: imageReference, ...dimensions,
  columns: z.number().int().min(2).max(64).default(8),
  rows: z.number().int().min(2).max(64).default(5),
  bend: z.number().min(-1024).max(1024).default(0),
});
const meshRope = base.extend({
  type: z.literal('MeshRope'), texture: imageReference,
  length: z.number().positive().default(160),
  thickness: z.number().positive().default(24),
  segments: z.number().int().min(2).max(64).default(12),
  bend: z.number().min(-1024).max(1024).default(24),
});
const tilemap = base.extend({
  type: z.literal('Tilemap'), texture: imageReference,
  collision: z.enum(['none', 'solid']).optional(),
  tileWidth: z.number().int().min(1).max(1024).default(16),
  tileHeight: z.number().int().min(1).max(1024).default(16),
  columns: z.number().int().min(1).max(32).default(4),
  rows: z.number().int().min(1).max(32).default(3),
  tiles: z.array(z.number().int().min(-1).max(65535)).max(1024).default([]),
}).refine(map => map.tiles.length <= map.columns * map.rows, { path: ['tiles'], message: t('tileCellCount') });
export const particleSettings = z.strictObject({
  count: z.number().int().min(1).max(500).default(48),
  lifetime: z.number().positive().max(30).default(1.5),
  speed: z.number().min(0).max(1000).default(65),
  speedVariance: z.number().min(0).max(1).default(0),
  size: z.number().positive().max(256).default(6),
  sizeVariance: z.number().min(0).max(1).default(0),
  lifetimeVariance: z.number().min(0).max(0.99).default(0),
  direction: z.number().default(-90),
  spread: z.number().min(0).max(360).default(45),
  emission: z.enum(['continuous', 'burst']).default('continuous'),
  frequency: z.number().min(0).max(30).default(0),
  waveSize: z.number().int().min(0).max(500).default(0),
  spawnChance: z.number().min(0).max(1).default(1),
  spawnShape: z.enum(['point', 'circle', 'rectangle']).default('point'),
  spawnRadius: z.number().min(1).max(1024).default(16),
  spawnWidth: z.number().min(1).max(2048).default(32),
  spawnHeight: z.number().min(1).max(2048).default(32),
  gravity: z.number().min(-2000).max(2000).default(0),
  rotationSpeed: z.number().min(-3600).max(3600).default(0),
  startAlpha: z.number().min(0).max(1).default(1),
  endAlpha: z.number().min(0).max(1).default(0),
  endScale: z.number().min(0).max(8).default(0.4),
  startColor: color.default('#ffffff'),
  endColor: color.default('#ffffff'),
});
const particles = base.extend({
  type: z.literal('Particles'),
  texture: imageReference,
  playing: z.boolean().default(true),
  ...particleSettings.shape,
});
export type ParticleObject = z.output<typeof particles>;
const animation = base.extend({
  asset: z.string().min(1).nullable().default(null),
  animation: z.string().min(1).nullable().default(null),
  playing: z.boolean().default(true),
  loop: z.boolean().default(true),
  speed: z.number().positive().max(120).default(1),
});
const animatedSprite = animation.extend({
  type: z.literal('AnimatedSprite'),
  anchor: point.default({ x: 0, y: 0 }),
  speed: animation.shape.speed.default(10),
});
const mixDuration = z.number().min(0);
const spineMix = z.strictObject({
  duration: mixDuration.default(0),
  pairs: z.array(z.strictObject({ from: z.string().min(1), to: z.string().min(1), duration: mixDuration })).default([]),
}).refine(mix => new Set(mix.pairs.map(pair => JSON.stringify([pair.from, pair.to]))).size === mix.pairs.length);
export type SpineMix = z.output<typeof spineMix>;
const spineCue = z.strictObject({
  animation: z.string().min(1),
  loop: z.boolean().default(false),
  delay: z.number().nonnegative().default(0),
});
const spinePlayback = z.strictObject({
  queue: z.array(spineCue).default([]),
  tracks: z.array(z.strictObject({ weight: z.number().min(0).max(1).default(1), clips: z.array(spineCue).min(1) })).default([]),
});
export type SpineCue = z.output<typeof spineCue>;
export type SpinePlayback = z.output<typeof spinePlayback>;
const spine = animation.extend({
  type: z.literal('Spine'),
  skin: z.string().min(1).nullable().default(null),
  skinLayers: z.array(z.string().min(1)).transform(names => [...new Set(names)]).optional(),
  mix: spineMix.optional(),
  playback: spinePlayback.optional(),
  eventAudio: z.record(z.string().min(1), z.string().min(1).nullable()).optional(),
});

const audioSource = base.extend({ type: z.literal('AudioSource'), ...audioSourceOptions.shape })
  .refine(source => source.minDistance < source.maxDistance, { path: ['maxDistance'], message: t('audioDistanceError') });
const audioListener = base.extend({ type: z.literal('AudioListener') });
const camera = base.extend({
  type: z.literal('Camera2D'),
  camera: z.preprocess(migrateCameraEffects, CameraEffectSettingsSchema).prefault({}),
});
export type CameraObject = z.output<typeof camera>;
export type AudioSourceObject = z.output<typeof audioSource>;

const pointLight = base.extend({
  type: z.literal('Light2D'),
  light: LightSchema.prefault({ color: '#ffd9a0', radius: 220, intensity: 1, flicker: 0, shadows: true }),
});

const uiWidget = base.extend({ type: z.literal('UIWidget'), widget: widgetSchema });
const leafSchemas = [sprite, text, bitmapText, graphics, tiling, nineSlice, meshPlane, meshRope, tilemap,
  particles, animatedSprite, spine, audioSource, audioListener, camera, pointLight, uiWidget] as const;
type LeafSchema = typeof leafSchemas[number];

const rigNodeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skeleton') }),
  z.object({ kind: z.literal('bone'), length: z.number().min(1).max(1000).default(48) }),
]);

const container = base.extend({
  type: z.literal('Container'),
  layout: flexContainerSchema.optional(),
  rig: rigNodeSchema.optional(),
  get children(): z.ZodDefault<z.ZodArray<z.ZodType<SceneObject, SceneObjectInput>>> {
    return z.array(objectSchema).default([]);
  },
});
export type SceneObject = z.output<LeafSchema> |
  (z.output<typeof base> & { type: 'Container'; children: SceneObject[]; layout?: FlexContainer; rig?: z.output<typeof rigNodeSchema> });
export type AnimationObject = Extract<SceneObject, { type: 'Spine' | 'AnimatedSprite' }>;
export function isAnimationObject(node: SceneObject): node is AnimationObject {
  return node.type === 'Spine' || node.type === 'AnimatedSprite';
}
type SceneObjectInput = z.input<LeafSchema> |
  (z.input<typeof base> & { type: 'Container'; children?: SceneObjectInput[]; layout?: z.input<typeof flexContainerSchema>; rig?: z.input<typeof rigNodeSchema> });
export const objectSchema = z.discriminatedUnion('type', [container, ...leafSchemas]);

export const sceneContentFields = {
  objects: z.array(objectSchema),
  timeline: timelineSchema.default([]),
  cinematics: cinematicsSchema.optional(),
  lighting: LightingSchema.optional(),
};

export const projectSharedFields = {
  config: configSchema.prefault({}),
  assets: importedAssetsSchema.default([]),
  assetLibrary: assetLibrarySchema.optional(),
};

export function checkObjectIds(nodes: readonly SceneObject[], ctx: z.RefinementCtx, path: (string | number)[], ids = new Set<string>()) {
  nodes.forEach((node, index) => {
    if (ids.has(node.id)) ctx.addIssue({ code: 'custom', path: [...path, index, 'id'], message: t('duplicateId') });
    ids.add(node.id);
    if (node.type === 'Container') checkObjectIds(node.children, ctx, [...path, index, 'children'], ids);
  });
}

export function checkShared(scene: z.output<z.ZodObject<typeof projectSharedFields>>, ctx: z.RefinementCtx) {
  if (scene.assetLibrary && !validateLibrary(scene.assetLibrary, new Set(scene.assets.map(asset => asset.alias)))) {
    ctx.addIssue({ code: 'custom', path: ['assetLibrary'], message: t('invalidAssetLibrary') });
  }
}

export function normalizeShared<Doc extends z.output<z.ZodObject<typeof projectSharedFields>>>(doc: Doc) {
  return { ...doc, assetLibrary: addLibraryEntries(doc.assetLibrary ?? emptyLibrary, doc.assets.map(asset => asset.alias), null) };
}

export const sceneSchema = z.strictObject({ version: z.literal(1), ...projectSharedFields, ...sceneContentFields })
  .superRefine((scene, ctx) => {
    checkObjectIds(scene.objects, ctx, ['objects']);
    checkShared(scene, ctx);
  }).transform(normalizeShared);

export type Scene = z.output<typeof sceneSchema>;

export function validationMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues.flatMap(issue => {
      if (issue.code === 'unrecognized_keys') {
        return issue.keys.map(key => `${[...issue.path, key].join('.')}: ${t('unknownField')}`);
      }
      return `${issue.path.join('.') || t('scene')}: ${issue.message}`;
    }).join('\n');
  }
  return error instanceof Error ? error.message : String(error);
}

export function createObject<Type extends SceneObject['type']>(type: Type): Extract<SceneObject, { type: Type }> {
  return objectSchema.parse({ id: crypto.randomUUID(), type, label: t(objectTypeKey[type]), position: { x: 32, y: 32 } }) as
    Extract<SceneObject, { type: Type }>;
}

export function findObject(nodes: readonly SceneObject[], id: string | null): SceneObject | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === 'Container') {
      const match = findObject(node.children, id);
      if (match) return match;
    }
  }
}

export function changeObject(
  nodes: SceneObject[],
  id: string,
  change: (node: SceneObject) => SceneObject | null,
): SceneObject[] {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.id === id) {
      const next = change(node);
      return next === node ? nodes : [...nodes.slice(0, index), ...(next ? [next] : []), ...nodes.slice(index + 1)];
    }
    if (node.type === 'Container') {
      const children = changeObject(node.children, id, change);
      if (children !== node.children) return [...nodes.slice(0, index), { ...node, children }, ...nodes.slice(index + 1)];
    }
  }
  return nodes;
}

export type DropTarget = { id: string | null; placement: 'before' | 'inside' | 'after' };

function locate(nodes: SceneObject[], id: string, parent: string | null = null):
  { node: SceneObject; parent: string | null; index: number } | undefined {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.id === id) return { node, parent, index };
    if (node.type === 'Container') {
      const match = locate(node.children, id, node.id);
      if (match) return match;
    }
  }
}

export function moveObject(nodes: SceneObject[], id: string, destination: DropTarget): SceneObject[] {
  if (id === destination.id) return nodes;
  const source = locate(nodes, id);
  const target = destination.id === null ? undefined : locate(nodes, destination.id);
  if (!source || (destination.id !== null && !target)) return nodes;

  let parent: string | null = null;
  let index = nodes.length;
  if (target && destination.placement === 'inside') {
    if (target.node.type !== 'Container') return nodes;
    parent = target.node.id;
    index = target.node.children.length;
  } else if (target) {
    parent = target.parent;
    index = target.index + (destination.placement === 'after' ? 1 : 0);
  }
  if (source.node.type === 'Container' && (parent === id || findObject(source.node.children, parent))) return nodes;
  if (source.node.type === 'Container' && source.node.rig?.kind === 'bone' && source.parent !== parent) {
    const group = findObject(nodes, parent);
    if (group?.type !== 'Container' || !group.rig) return nodes;
  }
  if (source.parent === parent && source.index < index) index--;
  if (source.parent === parent && source.index === index) return nodes;

  const remaining = changeObject(nodes, id, () => null);
  const insert = (siblings: SceneObject[]) => [...siblings.slice(0, index), source.node, ...siblings.slice(index)];
  if (parent === null) return insert(remaining);
  return changeObject(remaining, parent, node => node.type === 'Container' ? { ...node, children: insert(node.children) } : node);
}

export const emptyScene = () => sceneSchema.parse({ version: 1, objects: [] });

export const sampleScene = sceneSchema.parse({
  version: 1,
  objects: [{
    type: 'Container', id: 'sample-stage', label: t('sampleGroup'),
    children: [{
      type: 'Sprite', id: 'sample-sprite', label: t('sampleSprite'), texture: 'images/olive-crystal.png',
      position: { x: 480, y: 226 }, scale: { x: 3, y: 3 }, anchor: { x: 0.5, y: 0.5 },
    }, {
      type: 'Text', id: 'sample-text', label: t('sampleHeading'), text: 'Olive Grove',
      position: { x: 480, y: 350 }, anchor: { x: 0.5, y: 0.5 },
      style: { fontSize: 42, fontWeight: 'bold', fill: '#ecf1d6' },
    }],
  }],
});
