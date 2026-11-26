import type { Size } from 'pixi.js';
import type { AppScreen } from '../types.js';

/**
 * A viewport size for distance/curtain math: a fixed {@link Size} or a getter
 * (e.g. `() => app.screen`). Transitions only receive the screen, so the host
 * supplies the viewport this way when the travel distance must match the canvas.
 */
export type ViewportSource = Size | (() => Size);

/**
 * Resolve the size a transition should use. Priority: the supplied
 * {@link ViewportSource}, otherwise the screen's own measured bounds (fragile
 * for empty screens — prefer passing `viewport: () => app.screen`).
 */
export function resolveSize(viewport: ViewportSource | undefined, screen: AppScreen): Size {
    if (viewport) return typeof viewport === 'function' ? viewport() : viewport;
    return { width: screen.width || 0, height: screen.height || 0 };
}
