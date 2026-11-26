// Scale calculations from Aperion Engine (aperion-libs 4286ae352183eb97fa7930b42b4594d370e90457).
import { responsiveLayout } from './AperionResponsive.js';
import type { AperionResponsiveOptions } from './ResizeTypes.js';
export const scaleModes = [
    'RESPONSIVE', 'NONE', 'WIDTH_CONTROLS_HEIGHT', 'HEIGHT_CONTROLS_WIDTH',
    'FIT', 'ENVELOP', 'RESIZE', 'EXPAND',
] as const;
export type ScaleMode = typeof scaleModes[number];

/** Output of {@link computeLayout}. `logicalW`/`logicalH` are the renderer's logical size. */
export interface LayoutResult {
    displayWidth: number;
    displayHeight: number;
    scaleX: number;
    scaleY: number;
    logicalWidth: number;
    logicalHeight: number;
}

/**
 * Compute display/render dimensions for the active scale mode.
 *
 * For `FIT`/`ENVELOP`/`NONE`/`WIDTH_CONTROLS_HEIGHT`/`HEIGHT_CONTROLS_WIDTH`/`RESIZE`
 * the renderer stays at the base size (`baseW × baseH`) and the canvas CSS size is
 * scaled. For `EXPAND` the renderer grows so that more world is visible at scale ≤ 1. For
 * `RESPONSIVE` the canvas is the letterboxed box and the renderer is the visible area inside it
 * (`AperionResponsive.ts`); `responsive` carries that mode's tuning and the screen's ratio.
 */
export function computeLayout(
    parentW: number,
    parentH: number,
    baseW: number,
    baseH: number,
    mode: ScaleMode,
    responsive?: { options?: AperionResponsiveOptions; screenRatio?: number },
): LayoutResult {
    const ratioW = parentW / baseW;
    const ratioH = parentH / baseH;

    let displayWidth = baseW;
    let displayHeight = baseH;
    let scaleX = 1;
    let scaleY = 1;
    let logicalWidth = baseW;
    let logicalHeight = baseH;

    switch (mode) {
        case 'RESPONSIVE': {
            const r = responsiveLayout(parentW, parentH, baseW, baseH, responsive?.options, responsive?.screenRatio);
            displayWidth = r.area.width;
            displayHeight = r.area.height;
            scaleX = scaleY = r.k;
            logicalWidth = r.logicalWidth;
            logicalHeight = r.logicalHeight;
            break;
        }
        case 'NONE': {
            // Keep base size; CSS = base; align centers it.
            break;
        }
        case 'FIT': {
            const r = Math.min(ratioW, ratioH);
            displayWidth = Math.floor(baseW * r);
            displayHeight = Math.floor(baseH * r);
            scaleX = scaleY = r;
            break;
        }
        case 'ENVELOP': {
            const r = Math.max(ratioW, ratioH);
            displayWidth = Math.floor(baseW * r);
            displayHeight = Math.floor(baseH * r);
            scaleX = scaleY = r;
            break;
        }
        case 'RESIZE': {
            // Renderer logical size matches parent; world units zoom with viewport.
            displayWidth = Math.floor(parentW);
            displayHeight = Math.floor(parentH);
            scaleX = ratioW;
            scaleY = ratioH;
            logicalWidth = displayWidth;
            logicalHeight = displayHeight;
            break;
        }
        case 'EXPAND': {
            // Scale clamps to 1.0 (no zoom-in); renderer grows so the base area is the
            // minimum guaranteed visible world. Bigger parents reveal more world.
            const r = Math.min(ratioW, ratioH, 1);
            scaleX = scaleY = r;
            displayWidth = Math.floor(parentW);
            displayHeight = Math.floor(parentH);
            logicalWidth = Math.floor(parentW / r);
            logicalHeight = Math.floor(parentH / r);
            break;
        }
        case 'WIDTH_CONTROLS_HEIGHT': {
            let r = ratioW;
            displayWidth = Math.floor(baseW * r);
            displayHeight = Math.floor(baseH * r);
            scaleX = scaleY = r;
            if (displayHeight > parentH) {
                const adjust = parentH / displayHeight;
                displayWidth = Math.floor(displayWidth * adjust);
                displayHeight = Math.floor(displayHeight * adjust);
                r *= adjust;
                scaleX = scaleY = r;
            }
            break;
        }
        case 'HEIGHT_CONTROLS_WIDTH': {
            let r = ratioH;
            displayWidth = Math.floor(baseW * r);
            displayHeight = Math.floor(baseH * r);
            scaleX = scaleY = r;
            if (displayWidth > parentW) {
                const adjust = parentW / displayWidth;
                displayWidth = Math.floor(displayWidth * adjust);
                displayHeight = Math.floor(displayHeight * adjust);
                r *= adjust;
                scaleX = scaleY = r;
            }
            break;
        }
    }

    return { displayWidth, displayHeight, scaleX, scaleY, logicalWidth, logicalHeight };
}
