import type { FilterSystem, RenderSurface, Texture } from 'pixi.js';
import { TiltShiftFilter } from 'pixi-filters/tilt-shift';
import type { CameraOpticalEffect } from './postFXSettings.js';

export class CameraTiltShiftFilter extends TiltShiftFilter {
  private width = -1;
  private height = -1;

  constructor(private readonly settings: Extract<CameraOpticalEffect, { type: 'tiltShift' }>) {
    super({ blur: settings.blur, gradientBlur: settings.gradient });
    this.padding = Math.ceil(settings.blur);
  }

  override apply(manager: FilterSystem, input: Texture, output: RenderSurface, clear: boolean) {
    const { width, height } = input.frame;
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      const angle = this.settings.angle * Math.PI / 180;
      const x = width / 2, y = height * this.settings.focus / 100;
      const dx = Math.cos(angle) * width / 2, dy = Math.sin(angle) * width / 2;
      this.start = { x: x - dx, y: y - dy };
      this.end = { x: x + dx, y: y + dy };
    }
    super.apply(manager, input, output, clear);
  }
}
