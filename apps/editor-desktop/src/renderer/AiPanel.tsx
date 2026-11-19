import {useSyncExternalStore, type ComponentType} from 'react';

export type AiTab = 'assistant' | 'create' | 'jobs' | 'files';
const tabs: readonly AiTab[] = ['assistant', 'create', 'jobs', 'files'];

/**
 * The AI panel: one place for the assistant, generation and jobs, over LocalHub or this Mac's ComfyUI and LM Studio
 * directly. The connection card decides which; the tabs show that connection's views.
 */
export function createAiPanel(options: {
 text(key: string): string;
 /** True when requests go through LocalHub (re-renders when the connection or pairing changes). */
 useHub(): boolean;
 Connection: ComponentType; ChatTools: ComponentType;
 Assistant: ComponentType;
 Create: {hub: ComponentType; direct: ComponentType};
 Jobs: {hub: ComponentType; direct: ComponentType};
 /** The hub's Files (direct connection: a note that they live on LocalHub). */
 Files: {hub: ComponentType; direct: ComponentType};
 /** Running LocalHub jobs, shown on the Jobs tab. */
 useActiveJobs(): number;
}) {
 let tab: AiTab = (() => { try { const v = localStorage.getItem('rewrite:ai-tab'); return tabs.includes(v as AiTab) ? v as AiTab : 'assistant'; } catch { return 'assistant'; } })();
 const listeners = new Set<() => void>();
 const setTab = (next: AiTab) => { if (tab === next) return; tab = next; try { localStorage.setItem('rewrite:ai-tab', next); } catch { /* per-viewer convenience only */ } for (const fn of listeners) fn(); };
 const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
 return Object.assign(function AiPanel() {
  const current = useSyncExternalStore(subscribe, () => tab), hub = options.useHub(), active = options.useActiveJobs(), t = options.text;
  const pick = (views: {hub: ComponentType; direct: ComponentType}) => hub ? views.hub : views.direct;
  const View = current === 'assistant' ? options.Assistant : current === 'create' ? pick(options.Create) : current === 'jobs' ? pick(options.Jobs) : pick(options.Files);
  return <div className="panel-body ai-panel" data-testid="ai-panel" data-tab={current} data-connection={hub ? 'localhub' : 'direct'}>
   <options.Connection/>
   <div className="ai-tabs" role="tablist" aria-label={t('panel.ai')}>{tabs.map(id => <button key={id} role="tab" id={`ai-tab-${id}`} aria-selected={current === id} aria-controls="ai-tabpanel" data-tab={id} onClick={() => setTab(id)}>{t(`ai.tab.${id}`)}{id === 'jobs' && active > 0 && <span className="ai-badge" aria-hidden="true" title={t('comfy.jobs.active').replace('{n}', String(active))}>{active}</span>}</button>)}</div>
   <div className="ai-tabpanel" role="tabpanel" id="ai-tabpanel" aria-labelledby={`ai-tab-${current}`}>
    {current === 'assistant' && hub && <options.ChatTools/>}
    <View/>
   </div>
  </div>;
 }, {setTab, tab: () => tab});
}
