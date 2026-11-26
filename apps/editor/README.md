# OliveStudio Pixi Editor

OliveStudio is an Electron desktop editor. Run it or install the macOS application from the workspace root.

```sh
pnpm dev
pnpm package:mac
```

The package installs to `/Applications/OliveStudio.app`. Quit a running OliveStudio instance before packaging. The previous bundle goes to the macOS Trash with a restore map. The editor runs without a Vite server. Existing OliveStudio profiles remain available. Set `OLIVESTUDIO_USER_DATA` to use a separate profile.

## Editing

The editor opens a sample scene. Use the toolbar or the File menu to create, open, or save a scene. The macOS shortcuts are ⌘N, ⌘O, and ⌘S. Open and Save use native file dialogs. The saved indicator updates after the file is written. Hover over an icon or focus it with the keyboard to see its name and description. Select a container to add children, or select the scene root to add top-level objects.

Choose **Dark**, **Light**, or **System** from **View → Theme**. New profiles start in Dark. System follows the operating system’s appearance, and the editor remembers the selection per profile. Theme colors are defined in `src/theme.css`. A scene’s background and colors are stored with the scene.

Drop PNG, JPEG, WebP, WAV, MP3, Spine 4.2 JSON, or PixiJS spritesheet JSON files from Finder into **Assets**, or use **Import Assets**. Keep a Spine export's same-name `.atlas` and its referenced texture pages alongside the JSON. Keep a spritesheet's `meta.image` texture alongside its single-page JSON. AssetPack creates one project entry for the JSON and its companions. Save the scene to keep its assets and references together in one portable JSON file. Individual files can be up to 24 MiB and a scene can contain up to 64 MiB of imported assets.

Browse imported assets in **Project** and packaged assets in **Built-in**. Use the folder tree, path bar, search, and type filter to navigate. Select a file to see its details and preview in **Inspector**. Images show dimensions, audio has Play and Stop, Spine has skin and clip selection, and spritesheets use their named clips or play all frames when none are defined. Use Play, Pause, Stop, and Loop to explore animated files before using them. Drag an image onto the scene to create a centered Sprite. To update an existing Sprite, select it and use **Assign Texture**.

Use **More Objects** in Hierarchy to add Graphics, Bitmap Text, Tiling Sprite, Nine-Slice Sprite, Tilemap, Mesh Plane, Mesh Rope, Particles, Animated Sprite, or Spine. Drag Spine and spritesheet assets onto the scene or choose **Add to Scene** in the asset Inspector to create linked objects. Their object Inspector controls the asset, clip, loop, playback, and speed. Spine also exposes its skin. Tilemap uses texture cells ordered from left to right and top to bottom, with `-1` for empty cells.

Use the context menu to organize project assets. You can create, rename, or move folders and assets. The library keeps texture references stable when an asset moves or changes name. Unused assets and empty folders can be deleted, and library changes support Undo and Redo. The grid or list preference and panel height are remembered per profile.

The **Bundles** panel sits beside Assets. Use the **Bundles** button in the Assets toolbar to show or hide it. Create and rename bundles in that panel, or use **Send to Bundle** in the Assets context menu to assign a selection directly. Unassigned assets belong to **Default**. Deleting a bundle moves its members back to Default. Bundle settings are saved with the scene and support Undo and Redo.

Use Command or Ctrl to toggle individual assets, and Shift to select a range. The **Select Multiple Assets** button also shows checkboxes and a **Select Shown** action. Assign the selection from the Inspector or use **Add Selection** beside a bundle. Creating a bundle can also assign the current selection in the same Undo step.

Use **Export Bundles** to choose a destination. AssetPack writes `manifest.json` and the imported asset files into a new `assetpack-*` directory. The manifest keeps the scene’s original asset aliases and contains bundles with at least one member. Built-in assets remain in the application’s bundled library.

Use **Undo** and **Redo** in the toolbar or **Edit** menu. The shortcuts are ⌘Z and ⇧⌘Z. Inspector edits and viewport drags each enter the scene history as a single operation. Each opened scene starts a fresh history.

Use the **Select**, **Move**, **Rotate**, and **Scale** icons above the scene. Select by clicking an object. Drag with the active transform tool, or press Escape to cancel a drag. In **Hierarchy**, drop a row at another row’s edge to reorder it, onto a container’s center to move it inside, or onto **Scene Root** to move it to the top level. Reparenting preserves the object’s local transform.

Scene JSON accepts `width`, `height`, and `background` under `config.renderer`. The audio extension accepts `volume` and `muted` under `config.audio`. An application extension registers its own schema and defaults in the config registry and reads the validated options during Pixi initialization.

## Localization

The renderer and Electron dialogs share `locales/en.json`. To add a language, copy the catalog to a new locale file and register it in `locales/catalog.mjs`. The resolver tries the full locale tag, then the base language, then English. Missing translations fall back to English. Scene data and asset aliases are stored independently of the UI language.

## Checks

```sh
pnpm --filter @olivestudio/editor typecheck
pnpm exec vitest run apps/editor
pnpm --filter @olivestudio/editor test:e2e
pnpm --filter @olivestudio/editor test:desktop
```

The end-to-end tests exercise the renderer and AssetPack in Chrome. Set `PLAYWRIGHT_CHROMIUM=1` to use Playwright’s Chromium instead.

## Particles

Add **Particles** from **Hierarchy → More Objects**. In the Inspector, **Emission** controls Continuous and Burst playback, the particle limit, lifetime, interval, wave size, and spawn chance. **Spawn Shape**, **Particle Motion**, and **Over Lifetime** control where particles spawn, how they move, and how their scale, opacity, and color change. Assign an image in **Texture** or use the built-in white particle. **Restart Particle Preview** replays the effect without changing the scene file. The Aperion emitter runs on the scene ticker, and older Particles objects retain their saved settings.
