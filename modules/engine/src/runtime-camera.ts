import {z} from 'zod';
import { applyCameraMotion, type CameraSubject, type CameraSubjectLookup } from './camera/cameraMotion.js';
import { cameraEaseProgress, defaultCameraEase, type CameraEase } from './camera/easing.js';

import { CameraPostFXsSchema, migrateCameraPostFXs, type CameraLimitsEffectData, type CameraMotionData, type CameraPostFXData, type CameraProjection } from './camera/postFXSettings.js';
export { cameraFilterControls, cameraFilterKinds, cameraFilterHasDepth, cameraFilterValue, isCameraFilter,
 type CameraFilterData, type CameraFilterKind } from './camera/filterSettings.js';
export { CameraPostFXSchema, cameraBlurFilters, migrateCameraProjection, migrateCameraEffects, cameraFrameDimensionMax, cameraFrameRatios,
 type CameraPostFXData, type CameraPostFXType, type CameraDepthBlur, type CameraMotionData, type CameraOpticalEffect } from './camera/postFXSettings.js';
export { applyCameraMotion, cameraSubjectFromDisplay, type CameraSubject } from './camera/cameraMotion.js';
export { cameraEases, cameraEaseProgress, defaultCameraEase, CameraEaseSchema, easeParameters, formatCameraEase, parseCameraEase,
 type CameraEase, type CameraEaseChoice } from './camera/easing.js';

/**
 * Scene camera (`pixi.camera2d`, at most one per scene): the object's position is the world point at the centre of the
 * game screen. Zoom > 1 magnifies; `rotate` turns the view with the object; `target` follows an object (plus offset)
 * with optional smoothing (per second, 0 = snap) and a dead zone; `limit` keeps the view inside a world rectangle.
 */
export const CameraSettingsSchema = z.object({
 zoom: z.number().min(.05).max(20).default(1),
 postFXs: CameraPostFXsSchema.optional(),
 priority: z.number().int().min(-10000).max(10000).optional(),
 minZoom: z.number().min(.05).max(20).optional(),
 maxZoom: z.number().min(.05).max(20).optional(),
 keepInView: z.boolean().optional(),
 safeMargin: z.number().min(0).max(1000).optional(),
 edgeLock: z.boolean().optional(),
 viewportRelative: z.boolean().optional(),
 rotate: z.boolean().default(false),
 target: z.string().default(''),
 offsetX: z.number().finite().min(-1e5).max(1e5).default(0),
 offsetY: z.number().finite().min(-1e5).max(1e5).default(0),
 smoothing: z.number().min(0).max(60).default(0),
 deadzoneWidth: z.number().min(0).max(1e5).default(0),
 deadzoneHeight: z.number().min(0).max(1e5).default(0),
 limit: z.boolean().default(false),
 limitLeft: z.number().finite().min(-1e6).max(1e6).default(0),
 limitTop: z.number().finite().min(-1e6).max(1e6).default(0),
 limitRight: z.number().finite().min(-1e6).max(1e6).default(1920),
 limitBottom: z.number().finite().min(-1e6).max(1e6).default(1080),
}).strict();
export const CameraSchema = z.preprocess(migrateCameraPostFXs, CameraSettingsSchema);
export const CameraEffectSettingsSchema = CameraSettingsSchema.omit({
 zoom: true, minZoom: true, maxZoom: true, edgeLock: true, limit: true,
 limitLeft: true, limitTop: true, limitRight: true, limitBottom: true,
 viewportRelative: true, rotate: true, target: true, offsetX: true, offsetY: true,
 smoothing: true, deadzoneWidth: true, deadzoneHeight: true, keepInView: true, safeMargin: true,
});
export type Camera = z.infer<typeof CameraSchema>;
type CameraFrameSettings = z.output<typeof CameraEffectSettingsSchema> &
 Partial<Omit<Camera, keyof z.output<typeof CameraEffectSettingsSchema>>>;

export function cameraProjection(camera?: CameraFrameSettings): CameraProjection {
 const effects = camera?.postFXs?.slice().reverse();
 const zoom = effects?.filter(effect => effect.type === 'zoom').find(effect => effect.enabled);
 const framing = effects?.find(effect => effect.type === 'framing' && effect.enabled);
 const limits = effects?.filter(effect => effect.type === 'limits').find(effect => effect.enabled);
 return {
  framing: framing?.type === 'framing' ? framing : undefined,
  viewportRelative: effects?.some(effect => effect.type === 'viewport') ?
   effects.some(effect => effect.type === 'viewport' && effect.enabled) : camera?.viewportRelative,
  zoom: zoom ?? (camera && !camera.postFXs?.some(effect => effect.type === 'zoom') && (camera.zoom !== undefined || camera.minZoom !== undefined || camera.maxZoom !== undefined) ?
   {type: 'zoom', enabled: true, value: camera.zoom ?? 1, min: camera.minZoom ?? .05, max: camera.maxZoom ?? 20} : undefined),
  limits: limits ?? (camera && !camera.postFXs?.some(effect => effect.type === 'limits') && (camera.limit || camera.edgeLock) ?
   {type: 'limits', enabled: true, mode: camera.limit ? 'rectangle' : 'world',
    left: camera.limitLeft ?? 0, top: camera.limitTop ?? 0, right: camera.limitRight ?? 1920, bottom: camera.limitBottom ?? 1080} : undefined),
 };
}

function limitRectangle({left, top, right, bottom}: CameraLimitsEffectData) {
 return {x: Math.min(left, right), y: Math.min(top, bottom), width: Math.abs(right - left), height: Math.abs(bottom - top)};
}
export const cameraType = 'pixi.camera2d';
interface Point {x: number; y: number}
/** What the game screen shows: the world point at its centre, magnification and rotation (degrees). */
export interface CameraView {x: number; y: number; zoom: number; rotation: number; frame?: CameraBounds}

export function cameraViewportFrame(stage: {width: number; height: number}, framing: CameraProjection['framing']): CameraBounds {
 const width = Math.min(stage.width, framing?.width ?? stage.width);
 const height = Math.min(stage.height, framing?.height ?? stage.height);
 return {x: (stage.width - width) / 2, y: (stage.height - height) / 2, width, height};
}
/**
 * Play state of the camera. `followId`: undefined = the Camera's own target, null = stop following. Scripts can
 * override zoom and point the camera somewhere (`lookAt`); `center`/`time` carry smoothing between frames.
 */
export type CameraShake = {startedAt: number; duration: number; amplitude: number; rotation?: number; ease?: CameraEase};
export type CameraLayerShake = CameraShake & {distribution: CameraEase};
export interface RuntimeCameraState {followId?: string | null; shake: CameraShake | null; shakes?: CameraShake[];
 layerShakes?: CameraLayerShake[]; zoom?: number; lookAt?: Point | null; center?: Point; time?: number; motionFrom?: CameraView;
 focus?: {id: string; target: CameraSubject}}
export const idleCamera = (): RuntimeCameraState => ({shake: null});
/** Rules and scripts use the same camera controls in Preview and in the player. */
export function cameraControls(state:()=>RuntimeCameraState,time:()=>number,view:()=>CameraView){
 return {
  follow(id:string|null){const camera=state();camera.followId=id;camera.lookAt=null;},
  shake(amplitude:number,duration:number){state().shake={startedAt:time(),duration,amplitude};},
  zoom(value:number){state().zoom=value;},
  lookAt(x:number,y:number){state().lookAt={x,y};},
  view(){const current=view();return {...current,zoom:state().zoom??current.zoom};},
 };
}
/** Forget smoothing (a new scene starts with the camera already in place). */
export const snapCamera = (state: RuntimeCameraState) => { delete state.center; delete state.time; delete state.motionFrom; delete state.focus; };

interface Pose {x: number; y: number; rotation: number}
interface CameraEntity {id: string; parentId: string | null; active: boolean; components: readonly {type: string; version: number; data: unknown}[]}
const poseOf = (e: CameraEntity): Pose & {scaleX: number; scaleY: number; pivotX: number; pivotY: number} => {
 const t = e.components.find(c => c.type === 'scene.transform2d')?.data as Partial<Pose & {scaleX: number; scaleY: number; pivotX: number; pivotY: number}> | undefined;
 return {x: Number(t?.x ?? 0), y: Number(t?.y ?? 0), rotation: Number(t?.rotation ?? 0), scaleX: Number(t?.scaleX ?? 1), scaleY: Number(t?.scaleY ?? 1), pivotX: Number(t?.pivotX ?? 0), pivotY: Number(t?.pivotY ?? 0)};
};
/** The scene's camera: its settings and world pose, or undefined when there is none or it (or a parent) is inactive. */
export function sceneCamera(entities: readonly CameraEntity[]): {entityId: string; camera: Camera; pose: Pose & {scaleX: number; scaleY: number}} | undefined {
 const e = entities.find(x => x.components.some(c => c.type === cameraType && c.version === 1));
 if (!e) return undefined;
 const byId = new Map(entities.map(x => [x.id, x])), chain: CameraEntity[] = [];
 for (let n: CameraEntity | undefined = e; n && chain.length < 128; n = n.parentId ? byId.get(n.parentId) : undefined) { if (!n.active) return undefined; chain.push(n); }
 let p = {x: poseOf(chain[0]).pivotX, y: poseOf(chain[0]).pivotY}, rotation = 0, scaleX = 1, scaleY = 1;
 for (const n of chain) { const t = poseOf(n), a = t.rotation * Math.PI / 180, x = (p.x - t.pivotX) * t.scaleX, y = (p.y - t.pivotY) * t.scaleY; p = {x: t.x + x * Math.cos(a) - y * Math.sin(a), y: t.y + x * Math.sin(a) + y * Math.cos(a)}; rotation += t.rotation; scaleX *= Math.abs(t.scaleX) || 1; scaleY *= Math.abs(t.scaleY) || 1; }
 const parsed = CameraSchema.safeParse(e.components.find(c => c.type === cameraType)!.data);
 return parsed.success ? {entityId: e.id, camera: parsed.data, pose: {...p, rotation, scaleX, scaleY}} : undefined;
}

export function resolveCameraFrame(state:RuntimeCameraState,time:number,stage:{width:number;height:number},entities:readonly CameraEntity[],position:CameraSubjectLookup,authoredSize=stage){
 const rig=sceneCamera(entities);
 return cameraView(state,time,stage,rig && {...rig,authoredSize},undefined,undefined,position);
}

const noise = (seed: number, t: number) => { const i = Math.floor(t), f = t - i, h = (n: number) => { const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }; const s = f * f * (3 - 2 * f); return h(i) * (1 - s) + h(i + 1) * s; };
const round = (v: number) => Math.round(v * 100) / 100;
export function applyCameraShake(view: CameraView, shake: CameraShake, time: number): CameraView {
 const elapsed = time - shake.startedAt;
 if (elapsed < 0 || elapsed >= shake.duration) return view;
 const k = Math.max(0, 1 - cameraEaseProgress(shake.ease ?? 'none', elapsed / shake.duration)), f = elapsed * 30;
 return {
  ...view,
  x: view.x + noise(1, f) * shake.amplitude * k / view.zoom,
  y: view.y + noise(2, f) * shake.amplitude * k / view.zoom,
  rotation: view.rotation + (shake.rotation ? noise(3, f) * shake.rotation * k : 0),
 };
}
const clampAxis = (c: number, half: number, lo: number, hi: number) => hi - lo <= half * 2 ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, c));
type CameraBounds = {x: number; y: number; width: number; height: number};

export function constrainCameraView(view: CameraView, stage: {width: number; height: number}, projection: CameraProjection, world?: CameraBounds): CameraView {
 const viewport = cameraViewportFrame(stage, projection.framing);
 const min = projection.zoom?.min ?? .05;
 const zoom = Math.max(min, Math.min(Math.max(min, projection.zoom?.max ?? 20), view.zoom));
 const limits = projection.limits?.mode === 'rectangle' ? limitRectangle(projection.limits) :
  projection.limits?.mode === 'world' ? world : undefined;
 if (!limits) return {...view, zoom};
 return {...view, zoom,
  x: clampAxis(view.x, viewport.width / 2 / zoom, limits.x, limits.x + limits.width),
  y: clampAxis(view.y, viewport.height / 2 / zoom, limits.y, limits.y + limits.height),
 };
}

/**
 * One camera step at `time` (seconds of play). Without a Camera the view centres the stage (or the followed object);
 * with one it starts at the camera object. `target` is the followed object's world position when it exists. Updates
 * the smoothing state, so call it once per drawn frame; Preview and exported games call the same function.
 */
export function cameraView(state: RuntimeCameraState, time: number, stage: {width: number; height: number},
 rig?: {camera: CameraFrameSettings; pose: Pose; projection?: CameraProjection; motions?: readonly CameraMotionData[];
  authoredSize?: {width: number; height: number}}, legacyTarget?: Point, world?: CameraBounds,
 subject?: CameraSubjectLookup): CameraView {
 const camera = rig?.camera;
 const projection = rig?.projection ?? cameraProjection(camera);
 const viewport = cameraViewportFrame(stage, projection.framing);
 const effects = rig?.motions ?? camera?.postFXs;
 const tracking = cameraTrackingEffect(effects) ?? camera;
 const rotation = rig && (usesObjectRotation(effects) || camera?.rotate) ? rig.pose.rotation : 0;
 const minZoom = projection.zoom?.min ?? .05, maxZoom = Math.max(minZoom, projection.zoom?.max ?? 20);
 const zoomEffect = projection.zoom;
 const authoredZoom = zoomEffect?.duration ? 1 + (zoomEffect.value - 1) *
  cameraEaseProgress(zoomEffect.ease ?? defaultCameraEase, time / zoomEffect.duration) : zoomEffect?.value ?? 1;
 let zoom = Math.max(minZoom, Math.min(maxZoom, state.zoom ?? authoredZoom));
 const targetId = state.followId === undefined ? tracking?.target : state.followId;
 const target = targetId && (legacyTarget ?? subject?.(targetId, false));
 const following = target && !state.lookAt;
 const authored = rig?.authoredSize;
 const offsetX = authored && projection.viewportRelative ? (stage.width - authored.width) / 2 : 0;
 const offsetY = authored && projection.viewportRelative ? (stage.height - authored.height) / 2 : 0;
 let desired: Point = state.lookAt ?? (rig ? {x: rig.pose.x + offsetX, y: rig.pose.y + offsetY} : {x: stage.width / 2, y: stage.height / 2});
 if (following) desired = {x: target.x + (tracking?.offsetX ?? 0), y: target.y + (tracking?.offsetY ?? 0)};
 const previous = state.center, dt = previous && state.time !== undefined ? Math.max(0, time - state.time) : 0;
 if (following && previous && tracking) {
  const dzx = (tracking.deadzoneWidth ?? 0) / 2 / zoom, dzy = (tracking.deadzoneHeight ?? 0) / 2 / zoom;
  desired = {x: desired.x > previous.x + dzx ? desired.x - dzx : desired.x < previous.x - dzx ? desired.x + dzx : previous.x, y: desired.y > previous.y + dzy ? desired.y - dzy : desired.y < previous.y - dzy ? desired.y + dzy : previous.y};
 }
 let center = desired;
 if (previous && tracking?.smoothing) { const k = 1 - Math.exp(-tracking.smoothing * dt); center = {x: previous.x + (desired.x - previous.x) * k, y: previous.y + (desired.y - previous.y) * k}; }
 const limits = projection.limits?.mode === 'rectangle' ? limitRectangle(projection.limits) :
  projection.limits?.mode === 'world' ? world : undefined;
 const unclamped = center;
 const clampCenter = () => limits ? {
  x: clampAxis(unclamped.x, viewport.width / 2 / zoom, limits.x, limits.x + limits.width),
  y: clampAxis(unclamped.y, viewport.height / 2 / zoom, limits.y, limits.y + limits.height),
 } : unclamped;
 center = clampCenter();
 if (following && tracking?.keepInView) {
  const margin = tracking.safeMargin ?? 0;
  const radians = rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const dx = target.x - center.x, dy = target.y - center.y;
  const x = Math.abs(dx * cos + dy * sin), y = Math.abs(-dx * sin + dy * cos);
  const fitX = x ? Math.max(0, viewport.width / 2 - margin) / x : zoom;
  const fitY = y ? Math.max(0, viewport.height / 2 - margin) / y : zoom;
  zoom = Math.max(minZoom, Math.min(zoom, fitX, fitY));
  center = clampCenter();
 }
 state.center = center; state.time = time;
 let view = {...center, zoom, rotation};
 if (effects?.length) {
  const from = state.motionFrom ??= view;
  let rotated = false, positioned = false;
  for (let index = effects.length - 1; index >= 0; index--) {
   const effect = effects[index];
   if (effect.type !== 'rotate' || !effect.enabled) continue;
   if (effect.mode === 'object') break;
   view = applyCameraMotion(view, from, effect, time, stage);
   rotated = true;
   break;
  }
  if (state.followId === undefined && !state.lookAt) {
   for (let index = effects.length - 1; index >= 0; index--) {
    const effect = effects[index];
    if (!effect.enabled || (effect.type !== 'move' && effect.type !== 'follow' && effect.type !== 'focus')) continue;
    if (effect.type === 'follow' && effect.mode === 'tracking') {
     if (following) break;
     continue;
    }
    let lookup = subject;
    if (effect.type === 'focus' && effect.target) {
     const id = effect.target;
     const target = state.focus?.id === id ? state.focus.target : subject?.(id, true);
     if (!target) continue;
     state.focus = {id, target};
     lookup = () => target;
    }
    const next = applyCameraMotion(view, from, effect, time, viewport, lookup);
    if (next === view) continue;
    view = state.zoom === undefined ? next : {...next, zoom: view.zoom};
    positioned = true;
    break;
   }
  }
  if (rotated || positioned) view = constrainCameraView(view, stage, projection, world);
 }
 if (state.shake) view = applyCameraShake(view, state.shake, time);
 for (const shake of state.shakes ?? []) view = applyCameraShake(view, shake, time);
 return {...view, x: round(view.x), y: round(view.y), ...(projection.framing ? {frame: viewport} : {})};
}
export function cameraTrackingEffect(effects: readonly CameraPostFXData[] = []) {
 for (let index = effects.length - 1; index >= 0; index--) {
  const effect = effects[index];
  if (effect.type === 'follow' && effect.mode === 'tracking' && effect.enabled) return effect;
 }
}

function usesObjectRotation(effects?: readonly CameraPostFXData[]) {
 return effects?.some(effect => effect.type === 'rotate' && effect.mode === 'object' && effect.enabled) ?? false;
}
/** Where the world container goes for a view: pivot at the view centre, placed at the stage centre. */
export const viewPlacement = (view: CameraView, stage: {width: number; height: number}) => ({pivot: {x: view.x, y: view.y}, position: {x: stage.width / 2, y: stage.height / 2}, scale: view.zoom, angle: -view.rotation});
/** The world shift for an unrotated, unzoomed view (what older diagnostics reported as the camera offset). */
export const viewOffset = (view: CameraView, stage: {width: number; height: number}) => ({x: round(stage.width / 2 - view.x * view.zoom), y: round(stage.height / 2 - view.y * view.zoom)});
/**
 * Editor gizmo: the screen frame and (when selected) the dead zone, in the camera object's local space so they follow
 * a drag; the limits rectangle stays in world pixels.
 */
export function cameraOutlines(rig: {entityId: string; camera: Camera; pose: Pose & {scaleX: number; scaleY: number}}, stage: {width: number; height: number}, selected: boolean): {entityId?: string; points: Point[]; color: string}[] {
 const {camera, pose} = rig, turn = camera.rotate || usesObjectRotation(camera.postFXs) ? 0 : -pose.rotation * Math.PI / 180;
 const tracking = cameraTrackingEffect(camera.postFXs) ?? camera;
 const dw = tracking.deadzoneWidth ?? 0, dh = tracking.deadzoneHeight ?? 0;
 const {zoom, limits, framing} = cameraProjection(camera);
 const viewport = cameraViewportFrame(stage, framing);
 const scale = Math.max(zoom?.min ?? .05, Math.min(zoom?.max ?? 20, zoom?.value ?? 1));
 const box = (w: number, h: number, cx: number, cy: number) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({x: cx + sx * w / 2, y: cy + sy * h / 2}));
 const local = (points: Point[]) => points.map(p => ({x: (p.x * Math.cos(turn) - p.y * Math.sin(turn)) / pose.scaleX, y: (p.x * Math.sin(turn) + p.y * Math.cos(turn)) / pose.scaleY}));
 const out: {entityId?: string; points: Point[]; color: string}[] = [{entityId: rig.entityId, points: local(box(viewport.width / scale, viewport.height / scale, 0, 0)), color: '#e6c84f'}];
 if (selected && tracking.target && (dw || dh)) out.push({entityId: rig.entityId, points: local(box(Math.max(1, dw / scale), Math.max(1, dh / scale), 0, 0)), color: '#9fd96a'});
 if (selected && limits?.mode === 'rectangle') { const {x,y,width,height} = limitRectangle(limits); out.push({points: box(width, height, x + width / 2, y + height / 2), color: '#d96a6a'}); }
 return out;
}
