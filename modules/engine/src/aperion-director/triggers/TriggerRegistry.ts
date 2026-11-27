import type { Application } from 'pixi.js';
import type { DirectorEventBus } from '../host.js';
import type { DirectorEventPayload, DirectorVars, TriggerContext } from '../DirectorTypes.js';
import { compileExpression, type ExpressionEvaluator, type LookupFn } from '../../expression/index.js';

/**
 * Options for an event-driven trigger binding.
 *
 * - `when` lets the binding filter on event payload (e.g. only fire when
 *   `event.hasWin === true`). Callback form — not JSON-serializable.
 * - `whenExpr` is the JSON-friendly alternative: a string expression whose
 *   bare identifiers resolve against the event payload. Prefixed identifiers
 *   can target other namespaces:
 *     - `#name` → event payload (same as bare)
 *     - `$name` → composition's `defaultVars`
 *   Both `when` and `whenExpr` are AND-combined when both are present.
 * - `vars` extracts a per-run variable bag from the event so the composition
 *   sees fresh values on each fire (`{ payout: event.amount }`).
 * - `defaultVars` is the composition's `vars` defaults — supplied by the
 *   `DirectorPlugin` at bind time so `$name` references in `whenExpr` can
 *   read them. Not part of the public binding contract; callers using
 *   `app.director.bindEvent(...)` directly typically leave this unset.
 */
export interface TriggerOptions {
    when?: (ctx: TriggerContext) => boolean;
    whenExpr?: string;
    vars?: (ctx: TriggerContext) => DirectorVars;
    defaultVars?: DirectorVars;
}

/** Internal record kept per binding so `unbind` can clean up. */
interface Binding {
    composition: string;
    options: TriggerOptions;
    subscription: { unsubscribe(): void };
}

/**
 * Routes `app.events` events to registered compositions.
 *
 * Naming joins the `*Registry` family used elsewhere in the director module
 * ({@link StepStrategyRegistry}, {@link CompositionRegistry}) — each registry
 * stores a typed lookup keyed by a string. Here the key is the event type;
 * the value is the set of `(composition, options)` bindings that should fire.
 *
 * One event type may be bound to multiple compositions; each binding has its
 * own optional `when` predicate and `vars` extractor. Bindings survive
 * across composition runs — the registry fires fresh runs every time the
 * event arrives.
 */
export class TriggerRegistry {
    private readonly _bindings = new Map<string, Map<string, Binding>>();

    constructor(
        private readonly _app: Application,
        private readonly signals: DirectorEventBus<DirectorEventPayload>,
        private readonly _play: (name: string, vars: DirectorVars | undefined, event: DirectorEventPayload) => void,
    ) {}

    /**
     * Bind `eventType` → `compositionName`. Returns a teardown handle the
     * caller can stash; teardown is also achievable via `unbind`.
     *
     * `whenExpr` is compiled here (once per `bind` call), so malformed
     * expressions surface as {@link ExpressionParseError} synchronously
     * instead of every event fire.
     */
    bind(eventType: string, compositionName: string, options: TriggerOptions = {}): () => void {
        const exprEvaluator: ExpressionEvaluator | null = options.whenExpr
            ? compileExpression(options.whenExpr)
            : null;
        const defaultVars = options.defaultVars;

        const subscription = this.signals.on(eventType, (event: unknown) => {
            const eventPayload = event as DirectorEventPayload;
            const ctx: TriggerContext = { event: eventPayload, app: this._app };
            if (options.when && !options.when(ctx)) return;
            if (exprEvaluator) {
                const payload = eventPayload as unknown as Record<string, unknown>;
                const lookup: LookupFn = (name, prefix) => {
                    if (prefix === '$') return defaultVars?.[name];
                    // `#` and bare both resolve against the event payload
                    // (trigger-context default is event).
                    return payload[name];
                };
                if (!exprEvaluator(lookup)) return;
            }
            const vars = options.vars ? options.vars(ctx) : undefined;
            this._play(compositionName, vars, eventPayload);
        });

        let perEvent = this._bindings.get(eventType);
        if (!perEvent) {
            perEvent = new Map();
            this._bindings.set(eventType, perEvent);
        }
        // **Unsubscribe whatever this replaces.** The map is keyed by `(event, name)` and `set`
        // overwrote the entry silently — so binding the same pair twice left the first listener on
        // the bus with nothing pointing at it. The map said one binding, the bus had two, and the
        // composition ran twice per event: `play` preempts, so the visible symptom was a
        // presentation that restarted the instant it began. Reachable from `bindEvent` called twice,
        // and from an arm button pressed twice.
        perEvent.get(compositionName)?.subscription.unsubscribe();
        perEvent.set(compositionName, { composition: compositionName, options, subscription });

        // **Only what this call bound.** The map is keyed by `(event, name)`, so a later bind on the
        // same pair owns the slot now — and a teardown stashed by the earlier caller, run at the
        // ordinary time (a scene unmount, a feature detach), would disarm a trigger somebody else
        // installed afterwards. The symptom is an event that quietly stops firing a composition with
        // nothing to say who stopped it. `unbind` itself stays unconditional: a caller naming the
        // pair explicitly is asking for whatever is there.
        return () => {
            if (this._bindings.get(eventType)?.get(compositionName)?.subscription !== subscription) return;
            this.unbind(eventType, compositionName);
        };
    }

    /** Remove a specific binding. No-op when the binding does not exist. */
    unbind(eventType: string, compositionName: string): void {
        const perEvent = this._bindings.get(eventType);
        if (!perEvent) return;
        const binding = perEvent.get(compositionName);
        if (!binding) return;
        binding.subscription.unsubscribe();
        perEvent.delete(compositionName);
        if (perEvent.size === 0) this._bindings.delete(eventType);
    }

    /** Remove every binding for `eventType`. */
    unbindAll(eventType: string): void {
        const perEvent = this._bindings.get(eventType);
        if (!perEvent) return;
        for (const binding of perEvent.values()) binding.subscription.unsubscribe();
        this._bindings.delete(eventType);
    }

    /** Remove every binding the registry has ever made. Used by `destroy()`. */
    clear(): void {
        for (const perEvent of this._bindings.values()) {
            for (const binding of perEvent.values()) binding.subscription.unsubscribe();
        }
        this._bindings.clear();
    }

    /** List the event types this registry is currently listening on. */
    list(): string[] {
        return Array.from(this._bindings.keys());
    }
}
