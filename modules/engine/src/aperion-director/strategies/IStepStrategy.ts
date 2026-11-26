import type { Application } from 'pixi.js';
import type { Observable } from 'rxjs';
import type { DirectorEventPayload, DirectorStep, DirectorVars } from '../DirectorTypes.js';

/**
 * Context passed to every step strategy's `run()` method. Mirrors the role of
 * `ParseContext` in `factory/strategies/IDisplayObjectStrategy.ts`, but for the
 * runtime "run a step" task instead of the "parse a JSON definition" task.
 *
 * Carries:
 * - the host {@link Application} (for sibling-plugin lookups),
 * - a per-run scratchpad `state` (analog of `ChainContext` in `AudioComposer`),
 * - resolved per-run `vars` (after `play(name, varsOverride)` merge),
 * - the `next$` signal so strategies can wrap their work with
 *   `takeUntil(next$)` for `DirectorControl.next()` support,
 * - `pause$` / `resume$` signals so strategies can forward pause/resume into
 *   their underlying handles (the built-in animation and delay strategies use
 *   this; audio ignores them, and the container strategies pass them through),
 * - a recursive `compile` function for container strategies
 *   (`sequence` / `parallel` / `repeat`) to compose their children.
 */
export interface StepContext {
    /** Host application — read sibling plugins (`app.audio`, `app.animations`, …) here. */
    readonly app: Application;
    /** Mutable per-run scratchpad shared across every step in the same run. */
    readonly state: Map<string, unknown>;
    /**
     * Resolved variables for this run (composition defaults + caller overrides,
     * plus any in-run mutations via {@link setVar}). Read-only view — write
     * through `setVar` so that subsequent steps and DSL evaluations see the
     * new value.
     */
    readonly vars: ReadonlyMap<string, unknown>;
    /**
     * Write a variable into the run's `vars` map. Visible to every subsequent
     * step and DSL expression in this run. Used primarily by the built-in
     * `assign` and `forEach` strategies; custom strategies may use it for
     * domain-specific state plumbing.
     */
    setVar(name: string, value: unknown): void;
    /**
     * Triggering event payload, when the run was started by a trigger.
     * `null` for programmatic `play(name)` / `run(composition)` calls.
     *
     * Strategies should treat the event as frozen for the entire run — the
     * trigger captured it once; mutating it changes nothing observable.
     */
    readonly event: DirectorEventPayload | null;
    /**
     * Hot signal — emits once when `DirectorControl.next()` is called.
     * Strategies whose work outlives a single tick (sequence loop, infinite
     * repeat, parallel waiting on a loop branch) MUST pipe their observable
     * through `takeUntil(next$)` so they cancel on demand.
     */
    readonly next$: Observable<void>;
    /**
     * Latched signal — emits once `DirectorControl.skipToEnd()` is called, and
     * immediately re-emits to any later subscriber for the rest of the run.
     * The `sequence` strategy pipes every non-final child through
     * `takeUntil(skipToEnd$)`, so the running child cancels and queued children
     * (which subscribe after the call) are skipped on subscribe — only the final
     * child still plays. Leaf strategies normally ignore it.
     */
    readonly skipToEnd$: Observable<void>;
    /**
     * Hot signal — emits when `DirectorControl.pause()` is called. Strategies
     * may subscribe to forward the pause into their underlying handle
     * (e.g. the animation strategy calls `AnimationControl.pause()`, and the
     * delay strategy holds its countdown). Strategies that don't subscribe
     * simply ignore the signal — that's how "pause animation but keep audio
     * playing" works without extra config.
     */
    readonly pause$: Observable<void>;
    /** Hot signal — emits when `DirectorControl.resume()` is called. */
    readonly resume$: Observable<void>;
    /**
     * Recursive entry point — `sequence` / `parallel` / `repeat` strategies
     * compile their children through this. Variable interpolation has already
     * been applied to `step` before the runner calls `strategy.run(...)`.
     */
    compile(step: DirectorStep): Observable<void>;
}

/**
 * A step strategy encapsulates the runnable behavior for a single composition
 * step type. Strategies are registered in a {@link StepStrategyRegistry}; the
 * runner dispatches by `type` (canonical or alias).
 *
 * Naming mirrors `factory/strategies/IDisplayObjectStrategy` — `I` + the
 * domain object name (`Step`) + `Strategy`.
 *
 * Mental model: each `DirectorStep` is data; each `IStepStrategy` is the
 * code that turns that data into an `Observable<void>` whose completion lets
 * the surrounding chain advance.
 *
 * A strategy that waits should measure on the game clock — `tickerDelay$(ms,
 * { ticker: ctx.app.ticker })` — so the wait freezes with `app.pause()` and scales
 * with `app.speed()`. The `setTimeout` below is fine only because the shake's own
 * duration is wall-clock too.
 *
 * @example
 * ```ts
 * class CameraShakeStrategy implements IStepStrategy<{ type: 'camera-shake'; ms: number }> {
 *   readonly type = 'camera-shake';
 *   run(step, ctx) {
 *     return new Observable<void>((sub) => {
 *       const stop = ctx.app.camera.shake(step.ms);
 *       const t = setTimeout(() => { stop(); sub.next(); sub.complete(); }, step.ms);
 *       return () => { clearTimeout(t); stop(); };
 *     });
 *   }
 * }
 *
 * app.director.registerStrategy(new CameraShakeStrategy());
 * ```
 */
export interface IStepStrategy<TStep extends DirectorStep = DirectorStep> {
    /** Canonical type key, e.g. `'sequence'`, `'audio'`, `'camera-shake'`. */
    readonly type: string;
    /** Optional alias list (e.g. `['seq']` for `'sequence'`). */
    readonly aliases?: readonly string[];
    /**
     * Payload keys the interpreter leaves **uninterpolated**: DSL expressions the strategy compiles
     * and evaluates against the live vars itself (`if.when`, `waitFor.condition`, …). Without it an
     * expression that is a whole `"$name"` — `{ "condition": "$ready" }` — was replaced by the var's
     * value before the strategy saw it, so a `waitFor` found no condition and was skipped, and an
     * `if` tried to parse a boolean (2026-10-01).
     */
    readonly rawKeys?: readonly string[];
    /**
     * Compile a step to a runnable `Observable<void>`. The step's variable
     * references have already been resolved by the runner. The returned
     * observable should emit at most once and complete; errors propagate as
     * `error` and stop the surrounding composition.
     */
    run(step: TStep, ctx: StepContext): Observable<void>;
}

/** Re-export shape for plugin-facing callers. */
export type { DirectorStep, DirectorVars };
