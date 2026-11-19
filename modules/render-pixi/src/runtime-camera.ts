import {z} from 'zod';
/**
 * Scene camera (`pixi.camera2d`, at most one per scene): the object's position is the world point at the centre of the
 * game screen. Zoom > 1 magnifies; `rotate` turns the view with the object; `target` follows an object (plus offset)
 * with optional smoothing (per second, 0 = snap) and a dead zone; `limit` keeps the view inside a world rectangle.
 */
export const CameraSchema = z.object({
 zoom: z.number().min(.05).max(20).default(1),
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
export type Camera = z.infer<typeof CameraSchema>;
export const cameraType = 'pixi.camera2d';
interface Point {x: number; y: number}
/** What the game screen shows: the world point at its centre, magnification and rotation (degrees). */
export interface CameraView {x: number; y: number; zoom: number; rotation: number}
/**
 * Play state of the camera. `followId`: undefined = the Camera's own target, null = stop following. Scripts can
 * override zoom and point the camera somewhere (`lookAt`); `center`/`time` carry smoothing between frames.
 */
export interface RuntimeCameraState {followId?: string | null; shake: {startedAt: number; duration: number; amplitude: number} | null; zoom?: number; lookAt?: Point | null; center?: Point; time?: number}
export const idleCamera = (): RuntimeCameraState => ({shake: null});
/** Forget smoothing (a new scene starts with the camera already in place). */
export const snapCamera = (state: RuntimeCameraState) => { delete state.center; delete state.time; };

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

const noise = (seed: number, t: number) => { const i = Math.floor(t), f = t - i, h = (n: number) => { const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }; const s = f * f * (3 - 2 * f); return h(i) * (1 - s) + h(i + 1) * s; };
const round = (v: number) => Math.round(v * 100) / 100;
const clampAxis = (c: number, half: number, lo: number, hi: number) => hi - lo <= half * 2 ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, c));

/**
 * One camera step at `time` (seconds of play). Without a Camera the view centres the stage (or the followed object);
 * with one it starts at the camera object. `target` is the followed object's world position when it exists. Updates
 * the smoothing state, so call it once per drawn frame; Preview and exported games call the same function.
 */
export function cameraView(state: RuntimeCameraState, time: number, stage: {width: number; height: number}, rig?: {camera: Camera; pose: Pose}, target?: Point): CameraView {
 const camera = rig?.camera, zoom = Math.max(.05, Math.min(20, state.zoom ?? camera?.zoom ?? 1)), rotation = camera?.rotate && rig ? rig.pose.rotation : 0;
 const following = (state.followId === undefined ? camera?.target || null : state.followId) && target && !state.lookAt;
 let desired: Point = state.lookAt ?? (rig ? {x: rig.pose.x, y: rig.pose.y} : {x: stage.width / 2, y: stage.height / 2});
 if (following) desired = {x: target.x + (camera?.offsetX ?? 0), y: target.y + (camera?.offsetY ?? 0)};
 const previous = state.center, dt = previous && state.time !== undefined ? Math.max(0, time - state.time) : 0;
 if (following && previous && camera) {
  const dzx = camera.deadzoneWidth / 2 / zoom, dzy = camera.deadzoneHeight / 2 / zoom;
  desired = {x: desired.x > previous.x + dzx ? desired.x - dzx : desired.x < previous.x - dzx ? desired.x + dzx : previous.x, y: desired.y > previous.y + dzy ? desired.y - dzy : desired.y < previous.y - dzy ? desired.y + dzy : previous.y};
 }
 let center = desired;
 if (previous && camera && camera.smoothing > 0) { const k = 1 - Math.exp(-camera.smoothing * dt); center = {x: previous.x + (desired.x - previous.x) * k, y: previous.y + (desired.y - previous.y) * k}; }
 if (camera?.limit) center = {x: clampAxis(center.x, stage.width / 2 / zoom, Math.min(camera.limitLeft, camera.limitRight), Math.max(camera.limitLeft, camera.limitRight)), y: clampAxis(center.y, stage.height / 2 / zoom, Math.min(camera.limitTop, camera.limitBottom), Math.max(camera.limitTop, camera.limitBottom))};
 state.center = center; state.time = time;
 let {x, y} = center;
 const s = state.shake;
 if (s && time >= s.startedAt && time < s.startedAt + s.duration) {
  const k = 1 - (time - s.startedAt) / s.duration, f = (time - s.startedAt) * 30;
  x += noise(1, f) * s.amplitude * k / zoom; y += noise(2, f) * s.amplitude * k / zoom;
 }
 return {x: round(x), y: round(y), zoom, rotation};
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
 const {camera, pose} = rig, turn = camera.rotate ? 0 : -pose.rotation * Math.PI / 180;
 const box = (w: number, h: number, cx: number, cy: number) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({x: cx + sx * w / 2, y: cy + sy * h / 2}));
 const local = (points: Point[]) => points.map(p => ({x: (p.x * Math.cos(turn) - p.y * Math.sin(turn)) / pose.scaleX, y: (p.x * Math.sin(turn) + p.y * Math.cos(turn)) / pose.scaleY}));
 const out: {entityId?: string; points: Point[]; color: string}[] = [{entityId: rig.entityId, points: local(box(stage.width / camera.zoom, stage.height / camera.zoom, 0, 0)), color: '#e6c84f'}];
 if (selected && camera.target && (camera.deadzoneWidth || camera.deadzoneHeight)) out.push({entityId: rig.entityId, points: local(box(Math.max(1, camera.deadzoneWidth / camera.zoom), Math.max(1, camera.deadzoneHeight / camera.zoom), 0, 0)), color: '#9fd96a'});
 if (selected && camera.limit) { const l = Math.min(camera.limitLeft, camera.limitRight), r = Math.max(camera.limitLeft, camera.limitRight), t = Math.min(camera.limitTop, camera.limitBottom), b = Math.max(camera.limitTop, camera.limitBottom); out.push({points: box(r - l, b - t, (l + r) / 2, (t + b) / 2), color: '#d96a6a'}); }
 return out;
}
