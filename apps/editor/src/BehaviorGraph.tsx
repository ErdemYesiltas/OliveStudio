import { useState } from 'react';
import { GraphControls } from '@rewrite/production-tools/forms';
import { GraphSchema } from '@rewrite/production-tools/contracts';
import { statePaths, type Graph } from '@rewrite/production-tools/models';
import { t } from './i18n';

type Props = {
  graphs: Graph[];
  save: (graph: Graph) => void;
  editable: boolean;
  attach?: (scriptId: string) => void;
  report: (error: unknown) => void;
};

function Statechart({graph}: {graph: Graph}) {
  const paths = statePaths(graph);
  const y = (path: string) => 30 + paths.indexOf(path) * 42;
  return <svg className="behavior-statechart" role="img" aria-label={t('behaviorGraph')} viewBox={`0 0 520 ${paths.length * 42 + 20}`}>
    {graph.edges.map((edge, index) => {
      const from = y(edge.from), to = y(edge.to);
      const elbow = 210 + index % 5 * 8;
      return <g key={edge.id}>
        <path d={from === to ? `M180 ${from - 8} H${elbow} V${to + 8} H180` :
          `M180 ${from} H${elbow} V${to} H180`} fill="none" stroke="currentColor" />
        <text x={elbow + 5} y={from - 5}>{edge.afterMs === undefined ? edge.event : `${edge.afterMs} ms`} → {edge.to}</text>
      </g>;
    })}
    {paths.map(path => <g key={path}>
      <rect x="12" y={y(path) - 14} width="168" height="28" rx="4" fill="var(--panel)" stroke="currentColor" />
      <text x="20" y={y(path) + 4}>{graph.initial === path ? '● ' : ''}{path}</text>
    </g>)}
  </svg>;
}

export function BehaviorGraph({graphs, save, editable, attach, report}: Props) {
  const [id, choose] = useState('');
  const [state, setState] = useState('');
  const graph = graphs.find(graph => graph.id === id) ?? graphs[0];
  const act = (apply: () => unknown) => {
    if (!editable) return;
    try { apply(); } catch (error) { report(error); }
  };
  return <section className="behavior-graph" aria-label={t('behaviorGraph')}>
    <div className="panel-actions">
      <select aria-label={t('behaviorGraph')} disabled={!graphs.length} value={graph?.id ?? ''} onChange={event => choose(event.target.value)}>
        {!graphs.length && <option value="">{t('behaviorGraph')}</option>}
        {graphs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <button disabled={!editable} onClick={() => act(() => {
        const id = crypto.randomUUID();
        save(GraphSchema.parse({ id, name: t('behaviorGraphNew'), initial: 'idle',
          states: ['idle', 'active'].map(key => ({ key })), edges: [{ id: crypto.randomUUID(), from: 'idle', to: 'active', event: 'click' }] }));
        choose(id);
      })}>{t('behaviorGraphNew')}</button>
      <button disabled={!editable || !attach || !graph?.scriptId} onClick={() => act(() => attach?.(graph!.scriptId!))}>{t('behaviorGraphAttach')}</button>
    </div>
    {graph && <>
      <Statechart graph={graph} />
      <fieldset disabled={!editable}>
        <div className="panel-actions">
          <input aria-label={t('behaviorGraphStateName')} placeholder={t('behaviorGraphStateName')} value={state} onChange={event => setState(event.target.value)} />
          <button disabled={!state.trim()} onClick={() => act(() => {
            save({ ...graph, states: [...graph.states, { key: state.trim(), kind: 'atomic', entry: [], children: [] }] });
            setState('');
          })}>{t('behaviorGraphAddState')}</button>
        </div>
        <GraphControls key={graph.id} graph={graph} save={save} act={act} />
      </fieldset>
    </>}
  </section>;
}
