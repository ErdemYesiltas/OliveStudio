import {it, expect} from 'vitest';
import {cameraView, cameraOutlines, idleCamera, sceneCamera, snapCamera, viewOffset, viewPlacement, CameraSchema, CameraEffectSettingsSchema, migrateCameraProjection, cameraType, type RuntimeCameraState} from './runtime-camera';

const stage = {width: 960, height: 540};
const entity = (id: string, t: Partial<{x: number; y: number; rotation: number; scaleX: number; scaleY: number}>, extra: {type: string; data: unknown}[] = [], parentId: string | null = null, active = true) =>
 ({id, parentId, active, components: [{type: 'scene.transform2d', version: 1, data: {x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ...t}}, ...extra.map(c => ({...c, version: 1}))]});
const cam = (data: Partial<ReturnType<typeof CameraSchema.parse>> = {}) => ({type: cameraType, data: CameraSchema.parse(data)});
const rigAt = (x: number, y: number, data: Partial<ReturnType<typeof CameraSchema.parse>> = {}, rotation = 0) => ({camera: CameraSchema.parse(data), pose: {x, y, rotation}});
/** Where a world point lands on the game screen for a view (the same transform Pixi applies to the world container). */
const toScreen = (view: ReturnType<typeof cameraView>, p: {x: number; y: number}) => { const t = viewPlacement(view, stage), a = t.angle * Math.PI / 180, dx = (p.x - t.pivot.x) * t.scale, dy = (p.y - t.pivot.y) * t.scale; return {x: t.position.x + dx * Math.cos(a) - dy * Math.sin(a), y: t.position.y + dx * Math.sin(a) + dy * Math.cos(a)}; };

it('without a camera the stage centre (or the followed object) is in the middle, as before', () => {
 expect(cameraView(idleCamera(), 0, stage)).toEqual({x: 480, y: 270, zoom: 1, rotation: 0});
 expect(viewOffset(cameraView({...idleCamera(), followId: 'p'}, 0, stage, undefined, {x: 1000, y: 270}), stage)).toEqual({x: -520, y: 0});
});

it('finds the one camera, its world pose through parents, and ignores inactive or invalid cameras', () => {
 const parent = entity('p', {x: 100, y: 50, rotation: 90, scaleX: 2, scaleY: 2}), camera = entity('c', {x: 10, y: 0, rotation: 15}, [cam({zoom: 2})], 'p');
 const found = sceneCamera([parent, camera, entity('o', {x: 5})]);
 expect(found?.entityId).toBe('c');
 expect(found?.pose.x).toBeCloseTo(100); expect(found?.pose.y).toBeCloseTo(70); expect(found?.pose.rotation).toBe(105); expect(found?.pose.scaleX).toBe(2);
 expect(sceneCamera([{...parent, active: false}, camera])).toBeUndefined();
 expect(sceneCamera([entity('c', {}, [{type: cameraType, data: {zoom: -1}}])])).toBeUndefined();
 expect(sceneCamera([entity('x', {})])).toBeUndefined();
});

it('looks from the camera object with its zoom and (optionally) rotation; the view centre lands on the screen centre', () => {
 const view = cameraView(idleCamera(), 0, stage, rigAt(1000, 300, {zoom: 2}, 30));
 expect(view).toEqual({x: 1000, y: 300, zoom: 2, rotation: 0});
 const turned = cameraView(idleCamera(), 0, stage, rigAt(1000, 300, {zoom: 2, rotate: true}, 30));
 expect(turned.rotation).toBe(30);
 const centre = toScreen(turned, {x: 1000, y: 300}); expect(centre.x).toBeCloseTo(480); expect(centre.y).toBeCloseTo(270);
 // Zoom 2: a point 100 px right of the centre in the world is 200 px right on screen.
 expect(toScreen(view, {x: 1100, y: 300}).x).toBeCloseTo(680);
});

it('follows its own target with an offset; rules can switch target or stop, scripts can look at a point and zoom', () => {
 const rig = rigAt(0, 0, {target: 'hero', offsetX: 50, offsetY: -20});
 expect(cameraView(idleCamera(), 0, stage, rig, {x: 400, y: 400})).toMatchObject({x: 450, y: 380});
 expect(cameraView({...idleCamera(), followId: null}, 0, stage, rig, {x: 400, y: 400})).toMatchObject({x: 0, y: 0});
 expect(cameraView({...idleCamera(), followId: 'other'}, 0, stage, rig, {x: 10, y: 10})).toMatchObject({x: 60, y: -10});
 expect(cameraView({...idleCamera(), lookAt: {x: 7, y: 8}, zoom: 3}, 0, stage, rig, {x: 400, y: 400})).toEqual({x: 7, y: 8, zoom: 3, rotation: 0});
 // A missing target leaves the camera where it is.
 expect(cameraView(idleCamera(), 0, stage, rig)).toMatchObject({x: 0, y: 0});
});

it('holds still while the target moves inside the dead zone and drags at its edge', () => {
 const rig = rigAt(0, 0, {target: 'hero', deadzoneWidth: 200, deadzoneHeight: 100}), state: RuntimeCameraState = idleCamera();
 cameraView(state, 0, stage, rig, {x: 500, y: 300});
 expect(cameraView(state, .1, stage, rig, {x: 590, y: 340})).toMatchObject({x: 500, y: 300});
 expect(cameraView(state, .2, stage, rig, {x: 700, y: 300})).toMatchObject({x: 600, y: 300});
 expect(cameraView(state, .3, stage, rig, {x: 600, y: 200})).toMatchObject({x: 600, y: 250});
});

it('smooths towards the target independently of the frame rate, and snaps again after a scene change', () => {
 const rig = rigAt(0, 0, {target: 'hero', smoothing: 10}), a: RuntimeCameraState = idleCamera(), b: RuntimeCameraState = idleCamera();
 for (const s of [a, b]) cameraView(s, 0, stage, rig, {x: 0, y: 0});
 const once = cameraView(a, .1, stage, rig, {x: 100, y: 0});
 cameraView(b, .05, stage, rig, {x: 100, y: 0}); const twice = cameraView(b, .1, stage, rig, {x: 100, y: 0});
 expect(once.x).toBeCloseTo(100 * (1 - Math.exp(-1)), 1); expect(twice.x).toBeCloseTo(once.x, 1);
 snapCamera(a); expect(cameraView(a, 5, stage, rig, {x: -300, y: 0}).x).toBe(-300);
});

it('keeps the view inside the limits (accounting for zoom) and centres an area smaller than the screen', () => {
 const limits = {limit: true, limitLeft: 0, limitTop: 0, limitRight: 1920, limitBottom: 1080};
 expect(cameraView(idleCamera(), 0, stage, rigAt(100, 100, limits))).toMatchObject({x: 480, y: 270});
 expect(cameraView(idleCamera(), 0, stage, rigAt(5000, 5000, limits))).toMatchObject({x: 1440, y: 810});
 expect(cameraView(idleCamera(), 0, stage, rigAt(100, 100, {...limits, zoom: 2}))).toMatchObject({x: 240, y: 135});
 expect(cameraView(idleCamera(), 0, stage, rigAt(9, 9, {...limits, limitRight: 400, limitBottom: 200}))).toMatchObject({x: 200, y: 100});
});

it('migrates camera zoom and bounds into effects and bypasses disabled effects', () => {
 const camera = CameraEffectSettingsSchema.parse(migrateCameraProjection({
  zoom: 2, minZoom: 1, maxZoom: 3, limit: true, limitLeft: 10, limitTop: 20, limitRight: 1110, limitBottom: 820,
 }));
 expect(camera.postFXs).toEqual([
  {type: 'zoom', enabled: true, value: 2, min: 1, max: 3},
  {type: 'limits', enabled: true, mode: 'rectangle', left: 10, top: 20, right: 1110, bottom: 820},
 ]);
 const pose = {x: 0, y: 0, rotation: 0};
 expect(cameraView(idleCamera(), 0, stage, {camera, pose})).toMatchObject({x: 250, y: 155, zoom: 2});
 const disabled = {...camera, postFXs: camera.postFXs?.map(effect => ({...effect, enabled: false}))};
 expect(cameraView(idleCamera(), 0, stage, {camera: disabled, pose})).toMatchObject({x: 0, y: 0, zoom: 1});
 expect(CameraEffectSettingsSchema.parse(migrateCameraProjection({edgeLock: true})).postFXs?.[0])
  .toMatchObject({type: 'limits', enabled: true, mode: 'world'});
});

it('shakes in screen pixels, so a zoomed camera shakes as much on screen', () => {
 const shake = {startedAt: 0, duration: 1, amplitude: 20}, plain = cameraView({shake}, .3, stage), zoomed = cameraView({shake}, .3, stage, rigAt(480, 270, {zoom: 4}));
 expect((plain.x - 480) / 4).toBeCloseTo(zoomed.x - 480, 1);
 expect(cameraView({shake}, 1.2, stage)).toMatchObject({x: 480, y: 270});
});

it('draws the screen frame in the camera object’s space and the limits in world space when selected', () => {
 const rig = {entityId: 'c', camera: CameraSchema.parse({zoom: 2, limit: true, limitRight: 2000, limitBottom: 1000, target: 'h', deadzoneWidth: 100}), pose: {x: 50, y: 60, rotation: 90, scaleX: 2, scaleY: 1}};
 const [frame, ...rest] = cameraOutlines(rig, stage, false);
 expect(rest).toHaveLength(0);
 expect(frame.entityId).toBe('c');
 // 480×270 world frame, unrotated in the world: in local space it is turned back by 90° and divided by the object scale.
 expect(frame.points[0].x).toBeCloseTo(-135 / 2); expect(frame.points[0].y).toBeCloseTo(240);
 const selected = cameraOutlines(rig, stage, true);
 expect(selected).toHaveLength(3);
 expect(selected[2].entityId).toBeUndefined(); expect(selected[2].points[2]).toEqual({x: 2000, y: 1000});
 expect(cameraOutlines({...rig, camera: {...rig.camera, rotate: true}}, stage, false)[0].points[0]).toEqual({x: -120, y: -135});
});
