import { Observable } from 'rxjs';
import { tickerDelay$ } from '../tickerDelay.js';
import type { DirectorStep } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';

/** Step shape for {@link DelayStrategy}. */
export interface DelayStep extends DirectorStep {
    type: 'delay';
    /** Wait duration in milliseconds. */
    ms: number;
}

/**
 * Silent wait. Emits nothing until `ms` elapses, then completes.
 *
 * Measured on the app ticker via {@link tickerDelay$}, not the wall clock, so a gap
 * stretches with `app.speed()` and freezes with `app.pause()` in step with the
 * animations it separates. It also honours `ctx.pause$` / `ctx.resume$`, so
 * `DirectorControl.pause()` holds the countdown where it is — otherwise the
 * composition would advance to its next step behind a paused presentation.
 *
 * The surrounding sequence's `takeUntil(next$)` cancels the wait if
 * `control.next()` fires while it is active.
 */
export class DelayStrategy implements IStepStrategy<DelayStep> {
    readonly type = 'delay';

    run(step: DelayStep, ctx: StepContext): Observable<void> {
        return new Observable<void>((subscriber) => {
            let paused = false;
            const pauseSub = ctx.pause$.subscribe(() => { paused = true; });
            const resumeSub = ctx.resume$.subscribe(() => { paused = false; });
            const delaySub = tickerDelay$(step.ms ?? 0, {
                ticker: ctx.app.ticker,
                isPaused: () => paused,
            }).subscribe(subscriber);

            return () => {
                delaySub.unsubscribe();
                resumeSub.unsubscribe();
                pauseSub.unsubscribe();
            };
        });
    }
}
