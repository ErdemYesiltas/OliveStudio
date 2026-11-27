import { defer, EMPTY, type Observable } from 'rxjs';
import type { DirectorStep } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';
import { logger } from '../host.js';

/** Step shape for {@link CompositionStrategy}. */
export interface CompositionStep extends DirectorStep {
    type: 'composition';
    /** Name of another composition registered via `app.director.register(...)`. */
    name: string;
}

/**
 * Embed another registered composition as a sub-flow. The sub-composition's
 * root is recursively compiled into the *parent* run — it inherits the
 * parent's `vars` map (mutations persist), `state`, triggering `event`,
 * and `next$` / `pause$` / `resume$` signals.
 *
 * This makes compositions reusable building blocks. If you need isolation,
 * embed an `assign`-then-`composition` pair so the sub-flow sees fresh vars.
 *
 * @example
 * ```jsonc
 * {
 *   "type": "sequence",
 *   "children": [
 *     { "type": "composition", "name": "reel-stop-flash" },
 *     { "type": "delay", "ms": 200 },
 *     { "type": "composition", "name": "win-evaluation" }
 *   ]
 * }
 * ```
 */
export class CompositionStrategy implements IStepStrategy<CompositionStep> {
    readonly type = 'composition';

    run(step: CompositionStep, ctx: StepContext): Observable<void> {
        return defer(() => {
            const composition = ctx.compositions.get(step.name);
            if (!composition) {
                logger.warn(`[Director] composition reference '${step.name}' not registered — skipping`);
                return EMPTY;
            }
            return ctx.compile(composition.root);
        });
    }
}
