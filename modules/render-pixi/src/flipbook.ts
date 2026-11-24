import {Container, Graphics, Rectangle, Sprite, Texture} from 'pixi.js';
import {z} from 'zod';
import type {ComponentDefinition, Json} from '@rewrite/sdk';
import type {VisualAdapter} from './visuals';
import {acquireTexture as acquire, releaseTexture as release} from './textures';

/** Frame-by-frame animation from a grid sprite sheet (an imported image, sliced left-to-right, top-to-bottom). */
export const FlipbookSchema = z.object({
 assetId: z.string(), columns: z.number().int().min(1).max(64), rows: z.number().int().min(1).max(64), frames: z.number().int().min(1).max(4096),
 /** First cell of the animation in the sheet (row-major); one sheet can hold several named ranges. */
 start: z.number().int().min(0).max(4095).optional(),
 fps: z.number().min(0.1).max(120), loop: z.boolean(), autoplay: z.boolean(),
 width: z.number().positive().max(10000), height: z.number().positive().max(10000), anchorX: z.number().min(0).max(1), anchorY: z.number().min(0).max(1), alpha: z.number().min(0).max(1),
 /** Runtime only (play/stop actions): playback start and the time it froze. Never authored. */
 startedAt: z.number().nullable().optional(), stoppedAt: z.number().nullable().optional(),
}).strict().refine(v => (v.start ?? 0) + v.frames <= v.columns * v.rows, {message: 'Frame count exceeds the sheet grid'});
export type Flipbook = z.infer<typeof FlipbookSchema>;
export const flipbookDefinition: ComponentDefinition = {
 type: 'pixi.flipbook', version: 1, titleKey: 'component.flipbook', exclusiveGroup: 'render.visual',
 defaults: () => ({assetId: '', columns: 4, rows: 1, frames: 4, fps: 12, loop: true, autoplay: true, width: 100, height: 100, anchorX: 0.5, anchorY: 0.5, alpha: 1}),
 parse: v => FlipbookSchema.parse(v),
 fields: [
  {key: 'assetId', titleKey: 'field.sheet', kind: 'asset', assetType: 'pixi.texture'},
  ...['columns', 'rows', 'frames', 'fps'].map(key => ({key, titleKey: `field.${key}`, kind: 'number' as const})),
  {key: 'loop', titleKey: 'field.loop', kind: 'boolean'}, {key: 'autoplay', titleKey: 'field.autoplay', kind: 'boolean'},
  ...['width', 'height', 'anchorX', 'anchorY', 'alpha'].map(key => ({key, titleKey: `field.${key}`, kind: 'number' as const})),
 ],
};
/**
 * The shown frame at a runtime time (0 while editing): loops or holds the last frame. A play action restarts from
 * `startedAt`; a stop action freezes the frame reached at `stoppedAt`.
 */
export function flipbookFrame(p: Pick<Flipbook, 'frames' | 'fps' | 'loop' | 'autoplay' | 'startedAt' | 'stoppedAt'>, time: number): number {
 if (!p.autoplay && p.startedAt == null) return 0;
 const at = p.stoppedAt != null ? Math.min(time, p.stoppedAt) : time, elapsed = at - (p.startedAt ?? 0);
 if (!(elapsed > 0)) return 0;
 const raw = Math.floor(elapsed * p.fps + 1e-9);
 return p.loop ? raw % p.frames : Math.min(raw, p.frames - 1);
}

/** Shared by the editor and the exported player; `url` resolves an image asset to its texture URL. */
export function createFlipbookAdapter(url: (assetId: string) => string | undefined): VisualAdapter {
 return {
  type: 'pixi.flipbook', version: 1,
  key: data => { const p = FlipbookSchema.parse(data); return [p.assetId, p.columns, p.rows]; },
  create(data, context) {
   let p = FlipbookSchema.parse(data), base: Texture | undefined, current = -1, error: string | undefined, dead = false;
   const view = new Container(), sprite = new Sprite(), placeholder = new Graphics(), frames: Texture[] = [], src = url(p.assetId);
   view.addChild(placeholder, sprite);
   const layout = () => {
    sprite.anchor.set(p.anchorX, p.anchorY); sprite.width = p.width; sprite.height = p.height; sprite.alpha = p.alpha; sprite.visible = Boolean(base);
    placeholder.clear();
    if (!base) placeholder.rect(-p.anchorX * p.width, -p.anchorY * p.height, p.width, p.height).fill('#4d3747').stroke({color: '#d29bbd', width: 1});
   };
   const show = (index: number) => {
    if (!base) return;
    const frame = (p.start ?? 0) + Math.min(index, p.frames - 1);
    if (frame !== current) {
     const w = Math.floor(base.width / p.columns), h = Math.floor(base.height / p.rows);
     frames[frame] ??= new Texture({source: base.source, frame: new Rectangle((frame % p.columns) * w, Math.floor(frame / p.columns) * h, w, h)});
     sprite.texture = frames[frame]; current = frame;
    }
    layout();
   };
   if (!src) error = 'Missing sprite sheet image';
   else void acquire(src).then(({texture}) => { if (dead) return; base = texture; show(flipbookFrame(p, context.frame().time)); context.changed(); }, e => { if (!dead) { error = String(e); context.changed(); } });
   layout();
   return {
    view,
    update(next: Json, frame) { p = FlipbookSchema.parse(next); show(flipbookFrame(p, frame.time)); if (!base) layout(); },
    diagnostics: () => ({ready: Boolean(base), frame: current, error: error ?? null}),
    dispose() {
     if (dead) return;
     dead = true;
     for (const f of frames) f?.destroy(false);
     view.destroy({children: true, context: true});
     if (src) release(src);
    },
   };
  },
 };
}
