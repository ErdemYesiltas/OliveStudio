# Desktop → VS Code panel parity

Initial audit based on the renderer panels, their callbacks in `apps/editor/src/main.tsx`, editor host services, and the VS Code 0.4.0 tree, command, and document providers. A saved field appearing in a tree does not count as the corresponding workflow being implemented. Native VS Code views and an Edit/Live-only central canvas remain the target.

| Panel | Present in 0.4.0 | Missing or different |
| --- | --- | --- |
| Scene | Shared Edit/Live canvas, selection, viewport tools, rulers, transforms, device profiles, playback | Placement from native asset/prefab views and native command paths for controls tied to other panels need checking. |
| Hierarchy | Object tree, selection, add, rename, delete, drag into containers | Sibling reorder, locking and visibility actions, asset drops, and protection of linked prefab members need checking. |
| Inspector | Selection, primitive edits, asset identity | Batch edits, controls for optional components, texture/target pickers, effect stack/tests, physics fitting, pivot presets, particle/audio tools, asset preview/replacement/slicing. |
| Assets | Built-in/project tree, import, folders, apply asset to selection | Search/filter, multi-selection, rename/move/delete, tags, previews, and placement. |
| Asset Bundles | Create, assign single asset, member listing, export | Rename/remove, unassign and bulk assignment, reveal member in Assets. |
| Timeline | Display clips, tracks, keys; edit key fields; play/stop | Author tracks/keys/clips/nesting/cues, scrub/pause, playback options, onion skin, record, graph/ease authoring. |
| Scenes | Activate, add, rename, duplicate, startup | Delete, scene links and transitions, world map and portal authoring, gameplay presets, live scene controls. |
| Prefabs | List and request canvas edit | Capture/place/variants, apply/revert/unpack, shared draft tree/Inspector, brush controls. |
| Input Map | Generic edits of present values | Create/remove actions and bindings, capture input, live values, type and global binding pickers. |
| Globals | Generic edits of present values | Add/remove/type conversion, live values, enable game saves and operate slots. |
| Scripts | Native TypeScript source, compile on save, console and resume | Create/rename/delete/assign and scene script tools, breakpoint/watches/step, behavior and logic graphs, test authoring/execution. |
| Physics | Generic edits if settings exist | Defaults, layers and collision pairs, joints/shape creation, preview debug and stepping. |
| Lighting | Generic edits if settings exist | Defaults, add a light, preview toggle and light/occluder workflows. |
| Multiplayer | Generic edits if settings exist | Defaults, movement template setup, local server/start/stop/test client/latency/drop and live room diagnostics. |
| Game Content | Generic edits if settings exist | Dialogues, achievements, localization import/export, CSV/data tables and bindings, add/remove entries. |
| Audio Studio | Generic edits if settings exist | Default mixer, transport, meters, sound generation and asset workflow. |
| Shader Library | Generic edits if a library exists | Preset/empty creation, duplicate/delete, source editing, compile diagnostics, assign/remove from selection. |
| AI Studio | Generic skills data if present | Local provider setup, chat, generate/import results, review/approve patch, checkpoints, LocalHub pairing/jobs/files. |
| Diagnostics | Preview console, paused breakpoint row | Clear/filter logs, profiler counters/history, native breakpoints/watches and test status. |

## Implementation checklist for 0.5.0

Each panel has the implemented work followed by any remaining desktop workflow. The JSON editors apply changes through the project's schema and VS Code undo history. They cover structured fields while the corresponding graphical authoring tools are still open items.

| Panel | Implemented | Still open |
| --- | --- | --- |
| Scene | Edit/Live canvas, shared renderer, asset and prefab placement, kit installation and camera-effect previews from tree actions | Exhaustive cross-view playback checks across every asset and camera-effect type |
| Hierarchy | Selection visibility, locking and flipping, sibling ordering and reparenting, protection for linked prefab children | Drag from Assets into Hierarchy and batch reordering |
| Inspector | Native property rows, validated object editor for optional fields, asset/particle/audio/camera previews and physics components via Physics | Batch property editing, visual texture slicing, pivot presets and specialized effect/target editors |
| Assets | Search by name, type and tag, folder management, tags, native image preview, animation/audio preview, placement and assignment | Batch library editing and a texture-slicing workflow |
| Asset Bundles | Rename, remove, assign selected assets, use Default to unassign, reveal a member in Assets, export | Verify multi-selection and export in the installed extension |
| Timeline | Clips, tracks, keyframes, easing selection, cues, nested clips, autoplay, seek, playback options, recording and onion skin | Graph/easing editor, pointer scrubbing, and finer cue editing through controls |
| Scenes | Create and duplicate, delete, link modes and transitions, Live navigation, world rooms and portals, diagnostics and gameplay kits | Interactive world-map diagram, portal editing controls and custom gameplay preset management |
| Prefabs | Capture, place, variant, apply/revert/unpack, validated prefab document, create and select prefab brushes | Shared Hierarchy and Inspector for the canvas prefab draft, terrain brush controls |
| Input Map | Add/remove actions and bindings, axis-to-global picker, live values and structured editor | Keyboard/gamepad capture and action type migration |
| Globals | Add/remove, set live values, enable and use save slots, structured editor | Dedicated type conversion, migration and slot inspection controls |
| Scripts | Native source editor, create/rename/delete, attach to scenes/objects, breakpoint/step/watch, scene test runner and behavior graph section | Graph canvas editing, debugger gutter integration and test input recording |
| Physics | World defaults, layers and collision pairs, create body/collider/joint, live colliders, simulation pause and step | Specialized collider fitting and joint target controls, layer removal safeguards and graphical shape editing |
| Lighting | Native light creation, preview toggle, scene settings and object properties | Specialized occluder and light controls with proof of visual parity |
| Multiplayer | Settings, movement setup, local start/stop/client, latency and server status | Packet-drop controls and complete room/client telemetry |
| Game Content | Create dialogues and achievements, i18next import/export, create and import/export CSV tables, structured content and data editing | Dialogue branching editor, localization grid, achievement and table field/reference pickers |
| Audio Studio | Mixer, level bars and active voice counts, transport, sound presets and WAV generation | Waveform editor, custom synthesis controls and live generation audition workflow |
| Shader Library | Presets, duplicate/remove, GLSL source editor, diagnostics and object assignment | Actual GPU compile reporting and a dedicated shader preview |
| AI Studio | Native LM Studio chat and reviewed scene edits, ComfyUI workflow import and result selection, LocalHub pairing and file listing | Companion job management, chat history, checkpoints, file import and end-to-end provider testing |
| Diagnostics | Filter and clear console, script stepping and watches, profiler capture with frame-time sparkline and system timings, test outcomes | Inspect individual profiler samples, capture export and full watch/instance tooling |

### Verification

- [x] Install the 0.4.0 VSIX and upgrade it to the 0.5.0 VSIX in an isolated VS Code profile.
- [x] Open all 18 native TreeViews and verify their contents.
- [x] Open a version 1 fixture automatically, edit in Inspector and save.
- [x] Author an Input Map action that upgrades the fixture to version 2, edit its section in the native JSON editor, and save the project.
- [x] Save a new Timeline clip, a collision layer, and a WAV generated by Audio Studio.
- [x] Open an embedded PNG in native Image Preview and open a sprite-sheet preview in the scene tab.
- [x] Run Edit/Live, open Export and start a canvas draft with no internal docks.
- [x] Pass type checking, lint, 616 Vitest tests and six packaging tests.
- [ ] Complete a per-command end-to-end check, including migration of a customized older profile and external providers.
