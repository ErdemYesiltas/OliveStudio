import { LiveProfiler } from './liveProfiler';
import type { ProfileRecorder } from '@rewrite/profiler';
import { RuntimeSession } from '@olivestudio/engine/runtime';
import { ProductionRuntime } from '@rewrite/production-tools/runtime';
import { sections } from '@rewrite/production-tools/contracts';
import { scriptConsole } from '@rewrite/scripts/console';
import { logicEntities } from './sceneLogic';
import { parseGameData, type GameData } from './gameData';
import type { NetStatus } from '@rewrite/multiplayer/contracts';
import type { NetworkPlan } from './networkModel';
import { SceneMultiplayer } from './sceneMultiplayer';
import { duplicateContent } from './prefabs';
import { cameraInScene } from './project';
import type { Lighting } from '@rewrite/lighting';
import { SceneLighting } from './sceneLighting';
import { colliderOutlines } from '@rewrite/physics';
import type { PhysicsSettings } from '@rewrite/physics/contracts';
import { physicsEntities, PreviewPhysics, type PhysicsStatus } from './scenePhysics';
import { SceneScripts, type ScriptPreviewOptions } from './sceneScripts';
import { gridLines } from '@rewrite/render-pixi/grid';
import { guideTargets, snapToGuides, type GuideBox, type GuideLine, type GuideTargets } from '@rewrite/render-pixi/guides';
import { computeLayout } from '@olivestudio/engine/scale-layout';
import { applyCameraShake, cameraControls, cameraProjection, cameraView, idleCamera, viewPlacement, type CameraView } from '@olivestudio/engine/runtime-camera';
import { CameraPlugin, CameraStrategy, type Camera, type CameraService } from '@olivestudio/engine/camera';
import { ScenePlugin, cancelSceneTransition, sceneTransition, type AppScreen, type SceneManager,
  type SceneTransition } from '@olivestudio/engine/scenes';
import { screenOffset, type ScreenSpace } from '@olivestudio/engine/screen';
import { SceneLayout } from '@rewrite/layout/apply';
import { createEffectsDecorator } from '@rewrite/render-pixi/effects';
import { effectTypesFor, isModulation, objectModulations, ObjectModulationEffect } from './objectEffects';
import { alternateTestZoom, type EffectPreview } from './effectPreview';
import { shaderType, type ShaderLibrary } from '@rewrite/render-pixi/shaders';
import { createWidget, widgetGlobalType } from '@olivestudio/engine/widgets';
import type { InputMap } from '@rewrite/input';
import type { Globals } from '@rewrite/interactions';
import { createLanguageStore, type LanguageStore, type Localization } from '@rewrite/interactions';
import { memoryStore, type AchievementStore } from '@rewrite/achievements';
import { startGameContent, type GameContent } from './gameContent';
import { layoutManaged } from '@rewrite/layout/contracts';
import { AperionDirector, type DirectorControl } from '@olivestudio/engine/aperion-director';
import {
  Application, BitmapText, CanvasSource, Container, ExtensionType, Graphics, ImageSource, Matrix, NineSliceSprite, RenderTexture, Sprite, Text, Texture, Ticker, TilingSprite, extensions,
} from 'pixi.js';
import { EditorAudio, type AudioStatus, type SourceStatus } from './audio';
import type { Asset } from './assets';
import { loadAnimation, type AnimationSource } from './animationAssets';
import { SceneAnimation, type AnimationObject } from './sceneAnimation';
import { t } from './i18n';
import { SceneParticles } from './sceneParticles';
import { meshPlane, meshRope, tilemap } from './objectVisuals';
import { configRegistry, type AudioSourceObject, type ResolvedSceneConfig, type Scene, type SceneObject } from './scene';
import type { PreviewProfile } from './Settings';
import type { ViewportGrid } from './viewportGrid';
import { drawGizmo, drawOriginMarkers, toolColors, type GizmoHandle, type Tool } from './viewportGizmo';
import { type ClockApplicationOptions, type GameClockControls } from '@olivestudio/engine/core-clock';
import '@olivestudio/engine/core-clock';
import { applyTween, audioTween, authoredValue, defaultTransport, timelineStep, timelineStrategy, type TimelineTransport, type TweenProperty } from './timeline';
import { crossedCues, sampleClip, type Cue, type DirectedClip, type OnionSkin, type TweenPose } from './cinematics';
import { boxBetween, selectionTree, unionBoxes } from './selection';
import { layoutEntities } from './layout';
import { PreviewInput, type InputValues } from './input';
import { globalText, PreviewGlobals, type GlobalValues } from './globals';

type PrototypeOptions = {
  config: ResolvedSceneConfig;
  editor?: boolean;
  sourceFor: (alias: string) => string | undefined;
  publishAudio: (status: AudioStatus) => void;
  publishSource: (id: string, status?: SourceStatus) => void;
  onReload?: () => void;
};

type PrototypeInitOptions = ClockApplicationOptions & { olivePrototype?: PrototypeOptions };

export class PrototypeApplication extends Application implements GameClockControls {
  declare readonly cameras: CameraService;
  declare readonly scene: SceneManager;
  declare readonly clock: GameClockControls['clock'];
  declare pause: GameClockControls['pause'];
  declare resume: GameClockControls['resume'];
  declare step: GameClockControls['step'];
  declare unload: GameClockControls['unload'];
  declare reload: GameClockControls['reload'];
  declare speed: GameClockControls['speed'];
  declare readonly audio: EditorAudio;
  declare readonly particles: SceneParticles;
  declare readonly director: AperionDirector;
  declare readonly input: PreviewInput;
  declare readonly globals: PreviewGlobals;
  declare readonly scripts: SceneScripts;
  declare readonly physics: PreviewPhysics;
  declare readonly lighting: SceneLighting;
  declare readonly multiplayer: SceneMultiplayer;
}

class AudioExtension {
  static extension = ExtensionType.Application;

  static init(this: Application, { olivePrototype }: PrototypeInitOptions) {
    if (!(this instanceof PrototypeApplication) || !olivePrototype) return;
    const { config, sourceFor, publishAudio, publishSource } = olivePrototype;
    Object.defineProperty(this, 'audio', {
      value: new EditorAudio(config.audio, sourceFor, publishAudio, publishSource),
      configurable: true,
    });
  }

  static destroy(this: Application) {
    if (this instanceof PrototypeApplication) {
      this.audio?.destroy();
      Reflect.deleteProperty(this, 'audio');
    }
  }
}

class ParticlesExtension {
  static extension = ExtensionType.Application;

  static init(this: Application) {
    if (this instanceof PrototypeApplication) {
      Object.defineProperty(this, 'particles', { value: new SceneParticles(), configurable: true });
    }
  }

  static destroy(this: Application) {
    if (this instanceof PrototypeApplication) {
      this.particles?.destroy();
      Reflect.deleteProperty(this, 'particles');
    }
  }
}

class DirectorExtension {
  static extension = ExtensionType.Application;

  static init(this: Application) {
    if (!(this instanceof PrototypeApplication)) return;
    const director = new AperionDirector(this);
    director.registerStrategy(timelineStrategy);
    director.registerStrategy(new CameraStrategy());
    Object.defineProperty(this, 'director', { value: director, configurable: true });
  }

  static destroy(this: Application) {
    if (this instanceof PrototypeApplication) {
      this.director?.stop();
      Reflect.deleteProperty(this, 'director');
    }
  }
}

class InputExtension {
  static extension = ExtensionType.Application;

  static init(this: Application) {
    if (this instanceof PrototypeApplication) Object.defineProperty(this, 'input', { value: new PreviewInput(this), configurable: true });
  }

  static destroy(this: Application) {
    if (this instanceof PrototypeApplication) {
      this.input?.stop();
      Reflect.deleteProperty(this, 'input');
    }
  }
}

class GlobalsExtension {
  static extension = ExtensionType.Application;

  static init(this: Application) {
    if (this instanceof PrototypeApplication) Object.defineProperty(this, 'globals', { value: new PreviewGlobals(), configurable: true });
  }

  static destroy(this: Application) {
    if (this instanceof PrototypeApplication) {
      this.globals?.stop();
      Reflect.deleteProperty(this, 'globals');
    }
  }
}

class ScriptsExtension {
  static extension = ExtensionType.Application;

  static init(this: Application) {
    if (this instanceof PrototypeApplication) Object.defineProperty(this, 'scripts', { value: new SceneScripts(), configurable: true });
  }

  static destroy(this: Application) {
    if (this instanceof PrototypeApplication) {
      this.scripts?.stop();
      Reflect.deleteProperty(this, 'scripts');
    }
  }
}

class PhysicsExtension {
  static extension = ExtensionType.Application;

  static init(this: Application) {
    if (this instanceof PrototypeApplication) Object.defineProperty(this, 'physics', { value: new PreviewPhysics(), configurable: true });
  }

  static destroy(this: Application) {
    if (this instanceof PrototypeApplication) {
      this.physics?.stop();
      Reflect.deleteProperty(this, 'physics');
    }
  }
}

class LightingExtension {
  static extension = ExtensionType.Application;

  static init(this: Application) {
    if (this instanceof PrototypeApplication) Object.defineProperty(this, 'lighting', { value: new SceneLighting(), configurable: true });
  }

  static destroy(this: Application) {
    if (this instanceof PrototypeApplication) {
      this.lighting?.destroy();
      Reflect.deleteProperty(this, 'lighting');
    }
  }
}

class MultiplayerExtension {
  static extension = ExtensionType.Application;

  static init(this: Application) {
    if (this instanceof PrototypeApplication) Object.defineProperty(this, 'multiplayer', { value: new SceneMultiplayer(), configurable: true });
  }

  static destroy(this: Application) {
    if (this instanceof PrototypeApplication) {
      this.multiplayer?.stop();
      Reflect.deleteProperty(this, 'multiplayer');
    }
  }
}

extensions.add(CameraPlugin, ScenePlugin, AudioExtension, ParticlesExtension, DirectorExtension, InputExtension,
  GlobalsExtension, ScriptsExtension, PhysicsExtension, LightingExtension, MultiplayerExtension);

type AnimationEntry = { asset: Asset; source?: AnimationSource; failed?: true };
type TextureEntry = { texture?: Texture; failed?: true };
type Point = { x: number; y: number };
export const viewportZoom = { min: 0.25, max: 4, step: 1.25 };
const zoomWithinRange = (value: number) => Math.min(viewportZoom.max, Math.max(viewportZoom.min, value));
export type TransformPatch = Partial<Pick<SceneObject, 'position' | 'rotation' | 'scale' | 'skew'>>;
export type ObjectTransform = { id: string; patch: TransformPatch };
export type EditView = 'normal' | 'camera';
export type GameSceneView = {
  id: string;
  cameraId?: string;
  transition?: SceneTransition;
  transitionLayer?: { rootIds: readonly string[]; exit: boolean };
};

function isVisible(display: Container) {
  for (let item: Container | null = display; item; item = item.parent) {
    if (!item.visible || item.alpha === 0) return false;
  }
  return true;
}

export class SceneView {
  private language?: LanguageStore;
  private runningContent?: ReturnType<typeof startGameContent>;
  private readonly previewProgress = memoryStore();
  private readonly textures = new Map<string, TextureEntry>();
  private readonly animationSources = new Map<string, AnimationEntry>();
  private readonly animations = new Map<string, SceneAnimation>();
  private assets = new Map<string, Asset>();
  private objects: SceneObject[] = [];
  private readonly placeholder: Texture;
  private readonly displays = new Map<string, Container>();
  private readonly authored = new Map<string, SceneObject>();
  private initialGlobals: GlobalValues = {};
  private textGlobals: GlobalValues = {};
  private widgetGlobals = new Map<string, Globals['items'][number]>();
  private readonly widgets = new Map<string, ReturnType<typeof createWidget>>();
  private shaders?: ShaderLibrary;
  private readonly effects = createEffectsDecorator({ shaders: () => this.shaders, shaderTime: () => this.gameTime });
  private readonly flex: SceneLayout;
  private flexChildren = new Set<string>();
  private readonly world = new Container();
  private readonly hud = new Container();
  private readonly sceneSurface: AppScreen = new Container();
  private readonly sceneCamera: Camera;
  private transitionSequence = 0;
  private transitioning = false;
  private transitionFrame?: { surface: AppScreen; texture: RenderTexture; hidden: Container[] };
  private readonly hudAnchors: { container: Container; anchor: ScreenSpace['anchor'] }[] = [];
  private authoredSize = { width: 960, height: 540 };
  private gameScene?: GameSceneView;
  private gameCamera = idleCamera();
  private gameTime = 0;
  private profiler?: LiveProfiler;
  private productionDocument: ReturnType<ConstructorParameters<typeof ProductionRuntime>[0]>['extensions'] = {};
  private readonly production = new ProductionRuntime(() => ({ extensions: this.productionDocument }),
    action => this.app.input.snapshot()[action] === true);
  private productionClock?: RuntimeSession;
  private suspended = false;
  private gameView?: CameraView;
  private renderedCameraView?: CameraView;
  private editView: EditView = 'normal';
  private readonly groups = new Set<string>();
  private readonly outline = new Graphics();
  private readonly grid = new Graphics();
  private readonly physicsDebug = new Graphics();
  private physicsOutlines: ReturnType<typeof colliderOutlines> = [];
  private showColliders = false;
  private readonly guides = new Graphics();
  private readonly audioRanges = new Graphics();
  private readonly audioNodes: (AudioSourceObject | Extract<SceneObject, { type: 'AudioListener' }>)[] = [];
  private gridSettings?: ViewportGrid;
  private selected: string | null = null;
  private selectedIds: readonly string[] = [];
  private locked = new Set<string>();
  private tool: Tool = 'select';
  private handles: GizmoHandle[] = [];
  private quickTools?: HTMLDivElement;
  private quickBounds?: GuideBox;
  private previewInset = { x: 0, y: 0 };
  private presentation = { width: 0, height: 0, insetX: 0, insetY: 0 };
  private camera = { x: 0.5, y: 0.5, zoom: 1 };
  private draft?: readonly ObjectTransform[];
  private timeline?: { clip: DirectedClip; time: number; pose: TweenPose };
  private readonly onions = new Container();
  private onion?: OnionSkin;
  private onionFrame = -1;
  private editorLighting = true;
  private readonly editorTicker?: Ticker;
  private particlePreview?: string;
  private effectPreview?: { effect: EffectPreview; elapsed: number; zoomFrom?: number };
  private liveEffectTicker?: Ticker;
  private readonly netCopies = new Map<string, { node: SceneObject; ids: Set<string> }>();
  private readonly netVisibility = new Map<string, boolean>();
  private networkTemplate?: string;
  private readonly cueVisibility = new Map<string, boolean>();
  private timelineControl?: DirectorControl;
  private timelinePlaying = false;
  private lastScene?: Parameters<SceneView['show']>;

  constructor(
    readonly app: PrototypeApplication,
    private readonly reportTextureErrors: (aliases: ReadonlySet<string>) => void,
    editor: boolean,
  ) {
    if (editor) {
      app.pause();
      this.editorTicker = new Ticker();
      this.editorTicker.add(ticker => {
        if (this.particlePreview && this.app.clock.state !== 'running') {
          this.app.particles.update(ticker.deltaMS / 1000, isVisible, this.particlePreview);
        }
        this.advanceEffectPreview(ticker.deltaMS / 1000);
        if (this.app.clock.state !== 'running') {
          this.drawSelection();
          this.app.render();
        }
        this.syncTicker();
      });
    }
    this.flex = new SceneLayout(this.editorTicker ?? app.ticker);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#4b3a32';
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = '#ecb887';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 62, 62);
    ctx.beginPath();
    ctx.moveTo(12, 12);
    ctx.lineTo(52, 52);
    ctx.moveTo(52, 12);
    ctx.lineTo(12, 52);
    ctx.stroke();
    this.placeholder = new Texture({ source: new CanvasSource({ resource: canvas }) });
    app.canvas.setAttribute('aria-label', t('canvas'));
    if (editor) app.canvas.dataset.editView = this.editView;
    this.sceneSurface.game = app;
    this.sceneSurface.addChild(this.world, app.lighting.layer, this.hud);
    app.scene.getLayer('main').addChild(this.sceneSurface);
    app.scene.defineLayer({ name: 'editor-tools', mode: 'free', zIndex: 1000 });
    app.scene.getLayer('editor-tools').addChild(this.grid, this.onions, this.audioRanges, this.guides, this.physicsDebug, this.outline);
    this.sceneCamera = app.cameras.create('scene:world', this.world);
    const pointer = (phase: 'down' | 'move' | 'up', event: PointerEvent) => {
      if (!this.gameScene || this.transitioning || this.app.clock.state !== 'running' || this.app.scripts.paused) return;
      const point = this.canvasPoint(event.clientX, event.clientY);
      if (!point) return;
      const local = this.world.toLocal(point);
      this.app.scripts.pointer(phase, local.x, local.y);
      const grabbed = this.app.physics.pointer(phase, local.x, local.y);
      if (grabbed && phase === 'down') app.canvas.setPointerCapture(event.pointerId);
    };
    app.canvas.addEventListener('pointerdown', event => pointer('down', event));
    app.canvas.addEventListener('pointermove', event => pointer('move', event));
    app.canvas.addEventListener('pointerup', event => pointer('up', event));
    for (const event of ['pointercancel', 'lostpointercapture']) {
      app.canvas.addEventListener(event, () => this.app.physics.pointer('up', 0, 0));
    }
    app.canvas.addEventListener('click', event => {
      if (this.transitioning || this.app.clock.state !== 'running' || (!this.app.scripts.active && !this.productionClock)) return;
      const point = this.canvasPoint(event.clientX, event.clientY);
      const sourceId = point && this.pick(point);
      if (sourceId) {
        const event = { type: 'pointer.click', sourceId, silent: false };
        this.production.observe(event);
        this.app.scripts.enqueue(event);
      }
    });
    app.ticker.add(ticker => {
      const seconds = ticker.deltaMS / 1000;
      if (this.editorTicker) {
        this.advanceSceneAnimations(ticker);
        this.gameTime += seconds;
        this.updateSceneCamera();
        if (this.audioNodes.length) {
          this.app.audio.sources.tickMixer(seconds);
          this.syncAudio();
        }
        this.drawSelection();
        return;
      }
      if (!this.gameScene || this.app.scripts.paused) return;
      const measure = <T,>(id: string, operation: () => T) => this.profiler ? this.profiler.measure(id, operation) : operation();
      measure('animation', () => this.advanceSceneAnimations(ticker));
      this.gameTime += seconds;
      const steps = measure('physics', () => this.app.physics.tick(seconds));
      this.profiler?.physicsSteps(steps);
      measure('scripts', () => this.app.scripts.tick(seconds));
      measure('audio', () => this.app.audio.sources.tickMixer(seconds));
      measure('gameplay', () => {
        this.productionClock?.advance(seconds);
        this.runningContent?.tick();
        this.app.multiplayer.tick(seconds);
      });
      this.updateSceneCamera();
      this.syncAudio();
      this.drawSelection();
      this.syncTicker();
    });
  }

  private advanceSceneAnimations(ticker: Ticker) {
    for (const animation of this.animations.values()) {
      if (isVisible(animation.display)) animation.tick(ticker);
    }
    this.app.particles.update(ticker.deltaMS / 1000, isVisible);
  }

  static async create(scene: Scene, options: Omit<PrototypeOptions, 'config'>, report: (aliases: ReadonlySet<string>) => void,
    profile: PreviewProfile = { device: 'desktop', orientation: 'landscape' }) {
    const app = new PrototypeApplication();
    let view: SceneView | undefined;
    try {
      const config = configRegistry.forPreview(scene.config, profile.device, profile.orientation);
      const { width, height, background, resolution } = config.renderer;
      const initOptions: PrototypeInitOptions = {
        width, height, background, resolution,
        antialias: true,
        preference: 'webgl',
        autoStart: false,
        oliveScenes: {},
        oliveClock: {
          pause: () => {
            if (!options.editor) app.audio.sources.setClockPaused(true);
            view?.syncWidgetInput();
          },
          resume: () => {
            if (!options.editor) app.audio.sources.setClockPaused(false);
            view?.syncWidgetInput();
          },
          step: ms => app.audio.sources.stepClock(ms),
          speed: value => app.audio.sources.setClockSpeed(value),
          stop: () => { app.audio?.stop(); app.audio?.sources.stopScene(); view?.syncWidgetInput(); },
          unload: () => view?.unloadScene(),
          reload: () => {
            if (options.onReload) options.onReload();
            else if (view?.lastScene) view.show(...view.lastScene);
          },
        },
        olivePrototype: { ...options, config },
      };
      await app.init(initOptions);
      app.ticker.maxFPS = config.renderer.maxFPS;
      view = new SceneView(app, report, options.editor ?? false);
      return view;
    } catch (error) {
      if (app.renderer) app.destroy({ removeView: true }, { children: true });
      else app.stage.destroy({ children: true });
      throw error;
    }
  }

  show(objects: SceneObject[], assets: Map<string, Asset>, gameScene?: GameSceneView, globals?: Globals, lighting?: Lighting) {
    this.lastScene = [objects, assets, gameScene, globals, lighting];
    this.initialGlobals = Object.fromEntries(globals?.items.map(item => [item.name, item.initial]) ?? []);
    this.widgetGlobals = new Map(globals?.items.map(item => [item.id, item]));
    const changedGame = gameScene?.id !== this.gameScene?.id;
    const newTransition = changedGame || gameScene?.transitionLayer !== this.gameScene?.transitionLayer;
    const effect = newTransition && gameScene?.transition?.kind !== 'instant' && gameScene?.transition?.ms ? gameScene.transition : undefined;
    const layer = effect && gameScene?.transitionLayer;
    if (newTransition || this.transitionFrame) this.resetSceneTransition();
    const outgoing = layer?.exit ? this.captureTransitionLayer(layer.rootIds) : undefined;
    this.gameScene = gameScene;
    if (changedGame) {
      this.sceneCamera.stop();
      this.sceneCamera.unfollow();
      this.gameCamera = idleCamera();
      this.gameTime = 0;
      this.cueVisibility.clear();
    }
    if (objects !== this.objects) {
      this.clearEffectPreview();
      this.locked = new Set([...selectionTree(objects)].flatMap(([id, item]) => item.inheritedLock || item.node.locked ? [id] : []));
    }
    this.objects = objects;
    this.assets = assets;
    this.app.lighting.show(lighting, objects, id => this.displays.get(id));
    const discarded: AnimationSource[] = [];
    for (const [alias, entry] of this.animationSources) {
      const current = assets.get(alias);
      if (current?.url === entry.asset.url && current.media === entry.asset.media) continue;
      this.animationSources.delete(alias);
      if (entry.source) discarded.push(entry.source);
    }
    this.render();
    if (changedGame && this.presentation.width) this.applyViewport();
    if (effect) {
      if (layer) {
        const frame = layer.exit ? outgoing : this.captureTransitionLayer(layer.rootIds);
        if (frame) {
          this.transitionFrame = frame;
          this.sceneSurface.addChild(frame.surface);
          if (!layer.exit) for (const display of frame.hidden) display.renderable = false;
          this.playSceneTransition(effect, frame.surface, layer.exit);
        }
      } else this.playSceneTransition(effect, this.sceneSurface);
    }
    for (const source of discarded) source.dispose();
    const urls = new Set(Array.from(assets.values(), asset => asset.url));
    for (const [url, entry] of this.textures) {
      if (urls.has(url)) continue;
      this.textures.delete(url);
      entry.texture?.destroy(true);
    }
  }

  destroy() {
    this.profiler?.dispose();
    this.profiler = undefined;
    this.productionClock?.dispose();
    this.productionClock = undefined;
    this.stopGameContent();
    this.resetSceneTransition();
    this.sceneCamera.clearDepth();
    this.gameScene = undefined;
    this.cancelTimeline();
    this.clearOnions();
    this.flex.clear();
    this.effects.clear();
    this.widgets.clear();
    this.app.destroy({ removeView: true }, { children: true });
    this.editorTicker?.destroy();
    this.liveEffectTicker?.destroy();
    this.animations.clear();
    for (const entry of this.animationSources.values()) entry.source?.dispose();
    this.animationSources.clear();
    this.placeholder.destroy(true);
    for (const entry of this.textures.values()) entry.texture?.destroy(true);
    this.textures.clear();
  }

  profile(recorder: ProfileRecorder) {
    this.profiler?.dispose();
    this.profiler = new LiveProfiler(this.app, recorder, () => this.displays.size);
  }

  private resetSceneTransition() {
    this.transitionSequence++;
    const frame = this.transitionFrame;
    this.transitionFrame = undefined;
    if (frame) {
      cancelSceneTransition(frame.surface);
      for (const display of frame.hidden) if (!display.destroyed) display.renderable = true;
      frame.surface.destroy({ children: true });
      frame.texture.destroy(true);
    }
    cancelSceneTransition(this.sceneSurface);
    this.transitioning = false;
    delete this.app.canvas.dataset.sceneTransition;
    this.sceneSurface.alpha = 1;
    this.sceneSurface.position.set(0);
    this.sceneSurface.scale.set(1);
    this.sceneSurface.rotation = 0;
  }

  private captureTransitionLayer(rootIds: readonly string[]) {
    const roots = new Set(rootIds.map(id => this.sceneCamera.depth.layerFor(this.displays.get(id))));
    const displays = [...this.world.children, ...this.hudAnchors.map(({ container }) => container.children[0])]
      .filter(display => roots.has(display) && display.renderable && isVisible(display));
    if (!displays.length) return undefined;
    const { width, height } = this.app.screen;
    if (!width || !height) return undefined;
    const texture = RenderTexture.create({ width, height, resolution: Math.min(1, 2048 / Math.max(width, height)) });
    try {
      displays.forEach((display, index) => this.app.renderer.render({
        container: display, target: texture, transform: display.getGlobalTransform(new Matrix()),
        clear: index === 0, clearColor: [0, 0, 0, 0],
      }));
    } catch (error) {
      texture.destroy(true);
      console.warn('Scene transition capture failed', error);
      return undefined;
    }
    const surface: AppScreen = new Container({ eventMode: 'none' });
    surface.game = this.app;
    surface.addChild(new Sprite(texture));
    return { surface, texture, hidden: displays };
  }

  private playSceneTransition(config: SceneTransition, surface: AppScreen, exit = false) {
    const sequence = this.transitionSequence;
    this.transitioning = true;
    this.app.canvas.dataset.sceneTransition = config.kind;
    this.syncWidgetInput();
    const transition = sceneTransition(config, () => this.app.screen);
    void (exit ? transition.exit(surface) : transition.enter(surface)).finally(() => {
      if (this.transitionSequence !== sequence) return;
      this.resetSceneTransition();
      this.syncWidgetInput();
      this.app.render();
    }).catch(error => console.warn('Scene transition failed', error));
    this.app.render();
  }

  private unloadScene() {
    const scene = this.lastScene;
    this.cancelTimeline();
    this.clearOnions();
    this.timeline = undefined;
    this.app.scripts.stop();
    this.stopGameContent();
    this.app.input.stop();
    this.app.physics.stop();
    this.app.multiplayer.stop();
    this.app.globals.stop();
    this.show([], new Map());
    this.lastScene = scene;
  }

  private render() {
    this.sceneCamera.clearDepth();
    this.flex.clear();
    this.effects.clear();
    this.widgets.clear();
    for (const animation of this.animations.values()) animation.display.removeFromParent();
    this.app.particles.detach();
    for (const layer of [this.world, this.hud]) {
      for (const child of layer.removeChildren()) child.destroy({ children: true });
    }
    this.displays.clear();
    this.authored.clear();
    this.groups.clear();
    this.audioNodes.length = 0;
    this.hudAnchors.length = 0;
    this.textGlobals = this.gameScene && this.app.globals.active ? this.app.globals.snapshot() : this.initialGlobals;
    for (const node of this.objects) {
      const display = this.project(node);
      if (node.type === 'Camera2D' || !node.screenSpace) this.world.addChild(display);
      else {
        const container = new Container();
        container.addChild(display);
        this.hud.addChild(container);
        this.hudAnchors.push({ container, anchor: node.screenSpace.anchor });
      }
    }
    for (const { node } of this.netCopies.values()) this.world.addChild(this.project(node));
    this.resizeHUD();
    for (const [id, animation] of this.animations) {
      if (this.displays.get(id) === animation.display) continue;
      animation.display.destroy({ children: true });
      this.animations.delete(id);
    }
    this.app.particles.prune();
    this.applyLayout();
    this.syncWidgetInput();
    this.refreshPhysicsOutlines();
    for (const overlay of [this.grid, this.audioRanges, this.guides, this.outline]) overlay.visible = !this.gameScene;
    this.applyTimeline();
    this.applyDraft();
    this.applyCameraLayerEffects();
    if (this.gameScene) this.app.physics.projectPoses();
    this.updateSceneCamera();
    this.drawOnions(true);
    this.drawGrid();
    this.syncAudio();
    this.drawSelection();
    this.app.render();
    this.syncTicker();
    const failures = new Set<string>();
    for (const asset of this.assets.values()) {
      if (this.textures.get(asset.url)?.failed || this.animationSources.get(asset.alias)?.failed) failures.add(asset.alias);
    }
    this.reportTextureErrors(failures);
  }

  private project(node: SceneObject): Container {
    let display: Container;
    switch (node.type) {
      case 'Container':
        this.groups.add(node.id);
        display = new Container();
        for (const child of node.children) display.addChild(this.project(child));
        break;
      case 'Sprite':
        display = new Sprite({ texture: this.texture(node.texture), anchor: node.anchor });
        break;
      case 'Text':
        display = new Text({ text: this.formatGameText(node.text, this.textGlobals), anchor: node.anchor, style: node.style });
        break;
      case 'BitmapText':
        display = new BitmapText({ text: this.formatGameText(node.text, this.textGlobals), anchor: node.anchor, style: node.style });
        break;
      case 'Graphics': {
        const shape = new Graphics();
        if (node.shape === 'ellipse') shape.ellipse(node.width / 2, node.height / 2, node.width / 2, node.height / 2);
        else shape.rect(0, 0, node.width, node.height);
        display = shape.fill(node.fill);
        break;
      }
      case 'TilingSprite': {
        const { width, height, anchor, tilePosition, tileScale } = node;
        display = new TilingSprite({ texture: this.texture(node.texture), width, height, anchor, tilePosition, tileScale });
        break;
      }
      case 'NineSliceSprite': {
        const { width, height, leftWidth, topHeight, rightWidth, bottomHeight } = node;
        display = new NineSliceSprite({ texture: this.texture(node.texture), width, height, leftWidth, topHeight, rightWidth, bottomHeight });
        break;
      }
      case 'MeshPlane':
        display = meshPlane(node, this.texture(node.texture));
        break;
      case 'MeshRope':
        display = meshRope(node, this.texture(node.texture));
        break;
      case 'Tilemap': {
        const texture = this.texture(node.texture);
        display = tilemap(node, texture === this.placeholder ? undefined : texture);
        break;
      }
      case 'Particles':
        display = this.app.particles.project(node, node.texture ? this.texture(node.texture) : Texture.WHITE);
        break;
      case 'UIWidget': {
        const { widget } = node;
        const definition = this.widgetGlobals.get(widget.globalId);
        const binding = definition?.type === widgetGlobalType(widget.kind) ? definition : undefined;
        const item = createWidget(widget, {
          ticker: this.editorTicker ?? this.app.ticker,
          change: value => {
            if (binding && this.gameScene && this.app.clock.state === 'running') this.app.globals.set(binding.id, value);
          },
        });
        this.widgets.set(node.id, item);
        const current = binding && this.app.globals.runtimeStore?.list.some(global => global.id === binding.id)
          ? this.app.globals.runtimeStore.get(binding.id) : binding?.initial;
        if (typeof current === 'boolean' || typeof current === 'number') item.setValue(current);
        display = item.view;
        break;
      }
      case 'AnimatedSprite':
      case 'Spine':
        display = this.animatedDisplay(node);
        break;
      case 'AudioSource':
      case 'AudioListener': {
        this.audioNodes.push(node);
        const marker = new Graphics().circle(0, 0, 12).fill('#263940');
        if (node.type === 'AudioSource') {
          marker.moveTo(-6, -2).lineTo(-3, -2).lineTo(1, -5).lineTo(1, 5).lineTo(-3, 2).lineTo(-6, 2).closePath()
            .moveTo(4, -4).quadraticCurveTo(9, 0, 4, 4);
        } else {
          marker.moveTo(-6, 3).lineTo(-6, 0).quadraticCurveTo(-6, -7, 0, -7)
            .quadraticCurveTo(6, -7, 6, 0).lineTo(6, 3).roundRect(-7, 0, 3, 6, 1).roundRect(4, 0, 3, 6, 1);
        }
        display = marker.stroke({ width: 1.4, color: '#a9dbe8' });
        break;
      }
      case 'Light2D':
        display = new Graphics().circle(0, 0, 7).fill('#312b20').circle(0, 0, 7).stroke({ width: 1.4, color: node.light.color })
          .moveTo(-12, 0).lineTo(-9, 0).moveTo(9, 0).lineTo(12, 0)
          .moveTo(0, -12).lineTo(0, -9).moveTo(0, 9).lineTo(0, 12).stroke({ width: 1.4, color: node.light.color });
        break;
      case 'Camera2D':
        display = new Graphics().roundRect(-11, -7, 15, 14, 2).moveTo(4, -3).lineTo(11, -7).lineTo(11, 7)
          .lineTo(4, 3).closePath().fill('#514523').stroke({ width: 1.4, color: '#e6c84f' });
        break;
    }
    display.label = node.label;
    display.position.copyFrom(node.position);
    display.angle = node.rotation;
    display.scale.copyFrom(node.scale);
    display.pivot.copyFrom(node.pivot);
    display.skew.set(node.skew.x * Math.PI / 180, node.skew.y * Math.PI / 180);
    display.visible = this.netVisibility.get(node.id) ?? this.cueVisibility.get(node.id) ?? node.visible;
    display.alpha = node.alpha;
    display.tint = node.tint;
    this.projectEffects(node, display);
    for (const effect of node.effects ?? []) {
      if (effect.enabled && isModulation(effect) && effectTypesFor(node.type).includes(effect.type)) {
        new ObjectModulationEffect(effect).attach(display);
      }
    }
    if (this.gameScene && (node.type === 'Camera2D' || node.type === 'AudioSource' || node.type === 'AudioListener' || node.type === 'Light2D')) display.renderable = false;
    this.displays.set(node.id, display);
    this.authored.set(node.id, node);
    return display;
  }

  restartParticles(id: string) {
    this.app.particles.restart(id);
    if (this.editorTicker) this.particlePreview = id;
    this.drawSelection();
    this.app.render();
    this.syncTicker();
  }

  setShaderLibrary(library: ShaderLibrary | undefined) {
    if (this.shaders === library) return;
    this.shaders = library;
    for (const node of this.authored.values()) {
      const display = this.displays.get(node.id);
      if (display && node.shader) this.projectEffects(node, display);
    }
    this.app.render();
  }

  private projectEffects(node: SceneObject, display: Container) {
    if (!node.effects && !node.shader) return;
    const visual = node.effects?.filter(effect => !isModulation(effect));
    this.effects.apply([{ id: node.id, parentId: null, components: [
      ...(visual?.length ? [{ type: 'pixi.effects', version: 1, data: visual }] : []),
      ...(node.shader ? [{ type: shaderType, version: 1, data: node.shader }] : []),
    ] }], () => display, this.app.renderer);
  }

  playTimeline(
    clip: DirectedClip, start: number, update: (time: number, ended: boolean) => void,
    options: { transport?: TimelineTransport; fade?: number; cue?: (cue: Cue) => void } = {},
  ) {
    if (this.timelineControl && this.timeline?.clip === clip && !options.fade) {
      this.timelineControl.resume();
      this.timelinePlaying = true;
      this.syncTicker();
      return;
    }
    this.cancelTimeline();
    const fade = options.fade ?? 0;
    const from = fade > 0 ? this.readTimelinePose(clip) : undefined;
    const transport = options.transport ?? defaultTransport;
    const control = this.app.director.run(timelineStep(start, clip.duration, transport, fade), {
      ticker: this.editorTicker ?? this.app.ticker,
      allowed: () => !this.app.scripts.paused,
      sample: (time: number, span: { from: number; initial?: boolean } | undefined, elapsed: number) => {
        this.sampleTimeline(clip, time, from, fade > 0 ? Math.min(1, elapsed / fade) : 1);
        update(time, false);
        if (span && options.cue) for (const { cue } of crossedCues(clip.cues, span.from, time, span.initial)) options.cue(cue);
      },
    });
    this.timelineControl = control;
    this.timelinePlaying = true;
    const finish = () => {
      if (this.timelineControl !== control) return;
      this.timelineControl = undefined;
      this.timelinePlaying = false;
      const end = transport.reverse ? 0 : clip.duration;
      this.sampleTimeline(clip, end, from);
      update(end, true);
      this.syncTicker();
    };
    control.subscribe({ complete: finish, error: finish });
    this.syncTicker();
  }

  pauseTimeline() {
    this.timelineControl?.pause();
    this.timelinePlaying = false;
    this.syncTicker();
  }

  seekTimeline(clip: DirectedClip, time: number) {
    this.cancelTimeline();
    this.sampleTimeline(clip, time);
    this.syncTicker();
  }

  stopTimeline() {
    this.cancelTimeline();
    this.clearOnions();
    if (!this.timeline) return;
    this.timeline = undefined;
    this.render();
  }

  private cancelTimeline() {
    const control = this.timelineControl;
    this.timelineControl = undefined;
    this.timelinePlaying = false;
    control?.stop();
  }

  timelineNode(node: SceneObject): SceneObject {
    const display = this.displays.get(node.id);
    if (!display || !this.timeline?.pose.has(node.id)) return node;
    return { ...node, position: { x: display.x, y: display.y }, rotation: display.angle,
      scale: { x: display.scale.x, y: display.scale.y }, skew: { x: display.skew.x * 180 / Math.PI, y: display.skew.y * 180 / Math.PI } };
  }

  private displayValue(display: Container, property: Exclude<TweenProperty, 'volume' | 'rate'>) {
    switch (property) {
      case 'scaleX': return display.scale.x;
      case 'scaleY': return display.scale.y;
      case 'skewX': return display.skew.x * 180 / Math.PI;
      case 'skewY': return display.skew.y * 180 / Math.PI;
      case 'rotation': return display.angle;
      default: return display[property];
    }
  }

  private readTimelinePose(clip: DirectedClip): TweenPose {
    const pose = sampleClip(clip, 0, id => this.authored.get(id));
    for (const [id, values] of this.timeline?.pose ?? []) {
      const channels = pose.get(id) ?? new Map<TweenProperty, number>();
      for (const [channel, value] of values) if (!channels.has(channel)) channels.set(channel, value);
      pose.set(id, channels);
    }
    for (const [id, channels] of pose) {
      const display = this.displays.get(id);
      if (display) for (const channel of channels.keys()) {
        const node = this.authored.get(id);
        channels.set(channel, audioTween(channel) ?
          this.timeline?.pose.get(id)?.get(channel) ?? (node ? authoredValue(node, channel) : 1) : this.displayValue(display, channel));
      }
    }
    return pose;
  }

  private sampleTimeline(clip: DirectedClip, time: number, from?: TweenPose, weight = 1) {
    const pose = sampleClip(clip, time, id => this.authored.get(id));
    for (const [id, channels] of from ?? []) {
      const destination = pose.get(id) ?? new Map<TweenProperty, number>();
      for (const [channel, value] of channels) {
        const goal = destination.get(channel) ?? value;
        destination.set(channel, value + (goal - value) * weight);
      }
      pose.set(id, destination);
    }
    if (this.timeline?.clip !== clip) {
      for (const [id, channels] of this.timeline?.pose ?? []) {
        const node = this.authored.get(id);
        const display = this.displays.get(id);
        if (!node || !display) continue;
        for (const channel of channels.keys()) if (!pose.get(id)?.has(channel) && this.canAnimate(id, channel)) {
          applyTween(display, channel, authoredValue(node, channel));
        }
      }
      this.onionFrame = -1;
    }
    this.timeline = { clip, time, pose };
    this.applyTimeline();
    if (!this.gameScene && this.editView === 'camera') {
      this.updateSceneCamera();
      this.drawGrid();
    }
    this.drawOnions();
    this.syncAudio();
    this.drawSelection();
    if (!this.app.ticker.started) this.app.render();
  }

  private canAnimate(id: string, property: TweenProperty) {
    if (this.gameScene && this.authored.get(id)?.physics?.body?.bodyType === 'dynamic' && property !== 'alpha') return false;
    return !((property === 'x' || property === 'y') && this.flexChildren.has(id));
  }

  private applyTimeline(pose = this.timeline?.pose) {
    if (!pose) return;
    for (const [id, channels] of pose) {
      const display = this.displays.get(id);
      if (!display) continue;
      for (const [property, value] of channels) if (this.canAnimate(id, property)) applyTween(display, property, value);
    }
  }

  setOnionSkin(config?: OnionSkin) {
    this.onion = config;
    this.drawOnions(true);
    if (!this.app.ticker.started) this.app.render();
  }

  private clearOnions() {
    for (const child of this.onions.removeChildren()) child.destroy({ texture: true, textureSource: true });
    this.onionFrame = -1;
  }

  private drawOnions(force = false) {
    if (!this.onion || !this.timeline || this.gameScene) {
      if (this.onions.children.length) this.clearOnions();
      return;
    }
    const { time, clip, pose } = this.timeline;
    const frame = Math.round(time * 60);
    if (!force && this.onionFrame === frame) return;
    this.clearOnions();
    this.onionFrame = frame;
    const { before, after, spacing } = this.onion;
    const { width, height } = this.app.screen;
    const resolution = Math.min(1, 1024 / Math.max(width, height));
    const renderGhost = (offset: number) => {
      const at = (frame + offset * spacing) / 60;
      if (at < 0 || at > clip.duration) return;
      const sample = sampleClip(clip, at, id => this.authored.get(id));
      const changed = new Set([...sample].flatMap(([id, values]) => [...values].some(([key, value]) =>
        !audioTween(key) && this.canAnimate(id, key) && Math.abs(value - (pose.get(id)?.get(key) ?? value)) > 0.0001) ? [this.displays.get(id)] : []));
      const displays = [...changed].filter((display): display is Container => {
        if (!display || !display.renderable) return false;
        for (let parent = display.parent; parent; parent = parent.parent) if (changed.has(parent)) return false;
        return true;
      });
      if (!displays.length) return;
      this.applyTimeline(sample);
      const texture = RenderTexture.create({ width, height, resolution });
      let drawn = false;
      try {
        for (const display of displays) {
          if (!isVisible(display)) continue;
          const transform = display.getGlobalTransform(new Matrix());
          this.app.renderer.render({ container: display, target: texture, transform, clear: !drawn, clearColor: [0, 0, 0, 0] });
          drawn = true;
        }
        if (drawn) this.onions.addChild(new Sprite({ texture, tint: offset < 0 ? '#ff6868' : '#68ef98',
          alpha: 0.34 / Math.abs(offset) }));
      } finally {
        if (!drawn) texture.destroy(true);
        this.applyTimeline(pose);
      }
    };
    for (let offset = before; offset > 0; offset--) renderGhost(-offset);
    for (let offset = after; offset > 0; offset--) renderGhost(offset);
  }

  private syncAudio() {
    const { width, height } = this.app.screen;
    let listener: Point | undefined;
    const sources = this.audioNodes.flatMap(node => {
      const display = this.displays.get(node.id);
      if (!display || !isVisible(display)) return [];
      const position = this.sceneCamera.depth.positionSpace(display).toLocal(display.toGlobal(display.pivot));
      if (node.type === 'AudioListener') {
        for (const offset of objectModulations(display, 'listenerOffset')) { position.x += offset.x; position.y += offset.y; }
        listener ??= position;
        return [];
      }
      const asset = node.asset ? this.assets.get(node.asset) : undefined;
      if (asset?.kind !== 'audio') return [];
      const channels = this.timeline?.pose.get(node.id);
      const gain = objectModulations(display, 'audioGain').reduce((value, effect) => value * effect.gain, 1);
      const volume = Math.max(0, Math.min(1, (channels?.get('volume') ?? node.volume) * gain));
      const rate = Math.max(0.25, Math.min(4, channels?.get('rate') ?? node.rate));
      return [{ id: node.id, source: { ...node, volume, rate }, position, url: asset.url }];
    });
    this.app.audio.sources.sync(sources, listener ?? this.gameView ?? { x: width / 2, y: height / 2 });
  }

  private cameraRig(id: string) {
    const node = this.authored.get(id);
    const display = this.displays.get(id);
    if (node?.type !== 'Camera2D' || !display) return;
    let world = this.sceneCamera.depth.positionSpace(display);
    for (let parent = display.parent; parent && parent !== this.world; parent = parent.parent) {
      if (parent.parent === this.hud) { world = parent; break; }
    }
    const pose = world.toLocal(display.toGlobal(display.pivot));
    const axis = world.toLocal(display.toGlobal({ x: display.pivot.x + 1, y: display.pivot.y }));
    const rotation = Math.atan2(axis.y - pose.y, axis.x - pose.x) * 180 / Math.PI;
    if (node.camera.viewportRelative) {
      pose.x += (this.app.screen.width - this.authoredSize.width) / 2;
      pose.y += (this.app.screen.height - this.authoredSize.height) / 2;
    }
    return { id, camera: node.camera, pose: { ...pose, rotation } };
  }

  private cameraTarget(targetId?: string | null) {
    if (targetId && targetId === this.networkTemplate) targetId = this.app.multiplayer.localObject ?? targetId;
    const target = targetId ? this.displays.get(targetId) : undefined;
    if (!target || !isVisible(target) || !this.isInWorld(target)) return;
    return this.sceneCamera.depth.positionSpace(target).toLocal(target.toGlobal(target.pivot));
  }

  private isInWorld(display: Container) {
    for (let parent = display.parent; parent; parent = parent.parent) {
      if (parent === this.world) return true;
    }
    return false;
  }

  private activeCamera() {
    const id = this.gameScene?.cameraId;
    return id ? this.cameraRig(id) : undefined;
  }

  private editCamera() {
    const camera = this.editView === 'camera' ? cameraInScene(this.objects) : undefined;
    return camera ? this.cameraRig(camera.id) : undefined;
  }

  private updateSceneCamera() {
    const canvas = this.app.canvas;
    const preview = this.effectPreview?.effect.type !== 'lightPulse' ? this.effectPreview : undefined;
    const zoomTest = preview?.effect.type === 'zoom' ? preview.effect : undefined;
    const rig = this.gameScene ? this.activeCamera() : zoomTest ? this.cameraRig(zoomTest.id) : this.editCamera();
    if (!this.gameScene && !rig && !preview) {
      if (this.renderedCameraView) {
        void this.sceneCamera.reset();
        this.gameView = undefined;
        this.renderedCameraView = undefined;
        delete canvas.dataset.gameCamera;
      }
      return;
    }
    const stage = this.app.screen;
    const projection = zoomTest && !this.gameScene && this.editView === 'normal' ?
      cameraProjection(rig?.camera) : this.sceneCamera.postFXs.projection();
    const bounds = projection.limits?.mode === 'world' ? this.sceneCamera.depth.worldBounds() : undefined;
    const world = bounds?.isValid ? bounds : { x: 0, y: 0, ...this.authoredSize };
    const state = this.gameScene ? this.gameCamera : idleCamera();
    const target = this.cameraTarget(state.followId === undefined ? rig?.camera.target : state.followId);
    const frame = rig ? { ...rig, projection } : undefined;
    const previewState = zoomTest ? { ...state } : undefined;
    let view = cameraView(state, this.gameTime, stage, frame, target, world);
    this.gameView = view;
    if (zoomTest && preview && previewState && rig) {
      const from = preview.zoomFrom ?? zoomTest.zoom;
      const blend = Math.min(1, preview.elapsed / Math.min(0.25, zoomTest.duration / 2));
      const zoom = from + (zoomTest.zoom - from) * (1 - (1 - blend) ** 3);
      view = cameraView({ ...previewState, zoom }, this.gameTime, stage, {
        ...rig, projection: { ...projection,
          zoom: { type: 'zoom', enabled: true, value: zoom, min: zoomTest.min, max: zoomTest.max } },
      }, target, world);
    }
    if (preview?.effect.type === 'shake') view = applyCameraShake(view, { ...preview.effect, startedAt: 0 }, preview.elapsed);
    const previous = this.renderedCameraView;
    if (previous?.x === view.x && previous.y === view.y && previous.zoom === view.zoom && previous.rotation === view.rotation &&
        this.world.x === stage.width / 2 && this.world.y === stage.height / 2) return;
    this.sceneCamera.applyPose(viewPlacement(view, stage));
    this.renderedCameraView = view;
    if (this.gameScene) canvas.dataset.gameCamera = JSON.stringify(view);
  }

  setCueVisibility(id: string, visible: boolean) {
    const display = this.displays.get(id);
    if (display) {
      this.cueVisibility.set(id, visible);
      display.visible = visible;
    }
  }

  shakeCamera() {
    if (!this.gameScene) return;
    this.sceneCamera.postFXs.triggerShake(this.gameCamera, this.gameTime);
  }

  attachInput(map: InputMap, host: HTMLElement, publish: (values: InputValues) => void, replay = false) {
    const detach = this.app.input.attach(map, host, publish, (id, value) => this.app.globals?.set(id, value), replay);
    this.syncTicker();
    return () => {
      detach();
      if (this.app.renderer) this.syncTicker();
    };
  }

  inspectObject(id: string) {
    const display = this.displays.get(id);
    return display ? { x: display.x, y: display.y, rotation: display.angle, active: isVisible(display) } : undefined;
  }

  attachNetwork(plan: NetworkPlan, endpoint: string, name: string, inputMap: InputMap, publish: (status: NetStatus | undefined) => void) {
    const detach = this.app.multiplayer.start(plan, endpoint, name, inputMap, this.app.input, {
      spawn: (template, x, y) => this.spawnNetworkCopy(template, x, y),
      destroy: id => this.destroyNetworkCopy(id),
      place: (id, x, y) => {
        const node = this.netCopies.get(id)?.node;
        if (node) node.position = { x, y };
        this.displays.get(id)?.position.set(x, y);
      },
      visible: (id, visible) => {
        this.netVisibility.set(id, visible);
        const display = this.displays.get(id);
        if (display) display.visible = visible;
      },
      changed: () => this.syncTicker(),
    }, status => {
      if (status) this.app.canvas.dataset.multiplayer = status.status;
      else delete this.app.canvas.dataset.multiplayer;
      publish(status);
    });
    this.networkTemplate = plan.template?.node.id;
    this.syncTicker();
    return () => {
      detach();
      if (this.app.renderer) {
        this.networkTemplate = undefined;
        this.netVisibility.clear();
        this.syncTicker();
        this.app.render();
      }
    };
  }

  private spawnNetworkCopy(template: SceneObject, x: number, y: number) {
    const [node] = duplicateContent({ objects: [template], timeline: [] }).objects;
    node.position = { x, y };
    node.visible = true;
    this.netCopies.set(node.id, { node, ids: new Set(selectionTree([node]).keys()) });
    this.world.addChild(this.project(node));
    this.applyLayout();
    this.syncWidgetInput();
    return node.id;
  }

  private destroyNetworkCopy(id: string) {
    const copy = this.netCopies.get(id);
    if (!copy) return;
    this.netCopies.delete(id);
    for (const member of copy.ids) {
      const view = this.displays.get(member);
      if (view) this.effects.remove(view);
    }
    this.displays.get(id)?.destroy({ children: true });
    for (const member of copy.ids) {
      this.animations.delete(member);
      this.widgets.delete(member);
      this.authored.delete(member);
      this.displays.delete(member);
      this.groups.delete(member);
      this.netVisibility.delete(member);
    }
    for (let i = this.audioNodes.length - 1; i >= 0; i--) if (copy.ids.has(this.audioNodes[i].id)) this.audioNodes.splice(i, 1);
    this.app.particles.prune();
    this.applyLayout();
  }

  attachPhysics(objects: SceneObject[], settings: PhysicsSettings, publish: (status: PhysicsStatus | undefined) => void) {
    const detach = this.app.physics.start(objects, settings, id => this.displays.get(id),
      () => ({ width: this.app.screen.width, height: this.app.screen.height }),
      event => this.app.scripts.enqueue(event), publish);
    this.syncTicker();
    return () => {
      detach();
      if (this.app.renderer) this.syncTicker();
    };
  }

  setPhysicsDebug(show: boolean) {
    this.showColliders = show;
    this.refreshPhysicsOutlines();
    this.drawPhysics();
    this.app.render();
  }

  private refreshPhysicsOutlines() {
    this.physicsOutlines = this.showColliders ? colliderOutlines(physicsEntities(this.objects, id => this.displays.get(id))) : [];
  }

  private drawPhysics() {
    this.physicsDebug.clear();
    for (const { entityId, points, sensor } of this.physicsOutlines) {
      const display = this.displays.get(entityId);
      if (!display || !isVisible(display)) continue;
      const path = points.flatMap(point => {
        const { x, y } = display.toGlobal(point);
        return [x, y];
      });
      const color = sensor ? '#eab86b' : '#69e3b0';
      this.physicsDebug.poly(path).stroke({ color, width: 1.5 });
    }
  }

  physicsFit(id: string) {
    const bounds = this.displays.get(id)?.getLocalBounds();
    if (!bounds?.isValid || bounds.width < 0.1 || bounds.height < 0.1) return;
    return { width: bounds.width, height: bounds.height, offsetX: bounds.x + bounds.width / 2, offsetY: bounds.y + bounds.height / 2 };
  }

  attachScripts(options: ScriptPreviewOptions, content?: GameContent, overlay?: HTMLElement, store?: AchievementStore) {
    this.productionClock?.dispose();
    this.productionClock = undefined;
    const production = options.production;
    const entities = logicEntities(options.objects, id => this.displays.get(id));
    let gameData: GameData | undefined;
    if (production?.gameData) {
      try { gameData = parseGameData(production, production.gameData); }
      catch (error) { scriptConsole.log('error', error instanceof Error ? error.message : String(error)); }
    }
    this.productionDocument = {
      ...(production?.world ? { [sections.world]: production.world } : {}),
      ...(gameData ? { [sections.data]: gameData } : {}),
    };
    if (production?.world?.portals.length || gameData?.bindings.length ||
        entities.some(entity => entity.components.some(component => component.type === 'production.character'))) {
      const system = this.production.system(options.scene.id, () => entities, id => options.changeScene(id, 'replace'));
      try { this.productionClock = new RuntimeSession([], () => [system]); }
      catch (error) { scriptConsole.log('error', error instanceof Error ? error.message : String(error)); }
    }
    const productionClock = this.productionClock;
    this.stopGameContent();
    if (content && overlay) {
      this.runningContent = startGameContent(content, {
        store: store ?? this.previewProgress, globals: () => this.app.globals.runtimeStore, language: () => this.language,
        overlay, emit: event => this.app.scripts.enqueue(event), silent: () => this.app.clock.state !== 'running',
        achievementTitle: () => t('achievements.unlockedToast'),
      });
    }
    const running = this.runningContent;
    const stopScripts = this.app.scripts.start({ ...options, content }, this.app.input, this.app.globals, {
      display: id => this.displays.get(id),
      stage: this.authoredSize,
      time: () => this.gameTime,
      ready: () => this.syncTicker(),
      clockPaused: () => this.app.clock.state !== 'running',
      physics: this.app.physics.controls,
      camera: cameraControls(() => this.gameCamera, () => this.gameTime, () => this.gameView ??
        cameraView(idleCamera(), 0, this.app.screen)),
      dialogue: running?.dialogue,
      achievements: running?.achievements,
      language: { current: () => this.language?.language ?? '', set: id => this.language?.setLanguage(id),
        t: (key, values) => this.language?.text(key, values) },
    });
    return () => {
      stopScripts();
      if (this.productionClock === productionClock) { productionClock?.dispose(); this.productionClock = undefined; }
      if (this.runningContent === running) this.stopGameContent();
    };
  }

  resetAchievementPreview() {
    this.previewProgress.clear();
  }

  logicActivity(id: string) {
    const nodes = this.app.scripts.activity(id);
    return nodes ? { nodes, now: this.gameTime } : undefined;
  }

  private stopGameContent() {
    this.runningContent?.dispose();
    this.runningContent = undefined;
  }

  setGameLanguage(table: Localization | undefined, language?: string) {
    this.language = table ? createLanguageStore(table, language, () => this.refreshText()) : undefined;
    this.refreshText();
  }

  private formatGameText(text: string, current: GlobalValues) {
    return globalText(text, current, (key, count) => this.language?.text(key, { ...current, ...(count === undefined ? {} : { count }) }));
  }

  private refreshText(current = this.app.globals.active ? this.app.globals.snapshot() : this.initialGlobals) {
    let resized = false;
    for (const [id, node] of this.authored) {
      if (node.type !== 'Text' && node.type !== 'BitmapText') continue;
      const display = this.displays.get(id);
      if (!(display instanceof Text || display instanceof BitmapText)) continue;
      const text = this.formatGameText(node.text, current);
      if (display.text === text) continue;
      display.text = text;
      resized = true;
    }
    if (resized) {
      this.applyLayout();
      if (!this.app.ticker.started) this.app.render();
    }
  }

  attachGlobals(definition: Globals, publish: (values: GlobalValues) => void) {
    return this.app.globals.start(definition, values => {
      publish(values);
      if (!this.gameScene || !this.app.renderer) return;
      const current = this.app.globals.active ? values : this.initialGlobals;
      for (const [id, item] of this.widgets) {
        const node = this.authored.get(id);
        const binding = node?.type === 'UIWidget' ? this.widgetGlobals.get(node.widget.globalId) : undefined;
        const value = binding ? current[binding.name] : undefined;
        if (typeof value === 'number' || typeof value === 'boolean') item.setValue(value);
      }
      this.refreshText(current);
    });
  }

  private syncWidgetInput() {
    const active = !!this.gameScene && !this.transitioning && this.app.clock.state === 'running';
    for (const item of this.widgets.values()) item.view.eventMode = active ? 'passive' : 'none';
    this.flex.setScrollEnabled(active);
  }

  private resizeHUD() {
    const stage = this.app.screen;
    for (const { container, anchor } of this.hudAnchors) container.position.copyFrom(screenOffset(anchor, stage, this.authoredSize));
  }

  private applyLayout() {
    const entities = layoutEntities([...this.objects, ...[...this.netCopies.values()].map(copy => copy.node)], this.app.screen);
    this.flexChildren = layoutManaged(entities);
    this.flex.apply(entities, id => this.displays.get(id), this.app.renderer);
    this.flex.setScrollEnabled(!!this.gameScene && this.app.clock.state === 'running');
  }

  isLayoutManaged(id: string) { return this.flexChildren.has(id); }

  pivotInParent(id: string) {
    const display = this.displays.get(id);
    return display?.parent?.toLocal(display.toGlobal(display.pivot));
  }

  setSelection(ids: readonly string[]) {
    if (this.selected !== (ids.at(-1) ?? null)) {
      const cameraPreview = this.effectPreview && this.effectPreview.effect.type !== 'lightPulse';
      this.clearEffectPreview();
      if (cameraPreview) this.updateSceneCamera();
      this.syncTicker();
    }
    this.selectedIds = ids;
    this.selected = ids.at(-1) ?? null;
    if (this.particlePreview && this.particlePreview !== this.selected) {
      this.particlePreview = undefined;
      this.syncTicker();
    }
    this.drawGrid();
    this.drawSelection();
    this.app.render();
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.drawSelection();
    this.app.render();
  }

  pickHandle(point: Point, tool: Tool) {
    if (!this.selected || this.locked.has(this.selected) || tool !== this.tool ||
        (tool === 'move' && this.flexChildren.has(this.selected))) return;
    const scale = this.screenScale();
    const handle = this.handles.find(handle => Math.hypot(
      (point.x - handle.point.x) * scale.x, (point.y - handle.point.y) * scale.y,
    ) <= 10);
    return handle ? { id: this.selected, axis: handle.axis } : undefined;
  }

  configure(config: ResolvedSceneConfig, profile: PreviewProfile, availableWidth: number, availableHeight: number, authoredSize: { width: number; height: number }) {
    if (availableWidth < 1 || availableHeight < 1) return;
    const renderer = config.renderer;
    const ratios = { common: 16 / 9, desktop: 16 / 9, mobile: 844 / 390, tablet: 1024 / 768 };
    const ratio = ratios[profile.device];
    const ratioOfPreview = profile.orientation === 'portrait' ? 1 / ratio : ratio;
    const simulate = profile.orientation === 'portrait' || profile.device === 'mobile' || profile.device === 'tablet';
    const frameWidth = simulate ? Math.min(availableWidth, availableHeight * ratioOfPreview) : availableWidth;
    const frameHeight = simulate ? Math.min(availableHeight, availableWidth / ratioOfPreview) : availableHeight;
    const layout = computeLayout(frameWidth, frameHeight, renderer.width, renderer.height, renderer.scaleMode, { screenRatio: ratio });
    const width = Math.max(1, Math.min(4096, layout.logicalWidth));
    const height = Math.max(1, Math.min(4096, layout.logicalHeight));
    const { app } = this;
    const resized = app.screen.width !== width || app.screen.height !== height;
    if (resized || app.renderer.resolution !== renderer.resolution) {
      app.renderer.resize(width, height, renderer.resolution);
    }
    app.renderer.background.color = renderer.background;
    app.ticker.maxFPS = renderer.maxFPS;
    app.audio.configure(config.audio);
    this.authoredSize = authoredSize;
    if (resized) app.scene.resize({ gameWidth: width, gameHeight: height });
    this.resizeHUD();
    if (resized) this.applyLayout();
    this.updateSceneCamera();
    this.syncAudio();
    const insetY = Math.max(0, (layout.displayHeight - frameHeight) / 2);
    const insetX = Math.max(0, (layout.displayWidth - frameWidth) / 2);
    this.presentation = { width: Math.max(1, layout.displayWidth), height: Math.max(1, layout.displayHeight), insetX, insetY };
    this.applyViewport();
  }

  zoomAt(factor: number, client?: Point) {
    const { width, height } = this.presentation;
    const { x, y, zoom } = this.camera;
    const next = zoomWithinRange(zoom * factor);
    if (!width || !height || next === zoom) return zoom;
    const host = this.app.canvas.parentElement?.getBoundingClientRect();
    const dx = client && host ? (client.x - host.left - host.width / 2) / width : 0;
    const dy = client && host ? (client.y - host.top - host.height / 2) / height : 0;
    this.camera = { x: x + dx * (1 / zoom - 1 / next), y: y + dy * (1 / zoom - 1 / next), zoom: next };
    return this.applyViewport();
  }

  resetViewport() {
    this.camera = { x: 0.5, y: 0.5, zoom: 1 };
    return this.applyViewport();
  }

  frameSelection() {
    const bounds = this.quickBounds;
    const host = this.app.canvas.parentElement;
    const { width, height } = this.presentation;
    if (!bounds || !host || !width || !height) return this.camera.zoom;
    const screen = this.app.screen;
    const selectedWidth = bounds.width * width / screen.width;
    const selectedHeight = bounds.height * height / screen.height;
    const zoom = zoomWithinRange(0.65 * Math.min(host.clientWidth / selectedWidth, host.clientHeight / selectedHeight));
    this.camera = { x: (bounds.x + bounds.width / 2) / screen.width, y: (bounds.y + bounds.height / 2) / screen.height, zoom };
    return this.applyViewport();
  }

  private applyViewport() {
    const { app } = this;
    const { x, y, zoom } = this.gameScene ? { x: 0.5, y: 0.5, zoom: 1 } : this.camera;
    const { width, height, insetX, insetY } = this.presentation;
    const displayWidth = width * zoom, displayHeight = height * zoom;
    this.previewInset = { x: insetX * zoom, y: insetY * zoom };
    Object.assign(app.canvas.style, {
      width: `${displayWidth}px`,
      height: `${displayHeight}px`,
      marginLeft: `${(0.5 - x) * displayWidth}px`,
      marginTop: `${(0.5 - y) * displayHeight}px`,
      clipPath: insetX || insetY ? `inset(${this.previewInset.y}px ${this.previewInset.x}px)` : '',
    });
    this.drawGrid();
    this.drawSelection();
    app.render();
    return zoom;
  }

  canvasPoint(clientX: number, clientY: number): Point | null {
    const rect = this.app.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (clientX - rect.left) * this.app.screen.width / rect.width,
      y: (clientY - rect.top) * this.app.screen.height / rect.height,
    };
  }

  pick(point: Point): string | null {
    const { width, height } = this.app.screen;
    if (point.x < 0 || point.y < 0 || point.x > width || point.y > height) return null;
    const selected = this.selected ? this.displays.get(this.selected) : undefined;
    if (!this.gameScene && selected && this.selected && !this.locked.has(this.selected) && isVisible(selected)) {
      const pivot = selected.toGlobal(selected.pivot);
      if (Math.hypot(point.x - pivot.x, point.y - pivot.y) <= 7) return this.selected;
    }
    const pickNodes = (nodes: SceneObject[]): string | null => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        if (!this.gameScene && (!node.visible || node.alpha === 0 || node.locked)) continue;
        if (node.type === 'Container') {
          const child = pickNodes(node.children);
          if (child) return child;
          continue;
        }
        const display = this.displays.get(node.id);
        if (!display || !isVisible(display) || !display.renderable) continue;
        const local = display.toLocal(point);
        const bounds = display.getLocalBounds();
        if (local.x >= bounds.minX && local.x <= bounds.maxX && local.y >= bounds.minY && local.y <= bounds.maxY) return node.id;
      }
      return null;
    };
    const hud = this.objects.filter(node => node.screenSpace && node.type !== 'Camera2D');
    const order = new Map(this.world.children.map((display, index) => [display, index]));
    const rank = (node: SceneObject) => {
      const layer = this.sceneCamera.depth.layerFor(this.displays.get(node.id));
      return layer ? order.get(layer) ?? -1 : -1;
    };
    return pickNodes(hud) ?? pickNodes(this.objects.filter(node => !node.screenSpace || node.type === 'Camera2D')
      .sort((a, b) => rank(a) - rank(b)));
  }

  bounds(id: string): GuideBox | undefined {
    const display = this.displays.get(id);
    if (!display || !isVisible(display)) return;
    const bounds = display.getBounds();
    if (!bounds.isValid) return;
    if (bounds.width > 0 && bounds.height > 0) return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    const center = display.toGlobal(display.pivot);
    return { x: center.x - 4, y: center.y - 4, width: 8, height: 8 };
  }

  pickInBox(from: Point, to: Point) {
    const area = boxBetween(from, to);
    return [...this.displays.keys()].filter(id => {
      if (this.groups.has(id) || this.locked.has(id)) return false;
      const bounds = this.bounds(id);
      return bounds && bounds.x <= area.x + area.width && bounds.x + bounds.width >= area.x &&
        bounds.y <= area.y + area.height && bounds.y + bounds.height >= area.y;
    });
  }

  offsetPosition(id: string, position: Point, delta: Point): Point | undefined {
    const parent = this.displays.get(id)?.parent;
    if (!parent) return;
    const start = parent.toGlobal(position);
    return this.parentPoint(id, { x: start.x + delta.x, y: start.y + delta.y }) ?? undefined;
  }

  worldPosition(id: string, position: Point) {
    return this.displays.get(id)?.parent?.toGlobal(position);
  }

  pivotAt(node: SceneObject, anchor: Point) {
    const bounds = this.displays.get(node.id)?.getLocalBounds();
    if (!bounds?.isValid) return;
    const pivot = { x: bounds.x + anchor.x * bounds.width, y: bounds.y + anchor.y * bounds.height };
    const { rotation, scale, skew, position } = node;
    const radians = Math.PI / 180;
    const matrix = new Matrix().setTransform(0, 0, 0, 0, scale.x, scale.y, rotation * radians, skew.x * radians, skew.y * radians);
    const offset = matrix.apply({ x: pivot.x - node.pivot.x, y: pivot.y - node.pivot.y });
    return { pivot, position: { x: position.x + offset.x, y: position.y + offset.y } };
  }

  parentPoint(id: string, point: Point): Point | null {
    const local = this.displays.get(id)?.parent?.toLocal(point);
    return local && Number.isFinite(local.x) && Number.isFinite(local.y) ? local : null;
  }

  paintPoint(id: string | undefined, point: Point) {
    return (id ? this.displays.get(id) : this.world)?.toLocal(point);
  }

  setViewportGrid(settings: ViewportGrid) {
    this.gridSettings = settings;
    this.drawGrid();
    this.app.render();
  }

  private screenScale() {
    const bounds = this.app.canvas.getBoundingClientRect();
    return { x: bounds.width / this.app.screen.width, y: bounds.height / this.app.screen.height };
  }

  private drawGrid() {
    const overlay = this.grid.clear();
    if (!this.gridSettings?.visible) return;
    const display = this.selected ? this.displays.get(this.selected) : undefined;
    const plane = display?.parent ?? this.world;
    const { width, height } = this.app.screen;
    const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]
      .map(point => plane.toLocal(point));
    const bounds = {
      minX: Math.min(...corners.map(p => p.x)), minY: Math.min(...corners.map(p => p.y)),
      maxX: Math.max(...corners.map(p => p.x)), maxY: Math.max(...corners.map(p => p.y)),
    };
    const { segments } = gridLines(bounds, this.gridSettings.step);
    for (const [from, to] of segments) {
      const a = plane.toGlobal(from);
      const b = plane.toGlobal(to);
      overlay.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    const scale = this.screenScale();
    if (segments.length) overlay.stroke({ color: '#9cc4de', alpha: 0.28, width: 1 / Math.max(0.1, scale.x, scale.y) });
  }

  alignmentTargets(id: string) {
    const moving = this.displays.get(id);
    const boxes = [];
    for (const [other, display] of this.displays) {
      if (id === other || !isVisible(display) || this.groups.has(other)) continue;
      let ancestor = display.parent;
      while (ancestor && ancestor !== moving) ancestor = ancestor.parent;
      if (ancestor) continue;
      const bounds = display.getBounds();
      if (bounds.width > 0 && bounds.height > 0 && bounds.isValid) boxes.push({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    }
    return guideTargets(boxes, this.app.screen);
  }

  alignPosition(id: string, position: Point, targets: GuideTargets): { position: Point; lines: GuideLine[] } {
    const display = this.displays.get(id);
    const parent = display?.parent;
    const scale = this.screenScale();
    if (!display || !parent || !(scale.x > 0 && scale.y > 0)) return { position, lines: [] };
    const bounds = display.getBounds();
    if (!bounds.isValid || !(bounds.width > 0 && bounds.height > 0)) return { position, lines: [] };
    const origin = parent.toGlobal(display.position);
    const next = parent.toGlobal(position);
    const displayed = { x: (bounds.x + next.x - origin.x) * scale.x, y: (bounds.y + next.y - origin.y) * scale.y,
      width: bounds.width * scale.x, height: bounds.height * scale.y };
    const result = snapToGuides(displayed, {
      x: targets.x.map(value => value * scale.x), y: targets.y.map(value => value * scale.y),
    }, 6);
    const local = parent.toLocal({ x: next.x + result.dx / scale.x, y: next.y + result.dy / scale.y });
    return { position: local, lines: result.guides.map(line => ({ ...line, value: line.value / scale[line.axis] })) };
  }

  preview(transforms: readonly ObjectTransform[], lines: GuideLine[] = []) {
    this.draft = transforms;
    this.applyDraft();
    if (this.editView === 'camera') {
      this.updateSceneCamera();
      this.drawGrid();
    }
    this.syncAudio();
    const guides = this.guides.clear();
    const { width, height } = this.app.screen;
    for (const { axis, value } of lines) {
      if (axis === 'x') guides.moveTo(value, 0).lineTo(value, height);
      else guides.moveTo(0, value).lineTo(width, value);
    }
    if (lines.length) {
      const scale = this.screenScale();
      guides.stroke({ color: '#ffba68', width: 1 / Math.max(0.1, scale.x, scale.y) });
    }
    this.drawSelection();
    this.app.render();
  }

  clearPreview() {
    if (!this.draft) return;
    this.draft = undefined;
    this.guides.clear();
    this.render();
  }

  private applyDraft() {
    for (const { id, patch } of this.draft ?? []) {
      const display = this.displays.get(id);
      if (!display) continue;
      const { position, scale, rotation, skew } = patch;
      if (position) display.position.copyFrom(position);
      if (scale) display.scale.copyFrom(scale);
      if (rotation !== undefined) display.angle = rotation;
      if (skew) display.skew.set(skew.x * Math.PI / 180, skew.y * Math.PI / 180);
    }
  }

  attachQuickTools(element: HTMLDivElement) {
    this.quickTools = element;
    const observer = new ResizeObserver(() => this.positionQuickTools());
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    this.positionQuickTools();
    return () => {
      observer.disconnect();
      if (this.quickTools === element) this.quickTools = undefined;
    };
  }

  private positionQuickTools() {
    const element = this.quickTools;
    const host = element?.parentElement;
    if (!element || !host || !this.app.renderer) return;
    const bounds = this.quickBounds;
    const frame = host.getBoundingClientRect();
    const canvas = this.app.canvas.getBoundingClientRect();
    const viewport = this.app.canvas.parentElement?.getBoundingClientRect();
    if (!bounds || !viewport || !canvas.width || !canvas.height || frame.width <= 0 || frame.height <= 0) {
      element.style.visibility = 'hidden';
      return;
    }
    const sx = canvas.width / this.app.screen.width;
    const sy = canvas.height / this.app.screen.height;
    const x = canvas.left - frame.left + bounds.x * sx;
    const y = canvas.top - frame.top + bounds.y * sy;
    const right = x + bounds.width * sx;
    const bottom = y + bounds.height * sy;
    const visibleLeft = Math.max(viewport.left, canvas.left + this.previewInset.x) - frame.left;
    const visibleTop = Math.max(viewport.top, canvas.top + this.previewInset.y) - frame.top;
    const visibleRight = Math.min(viewport.right, canvas.right - this.previewInset.x) - frame.left;
    const visibleBottom = Math.min(viewport.bottom, canvas.bottom - this.previewInset.y) - frame.top;
    if (right < visibleLeft || bottom < visibleTop || x > visibleRight || y > visibleBottom) {
      element.style.visibility = 'hidden';
      return;
    }
    const margin = 8;
    const width = element.offsetWidth, height = element.offsetHeight;
    const left = Math.max(viewport.left - frame.left, Math.min(frame.width - width - margin, (x + right - width) / 2));
    const below = bottom + margin;
    const above = y - height - margin;
    const top = below + height <= frame.height - margin ? below :
      above >= viewport.top - frame.top ? above : Math.max(viewport.top - frame.top, frame.height - height - margin);
    const translation = `${Math.round(left)}px ${Math.round(top)}px`;
    if (element.style.translate !== translation) element.style.translate = translation;
    if (element.style.visibility !== 'visible') element.style.visibility = 'visible';
  }

  setLightingPreview(enabled: boolean) {
    this.editorLighting = enabled;
    this.drawSelection();
    this.app.render();
    this.syncTicker();
  }

  private drawSelection() {
    this.sceneCamera.depth.update(this.app.screen.width);
    const preview = this.effectPreview;
    const pulse = preview?.effect.type === 'lightPulse' ? preview.effect : undefined;
    const light = pulse ? this.authored.get(pulse.id) : undefined;
    this.app.lighting.update(this.world, this.app.screen, this.gameTime,
      !!this.gameScene || this.editorLighting,
      pulse && preview && light?.type === 'Light2D' ? { ...pulse, node: light, seconds: preview.elapsed } : undefined);
    if (this.showColliders) this.drawPhysics();
    this.outline.clear();
    this.audioRanges.clear();
    this.handles = [];
    const scale = this.screenScale();
    const unit = 1 / Math.max(0.1, Math.min(scale.x, scale.y));
    const drawOrigins = (display: Container, pivot: Point, color: string, node?: SceneObject) => {
      // Pixi offsets the geometry by the anchor, so its local origin is at (0, 0).
      const anchor = node && 'anchor' in node ? display.toGlobal({ x: 0, y: 0 }) : undefined;
      drawOriginMarkers(this.outline, pivot, unit, color, anchor);
    };
    const camera = this.selected && !this.gameScene ? this.cameraRig(this.selected) : undefined;
    if (camera) {
      const stage = this.app.screen;
      const { zoom, rotation, x, y } = cameraView(idleCamera(), 0, stage, camera, this.cameraTarget(camera.camera.target));
      const frame = (width: number, height: number, color: string) => {
        const angle = rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dy]) => this.world.toGlobal({
          x: x + (dx * width * cos - dy * height * sin) / 2,
          y: y + (dx * width * sin + dy * height * cos) / 2,
        }));
        this.outline.poly(corners).stroke({ width: unit, color });
      };
      frame(stage.width / zoom, stage.height / zoom, '#e6c84f');
      const { deadzoneWidth, deadzoneHeight } = camera.camera;
      const { limits } = cameraProjection(camera.camera);
      if (deadzoneWidth || deadzoneHeight) frame(Math.max(1, deadzoneWidth / zoom), Math.max(1, deadzoneHeight / zoom), '#9fd96a');
      if (limits?.mode === 'rectangle') this.outline.poly([
        this.world.toGlobal({ x: limits.left, y: limits.top }), this.world.toGlobal({ x: limits.right, y: limits.top }),
        this.world.toGlobal({ x: limits.right, y: limits.bottom }), this.world.toGlobal({ x: limits.left, y: limits.bottom }),
      ]).stroke({ width: unit, color: '#d96a6a' });
    }
    if (this.selectedIds.length > 1 || (this.selected && this.locked.has(this.selected))) {
      const boxes = this.selectedIds.flatMap(id => {
        const bounds = this.bounds(id);
        if (!bounds) return [];
        this.outline.rect(bounds.x, bounds.y, bounds.width, bounds.height)
          .stroke({ color: this.locked.has(id) ? '#9da49d' : '#70caff', width: unit });
        return [bounds];
      });
      for (const id of this.selectedIds) {
        const display = this.displays.get(id);
        if (display?.parent && isVisible(display)) {
          drawOrigins(display, display.toGlobal(display.pivot), this.locked.has(id) ? '#9da49d' : toolColors[this.tool], this.authored.get(id));
        }
      }
      this.quickBounds = unionBoxes(boxes);
      this.positionQuickTools();
      return;
    }
    const display = this.selected ? this.displays.get(this.selected) : undefined;
    if (!display?.parent || !isVisible(display)) {
      this.quickBounds = undefined;
      this.positionQuickTools();
      return;
    }
    const pivot = display.toGlobal(display.pivot);
    const selectedNode = this.selected ? this.authored.get(this.selected) : undefined;
    if (!this.gameScene && selectedNode?.type === 'Light2D' && this.isInWorld(display)) {
      this.outline.circle(pivot.x, pivot.y, selectedNode.light.radius)
        .stroke({ width: unit, color: selectedNode.light.color, alpha: 0.65 });
    }
    const node = this.selected ? this.audioNodes.find(node => node.id === this.selected) : undefined;
    if (node?.type === 'AudioSource' && node.spatial) {
      if (node.minDistance > 0) this.audioRanges.circle(pivot.x, pivot.y, node.minDistance)
        .stroke({ color: '#9fd96a', alpha: 0.8, width: unit });
      this.audioRanges.circle(pivot.x, pivot.y, node.maxDistance)
        .stroke({ color: '#70caff', alpha: 0.8, width: unit });
    }
    const { x, y, width, height, isValid } = display.getLocalBounds();
    const corners: [Point, Point, Point, Point] = isValid && width > 0 && height > 0
      ? [display.toGlobal({ x, y }), display.toGlobal({ x: x + width, y }),
        display.toGlobal({ x: x + width, y: y + height }), display.toGlobal({ x, y: y + height })]
      : [{ x: pivot.x - 10 * unit, y: pivot.y - 10 * unit }, { x: pivot.x + 10 * unit, y: pivot.y - 10 * unit },
        { x: pivot.x + 10 * unit, y: pivot.y + 10 * unit }, { x: pivot.x - 10 * unit, y: pivot.y + 10 * unit }];
    const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    this.quickBounds = { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
    this.positionQuickTools();
    const tool = this.tool === 'move' && this.selected && this.flexChildren.has(this.selected) ? 'select' : this.tool;
    this.handles = drawGizmo(this.outline, tool, corners, pivot, [
      display.parent.toGlobal({ x: display.x + 1, y: display.y }),
      display.parent.toGlobal({ x: display.x, y: display.y + 1 }),
    ], unit);
    drawOrigins(display, pivot, toolColors[tool], selectedNode);
  }

  setGameSuspended(suspended: boolean) {
    this.suspended = suspended;
    this.syncTicker();
  }

  setEditClockRunning(running: boolean) {
    if (!this.editorTicker) return;
    if (running) this.app.resume();
    else this.app.pause();
  }

  setEditView(view: EditView) {
    if (!this.editorTicker || this.editView === view) return;
    this.editView = view;
    this.clearEffectPreview();
    this.app.canvas.dataset.editView = view;
    this.sceneCamera.clearDepth();
    this.applyCameraLayerEffects();
    this.updateSceneCamera();
    this.drawOnions(true);
    this.drawGrid();
    this.drawSelection();
    this.syncAudio();
    this.app.render();
    this.syncTicker();
  }

  playEffectPreview(effect: EffectPreview) {
    if (!this.editorTicker && !this.gameScene) return;
    if (effect.type === 'lightPulse' ? this.authored.get(effect.id)?.type !== 'Light2D' :
        (this.gameScene && this.gameScene.cameraId !== effect.id) || !this.cameraRig(effect.id)) return;
    let zoomFrom: number | undefined;
    if (effect.type === 'zoom') {
      const { min, max } = effect;
      const current = Math.max(min, Math.min(max, this.renderedCameraView?.zoom ?? 1));
      zoomFrom = Math.abs(current - effect.zoom) < 1e-6 ? alternateTestZoom(current, min, max) : current;
    }
    this.effectPreview = { effect, elapsed: 0, zoomFrom };
    this.app.canvas.dataset.effectPreview = effect.type;
    this.updateSceneCamera();
    this.drawGrid();
    this.drawSelection();
    this.app.render();
    if (!this.editorTicker) {
      this.liveEffectTicker ??= new Ticker().add(ticker => {
        this.advanceEffectPreview(ticker.deltaMS / 1000);
        if (!this.app.ticker.started || this.app.scripts.paused) {
          this.drawSelection();
          this.app.render();
        }
      });
      this.liveEffectTicker.start();
    }
    this.syncTicker();
  }

  private advanceEffectPreview(seconds: number) {
    const preview = this.effectPreview;
    if (!preview) return;
    preview.elapsed += seconds;
    if (preview.elapsed >= preview.effect.duration) this.clearEffectPreview();
    if (preview.effect.type !== 'lightPulse') {
      this.updateSceneCamera();
      this.drawGrid();
    }
  }

  stopEffectPreview() {
    if (!this.effectPreview) return;
    this.clearEffectPreview();
    this.updateSceneCamera();
    this.drawGrid();
    this.drawSelection();
    this.app.render();
    this.syncTicker();
  }

  private clearEffectPreview() {
    if (!this.effectPreview) return;
    this.effectPreview = undefined;
    this.liveEffectTicker?.stop();
    delete this.app.canvas.dataset.effectPreview;
  }

  private applyCameraLayerEffects() {
    const camera = this.gameScene ? this.activeCamera()?.camera : this.editCamera()?.camera;
    this.sceneCamera.postFXs.configure(camera?.postFXs);
    if (!camera) return;
    const perspectiveLayers: Container[] = [];
    const visualLayers: Container[] = [];
    for (const node of this.objects) {
      if (node.screenSpace || node.type === 'Camera2D' || node.type === 'AudioSource' ||
          node.type === 'AudioListener' || node.type === 'Light2D') continue;
      const display = this.displays.get(node.id);
      if (!display) continue;
      if (node.type === 'Container') perspectiveLayers.push(display);
      visualLayers.push(display);
    }
    this.sceneCamera.postFXs.apply(visualLayers, perspectiveLayers);
  }

  private syncTicker() {
    if (this.editorTicker) {
      if (this.particlePreview && !this.app.particles.active(isVisible, this.particlePreview)) this.particlePreview = undefined;
      const running = this.timelinePlaying || !!this.particlePreview || !!this.effectPreview;
      if (running) this.editorTicker.start();
      else this.editorTicker.stop();
      return;
    }
    const running = !!this.gameScene && !this.suspended && this.app.clock.state === 'running';
    if (running && !this.app.ticker.started) this.app.ticker.start();
    if (!running && this.app.ticker.started) this.app.ticker.stop();
  }

  private animatedDisplay(node: AnimationObject): Container {
    const anchor = node.type === 'AnimatedSprite' ? node.anchor : undefined;
    const asset = node.asset ? this.assets.get(node.asset) : undefined;
    if (!asset || asset.kind !== (node.type === 'Spine' ? 'spine' : 'sheet')) return new Sprite({ texture: this.placeholder, anchor });
    let entry = this.animationSources.get(asset.alias);
    if (!entry) {
      const pending: AnimationEntry = { asset };
      this.animationSources.set(asset.alias, pending);
      void loadAnimation(asset).then(source => {
        if (this.animationSources.get(asset.alias) !== pending) { source.dispose(); return; }
        pending.source = source;
        this.render();
      }, () => {
        if (this.animationSources.get(asset.alias) !== pending) return;
        pending.failed = true;
        this.render();
      });
      entry = pending;
    }
    if (!entry.source) return new Sprite({ texture: this.placeholder, anchor });
    const existing = this.animations.get(node.id);
    if (existing?.matches(entry.source, node)) {
      existing.sync(node);
      return existing.display;
    }
    existing?.display.destroy({ children: true });
    const animation = new SceneAnimation(entry.source, node);
    this.animations.set(node.id, animation);
    return animation.display;
  }

  private texture(alias: string | null): Texture {
    const asset = alias ? this.assets.get(alias) : undefined;
    if (asset?.kind !== 'image') return this.placeholder;
    const { url } = asset;
    const existing = this.textures.get(url);
    if (existing) return existing.texture ?? this.placeholder;

    const entry: TextureEntry = {};
    this.textures.set(url, entry);
    const image = new Image();
    image.src = url;
    void image.decode().then(() => {
      if (this.textures.get(url) !== entry) return;
      entry.texture = new Texture({ source: new ImageSource({ resource: image }) });
      this.render();
    }, () => {
      if (this.textures.get(url) !== entry) return;
      entry.failed = true;
      this.render();
    });
    return this.placeholder;
  }
}
