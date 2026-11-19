import {expect, it} from 'vitest';
import type {EventSystem} from 'pixi.js';
import {clickTarget} from './click';

type Node = {name: string; parent: Node | null; eventMode: string};
/** A fake scene, topmost last: hit testing returns the topmost node whose own and ancestors' eventMode is not `none`. */
function scene(order: Node[]) {
 const live = (n: Node | null): boolean => !n || (n.eventMode !== 'none' && live(n.parent));
 const events = {rootBoundary: {hitTest: () => [...order].reverse().find(n => live(n)) ?? null}} as unknown as EventSystem;
 return (clickable: string[]) => clickTarget(events, {x: 0, y: 0}, n => (n as unknown as Node).name.startsWith('#') ? undefined : (n as unknown as Node).name, id => clickable.includes(id));
}
const node = (name: string, parent: Node | null = null): Node => ({name, parent, eventMode: 'static'});

it('passes clicks through objects nobody listens to, bubbles to listening ancestors and restores what it skipped', () => {
 const coin = node('coin'), coinView = node('#coin-shape', coin), star = node('star', coin), sparkle = node('sparkle'), sparkleHit = node('#sparkle-hit', sparkle);
 const click = scene([coin, coinView, star, sparkle, sparkleHit]);
 expect(click(['coin'])).toBe('coin');
 expect(sparkle.eventMode).toBe('static');
 expect(click(['star', 'coin'])).toBe('star');
 expect(click(['sparkle', 'coin'])).toBe('sparkle');
 expect(click([])).toBeUndefined();
 expect([coin, star, sparkle].map(n => n.eventMode)).toEqual(['static', 'static', 'static']);
});
