/** Display orientation reported by the resize plugin. */
export type Orientation = 'landscape' | 'portrait';

/**
 * The layout mode under `RESPONSIVE`, chosen by the window's `w / h` (see `AperionResponsive.ts`
 * for the thresholds). Landscape: `standard < 1.57 <= wide < 1.77 <= wideFull < 2.05 <= ultraWide`.
 * Portrait: `ultraTall <= 0.49 < tall < 0.59 <= regular < 0.74 <= square`. Reported under every
 * scale mode, so a rule can be keyed on it whatever the game runs.
 */
export type LayoutMode =
    | 'standard'
    | 'wide'
    | 'wideFull'
    | 'ultraWide'
    | 'ultraTall'
    | 'tall'
    | 'regular'
    | 'square';

/** Tuning for `RESPONSIVE`. Every field defaults to the studio value; a game leaves this out. */
export interface AperionResponsiveOptions {
    /** Landscape letterbox range, width / height. Default `[1444 / 999, 2.5073]`. */
    landscapeAspect?: readonly [number, number];
    /** Portrait letterbox range, **height / width**. Default `[2567 / 1777, 2.5]`. */
    portraitAspect?: readonly [number, number];
    /**
     * Band a window whose shape is outside the letterbox range (`landscapeAspect` / `portraitAspect`).
     * **Default `false`** — the studio's no-letterbox rule (decision D8, Aris, 2026-10-05; it was
     * `true`): the canvas covers the whole window at every ratio, ultra-wide included; the root's
     * scale is unchanged, so it simply shows more world where the bands were, and a cover-fitted
     * backdrop reaches every edge. `true` brings the bands back. A landscape box in an upright window
     * (a desktop turned portrait) keeps its bands either way.
     */
    letterbox?: boolean;
    /** Clamp on the screen's long / short ratio that sets the portrait root's height. Default `[2.0, 2.17]`. */
    portraitRootRatio?: readonly [number, number];
    /**
     * Re-check the window size every frame, before it is drawn, and lay out in that same frame.
     * Default `true`. Read under `RESPONSIVE` on every device and, since 2026-10-06, under every scale
     * mode on a phone or tablet, where the check also covers the fullscreen state and the parent's
     * box (`false` turns it off there too). A window `resize`, the parent's `ResizeObserver` and a fullscreen change
     * mark it due as well, so they lay out on the next frame; the debounced timer stays only as
     * the fallback for a ticker that is not running. This is what stops a frame being drawn at the
     * old size when a phone's browser bar or fullscreen changes the viewport.
     */
    watchViewport?: boolean;
}
