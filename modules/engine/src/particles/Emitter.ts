import { type ParticleContainer, Point, Ticker, type Texture } from 'pixi.js';

/** A GSAP-style ease: `(t, begin, change, duration)`. See {@link Emitter._ease}. */
type FourArgEase = (t: number, begin: number, change: number, duration: number) => number;
import {
  generateEase,
  rotatePoint,
  parseTextures,
  getTexturesFromConfig,
  type SimpleEase,
} from './ParticleUtils.js';
import { Particle } from './Particle.js';
import type { EmitterConfigV3 } from './EmitterConfig.js';
import {
  BehaviorOrder,
  type IEmitterBehavior,
  type IEmitterBehaviorClass,
} from './behaviors/Behaviors.js';

/**
 * Placeholder in the sorted behavior list marking where the emitter applies its
 * own position and rotation to a new wave.
 *
 * A symbol rather than a real behavior because it is not configurable and must
 * not be registerable: {@link BehaviorOrder.Spawn} behaviors run before it, so
 * they place particles in emitter-local space, and everything else runs after,
 * seeing world coordinates.
 */
const PositionParticle = Symbol('Position particle per emitter position');

/**
 * Spawns and drives particles according to an {@link EmitterConfigV3}.
 *
 * The emitter owns the lifecycle — timing, pooling, the linked list of live
 * particles — while every visual and movement decision belongs to the behaviors
 * the config names. Particles are pooled and recycled rather than reallocated.
 *
 * @example
 * ```ts
 * const emitter = new Emitter(container, config);
 * emitter.emit = true;
 *
 * app.ticker.add((ticker) => emitter.update(ticker.elapsedMS * 0.001));
 * ```
 */
export class Emitter {
  private static knownBehaviors: { [key: string]: IEmitterBehaviorClass } = Object.create(null);

  /**
   * Registers a behavior class so configs can name it.
   *
   * Last registration wins, which is how a game replaces a shipped behavior —
   * register your own class under the same `type`. There is no limit on the
   * number of types.
   *
   * @param behaviorClass - The behavior class, carrying a static `type`.
   */
  public static registerBehavior(behaviorClass: IEmitterBehaviorClass): void {
    Emitter.knownBehaviors[behaviorClass.type] = behaviorClass;
  }

  /**
   * Behaviors run when a wave spawns, in sorted order, including the
   * {@link PositionParticle} marker.
   */
  protected initBehaviors: (IEmitterBehavior | typeof PositionParticle)[];
  /** The subset of behaviors implementing `updateParticle`, run every frame. */
  protected updateBehaviors: IEmitterBehavior[];
  /** The subset of behaviors implementing `recycleParticle`. */
  protected recycleBehaviors: IEmitterBehavior[];
  /** Shortest particle lifetime, in seconds. */
  public minLifetime: number;
  /** Longest particle lifetime, in seconds. */
  public maxLifetime: number;
  /**
   * Easing applied to every particle's normalised age before behaviors read it,
   * so one curve reshapes the whole effect.
   */
  public customEase?: SimpleEase;
  /** Backing field for {@link Emitter.frequency}. */
  protected _frequency: number;
  /** Probability that a due spawn happens, `0`–`1`. */
  public spawnChance: number;
  /** Ceiling on live particles; spawning pauses at the limit rather than queueing. */
  public maxParticles: number;
  /** Seconds to emit for before `emit` flips itself off; `-1` is unlimited. */
  public emitterLifetime: number;
  /**
   * Spawn offset from the owner's origin.
   *
   * A rocket travelling right would use `{ x: -50, y: 0 }` to trail flames from
   * its rear. Change it through {@link Emitter.updateSpawnPos}, which also marks
   * the position dirty for interpolation.
   */
  public spawnPos: Point;
  /** Particles released per spawn. */
  public particlesPerWave: number;
  /**
   * Emitter rotation in degrees, added to each particle's spawn angle. Change it
   * through {@link Emitter.rotate}.
   */
  protected rotation: number;
  /**
   * World position of the emitter's owner, added to `spawnPos`. Change it
   * through {@link Emitter.updateOwnerPos}.
   */
  protected ownerPos: Point;
  /**
   * Where the emitter was last update, so a fast-moving emitter can spread its
   * wave along the path travelled instead of stacking it at one point.
   */
  protected _prevEmitterPos: Point;
  /** Whether {@link Emitter._prevEmitterPos} holds a usable value yet. */
  protected _prevPosIsValid: boolean;
  /** Whether the owner or spawn position moved since the last update. */
  protected _posChanged: boolean;
  /** Backing field for {@link Emitter.parent}. */
  protected _parent: ParticleContainer | undefined;
  /** Add new particles behind existing ones rather than in front. */
  public addAtBack: boolean;
  /** How many particles are currently alive. */
  public particleCount: number;
  /** Backing field for {@link Emitter.emit}. */
  protected _emit: boolean;
  /** Countdown to the next spawn in seconds; at or below `0` a wave is due. */
  protected _spawnTimer: number;
  /** Remaining emitter lifetime in seconds; negative means unlimited. */
  protected _emitterLife: number;
  /** Head of the live-particle linked list. */
  protected _activeParticlesFirst?: Particle;
  /** Tail of the live-particle linked list, so appending a wave is O(1). */
  protected _activeParticlesLast?: Particle;
  /** Head of the recycled-particle pool. */
  protected _poolFirst?: Particle;
  /** The config this emitter was last initialised with. */
  protected _origConfig?: EmitterConfigV3;
  /** Backing field for {@link Emitter.autoUpdate}. */
  protected _autoUpdate: boolean;
  /**
   * The clock `autoUpdate` attaches to.
   *
   * Injected rather than reaching for `Ticker.shared` directly: an app running its
   * own ticker — the norm here, since `app.speed()` and `app.pause()` act on it —
   * could not otherwise reach this emitter, and a test had no way to advance it by
   * hand.
   */
  protected readonly _ticker: Ticker;
  /** Whether to self-destroy once every particle has died; set by {@link Emitter.playOnceAndDestroy}. */
  protected _destroyWhenComplete: boolean;
  /** Fired once every particle has died; set by `playOnce` / `playOnceAndDestroy`. */
  protected _completeCallback?: () => void;

  private _particleImages: Texture[];

  /**
   * @param particleParent - Container the particles are drawn in.
   * @param config - Emitter settings. `emit: false` starts the emitter disabled;
   * `autoUpdate: true` attaches it to `ticker`.
   * @param particleImages - Seed texture(s) for the particle pool, as instances
   * or asset aliases. Omitted, they are derived from the config's texture
   * behaviors — the real texture is assigned per particle at spawn anyway.
   * @param ticker - The clock `autoUpdate` attaches to. Defaults to `Ticker.shared`.
   */
  constructor(
    particleParent: ParticleContainer,
    config: EmitterConfigV3,
    particleImages?: Texture | Texture[] | string | string[],
    ticker: Ticker = Ticker.shared,
  ) {
    this._ticker = ticker;
    this.initBehaviors = [];
    this.updateBehaviors = [];
    this.recycleBehaviors = [];
    this.minLifetime = 0;
    this.maxLifetime = 0;
    this.customEase = undefined;
    this._frequency = 1;
    this.spawnChance = 1;
    this.maxParticles = 1000;
    this.emitterLifetime = -1;
    this.spawnPos = new Point();
    this.particlesPerWave = 1;
    this.rotation = 0;
    this.ownerPos = new Point();
    this._prevEmitterPos = new Point();
    this._prevPosIsValid = false;
    this._posChanged = false;
    this._parent = undefined;
    this.addAtBack = false;
    this.particleCount = 0;
    this._emit = false;
    this._spawnTimer = 0;
    this._emitterLife = -1;
    this._origConfig = undefined;
    this._autoUpdate = false;
    this._destroyWhenComplete = false;
    this._completeCallback = undefined;
    this._particleImages = [];

    this.parent = particleParent;

    this.particleImages = particleImages ?? getTexturesFromConfig(config);
    this.init(config);
  }

  /**
   * Seconds between spawns.
   *
   * Any value that is not a number above `0` is coerced to `1`, because a
   * frequency of `0` would make the spawn loop in {@link Emitter.update} never
   * terminate.
   */
  public get frequency(): number {
    return this._frequency;
  }
  public set frequency(value: number) {
    if (typeof value === 'number' && value > 0) {
      this._frequency = value;
    } else {
      this._frequency = 1;
    }
  }

  /**
   * The container particles are drawn in.
   *
   * Assigning this **kills every live particle** — the setter runs
   * {@link Emitter.cleanup} first, since the existing particles belong to the
   * old container.
   */
  public get parent(): ParticleContainer | undefined {
    return this._parent;
  }
  public set parent(value: ParticleContainer | undefined) {
    this.cleanup();
    this._parent = value;
  }

  /**
   * Seed textures for the particle pool. Assigning resolves strings and enforces
   * the shared-source rule via {@link ParticleUtils.parseTextures}.
   */
  public get particleImages(): Texture[] {
    return this._particleImages;
  }
  public set particleImages(value: Texture[] | string[] | string | Texture) {
    this._particleImages = parseTextures(value);
  }

  /**
   * Reconfigures the emitter, discarding any live particles.
   *
   * Behaviors are instantiated, then sorted by `order` with the
   * {@link PositionParticle} marker placed after the spawn behaviors and before
   * everything else — that split is what lets a spawn shape work in local space
   * while later behaviors see world coordinates. An unknown behavior type is
   * reported and skipped rather than throwing, so one bad entry does not take
   * the whole effect down.
   *
   * The behavior list is then partitioned once into the per-frame and
   * per-recycle subsets, so neither hot loop has to test for the optional hooks.
   *
   * @param config - The settings to apply. A falsy value is ignored.
   */
  public init(config: EmitterConfigV3): void {
    if (!config) {
      return;
    }

    this.cleanup();

    this._origConfig = config;

    this.minLifetime = config.lifetime.min;
    this.maxLifetime = config.lifetime.max;

    if (typeof config.ease === 'function') {
      this.customEase = config.ease;
    } else if (Array.isArray(config.ease)) {
      this.customEase = generateEase(config.ease);
    } else {
      // Guarded rather than typed away: configs arrive as JSON, where the type does not hold.
      if (config.ease) console.warn('[Emitter] `ease` must be a function or an EaseSegment[]');
      this.customEase = undefined;
    }

    this.particlesPerWave = 1;
    if (config.particlesPerWave && config.particlesPerWave > 1) {
      this.particlesPerWave = config.particlesPerWave;
    }

    this.frequency = config.frequency;
    this.spawnChance = typeof config.spawnChance === 'number' && Number.isFinite(config.spawnChance)
      ? Math.max(0, Math.min(1, config.spawnChance))
      : 1;

    this.emitterLifetime = config.emitterLifetime || -1;

    const maxParticles = config.maxParticles ?? 0;
    this.maxParticles = maxParticles > 0 ? maxParticles : 1000;

    this.addAtBack = !!config.addAtBack;

    this.rotation = 0;
    this.ownerPos.set(0);
    if (config.pos) {
      this.spawnPos.copyFrom(config.pos);
    } else {
      this.spawnPos.set(0);
    }

    this._prevEmitterPos.copyFrom(this.spawnPos);
    this._prevPosIsValid = false;

    this._spawnTimer = 0;
    this.emit = config.emit === undefined ? true : !!config.emit;
    this.autoUpdate = !!config.autoUpdate;

    const behaviors: (IEmitterBehavior | typeof PositionParticle)[] =
      config.behaviors
        .map((data) => {
          const BehaviorClass = Emitter.knownBehaviors[data.type];

          if (!BehaviorClass) {
            console.error(`Unknown behavior: ${data.type}`);

            return null;
          }
          return new BehaviorClass(data.config as never);
        })
        .filter((b) => !!b);

    behaviors.push(PositionParticle);
    behaviors.sort((a, b) => {
      if (a === PositionParticle) {
        return (b as IEmitterBehavior).order === BehaviorOrder.Spawn ? 1 : -1;
      } else if (b === PositionParticle) {
        return (a as IEmitterBehavior).order === BehaviorOrder.Spawn ? -1 : 1;
      }

      return (a as IEmitterBehavior).order - (b as IEmitterBehavior).order;
    });
    this.initBehaviors = behaviors.slice();
    this.updateBehaviors = behaviors.filter(
      (b) => b !== PositionParticle && b.updateParticle,
    ) as IEmitterBehavior[];
    this.recycleBehaviors = behaviors.filter(
      (b) => b !== PositionParticle && b.recycleParticle,
    ) as IEmitterBehavior[];
  }

  /**
   * Finds this emitter's live instance of a behavior type.
   *
   * @param type - The registered behavior type to look for.
   * @returns The instance, or `null` when the type is unknown or not configured
   * on this emitter.
   */
  public getBehavior(type: string): IEmitterBehavior | null {
    if (!Emitter.knownBehaviors[type]) return null;

    return (
      (this.initBehaviors.find(
        (b) => b instanceof Emitter.knownBehaviors[type],
      ) as IEmitterBehavior) || null
    );
  }

  /**
   * Pre-allocates particles into the pool so the first burst pays no allocation
   * cost mid-frame.
   *
   * @param count - How many particles to create.
   */
  public fillPool(count: number): void {
    for (; count > 0; --count) {
      const p = new Particle(this);

      p.next = this._poolFirst;
      this._poolFirst = p;
    }
  }

  /**
   * Returns a particle to the pool, unlinking it from the live list.
   *
   * @param particle - The particle to recycle.
   * @param fromCleanup - `true` when this is emitter teardown rather than the
   * particle reaching the end of its life. Passed on to behaviors as the inverse
   * `natural` flag, so an outro effect can tell the two apart.
   * @internal
   */
  public recycle(particle: Particle, fromCleanup = false): void {
    for (let i = 0; i < this.recycleBehaviors.length; ++i) {
      this.recycleBehaviors[i].recycleParticle?.(particle, !fromCleanup);
    }
    if (particle.next) {
      particle.next.prev = particle.prev;
    }
    if (particle.prev) {
      particle.prev.next = particle.next;
    }
    if (particle === this._activeParticlesLast) {
      this._activeParticlesLast = particle.prev;
    }
    if (particle === this._activeParticlesFirst) {
      this._activeParticlesFirst = particle.next;
    }

    particle.prev = undefined;
    particle.next = this._poolFirst;
    this._poolFirst = particle;

    particle.removeFromParent();

    --this.particleCount;
  }

  /**
   * Rotates the emitter, turning both the spawn offset and the particle
   * direction.
   *
   * @param newRot - The new rotation in degrees.
   */
  public rotate(newRot: number): void {
    if (this.rotation === newRot) return;

    const diff = newRot - this.rotation;

    this.rotation = newRot;

    rotatePoint(diff, this.spawnPos);

    this._posChanged = true;
  }

  /**
   * Moves the spawn offset relative to the owner.
   *
   * @param x - New offset X.
   * @param y - New offset Y.
   */
  public updateSpawnPos(x: number, y: number): void {
    this._posChanged = true;
    this.spawnPos.x = x;
    this.spawnPos.y = y;
  }

  /**
   * Moves the emitter's owner.
   *
   * Call this when particles are added to a world container while the owner
   * moves through it, so spawn interpolation follows the owner.
   *
   * @param x - New owner X.
   * @param y - New owner Y.
   */
  public updateOwnerPos(x: number, y: number): void {
    this._posChanged = true;
    this.ownerPos.x = x;
    this.ownerPos.y = y;
  }

  /**
   * Suppresses spawn-position interpolation on the next update.
   *
   * Call it after teleporting the owner — otherwise the next wave is smeared
   * along the line between the old and new position.
   */
  public resetPositionTracking(): void {
    this._prevPosIsValid = false;
  }

  /**
   * Whether new particles are spawned on update.
   *
   * Setting `false` stops spawning but lets live particles finish. Setting
   * either value **restarts** the emitter-lifetime countdown.
   */
  public get emit(): boolean {
    return this._emit;
  }
  public set emit(value: boolean) {
    this._emit = !!value;
    this._emitterLife = this.emitterLifetime;
  }

  /**
   * Whether the emitter drives itself from its ticker.
   *
   * `false` means the caller must call {@link Emitter.update} — which is what a
   * host with its own clock wants, so pause and time-scaling apply.
   */
  public get autoUpdate(): boolean {
    return this._autoUpdate;
  }
  public set autoUpdate(value: boolean) {
    if (this._autoUpdate && !value) {
      this._ticker.remove(this.updateByTicker, this);
    } else if (!this._autoUpdate && value) {
      this._ticker.add(this.updateByTicker, this);
    }
    this._autoUpdate = !!value;
  }

  /**
   * Starts emitting, self-updating, and destroys the emitter once every particle
   * has died.
   *
   * @param callback - Called when the last particle dies, before destruction.
   */
  public playOnceAndDestroy(callback?: () => void): void {
    this.autoUpdate = true;
    this.emit = true;
    this._destroyWhenComplete = true;
    this._completeCallback = callback;
  }

  /**
   * Starts emitting and optionally reports when every particle has died. Unlike
   * {@link Emitter.playOnceAndDestroy} the emitter stays usable afterwards.
   *
   * @param callback - Called when the last particle dies.
   */
  public playOnce(callback?: () => void): void {
    this.emit = true;
    this._completeCallback = callback;
  }

  /**
   * Ticker-shaped adapter for {@link Emitter.update}, converting Pixi's
   * milliseconds to the seconds the emitter works in.
   *
   * Exists because Pixi v8 passes the `Ticker` itself as the first argument, so
   * `ticker.add(emitter.update, emitter)` would hand `update` an object where it
   * expects a number.
   *
   * @param delta - The ticker driving this call.
   */
  public updateByTicker(delta: Ticker): void {
    this.update(delta.elapsedMS * 0.001);
  }

  /**
   * Advances every live particle and spawns any waves now due.
   *
   * Three things here are not obvious:
   *
   * - **Spawning catches up within one frame.** The spawn timer is decremented
   *   and drained in a loop, so a frequency shorter than the frame time still
   *   produces the right number of particles instead of one per frame.
   * - **Waves are spread along the emitter's path.** When the emitter moved
   *   since the last update, each wave is placed by interpolating between the
   *   old and new position by how far into the frame it was due — otherwise a
   *   fast-moving emitter would stack its particles at one point per frame.
   * - **Late particles are pre-aged.** A wave due mid-frame is immediately aged
   *   and run through the update behaviors by the overshoot, so it is not
   *   visually a frame behind.
   *
   * An ease taking four arguments is called with the `(time, begin, change,
   * duration)` signature some tween libraries use; anything else gets the
   * single-argument form.
   *
   * @param delta - Time since the previous frame, in **seconds**.
   */
  public update(delta: number): void {
    if (!this._parent) return;

    for (
      let particle = this._activeParticlesFirst, next: Particle | undefined;
      particle;
      particle = next
    ) {
      next = particle.next;

      particle.age += delta;

      if (particle.age > particle.maxLife || particle.age < 0) {
        this.recycle(particle);
      } else {
        particle.agePercent = this._ease(particle.age * particle.oneOverLife);

        for (let i = 0; i < this.updateBehaviors.length; ++i) {
          if (this.updateBehaviors[i].updateParticle?.(particle, delta)) {
            this.recycle(particle);
            break;
          }
        }
      }
    }

    let prevX = 0;
    let prevY = 0;

    if (this._prevPosIsValid) {
      prevX = this._prevEmitterPos.x;
      prevY = this._prevEmitterPos.y;
    }

    const curX = this.ownerPos.x + this.spawnPos.x;
    const curY = this.ownerPos.y + this.spawnPos.y;

    if (this._emit) {
      this._spawnTimer -= delta < 0 ? 0 : delta;

      while (this._spawnTimer <= 0) {
        if (this._emitterLife >= 0) {
          this._emitterLife -= this._frequency;
          if (this._emitterLife <= 0) {
            this._spawnTimer = 0;
            this._emitterLife = 0;
            this.emit = false;
            break;
          }
        }

        if (this.particleCount >= this.maxParticles) {
          this._spawnTimer += this._frequency;
          continue;
        }
        let emitPosX: number;
        let emitPosY: number;

        if (this._prevPosIsValid && this._posChanged) {
          const lerp = 1 + this._spawnTimer / delta;

          emitPosX = (curX - prevX) * lerp + prevX;
          emitPosY = (curY - prevY) * lerp + prevY;
        } else {
          emitPosX = curX;
          emitPosY = curY;
        }

        let waveFirst: Particle | undefined;
        let waveLast: Particle | undefined;

        for (
          let len = Math.min(
              this.particlesPerWave,
              this.maxParticles - this.particleCount,
            ),
            i = 0;
          i < len;
          ++i
        ) {
          if (this.spawnChance < 1 && Math.random() >= this.spawnChance) {
            continue;
          }

          let lifetime: number;

          if (this.minLifetime === this.maxLifetime) {
            lifetime = this.minLifetime;
          } else {
            lifetime =
              Math.random() * (this.maxLifetime - this.minLifetime) +
              this.minLifetime;
          }

          if (-this._spawnTimer >= lifetime) {
            continue;
          }

          let p: Particle;

          if (this._poolFirst) {
            p = this._poolFirst;
            this._poolFirst = this._poolFirst.next;
            p.next = undefined;
          } else {
            p = new Particle(this);
          }

          p.init(lifetime);

          if (this.addAtBack) {
            p.appendAt(this._parent, 0);
          } else {
            p.appendTo(this._parent);
          }

          if (waveFirst) {
            waveLast!.next = p;
            p.prev = waveLast;
            waveLast = p;
          } else {
            waveLast = waveFirst = p;
          }

          ++this.particleCount;
        }

        if (waveFirst) {
          if (this._activeParticlesLast) {
            this._activeParticlesLast.next = waveFirst;
            waveFirst.prev = this._activeParticlesLast;
            this._activeParticlesLast = waveLast;
          } else {
            this._activeParticlesFirst = waveFirst;
            this._activeParticlesLast = waveLast;
          }

          for (let i = 0; i < this.initBehaviors.length; ++i) {
            const behavior = this.initBehaviors[i];

            if (behavior === PositionParticle) {
              for (
                let particle: Particle | undefined = waveFirst,
                  next: Particle | undefined;
                particle !== undefined;
                particle = next
              ) {
                next = particle.next;
                this._placeSpawned(particle, emitPosX, emitPosY);
              }
            } else {
              behavior.initParticles(waveFirst);
            }
          }
          for (
            let particle: Particle | undefined = waveFirst,
              next: Particle | undefined;
            particle !== undefined;
            particle = next
          ) {
            next = particle.next;

            for (let i = 0; i < this.updateBehaviors.length; ++i) {
              if (
                this.updateBehaviors[i].updateParticle?.(
                  particle,
                  -this._spawnTimer,
                )
              ) {
                this.recycle(particle);
                break;
              }
            }
          }
        }

        this._spawnTimer += this._frequency;
      }
    }

    if (this._posChanged) {
      this._prevEmitterPos.x = curX;
      this._prevEmitterPos.y = curY;
      this._prevPosIsValid = true;
      this._posChanged = false;
    }

    if (!this._emit && !this._activeParticlesFirst) {
      if (this._completeCallback) {
        const cb = this._completeCallback;
        this._completeCallback = undefined;
        cb();
      }
      if (this._destroyWhenComplete) {
        this.destroy();
      }
    }
  }

  /**
   * Releases one wave immediately, outside the normal spawn rhythm.
   *
   * Honours `spawnChance` and `particlesPerWave` and respects `maxParticles`
   * (so nothing happens when the emitter is already full), but ignores both
   * `frequency` and `emit`. Unlike the spawn path in {@link Emitter.update},
   * particles are not pre-aged and no position interpolation is applied — the
   * wave is instantaneous by definition.
   */
  public emitNow(): void {
    if (!this._parent) return;

    const emitPosX = this.ownerPos.x + this.spawnPos.x;
    const emitPosY = this.ownerPos.y + this.spawnPos.y;

    let waveFirst: Particle | undefined;
    let waveLast: Particle | undefined;

    for (
      let len = Math.min(
          this.particlesPerWave,
          this.maxParticles - this.particleCount,
        ),
        i = 0;
      i < len;
      ++i
    ) {
      if (this.spawnChance < 1 && Math.random() >= this.spawnChance) {
        continue;
      }

      let p: Particle;

      if (this._poolFirst) {
        p = this._poolFirst;
        this._poolFirst = this._poolFirst.next;
        p.next = undefined;
      } else {
        p = new Particle(this);
      }

      let lifetime: number;

      if (this.minLifetime === this.maxLifetime) {
        lifetime = this.minLifetime;
      } else {
        lifetime =
          Math.random() * (this.maxLifetime - this.minLifetime) +
          this.minLifetime;
      }

      p.init(lifetime);

      if (this.addAtBack) {
        p.appendAt(this._parent, 0);
      } else {
        p.appendTo(this._parent);
      }

      if (waveFirst) {
        waveLast!.next = p;
        p.prev = waveLast;
        waveLast = p;
      } else {
        waveLast = waveFirst = p;
      }

      ++this.particleCount;
    }

    if (waveFirst) {
      if (this._activeParticlesLast) {
        this._activeParticlesLast.next = waveFirst;
        waveFirst.prev = this._activeParticlesLast;
        this._activeParticlesLast = waveLast;
      } else {
        this._activeParticlesFirst = waveFirst;
        this._activeParticlesLast = waveLast;
      }

      for (let i = 0; i < this.initBehaviors.length; ++i) {
        const behavior = this.initBehaviors[i];

        if (behavior === PositionParticle) {
          for (
            let particle: Particle | undefined = waveFirst,
              next: Particle | undefined;
            particle !== undefined;
            particle = next
          ) {
            next = particle.next;

            if (this.rotation !== 0) {
              rotatePoint(this.rotation, particle);
              particle.rotation += this.rotation;
            }

            particle.x += emitPosX;
            particle.y += emitPosY;
          }
        } else {
          behavior.initParticles(waveFirst);
        }
      }
    }
  }

  /**
   * Recycles every live particle at once.
   *
   * Behaviors see `natural: false`, so a recycle hook can tell teardown from a
   * particle dying of old age.
   */
  public cleanup(): void {
    let particle: Particle | undefined;
    let next: Particle | undefined;

    for (particle = this._activeParticlesFirst; particle; particle = next) {
      next = particle.next;
      this.recycle(particle, true);
    }
    this._activeParticlesFirst = this._activeParticlesLast = undefined;
    this.particleCount = 0;
  }

  /**
   * Whether this emitter has been destroyed.
   *
   * A destroyed emitter is still reusable: give it a new `parent` and call
   * {@link Emitter.init} again.
   */
  public get destroyed(): boolean {
    return !(this._parent && this.initBehaviors.length);
  }

  /**
   * Applies {@link customEase} to a 0..1 life fraction.
   *
   * Arity is the only way to tell the two ease conventions apart: a GSAP-style ease takes
   * `(t, begin, change, duration)`, a simple one takes `t` alone.
   */
  protected _ease(lerp: number): number {
    const ease = this.customEase;

    if (!ease) return lerp;
    return ease.length === 4 ? (ease as unknown as FourArgEase)(lerp, 0, 1, 1) : ease(lerp);
  }

  /**
   * Moves one freshly spawned particle into the emitter's frame and gives it its starting age.
   *
   * Extracted from the spawn loop, which was nested eight deep by the time it reached here.
   */
  protected _placeSpawned(particle: Particle, emitPosX: number, emitPosY: number): void {
    if (this.rotation !== 0) {
      rotatePoint(this.rotation, particle);
      particle.rotation += this.rotation;
    }

    particle.x += emitPosX;
    particle.y += emitPosY;
    particle.age += -this._spawnTimer;
    particle.agePercent = this._ease(particle.age * particle.oneOverLife);
  }

  /**
   * Detaches from the ticker, kills every live and pooled particle, and drops
   * the emitter's references.
   */
  public destroy(): void {
    this.autoUpdate = false;

    this.cleanup();

    let next: Particle | undefined;

    for (let particle = this._poolFirst; particle; particle = next) {
      next = particle.next;
      particle.destroy();
    }
    this._poolFirst =
      // @ts-expect-error — `destroy` releases everything, including the non-nullable `Point`
      // fields. Typing them nullable would push a `?` through every read on the hot path.
      this.spawnPos =
      // @ts-expect-error — as above.
      this.ownerPos =
      this._parent =
      this.customEase =
      this._completeCallback =
        undefined;

    this.initBehaviors.length =
      this.updateBehaviors.length =
      this.recycleBehaviors.length =
        0;
  }
}
