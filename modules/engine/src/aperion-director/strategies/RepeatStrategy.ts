import { defer, last, map, type Observable, of, repeat as rxRepeat } from 'rxjs';
import type { DirectorStep } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';

/** Step shape for {@link RepeatStrategy}. */
export interface RepeatStep extends DirectorStep {
    type: 'repeat';
    /** Iteration count. Negative ⇒ infinite (runs until cancelled by `next()` or `stop()`). */
    count: number;
    /** The step to replay on every iteration. */
    child: DirectorStep;
    /** Delay between iterations in ms. Defaults to `0`. */
    delayMs?: number;
}

/**
 * Replay `child` `count` times. Negative `count` means infinite — the loop
 * continues until the surrounding sequence's `takeUntil(next$)` cancels it
 * (via `control.next()` or `stop()`).
 *
 * Each iteration is built fresh via `defer` so any state captured inside
 * `ctx.compile(step.child)` is re-evaluated per pass.
 *
 * `delayMs` is compiled as a real `delay` step rather than handed to `repeat`'s
 * scheduler option, so the gap between iterations runs on the same game clock as a
 * standalone wait — pause-aware and scaled by `app.speed()` — and picks up any
 * replacement delay strategy the host registered.
 */
export class RepeatStrategy implements IStepStrategy<RepeatStep> {
    readonly type = 'repeat';

    run(step: RepeatStep, ctx: StepContext): Observable<void> {
        const count = step.count < 0 ? Infinity : Math.max(0, step.count);
        if (count === 0) return of(undefined);
        const delayMs = step.delayMs ?? 0;
        return defer(() => ctx.compile(step.child)).pipe(
            rxRepeat({
                count,
                delay: delayMs > 0 ? () => ctx.compile({ type: 'delay', ms: delayMs }) : 0,
            }),
            last(null, undefined),
            map(() => undefined),
        );
    }
}
