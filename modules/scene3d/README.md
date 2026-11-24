# Spatial foundation — stage 1

Renderer-independent 3D document contracts. **The schema module is optional and is not activated in the desktop composition yet.** Stage 2 must enable it together with a real 3D authoring viewport. The installed editor still offers the isolated **3D Lab** technical demo; its cubes are not document entities.

## Contracts and storage

`ComponentDefinition.spatial` registers a space, whether it needs a view boundary, a world-preserving reparent adapter, and a position reset adapter. `spatialBoundary` declares the host/child spaces. `supportedSpaces` prevents incompatible feature components. The existing component contribution registry carries these public contracts; the host/kernel do not import 3D math, Pixi or scene-specific providers. MCP component discovery returns serializable metadata without exposing callback functions.

Legacy 2D entities retain their exact shape: absence of `entity.spatial` means `scene.transform2d`. New spatial entities declare their transform **type**, for example `spatial: "scene3d.transform"`. The named component is required, and a second registered spatial transform is rejected. This small explicit discriminator lets the scene/project parser preserve unknown or future spatial payloads losslessly when their module is absent. Such nodes are diagnosed and spatial edits require a matching installed provider. No dummy Transform2D is inserted.

- `scene3d.transform` v1: `x/y/z` in metres, normalized quaternion `qx/qy/qz/qw`, non-singular signed `scaleX/Y/Z`. Quaternion is the saved rotation; Euler presentation belongs to the authoring Inspector in stage 2.
- `pixi3d.viewport` v1: positive integer `width/height`, opening `scene.3d` on a host using `scene.2d`.
- Spatial math uses exact `gl-matrix@3.4.4`, double-precision output arrays, column-major composition and XYZW quaternions. No global allocation policy is modified. References: [matrix API](https://glmatrix.net/docs/module-mat4.html), [quaternion API](https://glmatrix.net/docs/module-quat.html).
- Parent chains are root-first **within the same coordinate space**. The boundary's pixel position/rotation/scale never gets multiplied into its 3D children's metre-based world matrix.

## Operations

`SceneService.createSpatial(name, type, parentId, data?)` creates through the document transaction/validation path. `setSpatial(id, data)` replaces the full validated pose. Existing delete, duplicate, `place`, reparent, component protection and undo/redo support the registered spatial type.

Reparent preserves the full 3D world pose within one view. Cross-view moves, 2D↔3D parenting, missing required boundaries and cycles fail before committing. TRS decomposition is checked by re-composing its matrix; a pose requiring shear is rejected instead of approximated. Batch placement is one undo and rolls back entirely if any root fails.

Copy converts spatial roots to their boundary-local world pose; paste converts this pose into a transformed destination parent’s local space, while the existing 2D root-paste path keeps its authored numeric values exactly; pasted 3D roots require an explicit compatible `parentId`. Paste creates new IDs. Detached roots are permitted only in explicit prefab/clipboard validation, never normal project scene validation.

Prefab snapshots/links, child overrides, apply/revert, duplicate ID remapping and root placement are spatial-aware. Use `PrefabService.instantiateSpatial(prefabId, parentId, data?)` for 3D roots. The old `instantiate(prefabId, {x,y})` stays 2D and rejects 3D roots. Complete view subtrees can also be prefabs. **Isolated 3D-root prefab edit mode is still gated on the stage 2 authoring viewport** and currently reports that requirement.

## Runtime boundaries

The current 2D viewport uses `project2DScene` and omits non-2D subtrees, preserving the source document. 2D `worldPosition` returns no pixel position for a 3D node. Default 2D visuals, particles, camera and Matter component definitions declare `supportedSpaces: ['scene.2d']` and cannot be attached to a known 3D node.

Desktop scene Play and the HTML GamePlayer explicitly reject unsupported spatial scenes until the 3D runtime contribution exists. Export preflight rejects a 3D component without a 3D export contribution. Stage 4 must replace these gates with provider capability checks; do not simply remove them. `scene3d` and gl-matrix are absent from current player output.

## Verification

`pnpm exec vitest run modules/scene3d` exercises actual SceneService/ProjectService/PrefabService transactions, math and migration: 2D JSON golden round-trip, 3D CRUD/duplicate/undo, same-view world preservation, mirrored scales, shear rejection, invalid parent rollback, batch atomicity, unsupported/future preservation, copy/paste, prefab apply/revert and a third-party scalar space using the same public contract. Real 2D Pixi/Matter definitions are checked for incompatible attachment.

Full verification on 21 November 2026: **123 files / 587 Vitest tests + 5 Node packaging tests**; TypeScript, lint/import boundaries, full desktop/player/server build and empty-host build passed. The canonical `/Applications/OliveStudio.app` was updated after clean shutdown. Native Lumenwood on the foundation build: selection→Properties, Effects→Scene, 2D Play/Stop and 3D Lab WebGL2 Step passed. The final paste-parent correction was then covered by the full automated suite and repackaged; those native flows were not repeated after that isolated correction. The application is currently closed after packaging, with the saved project untouched. MCP confirmed the project was unchanged and dirty=false. Evidence: `outputs/spatial-foundation-qa/`; screenshot/AX observations are in the CUA turn record, not archived image files.

An unrelated modularity leak found during this gate was fixed: Lab translations now have a pure `@rewrite/pixi3d-lab/strings` export. The empty shell no longer imports the Lab UI and its dynamic Pixi graph merely to get text.

## Current authoring delivery

The desktop now enables scene3d together with `@rewrite/render-pixi3d`. See [the authoring adapter](../render-pixi3d/README.md) for the current document projection, primitive/camera/light, Inspector, gizmos, MCP contributions, native QA and explicit runtime/export limits. The Stage 1 notes above describe the earlier data-only gate. Spatial root prefab editing now uses a temporary registered boundary and strips it on save.
