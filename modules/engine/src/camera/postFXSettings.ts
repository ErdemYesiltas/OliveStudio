import { z } from 'zod';
import { uniqueEffectIds } from '../effects/identity.js';

const enabled = z.boolean().default(true);
const effectId = z.string().min(1).optional();
const curve = z.strictObject({
  type: z.literal('curve'),
  enabled, effectId,
  angle: z.number().min(0).max(90).default(0),
  direction: z.enum(['concave', 'convex']).default('concave'),
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
});
const shake = z.strictObject({
  type: z.literal('shake'),
  enabled, effectId,
  amplitude: z.number().min(0).max(500).default(12),
  duration: z.number().min(0.05).max(10).default(0.35),
  rotation: z.number().min(0).max(90).default(0),
});
const zoomLevel = z.number().min(0.05).max(20);
const zoom = z.strictObject({
  type: z.literal('zoom'), enabled, effectId,
  value: zoomLevel.default(1), min: zoomLevel.default(0.05), max: zoomLevel.default(20),
});
const coordinate = z.number().min(-1e6).max(1e6);
const limits = z.strictObject({
  type: z.literal('limits'), enabled, effectId, mode: z.enum(['world', 'rectangle']).default('rectangle'),
  left: coordinate.default(0), top: coordinate.default(0), right: coordinate.default(1920), bottom: coordinate.default(1080),
});
export const CameraPostFXSchema = z.discriminatedUnion('type', [perspective, depth, curve, shake, zoom, limits]);
export const CameraPostFXsSchema = z.array(CameraPostFXSchema).refine(
  uniqueEffectIds, { message: 'Camera effect IDs must be unique' },
);
export type CameraPostFXData = z.output<typeof CameraPostFXSchema>;
export type CameraPostFXType = CameraPostFXData['type'];
export type CameraCurveOptions = Pick<z.output<typeof curve>, 'angle' | 'direction'>;
export type CameraDepthBlur = Pick<z.output<typeof depth>, 'filter' | 'strength'>;
export type CameraZoomEffectData = z.output<typeof zoom>;
export type CameraLimitsEffectData = z.output<typeof limits>;
export type CameraProjection = { zoom?: CameraZoomEffectData; limits?: CameraLimitsEffectData };

export function migrateCameraPostFXs(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const { curve: legacyCurve, perspective: legacyPerspective, depth: legacyDepth,
    shakeAmplitude, shakeDuration, shakeRotation, postFXs, ...camera } =
    input as Record<string, unknown>;
  if ([legacyCurve, legacyPerspective, legacyDepth, shakeAmplitude, shakeDuration, shakeRotation].every(value => value === undefined)) return input;

  const legacy: CameraPostFXData[] = [];
  for (const [type, options, schema] of [
    ['perspective', legacyPerspective, perspective],
    ['depth', legacyDepth, depth],
    ['curve', legacyCurve, curve],
  ] as const) {
    if (options === undefined) continue;
    if (!options || typeof options !== 'object' || Array.isArray(options)) return input;
    const parsed = schema.safeParse({ enabled: type !== 'perspective', ...options, type });
    if (!parsed.success) return input;
    legacy.push(parsed.data);
  }
  if (shakeAmplitude !== undefined || shakeDuration !== undefined || shakeRotation !== undefined) {
    const parsed = shake.safeParse({ type: 'shake', amplitude: shakeAmplitude, duration: shakeDuration, rotation: shakeRotation });
    if (!parsed.success) return input;
    legacy.push(parsed.data);
  }
  if (postFXs === undefined) return { ...camera, postFXs: legacy };
  const saved = CameraPostFXsSchema.safeParse(postFXs);
  if (!saved.success) return input;
  const configured = new Set(saved.data.map(effect => effect.type));
  return { ...camera, postFXs: [...saved.data, ...legacy.filter(effect => !configured.has(effect.type))] };
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
