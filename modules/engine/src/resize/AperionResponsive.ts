import type { AperionResponsiveOptions, LayoutMode, Orientation } from './ResizeTypes.js';

/**
 * **Aperion Responsive** — the studio layout (2026-09-30), the `'RESPONSIVE'` scale mode.
 *
 * Settled on Doctor Magnetstein and measured there on 14 desktop, 9 phone and 6 tablet sizes. **The
 * studio default for every new game** (decision D8, Aris, 2026-10-05; it was opt-in from 2026-10-02
 * because it banded): a game sets `scaleMode: 'RESPONSIVE'` (the engine's own default stays
 * 1280x720 `FIT`). Four ideas, each a number below:
 *
 * 1. **A shape range, with no bands by default.** The root's scale is set by the range below; with
 *    `responsive.letterbox` at its default `false` (D8, 2026-10-05) the canvas covers the window at
 *    every ratio, ultra-wide included, and shows more world where bands would be. `letterbox: true`
 *    brings the bands back: outside the range the canvas is the largest centred box inside it, and
 *    the rest is the page's own background.
 * 2. **A root.** Inside that box one rectangle is always fully visible — `1561 x 1080` design pixels
 *    in landscape (the narrowest landscape box), `1080` wide in portrait — and it is fitted
 *    uniformly. The design box (1920x1080 / 1080x2160) is wider than the root, so what shows
 *    beyond the root depends on the window; placement reads the visible area, never the design box.
 * 3. **Eight layout modes** by the window's ratio, with a fallback chain, so a node can be placed
 *    per mode and only the modes that differ need saying.
 * 4. **Desktop is always landscape.** A desktop window turned portrait runs the landscape game,
 *    letterboxed.
 *
 * Pure: no DOM access here. `ResizeService` and `enginePreset` both call {@link responsiveLayout}
 * with the same inputs, so the resolution the preset picks is computed against the same box the
 * service lays out.
 */

/**
 * The landscape letterbox, as width / height. `1444 / 999` (≈ 1.4454) is the narrowest landscape
 * box and so also the root's aspect; `2.5073` the widest before side bands open.
 */
export const LANDSCAPE_ASPECT: readonly [number, number] = [1444 / 999, 2.5073];

/** The portrait letterbox, as **height / width**. Below `2567 / 1777` (≈ 1.4446) side bands open. */
export const PORTRAIT_ASPECT: readonly [number, number] = [2567 / 1777, 2.5];

/**
 * The portrait root's height over its width is the **screen's** long side over its short one,
 * clamped here. The screen, not the window: browser bars, fullscreen and rotation change the window
 * and must not change the layout (on an iPhone the address bar alone moved every portrait element).
 * `ResizeService` reads the screen once, at boot, so the root also holds where a browser reports a
 * new screen with the window (device emulation shrank the board 7% after a fullscreen round trip).
 */
export const PORTRAIT_ROOT_RATIO: readonly [number, number] = [2.0, 2.17];

/** Landscape mode thresholds on the window's `w / h`. */
export const LANDSCAPE_MODE_RATIOS = { wide: 1.57, wideFull: 1.77, ultraWide: 2.05 } as const;

/** Portrait mode thresholds on the window's `w / h`. `ultraTall` is `<=`, the others `<`. */
export const PORTRAIT_MODE_RATIOS = { ultraTall: 0.49, regular: 0.59, square: 0.74 } as const;

/**
 * Where a mode's rules come from when a node says nothing for that mode: the next mode down the
 * chain, until one does. `standard` and `tall` are the two roots.
 */
export const LAYOUT_MODE_FALLBACK: Readonly<Record<LayoutMode, LayoutMode | null>> = {
    standard: null,
    wide: 'standard',
    wideFull: 'wide',
    ultraWide: 'wideFull',
    tall: null,
    ultraTall: 'tall',
    regular: 'tall',
    square: 'regular',
};

/** A rectangle in CSS pixels, relative to the parent. */
export interface ResponsiveArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Output of {@link responsiveLayout}. */
export interface ResponsiveLayout {
    /** The letterboxed box the canvas covers, CSS px, relative to the parent. */
    area: ResponsiveArea;
    /** Root size, design px. */
    rootWidth: number;
    rootHeight: number;
    /** CSS px per design px. */
    k: number;
    /** The renderer's logical size: the visible area, design px. */
    logicalWidth: number;
    logicalHeight: number;
}

/**
 * The layout mode for a window of `w x h` CSS px. Portrait modes are read only when the layout is
 * portrait, so a desktop window turned upright stays in the landscape family.
 */
export function selectLayoutMode(w: number, h: number, orientation: Orientation): LayoutMode {
    const r = w / Math.max(1, h);
    if (orientation === 'landscape') {
        if (r < LANDSCAPE_MODE_RATIOS.wide) return 'standard';
        if (r < LANDSCAPE_MODE_RATIOS.wideFull) return 'wide';
        if (r < LANDSCAPE_MODE_RATIOS.ultraWide) return 'wideFull';
        return 'ultraWide';
    }
    if (r <= PORTRAIT_MODE_RATIOS.ultraTall) return 'ultraTall';
    if (r < PORTRAIT_MODE_RATIOS.regular) return 'tall';
    if (r < PORTRAIT_MODE_RATIOS.square) return 'regular';
    return 'square';
}

/**
 * The value `table` holds for `mode`, or for the nearest mode down {@link LAYOUT_MODE_FALLBACK}
 * that has one. `undefined` when the whole chain is empty.
 */
export function resolveLayoutMode<T>(table: Partial<Record<LayoutMode, T>>, mode: LayoutMode): T | undefined {
    let at: LayoutMode | null = mode;
    while (at) {
        const value = table[at];
        if (value !== undefined) return value;
        at = LAYOUT_MODE_FALLBACK[at];
    }
    return undefined;
}

/**
 * The centred box inside `parentW x parentH` whose shape is within the letterbox range. The range
 * is chosen by the **design box's** orientation, not the window's: a landscape box in an upright
 * window (a desktop turned portrait) takes the landscape range and letterboxes top and bottom.
 *
 * With `options.letterbox` false — the default (D8, 2026-10-05) — the box is the whole window
 * whenever the window has the design box's shape. `k` is the same either way — the root is fitted against the window's limiting axis,
 * and the range's narrow ends are the root's own aspect — so the bands become more visible world at
 * the same scale instead of black.
 */
export function letterboxArea(
    parentW: number,
    parentH: number,
    portraitBox: boolean,
    options?: AperionResponsiveOptions,
): ResponsiveArea {
    let width = parentW;
    let height = parentH;
    // Without the letterbox a window of the box's own shape is covered whatever its ratio; only a
    // landscape box in an upright window (a desktop turned portrait) keeps its bands.
    const boxShapedWindow = portraitBox === (parentH > parentW);
    const banded = options?.letterbox === true || !boxShapedWindow;
    if (banded && parentW > 0 && parentH > 0) {
        if (portraitBox) {
            const [min, max] = options?.portraitAspect ?? PORTRAIT_ASPECT;
            const aspect = parentH / parentW;
            if (aspect < min) width = parentH / min;
            else if (aspect > max) height = parentW * max;
        } else {
            const [min, max] = options?.landscapeAspect ?? LANDSCAPE_ASPECT;
            const aspect = parentW / parentH;
            if (aspect < min) height = parentW / min;
            else if (aspect > max) width = parentH * max;
        }
    }
    // The box's size stays in fractional CSS px, as the visible viewport reports it (a Pixel 9 on its
    // side: 368.8 px tall). Rounded to whole px, the canvas reached 0.2 px past the visible area, and
    // the safe area came out a fraction of a unit short of the root (1079.4 of 1080) — the HUD then
    // fitted itself to the artboard, not its band, on those frames (2026-10-14).
    return { x: Math.round((parentW - width) / 2), y: Math.round((parentH - height) / 2), width, height };
}

/**
 * The whole layout for one window: letterbox, root, uniform fit, visible area.
 *
 * @param baseW  - Design box width (1920 landscape, 1080 portrait).
 * @param baseH  - Design box height.
 * @param screenRatio - The screen's long side over its short side; only the portrait root reads it.
 *                      Defaults to the parent's own ratio.
 */
export function responsiveLayout(
    parentW: number,
    parentH: number,
    baseW: number,
    baseH: number,
    options?: AperionResponsiveOptions,
    screenRatio?: number,
): ResponsiveLayout {
    const portraitBox = baseH > baseW;
    const area = letterboxArea(parentW, parentH, portraitBox, options);

    let rootWidth: number;
    let rootHeight: number;
    if (portraitBox) {
        const [min, max] = options?.portraitRootRatio ?? PORTRAIT_ROOT_RATIO;
        const ratio = screenRatio && screenRatio > 0 ? screenRatio : Math.max(parentW, parentH) / Math.max(1, Math.min(parentW, parentH));
        rootWidth = baseW;
        rootHeight = Math.round(baseW * Math.min(max, Math.max(min, ratio)));
    } else {
        rootWidth = baseH * (options?.landscapeAspect ?? LANDSCAPE_ASPECT)[0];
        rootHeight = baseH;
    }

    const areaRatio = area.width / Math.max(1, area.height);
    const k = areaRatio >= rootWidth / rootHeight ? area.height / rootHeight : area.width / rootWidth;

    return {
        area,
        rootWidth,
        rootHeight,
        k,
        logicalWidth: Math.round(area.width / k),
        logicalHeight: Math.round(area.height / k),
    };
}
