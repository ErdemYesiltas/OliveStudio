import { readGridSettings, type GridSettings } from '@rewrite/render-pixi/grid';

export type ViewportGrid = GridSettings & { rulers: boolean; guides: boolean };
const storageKey = 'olive.viewport-grid';

export function loadViewportGrid(): ViewportGrid {
  let stored: Partial<ViewportGrid> | undefined;
  try { stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') ?? undefined; }
  catch { /* Use defaults for invalid preferences. */ }
  return { ...readGridSettings(stored), rulers: stored?.rulers !== false, guides: stored?.guides !== false };
}

export function saveViewportGrid(grid: ViewportGrid) {
  localStorage.setItem(storageKey, JSON.stringify(grid));
}
