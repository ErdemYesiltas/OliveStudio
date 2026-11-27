import { Graphics, type Container, type PointData } from 'pixi.js';
import type { CameraView } from '../runtime-camera.js';

export class CameraFrameClip {
  private readonly mask = new Graphics({ eventMode: 'none', visible: false });
  private frame?: NonNullable<CameraView['frame']>;

  constructor(parent: Container, private readonly target: Container) {
    parent.addChild(this.mask);
  }

  update(frame?: CameraView['frame']) {
    if (!frame) {
      if (!this.frame) return false;
      this.target.mask = null;
      this.mask.visible = false;
    } else {
      const previous = this.frame;
      if (previous?.x === frame.x && previous.y === frame.y && previous.width === frame.width && previous.height === frame.height) return false;
      this.mask.clear().rect(frame.x, frame.y, frame.width, frame.height).fill(0xffffff);
      this.mask.visible = true;
      if (!previous) this.target.mask = this.mask;
    }
    this.frame = frame;
    return true;
  }

  contains(point: PointData) {
    const frame = this.frame;
    if (!frame) return true;
    const { x, y } = this.mask.toLocal(point);
    return x >= frame.x && x < frame.x + frame.width && y >= frame.y && y < frame.y + frame.height;
  }
}
