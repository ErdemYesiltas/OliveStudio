import { defaultNetworkPlayer, ensureMovementActions, MultiplayerSettingsSchema, type NetStatus, type ServerStatus, type MultiplayerSettings } from '@rewrite/multiplayer/contracts';
import { networkPlan } from './networkModel';
import { MultiplayerPanel } from './MultiplayerPanel';
import { ExportDialog } from './ExportDialog';
import { LightingPanel } from './LightingPanel';
import { defaultLighting } from './sceneLighting';
import { playCinematic } from './playCinematic';
import { GameContentPanel } from './GameContentPanel';
import { AiStudio } from './AiStudio';
import { applyAssistantEdits } from './assistantEdits';
import { emptySkills } from '@rewrite/ai-skills';
import { GameplayLab, type Character } from './GameplayLab';
import { TestStudio } from './TestStudio';
import { ProjectHistoryPanel } from './ProjectHistory';
import { ProjectSearch } from './ProjectSearch';
import { Brushes } from './Brushes';
import { BrushesSchema } from '@rewrite/production-tools/contracts';
import { scatter, terrainStroke } from '@rewrite/production-tools/models';
import { InputMapSchema } from '@rewrite/input';
import { AudioStudioPanel } from './AudioStudioPanel';
import { ShaderLibraryPanel } from './ShaderLibraryPanel';
import { emptyShaderLibrary, ShaderLibrarySchema, type ShaderLibrary } from '@rewrite/render-pixi/shaders';
import { defaultMixer, MixerSchema, type Mixer } from '@rewrite/audio/contracts';
import { contentSchema, emptyContent, type GameContent } from './gameContent';
import { cinematicsSchema, pruneCinematics, type ClipData } from './cinematics';
import { recordTransforms, type RecordTarget } from './timelineRecording';
import { defaultPhysicsSettings } from '@rewrite/physics/contracts';
import { PhysicsPanel } from './PhysicsPanel';
import type { PhysicsStatus } from './scenePhysics';
import { flushScriptEdits } from '@rewrite/scripts/views';
import { compileScript } from '@rewrite/scripts/compile';
import { BehaviorSchema, type Behavior } from '@rewrite/behavior/contracts';
import { GraphsSchema } from '@rewrite/production-tools/contracts';
import { compileGraph, type Graph } from '@rewrite/production-tools/models';
import { ScriptLibrarySchema, type ScriptLibrary } from '@rewrite/scripts/contracts';
import { DiagnosticsPanel, previewProfileRecorder, revealScript, ScriptsPanel, ScriptsProvider } from './ScriptsPanel';
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { emptyGraph, GraphSchema as LogicGraphSchema, localizeText, type Graph as LogicGraph, type Globals } from '@rewrite/interactions';
import { logicCatalog } from './sceneLogic';
import { Download,
  Camera, CircleHelp, Columns2, Ellipsis, FilePlus2, Home, FolderOpen, Frame, Grid2X2, Layers3, Pause, Play, Redo2, Rows2,
  Save, Search, Settings2, SlidersHorizontal, Square, StepForward, Trash2, Undo2, X,
} from 'lucide-react';
import { type Asset, type AssetBundle, importedAssetsSchema, projectBundle, readManifest } from './assets';
import type { AudioStatus, AudioTransport, SourceStatus } from './audio';
import { hint, IconButton, PanelHeader, Tooltips } from './chrome';
import { locale, objectTypeKey, t } from './i18n';
import { addLibraryEntries, assignObjectAsset, changeLibrary, createCatalog, extension, type CatalogEntry, type LibraryAction } from './assetLibrary';
import { sliceAsset } from './sliceAsset';
import { valueDrop } from './valueDrag';
import { AssetsPanel, type AssetsPanelHandle } from './AssetsPanel';
import { AssetBundles } from './AssetBundles';
import { DockWorkspace, PanelsMenu } from './DockWorkspace';
import { activeTab, defaultLayout, panelIds, readPanelLayout, savePanelLayout, setPanelOpen } from './panelLayout';
import { AssetInspector } from './AssetInspector';
import { Inspector, MultiInspector } from './Inspector';
import { Hub, showHubAtStartup } from './Hub';
import { Settings, editSetting, type PreviewProfile } from './Settings';
import { Hierarchy, objectIcons } from './Hierarchy';
import { SceneView, type EditView, type ObjectTransform } from './runtime';
import { supportsSkew, Viewport, ViewportProfiles, ViewportTabs, type Tool, type ViewportMode } from './Viewport';
import { ViewportQuickTools } from './ViewportQuickTools';
import { EditViewMenu, PlayMenu } from './ViewportMenus';
import { TimelinePanel } from './TimelinePanel';
import { InputPanel } from './InputPanel';
import type { InputValues } from './input';
import { GlobalsPanel } from './GlobalsPanel';
import { createGameSave, readGameSlot, writeGameSlot, type GameSlot, type GlobalValues } from './globals';
import { ScenesPanel } from './ScenesPanel';
import { PrefabsPanel } from './PrefabsPanel';
import { applyPrefab, capturePrefab, capturable, dependsOn, instantiatePrefab, prefabLimit, prefabOwner, revertPrefab, revisePrefab, unpackPrefab, type Prefab } from './prefabs';
import { timelineSchema } from './timeline';
import { defaultFlexContainer, isLayoutChild } from './layout';
import {
  cameraInScene, canDeleteScene, duplicateScene, followSceneLink, followProjectSceneLink, newSceneCamera, parseProject, popScene, projectFromScene,
  readScene, sceneRecord, serializeProject, writeScene,
  type Project, type SceneLink, type ScenePlayback,
} from './project';
import { alignedOffsets, changeSelection, selectionRoots, selectionTree, type Alignment, type Point } from './selection';
import { loadViewportGrid, saveViewportGrid } from './viewportGrid';
import {
  changeObject, configRegistry, configSchema, createObject, emptyScene, findObject, moveObject, sampleScene, validationMessage,
  type Scene, type SceneConfig, type SceneObject,
} from './scene';
import './style.css';

const packRoot = new URL(import.meta.env.BASE_URL + 'assetpack/', window.location.href).href;
declare const __ASSETPACK_REBUILD__: boolean;

const development = __ASSETPACK_REBUILD__;
const quickObjectTypes = ['Container', 'Sprite', 'Text'] as const;
const additionalObjectTypes = ['Graphics', 'BitmapText', 'TilingSprite', 'NineSliceSprite', 'Tilemap',
  'MeshPlane', 'MeshRope', 'Particles', 'AnimatedSprite', 'Spine', 'AudioSource', 'AudioListener', 'Light2D', 'UIWidget'] as const;

function objectFromAsset(asset: Asset, position?: { x: number; y: number }) {
  const label = asset.name ?? asset.alias;
  const placement = position ? { position: { x: Math.round(position.x), y: Math.round(position.y) } } : {};
  const anchor = { x: 0.5, y: 0.5 };
  if (asset.kind === 'image') return { ...createObject('Sprite'), label, ...placement, anchor, texture: asset.alias };
  if (asset.kind === 'sheet') return { ...createObject('AnimatedSprite'), label, ...placement, anchor, asset: asset.alias };
  if (asset.kind === 'spine') return { ...createObject('Spine'), label, ...placement, asset: asset.alias };
  return { ...createObject('AudioSource'), label, ...placement, asset: asset.alias };
}

function hasAudioSource(nodes: readonly SceneObject[]): boolean {
  return nodes.some(node => node.type === 'AudioSource' || (node.type === 'Container' && hasAudioSource(node.children)));
}

function isActive(nodes: readonly SceneObject[], id: string): boolean {
  return nodes.some(node => node.visible && node.alpha > 0 &&
    (node.id === id || (node.type === 'Container' && isActive(node.children, id))));
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(t('packRequestError', { status: response.status }));
  return response.json();
}

function useAssetPack() {
  const [bundles, setBundles] = useState<AssetBundle[]>([]);
  const [packing, setPacking] = useState(true);
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async (rebuild = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    setPacking(true);
    setError(undefined);
    try {
      let base = packRoot;
      let buildFailure: string | undefined;
      if (development) {
        const status = await fetchJson(packRoot + (rebuild ? 'rebuild' : 'status'), {
          signal, ...(rebuild ? { method: 'POST', headers: { 'x-olive-rebuild': '1' } } : {}),
        }) as { generation: string | null; error: string | null };
        if (!status.generation) throw new Error(status.error ?? t('packNotReady'));
        base += status.generation + '/';
        buildFailure = status.error ?? undefined;
      }
      const next = readManifest(await fetchJson(base + 'manifest.json', { signal }), base);
      if (!signal.aborted) {
        setBundles(next);
        setLoaded(true);
        setError(buildFailure);
      }
    } catch (failure) {
      if (!signal.aborted) setError(validationMessage(failure));
    } finally {
      if (!signal.aborted) setPacking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => request.current?.abort();
  }, [refresh]);

  return { bundles, packing, error, loaded, refresh };
}

type Snapshot = { project: Project; sceneId: string; selection: string[] };
type History = { active: Snapshot; past: Snapshot[]; future: Snapshot[] };
const sampleProject = projectFromScene(sampleScene, 'Olive Grove');
function Editor() {
  const [history, setHistory] = useState<History>({
    active: { project: sampleProject, sceneId: sampleProject.startup, selection: ['sample-sprite'] }, past: [], future: [],
  });
  const { project, sceneId, selection: selectedIds } = history.active;
  const [prefabEdit, setPrefabEdit] = useState<{ source: Prefab; history: History }>();
  const [activePrefabId, setActivePrefabId] = useState<string>();
  const [brushId, setBrushId] = useState('');
  const [brushErase, setBrushErase] = useState(false);
  const activeBrush = project.brushes?.items.find(item => item.id === brushId);
  const activePrefab = project.prefabs.find(prefab => prefab.id === activePrefabId) ?? project.prefabs[0];
  const scene = useMemo(() => readScene(project, sceneId), [project, sceneId]);
  const [playback, setPlayback] = useState<ScenePlayback>();
  const [viewportMode, selectViewport] = useState<ViewportMode>('edit');
  const [liveSnapshot, setLiveSnapshot] = useState<{ project: Project; assets: Map<string, Asset> }>();
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewPaused, setPreviewPaused] = useState(false);
  const [liveRevision, setLiveRevision] = useState(0);
  const [gameSpeed, setGameSpeed] = useState(1);
  const launching = useRef<symbol | undefined>(undefined);
  const recording = useRef<RecordTarget | undefined>(undefined);
  const setRecording = useCallback((value?: RecordTarget) => { recording.current = value; }, []);
  const previewing = !!playback;
  const liveActive = viewportMode === 'live';
  const gameProject = liveSnapshot?.project ?? project;
  const network = useMemo(() => networkPlan(project), [project]);
  const [networkServer, setNetworkServer] = useState<ServerStatus>();
  const [networkClient, setNetworkClient] = useState<NetStatus>();
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkError, setNetworkError] = useState('');
  const [inputValues, setInputValues] = useState<InputValues>({});
  const [globalValues, setGlobalValues] = useState<GlobalValues>({});
  const [slotMessage, setSlotMessage] = useState('');
  const [gameLanguage, setGameLanguage] = useState('');
  const physicsSettings = project.physics ?? defaultPhysicsSettings;
  const [lightingPreview, setLightingPreview] = useState(true);
  const [physicsStatus, setPhysicsStatus] = useState<PhysicsStatus>();
  const [physicsDebug, setPhysicsDebug] = useState(() => {
    try { return localStorage.getItem('olivestudio:colliders') === 'true'; }
    catch { return false; }
  });
  const displayedObjects = useMemo(() => playback ?
    [playback.main, ...playback.added].flatMap(id => sceneRecord(gameProject, id).objects) : [], [playback, gameProject]);
  const gameScene = useMemo(() => playback ? {
    id: playback.main, cameraId: cameraInScene(sceneRecord(gameProject, playback.main).objects)?.id,
    transition: playback.transition,
    transitionLayer: playback.transitionLayer && {
      exit: playback.transitionLayer.exit,
      rootIds: sceneRecord(gameProject, playback.transitionLayer.id).objects.map(node => node.id),
    },
  } : undefined, [playback, gameProject]);
  const referencedObjects = useMemo(() => [...project.scenes.flatMap(record => record.objects), ...project.prefabs.map(prefab => prefab.root)],
    [project.scenes, project.prefabs]);
  const selectedId = selectedIds.at(-1) ?? null;
  const [moreObjects, setMoreObjects] = useState(false);
  const [inspection, setInspection] = useState<string[]>([]);
  const [liveSelection, setLiveSelection] = useState<string[]>();
  const inspectorSections = useRef(new Map<string, string>());
  function select(selection: string[]) {
    setInspection([]);
    if (playback && liveActive) {
      liveView.current?.stopEffectPreview();
      setLiveSelection(selection);
      return;
    }
    setHistory(current => ({ ...current, active: { ...current.active, selection } }));
  }
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [fileName, setFileName] = useState('olive-grove.json');
  const [savedProject, setSavedProject] = useState(sampleProject);
  const [recovered, setRecovered] = useState(false);
  const recoveryId = useRef<string | undefined>(undefined);
  const recoveryProject = useRef<Project | undefined>(undefined);
  const [autoRecovery, setAutoRecovery] = useState(() => {
    try { return localStorage.getItem('olive.recovery.auto') !== 'off'; } catch { return true; }
  });
  const configDocument = useRef({ token: undefined as string | undefined, draft: '' });
  const queuedConfig = useRef(project.config);
  const appliedConfig = useRef(project.config);
  const configWrites = useRef<Promise<void>>(Promise.resolve());
  const [diskConfig, setDiskConfig] = useState<SceneConfig>();
  const dirty = recovered || project !== savedProject && (diskConfig !== project.config ||
    (Object.keys({ ...savedProject, ...project }) as (keyof Project)[])
      .some(key => key !== 'config' && project[key] !== savedProject[key]));
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [fileError, setFileError] = useState<{ title: string; detail: string }>();
  const checkpoint = useEffectEvent(async () => {
    const recovery = window.oliveFiles?.recovery;
    if (!recovery || busy || prefabEdit || recoveryProject.current === project) return;
    recoveryId.current ??= crypto.randomUUID();
    recoveryProject.current = project;
    try { await recovery.write(recoveryId.current, fileName, serializeProject(project)); }
    catch (error) {
      if (project === recoveryProject.current) recoveryProject.current = undefined;
      console.warn('Could not create recovery checkpoint:', error);
    }
  });
  useEffect(() => {
    if (!window.oliveFiles?.recovery || !autoRecovery || !dirty || !ready) return;
    const timer = window.setInterval(() => void checkpoint(), 5000);
    return () => window.clearInterval(timer);
  }, [autoRecovery, dirty, ready]);
  const [audio, setAudio] = useState<AudioStatus>({ state: 'idle' });
  const [sourceStatuses, setSourceStatuses] = useState<ReadonlyMap<string, SourceStatus>>(new Map());
  const [audioTransport, setAudioTransport] = useState<AudioTransport>('stopped');
  const [textureErrors, setTextureErrors] = useState<ReadonlySet<string>>(new Set());
  const [assetSession, setAssetSession] = useState(0);
  const [hubOpen, setHubOpen] = useState(showHubAtStartup);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [contentTabRequest, requestContentTab] = useState<{ tab: 'dialogues' | 'achievements' | 'data' }>();
  const [previewProfile, setPreviewProfile] = useState<PreviewProfile>({ device: 'desktop', orientation: 'landscape' });
  const [editView, setEditView] = useState<EditView>('normal');
  const [editClockRunning, setEditClockRunning] = useState(false);
  const [settingsProfile, setSettingsProfile] = useState(previewProfile);
  const resolvedConfig = useMemo(() => configRegistry.forPreview(scene.config, previewProfile.device, previewProfile.orientation),
    [scene.config, previewProfile]);
  const authoredSize = scene.config.renderer;
  const [panelLayout, setPanelLayout] = useState(readPanelLayout);
  useEffect(() => { savePanelLayout(panelLayout); }, [panelLayout]);
  const scenePanel = panelLayout.panels.find(panel => panel.id === 'scene')!;
  const [bundleSelection, setBundleSelection] = useState<string[]>([]);
  const [bundleFocus, setBundleFocus] = useState(0);
  const assetsPanel = useRef<AssetsPanelHandle>(null);
  const [requestedTool, setTool] = useState<Tool>('select');
  const [viewportGrid, setViewportGrid] = useState(loadViewportGrid);
  const pack = useAssetPack();
  const imports = useMemo(() => projectBundle(scene.assets), [scene.assets]);
  const catalog = useMemo(() => createCatalog(pack.bundles, imports, scene.assetLibrary,
    [t('projectAssets'), t('builtInAssets')]), [pack.bundles, imports, scene.assetLibrary]);
  const assets = useMemo(() => new Map(catalog.entries.map(asset => [asset.alias, asset])), [catalog.entries]);
  const inspected = inspection.flatMap(alias => {
    const asset = assets.get(alias);
    return asset ? [asset] : [];
  });
  const assetsRef = useRef(assets);
  const latestProject = useRef(project);
  useLayoutEffect(() => { latestProject.current = project; }, [project]);
  const viewport = useRef<HTMLDivElement>(null);
  const liveViewport = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const view = useRef<SceneView | null>(null);
  const liveView = useRef<SceneView | null>(null);
  const generation = useRef(0);
  const fileWork = useRef(false);
  const tree = useMemo(() => selectionTree(scene.objects), [scene.objects]);
  const expandableGroups = useMemo(() => [...tree.values()].flatMap(({ node }) =>
    node.type === 'Container' && node.children.length ? [node.id] : []), [tree]);
  const locked = useMemo(() => new Set([...tree].flatMap(([id, item]) => item.inheritedLock || item.node.locked ? [id] : [])), [tree]);
  const layoutChildren = useMemo(() => new Set([...tree].flatMap(([id, item]) =>
    isLayoutChild(item.node, item.parent ? tree.get(item.parent)?.node : undefined) ? [id] : [])), [tree]);
  const selected = selectedId ? tree.get(selectedId)?.node : undefined;
  const inspectLive = liveActive && !!gameScene;
  const inspectionObjects = inspectLive ? displayedObjects : scene.objects;
  const inspectionTree = useMemo(() => inspectLive ? selectionTree(displayedObjects) : tree,
    [inspectLive, displayedObjects, tree]);
  const inspectionIds = inspectLive ? liveSelection ?? selectedIds : selectedIds;
  const inspectionNodes = inspectionIds.flatMap(id => inspectionTree.get(id)?.node ?? []);
  const inspectionNode = inspectionNodes.at(-1);
  const inspectionGroups = inspectLive ? [...inspectionTree.values()].flatMap(({ node }) =>
    node.type === 'Container' && node.children.length ? [node.id] : []) : expandableGroups;
  const selectedPrefabRoot = prefabOwner(scene.objects, selectedId);
  const linkedPrefab = project.prefabs.find(prefab => prefab.id === selectedPrefabRoot?.prefab?.source);
  const selection = selectedIds.flatMap(id => tree.get(id)?.node ?? []);
  const movable = selectionRoots(tree, selectedIds).filter(id => !locked.has(id)).map(id => tree.get(id)!.node);
  const positionable = movable.filter(node => !layoutChildren.has(node.id));
  const cameraId = cameraInScene(scene.objects)?.id;
  const cameraProtected = (node: SceneObject) => !!cameraId && (node.id === cameraId ||
    (node.type === 'Container' && !!findObject(node.children, cameraId)));
  const deletable = movable.filter(node => {
    const owner = prefabOwner(scene.objects, node.id);
    return !cameraProtected(node) && node.id !== prefabEdit?.source.root.id && (!owner || owner.id === node.id) &&
      (node.type !== 'Container' || ![...locked].some(id => findObject(node.children, id)));
  });
  const prefabCapture = !prefabEdit && !movable.some(cameraProtected) && movable.length === selectionRoots(tree, selectedIds).length ?
    capturable(scene.objects, selectedIds) : undefined;
  const selectedLocked = !!selected && locked.has(selected.id);
  const singleEditable = selectedIds.length === 1 && !selectedLocked;
  const tool = requestedTool === 'skew' && (!supportsSkew(selected) || !singleEditable) ? 'select' : requestedTool;

  const install = useCallback(async (next: Project, name: string, selection: string | null, configToken?: string) => {
    const ticket = ++generation.current;
    const active = readScene(next, next.startup);
    setBusy(true);
    setFileError(undefined);
    let candidate: SceneView | undefined;
    try {
      candidate = await SceneView.create(active, {
        editor: true,
        sourceFor: alias => {
          const asset = assetsRef.current.get(alias);
          return asset?.kind === 'audio' ? asset.url : undefined;
        },
        publishAudio: setAudio,
        publishSource: (id, status) => {
          if (view.current !== candidate) return;
          setSourceStatuses(current => {
            if (!status && !current.has(id)) return current;
            const next = new Map(current);
            if (status) next.set(id, status);
            else next.delete(id);
            return next;
          });
        },
      }, errors => {
        if (view.current === candidate) setTextureErrors(errors);
      });
      if (ticket !== generation.current) return;
      candidate.show(active.objects, assetsRef.current, undefined, next.globals, active.lighting);
      const ids = selection ? [selection] : [];
      candidate.setSelection(ids);
      view.current?.destroy();
      view.current = candidate;
      setTextureErrors(new Set());
      setAudio({ state: 'idle' });
      setSourceStatuses(new Map());
      setAudioTransport('stopped');
      inspectorSections.current.clear();
      configDocument.current = { token: configToken, draft: crypto.randomUUID() };
      queuedConfig.current = next.config;
      appliedConfig.current = next.config;
      setDiskConfig(configToken ? next.config : undefined);
      setHistory({ active: { project: next, sceneId: next.startup, selection: ids }, past: [], future: [] });
      setSavedProject(next);
      setRecovered(false);
      recoveryId.current = undefined;
      recoveryProject.current = undefined;
      liveView.current?.app.stop();
      setPreviewPaused(false);
      setPlayback(undefined);
      setLiveSnapshot(undefined);
      selectViewport('edit');
      setNetworkError('');
      setNetworkServer(undefined);
      if (window.oliveFiles) void window.oliveFiles.network('stop').catch(() => {});
      setPrefabEdit(undefined);
      setActivePrefabId(undefined);
      setBrushId('');
      setBrushErase(false);
      setFileName(name);
      setGameLanguage('');
      setClosed(new Set());
      setAssetSession(current => current + 1);
      setBundleSelection([]);
      setInspection([]);
      setBundleFocus(0);
      setReady(true);
      return true;
    } catch (error) {
      if (ticket === generation.current) setFileError({ title: t('sceneError'), detail: validationMessage(error) });
    } finally {
      if (candidate && view.current !== candidate) candidate.destroy();
      if (ticket === generation.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void install(sampleProject, 'olive-grove.json', 'sample-sprite');
    return () => {
      generation.current++;
      launching.current = undefined;
      view.current?.destroy();
      view.current = null;
    };
  }, [install]);

  const mainPreview = playback?.main;
  const liveNetwork = useMemo(() => liveSnapshot && networkPlan(liveSnapshot.project), [liveSnapshot]);
  const gameNetwork = liveNetwork ?? network;
  const networkPreview = !!mainPreview && gameNetwork.template?.scene === mainPreview && !!gameNetwork.rules;
  const runtimeObjects = useMemo(() => networkPreview ? displayedObjects.filter(node => node.id !== gameNetwork.template?.node.id) : displayedObjects,
    [networkPreview, gameNetwork.template, displayedObjects]);
  const lastPlayback = useRef<ScenePlayback | undefined>(undefined);
  const applySavedConfig = useEffectEvent((config: SceneConfig) => {
    if (liveSnapshot && previewing) {
      setLiveSnapshot({ ...liveSnapshot, project: { ...liveSnapshot.project, config } });
      liveView.current?.app.reload();
    }
  });
  useEffect(() => {
    const config = project.config;
    if (queuedConfig.current === config) return;
    queuedConfig.current = config;
    const { token, draft } = configDocument.current;
    const files = window.oliveFiles;
    const ticket = generation.current;
    configWrites.current = configWrites.current.then(async () => {
      await files?.saveConfig(token, draft, JSON.stringify(configSchema.parse(config), null, 2) + '\n');
      if (generation.current !== ticket) return;
      appliedConfig.current = config;
      if (token) setDiskConfig(config);
      if (queuedConfig.current !== config) return;
      setFileError(current => current?.title === t('settingsSaveError') ? undefined : current);
      applySavedConfig(config);
    }).catch(error => {
      if (generation.current === ticket) setFileError({ title: t('settingsSaveError'), detail: validationMessage(error) });
    });
  }, [project.config]);
  useLayoutEffect(() => {
    const runtime = view.current;
    if (!runtime) return;
    runtime.stopTimeline();
    runtime.app.audio.stop();
    runtime.app.audio.sources.stopScene();
    setAudioTransport('stopped');
    setClosed(new Set());
    setInspection([]);
  }, [sceneId]);
  useLayoutEffect(() => {
    const runtime = liveView.current;
    if (!runtime || !mainPreview) return;
    runtime.stopTimeline();
    runtime.app.audio.sources.stopScene();
  }, [mainPreview, liveRevision]);
  useEffect(() => {
    assetsRef.current = assets;
    view.current?.show(scene.objects, assets, undefined, project.globals, scene.lighting);
  }, [scene.objects, assets, project.globals, scene.lighting]);
  useEffect(() => {
    if (gameScene && liveSnapshot) liveView.current?.show(displayedObjects, liveSnapshot.assets, gameScene,
      gameProject.globals, sceneRecord(gameProject, gameScene.id).lighting);
  }, [displayedObjects, gameScene, gameProject, liveSnapshot, liveRevision]);
  useEffect(() => { view.current?.setLightingPreview(lightingPreview); }, [lightingPreview, assetSession]);
  useLayoutEffect(() => { view.current?.setEditView(editView); }, [editView, assetSession]);
  const editClockActive = editClockRunning && !liveActive && !hubOpen && scenePanel.open && !scenePanel.minimized;
  useLayoutEffect(() => { view.current?.setEditClockRunning(editClockActive); }, [editClockActive, assetSession]);
  useEffect(() => {
    view.current?.setGameLanguage(project.content?.localization, gameLanguage);
  }, [project.content?.localization, gameLanguage, assetSession]);
  useEffect(() => {
    liveView.current?.setGameLanguage(gameProject.content?.localization, gameLanguage);
  }, [gameProject.content?.localization, gameLanguage, previewing]);
  useEffect(() => {
    view.current?.app.audio.sources.setMixer(project.audioMix);
  }, [project.audioMix, assetSession]);
  useEffect(() => {
    if (previewing) liveView.current?.app.audio.sources.setMixer(gameProject.audioMix);
    else view.current?.app.audio.sources.setMixer(project.audioMix);
  }, [gameProject.audioMix, previewing]);
  useEffect(() => { view.current?.setShaderLibrary(project.shaders); }, [project.shaders, assetSession]);
  useEffect(() => { liveView.current?.setShaderLibrary(gameProject.shaders); }, [gameProject.shaders, previewing]);
  useLayoutEffect(() => {
    const editCanvas = view.current?.app.canvas;
    const gameCanvas = liveView.current?.app.canvas;
    if (liveActive) {
      editCanvas?.remove();
      if (previewing && gameCanvas) liveViewport.current?.replaceChildren(gameCanvas);
    } else {
      gameCanvas?.remove();
      if (editCanvas) viewport.current?.replaceChildren(editCanvas);
    }
  }, [assetSession, previewing, liveActive]);
  useLayoutEffect(() => {
    if (previewing && liveActive && !document.activeElement?.closest('.viewport-tabs')) {
      liveViewport.current?.focus({ preventScroll: true });
    }
  }, [previewing, liveActive]);
  useEffect(() => {
    const host = liveViewport.current;
    const runtime = liveView.current;
    if (!previewing || !host || !runtime) return;
    const stopGlobals = runtime.attachGlobals(gameProject.globals, setGlobalValues);
    const stopInput = runtime.attachInput(gameProject.inputMap, host, setInputValues);
    return () => { stopInput(); stopGlobals(); };
  }, [previewing, gameProject.inputMap, gameProject.globals, liveRevision]);
  useEffect(() => {
    if (playback) return liveView.current?.attachPhysics(runtimeObjects, gameProject.physics ?? defaultPhysicsSettings, setPhysicsStatus);
  }, [playback, runtimeObjects, gameProject.physics, liveRevision]);
  useEffect(() => {
    view.current?.setPhysicsDebug(physicsDebug);
    liveView.current?.setPhysicsDebug(physicsDebug);
    try { localStorage.setItem('olivestudio:colliders', String(physicsDebug)); } catch { /* storage unavailable */ }
  }, [physicsDebug, assetSession, previewing]);
  useEffect(() => {
    const runtime = liveView.current;
    if (!playback || !runtime) return;
    return runtime.attachScripts({
      library: gameProject.scripts, scene: sceneRecord(gameProject, playback.main), scenes: gameProject.scenes,
      objects: runtimeObjects, inputMap: gameProject.inputMap, globals: gameProject.globals,
      production: gameProject,
      changeScene: (target, mode) => setPlayback(current => current ? followProjectSceneLink(gameProject, current, { target, mode }) : current),
      popScene: () => setPlayback(current => current && popScene(current)),
    }, gameProject.content, liveViewport.current?.parentElement ?? undefined);
  }, [playback, runtimeObjects, gameProject, liveRevision]);
  useEffect(() => {
    const runtime = liveView.current;
    if (!mainPreview || !runtime) return;
    return playCinematic(runtime, gameProject, mainPreview, id =>
      setPlayback(current => current ? followProjectSceneLink(gameProject, current, { target: id, mode: 'replace' }) : current));
  }, [mainPreview, gameProject, liveRevision]);
  useEffect(() => {
    const runtime = liveView.current;
    const files = window.oliveFiles;
    if (!networkPreview || !runtime || !files) return;
    let canceled = false;
    let detach: (() => void) | undefined;
    setNetworkError('');
    void files.network('start', serializeProject(gameProject)).then(server => {
      if (canceled) return;
      setNetworkServer(server);
      if (!server.running) throw new Error(server.error || t('networkServerUnavailable'));
      detach = runtime.attachNetwork(gameNetwork, server.endpoint, t('networkEditorPlayer'), gameProject.inputMap, setNetworkClient);
    }).catch(error => { if (!canceled) setNetworkError(validationMessage(error)); });
    return () => { canceled = true; detach?.(); };
  }, [networkPreview, gameNetwork, gameProject, liveRevision]);
  const networkOpen = panelLayout.panels.some(panel => panel.id === 'network' && panel.open);
  useEffect(() => {
    const files = window.oliveFiles;
    if (!files || !(networkOpen || networkPreview || networkServer?.running)) return;
    let canceled = false;
    let polling = false;
    async function poll() {
      if (polling) return;
      polling = true;
      try {
        const status = await files?.network('status');
        if (!canceled) setNetworkServer(status);
      } catch { /* retry the next tick */ }
      finally { polling = false; }
    }
    const timer = setInterval(() => void poll(), 250);
    void poll();
    return () => { canceled = true; clearInterval(timer); };
  }, [networkOpen, networkPreview, networkServer?.running]);
  useEffect(() => { setSlotMessage(''); }, [previewing, assetSession]);
  useEffect(() => { setLiveSelection(undefined); }, [gameScene?.id]);
  useEffect(() => {
    const previous = lastPlayback.current;
    lastPlayback.current = playback;
    if (!playback) return;
    const entered = previous?.main === playback.main ? playback.added.filter(id => !previous.added.includes(id)) :
      [playback.main, ...playback.added];
    for (const id of entered) {
      for (const { node } of selectionTree(sceneRecord(gameProject, id).objects).values()) {
        if (node.type === 'AudioSource' && node.autoplay) liveView.current?.app.audio.sources.play(node.id);
      }
    }
  }, [playback, gameProject, liveRevision]);
  useEffect(() => {
    if (hubOpen || !scenePanel.open || scenePanel.minimized) {
      stopPreview();
    }
    if (liveActive || hubOpen || !scenePanel.open || scenePanel.minimized) view.current?.stopEffectPreview();
    if (!liveActive) liveView.current?.stopEffectPreview();
  }, [hubOpen, scenePanel.open, scenePanel.minimized, liveActive]);
  useEffect(() => {
    const host = viewport.current;
    const instance = view.current;
    if (!host || !instance || !ready) return;
    const apply = () => {
      if (view.current === instance) instance.configure(resolvedConfig, previewProfile, host.clientWidth, host.clientHeight, authoredSize);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    return () => observer.disconnect();
  }, [resolvedConfig, previewProfile, ready, assetSession, authoredSize]);
  useLayoutEffect(() => {
    const host = liveViewport.current;
    const instance = liveView.current;
    if (!host || !instance || !previewing || !liveSnapshot) return;
    const authored = readScene(liveSnapshot.project, liveSnapshot.project.startup).config;
    const config = configRegistry.forPreview(authored, previewProfile.device, previewProfile.orientation);
    const apply = () => instance.configure(config, previewProfile,
      host.clientWidth || viewport.current?.clientWidth || config.renderer.width,
      host.clientHeight || viewport.current?.clientHeight || config.renderer.height, authored.renderer);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    return () => observer.disconnect();
  }, [previewing, liveSnapshot, previewProfile, liveRevision]);
  useEffect(() => {
    if (!previewing) return;
    const runtime = liveView.current;
    return () => {
      if (liveView.current === runtime) liveView.current = null;
      if (runtime) { runtime.app.unload(); runtime.destroy(); }
    };
  }, [previewing]);
  useEffect(() => {
    view.current?.setViewportGrid(viewportGrid);
    saveViewportGrid(viewportGrid);
  }, [viewportGrid, assetSession]);
  useEffect(() => { view.current?.setSelection(selectedIds); }, [selectedIds, assetSession]);
  useEffect(() => { view.current?.setTool(tool); }, [tool, assetSession]);
  useEffect(() => {
    if (audio.state !== 'idle' && !assets.has(audio.alias)) view.current?.app.audio.stop();
  }, [assets, audio]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const mayReplace = () => !dirty || window.confirm(t('discard'));

  function commit(update: (scene: Scene) => Scene, selection?: string | string[] | null) {
    setHistory(current => {
      const before = readScene(current.active.project, current.active.sceneId);
      const scene = update(before);
      if (scene === before) return current;
      return {
        active: { ...current.active, project: writeScene(current.active.project, current.active.sceneId, scene),
          selection: selection === undefined ? current.active.selection : typeof selection === 'string' ? [selection] : selection ?? [] },
        past: [...current.past.slice(-99), current.active], future: [],
      };
    });
  }

  function updateProject(update: (project: Project) => Project, openId?: string) {
    setHistory(current => {
      const project = update(current.active.project);
      if (project === current.active.project) return current;
      const record = sceneRecord(project, openId ?? current.active.sceneId);
      const selection = record.id === current.active.sceneId ? current.active.selection : [];
      return { active: { project, sceneId: record.id, selection }, past: [...current.past.slice(-99), current.active], future: [] };
    });
  }

  function editScene(id: string) {
    if (id === sceneId || (playback && liveActive)) return;
    setHistory(current => ({ ...current, active: { ...current.active, sceneId: id, selection: [] } }));
  }

  function createScene(copy: boolean) {
    const record = copy ? duplicateScene(sceneRecord(project, sceneId)) :
      { id: crypto.randomUUID(), name: t('untitledScene', { count: project.scenes.length + 1 }),
        objects: [newSceneCamera(project.config.renderer)], timeline: [], links: [] };
    updateProject(project => ({ ...project, version: 2, scenes: [...project.scenes, record] }), record.id);
  }

  function changeRecord(update: (record: ReturnType<typeof sceneRecord>) => ReturnType<typeof sceneRecord>) {
    updateProject(project => {
      const current = sceneRecord(project, sceneId);
      const next = update(current);
      return current === next ? project : { ...project, version: 2, scenes: project.scenes.map(record => record === current ? next : record) };
    });
  }

  function editPrefabRecord(next: ReturnType<typeof sceneRecord>, selectedId: string, newPrefab?: Prefab) {
    setHistory(current => ({
      active: { ...current.active, selection: [selectedId], project: {
        ...current.active.project, version: 2,
        scenes: current.active.project.scenes.map(scene => scene.id === next.id ? next : scene),
        prefabs: newPrefab ? [...current.active.project.prefabs, newPrefab] : current.active.project.prefabs,
      } },
      past: [...current.past.slice(-99), current.active], future: [],
    }));
  }

  function createPrefab() {
    if (!prefabCapture || project.prefabs.length >= prefabLimit) return;
    const group = { ...createObject('Container'), label: t('newPrefab'), position: { x: 0, y: 0 } };
    const { prefab, scene, root } = capturePrefab(sceneRecord(project, sceneId), prefabCapture, group);
    editPrefabRecord(scene, root, prefab);
    setActivePrefabId(prefab.id);
  }

  function insertPrefab(prefab: Prefab, at?: { x: number; y: number }) {
    if (prefabEdit && dependsOn(project.prefabs, prefab.id, prefabEdit.source.id)) return;
    const record = sceneRecord(project, sceneId);
    const parent = at ? null : selected?.type === 'Container' && singleEditable && !selectedPrefabRoot ? selected.id :
      prefabEdit?.source.root.type === 'Container' ? prefabEdit.source.root.id : null;
    const position = at ?? (parent ? { x: 0, y: 0 } :
      { x: resolvedConfig.renderer.width / 2, y: resolvedConfig.renderer.height / 2 });
    const { root, timeline } = instantiatePrefab(prefab, position);
    const tracks = timelineSchema.safeParse([...record.timeline, ...timeline]);
    if (!tracks.success) { setFileError({ title: t('prefabs'), detail: t('prefabTimelineLimit') }); return; }
    const objects = parent ? changeObject(record.objects, parent, node => node.type === 'Container' ?
      { ...node, children: [...node.children, root] } : node) : [...record.objects, root];
    setInspection([]);
    editPrefabRecord({ ...record, objects, timeline: tracks.data }, root.id);
    if (parent && closed.has(parent)) toggle(parent);
  }

  function paintStroke(points: Point[]) {
    const runtime = view.current;
    const brush = activeBrush;
    if (!runtime || !brush || !editable || prefabEdit) return;
    try {
      if (brush.kind === 'terrain') {
        if (selected?.type !== 'Tilemap' || selectedLocked) return;
        const cells = points.flatMap(point => {
          const local = runtime.paintPoint(selected.id, point);
          return local ? [{ x: Math.floor(local.x / selected.tileWidth), y: Math.floor(local.y / selected.tileHeight) }] : [];
        });
        if (!cells.length) return;
        const { columns, rows, tileWidth, tileHeight, alpha } = selected;
        const tiles = terrainStroke({ columns, rows, tileWidth, tileHeight, alpha, assetId: '',
          collision: selected.collision ?? 'none', tiles: Array.from({ length: columns * rows }, (_, i) => selected.tiles[i] ?? -1) },
        cells, brush.terrainTiles, brushErase);
        updateSelected(node => node.type === 'Tilemap' ? { ...node, tiles, collision: brush.solid ? 'solid' : 'none' } : node);
        return;
      }
      const world = points.flatMap(point => {
        const local = runtime.paintPoint(undefined, point);
        return local ? [{ x: local.x, y: local.y }] : [];
      });
      if (!world.length) return;
      if (brushErase) {
        const centers = scatter({ ...brush, jitter: 0 }, world);
        const ids = new Set(scene.objects.filter(node => node.brushId === brush.id && !locked.has(node.id) &&
          centers.some(point => Math.hypot(node.position.x - point.x, node.position.y - point.y) <= brush.spacing)).map(node => node.id));
        if (ids.size) edit(objects => changeSelection(objects, ids, () => null), selectedIds.filter(id => !ids.has(id)));
        return;
      }
      const prefab = project.prefabs.find(item => item.id === brush.prefabId);
      if (!prefab) return;
      const copies = scatter(brush, world).map(point => {
        const { root, timeline } = instantiatePrefab(prefab, { x: point.x, y: point.y });
        return { root: { ...root, brushId: brush.id, rotation: root.rotation + point.rotation,
          scale: { x: root.scale.x * point.scale, y: root.scale.y * point.scale } }, timeline };
      });
      const timeline = timelineSchema.parse([...scene.timeline, ...copies.flatMap(copy => copy.timeline)]);
      const objects = [...scene.objects, ...copies.map(copy => copy.root)];
      commit(current => ({ ...current, objects, timeline }));
    } catch (error) { setFileError({ title: t('brushes'), detail: validationMessage(error) }); }
  }

  function startPrefabEdit(source: Prefab) {
    const id = crypto.randomUUID();
    const draft = { id, name: source.name, links: [], timeline: source.timeline, objects: [{ ...source.root, position: {
      x: resolvedConfig.renderer.width / 2, y: resolvedConfig.renderer.height / 2,
    } }] };
    setPrefabEdit({ source, history });
    setHistory({ active: { project: { ...project, scenes: [...project.scenes, draft] }, sceneId: id, selection: [source.root.id] }, past: [], future: [] });
    const panel = panelLayout.panels.find(item => item.id === 'hierarchy')!;
    setPanelLayout(current => setPanelOpen(current, panel.id, true));
  }

  function applyPrefabChange(before: History, source: Prefab) {
    const revised = revisePrefab(before.active.project, source);
    if (!revised) { setFileError({ title: t('prefabs'), detail: t('invalidPrefabDependencies') }); return false; }
    if (revised.scenes.some(scene => !timelineSchema.safeParse(scene.timeline).success) ||
        revised.prefabs.some(prefab => !timelineSchema.safeParse(prefab.timeline).success)) {
      setFileError({ title: t('prefabs'), detail: t('prefabTimelineLimit') });
      return false;
    }
    const available = selectionTree(sceneRecord(revised, before.active.sceneId).objects);
    setHistory({ active: { ...before.active, project: revised, selection: before.active.selection.filter(id => available.has(id)) },
      past: [...before.past.slice(-99), before.active], future: [] });
    return true;
  }

  function finishPrefabEdit(save: boolean) {
    if (!prefabEdit) return;
    if (save) {
      const [root] = scene.objects;
      if (scene.objects.length !== 1 || root?.id !== prefabEdit.source.root.id) {
        setFileError({ title: t('prefabs'), detail: t('prefabOneRoot') });
        return;
      }
      const next = { ...prefabEdit.source, name: root.label.slice(0, 100), root: { ...root, position: prefabEdit.source.root.position },
        timeline: scene.timeline };
      if (!applyPrefabChange(prefabEdit.history, next)) return;
    } else setHistory(prefabEdit.history);
    setFileError(undefined);
    setPrefabEdit(undefined);
  }

  function prefabInstanceAction(action: 'apply' | 'revert' | 'unpack') {
    if (!selectedPrefabRoot || !linkedPrefab) return;
    const record = sceneRecord(project, sceneId);
    if (action === 'apply') applyPrefabChange(history, applyPrefab(record, selectedPrefabRoot, linkedPrefab));
    else if (action === 'revert') editPrefabRecord(revertPrefab(record, selectedPrefabRoot, linkedPrefab), selectedPrefabRoot.id);
    else editPrefabRecord(unpackPrefab(record, selectedPrefabRoot.id), selectedPrefabRoot.id);
  }

  function deleteScene() {
    if (!canDeleteScene(project, sceneId) || !window.confirm(t('deleteSceneConfirm', { name: sceneRecord(project, sceneId).name }))) return;
    updateProject(project => {
      if (!canDeleteScene(project, sceneId)) return project;
      const scenes = project.scenes.filter(record => record.id !== sceneId);
      const world = project.world && { ...project.world, rooms: project.world.rooms.filter(room => room.sceneId !== sceneId),
        portals: project.world.portals.filter(portal => portal.fromScene !== sceneId && portal.toScene !== sceneId) };
      return { ...project, version: 2, scenes, world, startup: project.startup === sceneId ? scenes[0].id : project.startup };
    });
  }

  function installCharacterKit(character: Character) {
    if (!editable || prefabEdit) return;
    const { width, height } = authoredSize;
    const label = t(character.mode === 'platformer' ? 'platformerKit' : 'topdownKit');
    const actor = { ...createObject('Graphics'), label, width: character.width, height: character.height,
      pivot: { x: character.width / 2, y: character.height / 2 }, position: { x: Math.min(100, width / 2), y: height / 2 }, character };
    const floor = { ...createObject('Graphics'), label: t('kitGround'), width, height: 40, fill: '#4d6657',
      pivot: { x: width / 2, y: 20 }, position: { x: width / 2, y: height - 20 }, platform: { width, height: 40 } };
    let inputMap = ensureMovementActions(project.inputMap, { ...defaultNetworkPlayer, ...character });
    if (character.mode === 'platformer') {
      for (const [name, key] of [[character.jump, 'Space'], [character.dash, 'ShiftLeft']]) {
        if (name && !inputMap.actions.some(action => action.name === name)) inputMap = {
          ...inputMap, actions: [...inputMap.actions, { id: crypto.randomUUID(), name, kind: 'button', bindings: [{ type: 'key', code: key }] }],
        };
      }
    }
    inputMap = InputMapSchema.parse(inputMap);
    updateProject(current => {
      const scene = readScene(current, sceneId);
      const objects = [...scene.objects, ...(character.mode === 'platformer' ? [floor] : []), actor];
      return { ...writeScene(current, sceneId, { ...scene, objects }), version: 2, inputMap };
    });
    select([actor.id]);
  }

  function applyCharacter(character: Character) {
    if (!selected || !singleEditable || tree.get(selected.id)?.parent || selected.screenSpace || selected.physics)
      throw new Error(t('characterRootRequired'));
    updateSelected(node => ({ ...node, character, platform: undefined }));
  }

  function applyPlatform() {
    if (selected?.type !== 'Graphics' || selected.shape !== 'rectangle' || tree.get(selected.id)?.parent ||
        selected.screenSpace || selected.rotation || selected.skew.x || selected.skew.y || selected.physics)
      throw new Error(t('platformRootRequired'));
    const pivot = { x: selected.width / 2, y: selected.height / 2 };
    updateSelected(node => node.type === 'Graphics' ? { ...node, platform: { width: node.width, height: node.height }, character: undefined, pivot,
      position: { x: node.position.x + (pivot.x - node.pivot.x) * node.scale.x, y: node.position.y + (pivot.y - node.pivot.y) * node.scale.y } } : node);
  }

  function navigateLink(link: SceneLink) {
    setPlayback(current => current ? followSceneLink(current, link) : current);
  }

  function editGlobals(globals: Globals) {
    const gameSave = project.gameSave ?? createGameSave();
    const numberGlobals = new Set(globals.items.filter(item => item.type === 'number').map(item => item.id));
    updateProject(current => {
      const actions = current.inputMap.actions.map(action => {
        if (!action.globalId || numberGlobals.has(action.globalId)) return action;
        const { globalId: _id, ...unbound } = action;
        return unbound;
      });
      const inputMap = actions.some((action, index) => action !== current.inputMap.actions[index]) ?
        { ...current.inputMap, actions } : current.inputMap;
      return { ...current, version: 2, globals, inputMap, gameSave };
    });
  }

  function configureGameSave(revision: number) {
    const key = project.gameSave?.key ?? createGameSave().key;
    updateProject(current => ({ ...current, version: 2, gameSave: { key, revision } }));
  }

  function saveSlot(slot: GameSlot) {
    const globals = liveView.current?.app.globals;
    if (!playback || !gameProject.gameSave || !globals?.active) return;
    const saved = writeGameSlot(localStorage, gameProject.gameSave, slot, { ...playback, values: globals.values() });
    setSlotMessage(t(saved ? 'gameSlotSaved' : 'gameSlotUnavailable', { index: slot }));
  }

  function loadSlot(slot: GameSlot) {
    const globals = liveView.current?.app.globals;
    if (!playback || !gameProject.gameSave || !globals?.active) return;
    const loaded = readGameSlot(localStorage, gameProject.gameSave, slot);
    if (loaded.status !== 'ok') {
      const messages = { empty: 'gameSlotEmpty', invalid: 'gameSlotInvalid', revision: 'gameSlotRevision', unavailable: 'gameSlotUnavailable' } as const;
      setSlotMessage(t(messages[loaded.status], { index: slot }));
      return;
    }
    const sceneIds = new Set(gameProject.scenes.map(record => record.id));
    const main = sceneIds.has(loaded.data.main) ? loaded.data.main : gameProject.startup;
    const added = [...new Set(loaded.data.added)].filter(id => id !== main && sceneIds.has(id));
    globals.restore(loaded.data.values);
    const stack = loaded.data.stack?.filter(frame => sceneIds.has(frame.main)).map(frame => ({
      ...frame, added: [...new Set(frame.added)].filter(id => id !== frame.main && sceneIds.has(id)),
    }));
    setPlayback({ main, added, stack });
    setSlotMessage(t('gameSlotLoaded', { index: slot }));
  }

  function edit(update: (objects: SceneObject[]) => SceneObject[], selection?: string | string[] | null) {
    commit(current => {
      const objects = update(current.objects);
      if (objects === current.objects) return current;
      const timeline = current.timeline.filter(track => findObject(objects, track.target));
      const cinematics = current.cinematics ? pruneCinematics(current.cinematics, new Set(selectionTree(objects).keys())) : undefined;
      return { ...current, objects, timeline: timeline.length === current.timeline.length ? current.timeline : timeline, cinematics };
    }, selection);
  }

  function travel(direction: 'undo' | 'redo') {
    if (!editable || fileWork.current) return;
    setHistory(current => {
      if (direction === 'undo') {
        const target = current.past.at(-1);
        return target ? { active: target, past: current.past.slice(0, -1), future: [current.active, ...current.future] } : current;
      }
      const [target, ...future] = current.future;
      return target ? { active: target, past: [...current.past, current.active], future } : current;
    });
  }

  function updateSelected(change: (node: SceneObject) => SceneObject) {
    if (selected && singleEditable) edit(objects => changeObject(objects, selected.id, change));
  }

  function updateBatch(change: (node: SceneObject, index: number) => SceneObject, ids = selectedIds.filter(id => !locked.has(id))) {
    const order = new Map(ids.map((id, index) => [id, index]));
    edit(objects => changeSelection(objects, new Set(ids), node => change(node, order.get(node.id)!)));
  }

  function toggleLock() {
    const targets = selectedIds.filter(id => !tree.get(id)?.inheritedLock);
    const lock = targets.some(id => !tree.get(id)?.node.locked);
    updateBatch(node => !!node.locked === lock ? node : { ...node, locked: lock }, targets);
  }

  function transform(patches: readonly ObjectTransform[]) {
    const target = recording.current;
    if (target) {
      const next = recordTransforms(scene, target, patches.filter(item => !locked.has(item.id)), id => tree.get(id)?.node);
      if (next) changeTimeline(() => next);
      else setFileError({ title: t('timeline'), detail: t('timelineRecordingLimit') });
      return;
    }
    const byId = new Map(patches.map(item => [item.id, item.patch]));
    updateBatch(node => ({ ...node, ...byId.get(node.id) }), [...byId.keys()].filter(id => !locked.has(id)));
  }

  function align(command: Alignment) {
    const runtime = view.current;
    if (!runtime) return;
    const bounds = positionable.flatMap(node => {
      const box = runtime.bounds(node.id);
      return box ? [{ id: node.id, ...box }] : [];
    });
    transform(alignedOffsets(bounds, command).flatMap(({ id, x, y }) => {
      if (Math.abs(x) < 1e-8 && Math.abs(y) < 1e-8) return [];
      const position = runtime.offsetPosition(id, tree.get(id)!.node.position, { x, y });
      return position ? [{ id, patch: { position } }] : [];
    }));
  }

  function flip(axis: 'x' | 'y') {
    updateBatch(node => ({ ...node, scale: { ...node.scale, [axis]: -node.scale[axis] } }), movable.map(node => node.id));
  }

  function setPivot(anchor: Point) {
    if (!selected || !singleEditable || layoutChildren.has(selected.id)) return;
    const patch = view.current?.pivotAt(selected, anchor);
    if (patch) updateSelected(node => ({ ...node, ...patch }));
  }

  function add(node: SceneObject) {
    const parent = selected?.type === 'Container' && singleEditable && !selectedPrefabRoot ? selected.id :
      prefabEdit?.source.root.type === 'Container' ? prefabEdit.source.root.id : null;
    setInspection([]);
    commit(current => {
      const objects = parent ? changeObject(current.objects, parent, item =>
        item.type === 'Container' ? { ...item, children: [...item.children, node] } : item,
      ) : [...current.objects, node];
      const lighting = current.lighting ?? (node.type === 'Light2D' && !prefabEdit ? { ...defaultLighting, enabled: true } : undefined);
      return { ...current, objects, lighting };
    }, node.id);
    if (parent && closed.has(parent)) toggle(parent);
  }

  function toggle(id: string) {
    setClosed(previous => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function setGroupsExpanded(expanded: boolean) {
    setClosed(previous => {
      const next = new Set(previous);
      for (const id of inspectionGroups) {
        if (expanded) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function remove() {
    if (!deletable.length) return;
    setInspection([]);
    const ids = new Set(deletable.map(node => node.id));
    edit(objects => changeSelection(objects, ids, () => null), selectedIds.filter(id =>
      !ids.has(id) && !deletable.some(node => node.type === 'Container' && findObject(node.children, id))));
  }

  async function importAssets(folderId: string | null, dropped?: File[]) {
    const files = window.oliveFiles;
    if (!files || !ready || busy || prefabEdit || fileWork.current) return;
    fileWork.current = true;
    setBusy(true);
    setFileError(undefined);
    try {
      const packed = await files.importAssets(dropped);
      if (packed.length) {
        const assets = importedAssetsSchema.parse([...scene.assets, ...packed]);
        commit(current => ({ ...current, assets, assetLibrary: addLibraryEntries(
          current.assetLibrary, packed.map(asset => asset.alias), folderId,
        ) }));
      }
    } catch (error) {
      setFileError({ title: t('importFailed'), detail: validationMessage(error) });
    } finally {
      fileWork.current = false;
      setBusy(false);
    }
  }

  async function replaceAsset(item: CatalogEntry) {
    const files = window.oliveFiles;
    if (!files || !editable || prefabEdit || !item.writable || fileWork.current) return;
    fileWork.current = true;
    setBusy(true);
    setFileError(undefined);
    try {
      const [replacement, ...others] = await files.importAssets();
      if (!replacement) return;
      if (others.length || (replacement.media?.kind ?? undefined) !== item.media?.kind ||
          extension(replacement.alias).toLowerCase() !== extension(item.alias).toLowerCase()) throw new Error(t('assetReplaceMismatch'));
      const assets = importedAssetsSchema.parse(scene.assets.map(asset => asset.alias === item.alias ? { ...replacement, alias: item.alias } : asset));
      if (audio.state !== 'idle' && audio.alias === item.alias) view.current?.app.audio.stop();
      commit(current => ({ ...current, assets }));
    } catch (error) { setFileError({ title: t('importFailed'), detail: validationMessage(error) }); }
    finally { fileWork.current = false; setBusy(false); }
  }

  async function createAtlas(asset: CatalogEntry, options: Parameters<typeof sliceAsset>[1]) {
    if (!editable || prefabEdit || fileWork.current || asset.kind !== 'image') return;
    fileWork.current = true;
    setBusy(true);
    try {
      const generated = await sliceAsset(asset, options);
      const alias = `project/${crypto.randomUUID()}/${asset.name.slice(0, -extension(asset.name).length).slice(0, 80)}-atlas.json`;
      const assets = importedAssetsSchema.parse([...scene.assets, { alias, ...generated }]);
      commit(current => ({ ...current, assets, assetLibrary: addLibraryEntries(current.assetLibrary, [alias], null, true) }));
      setInspection([alias]);
    } finally { fileWork.current = false; setBusy(false); }
  }

  async function exportBundles() {
    const files = window.oliveFiles;
    if (!files || !ready || busy || fileWork.current || !scene.assets.length) return null;
    const names = new Map((scene.assetLibrary.bundles ?? []).map(bundle => [bundle.id, bundle.name]));
    const membership = new Map(scene.assetLibrary.entries.map(entry => [entry.alias, entry.bundleId]));
    fileWork.current = true;
    setBusy(true);
    try {
      return await files.exportBundles(scene.assets.map(asset => ({
        ...asset, bundle: names.get(membership.get(asset.alias) ?? '') ?? 'default',
      })));
    } finally {
      fileWork.current = false;
      setBusy(false);
    }
  }

  function newScene() {
    if (prefabEdit) return;
    if (hubOpen) { void newHubProject(); return; }
    if (!busy && !fileWork.current && mayReplace()) void install(projectFromScene(emptyScene()), 'scene.json', null);
  }

  function chooseScene() {
    if (busy || prefabEdit || fileWork.current) return;
    const files = window.oliveFiles;
    if (files) void open(() => files.open());
    else input.current?.click();
  }

  async function open(read: () => Promise<OpenedScene | null>) {
    if (busy || prefabEdit || fileWork.current) return;
    fileWork.current = true;
    setBusy(true);
    setFileError(undefined);
    const ticket = generation.current;
    try {
      await configWrites.current;
      const file = await read();
      if (!file || ticket !== generation.current || !mayReplace()) return;
      const raw: unknown = JSON.parse(file.text);
      const next = parseProject(file.configText !== undefined && raw && typeof raw === 'object' ?
        { ...raw, config: configSchema.parse(JSON.parse(file.configText)) } : raw, file.name.replace(/\.json$/i, ''));
      if (ticket === generation.current && await install(next, file.name, sceneRecord(next, next.startup).objects[0]?.id ?? null, file.configToken)) {
        setRecovered(!!file.recovered);
        setHubOpen(false);
        if (file.recentToken) {
          void window.oliveFiles?.hub.remember(file.recentToken).catch(error => console.warn('Could not record opened scene:', error));
        }
      }
    } catch (error) {
      if (ticket === generation.current) {
        setFileError({ title: t('sceneError'), detail: validationMessage(error) });
      }
    } finally {
      fileWork.current = false;
      if (ticket === generation.current) setBusy(false);
    }
  }

  async function newHubProject() {
    if (busy || fileWork.current || !mayReplace()) return;
    const next = projectFromScene(emptyScene());
    const files = window.oliveFiles;
    if (!files) {
      if (await install(next, 'scene.json', null)) setHubOpen(false);
      return;
    }
    fileWork.current = true;
    setBusy(true);
    setFileError(undefined);
    try {
      const saved = await files.save('scene.json', serializeProject(next));
      if (saved && await install(next, saved.name, null, saved.configToken)) setHubOpen(false);
    } catch (error) {
      setFileError({ title: t('saveError'), detail: validationMessage(error) });
    } finally {
      fileWork.current = false;
      setBusy(false);
    }
  }

  function openExample(id: 'grove' | 'gallery') {
    if (id === 'gallery') {
      const hub = window.oliveFiles?.hub;
      if (hub) void open(hub.example);
    } else if (!busy && !fileWork.current && mayReplace()) {
      void install(sampleProject, 'olive-grove.json', 'sample-sprite').then(loaded => {
        if (loaded) setHubOpen(false);
      });
    }
  }

  async function save() {
    flushScriptEdits();
    if (prefabEdit) { finishPrefabEdit(true); return; }
    if (!ready || busy || fileWork.current) return;
    const text = serializeProject(project);
    const files = window.oliveFiles;
    if (files) {
      fileWork.current = true;
      setBusy(true);
      setFileError(undefined);
      try {
        await configWrites.current;
        const saved = await files.save(fileName, text);
        if (saved) {
          configDocument.current = { ...configDocument.current, token: saved.configToken };
          appliedConfig.current = project.config;
          setDiskConfig(project.config);
          setFileName(saved.name);
          setSavedProject(project);
          setRecovered(false);
        }
      } catch (error) {
        setFileError({ title: t('saveError'), detail: validationMessage(error) });
      } finally {
        fileWork.current = false;
        setBusy(false);
      }
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSavedProject(project);
  }

  const handleFileCommand = useEffectEvent((command: DesktopCommand) => {
    if (command === 'new') newScene();
    else if (command === 'open') chooseScene();
    else if (command === 'save') void save();
    else if (command === 'export-game' && editable && !prefabEdit && !hubOpen && !settingsOpen) setExportOpen(true);
    else if (command === 'undo' || command === 'redo') travel(command);
    else if (command === 'settings' && !hubOpen) setSettingsOpen(true);
    else if (command === 'hub' && !prefabEdit) { setSettingsOpen(false); setFileError(undefined); setHubOpen(true); }
    else if (command === 'panel-reset') setPanelLayout(defaultLayout());
    else {
      const id = panelIds.find(id => command === `panel-${id}`);
      if (id) setPanelLayout(current => setPanelOpen(current, id, !current.panels.find(item => item.id === id)?.open));
    }
  });
  useEffect(() => {
    let pending: number | undefined;
    const unsubscribe = window.oliveFiles?.onCommand(command => {
      if ((command === 'undo' || command === 'redo') &&
        (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) &&
        document.execCommand(command)) return;
      // Commit a focused Inspector draft before a menu command reads the scene.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (pending !== undefined) cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        pending = undefined;
        handleFileCommand(command);
      });
    });
    return () => {
      if (pending !== undefined) cancelAnimationFrame(pending);
      unsubscribe?.();
    };
  }, []);

  const editable = ready && !busy && (!previewing || !liveActive);
  function canvasDropPoint(event: React.DragEvent) {
    const sceneView = view.current;
    if (!editable || prefabEdit || !sceneView || !(event.target instanceof HTMLCanvasElement)) return;
    const point = sceneView.canvasPoint(event.clientX, event.clientY);
    if (point && point.x >= 0 && point.y >= 0 && point.x <= sceneView.app.screen.width && point.y <= sceneView.app.screen.height) return point;
  }
  const timelineDock = panelLayout.panels.find(item => item.id === 'timeline')!.dock;
  const timelineVisible = activeTab(panelLayout, timelineDock) === 'timeline' && !hubOpen && editable;
  const inputDock = panelLayout.panels.find(item => item.id === 'input')!.dock;
  const hasSceneAudio = hasAudioSource(scene.objects);
  useEffect(() => {
    if (hasSceneAudio && !hubOpen) return;
    const runtime = view.current;
    if (runtime) setAudioTransport(runtime.app.audio.sources.stopScene());
  }, [hasSceneAudio, hubOpen]);

  const bundlePanel = panelLayout.panels.find(item => item.id === 'bundles')!;
  const bundlesOpen = activeTab(panelLayout, bundlePanel.dock) === 'bundles';
  function showBundles(open: boolean) {
    setPanelLayout(current => setPanelOpen(current, 'bundles', open));
  }

  function mutateLibrary(action: LibraryAction) {
    if (!editable || prefabEdit || fileWork.current) return;
    const next = changeLibrary(scene, action, referencedObjects);
    if (next !== scene) commit(() => next);
  }

  function changeScripts(mutate: (library: ScriptLibrary) => void) {
    updateProject(current => {
      const scripts = structuredClone(current.scripts);
      mutate(scripts);
      const result = ScriptLibrarySchema.safeParse(scripts);
      return result.success ? { ...current, version: 2, scripts: result.data } : current;
    });
  }

  function setBehavior(id: string, value: Behavior) {
    if (prefabEdit || !editable || locked.has(id)) return;
    const behavior = BehaviorSchema.parse(value);
    updateProject(current => {
      const scene = readScene(current, sceneId);
      const objects = changeObject(scene.objects, id, node => {
        const { behavior: _removed, ...rest } = node;
        return behavior.scriptId ? { ...rest, behavior } : rest;
      });
      return objects === scene.objects ? current : { ...writeScene(current, sceneId, { ...scene, objects }), version: 2 };
    });
  }

  function saveGraph(graph: Graph) {
    if (!editable || prefabEdit) return;
    flushScriptEdits();
    const current = latestProject.current;
    const old = current.behaviorGraphs?.items.find(item => item.id === graph.id);
    const oldScript = current.scripts.items.find(script => script.id === old?.scriptId);
    if (old && oldScript && oldScript.source !== compileGraph(old)) throw new Error(t('behaviorGraphEditConflict'));
    const scriptId = old?.scriptId ?? crypto.randomUUID();
    const linked = { ...graph, scriptId };
    const source = compileGraph(linked);
    const name = oldScript?.name ?? `Graph ${graph.id.slice(0, 8)}`;
    const script = { id: scriptId, name, source, ...compileScript(source, name) };
    if (script.error) throw new Error(script.error);
    const behaviorGraphs = GraphsSchema.parse({ version: 1, items: old ?
      current.behaviorGraphs!.items.map(item => item.id === graph.id ? linked : item) :
      [...(current.behaviorGraphs?.items ?? []), linked] });
    updateProject(project => {
      const actual = project.scripts.items.find(item => item.id === scriptId);
      if (actual && old && actual.source !== compileGraph(old)) return project;
      const items = actual ? project.scripts.items.map(item => item.id === scriptId ? script : item) : [...project.scripts.items, script];
      const scripts = ScriptLibrarySchema.safeParse({ ...project.scripts, items });
      return scripts.success ? { ...project, version: 2, behaviorGraphs, scripts: scripts.data } : project;
    });
  }

  function editLogic(id: string, edit: (graph: LogicGraph) => void) {
    if (!editable || prefabEdit || locked.has(id)) return;
    const current = tree.get(id)?.node;
    if (!current || current.type === 'Camera2D') return;
    const logicGraph = LogicGraphSchema.parse(current.logicGraph ?? emptyGraph());
    edit(logicGraph);
    const next = LogicGraphSchema.parse(logicGraph);
    updateProject(project => {
      const scene = readScene(project, sceneId);
      const objects = changeObject(scene.objects, id, node => ({ ...node, logicGraph: next }));
      return { ...writeScene(project, sceneId, { ...scene, objects }), version: 2 };
    });
  }

  function changeTimeline(update: (scene: ClipData) => ClipData) {
    const next = update({ timeline: scene.timeline, cinematics: scene.cinematics });
    const timeline = timelineSchema.safeParse(next.timeline);
    const cinematics = cinematicsSchema.optional().safeParse(next.cinematics);
    if (!timeline.success || !cinematics.success) {
      setFileError({ title: t('timeline'), detail: t('timelineInvalidClip') });
      return;
    }
    commit(current => ({ ...current, timeline: timeline.data, cinematics: cinematics.data }));
  }

  function changeNetwork(patch: Partial<MultiplayerSettings>) {
    const parsed = MultiplayerSettingsSchema.safeParse({ ...network.settings, ...patch });
    if (!parsed.success) { setNetworkError(validationMessage(parsed.error)); return; }
    setNetworkError('');
    if (JSON.stringify(parsed.data) === JSON.stringify(network.settings)) return;
    updateProject(current => ({ ...current, version: 2, multiplayer: parsed.data }));
  }

  function setupNetwork() {
    if (!selected || !singleEditable || tree.get(selected.id)?.parent || selected.screenSpace ||
      (network.template && network.template.node.id !== selected.id)) return;
    const player = selected.networkPlayer ?? defaultNetworkPlayer();
    try {
      const inputMap = ensureMovementActions(project.inputMap, player);
      updateProject(current => {
        const authored = readScene(current, sceneId);
        const objects = changeObject(authored.objects, selected.id, node => ({ ...node, networkPlayer: player }));
        return { ...writeScene(current, sceneId, { ...authored, objects }), version: 2, inputMap,
          multiplayer: { ...network.settings, enabled: true } };
      });
      setNetworkError('');
    } catch (error) { setNetworkError(validationMessage(error)); }
  }

  async function networkAction(action: 'start' | 'stop' | 'client' | 'latency' | 'drop', value?: number | string) {
    if (!window.oliveFiles || networkBusy) return;
    setNetworkBusy(true);
    setNetworkError('');
    try {
      if (action === 'stop') stopPreview();
      const status = await window.oliveFiles.network(action, action === 'start' || action === 'client' ? serializeProject(project) : value);
      setNetworkServer(status);
    } catch (error) { setNetworkError(validationMessage(error)); }
    finally { setNetworkBusy(false); }
  }

  function stopPreview() {
    launching.current = undefined;
    liveView.current?.app.stop();
    setLoadingPreview(false);
    setPreviewPaused(false);
    setPlayback(undefined);
    setLiveSnapshot(undefined);
    selectViewport('edit');
  }

  function changePreviewProfile(profile: PreviewProfile) {
    if (profile.device === previewProfile.device && profile.orientation === previewProfile.orientation) return;
    setPreviewProfile(profile);
    if (profile.device !== previewProfile.device) liveView.current?.app.reload();
  }

  async function startScenePreview(from: 'startup' | 'active') {
    if (playback) { stopPreview(); return; }
    if (!editable || prefabEdit || launching.current) return;
    flushScriptEdits();
    if (network.problems.length) {
      setPanelLayout(current => setPanelOpen(current, 'network', true));
      return;
    }
    const ticket = Symbol();
    const projectGeneration = generation.current;
    launching.current = ticket;
    setLoadingPreview(true);
    try {
      await configWrites.current;
      if (launching.current !== ticket || generation.current !== projectGeneration) return;
      const previewId = from === 'startup' ? latestProject.current.startup : sceneId;
      let previewAssets = assets;
      const runtime = await SceneView.create({ ...readScene(latestProject.current, previewId), config: appliedConfig.current }, {
        sourceFor: alias => {
          const asset = previewAssets.get(alias);
          return asset?.kind === 'audio' ? asset.url : undefined;
        },
        publishAudio: () => {},
        publishSource: () => {},
        onReload: () => {
          lastPlayback.current = undefined;
          setPlayback(current => current ? { main: current.main, added: current.added, stack: current.stack } : current);
          setPreviewPaused(false);
          setLiveRevision(current => current + 1);
        },
      }, () => {}, previewProfile);
      if (launching.current !== ticket || generation.current !== projectGeneration) { runtime.destroy(); return; }
      previewAssets = assetsRef.current;
      const snapshot = { ...latestProject.current, config: appliedConfig.current };
      const main = sceneRecord(snapshot, previewId).id;
      view.current?.app.audio.stop();
      view.current?.app.audio.sources.stopScene();
      setAudioTransport('stopped');
      runtime.app.speed(gameSpeed);
      runtime.profile(previewProfileRecorder);
      liveView.current = runtime;
      setLiveSnapshot({ project: snapshot, assets: previewAssets });
      setPanelLayout(current => {
        const dock = current.panels.find(panel => panel.id === 'scene')!.dock;
        return activeTab(current, dock) === 'scene' ? current : setPanelOpen(current, 'scene', true);
      });
      selectViewport('live');
      setPlayback({ main, added: [] });
    } catch (error) {
      if (launching.current === ticket) setFileError({ title: t('sceneError'), detail: validationMessage(error) });
    } finally {
      if (launching.current === ticket) {
        launching.current = undefined;
        setLoadingPreview(false);
      }
    }
  }

  function togglePreviewPause() {
    const app = liveView.current?.app;
    if (!app || !previewing) return;
    if (app.clock.state === 'paused') app.resume();
    else app.pause();
    setPreviewPaused(app.clock.state === 'paused');
  }

  function changeGameSpeed(value: number) {
    setGameSpeed(value);
    liveView.current?.app.speed(value);
  }

  function reportContent(error: unknown) {
    setFileError({ title: t('contentTextError'), detail: validationMessage(error) });
  }

  function changeMixer(mix: Mixer) {
    try {
      const audioMix = MixerSchema.parse(mix);
      updateProject(current => ({ ...current, version: 2, audioMix, config: {
        ...current.config, audio: { ...current.config.audio, volume: mix.master, music: mix.music, sfx: mix.sfx, ui: mix.ui },
      } }));
    } catch (error) { reportContent(error); }
  }

  function changeShaders(library: ShaderLibrary) {
    try {
      const shaders = ShaderLibrarySchema.parse(library);
      updateProject(current => ({ ...current, version: 2, shaders }));
    } catch (error) { reportContent(error); }
  }

  async function addGeneratedSound(bytes: Uint8Array, name: string, place: boolean) {
    const alias = `project/${crypto.randomUUID()}/${name.slice(0, 100)}.wav`;
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const data = btoa(binary);
    const source = place ? { ...createObject('AudioSource'), asset: alias, label: name,
      position: { x: authoredSize.width / 2, y: authoredSize.height / 2 } } : undefined;
    commit(current => ({
      ...current, assets: importedAssetsSchema.parse([...current.assets, { alias, data }]),
      assetLibrary: addLibraryEntries(current.assetLibrary, [alias], null, true),
      objects: source ? [...current.objects, source] : current.objects,
    }), source?.id);
  }

  function changeContent(mutate: (content: GameContent) => GameContent) {
    try {
      const content = contentSchema.parse(mutate(latestProject.current.content ?? emptyContent));
      updateProject(current => ({ ...current, version: 2, content }));
    } catch (error) { reportContent(error); }
  }

  function makeLocalizationKeys(ids: readonly string[]) {
    const idSet = new Set(ids);
    try {
      const current = latestProject.current;
      const original = readScene(current, sceneId);
      const content = current.content ?? emptyContent;
      let localization = content.localization;
      const objects = changeSelection(original.objects, idSet, node => {
        if ((node.type !== 'Text' && node.type !== 'BitmapText') || !node.text.trim() || node.text.includes('{@')) return node;
        const { next, key } = localizeText(localization, node.text, node.label);
        localization = next;
        return { ...node, text: '{@' + key + '}' };
      });
      if (localization === content.localization) return;
      const next = contentSchema.parse({ ...content, localization });
      updateProject(project => ({ ...writeScene(project, sceneId, { ...original, objects }), version: 2, content: next }));
    } catch (error) { reportContent(error); }
  }

  return <ScriptsProvider state={{
    library: project.scripts, editable: editable && !prefabEdit,
    scene: sceneRecord(project, sceneId), globals: project.globals.items,
    selected: selected && singleEditable && !prefabEdit ? { id: selected.id, name: selected.label, scripted: !!selected.behaviour } : undefined,
    entities: [...tree.values()].map(({ node }) => ({ id: node.id, name: node.label })),
    change: changeScripts,
    setBehavior,
    select: id => { if (tree.has(id)) select([id]); },
    graphs: project.behaviorGraphs?.items ?? [],
    saveGraph,
    editLogic,
    catalog: () => logicCatalog(project, scene.objects),
    content: project.content,
    logicActivity: id => liveView.current?.logicActivity(id),
    setBehaviour: (id, value) => {
      if (prefabEdit || !editable || locked.has(id)) return;
      updateProject(current => {
        const active = readScene(current, sceneId);
        const objects = changeObject(active.objects, id, node => {
          if (value.scriptId) return { ...node, behaviour: value };
          const { behaviour: _removed, ...rest } = node;
          return rest;
        });
        return objects === active.objects ? current : { ...writeScene(current, sceneId, { ...active, objects }), version: 2 };
      });
    },
    open: () => setPanelLayout(current => setPanelOpen(current, 'scripts', true)),
    report: error => setFileError({ title: t('scriptsPanel'), detail: validationMessage(error) }),
  }}><main className="editor">
    <header className="topbar">
      <IconButton icon={Home} label={t('hubTitle')} disabled={!!prefabEdit} onClick={() => {
        setFileError(undefined);
        setHubOpen(true);
      }} />
      <div className="toolbar">
        <IconButton icon={FilePlus2} label={t('newScene')} description={t('newSceneHint')} disabled={busy || !!prefabEdit}
          onClick={newScene} />
        <IconButton icon={FolderOpen} label={t('openScene')} description={t('openSceneHint')} disabled={busy || !!prefabEdit}
          onClick={chooseScene} />
        <IconButton icon={Save} className="save" label={t('saveScene')} description={t('saveSceneHint')}
          disabled={!editable} onClick={save} />
        <IconButton icon={Undo2} label={t('undo')} description={t('undoHint')}
          disabled={!editable || !history.past.length} onClick={() => travel('undo')} />
        <IconButton icon={Redo2} label={t('redo')} description={t('redoHint')}
          disabled={!editable || !history.future.length} onClick={() => travel('redo')} />
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void open(async () => ({ name: file.name, text: await file.text() }));
        }} />
      </div>
      <div className="file-info" {...hint(fileName, dirty ? t('unsaved') : undefined)}>
        <span>{fileName}</span>{dirty && <i role="img" aria-label={t('unsaved')} />}
      </div>
      <IconButton icon={Download} label={t('exportWindow')} description={t('exportWindowHint')}
        disabled={!editable || !!prefabEdit || !window.oliveFiles} onClick={() => setExportOpen(true)} />
      <IconButton icon={Search} label={t('projectSearch')} description={t('projectSearchHint')}
        disabled={!editable || !!prefabEdit} onClick={() => setSearchOpen(true)} />
      <PanelsMenu layout={panelLayout} change={setPanelLayout} />
      <IconButton icon={Settings2} label={t('settingsTitle')} description={t('settingsOpenHint')}
        disabled={!ready || busy || !!prefabEdit} onClick={() => setSettingsOpen(true)} />
    </header>

    {fileError && <div className="scene-error" role="alert"><strong>{fileError.title}</strong><p>{fileError.detail}</p>
      <IconButton icon={X} label={t('dismiss')} onClick={() => setFileError(undefined)} /></div>}

    <DockWorkspace layout={panelLayout} change={setPanelLayout} panels={{
      hierarchy: <aside className="panel hierarchy" aria-label={t('hierarchy')}>
        <PanelHeader icon={Layers3} label={t('hierarchy')} description={t('hierarchyHint')}>
          <div className="panel-tools" role="group" aria-label={t('addObjects')}>
            {quickObjectTypes.map(type => <IconButton key={type} icon={objectIcons[type]} disabled={!editable}
              label={t('addObject', { type: t(objectTypeKey[type]) })}
              description={t('addObjectHint', { type: t(objectTypeKey[type]) })} onClick={() => add(createObject(type))} />)}
            <div className="object-create-more" onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setMoreObjects(false);
            }} onKeyDown={event => {
              if (event.key === 'Escape' && moreObjects) {
                event.stopPropagation();
                setMoreObjects(false);
                event.currentTarget.querySelector('button')?.focus();
              }
            }}>
              <IconButton icon={Ellipsis} label={t('moreObjects')} description={t('moreObjectsHint')}
                aria-expanded={moreObjects} disabled={!editable} onClick={() => setMoreObjects(open => !open)} />
              {moreObjects && <div className="object-create-list" role="group" aria-label={t('moreObjects')}>
                {additionalObjectTypes.map(type => {
                  const Icon = objectIcons[type];
                  return <button key={type} type="button" aria-label={t('addObject', { type: t(objectTypeKey[type]) })}
                    onClick={event => {
                      event.currentTarget.closest('.object-create-more')?.querySelector('button')?.focus();
                      setMoreObjects(false);
                      const node = createObject(type);
                      if ((node.type === 'Particles' || node.type === 'Light2D') && selected?.type !== 'Container') {
                        node.position = { x: resolvedConfig.renderer.width / 2, y: resolvedConfig.renderer.height / 2 };
                      }
                      add(node);
                    }}><Icon size={15} aria-hidden="true" />{t(objectTypeKey[type])}</button>;
                })}
                {([{ name: 'layoutRow', icon: Columns2, direction: 'row' },
                  { name: 'layoutColumn', icon: Rows2, direction: 'column' },
                  { name: 'layoutWrapping', icon: Grid2X2, direction: 'row' }] as const).map(({ name, icon: Icon, direction }) =>
                  <button key={name} type="button" aria-label={t('addObject', { type: t(name) })} onClick={event => {
                    event.currentTarget.closest('.object-create-more')?.querySelector('button')?.focus();
                    setMoreObjects(false);
                    const layout = { ...defaultFlexContainer(), direction };
                    if (name === 'layoutColumn') Object.assign(layout, { width: 240, height: 360 });
                    if (name === 'layoutWrapping') Object.assign(layout, { width: 420, height: 320, wrap: true, justify: 'flex-start', align: 'flex-start' });
                    const position = selected?.type === 'Container' && singleEditable ?
                      { x: 32, y: 32 } : { x: resolvedConfig.renderer.width / 2, y: resolvedConfig.renderer.height / 2 };
                    add({ ...createObject('Container'), label: t(name), layout, position });
                  }}><Icon size={15} aria-hidden="true" />{t(name)}</button>)}
              </div>}
            </div>
            <IconButton icon={Trash2} className="delete" label={t('deleteObject')}
              description={t(movable.some(cameraProtected) ? 'requiredSceneCamera' : 'deleteObjectHint')}
              disabled={!editable || !deletable.length} onClick={remove} />
          </div>
        </PanelHeader>
        <Hierarchy nodes={inspectionObjects} selected={inspectionIds} select={select} locked={locked} closed={closed} toggle={toggle}
          groups={inspectionGroups} setGroupsExpanded={setGroupsExpanded}
          editable={editable} assets={assets} assignAsset={(id, alias) => {
            const asset = assets.get(alias);
            if (!asset || locked.has(id)) return;
            setInspection([]);
            edit(objects => changeObject(objects, id, node => assignObjectAsset(node, asset)), id);
          }} onMove={(id, destination) => {
            const target = destination.id && tree.get(destination.id);
            const owner = prefabOwner(scene.objects, id);
            const parent = destination.placement === 'inside' ? destination.id : target ? target.parent : null;
            if (parent && tree.get(id)?.node.screenSpace) return;
            if (id === prefabEdit?.source.root.id || (owner && owner.id !== id) || prefabOwner(scene.objects, parent)) return;
            if (locked.has(id) || (target && (target.inheritedLock || (destination.placement === 'inside' && target.node.locked)))) return;
            setInspection([]);
            edit(objects => moveObject(objects, id, destination), id);
            if (destination.id && destination.placement === 'inside' && closed.has(destination.id)) toggle(destination.id);
          }} />
      </aside>,

      scene: <section className="panel stage" aria-label={t('scene')}
        {...valueDrop('asset', (aliases, event) => {
          const point = canvasDropPoint(event);
          if (!point) return;
          const items = [...new Set(aliases)].flatMap(alias => { const item = assets.get(alias); return item ? [item] : []; });
          if (items.length) return { items, point };
        }, ({ items, point }) => {
          const nodes = items.map((asset, index) => objectFromAsset(asset, { x: point.x + index * 24, y: point.y + index * 24 }));
          setInspection([]);
          edit(objects => [...objects, ...nodes], nodes.map(node => node.id));
        })}>
        <PanelHeader icon={Frame} label={t('scene')} description={t('sceneHint')}>
          <ViewportTabs mode={liveActive ? 'live' : 'edit'} select={selectViewport} />
          <div className="viewport-playback" role="group" aria-label={t('viewportPlayback')}>
            <PlayMenu disabled={previewing || loadingPreview || !editable || !!prefabEdit} play={from => void startScenePreview(from)} />
            <IconButton icon={previewPaused ? Play : Pause} label={t(previewPaused ? 'viewportResume' : 'viewportPause')}
              disabled={!previewing} aria-pressed={previewPaused} onClick={togglePreviewPause} />
            <IconButton icon={StepForward} label={t('viewportStep')} description={t('viewportStepHint')}
              disabled={!previewing || !previewPaused} onClick={() => liveView.current?.app.step()} />
            <IconButton icon={Square} label={t('viewportStop')} disabled={!previewing && !loadingPreview} onClick={stopPreview} />
            <label className="viewport-speed" {...hint(t('viewportSpeed'))}>
              <input type="range" aria-label={t('viewportSpeed')} min={0.25} max={2} step={0.25} value={gameSpeed}
                disabled={loadingPreview} onChange={event => changeGameSpeed(event.currentTarget.valueAsNumber)} />
              <output>{new Intl.NumberFormat(locale).format(gameSpeed)}×</output>
            </label>
            {liveActive && <IconButton icon={X} label={t('viewportCloseLive')} onClick={() => {
              stopPreview();
              document.getElementById('viewport-tab-edit')?.focus();
            }} />}
          </div>
          {liveActive && gameScene && cameraInScene(sceneRecord(gameProject, gameScene.id).objects)?.camera.postFXs
            ?.some(effect => effect.type === 'shake' && effect.enabled) && <IconButton icon={Camera} label={t('shakeGameCamera')} description={t('shakeGameCameraHint')}
            onClick={() => liveView.current?.shakeCamera()} />}
          {!liveActive && hasSceneAudio && <div className="panel-tools" role="group" aria-label={t('sceneAudioPlayback')}>
            <IconButton icon={Play} label={t(audioTransport === 'paused' ? 'audioResumeScene' : 'audioPlayScene')}
              description={t('audioPlaySceneHint')} disabled={!editable || audioTransport === 'playing'} onClick={() => {
                const audio = view.current?.app.audio;
                if (!audio) return;
                audio.stop();
                setAudioTransport(audio.sources.playScene());
              }} />
            <IconButton icon={Pause} label={t('audioPauseScene')} description={t('audioPauseSceneHint')}
              disabled={!editable || audioTransport !== 'playing'} onClick={() => {
                const audio = view.current?.app.audio;
                if (audio) setAudioTransport(audio.sources.pauseScene());
              }} />
            <IconButton icon={Square} label={t('audioStopScene')} description={t('audioStopSceneHint')}
              disabled={!editable || (audioTransport === 'stopped' && !sourceStatuses.size)} onClick={() => {
                const audio = view.current?.app.audio;
                if (audio) setAudioTransport(audio.sources.stopScene());
              }} />
          </div>}
          <span className="panel-aside">{resolvedConfig.renderer.width} × {resolvedConfig.renderer.height}</span>
        </PanelHeader>
        <div className="viewport-pane" id="viewport-pane-edit" role="tabpanel" aria-labelledby="viewport-tab-edit" hidden={liveActive}>
          {prefabEdit && <div className="prefab-edit-bar">
            <span>{t('editingPrefab', { name: prefabEdit.source.name })}</span>
            <div className="panel-tools">
              <IconButton icon={Save} label={t('savePrefab')} onClick={() => finishPrefabEdit(true)} />
              <IconButton icon={X} label={t('cancelPrefabEdit')} onClick={() => finishPrefabEdit(false)} />
            </div>
          </div>}
          <Viewport viewport={viewport} view={view} scene={scene} ready={ready} busy={busy} tool={tool} select={select}
            viewMenu={<EditViewMenu value={editView} onChange={setEditView} />}
            clockRunning={editClockRunning} toggleClock={() => setEditClockRunning(running => !running)}
            paint={activeBrush && !prefabEdit && (activeBrush.kind === 'prefab' || selected?.type === 'Tilemap') ? paintStroke : undefined}
            profiles={{ profile: previewProfile, onProfile: changePreviewProfile, disabled: busy || loadingPreview }}
            drop={valueDrop('prefab', (ids, event) => {
              const point = canvasDropPoint(event);
              const prefab = ids.length === 1 ? project.prefabs.find(item => item.id === ids[0]) : undefined;
              if (point && prefab) return { point, prefab };
            }, ({ point, prefab }) => insertPrefab(prefab, point))}
            setTool={tool => { setBrushId(''); setTool(tool); }} skew={singleEditable && supportsSkew(selected)} grid={viewportGrid} setGrid={setViewportGrid} version={assetSession}
            selected={selectedIds} movable={positionable}
            quickTools={editable && singleEditable && selected && selected.type !== 'Container' && selected.type !== 'AudioSource' &&
              selected.type !== 'AudioListener' && selected.type !== 'Camera2D' && selected.type !== 'Light2D' ?
              <ViewportQuickTools key={selected.id} node={selected} update={updateSelected} /> : undefined}
            recording={() => !!recording.current} transform={transform} />
        </div>
        <div className="viewport-pane" id="viewport-pane-live" role="tabpanel" aria-labelledby="viewport-tab-live" hidden={!liveActive}>
          <div className="stage-live">
            <div className="viewport-alignment">
              <ViewportProfiles profile={previewProfile} onProfile={changePreviewProfile} disabled={busy || loadingPreview} />
            </div>
            <div className="live-canvas" ref={liveViewport} tabIndex={0} aria-label={t('viewportLiveSurface')} hidden={!previewing}
              onPointerDown={event => event.currentTarget.focus({ preventScroll: true })} />
            {!previewing && <p className="stage-message">{t('viewportLiveEmpty')}</p>}
          </div>
        </div>
      </section>,

      inspector: <aside className="panel inspector" aria-label={t('inspector')}>
        <PanelHeader icon={SlidersHorizontal} label={t('inspector')} description={t('inspectorHint')} />
        <fieldset className="panel-body" disabled={!editable && (!inspectionNode || inspected.length > 0 || inspectionNodes.length > 1)}>
          {inspected.length ? <AssetInspector assets={inspected} audio={audio} editable={editable}
            canAssign={editable && singleEditable && selected?.type === 'Sprite'} library={scene.assetLibrary}
            onAssign={alias => updateSelected(node => node.type === 'Sprite' && node.texture !== alias ? { ...node, texture: alias } : node)}
            onAssignAudio={singleEditable && selected?.type === 'AudioSource' ? alias =>
              updateSelected(node => node.type === 'AudioSource' && node.asset !== alias ? { ...node, asset: alias } : node) : undefined}
            onAdd={asset => add(objectFromAsset(asset))}
            onReplace={window.oliveFiles ? item => void replaceAsset(item) : undefined}
            slice={createAtlas}
            onTags={(aliases, tags) => mutateLibrary({ type: 'tags', aliases, tags })}
            onBundle={(aliases, id) => mutateLibrary({ type: 'bundle', operation: { type: 'assign', aliases, id } })}
            onPlay={alias => view.current?.app.audio.play(alias)} onStop={() => view.current?.app.audio.stop()} /> :
            inspectionNodes.length > 1 ? <MultiInspector key={JSON.stringify(inspectionIds)} nodes={inspectionNodes} locked={locked} movableCount={movable.length}
              layoutChildren={layoutChildren} positionableCount={positionable.length}
              update={updateBatch} align={align} flip={flip} toggleLock={toggleLock}
              canToggleLock={selection.some(node => !tree.get(node.id)?.inheritedLock)}
              lockAction={selection.some(node => !tree.get(node.id)?.inheritedLock && !node.locked)} /> :
            inspectionNode ? <Inspector key={`${assetSession}:${inspectionNode.id}`} node={inspectionNode} assets={assets} textureErrors={textureErrors} update={updateSelected}
              roots={inspectionObjects} topLevel={!inspectionTree.get(inspectionNode.id)?.parent}
              layoutChild={layoutChildren.has(inspectionNode.id)}
              movementActions={project.inputMap.actions.filter(action => action.kind === 'button').map(action => action.name)}
              globals={project.globals.items}
              physicsLayers={physicsSettings.layers} physicsFit={() => view.current?.physicsFit(inspectionNode.id)}
              locked={!!(inspectionNode.locked || inspectionTree.get(inspectionNode.id)?.inheritedLock)} inheritedLock={!!inspectionTree.get(inspectionNode.id)?.inheritedLock} toggleLock={toggleLock} flip={flip} pivotAt={setPivot}
              audioStatus={sourceStatuses.get(inspectionNode.id)} audioTransport={audioTransport}
              audioEnabled={inspectionNode.type === 'AudioSource' && isActive(scene.objects, inspectionNode.id)}
              playAudio={() => view.current?.app.audio.sources.play(inspectionNode.id)}
              stopAudio={() => view.current?.app.audio.sources.stop(inspectionNode.id)}
              restartParticles={id => view.current?.restartParticles(id)} sectionHistory={inspectorSections.current}
              readOnly={!editable}
              testEffect={!ready || busy || !scenePanel.open || scenePanel.minimized ||
                (liveActive && (!gameScene || (inspectionNode.type === 'Camera2D' ? inspectionNode.id !== gameScene.cameraId :
                  !inspectionTree.has(inspectionNode.id)))) ? undefined :
                effect => (liveActive ? liveView : view).current?.playEffectPreview(effect)}
              stopEffectTest={() => (liveActive ? liveView : view).current?.stopEffectPreview()}
              particlePresets={prefabEdit ? undefined : { items: project.particlePresets ?? [],
                change: particlePresets => updateProject(current => ({ ...current, version: 2, particlePresets })) }} />
            : <p className="empty"><CircleHelp size={16} aria-hidden="true" />{t('noSelection')}</p>}
        </fieldset>
      </aside>,

      assets: <AssetsPanel key={assetSession} ref={assetsPanel} catalog={catalog} scene={scene} referencedObjects={referencedObjects} editable={editable && !prefabEdit}
        canAssign={editable && singleEditable && selected?.type === 'Sprite'} audio={audio}
        packing={pack.packing} loaded={pack.loaded} error={pack.error}
        rebuild={development ? () => void pack.refresh(true) : undefined}
        importFiles={window.oliveFiles ? (folder, files) => void importAssets(folder, files) : undefined}
        bundlesOpen={bundlesOpen} toggleBundles={() => showBundles(!bundlesOpen)}
        createBundle={() => { showBundles(true); setBundleFocus(current => current + 1); }}
        onBundleSelectionChange={setBundleSelection} inspect={setInspection}
        mutate={mutateLibrary}
        assign={alias => updateSelected(node => node.type === 'Sprite' && node.texture !== alias ? { ...node, texture: alias } : node)}
        play={alias => view.current?.app.audio.play(alias)} stop={() => view.current?.app.audio.stop()}
        />,
      bundles: <AssetBundles key={`bundles-${assetSession}`} library={scene.assetLibrary} selection={bundleSelection}
        editable={editable && !prefabEdit} exportToDisk={window.oliveFiles ? exportBundles : undefined} mutate={mutateLibrary}
        focusRequest={bundleFocus} revealAsset={alias => {
          setPanelLayout(current => activeTab(current, current.panels.find(panel => panel.id === 'assets')!.dock) === 'assets' ?
            current : setPanelOpen(current, 'assets', true));
          assetsPanel.current?.reveal(alias);
        }} />,
      timeline: <TimelinePanel key={`${assetSession}:${sceneId}`} data={scene}
        targets={{ nodes: scene.objects, globals: project.globals.items, scenes: project.scenes.filter(item => item.id !== sceneId) }}
        selected={singleEditable ? selected : undefined} layoutChildren={layoutChildren} locked={locked}
        editable={editable} visible={timelineVisible} view={view} record={setRecording} prefabEditing={!!prefabEdit}
        change={changeTimeline} />,
      content: <GameContentPanel content={project.content ?? emptyContent} globals={project.globals} editable={editable && !prefabEdit}
        tabRequest={contentTabRequest}
        project={project} saveData={gameData => updateProject(current => ({ ...current, version: 2, gameData }))}
        language={gameLanguage} setLanguage={setGameLanguage} change={changeContent} report={reportContent}
        resetPreview={() => { liveView.current?.resetAchievementPreview(); liveView.current?.app.reload(); }}
        texts={[...tree.values()].flatMap(({ node }) => (node.type === 'Text' || node.type === 'BitmapText') && node.text.trim() && !node.text.includes('{@') ?
          [{ componentId: node.id, object: node.label, text: node.text }] : [])} makeKeys={makeLocalizationKeys} />,

      audioStudio: <AudioStudioPanel editable={editable && !prefabEdit} change={changeMixer} add={addGeneratedSound} report={reportContent}
        mix={{ ...(project.audioMix ?? defaultMixer), master: project.config.audio.volume, music: project.config.audio.music,
          sfx: project.config.audio.sfx, ui: project.config.audio.ui }}
        live={() => liveView.current?.app.audio.sources.levels() ?? null} />,
      ai: <AiStudio key={assetSession} editable={editable && !prefabEdit} skills={project.skills ?? emptySkills()}
        revision={scene.objects} applyEdits={actions => {
          if (!editable || prefabEdit) throw new Error(t('aiImportUnavailable'));
          if (actions.some(action => action.action === 'move' && layoutChildren.has(action.id))) throw new Error(t('aiLayoutManaged'));
          const objects = applyAssistantEdits(scene.objects, actions, locked);
          commit(current => current.objects === scene.objects ? { ...current, objects } : current);
        }}
        saveSkills={skills => updateProject(current => ({ ...current, version: 2, skills }))}
        projectContext={() => JSON.stringify({
          scene: sceneRecord(project, sceneId).name, viewport: authoredSize,
          scenes: project.scenes.map(record => ({ id: record.id, name: record.name })),
          objects: [...tree.values()].slice(0, 250).map(({ node, parent }) => ({ id: node.id, name: node.label, type: node.type, parent, position: node.position })),
        })}
        importFiles={files => {
          const entries = files.map(file => ({ alias: `project/${crypto.randomUUID()}/${file.name}`, data: file.data }));
          const assets = importedAssetsSchema.parse([...scene.assets, ...entries]);
          commit(current => ({ ...current, assets, assetLibrary: addLibraryEntries(current.assetLibrary, entries.map(item => item.alias), null, true) }));
        }} />,
      diagnostics: <DiagnosticsPanel />,

      shaders: <ShaderLibraryPanel editable={editable && !prefabEdit} library={project.shaders ?? emptyShaderLibrary()}
        selected={selected && singleEditable && !['Camera2D', 'AudioListener', 'AudioSource', 'Light2D'].includes(selected.type) ? selected : undefined}
        used={new Set([...selectionTree(referencedObjects).values()].flatMap(({ node }) => node.shader ? [node.shader.shaderId] : []))}
        change={changeShaders} bind={shader => updateSelected(node => ({ ...node, shader }))} />,

      scenes: <ScenesPanel project={playback ? gameProject : project} sceneId={playback ? playback.main : sceneId}
        editable={editable && !prefabEdit && !loadingPreview} playback={playback}
        open={editScene} add={createScene} rename={name => changeRecord(record => name === record.name ? record : { ...record, name })}
        setStartup={() => updateProject(current => ({ ...current, version: 2, startup: sceneId }))}
        remove={deleteScene} setLinks={update => changeRecord(record => ({ ...record, links: update(record.links) }))}
        changeWorld={world => updateProject(current => ({ ...current, version: 2, world }))}
        gameplay={<GameplayLab key={sceneId + ':' + selected?.id} selected={singleEditable && !selectedLocked ? selected : undefined}
          lab={project.gameplayLab ?? { version: 1, presets: [] }} apply={applyCharacter} platform={applyPlatform}
          store={gameplayLab => updateProject(current => ({ ...current, version: 2, gameplayLab }))} install={installCharacterKit}
          buttons={project.inputMap.actions.filter(action => action.kind === 'button').map(action => action.name)} />}
        preview={() => void startScenePreview('active')}
        navigate={navigateLink} goBack={() => setPlayback(current => current && popScene(current))} />,
      input: <InputPanel key={assetSession} map={project.inputMap} editable={editable && !prefabEdit}
        running={previewing} values={inputValues} visible={activeTab(panelLayout, inputDock) === 'input' && !hubOpen && !settingsOpen}
        globals={project.globals.items}
        change={inputMap => updateProject(current => ({ ...current, version: 2, inputMap }))} />,
      network: <MultiplayerPanel plan={network} editable={editable && !prefabEdit} server={networkServer} client={networkClient}
        error={networkError} busy={networkBusy}
        canSetup={!!selected && !tree.get(selected.id)?.parent && !selected.screenSpace && singleEditable &&
          (!network.template || network.template.node.id === selected.id) && !['Light2D', 'Camera2D', 'AudioSource', 'AudioListener'].includes(selected.type)}
        change={changeNetwork} setup={setupNetwork} action={(action, value) => void networkAction(action, value)} />,
      lighting: <LightingPanel lighting={scene.lighting} editable={editable && !prefabEdit}
        preview={lightingPreview} togglePreview={() => setLightingPreview(value => !value)}
        change={lighting => commit(current => ({ ...current, lighting }))}
        addLight={() => add({ ...createObject('Light2D'), position: selected?.type === 'Container' ? { x: 32, y: 32 } : {
          x: resolvedConfig.renderer.width / 2, y: resolvedConfig.renderer.height / 2,
        } })} />,
      physics: <PhysicsPanel settings={physicsSettings} editable={editable && !prefabEdit} debug={physicsDebug}
        status={physicsStatus} toggleDebug={() => setPhysicsDebug(current => !current)}
        layerInUse={[...selectionTree(referencedObjects).values()].some(({ node }) => node.physics?.body?.layer === physicsSettings.layers.length - 1)}
        change={physics => updateProject(current => ({ ...current, version: 2, physics }))}
        pause={paused => liveView.current?.app.physics.pause(paused)} step={() => liveView.current?.app.physics.step()} />,
      scripts: panelLayout.panels.some(panel => panel.id === 'scripts' && panel.open) ? <ScriptsPanel key={assetSession}
        tests={<TestStudio project={project} sceneId={sceneId} assets={assets} editable={editable && !previewing && !prefabEdit}
          save={tests => updateProject(current => current !== project ? current : { ...current, version: 2, tests,
            buildQuality: current.buildQuality && { ...current.buildQuality, requiredTests: current.buildQuality.requiredTests
              .filter(id => tests.items.some(test => test.id === id)) } })} />} /> : null,
      globals: <GlobalsPanel key={assetSession} definition={(previewing && liveActive ? gameProject : project).globals} values={globalValues}
        config={(previewing && liveActive ? gameProject : project).gameSave}
        editable={editable && !prefabEdit} playing={previewing && liveActive} change={editGlobals} setRevision={configureGameSave}
        setCurrent={(id, value) => liveView.current?.app.globals.set(id, value)} save={saveSlot} load={loadSlot} message={slotMessage} />,
      prefabs: <PrefabsPanel prefabs={project.prefabs} active={activePrefab} choose={setActivePrefabId}
        editable={editable} editing={!!prefabEdit} linked={linkedPrefab}
        canCapture={!!prefabCapture && project.prefabs.length < prefabLimit}
        canPlace={!prefabEdit || (prefabEdit.source.root.type === 'Container' && !!activePrefab &&
          !dependsOn(project.prefabs, activePrefab.id, prefabEdit.source.id))}
        capture={createPrefab} place={insertPrefab} edit={startPrefabEdit}
        variant={source => {
          const id = crypto.randomUUID();
          updateProject(current => ({ ...current, prefabs: [...current.prefabs, {
            ...source, id, base: source.id, name: t('prefabVariantName', { name: source.name.slice(0, 80) }),
          }] }));
          setActivePrefabId(id);
        }}
        apply={() => prefabInstanceAction('apply')} revert={() => prefabInstanceAction('revert')} unpack={() => prefabInstanceAction('unpack')}
        brushes={<Brushes items={project.brushes?.items ?? []} prefabs={project.prefabs} active={activeBrush} tilemap={selected?.type === 'Tilemap'}
          editable={editable && !prefabEdit} erase={brushErase} setErase={setBrushErase} select={setBrushId}
          edit={items => {
            const brushes = BrushesSchema.parse({ version: 1, items });
            updateProject(current => ({ ...current, version: 2, brushes }));
          }} />} />,
    }} />
    {searchOpen && <ProjectSearch project={project} assets={catalog.entries} close={() => setSearchOpen(false)} reveal={result => {
      if (result.kind === 'scene' || result.kind === 'object') {
        editScene(result.scene ?? result.id);
        setInspection([]);
        if (result.kind === 'object') select([result.id]);
        setPanelLayout(current => setPanelOpen(current, 'hierarchy', true));
      } else if (result.kind === 'asset') {
        setInspection([result.id]);
        setPanelLayout(current => setPanelOpen(setPanelOpen(current, 'inspector', true), 'assets', true));
        requestAnimationFrame(() => assetsPanel.current?.reveal(result.id));
      } else if (result.kind === 'script') {
        setPanelLayout(current => setPanelOpen(current, 'scripts', true));
        revealScript(result.id);
      } else if (result.kind === 'prefab') {
        setActivePrefabId(result.id);
        setPanelLayout(current => setPanelOpen(current, 'prefabs', true));
      } else {
        const tab = result.id.split(':')[0];
        if (tab === 'data' || tab === 'dialogues' || tab === 'achievements') requestContentTab({ tab });
        setPanelLayout(current => setPanelOpen(current, 'content', true));
      }
    }} />}
    {exportOpen && <ExportDialog project={project} title={fileName.replace(/\.json$/i, '')}
      assets={assets} close={() => setExportOpen(false)}
      saveQuality={buildQuality => updateProject(project => ({ ...project, version: 2, buildQuality }))} />}
    {settingsOpen && <Settings config={scene.config} profile={settingsProfile} onProfile={setSettingsProfile}
      saveError={fileError?.title === t('settingsSaveError') ? fileError.detail : undefined}
      onClose={() => setSettingsOpen(false)} onChange={(module, field, value) => commit(current => {
        const config = editSetting(current.config, settingsProfile, module, field, value);
        return config === current.config ? current : { ...current, config };
      })} />}
    {hubOpen && <Hub busy={busy} error={fileError ? `${fileError.title} ${fileError.detail}` : undefined}
      close={() => { setFileError(undefined); setHubOpen(false); }} create={() => void newHubProject()} open={chooseScene}
      history={window.oliveFiles && <ProjectHistoryPanel project={project} token={configDocument.current.token}
        dirty={dirty} open={file => void open(async () => file)} bridge={window.oliveFiles} />}
      autoRecovery={autoRecovery} setAutoRecovery={value => {
        setAutoRecovery(value);
        try { localStorage.setItem('olive.recovery.auto', value ? 'on' : 'off'); } catch { /* storage unavailable */ }
      }}
      saveRecovery={() => window.oliveFiles?.recovery.write(crypto.randomUUID(), fileName, serializeProject(project))}
      openRecovery={id => { if (window.oliveFiles) void open(() => window.oliveFiles!.recovery.open(id)); }}
      openRecent={id => {
        const hub = window.oliveFiles?.hub;
        if (hub) void open(() => hub.open(id));
      }} openExample={openExample} />}
    <Tooltips />
  </main></ScriptsProvider>;
}

document.documentElement.lang = locale;
document.title = t('windowTitle');
createRoot(document.getElementById('root')!).render(<Editor />);
