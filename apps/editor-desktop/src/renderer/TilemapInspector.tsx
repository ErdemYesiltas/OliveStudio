import type {Entity, SceneService} from '@rewrite/scene';
import {TilemapSchema, resizeTiles, tilesetSize} from '@rewrite/render-pixi';

/** Studio-owned brush: painting outlives the inspector (closing Properties keeps the brush on the canvas). */
export interface TileBrush {entityId: string | null; tile: number}
/**
 * Tilemap inspector: tileset palette (or eraser), map size and a Paint toggle. While painting, canvas strokes go to
 * the brush; a stroke is previewed live and committed as one undo step on release (Escape cancels it).
 */
export function createTilemapInspector(bridge: {
 scene: SceneService; texture(assetId: string): {url: string; width: number; height: number} | undefined; useEditable(): boolean;
 text(key: string): string; report(error: unknown): void; useBrush(): TileBrush; setBrush(next: TileBrush): void;
}) {
 return function TilemapInspector({entity, component}: {entity: Entity; component: Entity['components'][number]}) {
  const p = TilemapSchema.parse(component.data), editable = bridge.useEditable(), t = bridge.text, tileset = bridge.texture(p.assetId), size = tileset ? tilesetSize(tileset, p) : {columns: 0, rows: 0};
  const brush = bridge.useBrush(), painting = brush.entityId === entity.id, tile = brush.tile;
  const setTile = (next: number) => bridge.setBrush({...brush, tile: next});
  const resize = (columns: number, rows: number) => {
   if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 || columns > 256 || rows > 256) { bridge.report(Error(t('tilemap.invalidSize'))); return; }
   try { bridge.scene.document.transact('Resize tilemap', d => { const c = d.entities.find(e => e.id === entity.id)!.components.find(c => c.id === component.id)!; const map = TilemapSchema.parse(c.data); c.data = {...map, columns, rows, tiles: resizeTiles(map, columns, rows)}; }); } catch (error) { bridge.report(error); }
  };
  const scale = tileset ? Math.min(1, 260 / tileset.width) : 1;
  return <div className="tilemap-inspector" data-testid="tilemap-inspector" data-brush={tile} data-painting={painting}>
   <div className="inline-row">
    <label className="field"><span>{t('tilemap.columns')}</span><input type="number" aria-label={t('tilemap.columns')} key={`c${p.columns}`} defaultValue={p.columns} disabled={!editable} onBlur={e => { const v = Number(e.currentTarget.value); if (v !== p.columns) resize(v, p.rows); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/></label>
    <label className="field"><span>{t('tilemap.rows')}</span><input type="number" aria-label={t('tilemap.rows')} key={`r${p.rows}`} defaultValue={p.rows} disabled={!editable} onBlur={e => { const v = Number(e.currentTarget.value); if (v !== p.rows) resize(p.columns, v); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/></label>
   </div>
   <div className="panel-actions">
    <button aria-pressed={painting} disabled={!editable || !tileset} onClick={() => bridge.setBrush({tile, entityId: painting ? null : entity.id})}>{painting ? t('tilemap.stopPainting') : t('tilemap.paint')}</button>
    <button aria-pressed={tile === -1} disabled={!editable} onClick={() => setTile(-1)}>{t('tilemap.eraser')}</button>
   </div>
   {!tileset ? <p className="panel-empty">{t('tilemap.noTileset')}</p> :
    <div className="tile-palette" role="group" aria-label={t('tilemap.palette')} style={{width: tileset.width * scale, height: tileset.height * scale, backgroundImage: `url("${tileset.url}")`, backgroundSize: `${tileset.width * scale}px ${tileset.height * scale}px`}}>
     {Array.from({length: size.columns * size.rows}, (_, i) => <button key={i} aria-label={`${t('tilemap.tile')} ${i}`} aria-pressed={tile === i} onClick={() => setTile(i)}
      style={{left: (i % size.columns) * p.tileWidth * scale, top: Math.floor(i / size.columns) * p.tileHeight * scale, width: p.tileWidth * scale, height: p.tileHeight * scale}}/>)}
    </div>}
   <small>{p.tiles.filter(v => v >= 0).length} / {p.tiles.length} {t('tilemap.filled')}</small>
  </div>;
 };
}
