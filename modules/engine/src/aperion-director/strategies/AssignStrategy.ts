import { defer, type Observable, of } from 'rxjs';
import { compileExpression } from '../../expression/index.js';
import type { DirectorStep } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';

/** Step shape for {@link AssignStrategy}. */
export interface AssignStep extends DirectorStep {
    type: 'assign';
    /** Variable name (no `$` prefix — that's a DSL thing). */
    name: string;
    /**
     * Value to write into `vars[name]`. A plain value is stored as-is (variable
     * `$`-interpolation is already resolved by the runner, so `value: "$other"`
     * copies `vars.other`). A string wrapped in `{{ … }}` is evaluated as a DSL
     * **expression** against the current `vars`, so it can compute — e.g.
     * `"{{ roll * bet }}"` or `"{{ base + bonus }}"`.
     */
    value: unknown;
}

const EXPR_RE = /^\{\{([\s\S]+)\}\}$/;

/**
 * Set a variable in the run's `vars` map.
 *
 * ## What a later step can and cannot see
 *
 * Visible to every subsequent **DSL expression** — an `if`'s `when`, a `switch`, another
 * `assign`'s `{{ … }}` — because those compile their string against `ctx.vars` when they run.
 *
 * **Not visible to a later step's `"$name"` field.** `$`-interpolation is applied by the runner in
 * `compile(step)`, and a `sequence` compiles all of its children up front (`children.map(compile)`
 * before the `concat`), so `{ "type": "delay", "ms": "$holdMs" }` two steps below an `assign` is
 * resolved before the `assign` has run — the ref stays a literal string and the step gets it raw.
 * Measured on a game: a 40 s ceremony ran in 3.4 s with no warning.
 *
 * So compute *into a branch*, not into a field: put the value-bearing step inside the `if` that
 * chose it. A field that must vary continuously is a job for the host, not for a composition.
 *
 * @example
 * ```jsonc
 * // Literal:
 * { "type": "assign", "name": "hotStreak", "value": true }
 *
 * // Copy a var via $-interpolation:
 * { "type": "assign", "name": "lastPayout", "value": "$payout" }
 *
 * // Compute with the arithmetic DSL:
 * { "type": "assign", "name": "win", "value": "{{ roll * bet }}" }
 * ```
 */
export class AssignStrategy implements IStepStrategy<AssignStep> {
    readonly type = 'assign';

    run(step: AssignStep, ctx: StepContext): Observable<void> {
        return defer(() => {
            ctx.setVar(step.name, resolveValue(step.value, ctx));
            return of(undefined);
        });
    }
}

/** A `{{ … }}` string is a DSL expression evaluated against `vars`; anything else is literal. */
function resolveValue(value: unknown, ctx: StepContext): unknown {
    if (typeof value === 'string') {
        const match = value.trim().match(EXPR_RE);
        if (match) return compileExpression(match[1].trim())((name) => ctx.vars.get(name));
    }
    return value;
}
