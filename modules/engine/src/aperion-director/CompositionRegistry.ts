import type { Composition } from './DirectorTypes.js';

/**
 * Named-composition lookup. The `DirectorPlugin` uses this to resolve
 * `play(name)` calls and to find compositions referenced by event bindings.
 */
export class CompositionRegistry {
    private readonly _byName = new Map<string, Composition>();

    /** Register or replace a composition. */
    register(composition: Composition): void {
        if (!composition.name) {
            throw new Error('[Director] composition.name is required');
        }
        this._byName.set(composition.name, composition);
    }

    /** Remove a composition. No-op when not present. */
    unregister(name: string): void {
        this._byName.delete(name);
    }

    /** Whether a composition is registered under `name`. */
    has(name: string): boolean {
        return this._byName.has(name);
    }

    /** Retrieve a composition by name. */
    get(name: string): Composition | undefined {
        return this._byName.get(name);
    }

    /** List every registered composition name. */
    list(): string[] {
        return Array.from(this._byName.keys());
    }

    /** Wipe the registry — used in test/HMR. */
    clear(): void {
        this._byName.clear();
    }
}
