# Particle Editor

Open **Particle Editor** from the toolbar (sparkles icon). This module adds authoring UI and automation around the existing `pixi.particles` component. Scene Preview, the panel and HTML export share the Pixi 8 ParticleContainer adapter and deterministic seeded simulation in `@rewrite/render-pixi/objects`.

## Authoring

1. Choose an existing scene emitter, or begin with Fire, Smoke, Snow, Rain, Sparkles or Explosion.
2. Adjust emission, lifetime, spawn shape, movement, color, opacity, size, spin and blend. Choose a built-in square/circle/soft glow or a project image texture.
3. Play/pause, restart, loop, scrub or zoom the isolated preview. These changes do not mutate the scene document.
4. **Apply to emitter** replaces the selected emitter settings in one undo transaction. **Create emitter** adds a new entity in one undo transaction. Reload discards the draft and reads the scene emitter.
5. Expand **Project presets & JSON** to save reusable project presets or copy/import validated settings JSON. Built-in presets are read-only. Project presets participate in save/open and undo.

Pinning/unpinning preserves draft and playback model state. Floating content scrolls. Scene Play disables authoring; effect preview stays independent. A preview always emits so an autoplay-disabled effect can still be designed; the saved autoplay setting stays intact.

## Boundaries and persistence

- `contracts.ts` is a browser/UI-free export subpath, shared by HTML preflight.
- `model.ts` owns draft, playback, preset and document transactions. Module scope disposes its project subscription.
- `preview.tsx` owns its Pixi application, generated texture/visual handle, ResizeObserver and animation frame; they are disposed on unmount.
- `views.tsx` consumes theme tokens and translation keys, with no Electron dependency.
- Component schema version remains 1; new fields have backward-compatible defaults. Runtime started/stopped timestamps are excluded from presets and editable settings.
- Optional unassigned texture uses a generated built-in texture. A referenced custom image still participates in asset validation/collection.
- `particles.presets` is editor-only project metadata. HTML strips it and uses the existing objects runtime; it does not ship this React panel.

## Automation

The module contributes tools to the normal `automation.execute` registry. Read schemas through `automation.capabilities`; use the current document context for edits.

| Tool | Purpose |
| --- | --- |
| `particles.presets` | Built-in and project presets |
| `particles.create` | Create from preset ID or settings, optional name/position |
| `particles.get` | Read emitter settings by entity ID |
| `particles.apply` | Validated replacement, one undo |
| `particles.sample` | Deterministic particle states at a time; offset/limit, at most 100 |
| `particles.save_preset` | Save/update custom project preset, one undo |
| `particles.delete_preset` | Remove custom preset, one undo |
| `particles.preview_state` | Read isolated draft/clock |
| `particles.preview_control` | Load preset/emitter, play/pause/seek/loop without document changes |

## Verification and limits

Ten model/simulation tests and one HTML export regression cover validation, seeded values/bounds/color, authoring undo, read-only behavior, preview isolation and stripping editor presets. Full workspace: 557 Vitest tests plus 5 packaging tests passed. Canonical macOS app and actual HTML export were tested with a built-in Fire emitter; evidence is in `outputs/particle-editor-qa` (ignored).

No particle collision physics, curve editor, animated atlas texture, or third-party particle JSON importer is included. Windows/Linux/mobile have not been exercised for this delivery. The preview auto-fits conservative motion bounds; use Zoom for a closer view.
