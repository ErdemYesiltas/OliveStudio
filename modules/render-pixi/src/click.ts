import type {Container, EventSystem} from 'pixi.js';

/**
 * Which object a click in Preview or the exported game belongs to: the topmost object under the pointer that reacts
 * to clicks, or its nearest ancestor that does. Objects nobody listens to (a particle glow over a button, a decorative
 * overlay) let the click through to what is underneath.
 */
export function clickTarget(events: EventSystem, global: {x: number; y: number}, entityOf: (node: Container) => string | undefined, clickable: (id: string) => boolean): string | undefined {
 const skipped: [Container, Container['eventMode']][] = [];
 try {
  for (;;) {
   const hit = events.rootBoundary.hitTest(global.x, global.y);
   let node: Container | null = hit, top: Container | undefined;
   for (; node; node = node.parent) { const id = entityOf(node); if (id === undefined) continue; top ??= node; if (clickable(id)) return id; }
   if (!top) return undefined;
   skipped.push([top, top.eventMode]); top.eventMode = 'none';
  }
 } finally { for (const [node, mode] of skipped.reverse()) node.eventMode = mode; }
}
