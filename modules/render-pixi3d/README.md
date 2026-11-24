# Pixi 3D authoring adapter

Trusted optional editor module `pixi3d-editor` over `scene3d` data contracts. Desktop composition enables it alongside the existing 2D renderer. `@pixi/3d@0.1.0`, `pixi.js@8.23.0`, `gl-matrix@3.4.4` are pinned; this is a beta integration, not a general 3D engine.

## Public contribution points

- `@rewrite/render-pixi/viewport-features`: async prepare before Application.init, scoped instance per viewport, original document sync, selection, frame, clear, dispose. The 2D viewport still sees its own spatial projection. Failure removes/disposes the offending feature and reports a diagnostic instead of taking down the host.
- `@rewrite/scene/views` `componentEditors`: versioned, module-owned Inspector renderers. The Transform3D editor shows XYZ position, XYZ Euler degrees and XYZ scale; documents retain normalized XYZW quaternion data.
- SDK create items can delegate to a module command. The host never invents a Transform2D for 3D creation. Legacy assistant `add_object` rejects these entries and points to the actual module automation tools. `@rewrite/assets` now exposes `assetPlacements`: Library click/drop delegates to the owning module, which can also provide a thumbnail file and text details.

## Authoring

Add → 3D → 3D View creates a 640×360 view, cube, perspective camera, directional sun and ambient light in one transaction. Cube/sphere/plane/camera/directional/ambient creation uses the selected view or 3D object as parent. Primitive material exposes color, roughness and metallic; camera exposes perspective/orthographic, FOV and frustum; lights expose color and intensity.

Views are ordinary 2D boundary entities that can be placed/scaled/rotated in a 2D scene. Only their children use metres and +Y up. Each view owns its Pixi scene, geometry, materials, orbit controller, labels and 2D overlay. No Pixi instances are saved in JSON.

Click inside a view to ray-pick a primitive; click empty space to select its view. Alt-drag orbits, middle-drag pans and the wheel zooms the editor camera. These navigation gestures do not mutate the scene or create undo entries. An editor-only toolbar offers Move/Rotate/Scale (W/E/R), reset view and scene/editor camera switching. Authored camera transforms are never overwritten by orbit navigation; the scene-camera toggle is local editor state.

XYZ handles project parent axes for Move/Rotate and object axes for Scale. A drag previews the pose locally and commits once on pointer-up. Shift snaps move to 0.25 units, rotation to 15°, scale delta to 0.1. Escape, pointer cancellation, window blur, document replacement or selection change cancels. Stale original pose or parent causes atomic rejection. Near-parallel axes are omitted. Quaternion rotation and signed nonsingular scale are schema-validated. Transform3D Inspector changes use the same command/transaction validation.

Spatial prefab roots open under a temporary registered 2D→3D boundary. Save removes the wrapper, resets root position through the spatial provider and validates the detached snapshot before writing the prefab. Cancel removes the temporary edit scene. No 3D-specific import was added to PrefabService.

## MCP

`pixi3d-editor.place_model` places an imported model asset under an explicit or selected 3D parent, or the sole view when selection is absent/2D. `newView:true` creates a camera/light-equipped view with the model in one transaction; it cannot be combined with parentId. Library placement is module-owned: ambiguous/no-view requests open a Radix target dialog with cancel/Escape, existing views and a New 3D view option. Document changes dismiss stale requests; confirmation rechecks asset revision, target and edit permission. `pixi3d-editor.create_view` creates the complete starter view. `pixi3d-editor.create_node` accepts `kind` and optional `parentId`; otherwise it uses selection. Existing scene transactions, spatial component editing, hierarchy and undo APIs apply. There is no hidden mutation surface in the canvas; its `data-spatial3d` attribute is read-only diagnostics for UI QA.

## Lifecycle and CSP

Do not call `Application.destroy(true)` in a multi-renderer editor: use `@rewrite/render-pixi/lifecycle`. The shared `./csp` bridge normalizes @pixi/3d matrix/vector/color objects for Pixi's no-eval uniform handlers, scoped to each renderer. The Lab reexports the same bridge. No unsafe-eval CSP allowance or global prototype patch was added. Private no-eval hooks must be rechecked on version updates.

Orbit controls have `autoUpdate:false`, `enabled:false`, damping disabled; the module explicitly drives navigation. No Ticker.shared subscription. Owned resources are disposed before 2D projection nodes, and small per-view camera snapshots survive document rebuilds. GPU geometry/materials are currently rebuilt when the scene document changes; resource pooling/incremental reconciliation is a later performance task.

## Current boundaries

This delivery is **editor authoring only**. GLB Library import/reimport and per-instance whole-model material overrides are implemented (see below). Material asset slots and per-submesh overrides, animation tracks, game Preview, HTML/mobile export and 3D physics are subsequent work. Preview/export preflight deliberately rejects 3D documents. Pure 2D exports accept editor module locks without bundling the 3D renderer. Camera/light picking is currently through Hierarchy; only actual geometry ray-picks in the canvas. Rotation/scale use projected axis handles rather than arc rings/boxes. Free-plane dragging is not implemented. Generic Inspector camera binding is a stable ID field; a camera picker is a future UX improvement.

## Verification

`pnpm exec vitest run modules/render-pixi3d modules/scene3d` checks module registration/cleanup, transactions/undo, JSON round-trip, camera ID remapping, stale gestures, Euler gimbal cases, axis math, hierarchy and spatial prefabs. `spatial3d.vite.config.ts`/`spatial3d.html` is a standalone production-CSP QA harness using the real SceneViewport and SceneService; it is not bundled into the desktop renderer.


## GLB Library pipeline — Stage 3

`modelImporter` (`pixi3d-editor.glb`) contributes `.glb` → `pixi3d.model`. Native composition wires the module-owned `buildModel` utility-process worker; UI/renderer imports never pull NodeIO or Sharp. Exact dependencies: glTF Transform core/extensions 4.5.1, Sharp 0.34.5. No second 3D renderer.

The source is copied/hash-revisioned by AssetSession. Import/reimport preserves GUID and name. Model metadata contains bounds, mesh/node/vertex/triangle counts, material indices/names, clip names/durations and compatibility warnings. Derived cache contains `model.glb` and `thumb.webp`; source-only reopen rebuilds both. Thumbnails are bounded CPU isometric geometry previews with approximate flat material colors; they are not photoreal GPU renders.

Initial supported input: glTF 2.0 GLB with triangle meshes and embedded PNG/JPEG/WebP. External buffers/images and offline-decoder-dependent Draco/Meshopt/KTX2 are rejected with diagnostics. Required extensions are explicitly gated; unrecognized optional extensions produce warnings. Import checks checksums, container lengths, hierarchy cycles/depth, accessor/instanced-vertex budgets, index ranges, finite positions, image formats/sizes and total texture pixels. NodeIO has network disabled and strict resource handling. This is an editor compatibility preflight, not a full Khronos conformance validator.

GLB data-URI images are normalized into binary buffer views in the derived GLB. Pixi then creates private blob URL texture keys per source; unloading one model source cannot unload another source's identical data-URI texture cache entry. Originals remain unchanged in the source store. Unsupported optional extensions may be dropped in this normalized cache, as indicated by warnings; buffer-view-only models retain original bytes.

`pixi3d.modelRenderer` stores an asset ID plus optional color/roughness/metallic override. Each entity owns a Model3D with `autoUpdate:false`; source geometry/materials/textures share a leased cache. Override materials are cloned per instance and destroyed independently. A document projection rebuild defers releases to a microtask, allowing new instances to reuse the loaded source. Final release unloads once; a reload waits for a preceding unload. Late async loads cannot attach to a destroyed projection. A missing or invalid model keeps a visible placeholder and entity-specific diagnostic. Stable editor entity IDs are recovered through ray-hit ancestry rather than trusting glTF mesh labels.

Native QA on 21 November: real Library GLB import, geometry thumbnail and clip metadata; UI placement, MCP second instance, independent gold override, changed-blue-source reimport with unchanged GUID and model references, gold override preserved. Evidence lives in `outputs/glb-model-qa/`. Unit tests cover checksum/container/compatibility rejection, source-only restore/rebuild, image normalization, placement/undo and resource lease races. Browser production CSP proved two ready instances share one resource, override affects only one and deleting it leaves the other ready. **604 Vitest + 5 Node packaging tests**, typecheck, lint/boundaries, full and empty builds passed.

Outstanding Stage 3 quality work: richer real-world textured/skinned fixture matrix, per-material asset slots/submesh overrides, no-parent placement UX and resource/heap soak. The next MVP step is a shared game projection, runtime clock/animation, Preview and HTML export; editor authoring support does not imply those paths are enabled.


## Shared projection and picking — 22 November

`./projection` exports a browser-only Scene3DProjection; the authoring `./runtime` delegates to it. The projection imports no React, Electron, OrbitCamera, editor controls or clock. It provides scene sync/update, async model readiness, authored camera selection, stable entity picking, diagnostics and scoped cleanup. It is ready to be consumed by the game integration, but **GamePlayer/Preview/HTML have not been wired yet**.

Pose/active/flag changes preserve existing GPU nodes, Model3D instances and animation state; topology/render configuration/asset revision/host changes rebuild. A transform group represents every entity, with camera/light/geometry as children, allowing camera and renderer components to coexist. Real GLB mesh surfaces explicitly register `eventMode=static` (Pixi glTF meshes default passive); hit ancestry resolves back to the owner entity, not glTF labels. `slot.cameras` maps authored camera components separately from entity groups. Game integrations must enable the View3D event mode for normal Pixi dispatch; authoring uses manual DOM-captured raycasts.

607 Vitest / 127 files + 5 Node packaging checks, typecheck, lint, full package and empty builds passed. Browser: mesh click and drag→one Undo, camera toggle, no warn/error at checkpoint. Canonical macOS: two GLB selection switching opens correct Properties, pin/viewport resize/close/floating return, Effects→Scene→model selection. Evidence: outputs/projection3d-qa/. GPU/heap soak and full game/export parity remain open.

## Browser player and HTML export — 22 November

The optional player plugin `modules/player/src/plugins/pixi3d.ts` now consumes Scene3DProjection. Player extensions declare spatialTypes and expose pre-renderer prepare, per-scene async ready and boundary hitEntity hooks. Initial scene resources are loaded before RuntimeSession/system autoplay and scene.start. Only 2D entities get 2D nodes; decorators receive the complete scene. Game cameras and 3D click→stable entity→normal interaction/audio are supported. `./preflight` is shared by player and HTML target.

The HTML pixi3d contribution includes real component definitions, module locks and only referenced model.glb files. 3D plugin code is selected only when used, and minimum 2D builds have no @pixi/3d vendor. Repeatable real-target fixture: `node scripts/fixtures/3d-export.mjs` after building the player template. Browser proof: two ready shared-source models, click→audio and active toggle, 2D restore button, second scene cleanup to zero leases and return to two ready models, no console errors/warnings. Evidence: outputs/runtime3d-qa/.

615 Vitest + 5 Node tests, typecheck/lint and full build passed. Desktop Preview and glTF animation/seek/pause/step are still gated/incomplete; this does not close Stage 4 or its parity/soak gates. The native app was not replaced in this intermediate source delivery. Historical sections above describe earlier checkpoints.

## Desktop Preview — 22 November

Viewport features now contribute runtime spatialTypes/validate/async prepare/enter/exit and boundary hitEntity. SceneViewport owns a tested startup gate: resource readiness, cancellation/generation, same scene identity, partial-enter rollback and reverse cleanup. Desktop Play/transition/paused-recorder/test starts go through it. Authoring3D uses the same projection in game mode, selects the authored camera, enables 3D events, ignores editor flags and hides tools; Stop restores editor camera preference and normal selection. Rendering rehosts preserve the editor camera checkpoint.

Canonical macOS package updated via pnpm package:mac after verifying a saved QA session and quitting it. Native Play/Pause/Step/Stop passed; exact step delta 1/60 s, empty runtime diagnostics, real GLB click hides a second instance via normal interactions. Stop restores source active state/editor view and correct model Properties. Temporary QA edits were undone, final project dirty=false. Evidence: outputs/preview3d-qa/. 619 Vitest / 130 files + 5 Node tests, typecheck/lint/full build/package passed.

Stage 4 remains incomplete: glTF model clip clock/controller, seek/scrub, Preview–HTML animation pose parity and expanded 3D automation observations/readiness. Native transition/additive races, final rebuild readiness, customized camera/flag parity and resource soak are still quality work.

## GLB clip animation — 22 November

Public `./animation-contracts` defines animation3d.model v1 (clip/loop/speed/autoplay), completion trigger and play/pause/resume/stop interaction actions. `./animation` ModelAnimations samples each independent Model3D through public AnimationState.gotoAndStop, with autoUpdate=false and no shared ticker. Logical player state is owned by the controller. It supports bounded seek/hold, restart, resume, stop/rewind, speed/loop, inactive ancestor freezing, single silent-aware completion and rehost rebinding. Incomplete authoring config is editable; Play/export validates model/clip metadata.

Desktop uses the common RuntimeSession time, entities and silent-step flag through generic viewport context ports. Editing preview uses a scoped RuntimeSession driven by the existing app ticker only after explicit Play. Inspector offers model-derived clip choices, config controls and ephemeral scrub; session edits never dirty the document. Optional player plugin uses the same controller and contribution actions. MCP animation_control and animation_state expose stable component IDs and exact seconds. Preview transform inspection now preserves 3D Z/quaternion/scale data. Feature readiness includes GLB model diagnostics.

Unnamed clip metadata matches Pixi's anim_0 key; old Animation 1 cache metadata has a player-label fallback. Real importer/loader and actual GLB pose tests cover this. 627 Vitest / 131 files + 5 Node tests, typecheck/lint, full/empty builds and canonical macOS package passed. Native two speeds step by 1/60 and 1/120, independent Inspector/MCP seeks and Stop reset were verified. HTML export proves one-shot/loop, pause/resume actions, shared source, audio click, scene cleanup and reload. Evidence: outputs/animation3d-qa/.

Final native app is open on a separate saved 3D Animation QA project; blue clip is scrubbed to 1s, gold at zero, dirty=false. Wider Preview–HTML pose parity, lifecycle/soak/backend/model fixture gates remain open; Stage 4 and the full roadmap are not declared complete. Historical earlier sections record previous checkpoints.


## Actual node pose parity and ownership — 22 November

`pixi3d-editor.inspect_model` reads bounded actual glTF node local transforms and world positions (max 64/page). The player plugin exposes the same projection inspection through `pixi3d.models`; public GamePlayer pause/resume/inspect and generic module inspector ports avoid private renderer access. Manual pause survives background/foreground.

Build the exact saved native QA scene using `node scripts/fixtures/3d-parity.mjs`, open its HTML output, click Start and Sample all model poses, and save the rendered JSON as outputs/pose3d-qa/html-poses.json. With that native QA project open and clean, run `node scripts/fixtures/3d-native-parity.mjs`. The script uses public native MCP, checks source hash/project/scene, samples two models, stops playback and verifies no saved or in-memory document change. The optional test-only probe plugin is absent from stock exports.

Actual macOS vs browser result: seven times, two models at 1x/.5x, 413 numeric fields including actual local position/quaternion/scale and world position, max error 0 (tolerance 1e-6). This is exact fixture node-pose evidence, not pixel/PBR/skinned/backend parity. Evidence: outputs/pose3d-qa/comparison.json and both pose files. Latest native package passed the collector again, 20 Play/Pause/Step/seek/Stop cycles and 50 panel open/pin/unpin operations with readiness and actual model inspection. The original Canvas layout and clean edit session were restored.

A shared Assets source registry now keeps a model alive across independent projection scopes until the last owner releases it. Real two-projection GLB tests check survivor animation and final unload. Projection readiness cancels on topology/rehost/dispose; generic Preview preparation cancels without waiting for hung feature IO and rejects features removed before enter. 639 Vitest / 132 files + 5 Node packaging tests, typecheck/lint/full build/package passed. GPU/GC-settled long soak, transition/additive readiness and the wider asset matrix remain open. Historical sections above retain their earlier checkpoint limitations; consult the newest AI-HANDOFF for current state.


## Editor camera and native room lifecycle — 22 November

Bounded numeric camera snapshots now survive temporary runtime scenes instead of being pruned on every scene sync. Position/target/zoom and editor-vs-scene camera preference restore after Stop. Frame selected (toolbar and F) fits world-transformed geometry into the editor perspective camera, including narrow aspect ratios and rotated/nonuniform parents; it never edits the authored game camera.

Module MCP tools `pixi3d-editor.camera_control` and `pixi3d-editor.view_state` expose validated edit-only camera operations and bounded actual visibility/picking/resource observations. Read state optionally filters viewId, caps 16 views and 64 nodes/models per view, and reports totals/truncation. Model pose inspection retains its separate paged API.

Native canonical QA passed custom camera → Play/Pause → A/B/A transition → Stop restore, additive load of a second 3D room (4 model leases) and remove (2 leases), actual second-room node inspection, and native Layers Hide/Lock → game visible/interactive → exact edit state restore. Source project text and document revision stayed unchanged. Fixture generator: scripts/fixtures/3d-transitions.mjs; evidence: outputs/camera3d-qa/. Do not regenerate an open fixture: generated IDs change. Current native QA contains Room A and Room B and remains clean in edit mode, selected blue model framed.

642 Vitest / 133 files + 5 Node packaging checks, typecheck/lint, full build and canonical local package passed. This does not prove delayed IO/final runtime projection rebuild readiness, GC/GPU soak or the full asset/backend matrix. Those and subsequent quality/3D Effects/physics/navigation/network/mobile stages remain in the current handoff.


## Final runtime projection readiness — 22 November

A source scene can be ready while its first runtime snapshot (editorOnly removal/templates) triggers another model rebuild. Desktop now constructs RuntimeSession with deferStart, draws that isolated world, awaits feature runtime.ready on the actual projection, verifies session/view/generation/revision, then starts systems/autoplay and emits scene.start. Busy stays active and ticker/input do not advance a prepared world. GamePlayer performs a repeatable final extension.ready after its world draw and before explicit start. Startup diagnostics remain checked after start. Existing default RuntimeSession constructor behavior is unchanged unless deferStart is requested.

650 Vitest / 133 files + 5 Node checks, typecheck/lint/full/empty build/package passed. Deferred/final delayed/cancelled/error paths and a real GLB rebuild after editor-only filtering have tests. Actual exported browser runtime starts and samples seven times/two model node poses without warn/error. Evidence: outputs/ready3d-qa/export-parity/. Latest native package is installed but AX Hub connection timed out; user handoff to Continue to editor is pending. Native validation of this package is NOT complete. Once the new 3D Startup QA fixture is open, run scripts/fixtures/3d-native-parity.mjs with that output root. Additive async spawned/scene.start readiness and long soak/full matrix remain open; see latest AI-HANDOFF.


## Atomic additive resource readiness — 22 November (latest checkpoint)

RuntimeSession nested holds freeze the shared clock while preserving user pause intent. Atomic staged spawn keeps candidates outside world membership/system spawned callbacks until preparation succeeds. RuntimeSpawnQueue serializes desktop and HTML candidate projections, supports cancellation and prevents late scene.start. Scoped GamePlayer diagnostics now keep the base game running on additive load failure, including retry; fatal errors still show a visible status. Visual cleanup disposes subtree adapters before parent destruction and removes per-entity caches.

660 Vitest /134 files +5 packaging checks, typecheck/lint/full build and canonical macOS package passed. Actual browser delayed/cancel/failure/retry paths passed. Updated native package passed 20 paused add/remove cycles (leases2→4→2), A/B/A, clean Stop and exact HTML/native pose comparison (413 numeric fields, max0). Evidence: outputs/additive3d-qa/{browser-latest,native-cycles}.json and export-parity/comparison.json; HTML build Pixi-HTML-99d6f0e1. Earlier native-pending text is historical. These are bounded fixture checks; long GPU/heap soak, broader model/backend matrix, material-slot/no-parent UX and Stage5–6 remain open. See latest AI-HANDOFF.


## Library model placement — latest 22 November checkpoint

The 3D module owns a Radix target picker through the generic overlays slot. Valid selected parents are retained; absent/2D selection uses the sole view. Multiple or zero views request a target or a new camera/light-equipped view. Model+new view is one transaction/undo, without a starter cube or Transform2D on the model. Requests cancel on document changes and revalidate asset revision/target/edit permission at confirm. MCP place_model also accepts newView:true, mutually exclusive with parentId, without opening UI.

667 Vitest /135 files +5 packaging checks, typecheck/lint/full build and canonical macOS package passed. Native Library placement, second-view target, Escape, zero-view creation and one Undo were exercised. outputs/placement3d-qa contains actual target/readiness/final source checks and screenshots. Original 11-entity QA restored dirty=false; source hash unchanged. An overlapping-view blank native frame was observed and still needs deterministic diagnosis (basic browser mixed-model/two-view harness remains visible); duplicate view names also need disambiguation. Full 3D quality gates/Stage5–6 remain open.


## Per-slot instance materials

`pixi3d.modelRenderer` v1 accepts optional `materialSlots` (default []): up to 128 unique zero-based metadata indices, each with `sourceRevision`, color tint, roughness and metallic. Existing v1 payloads remain readable. Slot overrides take priority over the existing whole-instance override; unmodified materials keep source identity and textures remain shared. Changing model asset in the Inspector clears old slots in the same transaction. Reimported revisions/out-of-range slots are diagnosed by authoring readiness and runtime/export preflight, so a reordered material is not silently styled. Reset or reapply explicitly after reimport. Texture replacement/material authoring is separate future work.

The module-owned Model Inspector lists materials by index and name (duplicate names are supported), with per-slot enable/reset, tint and PBR controls. Inspector and MCP `pixi3d-editor.material_override` use the same schema-validated scene transaction/undo path. `pixi3d-editor.inspect_materials` and player inspector `pixi3d.materials` read actual material identity and values with bounded paging, without changing the document or exposing renderer handles.

Independent two-material/duplicate-name fixture: `node scripts/fixtures/3d-materials.mjs`; optional inspection export: `node scripts/fixtures/3d-materials-export.mjs`. Do not regenerate while open: asset GUIDs change. Stock HTML exports exclude the QA probe.


## Cold HTML startup ESM cycle — latest 22 November checkpoint

The compiled Pixi lazy BitmapFont chunk imported shared helpers back from the entry, while the entry used top-level await to wait for runtime preparation. Browser HTTP200 and no console errors did not prove module evaluation completed. Bootstrap now starts async boot() without awaiting it at module scope; page lifetime guards and visible preparation phases are retained. Fatal init/Start reports cannot be overwritten by Ready/Running after disposal.

The build parses the actual entry AST and refuses top-level await. Four regression tests compile the real bootstrap with a lazy parser→entry reference and run it in a separate ESM process: old await shape deadlocks, new entry completes, fatal init/Start remain failed. 677 Vitest /137 files +5 packaging tests, typecheck/lint/full build and final canonical package passed. Five fresh browser URL runs (four main-fix, one final-guard build) reached Ready→running without reload, with actual model/material checks and empty error logs. Evidence: outputs/startup3d-qa/. Installed app.asar template bytes match the guarded build. This closes the observed cold-start cycle; broader backend/model/GPU quality gates and Stage5–6 remain open.
