import { forkJoin, map, type Observable, of } from 'rxjs';
import type { DirectorStep } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';

/** Step shape for {@link ParallelStrategy}. */
export interface ParallelStep extends DirectorStep {
    type: 'parallel';
    children: DirectorStep[];
}

/**
 * Run every child step concurrently. Completes when ALL children complete.
 *
 * Branches share the run's `next$` signal — a single `control.next()` cancels
 * every active branch (because each child is compiled through `ctx.compile`,
 * and container children pipe through `takeUntil(next$)` themselves; leaf
 * children whose strategies don't honor `next$` simply continue and are
 * outlived by the surrounding sequence's `takeUntil`).
 */
export class ParallelStrategy implements IStepStrategy<ParallelStep> {
    readonly type = 'parallel';
    readonly aliases = ['par'] as const;

    run(step: ParallelStep, ctx: StepContext): Observable<void> {
        if (!step.children || step.children.length === 0) return of(undefined);
        const branches = step.children.map((child) => ctx.compile(child));
        return forkJoin(branches).pipe(map(() => undefined));
    }
}
