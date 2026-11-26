import { tweenOnClock } from '../../clock-tween.js';
import { DEG_TO_RAD } from 'pixi.js';
import type { AppScreen, ScreenTransition } from '../types.js';

/** Options for {@link RotateTransition}. */
export interface RotateTransitionOptions {
    /** Tween duration in milliseconds. Default `300`. */
    ms?: number;
    /** GSAP ease. Default `'power2.out'`. */
    ease?: string;
    /** Rotation offset in **degrees** the screen spins through. Default `90` (a quarter turn). */
    angle?: number;
}

/**
 * Spins a screen in/out while fading. `enter` rotates from an offset to the
 * screen's home rotation; `exit` rotates back to the offset. Rotation is around
 * the screen's pivot — for a centered spin, give the screen a centered pivot; the
 * default pivot `(0,0)` spins around the top-left.
 */
export class RotateTransition implements ScreenTransition {
    private readonly _ms: number;
    private readonly _ease: string;
    private readonly _radians: number;

    constructor(options: RotateTransitionOptions = {}) {
        this._ms = options.ms ?? 300;
        this._ease = options.ease ?? 'power2.out';
        this._radians = (options.angle ?? 90) * DEG_TO_RAD;
    }

    public async enter(screen: AppScreen): Promise<void> {
        const dur = this._ms / 1000;
        const home = screen.rotation;
        screen.alpha = 0;
        screen.rotation = home + this._radians;
        await Promise.all([
            tweenOnClock(screen.game?.ticker, screen, { alpha: 1, duration: dur, ease: this._ease }, screen).done,
            tweenOnClock(screen.game?.ticker, screen, { rotation: home, duration: dur, ease: this._ease }, screen).done,
        ]);
    }

    public async exit(screen: AppScreen): Promise<void> {
        const dur = this._ms / 1000;
        const home = screen.rotation;
        await Promise.all([
            tweenOnClock(screen.game?.ticker, screen, { alpha: 0, duration: dur, ease: this._ease }, screen).done,
            tweenOnClock(screen.game?.ticker, screen, { rotation: home + this._radians, duration: dur, ease: this._ease }, screen).done,
        ]);
    }
}
