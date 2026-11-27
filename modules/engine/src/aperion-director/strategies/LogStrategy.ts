import { defer, type Observable, of } from 'rxjs';
import type { DirectorStep } from '../DirectorTypes.js';
import type { IStepStrategy, StepContext } from './IStepStrategy.js';
import { logger } from '../host.js';

/** Step shape for {@link LogStrategy}. */
export interface LogStep extends DirectorStep {
    type: 'log';
    /** Message to print. Variable interpolation is handled by the interpreter, so `"$payout"` works. */
    message: unknown;
    /** Severity level passed to consola. */
    level?: 'debug' | 'info' | 'warn' | 'error';
    /** Optional list of variable names to snapshot alongside the message. */
    vars?: string[];
}

/**
 * Editor-friendly debug print. The interpreter resolves `"$name"`-shaped
 * fields in `message` and `vars` entries before this step runs, so anything
 * referenced in the composition is dumped with its current value.
 *
 * Levels: `info` (default), `warn`, `error` always print.
 *
 * @example
 * ```jsonc
 * { "type": "log", "message": "reached celebration", "vars": ["payout", "multiplier"] }
 * { "type": "log", "level": "warn", "message": "missing reel data" }
 * ```
 */
/** Unbound on purpose — every call site goes through `fn.call(logger, …)`. */
const LOG_FNS = {
    debug: logger.debug,
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
} as const;

export class LogStrategy implements IStepStrategy<LogStep> {
    readonly type = 'log';

    run(step: LogStep, ctx: StepContext): Observable<void> {
        return defer(() => {
            const level = step.level ?? 'info';
            const hasVars = !!(step.vars && step.vars.length);
            const snapshot: Record<string, unknown> = {};
            if (hasVars) {
                for (const name of step.vars!) snapshot[name] = ctx.vars.get(name);
            }

            const fn = LOG_FNS[level] ?? logger.info;

            if (hasVars) fn.call(logger, step.message, snapshot);
            else fn.call(logger, step.message);

            return of(undefined);
        });
    }
}
