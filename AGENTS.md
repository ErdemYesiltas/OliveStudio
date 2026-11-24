# OliveStudio workspace rules

- Preserve existing uncommitted work and user project data.
- The repository lives at the workspace root (moved out of `rewrite/` on 23 Nov 2026). The old prototype is archived in `_legacy-prototype/` (gitignored); do not build from it or move it back. `Games/`, `AI-HANDOFF.md` and `OliveStudio-private-history.bundle` sit beside the repository, gitignored.
- Maintain exactly one visible/current OliveStudio application bundle: `/Applications/OliveStudio.app`.
- Package with `pnpm package:mac` from the repository root. All local/ad-hoc/release package commands share this destination; signed DMG/ZIP artifacts go in `release/`.
- Never create alternate `release-*` application folders or renamed QA `.app` wrappers. Test the canonical app with a separate user-data profile, or use the workspace Electron dependency for development tests.
- Retire obsolete generated editor app bundles through `pnpm build:cleanup` (macOS Trash with a restore map); do not remove projects, profiles, screenshots, test evidence or the Electron dependency.
- After a requested application build, update the canonical app rather than leaving another copy. Do not replace a running app; preserve its unsaved work and wait for it to close.
