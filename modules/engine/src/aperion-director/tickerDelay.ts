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

/**
 * A repeating beat on the **game clock** — the interval counterpart of {@link tickerDelay$}.
 *
 * `interval()` schedules on `setInterval`, so it keeps firing behind `app.pause()` and ignores
 * `app.speed()`: a repeat driving a blink or a spawn would run on regardless of the picture it
 * is meant to accompany. This accumulates `Ticker.deltaMS`, so the beat stretches with slow
 * motion and holds with a pause, exactly like the tweens around it.
 *
 * Emits a 0-based index like `interval()`, the first one after `ms` of game time. Never
 * completes — take what you need (`take`, `takeUntil`) or unsubscribe.
 *
 * **Long frames drain rather than reset.** A frame that spans several periods emits once per
 * period crossed, in that frame, so the count stays true and the beat cannot drift slower than
 * asked. Pixi already clamps `deltaMS` by `ticker.minFPS`, so the burst is bounded. A consumer
 * that would rather skip than catch up should throttle downstream — a blink wants one emission,
 * a spawner wants all of them.
 *
 * `ms <= 0` degrades to one emission per frame, which is as fast as this clock goes; reach for
 * {@link tickerFrames$} directly when that is what you meant.
 *
 * @param ms - Period in milliseconds of game time.
 *
 * @example
 * ```ts
 * // Pulse an attract-mode highlight every 800 ms, paused with the game.
 * tickerInterval$(800, { ticker: app.ticker })
 *   .pipe(takeUntil(this.destroy$))
 *   .subscribe(() => this.pulse());
 * ```
 */
export function tickerInterval$(ms: number, options: TickerDelayOptions = {}): Observable<number> {
    const period = Math.max(0, ms);
    const ticker = options.ticker ?? Ticker.shared;
    const isPaused = options.isPaused;

    return new Observable<number>((subscriber) => {
        let elapsed = 0;
        let count = 0;
        const tick = (): void => {
            if (isPaused?.()) return;
            // A zero period has no boundary to cross, so draining it would spin forever.
            if (period === 0) {
                subscriber.next(count++);
                return;
            }
            elapsed += ticker.deltaMS;
            // `closed` is re-read each turn because a subscriber may unsubscribe from inside
            // its own handler, and the rest of the drain must not fire after that.
            while (elapsed >= period && !subscriber.closed) {
                elapsed -= period;
                subscriber.next(count++);
            }
        };
        ticker.add(tick);
        return () => { ticker.remove(tick); };
    });
}

/**
 * Every frame of the **game clock**, as an observable that never completes.
 *
 * The sampling counterpart of {@link tickerDelay$} and {@link tickerInterval$}, and measured the
 * same way: it emits from a
 * `Ticker` callback, so it stops with `app.pause()` and thins with `app.fps()` instead of
 * running on a wall-clock interval the picture has no relationship to. `interval()` would keep
 * firing behind a frozen frame and sample a value that cannot have changed.
 *
 * Emits `deltaMS` so a consumer that needs elapsed time does not have to reach for the ticker
 * itself. Nothing is emitted while `isPaused` returns `true`.
 *
 * Unsubscribing removes the listener. Removing a ticker listener from inside its own callback is
 * safe (Pixi captures the next node before the soft destroy), so a `take`/`takeUntil` downstream
 * tears down cleanly.
 *
 * @example
 * ```ts
 * // Which wedge is under the pointer, once per change rather than once per frame.
 * tickerFrames$({ ticker: app.ticker }).pipe(
 *   map(() => wheel.indexAtPointer()),
 *   distinctUntilChanged(),
 * );
 * ```
 */
export function tickerFrames$(options: TickerDelayOptions = {}): Observable<number> {
    const ticker = options.ticker ?? Ticker.shared;
    const isPaused = options.isPaused;

    return new Observable<number>((subscriber) => {
        const tick = (): void => {
            if (isPaused?.()) return;
            subscriber.next(ticker.deltaMS);
        };
        ticker.add(tick);
        return () => { ticker.remove(tick); };
    });
}
