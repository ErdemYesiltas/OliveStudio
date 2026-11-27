type DesktopCommand = 'new' | 'open' | 'save' | 'undo' | 'redo' | 'settings' | 'search' | 'hub' | 'export-game' | 'panel-reset' |
  `panel-${import('./panelLayout').PanelId}`;

type HostWorkspaceState = { scene: string; selection: string[]; inspection: string[] };

type OpenedScene = { name: string; text: string; recentToken?: string; configText?: string; configToken?: string; recovered?: boolean; revision?: number; workspaceState?: HostWorkspaceState };
type RecentScene = { id: string; name: string; path: string; lastOpened: number; pinned: boolean; exists: boolean };
type RecoveryCopy = { id: string; name: string; at: number };
type ProjectHistory = { repo: boolean; branch?: string; changed?: string; commits: { hash: string; timestamp: string; summary: string }[] };

interface Window {
  oliveHost?: {
    bound: boolean;
    onCanvasAction(callback: (action: import('./vscodeCanvas').CanvasAction) => void): () => void;
    publishCanvasState(state: unknown): Promise<void>;
    panels(): Promise<import('./panelLayout').PanelId[]>;
    publishDebugState(state: import('./vscodeDebug').DebugSnapshot): Promise<void>;
    onDebugAction(callback: (action: import('./vscodeDebug').DebugAction) => void): () => void;
    onPrefabEdit(callback: (id: string) => void): () => void;
    focusView(id: import('./panelLayout').PanelId): Promise<void>;
    onPanels(callback: (ids: import('./panelLayout').PanelId[]) => void): () => void;
    updateWorkspace(state: HostWorkspaceState): Promise<void>;
    onWorkspace(callback: (state: HostWorkspaceState) => void): () => void;
    acceptDocument(revision: number): Promise<void>;
    travel(direction: 'undo' | 'redo'): Promise<void>;
    onPreview(callback: (from: 'startup' | 'active') => void): () => void;
    onTimeline(callback: (command: import('./TimelinePanel').TimelinePreviewCommand) => void): () => void;
    initial(): Promise<OpenedScene | { blank: true } | { sample: true } | null>;
    edit(text: string): Promise<void>;
    onDocument(callback: (file: OpenedScene) => void): () => void;
    onSaved(callback: (text: string) => void): () => void;
    confirm(message: string): Promise<boolean>;
    newProject(): Promise<void>;
    example(): Promise<void>;
  };
  oliveFiles?: {
    open(): Promise<OpenedScene | null>;
    save(name: string, text: string): Promise<{ name: string; configToken: string } | null>;
    saveConfig(token: string | undefined, draft: string, text: string): Promise<void>;
    importTranslations(): Promise<{ name: string; folder: string; text: string }[]>;
    exportTranslations(files: { name: string; text: string }[]): Promise<string | null>;
    importAssets(files?: File[]): Promise<{ alias: string; data: string; media?: import('./assets').EmbeddedMedia }[]>;
    network(action: 'status' | 'stop' | 'start' | 'client' | 'latency' | 'drop', value?: string | number):
      Promise<import('@rewrite/multiplayer/contracts').ServerStatus>;
    exportGame(text: string, options: import('./exportReport').ExportOptions): Promise<{
      path: string; name: string; bytes: number; textureBytes?: number; issues: import('./exportReport').ExportIssue[];
    } | null>;
    exportTargets(): Promise<import('./exportReport').ExportTargetInfo[]>;
    exportBundles(assets: { alias: string; data: string; bundle: string; media?: import('./assets').EmbeddedMedia }[]): Promise<string | null>;
    exportSpineFiles(asset: { alias: string; data: string; media?: import('./assets').EmbeddedMedia }, format?: 'runtime' | 'project' | 'binary'): Promise<string | null>;
    convertSpineBinary(asset: { alias: string; data: string; media?: import('./assets').EmbeddedMedia }): Promise<string>;
    spineLauncher?(action: 'status' | 'choose' | 'reset' | 'test'): Promise<{
      path: string | null; configured: string | null;
      test?: { state: 'ready'; version: string } | { state: 'notActivated' | 'unavailable' };
    }>;
    history(token: string, action: 'status'): Promise<ProjectHistory>;
    history(token: string, action: 'init' | 'commit', message?: string): Promise<boolean>;
    history(token: string, action: 'show', hash: string): Promise<OpenedScene>;
    ai: {
      models(provider: 'lm', url: string): Promise<import('@rewrite/ai-lm/contracts').LmStatus>;
      models(provider: 'comfy', url: string): Promise<import('@rewrite/ai-comfy/contracts').ComfyStatus & { checkpoints: string[] }>;
      run(id: string, provider: 'lm', url: string, request: import('@rewrite/ai-lm/contracts').ChatRequest): Promise<import('@rewrite/ai-lm/contracts').ChatResult>;
      run(id: string, provider: 'comfy', url: string, request: import('@rewrite/ai-comfy/contracts').Workflow): Promise<{ name: string; data: string }[]>;
      cancel(id: string): Promise<void>;
    };
    localHub: import('@rewrite/ai-hub/contracts').HubPort & { available(): Promise<boolean> };
    recovery: {
      list(): Promise<RecoveryCopy[]>;
      write(id: string, name: string, text: string): Promise<void>;
      open(id: string): Promise<OpenedScene | null>;
      remove(id: string): Promise<void>;
    };
    hub: {
      list(): Promise<RecentScene[]>;
      open(id: string): Promise<OpenedScene | null>;
      example(id?: 'gallery' | 'theatre' | 'tavern' | 'photo' | 'rig'): Promise<OpenedScene>;
      remember(token: string): Promise<void>;
      action(id: string, action: 'pin' | 'remove' | 'reveal'): Promise<void>;
    };
    onCommand(callback: (command: DesktopCommand) => void): () => void;
  };
}

// Pixi's side-effect entry replaces dynamic shader generation in CSP-restricted webviews.
declare module 'pixi.js/unsafe-eval';
