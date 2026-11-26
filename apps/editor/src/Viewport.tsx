import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { Clock, Expand, Focus, Grid3X3, Magnet, Monitor, MonitorPlay, Move, MousePointer2, Pencil, RectangleHorizontal, RectangleVertical,
  Smartphone, SquareSlash, RotateCw, Ruler, ScanLine, Tablet, ZoomIn, ZoomOut } from 'lucide-react';
import { gridNudge, gridSteps, snapMove } from '@rewrite/render-pixi/grid';
import type { GuideLine, GuideTargets } from '@rewrite/render-pixi/guides';
import { hint, IconButton } from './chrome';
import { SceneRulers } from './SceneRulers';
import type { ViewportGrid } from './viewportGrid';
import { locale, t } from './i18n';
import { devices, orientations } from './config';
import { deviceLabels, orientationLabels, type PreviewProfile } from './Settings';
import { viewportZoom, type ObjectTransform, type SceneView, type TransformPatch } from './runtime';
import { findObject, type Scene, type SceneObject } from './scene';
import { boxBetween, toggleSelection } from './selection';
import { toolColors, type GizmoAxis, type Tool } from './viewportGizmo';
export type { Tool } from './viewportGizmo';

export const supportsSkew = (node?: SceneObject) => !!node && 'skew' in node;

type Point = { x: number; y: number };
type GestureBase = { pointer: number; view: SceneView; scene: Scene; tool: Tool; client: Point };
type Gesture = GestureBase & (
  { kind: 'single'; node: SceneObject; mode: Exclude<Tool, 'select'>; origin: Point; pivot: Point; axis: GizmoAxis; patch?: TransformPatch; targets?: GuideTargets } |
  { kind: 'group'; nodes: SceneObject[]; origin: Point; anchor: Point; patches?: ObjectTransform[] } |
  { kind: 'marquee'; origin: Point; to?: Point; initial: readonly string[] } |
  { kind: 'brush'; points: Point[] }
);

const zoomLabel = new Intl.NumberFormat(locale, { style: 'percent' });

const viewportModes = [
  { id: 'edit', label: 'viewportEdit', icon: Pencil },
  { id: 'live', label: 'viewportLive', icon: MonitorPlay },
] as const;
export type ViewportMode = typeof viewportModes[number]['id'];

export function ViewportTabs({ mode, select }: { mode: ViewportMode; select: (mode: ViewportMode) => void }) {
  const tabs = useRef<HTMLDivElement>(null);
  return <div className="viewport-tabs" ref={tabs} role="tablist" aria-label={t('viewportModes')}
    onKeyDown={event => {
      const key = event.key;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
      event.preventDefault();
      const next = key === 'Home' ? 'edit' : key === 'End' ? 'live' : mode === 'edit' ? 'live' : 'edit';
      select(next);
      tabs.current?.querySelector<HTMLElement>(`#viewport-tab-${next}`)?.focus();
    }}>
    {viewportModes.map(({ id, label, icon: Icon }) =>
      <button key={id} id={`viewport-tab-${id}`} className="viewport-tab" type="button" role="tab"
        aria-controls={`viewport-pane-${id}`} aria-selected={mode === id} tabIndex={mode === id ? 0 : -1}
        {...hint(t(label), t(`${label}Hint`))} onClick={() => select(id)}>
        <Icon size={14} aria-hidden="true" />{t(label)}
      </button>)}
  </div>;
}

type ProfileControls = { profile: PreviewProfile; onProfile: (profile: PreviewProfile) => void; disabled: boolean };

export function ViewportProfiles({ profile, onProfile, disabled }: ProfileControls) {
  const Icon = profile.device === 'mobile' ? Smartphone : profile.device === 'tablet' ? Tablet : Monitor;
  const OrientationIcon = profile.orientation === 'portrait' ? RectangleVertical : RectangleHorizontal;
  return <div className="viewport-profiles">
    <label className="viewport-profile" {...hint(t('viewportDevice'), t(deviceLabels[profile.device]))}>
      <Icon size={16} aria-hidden="true" />
      <select aria-label={t('viewportDevice')} value={profile.device} disabled={disabled} onChange={event => {
        const device = devices.find(device => device === event.currentTarget.value);
        if (device) onProfile({ ...profile, device });
      }}>
        {devices.filter(device => device !== 'common').map(device => <option key={device} value={device}>{t(deviceLabels[device])}</option>)}
      </select>
    </label>
    <label className="viewport-profile" {...hint(t('viewportOrientation'), t(orientationLabels[profile.orientation ?? 'landscape']))}>
      <OrientationIcon size={16} aria-hidden="true" />
      <select aria-label={t('viewportOrientation')} value={profile.orientation ?? 'landscape'} disabled={disabled} onChange={event => {
        const orientation = orientations.find(orientation => orientation === event.currentTarget.value);
        if (orientation) onProfile({ ...profile, orientation });
      }}>
        {orientations.map(orientation => <option key={orientation} value={orientation}>{t(orientationLabels[orientation])}</option>)}
      </select>
    </label>
  </div>;
}

function ViewportTools({ tool, setTool, disabled, grid, setGrid, skew, selected, zoom, changeZoom, resetZoom, frameSelection, profiles, viewMenu, clockRunning, toggleClock }: {
  tool: Tool; setTool: (tool: Tool) => void; disabled: boolean;
  grid: ViewportGrid; setGrid: (value: ViewportGrid) => void; skew: boolean; selected: boolean;
  zoom: number; changeZoom: (factor: number) => void; resetZoom: () => void; frameSelection: () => void;
  profiles: ProfileControls;
  viewMenu: ReactNode;
  clockRunning: boolean; toggleClock: () => void;
}) {
  const icons = { select: MousePointer2, move: Move, rotate: RotateCw, scale: Expand, skew: SquareSlash };
  const tools: Tool[] = ['select', 'move', 'rotate', 'scale'];
  if (skew) tools.push('skew');
  return <>
    <div className="viewport-transform" role="group" aria-label={t('sceneTools')}>
      {tools.map(name =>
        <IconButton key={name} icon={icons[name]} label={t(`${name}Tool`)} description={t(`${name}ToolHint`)}
          aria-pressed={name === tool} style={{ '--mode-color': toolColors[name] } as CSSProperties}
          disabled={disabled} onClick={() => setTool(name)} />,
      )}
      <IconButton icon={Focus} label={t('frameSelection')} description={t('frameSelectionHint')}
        disabled={disabled || !selected} onClick={frameSelection} />
    </div>
    <div className="viewport-alignment" role="group" aria-label={t('viewportAlignment')}>
      <IconButton icon={Ruler} label={t('sceneRulers')} description={t('sceneRulersHint')}
        aria-pressed={grid.rulers} onClick={() => setGrid({ ...grid, rulers: !grid.rulers })} />
      <IconButton icon={Grid3X3} label={t('sceneGrid')} description={t('sceneGridHint')}
        aria-pressed={grid.visible} onClick={() => setGrid({ ...grid, visible: !grid.visible })} />
      <IconButton icon={Magnet} label={t('gridSnap')} description={t('gridSnapHint')}
        aria-pressed={grid.snap} onClick={() => setGrid({ ...grid, snap: !grid.snap })} />
      <IconButton icon={ScanLine} label={t('smartGuides')} description={t('smartGuidesHint')}
        aria-pressed={grid.guides} onClick={() => setGrid({ ...grid, guides: !grid.guides })} />
      <select aria-label={t('gridStep')} value={grid.step} {...hint(t('gridStep'), t('gridStepHint'))}
        onChange={event => setGrid({ ...grid, step: Number(event.target.value) })}>
        {gridSteps.map(step => <option key={step} value={step}>{t('gridPixels', { step })}</option>)}
      </select>
      <div className="viewport-zoom" role="group" aria-label={t('viewportZoom')}>
        <IconButton icon={ZoomOut} label={t('zoomOut')} description={t('zoomOutHint')}
          disabled={disabled || zoom <= viewportZoom.min} onClick={() => changeZoom(1 / viewportZoom.step)} />
        <button type="button" className="viewport-zoom-value" aria-label={t('resetZoom')}
          {...hint(t('resetZoom'), t('resetZoomHint'))} disabled={disabled} onClick={resetZoom}>
          {zoomLabel.format(zoom)}
        </button>
        <IconButton icon={ZoomIn} label={t('zoomIn')} description={t('zoomInHint')}
          disabled={disabled || zoom >= viewportZoom.max} onClick={() => changeZoom(viewportZoom.step)} />
      </div>
      <ViewportProfiles {...profiles} />
      <IconButton icon={Clock} label={t('viewportEditClock')} description={t('viewportEditClockHint')}
        aria-pressed={clockRunning} disabled={disabled} onClick={toggleClock} />
      {viewMenu}
    </div>
  </>;
}

export function Viewport({ viewport, view, scene, ready, busy, tool, setTool, skew, select, transform, selected, movable, grid, setGrid, version, quickTools, recording, drop, profiles, viewMenu, paint, clockRunning, toggleClock }: {
  viewport: RefObject<HTMLDivElement | null>; view: RefObject<SceneView | null>; scene: Scene;
  ready: boolean; busy: boolean; tool: Tool; setTool: (tool: Tool) => void; skew: boolean;
  select: (ids: string[]) => void; selected: readonly string[]; movable: readonly SceneObject[];
  grid: ViewportGrid; setGrid: (value: ViewportGrid) => void; version: number; quickTools?: ReactNode;
  recording: () => boolean;
  profiles: ProfileControls;
  viewMenu: ReactNode;
  clockRunning: boolean; toggleClock: () => void;
  transform: (patches: readonly ObjectTransform[]) => void;
  drop: Pick<HTMLAttributes<HTMLDivElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'>;
  paint?: (points: Point[]) => void;
}) {
  const gesture = useRef<Gesture | null>(null);
  const quick = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState({ version, scale: 1 });
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number }>();
  const canNavigate = ready && !busy;
  const hasQuickTools = !!quickTools;
  useLayoutEffect(() => {
    const node = quick.current, runtime = view.current;
    if (node && runtime) return runtime.attachQuickTools(node);
  }, [hasQuickTools, version, view]);

  useEffect(() => {
    const host = viewport.current;
    if (!host || !canNavigate) return;
    const wheel = (event: WheelEvent) => {
      const runtime = view.current;
      if (!runtime || !event.deltaY || gesture.current) return;
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1);
      const scale = runtime.zoomAt(Math.exp(-pixels * 0.002), { x: event.clientX, y: event.clientY });
      setZoom({ version, scale });
    };
    host.addEventListener('wheel', wheel, { passive: false });
    return () => host.removeEventListener('wheel', wheel);
  }, [canNavigate, version, view, viewport]);

  function navigate(action: (runtime: SceneView) => number) {
    const runtime = view.current;
    if (runtime && canNavigate && !gesture.current) setZoom({ version, scale: action(runtime) });
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    const runtime = view.current;
    if (!ready || busy || !runtime || event.button !== 0 || gesture.current) return;
    const point = runtime.canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const overCanvas = event.target instanceof HTMLCanvasElement;
    if (paint && overCanvas) {
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { kind: 'brush', points: [point], pointer: event.pointerId, view: runtime, scene, tool,
        client: { x: event.clientX, y: event.clientY } };
      return;
    }
    const handle = overCanvas ? runtime.pickHandle(point, tool) : undefined;
    const id = handle?.id ?? (overCanvas ? runtime.pick(point) : null);
    event.currentTarget.focus({ preventScroll: true });
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const base = { pointer: event.pointerId, view: runtime, scene, tool, client: { x: event.clientX, y: event.clientY } };
    if (!id) {
      if (overCanvas && tool === 'select') {
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { ...base, kind: 'marquee', origin: point, initial: additive ? selected : [] };
      } else if (!additive) select([]);
      return;
    }
    if (additive && !handle) {
      select(toggleSelection(selected, id));
      return;
    }
    if (tool === 'move' && selected.length > 1 && selected.includes(id) && movable.length) {
      const nodes = recording() ? movable.map(node => runtime.timelineNode(node)) : movable;
      const leader = nodes.at(-1)!;
      const anchor = runtime.worldPosition(leader.id, leader.position);
      if (!anchor) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { ...base, kind: 'group', nodes: [...nodes], origin: point, anchor };
      return;
    }
    select([id]);
    if (tool === 'select' || (tool === 'move' && runtime.isLayoutManaged(id))) return;
    const authored = findObject(scene.objects, id);
    const node = authored && recording() ? runtime.timelineNode(authored) : authored;
    const origin = runtime.parentPoint(id, point);
    const pivot = runtime.pivotInParent(id);
    if (!node || !origin || !pivot || (tool === 'skew' && !supportsSkew(node))) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { ...base, kind: 'single', node, mode: tool, pivot,
      axis: handle?.axis ?? 'xy', origin,
      targets: tool === 'move' && grid.guides && !grid.snap && (!handle || handle.axis === 'xy') ? runtime.alignmentTargets(id) : undefined };
  }

  function move(event: PointerEvent<HTMLDivElement>, preview = true) {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId || drag.view !== view.current || busy) return;
    const point = drag.view.canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    if (drag.kind === 'brush') {
      const last = drag.points.at(-1)!;
      if (drag.points.length < 2048 && Math.hypot(point.x - last.x, point.y - last.y) >= 1) drag.points.push(point);
      return;
    }
    const distance = Math.hypot(event.clientX - drag.client.x, event.clientY - drag.client.y);
    if (drag.kind === 'marquee') {
      if (!drag.to && distance < 3) return;
      drag.to = point;
      const frame = event.currentTarget.parentElement?.getBoundingClientRect();
      if (preview && frame) setMarquee(boxBetween(
        { x: drag.client.x - frame.left, y: drag.client.y - frame.top },
        { x: event.clientX - frame.left, y: event.clientY - frame.top },
      ));
      return;
    }
    if (drag.kind === 'group') {
      if (!drag.patches && distance < 3) return;
      const desired = { x: drag.anchor.x + point.x - drag.origin.x, y: drag.anchor.y + point.y - drag.origin.y };
      const next = grid.snap ? snapMove(desired, 'xy', grid.step) : desired;
      const delta = { x: next.x - drag.anchor.x, y: next.y - drag.anchor.y };
      drag.patches = moveNodes(drag.view, drag.nodes, delta);
      if (preview) drag.view.preview(drag.patches);
      return;
    }
    if (!drag.patch && distance < 3) return;
    const local = drag.view.parentPoint(drag.node.id, point);
    if (!local) return;
    const { position, rotation, scale, skew } = drag.node;
    const dx = local.x - drag.origin.x;
    const dy = local.y - drag.origin.y;
    let lines: GuideLine[] = [];
    if (drag.mode === 'move') {
      let next = { x: position.x + (drag.axis === 'y' ? 0 : dx), y: position.y + (drag.axis === 'x' ? 0 : dy) };
      if (grid.snap) next = snapMove(next, drag.axis, grid.step);
      else if (grid.guides && drag.targets && !event.altKey) {
        const result = drag.view.alignPosition(drag.node.id, next, drag.targets);
        next = result.position;
        lines = result.lines;
      }
      drag.patch = { position: { x: rounded(next.x), y: rounded(next.y) } };
    } else if (drag.mode === 'skew') {
      const angle = rotation * Math.PI / 180;
      const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
      const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
      drag.patch = { skew: {
        x: drag.axis === 'y' ? skew.x : rounded(skew.x - Math.atan2(localX, 90) * 180 / Math.PI),
        y: drag.axis === 'x' ? skew.y : rounded(skew.y + Math.atan2(localY, 90) * 180 / Math.PI),
      } };
    } else {
      const from = { x: drag.origin.x - drag.pivot.x, y: drag.origin.y - drag.pivot.y };
      const to = { x: local.x - drag.pivot.x, y: local.y - drag.pivot.y };
      const startRadius = Math.hypot(from.x, from.y);
      if (drag.mode === 'rotate') {
        const angle = Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x);
        const delta = startRadius < 4 ? dx : Math.atan2(Math.sin(angle), Math.cos(angle)) * 180 / Math.PI;
        const value = rotation + delta;
        drag.patch = { rotation: event.shiftKey ? Math.round(value / 15) * 15 : rounded(value) };
      } else {
        const ratio = startRadius < 4 ? 1 + (dx - dy) / 100 : Math.hypot(to.x, to.y) / startRadius;
        const factor = Math.min(100, Math.max(0.01, ratio));
        drag.patch = { scale: { x: rounded(scale.x * factor), y: rounded(scale.y * factor) } };
      }
    }
    if (preview) drag.view.preview([{ id: drag.node.id, patch: drag.patch }], lines);
  }

  function finish(pointer: number, commit: boolean) {
    const drag = gesture.current;
    if (!drag || drag.pointer !== pointer) return;
    gesture.current = null;
    if (drag.view !== view.current) return;
    if (drag.kind === 'brush') {
      if (commit && !busy) paint?.(drag.points);
      return;
    }
    if (drag.kind === 'marquee') {
      setMarquee(undefined);
      if (commit && !busy) select([...new Set([...drag.initial, ...(drag.to ? drag.view.pickInBox(drag.origin, drag.to) : [])])]);
      return;
    }
    drag.view.clearPreview();
    if (!commit || busy) return;
    if (drag.kind === 'group') {
      const patches = drag.patches?.filter(({ id, patch }) => {
        const node = drag.nodes.find(node => node.id === id);
        return node && changed(node, patch);
      });
      if (patches?.length) transform(patches);
    } else if (drag.patch && changed(drag.node, drag.patch)) transform([{ id: drag.node.id, patch: drag.patch }]);
  }

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      const drag = gesture.current;
      if (event.key === 'Escape' && drag) {
        gesture.current = null;
        setMarquee(undefined);
        const node = viewport.current;
        if (node?.hasPointerCapture(drag.pointer)) node.releasePointerCapture(drag.pointer);
        if (drag.view === view.current) drag.view.clearPreview();
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [view, viewport]);

  useEffect(() => {
    const drag = gesture.current;
    if (!drag) return;
    if (!busy && drag.scene === scene && drag.tool === tool && drag.view === view.current) return;
    gesture.current = null;
    setMarquee(undefined);
    if (drag.view === view.current) drag.view.clearPreview();
    const node = viewport.current;
    if (node?.hasPointerCapture(drag.pointer)) node.releasePointerCapture(drag.pointer);
  }, [scene, busy, tool, view, viewport]);

  function nudge(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!ready || busy || gesture.current || tool !== 'move' || event.metaKey || event.ctrlKey) return;
    const axis = event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? 'x' :
      event.key === 'ArrowUp' || event.key === 'ArrowDown' ? 'y' : null;
    const runtime = view.current;
    const nodes = runtime && recording() ? movable.map(node => runtime.timelineNode(node)) : movable;
    const node = nodes.at(-1);
    if (!axis || !node) return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const amount = event.shiftKey ? 10 : 1;
    if (selected.length > 1 && view.current) {
      const world = view.current.worldPosition(node.id, node.position);
      if (!world) return;
      const delta = grid.snap ? gridNudge(world[axis], direction, grid.step, amount) - world[axis] : direction * amount;
      transform(moveNodes(view.current, nodes, { x: axis === 'x' ? delta : 0, y: axis === 'y' ? delta : 0 }));
      return;
    }
    const value = node.position[axis];
    const next = grid.snap ? gridNudge(value, direction, grid.step, amount) : value + direction * amount;
    transform([{ id: node.id, patch: { position: { ...node.position, [axis]: next } } }]);
  }

  return <div className="stage-area" {...drop}>
    <ViewportTools tool={tool} setTool={setTool} disabled={!canNavigate} grid={grid} setGrid={setGrid} skew={skew} profiles={profiles} viewMenu={viewMenu}
      clockRunning={clockRunning} toggleClock={toggleClock}
      selected={!!selected.length} zoom={zoom.version === version ? zoom.scale : 1}
      changeZoom={factor => navigate(runtime => runtime.zoomAt(factor))}
      resetZoom={() => navigate(runtime => runtime.resetViewport())} frameSelection={() => navigate(runtime => runtime.frameSelection())} />
    <div className="canvas" ref={viewport} data-tool={paint ? 'brush' : tool} tabIndex={0} aria-label={t('sceneViewport')} onKeyDown={nudge}
      onPointerDown={start} onPointerMove={event => move(event)} onPointerUp={event => {
        move(event, false);
        finish(event.pointerId, true);
      }}
      onPointerCancel={event => finish(event.pointerId, false)} onLostPointerCapture={event => finish(event.pointerId, false)} />
    {marquee && <div className="viewport-marquee" aria-hidden="true"
      style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
    {hasQuickTools && <div ref={quick} className="viewport-quick-anchor">{quickTools}</div>}
    {ready && grid.rulers && <SceneRulers viewport={viewport} view={view} version={version} />}
    {!ready && <p className="stage-message">{t(busy ? 'starting' : 'canvasUnavailable')}</p>}
  </div>;
}

const rounded = (value: number) => Math.round(value * 1000) / 1000;

function moveNodes(view: SceneView, nodes: readonly SceneObject[], delta: Point): ObjectTransform[] {
  return nodes.flatMap(node => {
    if (!delta.x && !delta.y) return [{ id: node.id, patch: { position: node.position } }];
    const next = view.offsetPosition(node.id, node.position, delta);
    if (!next) return [];
    return [{ id: node.id, patch: { position: { x: rounded(next.x), y: rounded(next.y) } } }];
  });
}

function changed(node: SceneObject, { position, rotation, scale, skew }: TransformPatch) {
  return (position && (position.x !== node.position.x || position.y !== node.position.y)) ||
    (rotation !== undefined && rotation !== node.rotation) ||
    (scale && (scale.x !== node.scale.x || scale.y !== node.scale.y)) ||
    (skew && (skew.x !== node.skew.x || skew.y !== node.skew.y));
}
