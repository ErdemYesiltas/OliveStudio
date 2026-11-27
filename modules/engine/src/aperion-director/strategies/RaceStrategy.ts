import { map, type Observable, of, race } from 'rxjs';
import type { DirectorStep } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';

/** Step shape for {@link RaceStrategy}. */
export interface RaceStep extends DirectorStep {
    type: 'race';
    /** Branches to run concurrently; the first to complete wins. */
    children: DirectorStep[];
}

/**
 * Run every child concurrently and complete as soon as the FIRST one finishes.
 * Mirror of `parallel`, which waits for all.
 *
 * Outstanding (losing) branches are unsubscribed — strategies that registered
 * teardown (animation `stop('preempted')`, audio handle `stop()`, etc.) honor
 * the cancellation. Classic use case: a timeout wrapper.
 *
 * @example
 * ```jsonc
 * // Play the win animation, but skip after 5s no matter what:
 * {
 *   "type": "race",
 *   "children": [
 *     { "type": "animation", "target": hero, "key": "spine:win-loop" },
 *     { "type": "delay", "ms": 5000 }
 *   ]
 * }
 * ```
 */
export class RaceStrategy implements IStepStrategy<RaceStep> {
    readonly type = 'race';

    run(step: RaceStep, ctx: StepContext): Observable<void> {
        if (!step.children || step.children.length === 0) return of(undefined);
        if (step.children.length === 1) return ctx.compile(step.children[0]);
        return race(step.children.map((c) => ctx.compile(c))).pipe(map(() => undefined));
    }
}
