import {it, expect} from 'vitest';
import {cameraView, cameraOutlines, idleCamera, sceneCamera, snapCamera, viewOffset, viewPlacement, CameraSchema, CameraEffectSettingsSchema, migrateCameraProjection, cameraType, CameraPostFXSchema, type RuntimeCameraState} from './runtime-camera';
import {cameraEaseProgress, CameraEaseSchema, migrateCameraEffects} from '@olivestudio/engine/runtime-camera';
import {Camera, CameraEffect, createCameraPostFX} from '@olivestudio/engine/camera';
import {Container} from 'pixi.js';

const stage = {width: 960, height: 540};
const entity = (id: string, t: Partial<{x: number; y: number; rotation: number; scaleX: number; scaleY: number}>, extra: {type: string; data: unknown}[] = [], parentId: string | null = null, active = true) =>
 ({id, parentId, active, components: [{type: 'scene.transform2d', version: 1, data: {x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ...t}}, ...extra.map(c => ({...c, version: 1}))]});
const cam = (data: Partial<ReturnType<typeof CameraSchema.parse>> = {}) => ({type: cameraType, data: CameraSchema.parse(data)});
const rigAt = (x: number, y: number, data: Partial<ReturnType<typeof CameraSchema.parse>> = {}, rotation = 0) => ({camera: CameraSchema.parse(data), pose: {x, y, rotation}});
it('applies edits to an attached Curve dependency and releases it with its owner', () => {
 const world = new Container(), back = new Container(), front = new Container();
 world.addChild(back, front);
 const camera = new Camera(world);
 const curve = CameraPostFXSchema.parse({type: 'curve', useDepth: true});
 camera.postFXs.configure([curve]);
 const owner = camera.postFXs.get('curve');
 expect(owner).toBeInstanceOf(CameraEffect);
 if (!(owner instanceof CameraEffect)) throw new Error('Curve is missing');
 const depth = owner.requiredEffects[0]?.effect;
 if (!(depth instanceof CameraEffect) || depth.settings?.type !== 'depth') throw new Error('Required Depth is missing');
 expect(depth.updateSettings({...depth.settings, scale: 80})).toBe(true);
 camera.postFXs.apply();
 expect(camera.depth.layerFor(back)?.scale.x).toBeCloseTo(.6);
 expect(camera.depth.layerFor(front)?.scale.x).toBeCloseTo(1.2);
 camera.postFXs.configure([CameraPostFXSchema.parse({type: 'curve', useDepth: true, distance: 12})]);
 expect(camera.postFXs.get('curve')).toBe(owner);
 expect(owner.requiredEffects[0]?.effect).toBe(depth);
 camera.postFXs.configure([]);
 expect(depth.isAttached).toBe(false);
 expect(owner.requiredEffects).toEqual([]);
 camera.dispose();
 world.destroy({children: true});
});

/** Where a world point lands on the game screen for a view (the same transform Pixi applies to the world container). */
const toScreen = (view: ReturnType<typeof cameraView>, p: {x: number; y: number}) => { const t = viewPlacement(view, stage), a = t.angle * Math.PI / 180, dx = (p.x - t.pivot.x) * t.scale, dy = (p.y - t.pivot.y) * t.scale; return {x: t.position.x + dx * Math.cos(a) - dy * Math.sin(a), y: t.position.y + dx * Math.sin(a) + dy * Math.cos(a)}; };

it('samples authored camera motion on scene time and distinguishes framing from following', () => {
 const effect = (data: unknown) => CameraPostFXSchema.parse(data);
 const turn = effect({type: 'rotate', angle: 90, duration: 2, ease: 'none'});
 const zoom = effect({type: 'zoom', value: 3, duration: 2, ease: 'power2.in'});
 const move = effect({type: 'move', x: 500, y: 300, duration: 2, ease: 'power2.in'});
 const first = rigAt(100, 100, {postFXs: [zoom, move, turn]});
 expect(cameraView(idleCamera(), 0, stage, first)).toEqual({x: 100, y: 100, zoom: 1, rotation: 0});
 expect(cameraView(idleCamera(), 1, stage, first)).toEqual({x: 150, y: 125, zoom: 1.25, rotation: 45});
 expect(cameraView(idleCamera(), 2, stage, first)).toEqual({x: 500, y: 300, zoom: 3, rotation: 90});

 let targetX = 300;
 const lookup = () => ({x: targetX, y: 180, bounds: {x: targetX, y: 180, width: 200, height: 100}});
 const follow = rigAt(100, 100, {postFXs: [effect({type: 'follow', target: 'actor', offsetX: 10, duration: 0})]});
 const focus = rigAt(100, 100, {postFXs: [effect({type: 'focus', target: 'actor', padding: 20, duration: 0})]});
 const followState = idleCamera(), focusState = idleCamera();
 const view = (state: RuntimeCameraState, time: number, rig: typeof follow) => cameraView(state, time, stage, rig, undefined, undefined, lookup);
 expect(view(followState, 0, follow)).toMatchObject({x: 310, y: 180, zoom: 1});
 expect(view(focusState, 0, focus)).toMatchObject({x: 400, y: 230, zoom: 4.6});
 targetX = 500;
 expect(view(followState, 1, follow)).toMatchObject({x: 510, y: 180});
 expect(view(focusState, 1, focus)).toMatchObject({x: 400, y: 230, zoom: 4.6});
});

it('validates native ease parameters and uses saved custom Bézier curves for camera motion', () => {
 const back = CameraEaseSchema.parse('back.in(0.4)');
 expect(cameraEaseProgress(back, .5)).toBeCloseTo(.075);
 expect(cameraEaseProgress('elastic.out(0.4, 0.5)', .3)).not.toBe(cameraEaseProgress('elastic.out', .3));
 expect(cameraEaseProgress('steps(5)', .51)).toBeCloseTo(.6);
 expect(CameraEaseSchema.safeParse('sine.in(0.4)').success).toBe(false);
 expect(CameraEaseSchema.safeParse('cubic-bezier(1.1, 0, 1, 1)').success).toBe(false);
 const ease = CameraEaseSchema.parse('cubic-bezier(0.4, 0, 1, 1)');
 const rig = rigAt(0, 0, {postFXs: [CameraPostFXSchema.parse({type: 'rotate', angle: 100, duration: 1, ease})]});
 expect(cameraView(idleCamera(), .5, stage, rig).rotation).toBeCloseTo(32.5, 1);
});

it('previews configured camera settings and resets an attached effect exactly once', () => {
 const world = new Container();
 const camera = new Camera(world);
 const settings = CameraPostFXSchema.parse({type: 'shake', amplitude: 37, duration: 2, useDepth: true});
 const effect = createCameraPostFX(settings);
 effect.attach(camera);
 let resets = 0;
 effect.preview(value => {
  expect(value).toEqual(settings);
  return () => { resets += 1; };
 });
 effect.reset();
 effect.reset();
 expect(resets).toBe(1);
 effect.preview(() => () => { resets += 1; });
 effect.destroy();
 expect(resets).toBe(2);
 camera.dispose();
 world.destroy();
});

it('keeps the foreground at its authored scale when Curve uses depth', () => {
 const world = new Container(), back = new Container({zIndex: -2}), front = new Container({zIndex: 3});
 front.scale.set(1.25);
 world.addChild(front, back);
 const camera = new Camera(world);
 const curve = (settings = {}) => CameraPostFXSchema.parse({type: 'curve', useDepth: true, ...settings});
 camera.postFXs.configure([curve()]);
 camera.postFXs.apply();
 expect(camera.depth.layerFor(back)).toBe(back);
 expect(camera.depth.layerFor(front)).toBe(front);
 camera.postFXs.configure([curve({scale: 100})]);
 camera.postFXs.apply();
 expect(camera.depth.layerFor(back)?.scale.x).toBe(.5);
 expect(camera.depth.layerFor(front)?.scale.x).toBe(1);
 expect(front.scale.x).toBe(1.25);
 camera.postFXs.apply([front]);
 expect(camera.depth.layerFor(front)?.scale.x).toBe(1);
 camera.dispose();
 world.destroy({children: true});
});

it('moves background layers with the camera using the Parallax depth distribution', () => {
 const world = new Container(), back = new Container(), middle = new Container(), front = new Container();
 world.addChild(back, middle, front);
 const camera = new Camera(world);
 camera.postFXs.configure([CameraPostFXSchema.parse({type: 'parallax', useDepth: true, distribution: 'power2.in',
  settings: {amountX: .8, amountY: .4}})]);
 camera.postFXs.apply();
 camera.depth.update(960, undefined, {time: 1, cameraOffset: {x: 100, y: -50}});
 expect(camera.depth.layerFor(back)?.position).toMatchObject({x: 80, y: -20});
 expect(camera.depth.layerFor(middle)?.x).toBeCloseTo(70);
 expect(camera.depth.layerFor(front)?.position).toMatchObject({x: 0, y: 0});
 expect(back.position).toMatchObject({x: 0, y: 0});
 camera.clearDepth();
 expect(world.children).toEqual([back, middle, front]);
 camera.dispose();
 world.destroy({children: true});
});

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

it('centres a crop in logical screen pixels and uses its size for camera limits', () => {
 const framing = CameraPostFXSchema.parse({type: 'framing', width: 400, height: 200});
 const limits = CameraPostFXSchema.parse({type: 'limits', right: 1000, bottom: 600});
 const rig = rigAt(0, 0, {zoom: 2, postFXs: [limits, framing]});
 expect(cameraView(idleCamera(), 0, stage, rig)).toEqual({
  x: 100, y: 50, zoom: 2, rotation: 0, frame: {x: 280, y: 170, width: 400, height: 200},
 });
 const portrait = {width: 320, height: 640};
 expect(cameraView(idleCamera(), 0, portrait, rig).frame).toEqual({x: 0, y: 220, width: 320, height: 200});
 expect(cameraView(idleCamera(), 0, stage, rigAt(0, 0, {postFXs: [{...framing, enabled: false}]})).frame).toBeUndefined();
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

it('migrates viewport anchoring, object rotation and tracking without losing an authored eased follow', () => {
 const camera = CameraEffectSettingsSchema.parse(migrateCameraEffects({
  viewportRelative: true, rotate: true, target: 'hero', offsetX: 10, smoothing: 10, deadzoneWidth: 100,
  keepInView: true, safeMargin: 16,
  postFXs: [{type: 'follow', target: 'other', duration: 1, ease: 'none'}],
 }));
 expect(camera.postFXs).toMatchObject([
  {type: 'viewport', enabled: true},
  {type: 'rotate', mode: 'object', enabled: true},
  {type: 'follow', mode: 'tracking', target: 'hero', offsetX: 10, smoothing: 10, deadzoneWidth: 100, keepInView: true, safeMargin: 16},
  {type: 'follow', target: 'other', duration: 1, ease: 'none'},
 ]);
 expect(migrateCameraEffects(camera)).toEqual(camera);
 const portrait = {width: 540, height: 960};
 const rig = {camera, pose: {x: 480, y: 270, rotation: 25}, authoredSize: stage};
 expect(cameraView(idleCamera(), 0, portrait, rig)).toEqual({x: 270, y: 480, zoom: 1, rotation: 25});
 expect(cameraView({...idleCamera(), followId: null}, 0, portrait, rig, undefined, undefined,
  () => ({x: 300, y: 200}))).toMatchObject({x: 270, y: 480});
 const lookup = (id: string) => id === 'hero' ? {x: 100, y: 100} : {x: 300, y: 200};
 const state = idleCamera();
 expect(cameraView(state, 0, portrait, rig, undefined, undefined, lookup)).toMatchObject({x: 110, y: 100, rotation: 25});
 expect(cameraView(state, .5, portrait, rig, undefined, undefined, lookup)).toMatchObject({x: 205, y: 150});
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
