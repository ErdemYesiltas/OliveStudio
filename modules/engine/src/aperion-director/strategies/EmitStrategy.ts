import { defer, type Observable, of } from 'rxjs';
import type { DirectorStep } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';

/** Step shape for {@link EmitStrategy}. */
export interface EmitStep extends DirectorStep {
    type: 'emit';
    /** Event `type` to emit on `app.events`. */
    event: string;
    /** Optional payload fields merged onto the emitted event. */
    payload?: Record<string, unknown>;
}

/**
 * Emit an event on `app.events`. Useful for chaining compositions:
 *
 * - `composition-a` ends → `emit { type: 'phase:complete' }` → a separate
 *   `composition-b` whose trigger is `{ event: 'phase:complete' }` fires.
 *
 * The step completes synchronously immediately after emitting — no waiting
 * for downstream handlers. If you need to wait for something the emit
 * triggers, follow with a `waitFor`.
 *
 * @example
 * ```jsonc
 * { "type": "emit", "event": "celebration:done", "payload": { "level": "$bigWinTier" } }
 * ```
 *
 * Variable interpolation works inside `payload` because the interpreter
 * resolves `"$name"` strings before the strategy sees the step.
 */
export class EmitStrategy implements IStepStrategy<EmitStep> {
    readonly type = 'emit';

    run(step: EmitStep, ctx: StepContext): Observable<void> {
        return defer(() => {
            const event = { ...(step.payload ?? {}), type: step.event };
            ctx.signals.emit(event);
            return of(undefined);
        });
    }
}
