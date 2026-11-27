import { defer, map, Observable, race } from 'rxjs';
import { tickerDelay$ } from '../tickerDelay.js';
import type { DirectorStep } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';

/** Step shape for {@link TimeoutStrategy}. */
export interface TimeoutStep extends DirectorStep {
    type: 'timeout';
    /** Time budget for `do` (ms of **game** time — see the class note). */
    ms: number;
    /** The step that may exceed the budget. */
    do: DirectorStep;
    /** Optional step run if the timeout fires before `do` completes. */
    onTimeout?: DirectorStep;
}

/**
 * Declarative timeout — race `do` against a timer; if the timer wins, run
 * `onTimeout` (when given) before completing. Cleaner than wiring up the
 * equivalent `race` manually for the common timeout pattern.
 *
 * **The budget is measured on the app ticker, the same clock as `delay`** (2026-09-14). It used to
 * be RxJS `timer()`, the wall clock, which made the two disagree the moment `app.speed()` was
 * anything but 1 and kept counting through `app.pause()`. Pairing them is the obvious way to bound
 * an endless step by a beat's length — a `delay` for the hold beside a `timeout` for the effect
 * filling it — and at `speed 0.3` the hold ran three times as long while the timeout fired on
 * schedule, cutting the effect off a third of the way in with nothing logged.
 *
 * It also honours `ctx.pause$` / `ctx.resume$`, so `DirectorControl.pause()` holds the budget where
 * it is rather than spending it behind a frozen presentation.
 *
 * A timeout whose point is a **wall-clock** deadline — a server round trip, a socket that must
 * answer within N real seconds — does not belong here: it belongs in the code that owns that I/O,
 * where the clock is not a presentation's.
 *
 * @example
 * ```jsonc
 * {
 *   "type": "timeout",
 *   "ms": 5000,
 *   "do":        { "type": "waitFor", "event": "server:payout-confirmed" },
 *   "onTimeout": { "type": "log", "message": "payout confirmation timed out — skipping reward anim" }
 * }
 * ```
 */
export class TimeoutStrategy implements IStepStrategy<TimeoutStep> {
    readonly type = 'timeout';

    run(step: TimeoutStep, ctx: StepContext): Observable<void> {
        return new Observable<void>((sub) => {
            const TIMEOUT = Symbol('timeout');
            let paused = false;
            const pauseSub = ctx.pause$.subscribe(() => { paused = true; });
            const resumeSub = ctx.resume$.subscribe(() => { paused = false; });

            const inner = race(
                ctx.compile(step.do).pipe(map(() => 'done' as const)),
                tickerDelay$(Math.max(0, step.ms), {
                    ticker: ctx.ticker,
                    isPaused: () => paused,
                }).pipe(map(() => TIMEOUT)),
            ).subscribe({
                next: (winner) => {
                    if (winner === TIMEOUT && step.onTimeout) {
                        defer(() => ctx.compile(step.onTimeout as DirectorStep)).subscribe({
                            next: () => sub.next(),
                            error: (e) => sub.error(e),
                            complete: () => sub.complete(),
                        });
                    } else {
                        sub.next();
                        sub.complete();
                    }
                },
                error: (e) => sub.error(e),
            });

            return () => {
                inner.unsubscribe();
                resumeSub.unsubscribe();
                pauseSub.unsubscribe();
            };
        });
    }
}
