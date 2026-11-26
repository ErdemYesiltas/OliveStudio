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
