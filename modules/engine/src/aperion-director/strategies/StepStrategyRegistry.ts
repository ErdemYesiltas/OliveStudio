import type { IStepStrategy } from './IStepStrategy.js';

/**
 * Dispatch table keyed by canonical type + aliases — director-side parallel
 * of `factory/strategies/StrategyRegistry`. Distinct name avoids collision at
 * the engine's top-level barrel.
 *
 * The {@link DirectorPlugin} runner looks up each step's `type` here at run
 * time. Strategies can be registered, replaced, or removed at any point —
 * compositions registered against an outdated strategy will dispatch to the
 * replacement on the next run.
 */
export class StepStrategyRegistry {
    private readonly _byType = new Map<string, IStepStrategy>();

    /** Register (or replace) a strategy under its canonical type and any aliases. */
    register(strategy: IStepStrategy): void {
        this._byType.set(strategy.type, strategy);
        strategy.aliases?.forEach((alias) => {
            this._byType.set(alias, strategy);
        });
    }

    /** Remove a strategy (along with its aliases) by canonical type. */
    unregister(type: string): void {
        const strategy = this._byType.get(type);
        if (!strategy) return;
        this._byType.delete(strategy.type);
        strategy.aliases?.forEach((alias) => this._byType.delete(alias));
    }

    /** Lookup a strategy by canonical type or alias. */
    get(type: string): IStepStrategy | undefined {
        return this._byType.get(type);
    }

    /** Does this type or alias resolve to a registered strategy? */
    has(type: string): boolean {
        return this._byType.has(type);
    }

    /** Distinct registered strategies (each appears once regardless of aliases). */
    list(): IStepStrategy[] {
        return Array.from(new Set(this._byType.values()));
    }

    /** Wipe the registry — used in test/HMR scenarios. */
    clear(): void {
        this._byType.clear();
    }
}
