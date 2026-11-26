import { z } from 'zod';
import type { ScreenTransition } from './types.js';
import { InstantTransition } from './transitions/InstantTransition.js';
import { FadeTransition } from './transitions/FadeTransition.js';
import { SlideTransition } from './transitions/SlideTransition.js';
import { ZoomTransition } from './transitions/ZoomTransition.js';
import { RotateTransition } from './transitions/RotateTransition.js';
import { OverlayTransition } from './transitions/OverlayTransition.js';
import { SqueezeTransition } from './transitions/SqueezeTransition.js';
import type { Size } from 'pixi.js';

export const sceneLinkModes = ['replace', 'push', 'add', 'remove'] as const;
export const sceneTransitionKinds = ['instant', 'fade', 'slide', 'zoom', 'rotate', 'overlay', 'squeeze'] as const;
export const sceneTransitionSchema = z.strictObject({
  kind: z.enum(sceneTransitionKinds),
  ms: z.number().int().min(0).max(10000).default(300),
});
export const sceneLinkSchema = z.strictObject({
  target: z.string().min(1),
  mode: z.enum(sceneLinkModes),
  transition: sceneTransitionSchema.optional(),
  backTransition: sceneTransitionSchema.optional(),
});
export type SceneLink = z.output<typeof sceneLinkSchema>;
export type SceneTransition = z.output<typeof sceneTransitionSchema>;
type SceneFrame = { main: string; added: string[] };
export type ScenePlayback = SceneFrame & {
  stack?: (SceneFrame & { backTransition?: SceneTransition })[];
  transition?: SceneTransition;
  transitionLayer?: { id: string; exit: boolean };
};

export function followSceneLink(playback: ScenePlayback, link: SceneLink): ScenePlayback {
  const { target, mode, transition } = link;
  if (mode === 'replace') {
    if (target === playback.main && !playback.added.length && !playback.stack?.length) return playback;
    return { main: target, added: [], transition };
  }
  if (mode === 'push') {
    if (target === playback.main) return playback;
    const previous = { main: playback.main, added: playback.added, backTransition: link.backTransition };
    return { main: target, added: [], stack: [...(playback.stack ?? []), previous], transition };
  }
  if (mode === 'remove') return !playback.added.includes(target) ? playback :
    { ...playback, added: playback.added.filter(id => id !== target), transition, transitionLayer: { id: target, exit: true } };
  return playback.added.includes(target) || playback.main === target ? playback :
    { ...playback, added: [...playback.added, target], transition, transitionLayer: { id: target, exit: false } };
}

export function popScene(playback: ScenePlayback): ScenePlayback {
  const previous = playback.stack?.at(-1);
  return previous ? { main: previous.main, added: previous.added, stack: playback.stack?.slice(0, -1),
    transition: previous.backTransition } : playback;
}

export function sceneTransition(config: SceneTransition, viewport: () => Size): ScreenTransition {
  if (!config.ms) return new InstantTransition();
  const options = { ms: config.ms, viewport };
  switch (config.kind) {
    case 'fade': return new FadeTransition(config.ms);
    case 'slide': return new SlideTransition(options);
    case 'zoom': return new ZoomTransition(options);
    case 'rotate': return new RotateTransition(options);
    case 'overlay': return new OverlayTransition(options);
    case 'squeeze': return new SqueezeTransition(options);
    default: return new InstantTransition();
  }
}
