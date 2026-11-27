import { useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type DragEvent, type ReactNode, type SetStateAction } from 'react';
import { Activity, AudioLines, Bot, Box, Boxes, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clapperboard, Code2, Frame, Gamepad2, Globe, Layers3, LayoutPanelTop, Lightbulb, MessageSquare, Network, PackageOpen, RotateCcw, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { DockChrome, hint, IconButton } from './chrome';
import { t, type MessageKey } from './i18n';
import {
  activeTab, defaultLayout, dockIds, dockPanel, maximizePanel, minimizePanel, openTabs, panelIds, resizePanel, setPanelOpen, sizeRange,
  toggleDockMinimized,
  type DockId, type PanelId, type PanelLayout, type SizeKey,
} from './panelLayout';

const panelInfo = {
  hierarchy: [Layers3, 'hierarchy'],
  scene: [Frame, 'scene'],
  inspector: [SlidersHorizontal, 'inspector'],
  assets: [PackageOpen, 'assets'],
  bundles: [Boxes, 'assetBundles'],
  timeline: [Clapperboard, 'timeline'],
  scenes: [Layers3, 'scenes'],
  prefabs: [Boxes, 'prefabs'],
  input: [Gamepad2, 'inputMap'],
  globals: [Globe, 'globalsPanel'],
  scripts: [Code2, 'scriptsPanel'],
  physics: [Box, 'physicsPanel'],
  lighting: [Lightbulb, 'lightingPanel'],
  network: [Network, 'networkPanel'],
  content: [MessageSquare, 'gameContentPanel'],
  audioStudio: [AudioLines, 'audioStudio'],
  shaders: [Sparkles, 'shaderPanel'],
  ai: [Bot, 'aiStudio'],
  diagnostics: [Activity, 'diagnostics'],
} as const;
export const panelLabel = (panel: PanelId) => t(panelInfo[panel][1]);
const dockNames: Record<DockId, MessageKey> = {
  left: 'dockLeft', center: 'dockCenter', right: 'dockRight', bottom: 'dockBottom', bottomRight: 'dockBottomRight',
};
const panelMime = 'application/x-olive-panel';
type ChangeLayout = Dispatch<SetStateAction<PanelLayout>>;

export function PanelsMenu({ layout, change }: { layout: PanelLayout; change: ChangeLayout }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  return <div className="panels-menu" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
      toggle.current?.focus();
    }
  }}>
    <IconButton ref={toggle} icon={LayoutPanelTop} label={t('panelsMenu')} description={t('panelsMenuHint')}
      aria-expanded={open} onClick={() => setOpen(value => !value)} />
    {open && <div className="panel-menu-popup" role="group" aria-label={t('panelsMenu')}>
      {panelIds.map(id => {
        const [Icon] = panelInfo[id];
        const checked = layout.panels.some(item => item.id === id && item.open);
        return <label key={id} onMouseDown={event => {
          // Keep focus inside the popup until the label activates its checkbox.
          if (event.button === 0 && !(event.target instanceof HTMLInputElement)) event.preventDefault();
        }}>
          <input type="checkbox" checked={checked} onChange={event => {
            const open = event.target.checked;
            change(current => setPanelOpen(current, id, open));
          }} />
          <Icon size={14} aria-hidden="true" /><span>{panelLabel(id)}</span>
        </label>;
      })}
      <button type="button" onClick={() => { change(defaultLayout()); setOpen(false); toggle.current?.focus(); }}>
        <RotateCcw size={14} aria-hidden="true" />{t('resetPanelLayout')}
      </button>
    </div>}
  </div>;
}

function Splitter({ side, docks, label, value, change, workbench, style, resizable = true }: {
  side: SizeKey; label: string; value: number; change: ChangeLayout;
  workbench: { current: HTMLDivElement | null }; style: CSSProperties;
  docks: readonly DockId[]; resizable?: boolean;
}) {
  const start = useRef<{ pointer: number; coordinate: number; value: number; length: number; dragged: boolean } | null>(null);
  const horizontal = side === 'bottom';
  const [min, max] = sizeRange[side];
  const delta = (movement: number) => side === 'left' ? movement : -movement;
  const toggle = () => change(current => toggleDockMinimized(current, docks));
  return <div className="dock-splitter" style={style} role="separator" tabIndex={0}
    aria-label={label} aria-orientation={horizontal ? 'horizontal' : 'vertical'}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)}
    {...hint(label, t('toggleDockHint'))} onDoubleClick={toggle}
    onPointerDown={event => {
      if (!resizable || event.button !== 0 || !workbench.current) return;
      const rect = workbench.current.getBoundingClientRect();
      start.current = { pointer: event.pointerId, coordinate: horizontal ? event.clientY : event.clientX,
        length: horizontal ? rect.height : rect.width, value, dragged: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const origin = start.current;
      if (origin?.pointer !== event.pointerId || !origin.length) return;
      const coordinate = horizontal ? event.clientY : event.clientX;
      const movement = coordinate - origin.coordinate;
      if (!origin.dragged && Math.abs(movement) < 3) return;
      origin.dragged = true;
      change(current => resizePanel(current, side, origin.value + delta(movement * 100 / origin.length)));
    }}
    onLostPointerCapture={() => { start.current = null; }}
    onKeyDown={event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!event.repeat) toggle();
        return;
      }
      const keys = horizontal ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
      const index = keys.indexOf(event.key);
      if (index < 0 || !resizable) return;
      event.preventDefault();
      change(current => resizePanel(current, side, current.sizes[side] + delta(index === 0 ? -4 : 4)));
    }} />;
}

function DockRail({ style, label, tabs, vertical, children }: {
  style: CSSProperties; label: string; tabs: boolean; vertical: boolean; children: ReactNode;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ overflow: false, before: false, after: false });

  useLayoutEffect(() => {
    const outer = rail.current!, scroller = viewport.current!, content = strip.current!;
    const measure = () => {
      const size = vertical ? content.offsetHeight : content.offsetWidth;
      const position = vertical ? scroller.scrollTop : scroller.scrollLeft;
      const available = vertical ? scroller.clientHeight : scroller.clientWidth;
      const overflow = size > (vertical ? outer.clientHeight : outer.clientWidth);
      const before = overflow && position > 1;
      const after = overflow && size > available + position + 1;
      setEdges(previous => previous.overflow === overflow && previous.before === before && previous.after === after ?
        previous : { overflow, before, after });
    };
    const observer = new ResizeObserver(measure);
    for (const element of [outer, scroller, content]) observer.observe(element);
    scroller.addEventListener('scroll', measure, { passive: true });
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || event.deltaX || scroller.scrollWidth <= scroller.clientWidth) return;
      event.preventDefault();
      scroller.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientWidth : 1);
    };
    if (!vertical) scroller.addEventListener('wheel', wheel, { passive: false });
    measure();
    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', measure);
      scroller.removeEventListener('wheel', wheel);
    };
  }, [vertical]);

  const scroll = (direction: number) => {
    const element = viewport.current!;
    const length = vertical ? element.clientHeight : element.clientWidth;
    element.scrollBy({ [vertical ? 'top' : 'left']: direction * Math.max(60, length - 24), behavior: 'smooth' });
  };

  return <div className="dock-rail" style={style} ref={rail} data-vertical={vertical || undefined} data-overflow={edges.overflow || undefined}>
    {edges.before && <div className="dock-rail-before"><IconButton icon={vertical ? ChevronUp : ChevronLeft}
      label={t(vertical ? 'scrollDockUp' : 'scrollDockLeft', { dock: label })}
      onClick={() => scroll(-1)} /></div>}
    <div ref={viewport} className="dock-rail-viewport">
      <div ref={strip} className="dock-rail-strip" role={tabs ? 'tablist' : 'group'} aria-label={label}>{children}</div>
    </div>
    {edges.after && <div className="dock-rail-after"><IconButton icon={vertical ? ChevronDown : ChevronRight}
      label={t(vertical ? 'scrollDockDown' : 'scrollDockRight', { dock: label })}
      onClick={() => scroll(1)} /></div>}
  </div>;
}

export function DockWorkspace({ layout, change, panels }: {
  layout: PanelLayout; change: ChangeLayout; panels: Record<PanelId, ReactNode>;
}) {
  const workspace = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<PanelId>();
  const [target, setTarget] = useState<DockId>();
  const open = layout.panels.filter(item => item.open);
  const occupied = (dock: DockId) => open.some(item => item.dock === dock);
  const left = occupied('left'), center = occupied('center'), right = occupied('right');
  const bottom = occupied('bottom'), bottomRight = occupied('bottomRight');
  const upper = left || center || right;
  const lower = bottom || bottomRight;
  const expanded = (dock: DockId) => openTabs(layout, dock).length > 0;
  const expandedUpper = expanded('left') || expanded('center') || expanded('right');
  const expandedLower = expanded('bottom') || expanded('bottomRight');
  const upperCompact = upper && !expandedUpper;
  const lowerCompact = lower && !expandedLower;
  const rowSplit = expandedUpper && expandedLower;
  const rowDivider = upper && lower;
  const maximized = layout.maximized;
  const leftSplit = left && center;
  const upperRightSplit = right && (left || center);
  const lowerRightSplit = bottom && bottomRight;
  const verticalRails = new Set<DockId>();
  if (left && !expanded('left') && expandedUpper) verticalRails.add('left');
  if (upperRightSplit && !expanded('right') && expandedUpper) verticalRails.add('right');
  if (lowerRightSplit && !expanded('bottomRight') && expandedLower) verticalRails.add('bottomRight');
  const sizes = layout.sizes;
  const divider = 'var(--dock-divider-width)';
  const width = (dock: DockId, expandedWidth: string) => verticalRails.has(dock) ? 'var(--dock-rail-height)' : expandedWidth;
  const leftWidth = width('left', `max(128px, ${sizes.left}%)`);
  const rightWidth = width('right', `max(155px, ${sizes.right}%)`);
  const lowerRightWidth = width('bottomRight', `max(155px, ${sizes.right}%)`);
  const beside = (width: string) => `calc(${width} + ${divider})`;
  const rightFillsRow = !center && verticalRails.has('left');
  const cell = (gridRow: number, placement: CSSProperties = {}): CSSProperties => ({ gridRow, gridColumn: 1, ...placement });
  const atEdge = (width: string, justifySelf: 'start' | 'end'): CSSProperties => ({ width, justifySelf });
  const placements: Record<DockId, CSSProperties> = {
    left: cell(1, leftSplit || rightFillsRow ? atEdge(leftWidth, 'start') :
      { marginInlineEnd: right ? beside(rightWidth) : undefined }),
    center: cell(1, { marginInlineStart: left ? beside(leftWidth) : undefined,
      marginInlineEnd: right ? beside(rightWidth) : undefined }),
    right: cell(1, rightFillsRow ? { marginInlineStart: beside(leftWidth) } :
      upperRightSplit ? atEdge(rightWidth, 'end') : {}),
    bottom: cell(3, { marginInlineEnd: lowerRightSplit ? beside(lowerRightWidth) : undefined }),
    bottomRight: cell(3, lowerRightSplit ? atEdge(lowerRightWidth, 'end') : {}),
  };

  function resetDrag() { setDragging(undefined); setTarget(undefined); }

  function dragHooks(dock: DockId, id?: PanelId, reorder = false) {
    return {
      onDragStart: (event: DragEvent) => {
        if (!id) return;
        event.dataTransfer.setData(panelMime, id);
        event.dataTransfer.effectAllowed = 'move';
        setDragging(id);
      },
      onDragEnd: resetDrag,
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes(panelMime)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setTarget(dock);
      },
      onDrop: (event: DragEvent) => {
        const source = panelIds.find(item => item === event.dataTransfer.getData(panelMime));
        if (!source) return;
        event.preventDefault();
        event.stopPropagation();
        resetDrag();
        if (source !== id) change(current => dockPanel(current, source, dock, reorder ? id : undefined));
      },
    };
  }

  const rows = [
    upperCompact ? 'var(--dock-rail-height)' : upper ? 'minmax(0, 1fr)' : '0px',
    rowDivider ? divider : '0px',
    lowerCompact ? 'var(--dock-rail-height)' : expandedLower ? rowSplit ? `${sizes.bottom}%` : 'minmax(0, 1fr)' : '0px',
  ].join(' ');
  const close = (id: PanelId) => change(current => setPanelOpen(current, id, false));

  return <div className="workbench" ref={workspace} data-maximized={maximized || undefined}
    style={{ gridTemplateRows: maximized ? 'minmax(0, 1fr)' : rows }}>
    {!maximized && dockIds.map(dock => {
      const items = open.filter(item => item.dock === dock);
      if (items.length < 2 && !items.some(item => item.minimized)) return null;
      const selected = activeTab(layout, dock);
      const vertical = verticalRails.has(dock);
      return <DockRail key={dock} style={placements[dock]} label={t(dockNames[dock])} tabs={!!selected} vertical={vertical}>
        {items.map(({ id, minimized }, index) => {
          const [Icon] = panelInfo[id];
          const label = panelLabel(id);
          return <div className="dock-rail-item" data-minimized={minimized || undefined} key={id}>
            <button id={minimized ? `dock-restore-${id}` : `dock-tab-${id}`} type="button"
              role={minimized ? undefined : 'tab'} aria-selected={minimized ? undefined : selected === id}
              tabIndex={minimized || selected === id ? 0 : -1} aria-controls={`dock-content-${id}`} draggable
              {...hint(label, minimized ? t('restorePanel', { name: label }) : t('movePanelHint'))} {...dragHooks(dock, id, true)}
              onClick={() => {
                change(current => setPanelOpen(current, id, true));
                if (minimized) requestAnimationFrame(() => (document.getElementById(`dock-tab-${id}`) ??
                  workspace.current?.querySelector<HTMLElement>(`#dock-content-${id} h2`))?.focus());
              }}
              onKeyDown={event => {
                const offset = event.key === (vertical ? 'ArrowUp' : 'ArrowLeft') ? -1 :
                  event.key === (vertical ? 'ArrowDown' : 'ArrowRight') ? 1 : 0;
                if (!offset) return;
                event.preventDefault();
                const next = items[(index + offset + items.length) % items.length];
                if (!next.minimized) change(current => setPanelOpen(current, next.id, true));
                requestAnimationFrame(() => document.getElementById(`dock-${next.minimized ? 'restore' : 'tab'}-${next.id}`)?.focus());
              }}><Icon size={14} aria-hidden="true" /><span>{label}</span></button>
            {minimized && <IconButton icon={X} label={t('closePanel', { name: label })} onClick={() => close(id)} />}
          </div>;
        })}
      </DockRail>;
    })}
    {panelIds.map(id => {
      const item = layout.panels.find(item => item.id === id)!;
      const isMaximized = maximized === id;
      const visible = isMaximized || activeTab(layout, item.dock) === id;
      const label = panelLabel(id);
      const group = open.filter(panel => panel.dock === item.dock);
      const hasRail = !maximized && (group.length > 1 || group.some(panel => panel.minimized));
      return <div key={id} className="dock-pane" style={isMaximized ? { gridArea: '1 / 1' } : placements[item.dock]}
        data-dock={item.dock} data-rail={hasRail || undefined}
        data-dock-target={target === item.dock || undefined} hidden={!visible}>
        <div className="dock-content" id={`dock-content-${id}`} role={hasRail && !item.minimized ? 'tabpanel' : undefined}
          aria-labelledby={hasRail && !item.minimized ? `dock-tab-${id}` : undefined}>
          <DockChrome.Provider value={{
            maximize: () => change(current => maximizePanel(current, id)),
            minimize: () => {
              change(current => minimizePanel(current, id));
              if (!isMaximized) requestAnimationFrame(() => document.getElementById(`dock-restore-${id}`)?.focus());
            },
            maximized: isMaximized,
            maximizeLabel: t('maximizePanel', { name: label }),
            minimizeLabel: t(isMaximized ? 'restorePanel' : 'minimizePanel', { name: label }),
            close: () => close(id),
            closeLabel: t('closePanel', { name: label }),
            titleDrag: dragHooks(item.dock, id),
          }}>{panels[id]}</DockChrome.Provider>
        </div>
      </div>;
    })}
    {!maximized && leftSplit && <Splitter side="left" docks={['left']} label={t('resizeLeftDock')} value={sizes.left} change={change} workbench={workspace}
      resizable={!verticalRails.has('left')} style={cell(1, { ...atEdge(divider, 'start'), marginInlineStart: leftWidth })} />}
    {!maximized && upperRightSplit && <Splitter side="right" docks={['right']} label={t('resizeRightDock')} value={sizes.right}
      change={change} workbench={workspace} resizable={!rightFillsRow && !verticalRails.has('right')}
      style={cell(1, rightFillsRow ? { ...atEdge(divider, 'start'), marginInlineStart: leftWidth } :
        { ...atEdge(divider, 'end'), marginInlineEnd: rightWidth })} />}
    {!maximized && lowerRightSplit && <Splitter side="right" docks={['bottomRight']} label={t('resizeLowerRightDock')} value={sizes.right}
      change={change} workbench={workspace} resizable={!verticalRails.has('bottomRight')}
      style={cell(3, { ...atEdge(divider, 'end'), marginInlineEnd: lowerRightWidth })} />}
    {!maximized && rowDivider && <Splitter side="bottom" docks={['bottom', 'bottomRight']} resizable={rowSplit}
      label={t(open.some(item => item.id === 'assets' && item.dock === 'bottom') ? 'resizeAssets' : 'resizeLowerDock')}
      value={sizes.bottom} change={change} workbench={workspace} style={cell(2)} />}
    {!maximized && dragging && <div className="dock-destinations" aria-hidden="true">
      {dockIds.map(dock => <div key={dock} data-dock={dock} data-active={target === dock} {...dragHooks(dock)}>
        {t(dockNames[dock])}
      </div>)}
    </div>}
    {!upper && !lower && <p className="dock-empty">{t('noPanels')}</p>}
  </div>;
}
