import { tweenOnClock } from '../../clock-tween.js';
import type { AppScreen, ScreenTransition } from '../types.js';

/** Options for {@link ZoomTransition}. */
export interface ZoomTransitionOptions {
    /** Tween duration in milliseconds. Default `300`. */
    ms?: number;
    /** GSAP ease. Default `'power2.out'`. */
    ease?: string;
    /** Start (enter) / end (exit) scale. Default `0`. */
    fromScale?: number;
}

/**
 * Scales a screen in/out while fading. `enter` grows from `fromScale` to `1`;
 * `exit` shrinks back to `fromScale`. Scaling happens around the screen's pivot —
 * for a centered zoom, give the screen a centered pivot; the default pivot
 * `(0,0)` zooms from the top-left.
 */
export class ZoomTransition implements ScreenTransition {
    private readonly _ms: number;
    private readonly _ease: string;
    private readonly _from: number;

    constructor(options: ZoomTransitionOptions = {}) {
        this._ms = options.ms ?? 300;
        this._ease = options.ease ?? 'power2.out';
        this._from = options.fromScale ?? 0;
    }

    public async enter(screen: AppScreen): Promise<void> {
        const dur = this._ms / 1000;
        screen.alpha = 0;
        screen.scale.set(this._from);
        await Promise.all([
            tweenOnClock(screen.game?.ticker, screen, { alpha: 1, duration: dur, ease: this._ease }, screen).done,
            tweenOnClock(screen.game?.ticker, screen.scale, { x: 1, y: 1, duration: dur, ease: this._ease }, screen).done,
        ]);
    }

    public async exit(screen: AppScreen): Promise<void> {
        const dur = this._ms / 1000;
        await Promise.all([
            tweenOnClock(screen.game?.ticker, screen, { alpha: 0, duration: dur, ease: this._ease }, screen).done,
            tweenOnClock(screen.game?.ticker, screen.scale, { x: this._from, y: this._from, duration: dur, ease: this._ease }, screen).done,
        ]);
    }
}
