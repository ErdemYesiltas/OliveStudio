import type { Container } from 'pixi.js';
import type { CameraView } from '../runtime-camera.js';
import { cameraEaseProgress } from './easing.js';
import type { CameraMotionData } from './postFXSettings.js';

type Size = { width: number; height: number };
export interface CameraSubject {
  x: number;
  y: number;
  bounds?: Size & { x: number; y: number };
}
export type CameraSubjectLookup = (id: string, measureBounds: boolean) => CameraSubject | undefined;

export function cameraSubjectFromDisplay(display: Container, world: Container, measureBounds: boolean): CameraSubject {
  const center = world.toLocal(display.pivot, display);
  if (!measureBounds) return center;
  const { minX, minY, maxX, maxY } = display.getLocalBounds();
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return center;
  const corners = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: minX, y: maxY }, { x: maxX, y: maxY }]
    .map(point => world.toLocal(point, display));
  const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x: center.x, y: center.y, bounds: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y } };
}

export function applyCameraMotion(view: CameraView, from: CameraView, effect: CameraMotionData, elapsed: number,
  stage: Size, subject?: CameraSubjectLookup): CameraView {
  const amount = cameraEaseProgress(effect.ease, effect.duration ? elapsed / effect.duration : 1);
  const blend = (a: number, b: number) => a + (b - a) * amount;
  if (effect.type === 'rotate') return { ...view, rotation: blend(from.rotation, effect.angle) };
  if (effect.type === 'move') return { ...view, x: blend(from.x, effect.x), y: blend(from.y, effect.y) };
  const target = effect.target && subject?.(effect.target, effect.type === 'focus');
  if (!target) return view;
  if (effect.type === 'follow') return { ...view,
    x: blend(from.x, target.x + effect.offsetX), y: blend(from.y, target.y + effect.offsetY) };
  const bounds = target.bounds;
  if (!bounds) return { ...view, x: blend(from.x, target.x), y: blend(from.y, target.y) };
  const radians = view.rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians));
  const width = bounds.width * cos + bounds.height * sin;
  const height = bounds.width * sin + bounds.height * cos;
  const fit = Math.min(Math.max(1, stage.width - effect.padding * 2) / width,
    Math.max(1, stage.height - effect.padding * 2) / height);
  return { ...view, x: blend(from.x, bounds.x + bounds.width / 2), y: blend(from.y, bounds.y + bounds.height / 2),
    zoom: Number.isFinite(fit) ? blend(from.zoom, fit) : view.zoom };
}
