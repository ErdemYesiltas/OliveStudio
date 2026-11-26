import { EventEmitter } from 'pixi.js';
import { type Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

export type EffectKey = string | symbol;
type EffectInstance<TTarget extends object> = Pick<BaseEffect<TTarget>, 'attach' | 'destroy' | 'isAttached'>;
export type EffectDependency<TTarget extends object> = {
  key: EffectKey;
  create: () => EffectInstance<TTarget>;
};

// Ported from aperion-libs packages/engine/src/effects/BaseEffect.ts.
/**
 * Lifecycle shared by every scope-bound effect: the attach/destroy pair and the
 * subscription bag behind it.
 *
 * An effect is an autonomous presentation mechanic bound to one host object — a
 * machine, a wheel — that reacts to that host's own events rather than to the game
 * FSM. Each scope gets its own thin subclass (`BaseMachineEffect`,
 * `BaseWheelEffect`) that names its host (`this.machine`, `this.wheel`) and adds a
 * typed subscribe helper for that host's event map; everything below is identical
 * across scopes and lives here.
 *
 * Extends `EventEmitter` so an effect that *owns* a domain event can `emit` — pass
 * its event map as `TEvents`. Effects that emit nothing use the default and simply
 * never call `emit`.
 *
 * Subclasses that add a host-specific subscribe helper route it through
 * {@link takeUntilDestroy}, so the subscription ends with the effect and no `off()` has to be
 * written anywhere:
 *
 * ```ts
 * protected onHost<K extends HostEvent['type']>(
 *   type: K,
 *   handler: (event: Extract<HostEvent, { type: K }>) => void,
 * ): void {
 *   this.target.on(type).pipe(this.takeUntilDestroy()).subscribe(handler);
 * }
 * ```
 *
 * {@link addTeardown} remains for what is not a stream — a ticker callback, a timer, a
 * presentation run to stop.
 *
 * @typeParam TTarget - The host object this effect attaches to.
 * @typeParam TEvents - Event map this effect emits itself. Omit when it emits nothing.
 */
export abstract class BaseEffect<
  TTarget extends object,
  TEvents extends EventEmitter.ValidEventTypes = never,
> extends EventEmitter<TEvents> {
  /**
   * The host this effect is attached to. Assigned by {@link attach} before
   * {@link onAttach} runs, so it is safe to read from any subclass hook — but not
   * from the constructor, which runs before attachment.
   */
  protected target!: TTarget;
  private readonly _teardowns: Array<() => void> = [];
  private readonly _releases: Array<() => void> = [];
  private readonly _destroy$ = new Subject<void>();
  private _attached = false;
  private _destroyed = false;

  /** Whether {@link attach} has run and {@link destroy} has not. */
  public get isAttached(): boolean {
    return this._attached;
  }

  /**
   * Bind the effect to `target` and run the subclass's {@link onAttach} wiring.
   * Idempotent — a second call is a no-op, so an effect can never double-subscribe.
   */
  public attach(target: TTarget): void {
    if (this._attached) return;
    if (this._destroyed) throw new Error('A destroyed effect cannot be attached again');
    this._attached = true;
    this.target = target;
    try {
      for (const dependency of this.dependencies()) this.requireEffect(dependency);
      this.onAttach(target);
    } catch (error) {
      try {
        this.destroy();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Effect attachment and rollback failed');
      }
      throw error;
    }
  }

  /**
   * Tear the effect down: every stream piped through {@link takeUntilDestroy} completes, every
   * tracked teardown runs in reverse registration order, then {@link onDestroy}, then all
   * emitter listeners are removed. Idempotent, and a no-op when the effect was never attached;
   * after it the effect is inert and is not meant to be re-attached.
   */
  public destroy(): void {
    if (!this._attached) return;
    this._attached = false;
    this._destroyed = true;
    this._destroy$.next();
    this._destroy$.complete();
    // Reverse order mirrors setup (tear down what was wired last, first).
    const errors: unknown[] = [];
    const cleanup = (teardown: () => void) => {
      try { teardown(); } catch (error) { errors.push(error); }
    };
    for (const teardown of this._teardowns.splice(0).reverse()) cleanup(teardown);
    cleanup(() => this.onDestroy());
    for (const release of this._releases.splice(0).reverse()) cleanup(release);
    this.removeAllListeners();
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'Effect teardown failed');
  }

  /** Detaching ends this instance's lifecycle, just like destroying it. */
  public detach(): void {
    this.destroy();
  }

  /** Required effects are installed on the same target before onAttach runs. */
  protected dependencies(): readonly EffectDependency<TTarget>[] {
    return [];
  }

  /** Acquire an effect during attachment and release it with this effect. */
  protected requireEffect(dependency: EffectDependency<TTarget>): void {
    if (!this._attached) throw new Error('Effect dependencies require an attached effect');
    this._releases.push(EffectScope.for(this.target).retain(dependency, this));
  }

  /** Register an arbitrary teardown (a ticker callback, a timer, a manual subscription). */
  protected addTeardown(fn: () => void): void {
    this._teardowns.push(fn);
  }

  /**
   * RxJS operator that completes a stream when this effect is destroyed — pipe every
   * subscription made in {@link onAttach} through it and teardown needs no bookkeeping.
   *
   * The same name and shape as `BaseFeature.takeUntilDestroy`, deliberately: an effect and a
   * feature should end a subscription the same way. The two hierarchies share no ancestor, so
   * the three lines are repeated rather than the vocabulary being split.
   *
   * @example
   * ```ts
   * this.target.on('spinStart').pipe(this.takeUntilDestroy()).subscribe(handle);
   * ```
   */
  protected takeUntilDestroy<T>(): (source: Observable<T>) => Observable<T> {
    return (source: Observable<T>) => source.pipe(takeUntil(this._destroy$));
  }

  /** Declare subscriptions here. The host is also available as `this.target`. */
  protected abstract onAttach(target: TTarget): void;

  /** Optional teardown beyond the tracked subscriptions (stop runs, clear maps). */
  protected onDestroy(): void {
    /* override when needed */
  }
}

type EffectEntry<TTarget extends object> = {
  effect: EffectInstance<TTarget>;
  owned: boolean;
  dependents: number;
  attaching: boolean;
};

const scopes = new WeakMap<object, unknown>();

/** One effect registry per target. Explicit and dependency ownership are independent. */
export class EffectScope<TTarget extends object> {
  private readonly effects = new Map<EffectKey, EffectEntry<TTarget>>();
  private readonly requirements = new WeakMap<EffectInstance<TTarget>, Map<EffectKey, number>>();

  private constructor(private readonly target: TTarget) {}

  static for<TTarget extends object>(target: TTarget): EffectScope<TTarget> {
    const current = scopes.get(target) as EffectScope<TTarget> | undefined;
    if (current) return current;
    const scope = new EffectScope(target);
    scopes.set(target, scope);
    return scope;
  }

  get(key: EffectKey) { return this.effects.get(key)?.effect; }

  *values() {
    for (const { effect, attaching } of this.effects.values()) if (!attaching) yield effect;
  }

  attach(key: EffectKey, effect: EffectInstance<TTarget>) {
    const previous = this.effects.get(key);
    this.checkCycle(key, previous);
    if (previous?.effect === effect) {
      previous.owned = true;
      return;
    }
    const entry = this.install(key, effect, previous);
    entry.owned = true;
    previous?.effect.destroy();
  }

  remove(key: EffectKey) {
    const entry = this.effects.get(key);
    if (!entry) return;
    entry.owned = false;
    this.releaseUnused(key, entry);
  }

  retain({ key, create }: EffectDependency<TTarget>, owner: EffectInstance<TTarget>): () => void {
    const previous = this.effects.get(key);
    this.checkCycle(key, previous);
    if (this.dependsOn(key, owner, new Set())) throw new Error(`Cyclic effect dependency: ${String(key)}`);
    const entry = previous ?? this.install(key, create());
    entry.dependents++;
    const requirements = this.requirements.get(owner) ?? new Map<EffectKey, number>();
    requirements.set(key, (requirements.get(key) ?? 0) + 1);
    this.requirements.set(owner, requirements);
    return () => {
      const remaining = (requirements.get(key) ?? 1) - 1;
      if (remaining) requirements.set(key, remaining);
      else requirements.delete(key);
      const current = this.effects.get(key);
      if (!current) return;
      current.dependents--;
      this.releaseUnused(key, current);
    };
  }

  clear() {
    for (const key of this.effects.keys()) this.remove(key);
  }

  private checkCycle(key: EffectKey, entry?: EffectEntry<TTarget>) {
    if (entry?.attaching) throw new Error(`Cyclic effect dependency: ${String(key)}`);
  }

  private dependsOn(key: EffectKey, owner: EffectInstance<TTarget>, visited: Set<EffectKey>): boolean {
    const effect = this.effects.get(key)?.effect;
    if (!effect || visited.has(key)) return false;
    if (effect === owner) return true;
    visited.add(key);
    for (const dependency of this.requirements.get(effect)?.keys() ?? []) {
      if (this.dependsOn(dependency, owner, visited)) return true;
    }
    return false;
  }

  private install(key: EffectKey, effect: EffectInstance<TTarget>, previous?: EffectEntry<TTarget>) {
    if (effect.isAttached) throw new Error('An effect instance is already attached');
    const entry = { effect, owned: false, dependents: previous?.dependents ?? 0, attaching: true };
    this.effects.set(key, entry);
    try {
      effect.attach(this.target);
      entry.attaching = false;
      return entry;
    } catch (error) {
      if (previous) this.effects.set(key, previous);
      else this.effects.delete(key);
      throw error;
    }
  }

  private releaseUnused(key: EffectKey, entry: EffectEntry<TTarget>) {
    if (entry.owned || entry.dependents || entry.attaching) return;
    this.effects.delete(key);
    entry.effect.destroy();
  }
}
