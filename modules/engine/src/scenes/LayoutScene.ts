import { Container } from 'pixi.js';
import type { AppScreen, SceneInput } from './types.js';

/**
 * Thin {@link AppScreen} that mounts a pre-built layout container.
 *
 * Push it onto any scene layer and pass the container to host as `layout` in
 * the input bag — useful when the layout is built elsewhere (e.g. slot-ui's
 * `mount(app)`) and the scene only needs to display it:
 *
 * ```ts
 * app.scene.push('overlay', LayoutScene, { layout: myContainer });
 * app.scene.push('overlay', LayoutScene, { layout: [background, hud, popup] });
 * ```
 */
export class LayoutScene extends Container implements AppScreen {
  /** Mounts the container(s) supplied via `input.layout`. */
  prepare(input?: SceneInput): void {
    const layout = input?.layout;
    const containers = (Array.isArray(layout) ? layout : [layout]).filter(
      (c): c is Container => c instanceof Container,
    );
    this.addChild(...containers);
  }

  /** Removes all children, returning the scene to an empty state. */
  reset(): void {
    this.removeChildren();
  }
}
