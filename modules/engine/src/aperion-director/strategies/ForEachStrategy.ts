import { concat, defer, last, map, type Observable, of } from 'rxjs';
import type { DirectorStep } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';

/** Step shape for {@link ForEachStrategy}. */
export interface ForEachStep extends DirectorStep {
    type: 'forEach';
    /**
     * Variable name (no `$` prefix) whose value is the array to iterate.
     * If the value isn't an array, the step is a no-op.
     */
    over: string;
    /** Variable name to bind each element to during the iteration. */
    as: string;
    /** Optional variable name to bind the current index. */
    indexAs?: string;
    /** Step to run for each element. Receives `$<as>` (and `$<indexAs>`) in vars. */
    do: DirectorStep;
}

/**
 * Serial iteration over an array variable. Binds each element to the named
 * iterator variable, runs `do`, then advances. Mutations to the iterator
 * variable persist after the iteration completes (the last element remains
 * bound) — `assign` it to a sentinel afterward if that is undesired.
 *
 * @example
 * ```jsonc
 * {
 *   "type": "forEach",
 *   "over": "winningLines",
 *   "as": "line",
 *   "indexAs": "i",
 *   "do": {
 *     "type": "animation",
 *     "target": "$line",
 *     "key": "spine:line-flash"
 *   }
 * }
 * ```
 *
 * For concurrent iteration, wrap `do` in a `parallel` or use a custom
 * `forkJoin` strategy — `forEach` is intentionally serial so winning-line
 * flashes feel sequenced rather than simultaneous.
 */
export class ForEachStrategy implements IStepStrategy<ForEachStep> {
    readonly type = 'forEach';

    run(step: ForEachStep, ctx: StepContext): Observable<void> {
        return defer(() => {
            const collection = ctx.vars.get(step.over);
            if (!Array.isArray(collection) || collection.length === 0) {
                return of(undefined);
            }
            const iterations = collection.map((item, i) =>
                defer(() => {
                    ctx.setVar(step.as, item);
                    if (step.indexAs) ctx.setVar(step.indexAs, i);
                    return ctx.compile(step.do);
                }),
            );
            return concat(...iterations).pipe(last(null, undefined), map(() => undefined));
        });
    }
}
