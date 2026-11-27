import { Observable, filter, map, of, take } from 'rxjs';
import type { DirectorStep } from '../DirectorTypes.js';
import { compileExpression, type LookupFn } from '../../expression/index.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';
import { logger } from '../host.js';
import { tickerInterval$ } from '../tickerDelay.js';

/**
 * Step shape for {@link WaitForStrategy}. Two mutually-exclusive forms:
 *
 * - `event` form — subscribe to `app.events` and complete on the first
 *   matching event. Optional `whenExpr` filters using the same DSL the
 *   trigger system uses (identifiers resolve against the event payload).
 * - `condition` form — poll a DSL predicate every `pollMs` (default 100ms)
 *   and complete when it becomes truthy. The predicate is also evaluated
 *   immediately on entry; if already truthy, the step completes synchronously.
 *
 * @example
 * ```jsonc
 * // Wait for the server to confirm a payout:
 * { "type": "waitFor", "event": "server:payout-confirmed" }
 *
 * // Wait until a flag in vars flips:
 * { "type": "waitFor", "condition": "$ready" }
 *
 * // Event with predicate:
 * { "type": "waitFor", "event": "reel:stopped", "whenExpr": "#index == 4" }
 * ```
 */
export interface WaitForStep extends DirectorStep {
    type: 'waitFor';
    /** Event form — listens on `app.events` for this event type. */
    event?: string;
    /** Optional filter for the event form (DSL, lookup against event payload). */
    whenExpr?: string;
    /** Condition form — DSL predicate polled until truthy. */
    condition?: string;
    /** Polling interval for the condition form (ms). Defaults to `100`. */
    pollMs?: number;
}

/**
 * Synchronization barrier — pauses the surrounding sequence until an event
 * arrives or a condition becomes true. Use this when a step depends on
 * external state (server response, user input, game-flow flag).
 */
export class WaitForStrategy implements IStepStrategy<WaitForStep> {
    readonly type = 'waitFor';
    readonly rawKeys = ['condition', 'whenExpr'] as const;

    run(step: WaitForStep, ctx: StepContext): Observable<void> {
        if (step.event) {
            return this._waitForEvent(step, ctx);
        }
        if (step.condition) {
            return this._waitForCondition(step, ctx);
        }
        logger.warn('[Director] waitFor requires either `event` or `condition` — skipping');
        return of(undefined);
    }

    private _waitForEvent(step: WaitForStep, ctx: StepContext): Observable<void> {
        const eventType = step.event!;
        const exprEvaluator = step.whenExpr ? compileExpression(step.whenExpr) : null;
        return new Observable<void>((sub) => {
            const subscription = ctx.signals.on(eventType, (event: unknown) => {
                if (exprEvaluator) {
                    const payload = event as Record<string, unknown>;
                    const lookup: LookupFn = (name, prefix) => {
                        if (prefix === '$') return ctx.vars.get(name);
                        return payload[name];
                    };
                    if (!exprEvaluator(lookup)) return;
                }
                sub.next();
                sub.complete();
                subscription.unsubscribe();
            });
            return () => subscription.unsubscribe();
        });
    }

    private _waitForCondition(step: WaitForStep, ctx: StepContext): Observable<void> {
        const evaluator = compileExpression(step.condition!);
        const lookup: LookupFn = (name, prefix) => {
            if (prefix === '#') {
                return ctx.event ? (ctx.event as Record<string, unknown>)[name] : undefined;
            }
            return ctx.vars.get(name);
        };
        const check = () => Boolean(evaluator(lookup));
        if (check()) return of(undefined);
        const pollMs = Math.max(16, step.pollMs ?? 100);
        return tickerInterval$(pollMs, { ticker: ctx.ticker, isPaused: ctx.isPaused }).pipe(
            filter(() => check()),
            take(1),
            map(() => undefined),
        );
    }
}
