/**
 * Event map emitted on `app.director.events`. Mirrors the shape of
 * `CoreEvent` in `CorePlugin` — `EventBus<DirectorEvent>` for type-safe
 * subscription with literal narrowing.
 *
 * Lifecycle: `director:run` (a composition started) → optional
 * `director:advance` (a `control.next()` fired) → `director:complete` or
 * `director:stopped` or `director:error`.
 */

/** Emitted when a composition starts (programmatic `play`/`run` or a trigger). */
export interface DirectorRunEvent {
    readonly type: 'director:run';
    readonly composition: string | undefined;
}

/** Emitted when `control.next()` fires while a composition is active. */
export interface DirectorAdvanceEvent {
    readonly type: 'director:advance';
    readonly composition: string | undefined;
}

/** Emitted when a composition completes naturally. */
export interface DirectorCompleteEvent {
    readonly type: 'director:complete';
    readonly composition: string | undefined;
}

/** Emitted when `control.stop()` is called (or the composition is preempted). */
export interface DirectorStoppedEvent {
    readonly type: 'director:stopped';
    readonly composition: string | undefined;
}

/** Emitted on strategy / runner errors. The original error is on `cause`. */
export interface DirectorErrorEvent {
    readonly type: 'director:error';
    readonly composition: string | undefined;
    readonly cause: unknown;
}

/** Discriminated union of every event the director emits on its own bus. */
export type DirectorEvent =
    | DirectorRunEvent
    | DirectorAdvanceEvent
    | DirectorCompleteEvent
    | DirectorStoppedEvent
    | DirectorErrorEvent;
