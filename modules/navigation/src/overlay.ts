import {Graphics, type Container} from 'pixi.js';
import type {SceneDecorator} from '@rewrite/render-pixi/visuals';
import type {Entity} from '@rewrite/scene';
import {NavGridSchema, buildField, navGridType, obstacles} from './index';

/** Editor view of a Nav Grid (when `show` is on): its area, faint cells, and the blocked cells tinted. Never exported. */
export function createNavGridDecorator(): SceneDecorator {
 const drawn = new Map<Container, {key: string; graphic: Graphics}>();
 const drop = (view: Container) => { const d = drawn.get(view); if (d && !d.graphic.destroyed) d.graphic.destroy(); drawn.delete(view); };
 return {
  apply(entities, node) {
   const list = entities as unknown as readonly Entity[], keep = new Set<Container>();
   const owner = list.find(e => e.components.some(c => c.type === navGridType));
   const data = owner && NavGridSchema.safeParse(owner.components.find(c => c.type === navGridType)!.data);
   const view = owner && data?.success && data.data.show ? node(owner.id) : undefined;
   if (owner && view && !view.destroyed && data?.success) {
    keep.add(view);
    const key = JSON.stringify([data.data, obstacles(list)]), previous = drawn.get(view);
    if (previous?.key !== key || previous.graphic.destroyed || previous.graphic.parent !== view) {
     drop(view);
     const field = buildField(list, owner.id)!, g = new Graphics({label: 'nav-grid'}), w = field.cols * field.cell, h = field.rows * field.cell;
     const pivot = owner.components.find(c => c.type === 'scene.transform2d')?.data as {pivotX?: number; pivotY?: number} | undefined;
     g.position.set((pivot?.pivotX ?? 0) - w / 2, (pivot?.pivotY ?? 0) - h / 2);
     g.eventMode = 'none';
     if (field.cols * field.rows <= 20000) { for (let c = 1; c < field.cols; c++) g.moveTo(c * field.cell, 0).lineTo(c * field.cell, h); for (let r = 1; r < field.rows; r++) g.moveTo(0, r * field.cell).lineTo(w, r * field.cell); g.stroke({color: 0x7cf3ff, width: 1, alpha: .12}); }
     field.blocked.forEach((b, i) => { if (b) g.rect((i % field.cols) * field.cell, Math.floor(i / field.cols) * field.cell, field.cell, field.cell); });
     g.fill({color: 0xff4d6d, alpha: .28});
     g.rect(0, 0, w, h).stroke({color: 0x7cf3ff, width: 1.5, alpha: .55});
     view.addChild(g); drawn.set(view, {key, graphic: g});
    }
   }
   for (const v of [...drawn.keys()]) if (!keep.has(v)) drop(v);
  },
  clear() { for (const v of [...drawn.keys()]) drop(v); },
 };
}
