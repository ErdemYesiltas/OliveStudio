import { Ticker } from 'pixi.js';
import { Observable } from 'rxjs';

/** Options for {@link tickerDelay$}, {@link tickerInterval$} and {@link tickerFrames$}. */
export interface TickerDelayOptions {
    /**
     * Clock to measure against. Defaults to `Ticker.shared`, which `boot()`
     * pins `app.ticker` to — pass `ctx.app.ticker` explicitly when you have it.
     */
    ticker?: Ticker;
    /**
     * Polled every tick. While it returns `true` the elapsed time does not
     * accumulate, so the wait holds where it is instead of expiring behind a
     * paused presentation. Use it for a *scoped* pause (one composition);
     * a global `app.pause()` already stops the ticker outright.
     */
    isPaused?: () => boolean;
}

/**
 * A delay measured on the **game clock** rather than the wall clock.
 *
 * RxJS's `timer()` schedules on `setInterval`, so it keeps counting through
 * `app.pause()` and ignores `app.speed()` / `app.fps()`. That desynchronises a
 * wait from the animations around it: slow-motion stretches the tweens but not
 * the gaps between them, and a pause lets a sequence advance behind a frozen
 * picture. This accumulates `Ticker.deltaMS` instead — which Pixi already scales
 * by `ticker.speed` and stops emitting once the ticker is stopped — so a wait
 * inherits every clock control for free.
 *
 * Emits once and completes when `ms` of ticker time has passed. Unsubscribing
 * removes the listener and emits nothing. Removing a ticker listener from inside
 * its own callback is safe (Pixi captures the next node before the soft destroy),
 * so completion tears down cleanly.
 *
 * A wait started while the app is paused simply stays pending: `CorePlugin.pause()`
 * clears `ticker.autoStart` for the duration, so subscribing here cannot resurrect a
 * stopped clock via Pixi's `_startIfPossible()`.
 *
 * @param ms - Duration in milliseconds of game time. `<= 0` completes on the next tick.
 */
export function tickerDelay$(ms: number, options: TickerDelayOptions = {}): Observable<void> {
    const target = Math.max(0, ms);
    const ticker = options.ticker ?? Ticker.shared;
    const isPaused = options.isPaused;

    return new Observable<void>((subscriber) => {
        let elapsed = 0;
        const tick = (): void => {
            if (isPaused?.()) return;
            elapsed += ticker.deltaMS;
            if (elapsed < target) return;
            subscriber.next();
            subscriber.complete();
        };
        ticker.add(tick);
        return () => { ticker.remove(tick); };
    });
}
