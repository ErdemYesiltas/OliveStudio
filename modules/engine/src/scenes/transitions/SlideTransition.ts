import { tweenOnClock } from '../../clock-tween.js';
import type { AppScreen, ScreenTransition } from '../types.js';
import { resolveSize, type ViewportSource } from './viewport.js';

/** Edge a {@link SlideTransition} screen slides in from (and back out to). */
export type SlideDirection = 'left' | 'right' | 'up' | 'down';

/** Options for {@link SlideTransition}. */
export interface SlideTransitionOptions {
    /**
     * Edge the screen slides in from on `enter` — and back out to on `exit`.
     * `'left'`/`'right'` move along x, `'up'`/`'down'` along y. Default `'right'`.
     */
    direction?: SlideDirection;
    /** Tween duration in milliseconds. Default `300`. */
    ms?: number;
    /** GSAP ease. Default `'power2.out'`. */
    ease?: string;
    /** Explicit travel distance in pixels. Overrides `viewport`/bounds measurement. */
    distance?: number;
    /**
     * Viewport size used as the travel distance when `distance` is omitted, e.g.
     * `() => app.screen`. Without it the screen's own bounds are used (fragile for
     * empty screens).
     */
    viewport?: ViewportSource;
}

/** Maps a direction to the axis it animates and the sign of the off-screen offset. */
const AXIS: Record<SlideDirection, { axis: 'x' | 'y'; sign: 1 | -1 }> = {
    left: { axis: 'x', sign: -1 },
    right: { axis: 'x', sign: 1 },
    up: { axis: 'y', sign: -1 },
    down: { axis: 'y', sign: 1 },
};

/**
 * Slides a screen on/off along one of four directions. `enter` starts the screen
 * one viewport off the chosen edge and tweens it to its home position; `exit`
 * reverses it back off the same edge — so a push slides in and the matching pop
 * slides back out. Animates only `x`/`y`, relative to the screen's home position
 * (no assumption that home is `0,0`).
 *
 * @example
 * app.scene.push('main', GameScreen, undefined,
 *   new SlideTransition({ direction: 'right', ms: 400, viewport: () => app.screen }));
 */
export class SlideTransition implements ScreenTransition {
    private readonly _dir: SlideDirection;
    private readonly _ms: number;
    private readonly _ease: string;
    private readonly _distance?: number;
    private readonly _viewport?: ViewportSource;

    constructor(options: SlideTransitionOptions = {}) {
        this._dir = options.direction ?? 'right';
        this._ms = options.ms ?? 300;
        this._ease = options.ease ?? 'power2.out';
        this._distance = options.distance;
        this._viewport = options.viewport;
    }

    public async enter(screen: AppScreen): Promise<void> {
        const { axis, sign } = AXIS[this._dir];
        const home = screen[axis];
        screen[axis] = home + sign * this._dist(screen, axis);
        await tweenOnClock(screen.game?.ticker, screen, { [axis]: home, duration: this._ms / 1000, ease: this._ease }, screen).done;
    }

    public async exit(screen: AppScreen): Promise<void> {
        const { axis, sign } = AXIS[this._dir];
        const home = screen[axis];
        await tweenOnClock(screen.game?.ticker, screen, { [axis]: home + sign * this._dist(screen, axis), duration: this._ms / 1000, ease: this._ease }, screen).done;
    }

    private _dist(screen: AppScreen, axis: 'x' | 'y'): number {
        if (this._distance !== undefined) return this._distance;
        const size = resolveSize(this._viewport, screen);
        return axis === 'x' ? size.width : size.height;
    }
}
