import '@pixi/layout';
import {LayoutContainer} from '@pixi/layout/components';
import type {Container, Renderer} from 'pixi.js';
import {LayoutContainerSchema, LayoutItemSchema, containerStyle, itemDefaults, itemStyle, type LayoutEntity} from './contracts';

/**
 * Applies `layout.container` / `layout.item` to a built scene graph. Each layout entity gets an inner
 * `LayoutContainer` root (background, border, clipping) placed by the entity's anchor; its direct child entities are
 * moved into that root and become Yoga leaves sized from their measured content. Styles are only re-set when they
 * change, and `clear()` frees every Yoga node before the host destroys its display objects (Pixi's destroy does not).
 * Shared by the editor viewport and the exported player; importing it installs the `@pixi/layout` mixins and renderer
 * system, so it must load before the Pixi application initialises.
 */
export class SceneLayout {
 private roots = new Map<string, LayoutContainer>();
 private managed = new Set<Container>();
 private styles = new WeakMap<Container, string>();
 private styled(target: Container, style: object) {
  const key = JSON.stringify(style);
  if (this.styles.get(target) === key) return;
  this.styles.set(target, key);
  target.layout = style as never;
 }
 /** `rtl`: a right-to-left language mirrors rows (row ↔ row-reverse), like CSS direction: rtl. */
 apply(entities: readonly LayoutEntity[], node: (id: string) => Container | undefined, renderer?: Renderer, rtl = false) {
  const children = new Map<string, LayoutEntity[]>();
  for (const e of entities) if (e.parentId) children.set(e.parentId, [...(children.get(e.parentId) ?? []), e]);
  for (const e of entities) {
   const component = e.components.find(c => c.type === 'layout.container' && c.version === 1), host = node(e.id);
   if (!component || !host) continue;
   const parsed = LayoutContainerSchema.safeParse(component.data);
   if (!parsed.success) continue;
   const p = parsed.data;
   let root = this.roots.get(e.id);
   if (!root || root.destroyed || root.parent !== host) {
    const created = new LayoutContainer({label: 'layout-root'});
    created.on('layout', layout => { created.position.set(-p.anchorX * layout.computedLayout.width, -p.anchorY * layout.computedLayout.height); });
    created.position.set(-p.anchorX * p.width, -p.anchorY * p.height);
    host.addChild(created);
    this.roots.set(e.id, created);
    root = created;
   }
   this.styled(root, containerStyle(p, rtl));
   const slot = root.overflowContainer;
   let index = 0;
   for (const child of children.get(e.id) ?? []) {
    const view = node(child.id);
    if (!view) continue;
    if (slot.children[index] !== view) slot.addChildAt(view, index);
    index++;
    this.managed.add(view);
    const item = child.components.find(c => c.type === 'layout.item' && c.version === 1), data = item ? LayoutItemSchema.safeParse(item.data) : null;
    const style = data?.success ? data.data : itemDefaults;
    // Local bounds exclude the node's own layout offset/scale, so this is the authored content size. A nested
    // container is sized by its declared width/height (its contents are only laid out after this pass).
    const nested = child.components.find(c => c.type === 'layout.container' && c.version === 1), declared = nested ? LayoutContainerSchema.safeParse(nested.data) : null;
    if (declared?.success && declared.data.width > 0 && declared.data.height > 0) {
     // A sized nested container is a real flex box (not a measured leaf): its node sits at the box's anchor point
     // and its own root, a Yoga child of the node, is pulled back by the anchor as usual.
     const {isLeaf: _leaf, objectFit: _fit, objectPosition: _position, ...box} = itemStyle(style, declared.data);
     view.position.set(declared.data.anchorX * declared.data.width, declared.data.anchorY * declared.data.height);
     this.styled(view, box);
    } else {
     view.position.set(0, 0);
     this.styled(view, itemStyle(style, view.getLocalBounds()));
    }
   }
  }
  // Settle now (the renderer would otherwise lay out on the next prerender) so bounds and outlines are current.
  let top: Container | undefined;
  for (const root of this.roots.values()) { if (root.destroyed) continue; let c: Container = root; while (c.parent) c = c.parent; top = c; break; }
  if (top && renderer) (renderer as unknown as {layout?: {update(container: Container): void}}).layout?.update(top);
 }
 /** Frees Yoga nodes; call before the host destroys the display objects (the roots go with their hosts). */
 clear() {
  for (const view of this.managed) if (!view.destroyed) view.layout = null;
  for (const root of this.roots.values()) if (!root.destroyed) root.layout = null;
  this.managed.clear(); this.roots.clear(); this.styles = new WeakMap();
 }
}
