import { concat, last, map, merge, type Observable, of, takeUntil } from 'rxjs';
import type { DirectorStep } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';

/** Step shape for {@link SequenceStrategy}. */
export interface SequenceStep extends DirectorStep {
    type: 'sequence';
    children: DirectorStep[];
}

/**
 * Run every child step in serial — each must complete before the next begins.
 *
 * Each top-level child is wrapped with `takeUntil(next$)` so a single
 * `control.next()` cancels the currently running child and lets the
 * underlying `concat` advance. Every child except the last is additionally
 * wrapped with `takeUntil(skipToEnd$)` — the signal is latched, so a single
 * `control.skipToEnd()` cancels the running child AND skips the queued ones
 * the moment they subscribe, landing directly on the final child (the outro).
 *
 * This is the canonical container — `Composition.root` is almost always a
 * `sequence`, even when it has one element.
 */
export class SequenceStrategy implements IStepStrategy<SequenceStep> {
    readonly type = 'sequence';
    readonly aliases = ['seq'] as const;

    run(step: SequenceStep, ctx: StepContext): Observable<void> {
        if (!step.children || step.children.length === 0) return of(undefined);
        const lastIdx = step.children.length - 1;
        const wrapped = step.children.map((child, i) =>
            ctx.compile(child).pipe(takeUntil(i === lastIdx ? ctx.next$ : merge(ctx.next$, ctx.skipToEnd$))),
        );
        return concat(...wrapped).pipe(last(null, undefined), map(() => undefined));
    }
}
