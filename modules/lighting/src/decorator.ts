import {AlphaFilter, Container, Graphics, Sprite, Texture} from 'pixi.js';
import type {SceneDecorator} from '@rewrite/render-pixi/visuals';
import {worldTransform} from '@rewrite/physics';
import type {Entity} from '@rewrite/scene';
import {LightSchema, LightingSchema, flickerAt, hexColor, lightType, lightingType, occluders, visibility} from './index';

let glow: Texture | undefined;
/** A soft round light (white, fading to transparent), drawn once. */
function glowTexture() {
 if (glow) return glow;
 const size = 256, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
 const g = canvas.getContext('2d')!, gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
 for (let i = 0; i <= 8; i++) { const t = i / 8; gradient.addColorStop(t, `rgba(255,255,255,${((1 - t) ** 2).toFixed(3)})`); }
 g.fillStyle = gradient; g.fillRect(0, 0, size, size);
 return glow = Texture.from(canvas);
}
interface Lit {layer: Container; ambient: Graphics; lights: Map<string, {sprite: Sprite; mask?: Graphics; key: string}>}
/**
 * Lighting pass shared by the editor, Preview and the exported `lighting` chunk: one layer on top of the world (under
 * the HUD), rendered to a texture — ambient colour plus additive light sprites (masked by their visibility polygon when
 * they cast shadows) — and multiplied over the scene.
 */
export function createLightingDecorator(): SceneDecorator {
 let lit: Lit | null = null;
 const started = typeof performance === 'undefined' ? 0 : performance.now();
 const teardown = () => { if (!lit) return; if (!lit.layer.destroyed) lit.layer.destroy({children: true}); lit = null; };
 return {
  apply(entities, node) {
   const list = entities as unknown as readonly Entity[];
   const settings = list.map(e => e.components.find(c => c.type === lightingType && c.version === 1)).find(Boolean), parsed = settings && LightingSchema.safeParse(settings.data);
   const root = list.filter(e => !e.parentId && !e.components.some(c => c.type === 'pixi.screenSpace')).map(e => node(e.id)?.parent).find(p => p && !p.destroyed) as Container | undefined;
   if (!parsed?.success || !parsed.data.enabled || !root) { teardown(); return; }
   if (!lit || lit.layer.destroyed || (lit.layer.parent && lit.layer.parent !== root)) {
    teardown();
    const layer = new Container({label: 'lighting'}), ambient = new Graphics(), filter = new AlphaFilter({alpha: 1});
    filter.blendMode = 'multiply'; layer.filters = [filter]; layer.eventMode = 'none'; layer.addChild(ambient);
    lit = {layer, ambient, lights: new Map()};
   }
   if (lit.layer.parent !== root || root.children[root.children.length - 1] !== lit.layer) root.addChild(lit.layer);
   lit.ambient.clear().rect(-50000, -50000, 100000, 100000).fill(hexColor(parsed.data.ambient));
   const byId = new Map(list.map(e => [e.id, e])), seconds = ((typeof performance === 'undefined' ? 0 : performance.now()) - started) / 1000;
   let walls: ReturnType<typeof occluders> | undefined, wallsKey = '';
   const keep = new Set<string>();
   list.forEach((e, index) => {
    const c = e.components.find(x => x.type === lightType && x.version === 1), light = c && LightSchema.safeParse(c.data);
    if (!light?.success) return;
    for (let x: Entity | undefined = e, n = 0; x && n < 64; x = x.parentId ? byId.get(x.parentId) : undefined, n++) if (!x.active) return;
    keep.add(e.id);
    let entry = lit!.lights.get(e.id);
    if (!entry) { const sprite = new Sprite(glowTexture()); sprite.anchor.set(.5); sprite.blendMode = 'add'; lit!.layer.addChild(sprite); entry = {sprite, key: ''}; lit!.lights.set(e.id, entry); }
    const at = worldTransform(byId, e.id), p = light.data;
    entry.sprite.position.set(at.x, at.y); entry.sprite.width = entry.sprite.height = p.radius * 2; entry.sprite.tint = hexColor(p.color);
    entry.sprite.alpha = p.intensity * flickerAt(p.flicker, seconds, index * 1.7);
    if (p.shadows) {
     walls ??= occluders(list); wallsKey ||= JSON.stringify(walls);
     const key = `${at.x},${at.y},${p.radius}|${wallsKey}`;
     if (entry.key !== key || !entry.mask) {
      entry.mask ??= new Graphics(); if (!entry.mask.parent) lit!.layer.addChild(entry.mask);
      entry.mask.clear().poly(visibility({x: at.x, y: at.y}, p.radius, walls).flatMap(q => [q.x, q.y])).fill(0xffffff);
      entry.sprite.mask = entry.mask; entry.key = key;
     }
    } else if (entry.mask) { entry.sprite.mask = null; entry.mask.destroy(); entry.mask = undefined; entry.key = ''; }
   });
   for (const [id, entry] of lit.lights) if (!keep.has(id)) { entry.sprite.destroy(); entry.mask?.destroy(); lit.lights.delete(id); }
  },
  clear() { teardown(); },
 };
}
