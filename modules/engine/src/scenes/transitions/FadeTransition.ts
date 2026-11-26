import { tweenOnClock } from '../../clock-tween.js';
import type { AppScreen, ScreenTransition } from '../types.js';

/**
 * Crossfade transition driven by GSAP. The exit and enter halves are awaited
 * independently — pair with `Promise.all` in the scene manager for a true
 * crossfade, or run sequentially for a fade-out / fade-in.
 */
export class FadeTransition implements ScreenTransition {
    /**
     * @param _durationMs - Fade duration for each half (enter and exit), in milliseconds.
     */
    constructor(private readonly _durationMs: number = 300) {}

    /** Animate `screen.alpha` from `0` to `1` over the configured duration. */
    public async enter(screen: AppScreen): Promise<void> {
        screen.alpha = 0;
        await tweenOnClock(screen.game?.ticker, screen, { alpha: 1, duration: this._durationMs / 1000 }, screen).done;
    }

    /** Animate `screen.alpha` from its current value down to `0` over the configured duration. */
    public async exit(screen: AppScreen): Promise<void> {
        await tweenOnClock(screen.game?.ticker, screen, { alpha: 0, duration: this._durationMs / 1000 }, screen).done;
    }
}
