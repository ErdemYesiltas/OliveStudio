# Particles

The emitter half of PixiJS 8 particles. Pixi supplies the rendering half — a `ParticleContainer`
draws thousands of `Particle` instances in **one** draw call over **one** `TextureSource`, with
`dynamicProperties` deciding what is re-uploaded per frame. This module supplies what Pixi does
not: spawn timing, lifetimes, a pooled particle list, and **behaviors** whose values are curves
over a particle's life.

An emitter is authored as JSON (`EmitterConfigV3`). The emitter's own fields say *when* particles
appear and how long they live; everything about how one looks or moves is a named entry in
`behaviors`. That registry is open, so a game contributes its own behavior without forking the
emitter.

Descended from `@pixi/particle-emitter`, ported to Pixi 8's `Particle` / `ParticleContainer` and
trimmed: the V1/V2 config upgrade path and the `new Function`-compiled `movePath` behavior are
gone, and the emitter's clock is injected rather than reached for.

---

## Installation

Nothing to register — and nothing to import from the package, either. `particles` is **not** on
`app.*` and **not** re-exported from `src/index.ts`. A game reaches it by registering a
`particle:*` animation like any other; the animation module's particle driver is this module's only
caller.

```ts
app.animations.set('particle:coin-burst', { config: coinBurstJson, duration: 1500 });
await app.animations.apply('particle:coin-burst', fxLayer).finished;
```

Inside the engine, import from the module directly:

```ts
import { Emitter, createParticleEmitter } from '../particles';
```

See `animation/README.md` for the `particle:*` surface (`duration`, `loop`, `dynamicProperties`)
and `director/README.md` for playing one as a composition step.

---

## Usage

### A config, end to end

Every field outside `behaviors` governs the emitter; every visual decision is a behavior.

```ts
import type { EmitterConfigV3 } from '../particles';

const coinBurst: EmitterConfigV3 = {
  lifetime: { min: 0.6, max: 1.2 },
  frequency: 0.05,
  particlesPerWave: 4,
  emitterLifetime: 0.4,
  maxParticles: 200,
  pos: { x: 0, y: 0 },
  behaviors: [
    { type: 'spawnBurst', config: { spacing: 0, start: 0, distance: 20 } },
    { type: 'textureRandom', config: { textures: ['coin1', 'coin2', 'coin3'] } },
    {
      type: 'moveAcceleration',
      config: { accel: { x: 0, y: 1400 }, minStart: 500, maxStart: 800 },
    },
    {
      type: 'alpha',
      config: {
        alpha: {
          list: [
            { value: 1, time: 0 },
            { value: 1, time: 0.7 },
            { value: 0, time: 1 },
          ],
        },
      },
    },
    { type: 'scaleStatic', config: { min: 0.6, max: 1 } },
    {
      type: 'rotation',
      config: { minStart: 0, maxStart: 360, minSpeed: 90, maxSpeed: 220, accel: 0 },
    },
  ],
};
```

`frequency` is **seconds between waves**, so `0.05` is twenty waves a second; with
`particlesPerWave: 4` and `emitterLifetime: 0.4` that is roughly 32 particles, after which the
emitter stops on its own. Omit `emitterLifetime` and it runs until stopped.

TypeScript authors should reach for `BehaviorConfigs` rather than `BehaviorEntry`: it is a
discriminated union of every registered behavior's `{ type, config }` pair, so a config cannot name
one behavior and configure another.

```ts
import type { BehaviorConfigs } from '../particles';

const speed: BehaviorConfigs = { type: 'moveSpeedStatic', config: { min: 100, max: 200 } };
```

### Driving an emitter directly

`new Emitter(parent, config)` needs a `ParticleContainer` and a clock. `update` takes **seconds**;
`updateByTicker` is the ticker-shaped adapter, since Pixi 8 hands a callback the `Ticker` itself
rather than a delta.

```ts
import { ParticleContainer } from 'pixi.js';
import { Emitter } from '../particles';

const container = fxLayer.addChild(
  new ParticleContainer({ dynamicProperties: { position: true, vertex: true, color: true } })
);

const emitter = new Emitter(container, coinBurst);
emitter.emit = true;

app.ticker.add((t) => emitter.update(t.elapsedMS / 1000));
```

Prefer driving it from the app's own ticker like this over setting `autoUpdate: true`: the app
ticker is what `app.speed()` scales and `app.pause()` freezes, while `autoUpdate` attaches to
whatever `Ticker` the constructor was given (`Ticker.shared` by default), which neither control
touches.

Two one-shot helpers cover the common case without a ticker line of your own — both start emitting
and self-update:

```ts
emitter.playOnce(() => console.log('last particle died')); // emitter stays usable
emitter.playOnceAndDestroy(() => onFxDone());              // destroys itself afterwards
```

`emitNow()` releases one wave outside the spawn rhythm. It honours `spawnChance`,
`particlesPerWave` and `maxParticles`, but ignores `frequency` and `emit`, and skips both
pre-ageing and position interpolation — an instantaneous wave by definition.

### `createParticleEmitter` — the driver adapter

This is what the particle driver calls, and the shape to reuse when something else in the engine
needs an emitter: `start` / `update` / `stopEmitting` / `destroy` / `isComplete`. Exported from the
package root since 2026-10-03 for a caller that stops emission and lets the live particles finish,
which an `AnimationControl` cannot say (`stop` / `finish` drop them) — slot-stage's big-win coins.

```ts
const handle = createParticleEmitter(fxLayer, coinBurst);

handle.start();
// per frame
handle.update(dtSec);
// when the effect should wind down
handle.stopEmitting();
if (handle.isComplete()) handle.destroy();
```

**`target` is read two ways, by its type.**

- A **`ParticleContainer`** is drawn into directly and stays yours — its parent, z-order,
  `dynamicProperties` and lifetime. `destroy` leaves it standing and empty, so the same container
  hosts the next emitter. Use this when the effect's place in the scene matters, or when several
  emitters should share one container and therefore one draw call.
- **Any other `Container`** is treated as a parent: a `ParticleContainer` is created under it from
  `dynamicProperties`, and `destroy` removes it again. The convenient default.

`autoUpdate` is forced **off** whatever the config says, because the caller owns the clock. And
`dynamicProperties` is only consulted when this function creates the container — passing it
alongside a `ParticleContainer` target logs a warning and is ignored, because Pixi bakes those
flags into the buffer layout at construction and offers no setter.

A fourth parameter, `ticker`, is handed to the `Emitter` for the one path that still uses the
emitter's own clock — `playOnceAndDestroy`. The particle driver passes `app.ticker` there; omitted,
the `Emitter` constructor's default (`Ticker.shared`) applies.

```ts
// Narrowed on purpose: no texture behavior animates frames, so `uvs` earns nothing.
createParticleEmitter(fxLayer, coinBurst, {
  position: true,
  vertex: true,
  rotation: true,
  color: true,
  uvs: false,
});
```

### Values over a particle's life

`alpha`, `scale`, `color` and `moveSpeed` take a `ValueList` — keyframes in ascending `time`, where
`time` is a fraction of the particle's own lifetime. `isStepped` holds each value until the next
keyframe instead of blending, which is the difference between a colour sweep and a flash.

```ts
{
  type: 'color',
  config: {
    color: {
      list: [
        { value: '#ff0000', time: 0 },
        { value: '#00ff00', time: 0.5 },
        { value: '#0000ff', time: 1 },
      ],
      isStepped: false,
      ease: (t) => t * t,
    },
  },
}
```

Three shortcuts are worth knowing. A list whose values never change collapses to a single node, so
the interpolator takes its cheapest path. The emitter-level `ease` applies to *every* interpolated
value, so one curve reshapes the whole effect without editing each list. And each `*Static`
behavior variant has no `updateParticle` at all — `alphaStatic` over `alpha` is a per-frame cost
removed, not merely reduced.

For a long gradient that must stay affordable, `ParticleUtils.createSteppedGradient` flattens one
into a fixed number of steps up front.

### Spawn shapes

**`noRotation` is a locked angle, not a flag.** Its config is `{ rotation }` in **degrees**,
defaulting to `0` (facing right), and it runs one step past `Late` *so that it overwrites* the other
rotation behaviours. A config ported from `@pixi/particle-emitter`, where the same name means "do
not spin the sprite" and takes `{ value: true }`, therefore reads as "lock every particle to 0°" —
and since `moveSpeed` travels along a particle's rotation, the whole effect silently flies sideways
with nothing logged. Drop it unless a fixed angle is what you want.

Note also that a particle's `rotation` is **both** its heading and its sprite angle: adding a
`rotation` behaviour to make artwork tumble also curves its path. Animate the frames
(`animatedSingle`) when the art should spin but the trajectory should not.

`spawnShape` delegates placement to a shape named in its config. `rect`, `torus` (also registered
as `circle`) and `polygonalChain` ship registered.

```ts
// A symbol cell, or the whole board
{ type: 'spawnShape', config: { type: 'rect', data: { x: -60, y: -60, w: 120, h: 120 } } }

// A ring, with each particle aimed outward
{
  type: 'spawnShape',
  config: { type: 'torus', data: { radius: 80, x: 0, y: 0, innerRadius: 70, affectRotation: true } },
}

// Along a path, segments weighted by length so density is even
{
  type: 'spawnShape',
  config: { type: 'polygonalChain', data: [{ x: 0, y: 0 }, { x: 120, y: 40 }, { x: 240, y: 0 }] },
}
```

Spawn behaviors run at `BehaviorOrder.Spawn` (`0`), the one order value handled specially: they run
**before** the emitter applies its own position and rotation, so a shape works in emitter-local
coordinates. Everything else runs after and sees world coordinates.

### Extending: a custom behavior

A behavior is one isolated concern with a static `type` and an `order`. `initParticles` is
required; `updateParticle` and `recycleParticle` are opt-in, so a spawn-only behavior costs nothing
per frame. Particles arrive as a **linked list** — walk `particle.next`; the emitter never
allocates an array.

```ts
import { Emitter, type IEmitterBehavior, BehaviorOrder, type Particle } from '../particles';

class MagnetBehavior implements IEmitterBehavior {
  public static type = 'magnet' as const;

  public order = BehaviorOrder.Late;
  private strength: number;

  constructor(config: { strength: number }) {
    this.strength = config.strength;
  }

  initParticles(first: Particle): void {
    let next: Particle | undefined = first;

    while (next) {
      next.config.magnetPhase = Math.random();
      next = next.next;
    }
  }

  updateParticle(particle: Particle, deltaSec: number): void {
    particle.x -= particle.x * this.strength * deltaSec;
    particle.y -= particle.y * this.strength * deltaSec;
  }
}

Emitter.registerBehavior(MagnetBehavior);
```

Registration is last-wins, which is also how a game **replaces** a shipped behavior: register your
own class under the same `type`. Shapes work the same way through
`ShapeSpawnBehavior.registerShape(cls, typeOverride?)` — the override is how one class serves
several names (`Torus` is also `circle`).

`Particle.config` is the scratch bag for per-particle state, and it is deliberately **not** cleared
on recycle, so a behavior can reuse the object it allocated last time. The flip side: overwrite
what you read there rather than assuming it is unset.

### Moving emitters

A fast-moving emitter would otherwise stack each frame's wave at one point. The emitter
interpolates spawn positions along the path travelled, which is why owner movement goes through a
method rather than a field:

```ts
emitter.updateOwnerPos(rocket.x, rocket.y); // owner moved
emitter.updateSpawnPos(-50, 0);             // trail flames from the rear
emitter.rotate(rocket.angle);               // turns both the offset and the particle direction
emitter.resetPositionTracking();            // after a teleport, or the next wave smears
```

---

## Built-in behaviors

Twenty-one, registered eagerly by `index.ts`. The `*Static` variants have no per-frame hook.

### Spawn — `BehaviorOrder.Spawn` (`0`)

| `type` | Config | What it does |
|---|---|---|
| `spawnPoint` | `{}` | Leaves every particle at the emitter's position. The no-op default. |
| `spawnBurst` | `{ spacing, start, distance }` (degrees, units) | Fans a wave at evenly spaced angles from `start`. `spacing: 0` randomises the angle instead — starburst versus puff. A non-zero `distance` puts them on a ring. |
| `spawnShape` | `{ type, data }` | Delegates to a registered shape. Throws at construction on an unknown `type`. |

### Movement — `BehaviorOrder.Late` (`5`)

| `type` | Config | What it does |
|---|---|---|
| `moveSpeed` | `{ speed: ValueList<number>, minMult? }` | Keyframed speed along the spawn direction. Direction is never changed — only magnitude — so a shape aims and this paces. `minMult` draws one per-particle multiplier at spawn. |
| `moveSpeedStatic` | `{ min, max }` | One random constant speed for the whole life; the per-frame step is a plain add. |
| `moveAcceleration` | `{ minStart, maxStart, accel: { x, y }, rotate?, maxSpeed? }` | Constant acceleration — gravity, wind, a magnet. Integrates by the velocity **midpoint**, so a falling arc does not overshoot. `rotate: true` faces each particle along its travel, overriding any rotation behavior. `maxSpeed: 0` is unlimited. |

### Appearance over life — `BehaviorOrder.Normal` (`2`)

| `type` | Config | What it does |
|---|---|---|
| `alpha` | `{ alpha: ValueList<number> }` | Keyframed opacity. |
| `alphaStatic` | `{ alpha }` | One fixed opacity at spawn. |
| `scale` | `{ scale: ValueList<number>, minMult? }` | Keyframed uniform scale. `minMult` gives a wave one size spread while it grows and shrinks together. |
| `scaleStatic` | `{ min, max }` | One random scale per particle. |
| `color` | `{ color: ValueList<string> }` | Keyframed tint, interpolated per channel, from 6-digit hex. |
| `colorStatic` | `{ color }` | One fixed tint, parsed once at construction. |
| `rotation` | `{ minStart, maxStart, minSpeed, maxSpeed, accel }` (degrees) | Random start angle **added** to the spawn rotation, random spin rate, optional angular acceleration (integrated by the midpoint). |
| `rotationStatic` | `{ min, max }` | Random start angle only, also added to the spawn rotation. |
| `noRotation` | `{ rotation? }` | Pins every particle to one angle, **discarding** any spawn rotation. Ordered `Late + 1` precisely so it overwrites the other rotation behaviors — the one to use when a shape aims particles outward but the art must stay upright. |
| `anchorStatic` | `{ x, y }` | Fixed anchor. `Particle` already defaults to `0.5, 0.5`, unlike Pixi's `0, 0`. |

### Texture — `BehaviorOrder.Normal` (`2`)

| `type` | Config | What it does |
|---|---|---|
| `textureSingle` | `{ texture: Texture \| string }` | The same texture for every particle, resolved once. |
| `textureRandom` | `{ textures: (Texture \| string)[] }` | One picked at random per particle. |
| `textureOrdered` | `{ textures: (Texture \| string)[] }` | Walks the list in order, one per particle; the cursor carries across waves, so a four-texture list cycles evenly however the waves are sized. |
| `animatedSingle` | `{ anim: AnimatedParticleArt }` | Every particle plays one shared frame animation. |
| `animatedRandom` | `{ anims: AnimatedParticleArt[] }` | Each particle draws one animation from a pool. |

`AnimatedParticleArt` is `{ framerate, loop?, textures }`. A `framerate` of `-1` ties playback to
the particle's lifetime, so the clip always lands on its last frame however the life was
randomised; a frame entry may be `{ texture, count }` to hold one frame for several ticks without
repeating it in the list. Both animated behaviors need `dynamicProperties.uvs`, which is a
per-frame GPU upload for every particle — see the notes below.

## Spawn shapes

| `type` | Config (`data`) | What it does |
|---|---|---|
| `rect` | `{ x, y, w, h }` | Uniformly random point inside an axis-aligned rectangle. `w`/`h` clamp to `1`, so a zero-size rect degenerates rather than producing `NaN`. |
| `torus` / `circle` | `{ radius, x, y, innerRadius?, affectRotation? }` | Filled circle, or a ring when `innerRadius` is set. `affectRotation` offsets each particle's rotation by its own angle, pointing directional art away from the centre. |
| `polygonalChain` | `PointData[]` or `PointData[][]` | Random point along a chain of segments — close the chain for a polygon's perimeter. Segments are weighted by length, so an uneven chain does not bunch up on its short edges. |

---

## API

### `Emitter`

```ts
new Emitter(
  particleParent: ParticleContainer,
  config: EmitterConfigV3,
  particleImages?: Texture | Texture[] | string | string[],
  ticker: Ticker = Ticker.shared,
)
```

`particleImages` seeds the pool; omitted, it is derived from the config's texture behaviors, since
the real texture is assigned per particle at spawn anyway. `ticker` is what `autoUpdate` attaches
to — injected so an app running its own clock can reach the emitter, and so a test can advance it
by hand.

| Member | Description |
|---|---|
| `static registerBehavior(cls)` | Register a behavior class by its static `type`. Last-wins; no limit on types. |
| `init(config)` | Reconfigure, discarding live particles. Instantiates and sorts behaviors, then partitions them once into the per-frame and per-recycle subsets. |
| `update(deltaSec)` | Advance particles and spawn due waves. **Seconds.** |
| `updateByTicker(ticker)` | Ticker-shaped adapter, converting Pixi's milliseconds. |
| `emit` | Whether new particles spawn. `false` lets live ones finish. Setting **either** value restarts the emitter-lifetime countdown. |
| `autoUpdate` | Whether the emitter drives itself from its ticker. |
| `emitNow()` | Release one wave outside the spawn rhythm. |
| `playOnce(cb?)` / `playOnceAndDestroy(cb?)` | Start emitting and self-update; report when the last particle dies. The second destroys the emitter afterwards. |
| `parent` | The `ParticleContainer` drawn into. Assigning **kills every live particle** — they belong to the old container. |
| `particleImages` | Seed textures. Assigning resolves strings and enforces the shared-source rule. |
| `getBehavior(type)` | This emitter's live instance of a behavior type, or `null`. |
| `fillPool(count)` | Pre-allocate particles so the first burst pays no allocation cost mid-frame. |
| `recycle(particle, fromCleanup?)` | Return a particle to the pool. `@internal` — behaviors and `Particle.kill()` reach it. |
| `cleanup()` | Recycle every live particle at once; behaviors see `natural: false`. |
| `destroy()` | Detach from the ticker, kill live and pooled particles, drop references. |
| `destroyed` | Whether destroyed. A destroyed emitter is **reusable**: give it a new `parent` and call `init()`. |
| `rotate(deg)` / `updateSpawnPos(x, y)` / `updateOwnerPos(x, y)` / `resetPositionTracking()` | Emitter placement; see [Moving emitters](#moving-emitters). |
| `frequency` | Seconds between spawns. Anything not above `0` is coerced to `1`, because `0` would make the spawn loop never terminate. |
| `spawnChance`, `maxParticles`, `emitterLifetime`, `particlesPerWave`, `addAtBack`, `spawnPos`, `minLifetime`, `maxLifetime`, `customEase`, `particleCount` | Live counterparts of the config fields. |

### `createParticleEmitter(target, config, dynamicProperties?, ticker?)`

Returns `{ start, update, stopEmitting, destroy, isComplete }`. `config` is typed `unknown` because
the driver passes it through opaquely; `isComplete()` is `particleCount === 0 && !emit`. `ticker`
reaches the `Emitter` constructor and therefore only the `playOnceAndDestroy` path, since
`autoUpdate` is forced off here.

### `EmitterConfigV3`

| Field | Type | Default | Description |
|---|---|---|---|
| `lifetime` | `{ min, max }` | — | Range each particle's lifetime is drawn from, in seconds. Required. |
| `frequency` | `number` | — | Seconds between spawns. Required; coerced to `1` when not above `0`. |
| `pos` | `{ x, y }` | `0, 0` | Spawn origin within the parent container. |
| `behaviors` | `BehaviorEntry[]` | — | The behaviors applied to every particle. Required. |
| `particlesPerWave` | `number` | `1` | Particles released per spawn. |
| `spawnChance` | `number` | `1` | Probability a due spawn happens, `0`–`1`. Below `1` it scatters the rhythm. |
| `emitterLifetime` | `number` | `-1` (unlimited) | Seconds to keep spawning for. |
| `maxParticles` | `number` | `1000` | Ceiling on live particles; spawning pauses at the limit rather than queueing. |
| `addAtBack` | `boolean` | `false` | Add new particles behind existing ones, so they are less conspicuous as they pop in. |
| `emit` | `boolean` | `true` | Start emitting immediately. |
| `autoUpdate` | `boolean` | `false` | Attach to the emitter's ticker. Forced off by `createParticleEmitter`. |
| `ease` | `SimpleEase \| EaseSegment[]` | — | Applied to every interpolated value across a particle's life. Anything else warns and is dropped. |

### `BehaviorEntry` / `BehaviorConfigs`

`BehaviorEntry` is `{ type: string; config: any }` — the JSON shape. `BehaviorConfigs` is the
checked form: a discriminated union pairing each registered behavior's `type` with the config its
constructor accepts. `BehaviorType` is the union of `type` strings alone; `ShapeConfigs` /
`ShapeType` are the same pair for spawn shapes.

### `IEmitterBehavior` / `IEmitterBehaviorClass` / `BehaviorOrder`

| Member | Description |
|---|---|
| `order` | When this behavior runs. Lower runs earlier; `0` (`BehaviorOrder.Spawn`) runs before the emitter's own transform. |
| `initParticles(first)` | Initialise a wave. Required. Walk `particle.next`. |
| `updateParticle?(particle, deltaSec)` | Per-frame. Return `true` to recycle the particle immediately. |
| `recycleParticle?(particle, natural)` | For behaviors holding per-particle state. `natural: false` means emitter teardown, not end of life. |

`BehaviorOrder` is `Spawn = 0`, `Normal = 2`, `Late = 5` — conventional positions, not a closed
set. Behaviors sharing a value are assumed not to interfere, so their relative order is
unspecified.

### `Particle`

Extends Pixi's `Particle` with what the emitter and behaviors read: `maxLife`, `age`, `agePercent`,
`oneOverLife`, `next` / `prev` (the doubly linked list), and the `config` scratch bag.
`init(maxLife)` resets the transform, tint and alpha the previous use left behind — behaviors run
after it, so what they set at spawn survives. `kill()` returns it to the pool; `destroy()` is the
irreversible teardown.

### `PropertyNode` / `PropertyList`

`PropertyNode.createList(data)` builds the linked keyframe list from a `ValueList` (or a legacy
`{ start, end }` pair, expanded to times `0` and `1`), parsing string values to `{ r, g, b }`.
`PropertyList.reset(first)` points a list at that chain and picks its interpolation function
**once**, from the list's shape — two nodes, stepped, or multi-segment — so the per-particle,
per-frame call is a direct invocation with no branching. `interpolate` is `undefined` until
`reset()` has run.

### `ParticleUtils`

Exported as a namespace (`ParticleUtils.rotatePoint`, …).

| Export | Description |
|---|---|
| `GetTextureFromString` | How behaviors turn a string into a `Texture`. Aliased to `Texture.from`, and reassignable — the hook for pointing texture resolution at a host's own loader. |
| `parseTextures(textures)` | Resolve textures and aliases, **throwing** when they do not share one `TextureSource`. |
| `getTexturesFromConfig(config)` | The textures a config references, by inspecting its texture behaviors — warm or validate an effect's art without instantiating the emitter. |
| `generateEase(segments)` | Compile GreenSock CustomEase segments into a `SimpleEase`. |
| `createSteppedGradient(list, numSteps?)` | Flatten a colour gradient into an evenly spaced stepped list. |
| `hexToRGB(color)` | Parse `#AARRGGBB` / `#RRGGBB` / `0x…` / bare hex into `0`–`255` channels. |
| `combineRGBComponents(r, g, b)` | Pack channels into `0xRRGGBB`. |
| `rotatePoint`, `length`, `normalize`, `scaleBy` | In-place vector maths for the hot loop. `rotatePoint` returns immediately for a zero angle. |
| `getBlendMode(name)` | Validate a blend mode name, falling back to `'normal'`. No caller — see the notes. |
| `DEG_TO_RADS`, `Color`, `EaseSegment`, `SimpleEase` | Constant and types. |

---

## Notes

- **Not on `app.*`, and not on the engine barrel.** `src/index.ts` does not re-export this module,
  so `Emitter` is not importable from `@aperion-gaming/engine`. A game's route in is a `particle:*`
  animation; its escape hatch is `app.animations.registerDriver('particle', …)`, which is the only
  way to change particle behaviour wholesale.
- **One `TextureSource` per container.** `ParticleContainer` batches on a single source, so a mixed
  texture list would silently cost a draw call per switch. `parseTextures` throws instead, turning
  that into an authoring error. With a *supplied* container the constraint spans every emitter
  sharing it, and the source is whichever one the first particle brings.
- **`dynamicProperties` is not what its names suggest.** `vertex` carries **scale and anchor** —
  there is no separate `scale` flag — and `color` carries **alpha**, since `aColor` is packed from
  `Particle.color`. Pixi bakes these into the buffer layout at construction and offers no setter,
  so a wrong `false` fails silently: the particles simply do not scale, or tint. That is why
  `createParticleEmitter` defaults all five **on** and only narrowing is opt-in.
- **The clock is the caller's, and it is `app.ticker`.** `createParticleEmitter` forces
  `autoUpdate = false` whatever the config says — an `autoUpdate: true` would additionally attach
  the emitter to its own `Ticker`, advancing it twice per frame. The clock that actually advances
  the emitter is the one the caller pumps `update(dtSec)` from; the particle driver takes it from
  `ctx.ticker` (`app.ticker`), because `app.speed()` scales and `app.pause()` stops that instance
  and not necessarily `Ticker.shared`. `boot()` forces `sharedTicker: true` so the two coincide,
  but a hand-wired `Application` is free to differ.
- **An unknown behavior type is logged and dropped, not thrown** — one bad entry does not take the
  whole effect down, but a typo does silently lose part of it. An unknown *shape* type inside
  `spawnShape` does throw, at construction.
- **`Particle.config` is not cleared on recycle.** That is what lets a behavior reuse the vector it
  allocated last time instead of allocating per spawn; the cost is that a behavior must overwrite
  what it reads rather than assume it is unset.
- **`ColorBehavior` writes through `Color.shared`.** The value is consumed by the assignment
  immediately; it must not be held.
- **A `torus` radius is picked uniformly between the two bounds, not by area**, so a filled circle
  is denser toward the centre. That is the historical behaviour and reads well for most effects;
  use a thin ring when even coverage matters.
- **No blend-mode behavior.** In Pixi 8 blend mode is a property of the `ParticleContainer`, not of
  a particle, so per-particle blending is not expressible here — set it on the container.
  `ParticleUtils.getBlendMode` is the validator left from that era and currently has no caller.
- **The allocation budget is a slot game's, not a demo's.** Per-particle-per-frame `Point`s and
  object literals inside an `updateParticle` are the thing to watch; the shipped behaviors either
  reuse `particle.config` storage or avoid the update hook entirely.
- **No tests.** Vitest is installed in this package, but there are none for this module yet.
- **Reducing this module:** removing a
  behavior file means removing its `registerBehavior` line in `index.ts` — registration is eager,
  so nothing here tree-shakes — and dropping the matching member from `BehaviorTypes.ts` /
  `shapes/ShapeType.ts` so an invalid config fails at compile time rather than at spawn.

---

## Source

```
src/particles/
├── Emitter.ts                  The emitter: spawn timing, pooling, the live linked list, the update loop
├── EmitterConfig.ts            EmitterConfigV3 — the authored surface — plus BehaviorEntry, RandNumber
├── Particle.ts                 Pixi's Particle + lifetime, list membership, the config scratch bag
├── ParticleUtils.ts            Texture resolution, colour maths, easing, in-place vector helpers
├── PropertyNode.ts             ValueList → linked keyframe list
├── PropertyList.ts             Interpolation over that list; the function is chosen once, in reset()
├── createParticleEmitter.ts    Driver adapter — start/update/stopEmitting/destroy/isComplete
├── index.ts                    Eager registerBehavior calls, then the public exports
└── behaviors/
    ├── Behaviors.ts            IEmitterBehavior, IEmitterBehaviorClass, BehaviorOrder
    ├── BehaviorTypes.ts        BehaviorType / BehaviorConfigs — type ↔ config pairing
    ├── PointSpawn.ts           BurstSpawn.ts     ShapeSpawn.ts
    ├── SpeedMovement.ts        AccelerationMovement.ts
    ├── Alpha.ts                Scale.ts          Color.ts       Rotation.ts    Anchor.ts
    ├── SingleTexture.ts        RandomTexture.ts  OrderedTexture.ts   AnimatedTexture.ts
    └── shapes/
        ├── SpawnShape.ts       The shape contract
        ├── ShapeType.ts        ShapeType / ShapeConfigs
        └── Rectangle.ts        Torus.ts          PolygonalChain.ts
```
