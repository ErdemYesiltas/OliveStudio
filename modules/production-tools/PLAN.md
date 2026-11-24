# Production tools implementation plan — 20 November 2026

Scope: functional first releases of all eight proposed workflows, plus configurable starter kits, project-wide search/dependency diagnostics and module-owned MCP automation. Existing functionality and project data stay intact. One workspace, trusted bundled modules, normal schema/transaction/undo and runtime export paths.

1. Shared contracts and independent module manifests: World, Brushes, Behavior Graph, Test Studio, Gameplay Lab, Game Data, Visual Review, Quality, Starter Kits. Each owns a versioned project section. Panels are contextual/pinnable through the existing host, not persistent sidebars.
2. World: SVG room map with drag/drop positioning, scene navigation, stable portal/spawn/actor references, connectivity diagnostics; click and proximity/input gates, identical Preview/export runtime arrival handling.
3. Brushes: deterministic seeded prefab strokes (spacing/scale/rotation), tile terrain masks with cardinal rules and existing merged solid collision; one stroke/undo and Escape cancellation through viewport painter.
4. Behavior Graph: constrained editable hierarchical/parallel statechart document, events/delays/guards/actions, generated XState script, attach and live state/guard inspection. Custom TypeScript stays intact: only graph-owned generated scripts may be rewritten.
5. Test Studio: real keyboard recording, saved frame scenarios, assertions, repeat/seed cases, cancellable Preview execution, failure samples and cached pose scrubbing/ghosts. No general reverse physics or bit-exact determinism promise.
6. Gameplay Lab: reusable exported 2D kinematic platform controller, editable presets, fixed-step simulated jump/dash trajectories, A/B overlays and undoable apply. Character collision queries use authored static platform bounds; this controller does not claim to replace Matter for every game.
7. Game Data: typed scalar/asset/reference tables, defaults/validation, batch cell edits, CSV/JSON import/export, bindings to component fields, Preview/export parity.
8. Visual Review: stable-ID scene/entity/component changes, side-by-side room diagrams, prefab/asset revision changes, local baselines and read-only Git revision comparison. No collaborative CRDT merging.
9. Quality: missing references/room/data diagnostics, texture decoded-memory and source-audio estimates, entity/build budgets, fresh required test proofs; actual HTML output byte gate. Reports stay separate from editor-only test/review data.
10. Starter kits/search: parameterized platformer and top-down kits using existing components, find entities/components/data/asset usages through UI/MCP.
11. Verify: pure model/transaction/compiler/runtime tests, existing full suite, typecheck/lint/build, native editor/MCP and browser export acceptance. Update delivery docs with exact tested scope and remaining limits.

Definition of done: every workflow has an accessible panel and MCP operations, persisted validated data where applicable, meaningful tests, normal undo, and no editor UI in game exports. Runtime features share one implementation with Preview. Test results have source fingerprints; stale passes cannot satisfy quality gates.

## Delivery status

Steps 1–10 have functional first releases. Step 11: typecheck, lint and 546 tests passed; native macOS/MCP and an independent HTML browser run passed. Exact commands, evidence and first-release boundaries are in [README.md](README.md). Native UI automation used the QA profile, leaving the normal user profile unchanged. No signed application package or cross-platform/device acceptance is claimed.

Follow-up product polish: complete panel-internal localization; direct node dragging/canvas edge gestures in Behavior Graph; more assertion kinds and cross-scene replay; collision-aware top-down/advanced controller modes; pixel asset diffs and large-world map navigation. These are extensions to the delivered workflows, not hidden runtime promises.
