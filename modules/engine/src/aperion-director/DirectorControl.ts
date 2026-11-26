import type { Observable, PartialObserver, Subscription } from 'rxjs';

/**
 * Handle returned by `app.director.play()` / `app.director.run()`.
 *
 * Symmetric with `AnimationControl` and `AudioControl`:
 *
 * - `observable` — hot RxJS source that completes when the composition
 *   finishes. Subscribing does NOT re-run the composition; late subscribers
 *   still see the terminal state (`ReplaySubject(1)`-backed).
 * - `finished` — Promise alternative for await-style flow.
 * - `pause()` / `resume()` — cascade to every active strategy's pause callback.
 *   Strategies opt in by responding to `pause`/`resume` events; defaults
 *   are no-ops, so e.g. audio keeps playing while animation freezes.
 * - `stop()` — abort the run. The composition tears down each active strategy.
 * - `next()` — advance past the currently running top-level step in the
 *   active `sequence`; container strategies (`sequence` / `parallel` /
 *   `repeat`) react to this via the `next$` signal.
 * - `skipToEnd()` — fast-forward to the run's ending: every remaining
 *   `sequence` step except the last is cancelled/skipped, the last one still
 *   plays, then the run completes naturally (intro → loop → outro teardown).
 *
 * Execution starts eagerly: calling `play(name)` or `run(composition)` begins
 * the run immediately. To abort, call `stop()`.
 */
export interface DirectorControl {
    /** Hot, single-run observable that completes when the composition finishes. */
    readonly observable: Observable<void>;
    /** Resolves on natural completion, rejects on error. */
    readonly finished: Promise<void>;
    /** Subscribe to the run's completion. Equivalent to `observable.subscribe(...)`. */
    subscribe(observer?: PartialObserver<void> | ((value: void) => void)): Subscription;
    /** Cascade pause to every active strategy. Strategies decide their own semantics. */
    pause(): void;
    /** Cascade resume to every active strategy. */
    resume(): void;
    /** Abort the run. Idempotent; no-op once the composition has ended. */
    stop(): void;
    /** Advance past the currently running top-level step. No-op once the run ends. */
    next(): void;
    /**
     * Fast-forward to the run's ending. Inside every `sequence`, the current and
     * any queued children except the last are cancelled/skipped — the last child
     * still plays, then the run completes naturally. Applies transitively to
     * nested sequences (the signal is latched: children subscribing after the
     * call are skipped immediately). A run whose root is not a `sequence`
     * ignores it — use `next()` / `stop()` there. No-op once the run ends.
     */
    skipToEnd(): void;
    /**
     * Writes a var of the running composition, as an `assign` step would — the way a caller
     * signals a run already under way. Steps compiled after the write interpolate the new value,
     * and a `waitFor` `condition` reads it on its next poll, which is the pairing it is for: the
     * composition waits on `{ "type": "waitFor", "condition": "$landed" }` and its owner calls
     * `setVar('landed', true)` when the moment comes (the big-win ceremony's count, 2026-10-01).
     * No-op once the run ends.
     */
    setVar(name: string, value: unknown): void;
}
