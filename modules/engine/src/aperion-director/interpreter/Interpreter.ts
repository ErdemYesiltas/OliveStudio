import type { Application } from 'pixi.js';
import { DirectorEventBus, logger, type DirectorPorts } from '../host.js';
import { CompositionRegistry } from '../CompositionRegistry.js';
import { EMPTY, type Observable, type PartialObserver, ReplaySubject, shareReplay, Subject, type Subscription, take, throwError } from 'rxjs';

import type { DirectorControl } from '../DirectorControl.js';
import type { DirectorEventPayload, DirectorStep, DirectorVars } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from '../strategies/IStepStrategy.js';
import type { StepStrategyRegistry } from '../strategies/StepStrategyRegistry.js';
import { getByPath } from '../getByPath.js';

/**
 * Tree-walking interpreter for {@link DirectorStep} compositions.
 *
 * GoF Interpreter pattern: walks a heterogeneous tree (`sequence`, `parallel`,
 * `repeat`, leaf step types), dispatching each node to its corresponding
 * {@link IStepStrategy}. The strategies are looked up at run time via the
 * supplied {@link StepStrategyRegistry}, so the same interpreter instance can
 * dispatch over an open-ended set of step types — including custom strategies
 * the host game registered after the interpreter was constructed.
 *
 * One instance per `DirectorPlugin` is sufficient — interpretation state
 * (`next$`, `pause$`, `resume$`, `state`, resolved `vars`) is built per
 * `interpret()` call, not stored on the instance.
 */
export class Interpreter {
    constructor(
        private readonly _app: Application,
        private readonly _registry: StepStrategyRegistry,
        private readonly signals = new DirectorEventBus<DirectorEventPayload>(),
        private readonly compositions = new CompositionRegistry(),
        private readonly ports: DirectorPorts = {},
    ) {}

    /**
     * Interpret a composition root. Variables are merged in by the caller
     * (composition defaults + `play(name, varsOverride)`); this method only
     * substitutes `"$varName"` references inside step payloads.
     *
     * The optional `event` argument carries the triggering event payload when
     * the run was started by a trigger; it is exposed via `StepContext.event`
     * so step strategies (notably `if` via the `#name` DSL prefix) can read
     * fresh event fields without round-tripping through `vars`.
     *
     * The optional `onAdvance` callback fires each time the returned control's
     * `next()` is invoked while the run is live — used by `DirectorService` to
     * emit `director:advance` without exposing an internal signal on the
     * public {@link DirectorControl} surface.
     *
     * Returns a {@link DirectorControl} that owns the active subscription,
     * the `next$` / `pause$` / `resume$` signals, and a `ReplaySubject(1)`-
     * backed observable. Execution starts eagerly — the subscription is
     * created here so the caller does NOT need to `subscribe()` to kick off
     * the run.
     */
    interpret(
        root: DirectorStep,
        vars: DirectorVars,
        event: DirectorEventPayload | null = null,
        onAdvance?: () => void,
        ticker = this._app.ticker,
    ): DirectorControl {
        const next$ = new Subject<void>();
        const pause$ = new Subject<void>();
        const resume$ = new Subject<void>();
        let paused = false;
        pause$.subscribe(() => { paused = true; });
        resume$.subscribe(() => { paused = false; });
        const skipToEnd$ = new Subject<void>();
        // Latched view: once skipToEnd() fires, sequence children that subscribe
        // later (they were still queued in the concat) must ALSO be skipped — a
        // plain Subject would lose the emission. The eager subscription below
        // pins the shareReplay buffer for the whole run.
        const skipSignal$ = skipToEnd$.pipe(take(1), shareReplay(1));
        skipSignal$.subscribe({ error: () => { /* latch only */ } });
        const state = new Map<string, unknown>();
        // Vars are kept in a mutable Map; the ReadonlyMap exposed on
        // StepContext is just a read-only view. `setVar` writes through.
        const varsMap = new Map<string, unknown>(Object.entries(vars));
        const setVar = (name: string, value: unknown) => { varsMap.set(name, value); };

        // A step's expressions stay as written, however deep it sits: a container resolves its whole
        // payload, children included, before they are compiled on their own.
        const rawKeysOf = (type: string): readonly string[] | undefined => this._registry.get(type)?.rawKeys;

        const compile = (step: DirectorStep, depth = 0): Observable<void> => {
            if (depth > 64) return throwError(() => new Error('[Director] composition nesting exceeds 64 steps'));
            if (!step || typeof step.type !== 'string') return throwError(() => new Error('[Director] step must have a type'));
            const strategy = this._registry.get(step.type) as IStepStrategy<DirectorStep> | undefined;
            if (!strategy) {
                logger.warn(`[Director] no strategy registered for type "${step.type}" — skipping`);
                return EMPTY;
            }
            const resolved = resolveVars(step, varsMap, rawKeysOf) as DirectorStep;
            const ctx: StepContext = {
                app: this._app,
                ticker,
                isPaused: () => paused,
                signals: this.signals,
                compositions: this.compositions,
                ports: this.ports,
                state,
                vars: varsMap,
                setVar,
                event,
                next$: next$.asObservable(),
                skipToEnd$: skipSignal$,
                pause$: pause$.asObservable(),
                resume$: resume$.asObservable(),
                compile: child => compile(child, depth + 1),
            };
            try {
                return strategy.run(resolved, ctx);
            } catch (err) {
                logger.error(`[Director] strategy "${step.type}" threw synchronously`, err);
                return throwError(() => err);
            }
        };

        const source$ = compile(root);
        return buildControl(source$, next$, pause$, resume$, skipToEnd$, setVar, onAdvance);
    }
}

/**
 * Wrap a compiled run in a {@link DirectorControl}.
 *
 * Mirrors the `AudioComposer` `buildControl` helper but adds `pause$` /
 * `resume$` signals so the control's `pause()` / `resume()` can cascade to
 * every active strategy that opted in.
 */
function buildControl(
    source$: Observable<void>,
    next$: Subject<void>,
    pause$: Subject<void>,
    resume$: Subject<void>,
    skipToEnd$: Subject<void>,
    setVar: (name: string, value: unknown) => void,
    onAdvance?: () => void,
): DirectorControl {
    const subject = new ReplaySubject<void>(1);
    let terminated = false;

    const finish = () => {
        if (terminated) return;
        terminated = true;
        next$.complete();
        pause$.complete();
        resume$.complete();
        skipToEnd$.complete();
    };

    const internalSub: Subscription = source$.subscribe({
        next: () => subject.next(),
        error: (e) => { subject.error(e); finish(); },
        complete: () => { subject.complete(); finish(); },
    });

    const finished = new Promise<void>((resolve, reject) => {
        subject.subscribe({ complete: () => resolve(), error: (e) => reject(e) });
    });

    return {
        observable: subject.asObservable(),
        finished,
        subscribe: (observer) => subject.subscribe(observer as PartialObserver<void>),
        pause: () => { if (!terminated) pause$.next(); },
        resume: () => { if (!terminated) resume$.next(); },
        stop: () => {
            if (terminated) return;
            internalSub.unsubscribe();
            subject.complete();
            finish();
        },
        next: () => { if (!terminated) { next$.next(); onAdvance?.(); } },
        skipToEnd: () => { if (!terminated) { skipToEnd$.next(); onAdvance?.(); } },
        setVar: (name, value) => { if (!terminated) setVar(name, value); },
    };
}

/**
 * A whole-string variable reference: `$name`, optionally followed by a dot path
 * (`$balance.amount`). Only a **whole** string is a reference — `"you won $balance.amount"`
 * is left alone, as it always was.
 */
const VAR_REF = /^\$([A-Za-z_]\w*)((?:\.\w+)*)$/;

/**
 * Walk `value` and replace any string entry of the shape `"$varName"` — or
 * `"$varName.path.into.it"` — with the matching `vars` entry.
 *
 * The dot form is what lets one var carry a whole namespace: a feature publishes
 * `balance: () => ({ amount, currency })` once and a composition addresses
 * `$balance.amount`, instead of every field needing its own registration.
 *
 * Returns the original reference when no field actually changes (cheap fast-path); otherwise
 * a structurally-cloned copy with substitutions applied.
 */
function resolveVars(
    value: unknown,
    vars: ReadonlyMap<string, unknown>,
    rawKeysOf: (type: string) => readonly string[] | undefined,
): unknown {
    if (typeof value === 'string') {
        const match = VAR_REF.exec(value);
        if (!match) return value;
        const name = match[1] as string;
        if (!vars.has(name)) return value;
        const root = vars.get(name);
        const path = match[2];
        if (!path) return root;
        const resolved = getByPath(root, path.slice(1));
        // A miss keeps the literal rather than substituting `undefined`: an unresolved
        // reference stays visible in a payload dump, which is how an unknown *name* already
        // behaves. Silently becoming `undefined` would turn a typo into a missing prop.
        return resolved === undefined ? value : resolved;
    }
    if (Array.isArray(value)) {
        let changed = false;
        const next = value.map((v) => {
            const r = resolveVars(v, vars, rawKeysOf);
            if (r !== v) changed = true;
            return r;
        });
        return changed ? next : value;
    }
    if (value && typeof value === 'object') {
        // Only descend into plain objects (step payloads authored as JSON). A
        // class instance resolved from a "$var" — e.g. a Pixi Container passed as
        // `target` — is an opaque leaf: walking its properties would recurse the
        // cyclic scene graph (parent ↔ children) and overflow the stack.
        const proto = Object.getPrototypeOf(value);
        if (proto !== null && proto !== Object.prototype) return value;
        let changed = false;
        const src = value as Record<string, unknown>;
        // A step object keeps its strategy's `rawKeys` — its DSL expressions — uninterpolated.
        const raw = typeof src.type === 'string' ? rawKeysOf(src.type) : undefined;
        const next: Record<string, unknown> = Object.create(null);
        for (const k of Object.keys(src)) {
            if (raw?.includes(k)) {
                next[k] = src[k];
                continue;
            }
            const r = resolveVars(src[k], vars, rawKeysOf);
            if (r !== src[k]) changed = true;
            next[k] = r;
        }
        return changed ? next : value;
    }
    return value;
}
