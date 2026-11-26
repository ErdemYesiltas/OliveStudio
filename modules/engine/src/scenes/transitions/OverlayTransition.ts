import { tweenOnClock } from '../../clock-tween.js';
import { Graphics } from 'pixi.js';
import type { AppScreen, ScreenTransition } from '../types.js';
import { resolveSize, type ViewportSource } from './viewport.js';

/** Options for {@link OverlayTransition}. */
export interface OverlayTransitionOptions {
    /** Fade duration of the curtain in milliseconds. Default `250`. */
    ms?: number;
    /** GSAP ease. Default `'power1.inOut'`. */
    ease?: string;
    /** Curtain color. Default `0x000000` (black). */
    color?: number;
    /**
     * Viewport size for the curtain rectangle, e.g. `() => app.screen`. Without it
     * the screen's own bounds are used (fragile for empty screens).
     */
    viewport?: ViewportSource;
}

/**
 * Reveals/hides a screen behind a solid color curtain. `enter` covers the screen
 * with a full-opacity curtain that fades out; `exit` fades a curtain in over the
 * screen. The curtain is a temporary {@link Graphics} child sized to the viewport;
 * `enter` removes it on completion, `exit` leaves it (the screen is destroyed by
 * the pop right after).
 */
export class OverlayTransition implements ScreenTransition {
    private readonly _ms: number;
    private readonly _ease: string;
    private readonly _color: number;
    private readonly _viewport?: ViewportSource;

    constructor(options: OverlayTransitionOptions = {}) {
        this._ms = options.ms ?? 250;
        this._ease = options.ease ?? 'power1.inOut';
        this._color = options.color ?? 0x000000;
        this._viewport = options.viewport;
    }

    public async enter(screen: AppScreen): Promise<void> {
        const curtain = this._curtain(screen);
        curtain.alpha = 1;
        screen.addChild(curtain);
        await tweenOnClock(screen.game?.ticker, curtain, { alpha: 0, duration: this._ms / 1000, ease: this._ease }, screen).done;
        if (!curtain.destroyed) curtain.destroy();
    }

    public async exit(screen: AppScreen): Promise<void> {
        const curtain = this._curtain(screen);
        curtain.alpha = 0;
        screen.addChild(curtain);
        await tweenOnClock(screen.game?.ticker, curtain, { alpha: 1, duration: this._ms / 1000, ease: this._ease }, screen).done;
    }

    private _curtain(screen: AppScreen): Graphics {
        const { width, height } = resolveSize(this._viewport, screen);
        return new Graphics().rect(0, 0, width, height).fill(this._color);
    }
}
