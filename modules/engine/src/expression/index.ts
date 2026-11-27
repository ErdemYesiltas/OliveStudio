/**
 * Tiny JSON-friendly expression DSL used by:
 * - The `if` step strategy (`step.when` resolves against the run's `vars`).
 * - The trigger `whenExpr` field (resolves against the event payload).
 * - A `responsive` rule's `LengthExpr` (resolves against the viewport's metrics and its `vars`).
 *
 * It lived in `director/expression/` until 2026-10-08 and moved here when responsive became its
 * second user; `director` re-exports it unchanged.
 *
 * Same parser, different identifier lookup at call time. See `parse.ts` for
 * grammar and examples.
 */
export {
    parseExpression,
    compileExpression,
    clearExpressionCache,
    ExpressionParseError,
} from './parse.js';
export type { LookupFn, ExpressionEvaluator, IdentifierPrefix } from './parse.js';
