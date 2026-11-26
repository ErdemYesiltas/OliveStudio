import { Activity, Code2, GripVertical, Terminal } from 'lucide-react';
import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
import type { Behaviour, ScriptLibrary } from '@rewrite/scripts/contracts';
import { createBehaviorViews } from '@rewrite/behavior/views';
import type { Behavior } from '@rewrite/behavior/contracts';
import { xstateBehaviorProvider } from '@rewrite/behavior-xstate/editor';
import { useEffect, useState } from 'react';
import type { Graph } from '@rewrite/production-tools/models';
import { BehaviorGraph } from './BehaviorGraph';
import { createGraphPanel } from '@rewrite/interactions/graph-views';
import { ProfileRecorder } from '@rewrite/profiler';
import { createProfilerPanel } from '@rewrite/profiler/views';
import { emptyGraph, type Graph as LogicGraph, type InteractionCatalog } from '@rewrite/interactions';
import { logicTools } from './sceneLogic';
import type { GameContent } from './gameContent';
import { createScriptViews, ScriptConsole } from '@rewrite/scripts/views';
import { t, type MessageKey } from './i18n';
import { hint, IconButton, PanelHeader } from './chrome';
import { dropOne, valueSource } from './valueDrag';

type ScriptPanelState = {
  library: ScriptLibrary;
  editable: boolean;
  scene: { id: string; name: string };
  selected?: { id: string; name: string; scripted: boolean; behavior?: Behavior };
  entities: readonly { id: string; name: string }[];
  globals: readonly { name: string; type: string; initial?: unknown }[];
  change: (mutate: (library: ScriptLibrary) => void) => void;
  setBehaviour: (id: string, value: Behaviour) => void;
  setBehavior: (id: string, value: Behavior) => void;
  select: (id: string) => void;
  graphs: Graph[];
  saveGraph: (graph: Graph) => void;
  catalog: () => InteractionCatalog;
  content?: GameContent;
  editLogic: (id: string, edit: (graph: LogicGraph) => void) => void;
  logicActivity: (id: string) => { nodes: Record<string, number>; now: number } | undefined;
  open: () => void;
  report: (error: unknown) => void;
};
const ScriptsContext = createContext<ScriptPanelState | null>(null);
export const previewProfileRecorder = new ProfileRecorder();
previewProfileRecorder.paused = true;
const Profiler = createProfilerPanel({
  text: key => t(key as MessageKey),
  recorder: previewProfileRecorder,
  report: error => active.report(error),
});

export function DiagnosticsPanel() {
  const [mode, setMode] = useState<'console' | 'profiler'>('console');
  return <section className="panel" aria-label={t('diagnostics')}>
    <PanelHeader icon={Activity} label={t('diagnostics')} description={t('diagnosticsHint')}>
      <div className="panel-tools">
        <IconButton icon={Terminal} label={t('scripts.console')} aria-pressed={mode === 'console'} onClick={() => setMode('console')} />
        <IconButton icon={Activity} label={t('profilerPanel')} aria-pressed={mode === 'profiler'} onClick={() => setMode('profiler')} />
      </div>
    </PanelHeader>
    {mode === 'profiler' ? <Profiler /> : <div className="panel-body"><ScriptConsole text={key => t(key as MessageKey)} standalone /></div>}
  </section>;
}

function useScripts() { return useContext(ScriptsContext)!; }
let active: ScriptPanelState;
export function ScriptsProvider({ state, children }: { state: ScriptPanelState; children: ReactNode }) {
  useLayoutEffect(() => { active = state; }, [state]);
  return <ScriptsContext.Provider value={state}>{children}</ScriptsContext.Provider>;
}


const { ScriptsPanel: ScriptEditor, ScriptInspector, ParamsEditor, createScript, openScript } = createScriptViews({
  text: key => t(key as MessageKey),
  useEditable: () => useScripts().editable,
  useLibrary: () => useScripts().library,
  useSelection: () => useScripts().selected ?? null,
  useEntities: () => useScripts().entities,
  useScene: () => useScripts().scene,
  useGlobals: () => useScripts().globals,
  library: () => active.library,
  change: (_label, mutate) => active.change(mutate),
  attach: scriptId => { if (active.selected) active.setBehaviour(active.selected.id, { scriptId, params: {}, refs: {} }); },
  setBehaviour: (id, _component, value) => active.setBehaviour(id, value),
  open: () => active.open(),
  report: error => active.report(error),
  templates: ['blank', 'topdown', 'follow', 'hover', 'clicker'],
  references: {
    source: script => <span className="value-drag-handle" {...hint(t('dragScript', { name: script.name }))}
      {...valueSource('script', script.id)}><GripVertical size={16} aria-hidden="true" /></span>,
    target: dropOne,
  },
});
export const revealScript = openScript;

const { BehaviorInspector, BehaviorPanel } = createBehaviorViews(xstateBehaviorProvider, {
  text: key => t(key as MessageKey),
  report: error => active.report(error),
  useEditable: () => useScripts().editable,
  useLibrary: () => useScripts().library,
  setBehavior: (id, _component, value) => active.setBehavior(id, value),
  ParamsEditor,
  openScript: id => { active.open(); openScript(id); },
  createScript,
  useEngine: () => {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      let mounted = true;
      void xstateBehaviorProvider.prepare?.().then(() => { if (mounted) setReady(true); }, error => { if (mounted) active.report(error); });
      return () => { mounted = false; };
    }, []);
    return ready;
  },
  select: id => active.select(id),
});

const LogicEditor = createGraphPanel({
  useEntity: () => {
    const context = useScripts();
    return context.catalog().entities.find(entity => entity.id === context.selected?.id);
  },
  catalog: () => useScripts().catalog(),
  useEditable: () => useScripts().editable,
  addGraph: id => active.editLogic(id, () => emptyGraph()),
  editGraph: (id, edit) => active.editLogic(id, edit),
  triggers: () => logicTools(useScripts().content).triggers,
  actions: () => logicTools(useScripts().content).actions,
  text: key => t(key as MessageKey),
  report: error => active.report(error),
  useActivity: id => {
    const { logicActivity } = useScripts();
    const [, refresh] = useState(0);
    useEffect(() => {
      if (!id) return;
      const timer = setInterval(() => refresh(value => value + 1), 180);
      return () => clearInterval(timer);
    }, [id]);
    return id ? logicActivity(id) : undefined;
  },
});

export function ScriptsPanel({ tests }: { tests: ReactNode }) {
  const context = useScripts();
  const [logicOpen, setLogicOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [testsOpen, setTestsOpen] = useState(false);
  return <section className="panel" aria-label={t('scriptsPanel')}>
    <PanelHeader icon={Code2} label={t('scriptsPanel')} description={t('scriptsPanelHint')} />
    <div className="scripts-workspace">
      <ScriptEditor />
      <details className="behavior-tools"><summary {...hint(t('behaviorTools'), t('behaviorToolsHint'))}>{t('behaviorTools')}</summary>
        <BehaviorGraph graphs={context.graphs} save={context.saveGraph} editable={context.editable}
          attach={context.selected ? scriptId => context.setBehavior(context.selected!.id, { scriptId, params: {}, refs: {} }) : undefined}
          report={context.report} />
        <BehaviorPanel />
      </details>
      <details className="behavior-tools" onToggle={event => setLogicOpen(event.currentTarget.open)}>
        <summary>{t('logicGraph')}</summary>
        {logicOpen && <LogicEditor key={context.selected?.id} />}
      </details>
      <details className="behavior-tools" onToggle={event => setProfileOpen(event.currentTarget.open)}>
        <summary>{t('profilerPanel')}</summary>
        {profileOpen && <Profiler />}
      </details>
      <details className="behavior-tools" onToggle={event => setTestsOpen(event.currentTarget.open)}>
        <summary>{t('testStudio')}</summary>
        {testsOpen && tests}
      </details>
    </div>
  </section>;
}

export function ObjectScript({ id, behaviour }: { id: string; behaviour?: Behaviour }) {
  return <details data-inspector-section="script">
    <summary><Code2 size={15} aria-hidden="true" />{t('scripts.script')}</summary>
    <ScriptInspector entityId={id} component={{ id, data: behaviour ?? { scriptId: '', params: {}, refs: {} } }} />
  </details>;
}

export function ObjectBehavior({ id, behavior }: { id: string; behavior?: Behavior }) {
  return <details data-inspector-section="behavior">
    <summary><Code2 size={15} aria-hidden="true" />{t('component.behavior')}</summary>
    <BehaviorInspector entityId={id} component={{ id, data: behavior ?? { scriptId: '', params: {}, refs: {} } }} />
  </details>;
}
