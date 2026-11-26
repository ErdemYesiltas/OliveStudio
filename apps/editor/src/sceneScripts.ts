import type { PhysicsControls } from '@rewrite/physics/contracts';
import type { InputMap } from '@rewrite/input';
import { InteractionSession, type Globals, type InteractionEvent } from '@rewrite/interactions';
import { instrumentScript } from '@rewrite/scripts/compile';
import { behaviourType, type ScriptLibrary } from '@rewrite/scripts/contracts';
import { scriptDebugger } from '@rewrite/scripts/debug';
import { createSceneScripts, loadScriptEngine, type DebugHit, type ScriptHost, type ScriptSession } from '@rewrite/scripts/session';
import { scriptConsole } from '@rewrite/scripts/console';
import { behaviorLive, behaviorType } from '@rewrite/behavior';
import type { Container } from 'pixi.js';
import { logicEntities, logicTools } from './sceneLogic';
import type { GameContent } from './gameContent';
import type { Project } from './project';
import type { DialogueControls } from '@rewrite/dialogue';
import type { AchievementControls } from '@rewrite/achievements';
import type { PreviewGlobals } from './globals';
import type { PreviewInput } from './input';
import type { SceneObject } from './scene';

type PlayScene = { id: string; name: string };
let behaviorSession = 0;
export type ScriptPreviewOptions = {
  library: ScriptLibrary;
  scene: PlayScene;
  scenes: readonly PlayScene[];
  objects: SceneObject[];
  inputMap: InputMap;
  debug?: boolean;
  globals: Globals;
  content?: GameContent;
  production?: Project;
  seed?: number;
  changeScene: (id: string, mode: 'replace' | 'add' | 'remove' | 'push') => void;
  popScene?: () => void;
};

/** Preview owns the sandbox and its runtime-only projection of authored objects. */
export class SceneScripts {
  private session?: ScriptSession;
  private logic?: InteractionSession;
  private stopSession?: () => void;
  private hit?: DebugHit;
  private stepping = false;
  private halted = false;
  private events: InteractionEvent[] = [];
  private debug = false;
  get active() { return !!this.session || !!this.logic; }
  ready: Promise<void> = Promise.resolve();
  get paused() { return this.halted && !this.stepping; }
  activity(id: string) { return this.logic?.graphActivity()[id]; }

  start(
    options: ScriptPreviewOptions, input: PreviewInput, globals: PreviewGlobals,
    host: {
      display: (id: string) => Container | undefined;
      stage: { width: number; height: number };
      time: () => number;
      ready: () => void;
      clockPaused: () => boolean;
      physics?: PhysicsControls;
      camera?: import('@rewrite/scripts/session').ScriptHost['camera'];
      dialogue?: DialogueControls & ScriptHost['dialogue'];
      achievements?: AchievementControls;
    } & Pick<ScriptHost, 'language'>,
  ) {
    this.stop();
    this.ready = Promise.resolve();
    this.debug = options.debug ?? true;
    const { library, scene, scenes, objects, inputMap, changeScene } = options;
    const log = scriptConsole.log;
    const scripts = new Map(library.items.map(script => [script.id, script]));
    const canRun = (id: string, owner: string) => {
      const script = scripts.get(id);
      if (script?.code && !script.error) return true;
      log('error', `${owner}: ${script?.error ?? 'The attached script is missing or lacks compiled code.'}`);
      return false;
    };
    const entities = logicEntities(objects, host.display).map(entity => {
      entity.components = entity.components.filter(component =>
        (component.type !== behaviourType && component.type !== behaviorType) ||
        canRun((component.data as { scriptId: string }).scriptId, entity.name));
      return entity;
    });
    const sceneBehaviour = library.scenes?.[scene.id];
    const activeScene = sceneBehaviour?.scriptId && canRun(sceneBehaviour.scriptId, scene.name) ? sceneBehaviour : undefined;
    const hasMachines = entities.some(entity => entity.components.some(c => c.type === behaviorType));
    const hasScripts = activeScene || hasMachines || entities.some(entity => entity.components.some(c => c.type === behaviourType));
    const hasLogic = entities.some(entity => entity.components.some(c => c.type === 'interactions.graph'));
    if (!hasScripts && !hasLogic) return () => {};
    const playable = { ...library, scenes: activeScene ? { [scene.id]: activeScene } : undefined };
    let cancelled = false;
    let detachDebugger: (() => void) | undefined;
    let liveSession: number | undefined;
    const store = globals.runtimeStore;
    let actorControls: import('@rewrite/behavior/contracts').BehaviorControls | undefined;
    const setActive = (id: string, active: boolean) => { const item = host.display(id); if (item) item.visible = active; };
    if (hasLogic) {
      const { actions } = logicTools(options.content, { dialogue: host.dialogue, achievements: host.achievements, behavior: () => actorControls });
      this.logic = new InteractionSession(() => entities, actions, {
        globals: store, time: host.time, physics: host.physics, camera: host.camera,
        setActive, setLanguage: host.language?.set,
        changeScene: id => changeScene(id, 'replace'),
        addScene: id => changeScene(id, 'add'), removeScene: id => changeScene(id, 'remove'),
        invoke: () => { throw new Error('This service is unavailable in logic graphs'); },
      }, message => log('error', message));
      this.logic.emit({ type: 'scene.start', sourceId: scene.id, silent: false });
      this.logicReady = !hasScripts;
    }
    const stop = () => {
      cancelled = true;
      this.stopSession = undefined;
      detachInput();
      detachDebugger?.();
      globalSubscription?.unsubscribe();
      this.session?.dispose();
      this.session = undefined;
      this.logic?.dispose();
      this.logic = undefined;
      this.logicReady = false;
      this.hit = undefined;
      this.stepping = false;
      this.halted = false;
      this.events = [];
      if (liveSession !== undefined && behaviorLive.controller?.session === liveSession) behaviorLive.attach(null);
      if (this.debug && scriptDebugger.controller) scriptDebugger.attach(null);
    };
    const detachInput = input.subscribe(({ id, pressed }) => this.enqueue({ sourceId: id, type: pressed ? 'input.pressed' : 'input.released', silent: false }));
    const globalSubscription = store?.changes$.subscribe(event => this.enqueue({ sourceId: event.id, type: 'global.change', silent: event.silent }));
    this.stopSession = stop;
    if (hasScripts) this.ready = Promise.all([loadScriptEngine(), hasMachines ? import('@rewrite/behavior-xstate') : undefined]).then(([module, machine]) => {
      if (cancelled) return;
      const session = createSceneScripts(module, playable, scene, {
        entities: () => entities,
        stage: host.stage,
        time: host.time,
        names: { scenes, actions: inputMap.actions, globals: options.globals.items },
        globals: store,
        seed: options.seed,
        physics: host.physics,
        changeScene: id => changeScene(id, 'replace'),
        pushScene: id => changeScene(id, 'push'),
        popScene: options.popScene,
        camera: host.camera,
        dialogue: host.dialogue,
        achievements: host.achievements,
        language: host.language,
        extensions: machine ? [machine.xstateBehaviorExtension] : [],
        addScene: id => changeScene(id, 'add'),
        removeScene: id => changeScene(id, 'remove'),
        setActive,
        emit: event => this.logic?.emit(event),
        invoke: () => { throw new Error('This service is unavailable in scripts'); },
        log,
      }, message => log('error', message));
      this.session = session;
      actorControls = machine?.behaviorControls(() => session);
      this.logicReady = true;
      host.ready();
      if (!this.debug) return;
      if (actorControls) {
        const controls = actorControls;
        liveSession = ++behaviorSession;
        behaviorLive.attach({
          session: liveSession,
          inspect: controls.inspect,
          send: (id, event) => {
            controls.send(id, event);
            const actor = controls.inspect(id)[0];
            if (!actor) throw new Error('Object has no running state machine');
            return actor;
          },
          checkpoint: (entityId, value) => session.provider(behaviorType, value === undefined ? 'checkpoint' : 'restore', { entityId, value }),
          paused: () => host.clockPaused() || this.paused,
          time: host.time,
        });
      }
      this.configureDebugger();
      scriptDebugger.attach({
        paused: () => this.paused,
        resume: () => { this.hit = undefined; this.halted = false; scriptDebugger.setHit(null); },
        step: () => { this.stepping = true; },
        instances: () => session.instances(),
        watch: expressions => session.watch(expressions),
      });
      let settings = this.debugSettings();
      detachDebugger = scriptDebugger.subscribe(() => {
        const next = this.debugSettings();
        if (next === settings) return;
        settings = next;
        this.configureDebugger();
      });
    }).catch(error => {
      if (!cancelled) {
        this.logicReady = true;
        log('error', error instanceof Error ? error.message : String(error));
      }
    });
    return () => { if (this.stopSession === stop) this.stop(); };
  }

  private debugSettings() { return JSON.stringify([[...scriptDebugger.breakpoints], scriptDebugger.watches]); }

  private configureDebugger() {
    const valid = this.session?.debug({
      breakpoints: scriptDebugger.breakpoints,
      watches: scriptDebugger.watches,
      build: instrumentScript,
      hit: hit => { this.hit ??= hit; },
    });
    if (valid) scriptDebugger.setValid(valid);
  }

  enqueue(event: InteractionEvent) {
    this.logic?.emit(event);
    if (this.events.length < 1_000) this.events.push(event);
  }

  broadcast(message: string, data: string) {
    this.enqueue({ type: 'timeline.message', sourceId: message, event: data, silent: false });
  }

  pointer(phase: 'down' | 'move' | 'up', x: number, y: number) {
    if (this.paused || this.stepping) return;
    this.session?.pointer(phase, x, y);
    if (this.hit) { this.halted = true; scriptDebugger.setHit(this.hit); }
  }

  private logicReady = false;

  tick(dt: number) {
    if (this.paused) return;
    if (!this.session) {
      if (this.logicReady) { this.logic?.flush(); this.events = []; }
      return;
    }
    this.hit = undefined;
    const events = this.events;
    this.events = [];
    for (const event of events) {
      if (event.type === 'timeline.message') this.session.broadcast(event.sourceId, event.event || null);
      else this.session.observe(event);
    }
    this.session.system.update?.(dt);
    this.logic?.flush();
    const stepped = this.stepping;
    this.halted = stepped || !!this.hit;
    this.stepping = false;
    if (this.hit || stepped) scriptDebugger.setHit(this.hit ?? null);
  }

  stop() { this.stopSession?.(); }
}
