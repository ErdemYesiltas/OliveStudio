import {useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent} from 'react';
import type {Entity, SceneService} from '@rewrite/scene';
import {GraphSchema, graphPorts, graphType, type Graph, type GraphNode} from './graph';
import {ActionValueEditor, ConditionEditor, newCondition} from './views';
import type {ActionDefinition, InteractionCatalog, TriggerDefinition} from './index';

const W = 230, PORT = 14, TOP = 50;
/** Where a node's input (left) and an output (right) sit on the canvas. */
const inputAt = (n: GraphNode) => ({x: n.x, y: n.y + TOP});
const outputAt = (n: GraphNode, port: string) => ({x: n.x + W, y: n.y + TOP + graphPorts[n.kind].indexOf(port) * 22});
const curve = (a: {x: number; y: number}, b: {x: number; y: number}) => { const dx = Math.max(40, Math.abs(b.x - a.x) / 2); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };

/**
 * Logic graph editor for the selected object: drag nodes by their header, drag from an output dot to a node's input
 * dot (or pick in "Connect to") to link, remove links at their × and nodes with their ×. While Preview runs, nodes
 * that just ran glow. Every change is one undo step.
 */
export function createGraphPanel(bridge: ({scene: SceneService} | {
 useEntity(): Entity | undefined;
 addGraph(id: string): void;
 editGraph(id: string, change: (graph: Graph) => void, label: string): void;
}) & {catalog(): InteractionCatalog; triggers(): readonly TriggerDefinition[]; actions(): readonly ActionDefinition[]; useEditable(): boolean; useSelection?(): string | null; text(key: string): string; report(e: unknown): void; useActivity(componentId: string): {nodes: Record<string, number>; now: number} | undefined}) {
 const t = bridge.text;
 const adapter = 'scene' in bridge ? {
  useEntity() {
   useSyncExternalStore(bridge.scene.document.subscribe, () => bridge.scene.document.version);
   const id = bridge.useSelection?.();
   return bridge.scene.document.current.entities.find(e => e.id === id);
  },
  addGraph: (id: string) => bridge.scene.addComponent(id, graphType),
  editGraph: (id: string, fn: (graph: Graph) => void, label: string) => bridge.scene.document.transact(label, d => {
   const c = d.entities.find(e => e.id === id)?.components.find(c => c.type === graphType && c.version === 1);
   if (!c) return;
   const next = GraphSchema.parse(c.data);
   fn(next);
   c.data = GraphSchema.parse(next) as never;
  }),
 } : bridge;
 return function GraphPanel() {
  const editable = bridge.useEditable(), entity = adapter.useEntity();
  const catalog = bridge.catalog(), triggers = bridge.triggers(), actions = bridge.actions();
  const component = entity?.components.find(c => c.type === graphType && c.version === 1), activity = bridge.useActivity(component?.id ?? '');
  const [moving, setMoving] = useState<{id: string; x: number; y: number} | null>(null), [wire, setWire] = useState<{from: string; port: string; x: number; y: number} | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  if (!entity) return <div className="panel-body graph-panel" data-testid="graph-panel"><p className="panel-empty">{t('graph.selectObject')}</p></div>;
  if (!component) return <div className="panel-body graph-panel" data-testid="graph-panel"><p className="panel-empty">{t('graph.none').replace('{name}', entity.name)}</p><button disabled={!editable} onClick={() => { try { adapter.addGraph(entity.id); } catch (e) { bridge.report(e); } }}>{t('graph.add')}</button></div>;
  const graph = GraphSchema.parse(component.data);
  const edit = (label: string, fn: (g: Graph) => void) => {
   try { adapter.editGraph(entity.id, fn, label); } catch (e) { bridge.report(e); }
  };
  const index = new Map(graph.nodes.map((n, i) => [n.id, i + 1])), label = (n: GraphNode) => `${t(`graph.kind.${n.kind}`)} ${index.get(n.id)}`;
  const position = (n: GraphNode) => moving?.id === n.id ? {...n, x: moving.x, y: moving.y} : n;
  const options = (items: readonly {id: string; name: string}[], value: string) => <>{!items.some(i => i.id === value) && <option value={value}>{value ? t('interaction.missing') : t('interaction.choose')}</option>}{items.map(i => <option value={i.id} key={i.id}>{i.name}</option>)}</>;
  const add = (kind: GraphNode['kind']) => edit('Add graph node', g => {
   const box = canvas.current, count = g.nodes.length, x = Math.round((box?.scrollLeft ?? 0) + 30 + (count % 4) * (W + 90)), y = Math.round((box?.scrollTop ?? 0) + 30 + (Math.floor(count / 4) % 3) * 230), id = crypto.randomUUID();
   if (kind === 'event') { const d = triggers[0], ref = d.references(catalog)[0]; g.nodes.push({id, kind, x, y, trigger: {type: d.type, sourceId: ref?.id ?? '', event: ref?.events?.[0]?.id ?? ''}}); }
   if (kind === 'action') { const d = actions[0]; g.nodes.push({id, kind, x, y, action: {id: crypto.randomUUID(), type: d.type, targetId: d.references(catalog)[0]?.id ?? '', value: true}}); }
   if (kind === 'branch') g.nodes.push({id, kind, x, y, condition: newCondition(catalog.globals![0])});
   if (kind === 'delay') g.nodes.push({id, kind, x, y, seconds: 1});
  });
  const link = (from: string, port: string, to: string) => edit('Link graph nodes', g => { if (from !== to && !g.links.some(l => l.from === from && l.port === port && l.to === to)) g.links.push({id: crypto.randomUUID(), from, port, to}); });
  const drag = (n: GraphNode) => (e: ReactPointerEvent) => {
   if (!editable || e.button !== 0 || (e.target as HTMLElement).closest('button,select,input')) return;
   e.preventDefault(); const start = {x: e.clientX, y: e.clientY, nx: n.x, ny: n.y}; e.currentTarget.setPointerCapture(e.pointerId);
   const at = (m: PointerEvent) => ({id: n.id, x: Math.max(0, Math.round(start.nx + m.clientX - start.x)), y: Math.max(0, Math.round(start.ny + m.clientY - start.y))});
   const move = (m: PointerEvent) => setMoving(at(m)), up = (m: PointerEvent) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); const end = at(m); setMoving(null); if (end.x !== n.x || end.y !== n.y) edit('Move graph node', g => { const x = g.nodes.find(z => z.id === n.id)!; x.x = end.x; x.y = end.y; }); };
   window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const startWire = (n: GraphNode, port: string) => (e: ReactPointerEvent) => {
   if (!editable || e.button !== 0) return; e.stopPropagation(); e.preventDefault();
   const box = canvas.current!.getBoundingClientRect(), local = (m: {clientX: number; clientY: number}) => ({x: m.clientX - box.left + canvas.current!.scrollLeft, y: m.clientY - box.top + canvas.current!.scrollTop});
   setWire({from: n.id, port, ...local(e)});
   const move = (m: PointerEvent) => setWire({from: n.id, port, ...local(m)}), up = (m: PointerEvent) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setWire(null); const target = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>('[data-graph-input]'); if (target?.dataset.graphInput) link(n.id, port, target.dataset.graphInput); };
   window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const recent = (id: string) => activity && activity.nodes[id] !== undefined && activity.now - activity.nodes[id] < .6;
  const width = Math.max(1200, ...graph.nodes.map(n => n.x + W + 80)), height = Math.max(700, ...graph.nodes.map(n => n.y + 260));
  return <div className="panel-body graph-panel" data-testid="graph-panel">
   <div className="graph-toolbar" role="toolbar" aria-label={t('graph.toolbar')}>
    <strong>{entity.name}</strong>
    {(['event', 'action', 'branch', 'delay'] as const).map(kind => <button key={kind} disabled={!editable || (kind === 'branch' && !catalog.globals?.length)} title={kind === 'branch' && !catalog.globals?.length ? t('graph.needsGlobal') : undefined} onClick={() => add(kind)}>{`+ ${t(`graph.kind.${kind}`)}`}</button>)}
    <small>{t('graph.hint')}</small>
   </div>
   <div className="graph-canvas" ref={canvas} data-testid="graph-canvas">
    <div className="graph-space" style={{width, height}}>
     <svg className="graph-links" width={width} height={height} aria-hidden="true">
      {graph.links.map(l => { const a = graph.nodes.find(n => n.id === l.from), b = graph.nodes.find(n => n.id === l.to); return a && b ? <path key={l.id} d={curve(outputAt(position(a), l.port), inputAt(position(b)))} className={`graph-link port-${l.port}`}/> : null; })}
      {wire && (() => { const a = graph.nodes.find(n => n.id === wire.from); return a ? <path d={curve(outputAt(position(a), wire.port), wire)} className="graph-link pending"/> : null; })()}
     </svg>
     {graph.links.map(l => { const a = graph.nodes.find(n => n.id === l.from), b = graph.nodes.find(n => n.id === l.to); if (!a || !b) return null; const p = outputAt(position(a), l.port), q = inputAt(position(b)); return <button key={l.id} className="graph-unlink" style={{left: (p.x + q.x) / 2 - 8, top: (p.y + q.y) / 2 - 8}} disabled={!editable} aria-label={`${t('graph.unlink')} ${label(a)} ${l.port} → ${label(b)}`} onClick={() => edit('Remove graph link', g => { g.links = g.links.filter(x => x.id !== l.id); })}>×</button>; })}
     {graph.nodes.map(raw => { const n = position(raw), name = label(n); return <div key={n.id} role="group" aria-label={name} className={`graph-node kind-${n.kind}${recent(n.id) ? ' ran' : ''}`} data-node={index.get(n.id)} style={{left: n.x, top: n.y, width: W}}>
      {n.kind !== 'event' && <span className="graph-port in" data-graph-input={n.id} title={t('graph.input')} style={{top: TOP - PORT / 2}}/>}
      <header onPointerDown={drag(raw)}><span>{name}</span><button disabled={!editable} aria-label={`${t('graph.remove')} ${name}`} onClick={() => edit('Remove graph node', g => { g.nodes = g.nodes.filter(x => x.id !== n.id); g.links = g.links.filter(l => l.from !== n.id && l.to !== n.id); })}>×</button></header>
      {graphPorts[n.kind].map((port, i) => <span key={port} className={`graph-port out port-${port}`} style={{top: TOP + i * 22 - PORT / 2}} title={t(`graph.port.${port}`)} onPointerDown={startWire(raw, port)}><small>{t(`graph.port.${port}`)}</small></span>)}
      <div className="graph-body" style={{paddingRight: 46}}>
       <NodeEditor node={n} name={name}/>
       {graphPorts[n.kind].map(port => <label key={port} className="field"><span>{t('graph.connect').replace('{port}', t(`graph.port.${port}`))}</span><select aria-label={`${name} ${t('graph.connect').replace('{port}', port)}`} value="" disabled={!editable} onChange={e => { if (e.target.value) link(n.id, port, e.target.value); }}><option value="">{t('graph.choose')}</option>{graph.nodes.filter(o => o.id !== n.id && o.kind !== 'event').map(o => <option key={o.id} value={o.id}>{label(o)}</option>)}</select></label>)}
      </div>
     </div>; })}
    </div>
    {!graph.nodes.length && <p className="panel-empty graph-empty">{t('graph.empty')}</p>}
   </div>
  </div>;
  function NodeEditor({node, name}: {node: GraphNode; name: string}) {
   const at = (fn: (n: GraphNode) => void) => edit('Edit graph node', g => fn(g.nodes.find(x => x.id === node.id)!));
   if (node.kind === 'event') { const d = triggers.find(x => x.type === node.trigger.type), refs = d?.references(catalog) ?? [], events = refs.find(r => r.id === node.trigger.sourceId)?.events; return <>
    <label className="field"><span>{t('interaction.trigger')}</span><select aria-label={`${name} ${t('interaction.trigger')}`} disabled={!editable} value={node.trigger.type} onChange={e => at(n => { const x = triggers.find(z => z.type === e.target.value)!, ref = x.references(catalog)[0]; (n as Extract<GraphNode, {kind: 'event'}>).trigger = {type: x.type, sourceId: ref?.id ?? '', event: ref?.events?.[0]?.id ?? ''}; })}>{triggers.map(x => <option key={x.type} value={x.type}>{t(x.titleKey)}</option>)}</select></label>
    <label className="field"><span>{t('interaction.source')}</span><select aria-label={`${name} ${t('interaction.source')}`} disabled={!editable} value={node.trigger.sourceId} onChange={e => at(n => { const x = n as Extract<GraphNode, {kind: 'event'}>; x.trigger.sourceId = e.target.value; x.trigger.event = refs.find(r => r.id === e.target.value)?.events?.[0]?.id ?? ''; })}>{options(refs, node.trigger.sourceId)}</select></label>
    {events && <label className="field"><span>{t('interaction.event')}</span><select aria-label={`${name} ${t('interaction.event')}`} disabled={!editable} value={node.trigger.event} onChange={e => at(n => { (n as Extract<GraphNode, {kind: 'event'}>).trigger.event = e.target.value; })}>{options(events, node.trigger.event)}</select></label>}
   </>; }
   if (node.kind === 'action') { const d = actions.find(x => x.type === node.action.type); return <>
    <label className="field"><span>{t('interaction.action')}</span><select aria-label={`${name} ${t('interaction.action')}`} disabled={!editable} value={node.action.type} onChange={e => at(n => { const x = actions.find(z => z.type === e.target.value)!, a = (n as Extract<GraphNode, {kind: 'action'}>).action; Object.assign(a, {type: x.type, targetId: x.references(catalog)[0]?.id ?? ''}); delete a.to; delete a.amount; delete a.x; delete a.y; })}>{actions.map(x => <option key={x.type} value={x.type}>{t(x.titleKey)}</option>)}</select></label>
    <label className="field"><span>{t('interaction.target')}</span><select aria-label={`${name} ${t('interaction.target')}`} disabled={!editable} value={node.action.targetId} onChange={e => at(n => { (n as Extract<GraphNode, {kind: 'action'}>).action.targetId = e.target.value; })}>{options(d?.references(catalog) ?? [], node.action.targetId)}</select></label>
    <ActionValueEditor action={node.action} globals={catalog.globals ?? []} entities={catalog.entities} label={name} disabled={!editable} t={t} edit={fn => at(n => fn((n as Extract<GraphNode, {kind: 'action'}>).action))}/>
   </>; }
   if (node.kind === 'branch') return <ConditionEditor condition={node.condition} globals={catalog.globals ?? []} label={name} disabled={!editable} missing={t('interaction.missing')} edit={fn => at(n => fn((n as Extract<GraphNode, {kind: 'branch'}>).condition))}/>;
   if (node.kind !== 'delay') return null;
   return <label className="field"><span>{t('graph.seconds')}</span><input type="number" min={0} max={3600} step="any" aria-label={`${name} ${t('graph.seconds')}`} disabled={!editable} defaultValue={node.seconds} key={node.seconds} onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== node.seconds) at(n => { (n as Extract<GraphNode, {kind: 'delay'}>).seconds = Math.max(0, Math.min(3600, v)); }); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/></label>;
  }
 };
}
/** Inspector summary of a Logic graph component, with a button to open the editor panel. */
export function GraphSummary({entity, component, text, open}: {entity: Entity; component: Entity['components'][number]; text(key: string): string; open(): void}) {
 const g = GraphSchema.safeParse(component.data), nodes = g.success ? g.data.nodes.length : 0, links = g.success ? g.data.links.length : 0;
 return <div className="graph-summary" data-testid="graph-summary"><p className="panel-empty">{text('graph.summary').replace('{nodes}', String(nodes)).replace('{links}', String(links)).replace('{name}', entity.name)}</p><button onClick={open}>{text('graph.open')}</button></div>;
}
