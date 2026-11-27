import { catchError, EMPTY, type Observable } from 'rxjs';
import type { DirectorStep } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';
import { logger } from '../host.js';

/** Step shape for {@link TryStrategy}. */
export interface TryStep extends DirectorStep {
    type: 'try';
    /** The risky step. If it errors, control passes to `catch`. */
    do: DirectorStep;
    /** Fallback step to run when `do` errors. Optional — when omitted, errors are silently swallowed. */
    catch?: DirectorStep;
}

/**
 * Run `do`; if it emits an `error` notification, switch to `catch` (or
 * silently complete if no catch is supplied). The original error is logged
 * to the console either way so failures aren't fully invisible.
 *
 * @example
 * ```jsonc
 * {
 *   "type": "try",
 *   "do":   { "type": "animation", "target": hero, "key": "spine:rare-win" },
 *   "catch": { "type": "audio", "play": { "layer": "sfx", "alias": "fallback-cheer" } }
 * }
 * ```
 */
export class TryStrategy implements IStepStrategy<TryStep> {
    readonly type = 'try';

    run(step: TryStep, ctx: StepContext): Observable<void> {
        return ctx.compile(step.do).pipe(
            catchError((err) => {
                logger.warn(`[Director] try.do errored — running catch`, err);
                return step.catch ? ctx.compile(step.catch) : (EMPTY as Observable<void>);
            }),
        );
    }
}
