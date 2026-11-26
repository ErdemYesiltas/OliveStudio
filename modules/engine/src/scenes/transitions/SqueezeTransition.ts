import { tweenOnClock } from '../../clock-tween.js';
import type { AppScreen, ScreenTransition } from '../types.js';

/** Options for {@link SqueezeTransition}. */
export interface SqueezeTransitionOptions {
    /**
     * Axis that scales. `'x'` collapses the screen to a vertical line, `'y'` to a
     * horizontal line (a TV-power-off look). Default `'x'`.
     */
    axis?: 'x' | 'y';
    /** Tween duration in milliseconds. Default `300`. */
    ms?: number;
    /** GSAP ease. Default `'power2.out'`. */
    ease?: string;
    /** Collapsed scale on the squeeze axis (enter start / exit end). Default `0`. */
    fromScale?: number;
}

/**
 * Squeezes a screen along a single axis. `enter` expands from `fromScale` to the
 * screen's home scale on that axis; `exit` collapses back to `fromScale`. The
 * other axis is left untouched, so the screen flattens to a line and pops back.
 * Scaling is around the screen's pivot — give the screen a centered pivot to
 * squeeze toward its center; the default pivot `(0,0)` squeezes toward the edge.
 */
export class SqueezeTransition implements ScreenTransition {
    private readonly _axis: 'x' | 'y';
    private readonly _ms: number;
    private readonly _ease: string;
    private readonly _from: number;

    constructor(options: SqueezeTransitionOptions = {}) {
        this._axis = options.axis ?? 'x';
        this._ms = options.ms ?? 300;
        this._ease = options.ease ?? 'power2.out';
        this._from = options.fromScale ?? 0;
    }

    public async enter(screen: AppScreen): Promise<void> {
        const home = screen.scale[this._axis];
        screen.scale[this._axis] = this._from;
        await tweenOnClock(screen.game?.ticker, screen.scale, { [this._axis]: home, duration: this._ms / 1000, ease: this._ease }, screen).done;
    }

    public async exit(screen: AppScreen): Promise<void> {
        await tweenOnClock(screen.game?.ticker, screen.scale, { [this._axis]: this._from, duration: this._ms / 1000, ease: this._ease }, screen).done;
    }
}
