import {Container, Graphics, Text} from 'pixi.js';

/** What an object without a visual does, as one glyph: the first matching component wins. */
const GLYPHS: readonly [prefix: string, glyph: string][] = [
 ['pixi.camera2d', '◉'], ['audio.source', '♪'], ['audio.listener', '◎'], ['interactions.timer', '◷'],
 ['interactions.graph', '⚙'], ['interactions.stateMachine', '⚙'], ['interactions.bindings', '⚙'], ['scripts.behaviour', '{}'],
 ['physics.', '⬚'], ['layout.', '▤'],
];
export function markerGlyph(types: readonly string[]): string {
 for (const [prefix, glyph] of GLYPHS) if (types.some(t => t === prefix || prefix.endsWith('.') && t.startsWith(prefix))) return glyph;
 return '◇';
}

/**
 * Editor badge for an object without a visual (camera, sound, rules, timer, script holder…): a round icon with the
 * object's name under it. Drawn at a constant screen size (`scale` is set by the viewport); hidden in the game view.
 */
export function createMarker(name: string, types: readonly string[]): Container {
 const marker = new Container(), glyph = markerGlyph(types);
 const disc = new Graphics().circle(0, 0, 11).fill({color: '#2b3138', alpha: .92}).stroke({color: '#a5afb9', width: 1.5, alpha: .9});
 const icon = new Text({text: glyph, style: {fontSize: glyph.length > 1 ? 10 : 13, fill: '#e6ebf0', fontFamily: 'system-ui, sans-serif', fontWeight: '600'}});
 icon.anchor.set(.5);
 const label = new Text({text: name.length > 24 ? name.slice(0, 23) + '…' : name, style: {fontSize: 10, fill: '#c9d1d9', fontFamily: 'system-ui, sans-serif', stroke: {color: '#111417', width: 3}}});
 label.anchor.set(.5, 0); label.y = 14;
 marker.addChild(disc, icon, label);
 marker.label = 'editor-marker';
 (marker as Container & {glyph?: string}).glyph = glyph;
 return marker;
}

/** Ruler tick spacing in scene units: the smallest 1-2-5 step whose labels stay at least `minPixels` apart. */
export function rulerStep(scale: number, minPixels = 64): number {
 const s = Math.max(1e-6, scale);
 for (let power = 1e-2; power < 1e7; power *= 10) for (const m of [1, 2, 5]) if (m * power * s >= minPixels) return m * power;
 return 1e7;
}
