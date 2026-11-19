import {Container, Graphics, Rectangle, Sprite, Texture} from 'pixi.js';
import {z} from 'zod';
import type {ComponentDefinition, Json} from '@rewrite/sdk';
import type {VisualAdapter} from './visuals';
import {acquireTexture, releaseTexture} from './textures';

/**
 * Grid of tiles cut from one tileset image (left-to-right, top-to-bottom). `tiles` holds one tileset index per cell,
 * row-major, -1 for empty. The map's origin is its top-left corner so painting maps straight to cells.
 */
export const TilemapSchema = z.object({
 assetId: z.uuid().or(z.literal('')), tileWidth: z.number().int().min(1).max(1024), tileHeight: z.number().int().min(1).max(1024),
 columns: z.number().int().min(1).max(256), rows: z.number().int().min(1).max(256), alpha: z.number().min(0).max(1),
 tiles: z.array(z.number().int().min(-1).max(65535)).max(65536),
 /** Physics: `solid` makes every painted tile a static collider (merged into rectangles). */
 collision: z.enum(['none', 'solid']).default('none'),
}).strict().refine(v => v.tiles.length === v.columns * v.rows, {message: 'Tile count must equal columns × rows'});
export type Tilemap = z.infer<typeof TilemapSchema>;
export const tilemapDefinition: ComponentDefinition = {
 type: 'pixi.tilemap', version: 1, titleKey: 'component.tilemap', exclusiveGroup: 'render.visual',
 defaults: () => ({assetId: '', tileWidth: 32, tileHeight: 32, columns: 16, rows: 10, alpha: 1, tiles: Array(160).fill(-1), collision: 'none'}),
 parse: v => TilemapSchema.parse(v) as Json,
 fields: [{key: 'assetId', titleKey: 'field.tileset', kind: 'asset', assetType: 'pixi.texture'}, ...['tileWidth', 'tileHeight', 'alpha'].map(key => ({key, titleKey: `field.${key}`, kind: 'number' as const})), {key: 'collision', titleKey: 'field.tileCollision', kind: 'enum', options: [{value: 'none', titleKey: 'tileCollision.none'}, {value: 'solid', titleKey: 'tileCollision.solid'}]}],
};
/** Cell under a point in the map's local space, or null outside. */
export function tileAt(map: Pick<Tilemap, 'tileWidth' | 'tileHeight' | 'columns' | 'rows'>, x: number, y: number) {
 const column = Math.floor(x / map.tileWidth), row = Math.floor(y / map.tileHeight);
 return column >= 0 && row >= 0 && column < map.columns && row < map.rows ? {column, row, index: row * map.columns + column} : null;
}
/** Cells on the segment between two points (so fast strokes leave no gaps). */
export function cellsAlong(map: Pick<Tilemap, 'tileWidth' | 'tileHeight' | 'columns' | 'rows'>, from: {x: number; y: number}, to: {x: number; y: number}) {
 const steps = Math.max(1, Math.ceil(Math.max(Math.abs(to.x - from.x) / map.tileWidth, Math.abs(to.y - from.y) / map.tileHeight) * 2)), out = new Set<number>();
 for (let i = 0; i <= steps; i++) { const cell = tileAt(map, from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); if (cell) out.add(cell.index); }
 return [...out];
}
/** Resize keeping existing cells at the same column/row. */
export function resizeTiles(map: Tilemap, columns: number, rows: number): number[] {
 return Array.from({length: columns * rows}, (_, i) => { const c = i % columns, r = Math.floor(i / columns); return c < map.columns && r < map.rows ? map.tiles[r * map.columns + c] : -1; });
}
/** Number of tiles in a tileset image. */
export const tilesetSize = (image: {width: number; height: number}, map: Pick<Tilemap, 'tileWidth' | 'tileHeight'>) => ({columns: Math.floor(image.width / map.tileWidth), rows: Math.floor(image.height / map.tileHeight)});

/** Shared by the editor and the exported player (`objects` runtime chunk). */
export function createTilemapAdapter(url: (assetId: string) => string | undefined): VisualAdapter {
 return {
  type: 'pixi.tilemap', version: 1,
  key: data => { const p = TilemapSchema.parse(data); return [p.assetId, p.tileWidth, p.tileHeight, p.columns, p.rows, p.tiles]; },
  create(data, context) {
   const p = TilemapSchema.parse(data), view = new Container(), outline = new Graphics(), src = p.assetId ? url(p.assetId) : undefined, frames = new Map<number, Texture>();
   let dead = false, error: string | null = null, ready = false;
   outline.rect(0, 0, p.columns * p.tileWidth, p.rows * p.tileHeight).fill({color: 0xffffff, alpha: 0.001}).stroke({color: '#d29bbd', width: 1, alpha: .5});
   view.addChild(outline); view.alpha = p.alpha;
   const build = (base: Texture) => {
    const size = tilesetSize(base, p);
    p.tiles.forEach((tile, i) => {
     if (tile < 0 || tile >= size.columns * size.rows) return;
     let frame = frames.get(tile);
     if (!frame) { frame = new Texture({source: base.source, frame: new Rectangle((tile % size.columns) * p.tileWidth, Math.floor(tile / size.columns) * p.tileHeight, p.tileWidth, p.tileHeight)}); frames.set(tile, frame); }
     const sprite = new Sprite(frame); sprite.position.set((i % p.columns) * p.tileWidth, Math.floor(i / p.columns) * p.tileHeight); view.addChild(sprite);
    });
    ready = true; context.changed();
   };
   if (src) void acquireTexture(src).then(({texture}) => { if (!dead) build(texture); }, e => { if (!dead) { error = String(e); context.changed(); } });
   return {
    view,
    update(next) { view.alpha = TilemapSchema.parse(next).alpha; },
    diagnostics: () => ({ready: ready || !src, error, tiles: p.tiles.filter(t => t >= 0).length}),
    dispose() { if (dead) return; dead = true; for (const f of frames.values()) f.destroy(false); view.destroy({children: true}); if (src) releaseTexture(src); },
   };
  },
 };
}
