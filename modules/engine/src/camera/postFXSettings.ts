import { z } from 'zod';
import { uniqueEffectIds } from '../effects/identity.js';
import { CameraEaseSchema, defaultCameraEase } from './easing.js';
import { cameraFilterSchemas, type CameraFilterData } from './filterSettings.js';

const enabled = z.boolean().default(true);
const effectId = z.string().min(1).optional();
const depthOptions = {
  useDepth: z.boolean().default(false),
  scale: z.number().min(0).max(100).default(16),
  distance: z.number().min(0).max(240).default(32),
  distribution: CameraEaseSchema.default('none'),
};
const curve = z.strictObject({
  type: z.literal('curve'),
  enabled, effectId,
  angle: z.number().min(0).max(90).default(0),
  direction: z.enum(['concave', 'convex']).default('concave'),
  ...depthOptions,
  scale: depthOptions.scale.default(0),
  distance: depthOptions.distance.default(0),
});
const perspective = z.strictObject({
  type: z.literal('perspective'),
  enabled, effectId,
  scale: z.number().min(0).max(100).default(16),
  distance: z.number().min(0).max(240).default(32),
  zIndex: z.number().int().min(-32).max(32).default(1),
});

export const cameraBlurFilters = ['none', 'gaussian', 'kawase', 'motion'] as const;
const depth = z.strictObject({
  type: z.literal('depth'),
  enabled, effectId,
  filter: z.enum(cameraBlurFilters).default('none'),
  strength: z.number().min(0).max(100).default(25),
  ...depthOptions,
});
const tiltShift = z.strictObject({
  type: z.literal('tiltShift'), enabled, effectId,
  blur: z.number().min(0).max(40).default(12),
  gradient: z.number().min(1).max(480).default(120),
  focus: z.number().min(0).max(100).default(50),
  angle: z.number().min(-90).max(90).default(0),
  useDepth: z.boolean().optional(),
  distribution: CameraEaseSchema.optional(),
});
const shake = z.strictObject({
  type: z.literal('shake'),
  enabled, effectId,
  amplitude: z.number().min(0).max(500).default(12),
  duration: z.number().min(0.05).max(10).default(0.35),
  rotation: z.number().min(0).max(90).default(0),
  ease: CameraEaseSchema.optional(),
  useDepth: z.boolean().optional(),
  distribution: CameraEaseSchema.optional(),
});
const zoomLevel = z.number().min(0.05).max(20);
const zoom = z.strictObject({
  type: z.literal('zoom'), enabled, effectId,
  value: zoomLevel.default(1), min: zoomLevel.default(0.05), max: zoomLevel.default(20),
  duration: z.number().min(0).max(10).optional(), ease: CameraEaseSchema.optional(),
});
const coordinate = z.number().min(-1e6).max(1e6);
const motionTiming = { enabled, effectId,
  duration: z.number().min(0).max(10).default(1), ease: CameraEaseSchema.default(defaultCameraEase) };
const move = z.strictObject({
  type: z.literal('move'), ...motionTiming,
  x: coordinate.default(600), y: coordinate.default(320),
});
const follow = z.strictObject({
  type: z.literal('follow'), ...motionTiming, target: z.string().default(''),
  offsetX: coordinate.default(0), offsetY: coordinate.default(0),
  mode: z.enum(['eased', 'tracking']).optional(),
  smoothing: z.number().min(0).max(60).optional(),
  deadzoneWidth: z.number().min(0).max(1e5).optional(),
  deadzoneHeight: z.number().min(0).max(1e5).optional(),
  keepInView: z.boolean().optional(),
  safeMargin: z.number().min(0).max(1000).optional(),
});
const focus = z.strictObject({
  type: z.literal('focus'), ...motionTiming, target: z.string().default(''),
  padding: z.number().min(0).max(2000).default(24),
});
const rotate = z.strictObject({
  type: z.literal('rotate'), ...motionTiming, angle: z.number().min(-360).max(360).default(45),
  mode: z.enum(['angle', 'object']).optional(),
});
const viewport = z.strictObject({ type: z.literal('viewport'), enabled, effectId });
export const cameraFrameDimensionMax = 4096;
export const cameraFrameRatios = {
  desktop: ['16:9', '16:10', '21:9', '32:9'],
  tablet: ['4:3', '3:4', '3:2', '2:3', '5:3', '3:5', '10:16'],
  phone: ['9:16', '18:9', '9:18', '19.5:9', '9:19.5', '20:9', '9:20', '9:21'],
  foldable: ['1:1', '6:5', '5:6'],
} as const;
const cameraFrameRatio = z.enum(Object.values(cameraFrameRatios).flat());
const framing = z.strictObject({
  type: z.literal('framing'), enabled, effectId,
  width: z.number().int().min(1).max(cameraFrameDimensionMax).default(640),
  height: z.number().int().min(1).max(cameraFrameDimensionMax).default(360),
  aspectRatio: cameraFrameRatio.nullable().optional(),
});
const limits = z.strictObject({
  type: z.literal('limits'), enabled, effectId, mode: z.enum(['world', 'rectangle']).default('rectangle'),
  left: coordinate.default(0), top: coordinate.default(0), right: coordinate.default(1920), bottom: coordinate.default(1080),
});
export const CameraPostFXSchema = z.discriminatedUnion('type', [depth, curve, tiltShift, shake, zoom, limits, move, follow, focus, rotate, viewport, framing, ...cameraFilterSchemas]);
export const CameraPostFXsSchema = z.array(CameraPostFXSchema).refine(
  uniqueEffectIds, { message: 'Camera effect IDs must be unique' },
);
export type CameraPostFXData = z.output<typeof CameraPostFXSchema>;
export type CameraPostFXType = CameraPostFXData['type'];
export type CameraOpticalEffect = Extract<CameraPostFXData, { type: 'curve' | 'depth' | 'tiltShift' }> | CameraFilterData;
export type CameraMotionData = Extract<CameraPostFXData, { type: 'move' | 'follow' | 'focus' | 'rotate' }>;
export type CameraCurveOptions = Pick<z.output<typeof curve>, 'angle' | 'direction'>;
export type CameraDepthBlur = Pick<z.output<typeof depth>, 'filter' | 'strength'>;
export type CameraZoomEffectData = z.output<typeof zoom>;
export type CameraLimitsEffectData = z.output<typeof limits>;
export type CameraProjection = { zoom?: CameraZoomEffectData; limits?: CameraLimitsEffectData; viewportRelative?: boolean; framing?: z.output<typeof framing> };

export function migrateCameraPostFXs(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const { curve: legacyCurve, perspective: legacyPerspective, depth: legacyDepth,
    shakeAmplitude, shakeDuration, shakeRotation, postFXs, ...camera } =
    input as Record<string, unknown>;
  const legacyEntries = [legacyCurve, legacyPerspective, legacyDepth, shakeAmplitude, shakeDuration, shakeRotation];
  if (postFXs === undefined && legacyEntries.every(value => value === undefined)) return input;
  if (postFXs !== undefined && !Array.isArray(postFXs)) return input;
  const legacy: CameraPostFXData[] = [];
  for (const [type, options] of [
    ['perspective', legacyPerspective], ['depth', legacyDepth], ['curve', legacyCurve],
  ] as const) {
    if (options === undefined) continue;
    if (!options || typeof options !== 'object' || Array.isArray(options)) return input;
    const parsed = migrateOptics({ enabled: type !== 'perspective', ...options, type });
    if (!parsed) return input;
    legacy.push(parsed);
  }
  if (shakeAmplitude !== undefined || shakeDuration !== undefined || shakeRotation !== undefined) {
    const parsed = shake.safeParse({ type: 'shake', amplitude: shakeAmplitude, duration: shakeDuration, rotation: shakeRotation });
    if (!parsed.success) return input;
    legacy.push(parsed.data);
  }
  const saved = (postFXs ?? []).map(migrateOptics);
  if (saved.some(effect => !effect)) return input;
  const validated = CameraPostFXsSchema.safeParse(saved);
  if (!validated.success) return input;
  const configured = new Set((postFXs ?? []).map(effect => effect.type));
  const appended = legacy.filter((effect, index) => {
    const migratedPerspective = legacyPerspective !== undefined && index === 0;
    return !configured.has(migratedPerspective ? 'perspective' : effect.type);
  });
  return { ...camera, postFXs: [...validated.data, ...appended] };
}

function migrateOptics(input: unknown): CameraPostFXData | undefined {
  if (!input || typeof input !== 'object' || !('type' in input)) return;
  if (input.type === 'perspective') {
    const parsed = perspective.safeParse(input);
    if (!parsed.success) return;
    const { enabled, effectId, scale, distance } = parsed.data;
    return curve.parse({ type: 'curve', enabled, effectId, angle: 0, useDepth: true, scale, distance });
  }
  const legacyLayerEffect = (input.type === 'curve' || input.type === 'depth') && !('useDepth' in input);
  const parsed = CameraPostFXSchema.safeParse(legacyLayerEffect ? { useDepth: true, scale: 0, distance: 0, ...input } : input);
  return parsed.success ? parsed.data : undefined;
}

export function migrateCameraProjection(input: unknown): unknown {
  const migrated = migrateCameraPostFXs(input);
  if (!migrated || typeof migrated !== 'object' || Array.isArray(migrated)) return migrated;
  const { zoom: value, minZoom: min, maxZoom: max, limit, edgeLock,
    limitLeft: left, limitTop: top, limitRight: right, limitBottom: bottom, postFXs, ...camera } =
    migrated as Record<string, unknown>;
  if ([value, min, max, limit, edgeLock, left, top, right, bottom].every(value => value === undefined)) return migrated;
  if ((limit !== undefined && typeof limit !== 'boolean') || (edgeLock !== undefined && typeof edgeLock !== 'boolean')) return migrated;
  const oldZoom = zoom.safeParse({ type: 'zoom', value, min, max });
  const oldLimits = limits.safeParse({
    type: 'limits', enabled: limit === true || edgeLock === true, mode: limit || !edgeLock ? 'rectangle' : 'world',
    left, top, right, bottom,
  });
  const effects = CameraPostFXsSchema.safeParse(postFXs ?? []);
  if (!oldZoom.success || !oldLimits.success || !effects.success || postFXs === null) return migrated;
  const next = [...effects.data];
  if (!next.some(effect => effect.type === 'zoom') && (oldZoom.data.value !== 1 || min !== undefined || max !== undefined)) next.push(oldZoom.data);
  if (!next.some(effect => effect.type === 'limits') && (oldLimits.data.enabled ||
      oldLimits.data.left !== 0 || oldLimits.data.top !== 0 || oldLimits.data.right !== 1920 || oldLimits.data.bottom !== 1080)) next.push(oldLimits.data);
  return next.length || postFXs !== undefined ? { ...camera, postFXs: next } : camera;
}

const legacyCameraBehavior = z.strictObject({
  viewportRelative: z.boolean().optional(), rotateView: z.boolean().optional(), target: z.string().optional(),
  offsetX: coordinate.min(-1e5).max(1e5).optional(), offsetY: coordinate.min(-1e5).max(1e5).optional(),
  smoothing: follow.shape.smoothing, deadzoneWidth: follow.shape.deadzoneWidth, deadzoneHeight: follow.shape.deadzoneHeight,
  keepInView: follow.shape.keepInView, safeMargin: follow.shape.safeMargin,
});

export function migrateCameraEffects(input: unknown): unknown {
  const migrated = migrateCameraProjection(input);
  if (!migrated || typeof migrated !== 'object' || Array.isArray(migrated)) return migrated;
  const { viewportRelative, rotate: rotateView, target, offsetX, offsetY, smoothing, deadzoneWidth, deadzoneHeight,
    keepInView, safeMargin, postFXs, ...camera } = migrated as Record<string, unknown>;
  const legacy = legacyCameraBehavior.safeParse({
    viewportRelative, rotateView, target, offsetX, offsetY, smoothing, deadzoneWidth, deadzoneHeight, keepInView, safeMargin,
  });
  const saved = CameraPostFXsSchema.safeParse(postFXs === undefined ? [] : postFXs);
  if (!legacy.success || !saved.success) return migrated;
  const effects = saved.data;
  const base: CameraPostFXData[] = [];
  if (viewportRelative && !effects.some(effect => effect.type === 'viewport')) base.push(viewport.parse({ type: 'viewport' }));
  if (rotateView && !effects.some(effect => effect.type === 'rotate' && effect.mode === 'object')) {
    base.push(rotate.parse({ type: 'rotate', mode: 'object', angle: 0, duration: 0 }));
  }
  if ((target || offsetX || offsetY || smoothing || deadzoneWidth || deadzoneHeight || keepInView || safeMargin) &&
      !effects.some(effect => effect.type === 'follow' && effect.mode === 'tracking')) {
    base.push(follow.parse({ type: 'follow', mode: 'tracking', duration: 0, target, offsetX, offsetY, smoothing,
      deadzoneWidth, deadzoneHeight, keepInView, safeMargin }));
  }
  return base.length || postFXs !== undefined ? { ...camera, postFXs: [...base, ...effects] } : camera;
}
