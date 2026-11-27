import { defer, type Observable, of } from 'rxjs';
import type { DirectorStep } from '../DirectorTypes.js';
import { compileExpression, ExpressionParseError, type LookupFn } from '../../expression/index.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';
import { logger } from '../host.js';

/**
 * Step shape for {@link IfStrategy}. Evaluates the DSL expression `when`
 * against the run's `vars` (and optionally the triggering event payload via
 * `#name` prefix); runs `then` on truthy. When `when` is falsy, tries each
 * `elseIf` branch in order; falls back to `else` if none match.
 *
 * The DSL is JSON-serializable so this step is editor-friendly. Identifier
 * lookup precedence:
 * - `$name` → run's `vars` map
 * - `#name` → triggering event payload (when the composition was fired by a
 *   trigger; `undefined` otherwise)
 * - bare `name` → run's `vars` map (default)
 *
 * @example
 * ```jsonc
 * {
 *   "type": "if",
 *   "when": "netGain >= betAmount AND won",
 *   "then":   { "type": "animation", "target": hero, "key": "spine:win-flash" },
 *   "elseIf": [
 *     { "when": "won",      "then": { "type": "animation", "target": hero, "key": "spine:small-win" } },
 *     { "when": "#multi > 1", "then": { "type": "animation", "target": hero, "key": "spine:multiplier" } }
 *   ],
 *   "else":   { "type": "audio", "play": { "layer": "sfx", "alias": "no-win" } }
 * }
 * ```
 */
export interface IfStep extends DirectorStep {
    type: 'if';
    /** Boolean expression. Identifiers resolve against `ctx.vars` / `ctx.event`. */
    when: string;
    /** Step to run when `when` evaluates to a truthy value. */
    then: DirectorStep;
    /** Optional ordered list of else-if branches. The first truthy `when` wins. */
    elseIf?: Array<{ when: string; then: DirectorStep }>;
    /** Optional step to run when no `when` branch matches. */
    else?: DirectorStep;
}

/**
 * Conditional control flow with if / else-if / else semantics.
 *
 * The first time a given `when` string is seen, it is parsed and cached
 * (see {@link compileExpression}); subsequent runs only pay an evaluation
 * cost. Parse errors surface synchronously from `run()` — the underlying
 * `defer` propagates the throw as an `error` notification, which the
 * surrounding sequence's RxJS pipeline treats as terminal.
 */
export class IfStrategy implements IStepStrategy<IfStep> {
    readonly type = 'if';
    // `elseIf` whole: its `when`s are expressions, and its `then`s are compiled (and resolved) when taken.
    readonly rawKeys = ['when', 'elseIf'] as const;

    run(step: IfStep, ctx: StepContext): Observable<void> {
        return defer(() => {
            const lookup: LookupFn = (name, prefix) => {
                if (prefix === '#') {
                    return ctx.event ? (ctx.event as Record<string, unknown>)[name] : undefined;
                }
                // `$` and bare both resolve against vars (step-context default is vars).
                return ctx.vars.get(name);
            };

            const evaluate = (whenStr: string): boolean => {
                try {
                    return Boolean(compileExpression(whenStr)(lookup));
                } catch (err) {
                    if (err instanceof ExpressionParseError) {
                        logger.error(`[Director] if.when failed to parse: ${err.message}`);
                    }
                    throw err;
                }
            };

            if (evaluate(step.when)) return ctx.compile(step.then);

            if (step.elseIf) {
                for (const branch of step.elseIf) {
                    if (evaluate(branch.when)) return ctx.compile(branch.then);
                }
            }

            if (step.else) return ctx.compile(step.else);
            return of(undefined);
        });
    }
}
