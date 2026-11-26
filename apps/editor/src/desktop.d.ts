type DesktopCommand = 'new' | 'open' | 'save' | 'undo' | 'redo' | 'settings' | 'hub' | 'export-game' | 'panel-reset' |
  `panel-${import('./panelLayout').PanelId}`;

type OpenedScene = { name: string; text: string; recentToken?: string; configText?: string; configToken?: string; recovered?: boolean };
type RecentScene = { id: string; name: string; path: string; lastOpened: number; pinned: boolean; exists: boolean };
type RecoveryCopy = { id: string; name: string; at: number };
type ProjectHistory = { repo: boolean; branch?: string; changed?: string; commits: { hash: string; timestamp: string; summary: string }[] };

interface Window {
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
      example(): Promise<OpenedScene>;
      remember(token: string): Promise<void>;
      action(id: string, action: 'pin' | 'remove' | 'reveal'): Promise<void>;
    };
    onCommand(callback: (command: DesktopCommand) => void): () => void;
  };
}
