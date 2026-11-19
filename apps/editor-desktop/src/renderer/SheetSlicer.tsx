import {useState} from 'react';
import {Film} from 'lucide-react';

export interface SheetGrid {columns: number; rows: number; frames: number; fps: number; loop: boolean; width: number; height: number}

/** A first guess for a strip or grid of square frames: 512×64 → 8 × 1, 64×256 → 1 × 4; otherwise one frame. */
export function guessGrid(width: number, height: number): {columns: number; rows: number} {
 if (width > height && height > 0 && width % height === 0) return {columns: Math.min(64, width / height), rows: 1};
 if (height > width && width > 0 && height % width === 0) return {columns: 1, rows: Math.min(64, height / width)};
 return {columns: 1, rows: 1};
}

/**
 * Library preview of an image as a sprite sheet: columns × rows drawn over the picture, the frame size, and
 * "Create animated sprite" (a Sprite sheet animation object at the view centre).
 */
export function SheetSlicer({name, image, width, height, editable, text: t, create}: {name: string; image?: string; width: number; height: number; editable: boolean; text(key: string): string; create(grid: SheetGrid): void}) {
 const guess = guessGrid(width, height);
 const [columns, setColumns] = useState(guess.columns), [rows, setRows] = useState(guess.rows), [frames, setFrames] = useState(guess.columns * guess.rows), [fps, setFps] = useState(12);
 const cells = columns * rows, count = Math.min(frames, cells), frameW = width / columns, frameH = height / rows, even = Number.isInteger(frameW) && Number.isInteger(frameH);
 const int = (raw: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(raw) || min)));
 return <details className="sheet-slicer" data-testid="sheet-slicer">
  <summary><Film size={13}/> {t('sheet.title')}</summary>
  <div className="sheet-slicer-preview" data-grid={`${columns}x${rows}`}>
   {image && <img src={image} alt={name}/>}
   <svg viewBox={`0 0 ${columns} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
    {Array.from({length: cells}, (_, i) => i >= count ? <rect key={i} x={i % columns} y={Math.floor(i / columns)} width={1} height={1} className="sheet-unused"/> : null)}
    {Array.from({length: columns - 1}, (_, i) => <line key={'c' + i} x1={i + 1} x2={i + 1} y1={0} y2={rows}/>)}
    {Array.from({length: rows - 1}, (_, i) => <line key={'r' + i} y1={i + 1} y2={i + 1} x1={0} x2={columns}/>)}
   </svg>
  </div>
  <div className="sheet-slicer-fields">
   <label><span>{t('sheet.columns')}</span><input aria-label={t('sheet.columns')} type="number" min={1} max={64} value={columns} onChange={e => { const v = int(e.target.value, 1, 64); setColumns(v); setFrames(v * rows); }}/></label>
   <label><span>{t('sheet.rows')}</span><input aria-label={t('sheet.rows')} type="number" min={1} max={64} value={rows} onChange={e => { const v = int(e.target.value, 1, 64); setRows(v); setFrames(columns * v); }}/></label>
   <label><span>{t('sheet.frames')}</span><input aria-label={t('sheet.frames')} type="number" min={1} max={cells} value={count} onChange={e => setFrames(int(e.target.value, 1, cells))}/></label>
   <label><span>{t('sheet.fps')}</span><input aria-label={t('sheet.fps')} type="number" min={1} max={120} value={fps} onChange={e => setFps(int(e.target.value, 1, 120))}/></label>
  </div>
  <small data-testid="sheet-frame-size" data-even={even}>{t('sheet.frameSize').replace('{w}', String(Math.round(frameW * 100) / 100)).replace('{h}', String(Math.round(frameH * 100) / 100)).replace('{n}', String(count))}{even ? '' : ` · ${t('sheet.uneven')}`}</small>
  <button className="primary" disabled={!editable} onClick={() => create({columns, rows, frames: count, fps, loop: true, width: frameW, height: frameH})}>{t('sheet.create')}</button>
 </details>;
}
