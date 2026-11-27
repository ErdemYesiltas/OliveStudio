# OliveStudio Engine

`@olivestudio/engine` is the browser-side 2D engine shared by OliveStudio Preview and its HTML player. It runs with PixiJS 8.23 or later in the 8.x series. The library owns scene sessions, fixed-step systems, game frames, component projections, and texture leases. A host supplies the canvas mount, asset URLs, input, storage, and game-specific systems.

## Build and install

Run `pnpm pack:engine` from the OliveStudio repository. The installable tarball is written to `outputs/engine/`. In a separate browser project, install the tarball and `pixi.js`.

```sh
pnpm add /path/to/olivestudio-engine-0.1.0.tgz pixi.js@8.23.0
```

Run `pnpm test:engine` in the repository to build the tarball and verify installation in a separate browser project.


## Use

```ts
import {PixiGameApplication} from '@olivestudio/engine';

const app = new PixiGameApplication();
await app.init({width: 960, height: 540, autoStart: false, preference: 'webgl'});
document.body.appendChild(app.canvas);

const scene = app.game.createScene([{id: 'clock', active: true, frames: 0}], (world, install) => {
  install({
    id: 'count-frames',
    fixedUpdate() {
      const clock = world.entities[0];
      clock.frames = Number(clock.frames) + 1;
    },
    dispose() {},
  });
});

app.game.setFramePorts({
  flush() {},
  eventsPending: () => false,
  project() {
    // Update Pixi display objects with scene.world.entities.
  },
});
await app.game.startScene(scene, {prepare: async () => {}, started() {}});
app.ticker.start();
```

For component-based drawing, use `SceneVisualProjection` with your own texture, font, and event callbacks. Use `GameSceneObjects` for prefabs and additive scenes. The `@olivestudio/engine/runtime` entry exposes the fixed-step session without loading PixiJS. The package includes JavaScript and TypeScript declarations for all public entries.

`fitText` measures text against a local width and supports shrinking or truncating with an ellipsis. `safeScreenRect` maps device insets into a preview rectangle in stage coordinates.

The `@olivestudio/engine/particles` entry exposes the Aperion particle emitter, Pixi particle pooling, spawn shapes, and configurable behaviors. Use `Emitter` for direct control or `createParticleEmitter` for a handle with `start`, `update(dtSec)`, `stopEmitting`, and `destroy`. Drive the handle with your application ticker and pass time in seconds.

The `@olivestudio/engine/spine` entry loads Spine 4.2 JSON and binary rigs. Pass the parsed JSON or binary bytes, atlas text, and a loader that returns an `ImageBitmap` for each atlas page. The source owns its page images and shares them across its instances. Destroy the instances before calling `source.dispose()`. The `@olivestudio/engine/spine-format` entry exposes document and keyframe editing helpers.

```ts
import {applySpineSkins, loadSpineSource} from '@olivestudio/engine/spine';

const source = await loadSpineSource({
  format: 'json',
  data: await fetch('./rig.json').then(response => response.json()),
  atlas: await fetch('./rig.atlas').then(response => response.text()),
  loadPage: async (name, options) => createImageBitmap(await fetch(name).then(response => response.blob()), options),
});
const rig = source.createSpine();
applySpineSkins(rig.skeleton, 'default');
rig.state.setAnimation(0, 'idle', true);
app.stage.addChild(rig);
// Use the same clock that advances the rest of your game.
app.ticker.add(ticker => rig.update(ticker.deltaMS / 1000));
```

Use `SceneAnimation` from `@olivestudio/engine/scene-animation` to run the same playback settings as OliveStudio. The controller accepts a loaded source, a starting clip, a clip queue, weighted overlay tracks, and per-transition mix durations. Add its `display` to the stage and call `tick(ticker)` from the game clock. Pass the signal callback to receive animation events, including audio metadata. Use `direct(clip, { track, weight })` to control an individual track from a composition.

`getSpineBonePose(name)` and `getSpineBoundingBoxes(slot?)` read the current animation pose in the Spine display's local coordinates. In OliveStudio scripts, `game.spine.bone(target, name)` and `game.spine.boxes(target, slot?)` return copies in scene world coordinates. A target can be a game object or its ID. A missing bone or a rig that is still loading gives `null` from `bone()`. `boxes()` returns an empty array when no bounding box is active.

Read the active point attachment in a slot with `getSpinePoint(slot)`, or use `game.spine.point(target, slot)` from an OliveStudio script. Both include the point's name and rotation in degrees. The script API gives the position and direction in scene world coordinates. A missing or inactive point gives `null` in scripts.

Scripts attached to a Spine object can export `onSpineEvent(self, signal)` and `onSpineComplete(self, signal)`. Subscribe from another object or a scene script with `game.on('spineEvent', target)` or `game.on('spineComplete', target)`. The signals include the clip name, track, time and silent frame-step flag. Keyframe events also include the authored integer, decimal, text and audio settings.

Use `game.spine.play(target, clip, {track, loop, speed, mixDuration, weight})` to start a clip from a script. Track 0 plays the base clip and higher tracks play overlays. The mix duration is in seconds. Defaults use the object's authored speed and mix settings, with a single play on track 0.

`game.spine.pause(target, track?)`, `resume(target, track?)`, and `stop(target, track?)` control tracks started by gameplay. Stopping a track clears its held pose and reapplies the remaining tracks. The functions return `false` if the indicated track cannot be controlled. Track 0 is the default.

Use `game.spine.setSkin(target, skin, layers?)` to change the displayed skin and ordered overlays while the tracks keep playing. Pass `null` for the rig's default skin. `game.spine.resetSkin(target)` restores the settings authored in the Inspector. Both changes apply only to the running game.

Run `pnpm test:spine-cli` from the repository with an activated Spine 4.2 launcher to verify binary and project round trips. The test uses the Spine installation in Applications or the executable given by `OLIVESTUDIO_SPINE_EXECUTABLE`. Pass a Spine JSON path to test another rig with its atlas and images.
