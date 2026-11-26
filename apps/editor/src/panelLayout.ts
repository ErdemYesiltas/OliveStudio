import { z } from 'zod';

export const panelIds = ['hierarchy', 'scene', 'inspector', 'assets', 'bundles', 'timeline', 'scenes', 'prefabs', 'input', 'globals', 'scripts', 'physics', 'lighting', 'network', 'content', 'audioStudio', 'shaders', 'ai', 'diagnostics'] as const;
const optionalPanels = new Set<PanelId>(['timeline', 'scenes', 'prefabs', 'input', 'globals', 'scripts', 'physics', 'lighting', 'network', 'content', 'audioStudio', 'shaders', 'ai', 'diagnostics']);
export const dockIds = ['left', 'center', 'right', 'bottom', 'bottomRight'] as const;
export type PanelId = typeof panelIds[number];
export type DockId = typeof dockIds[number];
export type SizeKey = 'left' | 'right' | 'bottom';

const home: Record<PanelId, DockId> = {
  hierarchy: 'left', scene: 'center', inspector: 'right', assets: 'bottom', bundles: 'bottomRight', timeline: 'bottom', scenes: 'left',
  prefabs: 'bottom', input: 'bottom', globals: 'bottom', scripts: 'bottom', physics: 'bottom', lighting: 'bottom', network: 'bottom', content: 'bottom', audioStudio: 'bottom',
  shaders: 'bottom', ai: 'bottom', diagnostics: 'bottom',
};
export const sizeRange: Record<SizeKey, readonly [number, number]> = {
  left: [12, 35], right: [15, 40], bottom: [23, 65],
};

const dock = z.enum(dockIds);
const panel = z.enum(panelIds);
const size = (key: SizeKey) => z.number().min(sizeRange[key][0]).max(sizeRange[key][1]);
const layoutSchema = z.strictObject({
  panels: z.array(z.strictObject({ id: panel, dock, open: z.boolean(), minimized: z.literal(true).optional() })).max(panelIds.length)
    .refine(items => new Set(items.map(item => item.id)).size === items.length &&
      panelIds.every(id => optionalPanels.has(id) || items.some(item => item.id === id))),
  active: z.partialRecord(dock, panel),
  sizes: z.strictObject({ left: size('left'), right: size('right'), bottom: size('bottom') }),
});
export type PanelLayout = z.infer<typeof layoutSchema> & { maximized?: PanelId };

export function defaultLayout(): PanelLayout {
  return {
    panels: panelIds.map(id => ({ id, dock: home[id], open: !optionalPanels.has(id) })),
    active: {},
    sizes: { left: 18, right: 22, bottom: 32 },
  };
}

const storageKey = 'olive.panel-layout.v1';

export function readPanelLayout(): PanelLayout {
  const storage = globalThis.localStorage;
  try {
    const saved = layoutSchema.safeParse(JSON.parse(storage.getItem(storageKey) ?? 'null'));
    if (saved.success) {
      const layout = saved.data;
      for (const id of optionalPanels) {
        if (!layout.panels.some(item => item.id === id)) layout.panels.push({ id, dock: home[id], open: false });
      }
      return layout;
    }
  } catch { /* An invalid layout can be reset to the defaults. */ }
  const defaults = defaultLayout();
  if (storage.getItem('olive.bundles.visibility') === 'closed') {
    defaults.panels = defaults.panels.map(item => item.id === 'bundles' ? { ...item, open: false } : item);
  }
  const oldHeight = size('bottom').safeParse(Number(storage.getItem('olive.assets.height')) * 100);
  if (oldHeight.success) defaults.sizes.bottom = oldHeight.data;
  return defaults;
}

export function savePanelLayout(layout: PanelLayout) {
  const { maximized: _temporary, ...saved } = layout;
  localStorage.setItem(storageKey, JSON.stringify(saved));
}

export function openTabs(layout: PanelLayout, dock: DockId) {
  return layout.panels.filter(item => item.open && !item.minimized && item.dock === dock).map(item => item.id);
}

export function activeTab(layout: PanelLayout, dock: DockId, tabs = openTabs(layout, dock)) {
  if (layout.maximized) return tabs.includes(layout.maximized) ? layout.maximized : undefined;
  const active = layout.active[dock];
  return active && tabs.includes(active) ? active : tabs[0];
}

export function setPanelOpen(layout: PanelLayout, id: PanelId, open: boolean): PanelLayout {
  const item = layout.panels.find(item => item.id === id)!;
  return {
    ...layout,
    panels: layout.panels.map(item => item.id === id ? { id, dock: item.dock, open } : item),
    maximized: open || layout.maximized === id ? undefined : layout.maximized,
    active: open ? { ...layout.active, [item.dock]: id } : layout.active,
  };
}

export function minimizePanel(layout: PanelLayout, id: PanelId): PanelLayout {
  if (layout.maximized === id) return { ...layout, maximized: undefined };
  return { ...layout, panels: layout.panels.map(item => item.id === id && item.open ? { ...item, minimized: true } : item) };
}

export function toggleDockMinimized(layout: PanelLayout, docks: readonly DockId[]): PanelLayout {
  const inSection = (item: PanelLayout['panels'][number]) => item.open && docks.includes(item.dock);
  const minimize = layout.panels.some(item => inSection(item) && !item.minimized);
  return {
    ...layout,
    panels: layout.panels.map(item => !inSection(item) ? item : {
      ...item, minimized: minimize ? true : undefined,
    }),
  };
}

export function maximizePanel(layout: PanelLayout, id: PanelId): PanelLayout {
  return { ...setPanelOpen(layout, id, true), maximized: id };
}

export function dockPanel(layout: PanelLayout, id: PanelId, dock: DockId, before?: PanelId): PanelLayout {
  if (id === before) return layout;
  const panels = layout.panels.filter(item => item.id !== id);
  const index = before ? panels.findIndex(item => item.id === before) : -1;
  const item = layout.panels.find(item => item.id === id)!;
  panels.splice(index < 0 ? panels.length : index, 0, { ...item, dock, open: true });
  return { ...layout, panels, active: item.minimized ? layout.active : { ...layout.active, [dock]: id } };
}

export function resizePanel(layout: PanelLayout, key: SizeKey, value: number): PanelLayout {
  const [min, max] = sizeRange[key];
  return { ...layout, sizes: { ...layout.sizes, [key]: Math.max(min, Math.min(max, value)) } };
}
