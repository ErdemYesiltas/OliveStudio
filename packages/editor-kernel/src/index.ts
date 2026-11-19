import { ManifestSchema, commands, type EditorModule, type Diagnostic, type Dispose, type Slot, type Token } from '@rewrite/sdk';
import { satisfies, valid, validRange } from 'semver';

interface Entry { owner: string; id: string; value: unknown }
interface Scope { abort: AbortController; cleanup: Dispose[] }
export type ModuleState = 'pending' | 'active' | 'failed' | 'blocked' | 'stopped';

/** No domain imports: all feature construction happens in the composition root. */
export class ModuleHost {
  private contributions = new Map<string, Entry[]>();
  private services = new Map<string, Entry>();
  private scopes = new Map<string, Scope>();
  private order: string[] = [];
  private phase: 'new' | 'starting' | 'ready' | 'stopping' | 'stopped' = 'new';
  private shutdown: Promise<void> | undefined;
  private boot: Promise<void> | undefined;
  private requestedStop = false;
  private activating: Scope | undefined;
  private moduleVersions=new Map<string,string>();
  get versions():ReadonlyMap<string,string>{return new Map([...this.states].filter(([,state])=>state==='active').map(([id])=>[id,this.moduleVersions.get(id)!]));}
  readonly states = new Map<string, ModuleState>();
  readonly diagnostics: Diagnostic[] = [];

  start(input: readonly EditorModule[]): Promise<void> {
    if (this.boot || this.phase !== 'new') return Promise.reject(new Error('Host may only start once'));
    this.boot = this.activateAll(input); return this.boot;
  }
  private async activateAll(input: readonly EditorModule[]): Promise<void> {
    const modules = new Map<string, EditorModule>();
    for (const module of input) {
      const manifest = ManifestSchema.parse(module.manifest);
      if (!valid(manifest.version)) throw new Error(`Invalid version: ${manifest.id}`);
      if (modules.has(manifest.id)) throw new Error(`Duplicate module: ${manifest.id}`);
      modules.set(manifest.id, { ...module, manifest });this.moduleVersions.set(manifest.id,manifest.version);
    }
    const order: string[] = [], visiting = new Set<string>(), visited = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw new Error(`Dependency cycle: ${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      const m = modules.get(id)!.manifest;
      for (const [dep, range] of Object.entries({ ...m.optional, ...m.requires })) {
        if (!validRange(range)) throw new Error(`Invalid dependency range: ${id}/${dep}`);
        const target = modules.get(dep);
        if (!target) { if (dep in (m.requires ?? {})) throw new Error(`Missing dependency: ${id}/${dep}`); continue; }
        if (!satisfies(target.manifest.version, range)) throw new Error(`Incompatible dependency: ${id}/${dep}`);
        visit(dep);
      }
      visiting.delete(id); visited.add(id); order.push(id);
    };
    for (const id of modules.keys()) visit(id);
    this.phase = 'starting';
    for (const id of order) this.states.set(id, 'pending');
    for (const id of order) {
      if (this.requestedStop) { this.states.set(id, 'stopped'); continue; }
      const module = modules.get(id)!;
      if (Object.keys(module.manifest.requires ?? {}).some(dep => this.states.get(dep) !== 'active')) {
        this.states.set(id, 'blocked'); this.diagnostics.push({ owner: id, severity: 'error', message: 'Required module failed to activate' }); continue;
      }
      const scope: Scope = { abort: new AbortController(), cleanup: [] }; this.activating = scope;
      const pendingServices = new Map<string, Entry>();
      const pendingContributions = new Map<string, Entry[]>();
      let open = true;
      const assertOpen = () => { if (!open || scope.abort.signal.aborted) throw new Error(`Module registration scope closed: ${id}`); };
      try {
        const dispose = await module.activate({
          id, signal: scope.abort.signal,
          provide: <T>(key: Token<T>, service: T) => {
            assertOpen();
            if (key.owner !== id) throw new Error(`Service ownership: ${key.id}`);
            if (pendingServices.has(key.id) || this.services.has(key.id)) throw new Error(`Duplicate service: ${key.id}`);
            pendingServices.set(key.id, { id: key.id, owner: id, value: service });
          },
          get: <T>(key: Token<T>): T => {
            const declared = key.owner === id || key.owner in (module.manifest.requires ?? {}) || key.owner in (module.manifest.optional ?? {});
            if (!declared) throw new Error(`Undeclared dependency: ${id}/${key.owner}`);
            const entry = pendingServices.get(key.id) ?? this.services.get(key.id);
            if (!entry || entry.owner !== key.owner || scope.abort.signal.aborted) throw new Error(`Service unavailable: ${key.id}`);
            return entry.value as T;
          },
          contribute: <T>(target: Slot<T>, name: string, value: T) => {
            assertOpen();
            if (!name.startsWith(id + '.')) throw new Error(`Contribution must be namespaced by ${id}`);
            const entries = pendingContributions.get(target.id) ?? [];
            if ([...entries, ...(this.contributions.get(target.id) ?? [])].some(e => e.id === name)) throw new Error(`Duplicate contribution: ${name}`);
            entries.push({ owner: id, id: name, value }); pendingContributions.set(target.id, entries);
          },
          own: cleanup => { assertOpen(); scope.cleanup.push(cleanup); },
          report: (message, severity = 'error') => { this.diagnostics.push({ owner: id, message, severity }); },
        });
        if (dispose) scope.cleanup.push(dispose);
        if (scope.abort.signal.aborted) throw new Error('Activation cancelled');
        open = false;
        for (const [key, value] of pendingServices) this.services.set(key, value);
        for (const [key, entries] of pendingContributions) this.contributions.set(key, [...(this.contributions.get(key) ?? []), ...entries]);
        this.scopes.set(id, scope); this.order.push(id); this.states.set(id, 'active');
      } catch (error) {
        open = false; scope.abort.abort();
        for (const dispose of scope.cleanup.reverse()) { try { await dispose(); } catch (cleanupError) { this.record(id, cleanupError); } }
        this.states.set(id, 'failed'); this.record(id, error);
      }
    }
    this.activating = undefined; this.phase = this.requestedStop ? 'stopping' : 'ready';
  }
  private record(owner: string, error: unknown): void { this.diagnostics.push({ owner, severity: 'error', message: String(error) }); }
  entries<T>(target: Slot<T>): readonly { id: string; owner: string; value: T }[] {
    return (this.contributions.get(target.id) ?? []).map(entry => ({ ...entry, value: entry.value as T }));
  }
  async execute(id: string, input?: unknown): Promise<unknown> {
    if (this.phase !== 'ready') throw new Error('Host is not ready');
    const command = this.entries(commands).find(entry => entry.id === id)?.value;
    if (!command) throw new Error(`Unknown command: ${id}`);
    return command.execute(command.parse ? command.parse(input) : input);
  }
  stop(): Promise<void> {
    this.requestedStop = true; this.activating?.abort.abort();
    for (const scope of this.scopes.values()) scope.abort.abort();
    return this.shutdown ??= (this.boot ?? Promise.resolve()).catch(() => {}).then(() => this.stopAll());
  }
  private async stopAll(): Promise<void> {
    this.phase = 'stopping';
    for (const id of [...this.order].reverse()) {
      const scope = this.scopes.get(id)!; scope.abort.abort();
      for (const dispose of scope.cleanup.reverse()) { try { await dispose(); } catch (error) { this.record(id, error); } }
      for (const [key, entry] of this.services) if (entry.owner === id) this.services.delete(key);
      for (const [key, entries] of this.contributions) this.contributions.set(key, entries.filter(entry => entry.owner !== id));
      this.states.set(id, 'stopped');
    }
    this.scopes.clear(); this.order = []; this.phase = 'stopped';
  }
}
