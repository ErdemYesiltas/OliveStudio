# Aperion Engine particle emitter

This directory copies `packages/engine/src/particles` from the local `aperion-libs` checkout at commit `4286ae352183eb97fa7930b42b4594d370e90457`. It includes the emitter, pool, property interpolation, all registered behaviors and spawn shapes, the driver adapter, and the English and Turkish upstream guides.

OliveStudio publishes the API at `@olivestudio/engine/particles`. The local port uses NodeNext-compatible imports and console diagnostics in place of the host logger. It preserves texture selection when a non-texture behavior follows a texture behavior and allows a spawn probability of zero. Constant keyframe lists return their single value. Behavior and shape registries use prototype-free lookup tables.

The OliveStudio prototype converts its Inspector settings to `EmitterConfigV3` and advances the emitter with the editor's Pixi ticker. Engine callers can configure the registered behaviors directly or register their own.
