import { BlurFilter, type Filter } from 'pixi.js';
import { KawaseBlurFilter } from 'pixi-filters/kawase-blur';
import { MotionBlurFilter } from 'pixi-filters/motion-blur';
import type { CameraDepthBlur } from '../runtime-camera.js';

/** Amount ranges from zero at the foreground to one at maximum background blur. */
export function createDepthBlur(filter: CameraDepthBlur['filter'], amount: number): Filter | undefined {
  if (amount <= 0) return;
  switch (filter) {
    case 'none': return;
    case 'gaussian': return new BlurFilter({ strength: amount * 24, quality: 4 });
    case 'kawase': return new KawaseBlurFilter({ strength: amount * 16, quality: 3 });
    case 'motion': return new MotionBlurFilter({ velocity: { x: amount * 32, y: 0 }, kernelSize: 9 });
  }
}
