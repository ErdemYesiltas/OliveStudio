import type { AppScreen, ScreenTransition } from '../types.js';

/**
 * No-op transition. Screen appears/disappears immediately at alpha 1.
 *
 * Default fallback used by {@link SceneManager} when no `defaultTransition`
 * is supplied. Useful as a baseline when push/pop should feel instantaneous.
 */
export class InstantTransition implements ScreenTransition {
    /** Set `screen.alpha = 1` and resolve synchronously on the next microtask. */
    public async enter(screen: AppScreen): Promise<void> {
        screen.alpha = 1;
    }

    /** Resolve immediately. No tweening is performed. */
    public async exit(_screen: AppScreen): Promise<void> {
        /* noop */
    }
}
