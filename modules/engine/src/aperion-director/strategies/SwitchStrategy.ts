import { defer, type Observable, of } from 'rxjs';
import type { DirectorStep } from '../DirectorTypes.js';
import { compileExpression, ExpressionParseError, type LookupFn } from '../../expression/index.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';
import { logger } from '../host.js';

/**
 * Step shape for {@link SwitchStrategy}. Value-based dispatch — evaluate
 * `value` (a DSL expression), then strict-equality-compare against each
 * case's `when` literal. First match wins.
 *
 * Use this when you want to dispatch on the exact value of a variable —
 * `if/elseIf` chains work but get noisy with three or more branches.
 *
 * @example
 * ```jsonc
 * {
 *   "type": "switch",
 *   "value": "$gameMode",
 *   "cases": [
 *     { "when": "free-spin", "then": { "type": "composition", "name": "free-spin-flow" } },
 *     { "when": "bonus",     "then": { "type": "composition", "name": "bonus-flow" } },
 *     { "when": "jackpot",   "then": { "type": "composition", "name": "jackpot-flow" } }
 *   ],
 *   "default": { "type": "composition", "name": "regular-spin" }
 * }
 * ```
 */
export interface SwitchStep extends DirectorStep {
    type: 'switch';
    /** DSL expression — `value` is evaluated once and compared to each case. */
    value: string;
    /** Ordered list of cases; first match wins. */
    cases: Array<{ when: unknown; then: DirectorStep }>;
    /** Fallback step run when no case matches. */
    default?: DirectorStep;
}

/**
 * Value-based dispatch — the table-driven sibling of `if`. Identifier lookup
 * inside `value` follows the same rules as `if.when` (vars by default,
 * `#name` for event payload).
 */
export class SwitchStrategy implements IStepStrategy<SwitchStep> {
    readonly type = 'switch';
    readonly rawKeys = ['value'] as const;

    run(step: SwitchStep, ctx: StepContext): Observable<void> {
        return defer(() => {
            const lookup: LookupFn = (name, prefix) => {
                if (prefix === '#') {
                    return ctx.event ? (ctx.event as Record<string, unknown>)[name] : undefined;
                }
                return ctx.vars.get(name);
            };
            let value: unknown;
            try {
                value = compileExpression(step.value)(lookup);
            } catch (err) {
                if (err instanceof ExpressionParseError) {
                    logger.error(`[Director] switch.value failed to parse: ${err.message}`);
                }
                throw err;
            }
            for (const branch of step.cases) {
                if (branch.when === value) return ctx.compile(branch.then);
            }
            if (step.default) return ctx.compile(step.default);
            return of(undefined);
        });
    }
}
