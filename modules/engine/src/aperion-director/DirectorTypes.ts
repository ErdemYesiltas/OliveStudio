/**
 * Public types for the {@link DirectorPlugin} composition runner.
 *
 * A `Composition` is a JSON-friendly tree of `DirectorStep`s. Container steps
 * (`sequence`, `parallel`, `repeat`) hold children; leaf steps carry
 * strategy-specific payload that the corresponding {@link IStepStrategy}
 * understands.
 *
 * `vars` provides a single source of variables for the run; step config values
 * may reference them as `"$varName"` strings that the runner substitutes
 * before dispatch (`{ ms: "$payoutDuration" }` → `{ ms: 2000 }`).
 */

import type { Application } from 'pixi.js';

/**
 * A single composition node. The `type` discriminator is looked up in the
 * `StrategyRegistry`; everything else is strategy-specific payload.
 *
 * Container strategies (`sequence`, `parallel`) read `children`; `repeat`
 * reads `count` + `child`; leaf strategies read whatever fields they document.
 */
export interface DirectorStep {
    /** Strategy canonical type or registered alias. */
    type: string;
    /** Strategy-specific payload. Variable references like `"$payout"` are resolved at run time. */
    [key: string]: unknown;
}

/** Run-time variable bag — strategy-specific payload may reference these as `"$name"`. */
export type DirectorVars = Record<string, unknown>;

/** Event payload as it appears on `app.events`. */
export interface DirectorEventPayload {
    readonly type: string;
    readonly [key: string]: unknown;
}

/** Context passed to {@link TriggerSpec.when} and {@link TriggerSpec.vars}. */
export interface TriggerContext {
    /** The event that fired on `app.events`. */
    readonly event: DirectorEventPayload;
    /** Host application — exposed for sibling-plugin lookups (audio/animations/etc.). */
    readonly app: Application;
}

/**
 * Declarative binding between an `app.events` event and a composition.
 *
 * Stored on `Composition.trigger` so editor JSON can describe firing rules.
 * Programmatic equivalent: `app.director.bindEvent(eventName, compositionName, options)`.
 */
export interface TriggerSpec {
    /** Event `type` field to listen on (e.g. `'win:shown'`). */
    event: string;
    /** Optional predicate; composition fires only if `true` at event time. */
    when?: (ctx: TriggerContext) => boolean;
    /**
     * Optional JSON-friendly expression — bare identifiers resolve against the
     * event payload. Evaluated AND-combined with {@link when} (both must pass).
     *
     * @example `whenExpr: "payout >= 100 AND won"`
     */
    whenExpr?: string;
    /** Optional extractor — produces per-run variables from the event payload. */
    vars?: (ctx: TriggerContext) => DirectorVars;
}

/**
 * A named, JSON-friendly composition. Stored in the
 * {@link CompositionRegistry} and replayed via `app.director.play(name)`.
 */
export interface Composition {
    /** Stable identifier used in `play(name)` and trigger bindings. */
    name: string;
    /** Default variables — overridable per-run via `play(name, vars)`. */
    vars?: DirectorVars;
    /** Optional event trigger declaration. */
    trigger?: TriggerSpec;
    /** Root step — typically `{ type: 'sequence', children: [...] }`. */
    root: DirectorStep;
}
