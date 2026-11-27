import { type Application, type Ticker } from 'pixi.js';
import { DirectorEventBus, logger, type DirectorPorts } from './host.js';

import { CompositionRegistry } from './CompositionRegistry.js';
import type { DirectorControl } from './DirectorControl.js';
import type { DirectorEvent } from './DirectorEvents.js';
import type {
    Composition,
    DirectorEventPayload,
    DirectorStep,
    DirectorVars,
    TriggerSpec,
} from './DirectorTypes.js';
import { Interpreter } from './interpreter/Interpreter.js';
import { registerDefaultStepStrategies, StepStrategyRegistry, type IStepStrategy } from './strategies/index.js';
import { TriggerRegistry, type TriggerOptions } from './triggers/TriggerRegistry.js';

/**
 * Options accepted by {@link DirectorService}. Surfaced via
 * `ApplicationOptions.director`.
 */
export interface DirectorOptions {
    /** Compositions to register at install time (alternative to `service.register`). */
    compositions?: Composition[];
    ports?: DirectorPorts;
    signals?: DirectorEventBus<DirectorEventPayload>;
    ticker?: Ticker;
}

/**
 * Composition runner and event-driven trigger system.
 *
 * Installed as `app.director` by {@link DirectorPlugin}. A composition is a
 * JSON-friendly tree of `DirectorStep`s; each step's `type` is looked up in
 * the {@link StepStrategyRegistry} and the matching strategy compiles it to an
 * `Observable<void>`. The runner returns a {@link DirectorControl} with
 * `pause`/`resume`/`stop`/`next`/`subscribe`.
 *
 * Built-in strategies: `sequence`, `parallel`, `delay`, `repeat`, `animation`,
 * `audio`. Custom strategies can be registered via {@link registerStrategy}.
 *
 * Trigger system listens on `app.events`; bind events declaratively to
 * compositions with {@link bindEvent}.
 */
export class DirectorService {
    /** Step strategy lookup keyed by canonical type + aliases. */
    public readonly strategies = new StepStrategyRegistry();
    /** Named-composition lookup. */
    public readonly compositions = new CompositionRegistry();
    /** Typed event bus for director lifecycle events. */
    public readonly events = new DirectorEventBus<DirectorEvent>();
    public readonly signals: DirectorEventBus<DirectorEventPayload>;
    public readonly ports: DirectorPorts;
    public ticker?: Ticker;

    private readonly dispatched = new Set<DirectorControl>();
    private _interpreter: Interpreter | null = null;
    private _triggers: TriggerRegistry | null = null;
    private _active: { name: string | undefined; control: DirectorControl } | null = null;

    constructor(app: Application, options?: DirectorOptions) {
        registerDefaultStepStrategies(this.strategies);
        this.signals = options?.signals ?? new DirectorEventBus<DirectorEventPayload>();
        this.ports = options?.ports ?? {};
        this.ticker = options?.ticker;
        this._interpreter = new Interpreter(app, this.strategies, this.signals, this.compositions, this.ports);
        this._triggers = new TriggerRegistry(app, this.signals, (name, vars, event) =>
            this._playFromTrigger(name, vars, event),
        );

        if (options?.compositions) {
            for (const comp of options.compositions) this.register(comp);
        }
    }

    /** Tear down active runs, listeners, and registries. Idempotent. */
    destroy(): void {
        this._stopActive(false);
        for (const control of this.dispatched) control.stop();
        this.dispatched.clear();
        this._triggers?.clear();
        this._triggers = null;
        this._interpreter = null;
        this.compositions.clear();
        this.strategies.clear();
        this.events.clear();
    }

    // ─── Strategy management ─────────────────────────────────────────────────

    /** Register a custom step strategy. Replaces any prior registration under the same type. */
    registerStrategy(strategy: IStepStrategy): void {
        this.strategies.register(strategy);
    }

    /** Remove a strategy by canonical type. */
    unregisterStrategy(type: string): void {
        this.strategies.unregister(type);
    }

    // ─── Composition registry ────────────────────────────────────────────────

    /**
     * Register (or replace) a composition. When `composition.trigger` is set,
     * automatically bind the event to the composition.
     *
     * **Replacing one unbinds the *previous* registration's trigger**, and the condition used to ask
     * the wrong side. It read `has(name) && composition.trigger` — the **incoming** trigger — while
     * `_unbindTrigger` resolves the event off the composition already stored. So replacing a
     * triggered composition with an untriggered one unbound nothing and bound nothing, and the old
     * binding survived: `TriggerRegistry` keys a binding by `(event, name)`, the name is unchanged,
     * and the event therefore went on firing — now against a body that was never written for it. A
     * trigger you deleted still fired, which is the least debuggable shape a leak can take.
     *
     * `_unbindTrigger` already returns early when the stored composition has no trigger, so asking
     * only whether one is stored is the whole guard.
     *
     * Two things follow from `TriggerRegistry` keying a binding by `(event, name)` rather than by
     * who made it, and the first is narrower than it looks:
     *
     * - A hand-made {@link bindEvent} on the *same* pair is not a second binding — it **replaced**
     *   the declared one. So re-registering drops it, and there is nothing else it could drop: the
     *   pair holds one binding, whoever wrote it.
     * - A hand-made binding on a composition that declares **no** trigger survives this *and*
     *   {@link unregister}, because both unbind through `_unbindTrigger`, which reads the stored
     *   composition's own `trigger` and returns early when there is none. Unregistering such a
     *   composition therefore leaves a live binding naming something that is gone, and the next
     *   event logs `no composition registered`. Left as it stands: unbinding by name alone would
     *   need a reverse index the registry does not keep, and that is a change to the registry rather
     *   than to this method.
     */
    register(composition: Composition): void {
        if (this.compositions.has(composition.name)) this._unbindTrigger(composition.name);
        this.compositions.register(composition);
        if (composition.trigger) this._bindTrigger(composition.name, composition.trigger);
    }

    /** Remove a composition and any auto-bound trigger. */
    unregister(name: string): void {
        const existing = this.compositions.get(name);
        if (existing?.trigger) this._unbindTrigger(name);
        this.compositions.unregister(name);
    }

    /** Whether a composition is registered. */
    has(name: string): boolean {
        return this.compositions.has(name);
    }

    /** Lookup a registered composition for inspection / serialization. */
    get(name: string): Composition | undefined {
        return this.compositions.get(name);
    }

    /** List every registered composition name. */
    list(): string[] {
        return this.compositions.list();
    }

    // ─── Execution ───────────────────────────────────────────────────────────

    /**
     * Play a registered composition. Variables are merged: composition
     * defaults < `varsOverride` (callee wins).
     *
     * Calling `play()` while another composition is active **preempts** it.
     */
    play(name: string, varsOverride?: DirectorVars): DirectorControl {
        const composition = this.compositions.get(name);
        if (!composition) {
            logger.warn(`[Director] no composition registered for "${name}"`);
            return this._noopControl();
        }
        const merged: DirectorVars = { ...(composition.vars ?? {}), ...(varsOverride ?? {}) };
        return this._runWith(composition.root, merged, name, null);
    }

    /** Run a one-off composition object (or a bare root step). */
    run(composition: Composition | DirectorStep, varsOverride?: DirectorVars): DirectorControl {
        if ('root' in composition) {
            const merged: DirectorVars = { ...(composition.vars ?? {}), ...(varsOverride ?? {}) };
            return this._runWith(composition.root, merged, composition.name, null);
        }
        return this._runWith(composition, varsOverride ?? {}, undefined, null);
    }

    /** Dispatch a step within an existing host transport, without preempting that transport. */
    dispatch(step: DirectorStep, vars: DirectorVars = {}, ticker = this.ticker): DirectorControl {
        if (!this._interpreter) throw new Error('[Director] service not initialized');
        const control = this._interpreter.interpret(step, vars, null, undefined, ticker);
        this.dispatched.add(control);
        const forget = () => { this.dispatched.delete(control); };
        control.subscribe({ complete: forget, error: forget });
        void control.finished.catch(() => {});
        return control;
    }

    /** Stop the currently active run, if any. Emits `director:stopped`. */
    stop(): void {
        this._stopActive(true);
    }

    /** The currently active control, if any — `null` between runs. */
    get active(): DirectorControl | null {
        return this._active?.control ?? null;
    }

    /**
     * Name of the running composition, or `undefined` when nothing is running *or* when
     * the run came from {@link run} with a raw step, which has no name to report.
     *
     * {@link active} answers whether something is playing; this answers what, which is the
     * question tooling asks and the control itself cannot be asked.
     */
    get activeName(): string | undefined {
        return this._active?.name;
    }

    // ─── Trigger management ──────────────────────────────────────────────────

    /** Bind an `app.events` event type to a composition by name. */
    bindEvent(eventType: string, compositionName: string, options?: TriggerOptions): () => void {
        if (!this._triggers) throw new Error('[Director] service not initialized');
        return this._triggers.bind(eventType, compositionName, options);
    }

    /** Remove a specific event → composition binding. */
    unbindEvent(eventType: string, compositionName: string): void {
        this._triggers?.unbind(eventType, compositionName);
    }

    /** Remove every binding for an event type. */
    unbindAllEvents(eventType: string): void {
        this._triggers?.unbindAll(eventType);
    }

    // ─── Internals ───────────────────────────────────────────────────────────

    private _bindTrigger(name: string, trigger: TriggerSpec): void {
        const composition = this.compositions.get(name);
        this._triggers?.bind(trigger.event, name, {
            when: trigger.when,
            whenExpr: trigger.whenExpr,
            vars: trigger.vars,
            defaultVars: composition?.vars,
        });
    }

    private _unbindTrigger(name: string): void {
        const composition = this.compositions.get(name);
        if (!composition?.trigger) return;
        this._triggers?.unbind(composition.trigger.event, name);
    }

    private _playFromTrigger(name: string, vars: DirectorVars | undefined, event: DirectorEventPayload): DirectorControl {
        const composition = this.compositions.get(name);
        if (!composition) {
            logger.warn(`[Director] no composition registered for "${name}"`);
            return this._noopControl();
        }
        const merged: DirectorVars = { ...(composition.vars ?? {}), ...(vars ?? {}) };
        return this._runWith(composition.root, merged, name, event);
    }

    private _runWith(
        root: DirectorStep,
        vars: DirectorVars,
        name: string | undefined,
        event: DirectorEventPayload | null,
    ): DirectorControl {
        if (!this._interpreter) throw new Error('[Director] service not initialized');
        this._stopActive(true);
        const control = this._interpreter.interpret(root, vars, event, () => {
            if (this._active?.control === control) {
                this.events.emit({ type: 'director:advance', composition: name });
            }
        }, this.ticker);
        this._active = { name, control };

        this.events.emit({ type: 'director:run', composition: name });

        /*
         * **The active slot is released before the event, never after** (2026-09-14) — the same
         * order `_stopActive` documents, and for a sharper reason here.
         *
         * `events` is an `EventBus`, so `emit` is synchronous: a listener on `director:complete`
         * may call `play()` before this callback resumes. It did, and the line that followed the
         * emit — `this._active = null` — then wiped the *new* run's registration rather than the
         * finished one's. Everything that addresses the active run went blind: `stop()` and the
         * next `play()`'s preempt could not reach it, its `director:advance` events were
         * suppressed by the guard above, and a second composition could run beside it.
         *
         * Clearing first also stops the stale `_stopActive` inside that nested `play()` from
         * emitting a `director:stopped` for a composition that had already completed.
         */
        control.finished.then(
            () => {
                if (this._active?.control !== control) return;
                this._active = null;
                this.events.emit({ type: 'director:complete', composition: name });
            },
            (cause) => {
                if (this._active?.control !== control) return;
                this._active = null;
                this.events.emit({ type: 'director:error', composition: name, cause });
            },
        );

        return control;
    }

    /**
     * Stop the active run (if any) and clear `_active`. When `emit` is true,
     * fire `director:stopped` for the composition that was preempted/aborted.
     * `_active` is cleared before `control.stop()` so the run's `finished`
     * handler sees no active control and suppresses a spurious `director:complete`.
     */
    private _stopActive(emit: boolean): void {
        if (!this._active) return;
        const { name, control } = this._active;
        this._active = null;
        control.stop();
        if (emit) this.events.emit({ type: 'director:stopped', composition: name });
    }

    private _noopControl(): DirectorControl {
        const noop: DirectorControl = {
            observable: { subscribe: () => ({ unsubscribe: () => { /* */ } }) } as never,
            finished: Promise.resolve(),
            subscribe: () => ({ unsubscribe: () => { /* */ }, closed: true, add: () => undefined, remove: () => undefined } as never),
            pause: () => { /* */ },
            resume: () => { /* */ },
            stop: () => { /* */ },
            next: () => { /* */ },
            skipToEnd: () => { /* */ },
            setVar: () => { /* */ },
        };
        return noop;
    }
}
