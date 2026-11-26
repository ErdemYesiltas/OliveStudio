import type { Application, Container, TickerCallback } from 'pixi.js';
import { Assets } from 'pixi.js';
import { SceneEvents } from './events.js';
import { cancelClockTweens } from '../clock-tween.js';
import { Camera } from '../camera/Camera.js';
import type { CameraOptions } from '../camera/types.js';
import { Layer } from './Layer.js';
import { InstantTransition } from './transitions/InstantTransition.js';
import type {
    AppScreen,
    AppScreenCtor,
    ClearOptions,
    LayerConfig,
    SceneEvent,
    SceneInput,
    SceneOptions,
    ScreenTransition,
} from './types.js';
import type { ResizeMetrics } from './types.js';

const DEFAULT_LAYERS: LayerConfig[] = [
    { name: 'background', zIndex: 0, mode: 'slot', onUpperActive: 'none', modal: false },
    { name: 'main', zIndex: 50, mode: 'stack', onUpperActive: 'pause', modal: false },
    { name: 'overlay', zIndex: 100, mode: 'free', onUpperActive: 'pause', modal: true },
];

/**
 * The three layers this manager registers for itself, and which engine code addresses **by name**
 * with no lookup: `presentScene(app, 'overlay', …)`, `camera('main')`, `SlotBootLoader`'s loading
 * screen. Removing one is allowed — the caller may well be replacing the whole layer set — but it
 * is the one removal that can break code the caller never wrote, so {@link SceneManager.removeLayer}
 * says so out loud.
 */
const DEFAULT_LAYER_NAMES: ReadonlySet<string> = new Set(DEFAULT_LAYERS.map((cfg) => cfg.name));

/**
 * {@link SceneManager.camera} options — {@link CameraOptions} minus `app`, which the manager owns.
 * `name` still opts out of the `scene:<layer>` default when a game wants its own registry key.
 */
export type SceneCameraOptions = Omit<CameraOptions, 'app'>;

interface ScreenRuntime {
    created: boolean;
    tickerListener?: TickerCallback<unknown>;
    layerName: string;
    transition: ScreenTransition;
    paused: boolean;
}

/**
 * Layered scene graph orchestrator. Owns a set of named, z-ordered {@link Layer}s
 * and routes push/pop/replace/clear operations to the matching layer while
 * coordinating cross-layer concerns: pause cascade, ticker registration,
 * asset preload, lifecycle hook invocation, and typed event emission.
 *
 * Installed as `app.scene` by {@link ScenePlugin}.
 */
export class SceneManager {
    /** Typed event bus — see {@link SceneEvent} for the full event catalogue. */
    public readonly events: SceneEvents<SceneEvent>;

    private readonly _app: Application;
    private readonly _layers = new Map<string, Layer>();
    private readonly _runtimes = new WeakMap<AppScreen, ScreenRuntime>();
    private readonly _rootContainer: Container;
    private _defaultTransition: ScreenTransition;
    private _scaleResizeOff?: () => void;
    private _onVisibilityChange?: () => void;
    private _activeOps = 0;
    private _prefetchCache = new Map<AppScreenCtor, AppScreen>();

    /**
     * @param app - Host PixiJS application. The manager parents every layer under `app.stage`.
     * @param options - Optional default transition and additional layers to register on top of the defaults
     *                  (`background`, `main`, `overlay`).
     */
    constructor(app: Application, private readonly options: SceneOptions = {}) {
        this._app = app;
        this.events = new SceneEvents<SceneEvent>();
        this._defaultTransition = options.defaultTransition ?? new InstantTransition();

        this._rootContainer = app.stage;

        for (const cfg of DEFAULT_LAYERS) this._registerLayer(cfg);
        if (options.layers) {
            for (const cfg of options.layers) this._registerLayer(cfg);
        }
    }

    // ----- Layer registry -----

    /**
     * Register a custom layer on top of the defaults.
     *
     * @param config - Layer name, z-index, mode, and activation policy.
     * @returns The created {@link Layer}.
     * @throws {Error} When a layer with the same name is already registered.
     */
    public defineLayer(config: LayerConfig): Layer {
        return this._registerLayer(config);
    }

    /** Whether a layer with the given name is registered. */
    public hasLayer(name: string): boolean {
        return this._layers.has(name);
    }

    /**
     * Unregister a layer and destroy everything in it — the inverse of {@link defineLayer}, and
     * the only way a layer stops existing short of {@link destroy}.
     *
     * {@link clear} is not this: it empties the stack and leaves the layer in place, still parented
     * under the scene root, still holding its `childAdded`/`childRemoved` listeners, still owning
     * its name. Since {@link defineLayer} throws on a duplicate name, a layer created for one phase
     * of the game — a boot loading screen, a one-shot tournament overlay — could never be taken
     * back out, and its name could never be reused. This closes that.
     *
     * Queued behind the layer's other operations, so it runs when the layer is idle rather than
     * cutting into a push that is mid-transition. In order:
     *
     * 1. every stacked screen is popped properly (`hide` → transition `exit` → ticker removal →
     *    `reset` → `destroy`), so `screen:before-pop` / `screen:after-pop` still fire for each;
     * 2. children added straight to the container are released the same way (see
     *    {@link ClearOptions.unmanaged} — here it is unconditional, because the container they live
     *    in is about to be destroyed regardless);
     * 3. `Layer.destroy()` detaches the listeners and destroys the container with its children.
     *    A {@link Camera} pointed at that container tears itself down off the `destroyed` event and
     *    unregisters from `app.cameras`, so `scene:<layer>` needs nothing here;
     * 4. the name leaves the registry, the parent re-sorts, and the pause/interactivity cascade is
     *    recomputed without it.
     *
     * Afterwards `hasLayer` is `false`, {@link layerNames} no longer lists it, `push`/`pop`/`camera`
     * throw for that name, and `defineLayer` accepts it again. Idempotent: a second call queued
     * behind the first returns without doing anything.
     *
     * Two things are warned about rather than refused. Removing one of the engine defaults
     * (`background` / `main` / `overlay`) breaks callers that name it directly, and emptying the
     * registry entirely leaves the manager with nowhere to put a screen at all — both are legal,
     * both are almost always a mistake.
     *
     * @param name - Registered layer name.
     * @throws {Error} When `name` is not registered.
     */
    public removeLayer(name: string): Promise<void> {
        const layer = this._requireLayer(name);
        return this._track(
            layer.enqueue(async () => {
                // A second `removeLayer` queued behind the first: the name is already gone, and
                // `layer.destroy()` is not safe to run twice on a destroyed container.
                if (this._layers.get(name) !== layer) return;

                while (layer.depth() > 0) await this._popImpl(layer, undefined);
                this._releaseUnmanaged(layer);

                if (DEFAULT_LAYER_NAMES.has(name)) {
                    console.warn(
                        `[Scene] Removed the engine default layer "${name}". Engine code addresses it by name — ` +
                            `presentScene(app, 'overlay', …), camera('main'), the boot loader's loading screen — and those ` +
                            `calls now throw. Re-register it with defineLayer() if anything still reaches for it.`,
                    );
                }

                const parent = layer.container.parent;
                layer.destroy();
                this._layers.delete(name);
                parent?.sortChildren();
                this._applyCascade();
                this.events.emit({ type: 'layer:removed', layer: name });

                if (this._layers.size === 0) {
                    console.warn(
                        '[Scene] Every layer has been removed — the manager has nowhere left to mount a screen. ' +
                            'push/pop/replace/clear/camera throw for any name until defineLayer() registers one, and ' +
                            'app.stage now holds no scene content at all.',
                    );
                }
            }),
        );
    }

    /**
     * Names of every registered layer, in registration order.
     *
     * The rest of this API is keyed by layer name, which assumes the caller already knows
     * the names — true for game code that registered them, false for tooling that arrives
     * afterwards and has to discover what the game set up.
     */
    public get layerNames(): string[] {
        return [...this._layers.keys()];
    }

    /**
     * Get a layer's PixiJS container by name.
     *
     * @throws {Error} When `name` is not registered.
     */
    public getLayer(name: string): Container {
        return this._requireLayer(name).container;
    }

    /**
     * The {@link Camera} for a layer — created on first call, then resolved from `app.cameras`.
     *
     * A layer container is the one thing in the tree that nothing else positions: screens inside it
     * are sized as `@pixi/layout` roots on every resize, but the container's own transform is
     * untouched. That makes it the correct camera target, and this method the reason not to wire one
     * by hand — it supplies the `viewport` (without which `focus`/`follow`/`edgeLock` silently
     * degrade) and names the camera `scene:<layer>`. Point a camera at an ordinary display object
     * instead and the layout pass and the responsive rules end up fighting it for the same transform.
     *
     * `app.cameras` **is** the cache: a `Camera` registers itself under its name and unregisters on
     * `dispose`, so a second call resolves the live one and a disposed one is simply gone. Teardown
     * needs nothing here either — the camera listens for its target's `destroyed`, which
     * `layer.destroy()` fires.
     *
     * `options` are forwarded to the constructor; `app` is always this manager's. The default name is
     * what makes `app.cameras.get()` resolvable with no argument when a game has exactly one camera —
     * which is what `slot`'s impact effects assume.
     *
     * @example
     * const cam = app.scene.camera('main', { edgeLock: true, minZoom: 0.8, maxZoom: 2 });
     * await cam.focus(reelBounds, { zoom: 1.2, ms: 600 });
     *
     * @throws {Error} When `layerName` is not registered, or when `CameraPlugin` is not installed —
     * without the registry this method has nowhere to keep the camera, and every call would mint a
     * fresh one holding its own tweens.
     */
    public camera(layerName = 'main', options: SceneCameraOptions = {}): Camera {
        const cameras = this._app.cameras;
        if (!cameras) {
            throw new Error('[Scene] camera() needs CameraPlugin — `extensions.add(CameraPlugin)`, or boot through boot().');
        }
        const name = options.name ?? `scene:${layerName}`;
        const existing = cameras.get(name);
        if (existing) return existing;

        return new Camera(this._requireLayer(layerName).container, {
            viewport: () => this._app.screen,
            ...options,
            app: this._app,
            name,
        });
    }

    /** Top of the stack for a given layer, or `undefined` if the layer is empty or unknown. */
    public top(layerName: string): AppScreen | undefined {
        return this._layers.get(layerName)?.top();
    }

    /** Number of screens currently on the layer's stack (`0` for free-mode or empty layers). */
    public depth(layerName: string): number {
        return this._layers.get(layerName)?.depth() ?? 0;
    }

    /** Replace the fallback transition used when push/pop callers don't supply one. */
    public setDefaultTransition(transition: ScreenTransition): void {
        this._defaultTransition = transition;
    }

    public async prefetch<T extends AppScreen>(Ctor: AppScreenCtor<T>): Promise<void> {
        if (this._prefetchCache.has(Ctor)) return;

        if (Ctor.assetBundles?.length) {
            const loader = this.options.loadBundle;
            if (loader) await loader(Ctor.assetBundles);
            else await Assets.loadBundle(Ctor.assetBundles);
        }

        const screen = new Ctor();
        screen.game = this._app;

        if (typeof screen.create === 'function') {
            await screen.create();
        }

        this._prefetchCache.set(Ctor, screen);
    }

    public evict(ctor: AppScreenCtor): void {
        const screen = this._prefetchCache.get(ctor);
        if (!screen) return;
        screen.reset?.();
        screen.destroy({ children: true });
        this._prefetchCache.delete(ctor);
    }

    // ----- Mutators -----

    /**
     * Instantiate and present a screen on `layerName`.
     *
     * For `stack` layers the new screen is layered on top and the previous one is paused.
     * For `slot` layers any existing child is removed first. Operations on the same layer
     * are serialized via {@link Layer.enqueue}.
     *
     * @param layerName - Target layer.
     * @param ctor - Screen class. Static `assetBundles` are preloaded before mount.
     * @param input - Optional bag forwarded to `screen.prepare(input)`.
     * @param transition - Per-call override of the default transition.
     * @returns The mounted screen instance, once its `show` and transition `enter` have completed.
     * @throws {Error} When `layerName` is not registered.
     */
    public push<T extends AppScreen>(
        layerName: string,
        ctor: AppScreenCtor<T>,
        input?: SceneInput,
        transition?: ScreenTransition,
    ): Promise<T> {
        const layer = this._requireLayer(layerName);
        return this._track(layer.enqueue(() => this._pushImpl<T>(layer, ctor, input, transition)));
    }

    /**
     * Remove the top screen from `layerName`, resume the screen revealed beneath it, and destroy
     * the removed screen. No-op when the layer is empty.
     *
     * @param transition - Per-call override of the screen's recorded transition.
     * @throws {Error} When `layerName` is not registered.
     */
    public pop(layerName: string, transition?: ScreenTransition): Promise<void> {
        const layer = this._requireLayer(layerName);
        return this._track(layer.enqueue(() => this._popImpl(layer, transition)));
    }

    /**
     * Close **one specific screen**, wherever it sits — the addressable counterpart to {@link pop},
     * which can only take the top of a stack.
     *
     * Three cases, and the point is that the caller does not have to know which one it is holding:
     *
     * - **Top of its stack** — delegates to the same implementation `pop` uses, so the screen
     *   revealed underneath is resumed and the events are identical. `close(top)` and `pop(layer)`
     *   are the same operation.
     * - **Buried in a stack** — spliced out in place. Everything above it stays exactly where it
     *   was, and no pause state changes: nothing about the visible top screen changed, so nothing
     *   should be resumed. Its recorded transition still runs, which is usually invisible (the
     *   screen is behind another one); pass `new InstantTransition()` to skip it.
     * - **A direct child of a `free` layer** — a popup or toast added with
     *   `getLayer(name).addChild(…)`, which never entered a stack at all. `pop` and `clear` cannot
     *   see those (`depth()` is `0` for them), so before this there was no way to close one through
     *   the manager; the owner had to destroy it by hand and hope the cascade noticed.
     *
     * The layer is found from the screen itself, so there is no name to get wrong, and the work is
     * queued on that layer like every other mutation. A screen that is already gone — closed twice,
     * or destroyed by its owner — is a warning and a no-op, not a throw: by the time a caller gets
     * here the screen may legitimately have been taken down by the layer it was on.
     *
     * @param screen - The screen instance to close.
     * @param transition - Per-call override of the screen's recorded transition.
     */
    public close(screen: AppScreen, transition?: ScreenTransition): Promise<void> {
        const layerName = this._runtimes.get(screen)?.layerName ?? this._findLayerOf(screen);
        const layer = layerName ? this._layers.get(layerName) : undefined;
        if (!layer) {
            console.warn('[Scene] close(): this screen is not on any registered layer — nothing to close.');
            return Promise.resolve();
        }
        return this._track(layer.enqueue(() => this._closeImpl(layer, screen, transition)));
    }

    /**
     * Pop every screen on `layerName` and push `ctor`. Atomic with respect to other queued ops.
     *
     * @throws {Error} When `layerName` is not registered.
     */
    public replace<T extends AppScreen>(
        layerName: string,
        ctor: AppScreenCtor<T>,
        input?: SceneInput,
        transition?: ScreenTransition,
    ): Promise<T> {
        const layer = this._requireLayer(layerName);
        return this._track(
            layer.enqueue(async () => {
                while (layer.depth() > 0) await this._popImpl(layer, transition);
                return this._pushImpl<T>(layer, ctor, input, transition);
            }),
        );
    }

    /**
     * Pop every screen on `layerName` until the stack is empty. The layer itself stays registered —
     * {@link removeLayer} is what takes it out.
     *
     * By default this only reaches **stacked** screens, which for a `free`-mode layer means it may
     * do nothing at all: `depth()` is `0` for children added straight to the container, so a layer
     * full of popups clears to still-full. Pass `{ unmanaged: true }` to release those too.
     *
     * @param options - See {@link ClearOptions}.
     * @throws {Error} When `layerName` is not registered.
     */
    public clear(layerName: string, options?: ClearOptions): Promise<void> {
        const layer = this._requireLayer(layerName);
        return this._track(
            layer.enqueue(async () => {
                while (layer.depth() > 0) await this._popImpl(layer, undefined);
                if (options?.unmanaged) this._releaseUnmanaged(layer);
            }),
        );
    }

    // ----- Lifecycle forwarding -----

    /**
     * Forward a resize event to every screen — both stacked occupants and direct
     * `addChild` children of free-mode layers.
     */
    public resize(metrics: ResizeMetrics): void {
        for (const layer of this._layers.values()) {
            for (const screen of layer.stack) {
                this._sizeLayoutRoot(screen, metrics);
                screen.resize?.(metrics);
            }
            for (const child of layer.container.children) {
                if (layer.stack.indexOf(child as AppScreen) === -1) {
                    this._sizeLayoutRoot(child as AppScreen, metrics);
                    (child as AppScreen).resize?.(metrics);
                }
            }
        }
    }

    /**
     * For a screen that opted into {@link AppScreen.layoutRoot}, make it a
     * `@pixi/layout` root sized to the full game area. When `layoutRoot` is a style
     * object it becomes the base style (e.g. `justifyContent`/`alignItems` for
     * centering); the game-area `width`/`height` are merged on top. No-op otherwise.
     */
    private _sizeLayoutRoot(screen: AppScreen, metrics: ResizeMetrics): void {
        if (!screen.layoutRoot) return;
        const base = typeof screen.layoutRoot === 'object' ? screen.layoutRoot : {};
        (screen as { layout?: unknown }).layout = { ...base, width: metrics.gameWidth, height: metrics.gameHeight };
    }

    /** Forward a tab/window blur event to every screen. */
    public blur(): void {
        this._forEachScreen((s) => s.blur?.());
    }

    /** Forward a tab/window focus event to every screen. */
    public focus(): void {
        this._forEachScreen((s) => s.focus?.());
    }

    /**
     * Tear down: detach platform listeners, destroy every layer, and clear
     * the event emitter. The manager is unusable afterwards.
     */
    public destroy(): void {
        this._scaleResizeOff?.();
        this._scaleResizeOff = undefined;
        if (this._onVisibilityChange && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this._onVisibilityChange);
        }
        this._onVisibilityChange = undefined;

        for (const layer of this._layers.values()) {
            for (const screen of layer.stack) {
                const rt = this._runtimes.get(screen);
                if (rt?.tickerListener) this._app.ticker.remove(rt.tickerListener);
                // `layer.destroy()` destroys the container with its children, which reaches every
                // screen's `destroy` but not its `reset` — and `reset` is where a screen releases
                // what `destroy` cannot see: RxJS subscriptions, event handlers on other services.
                // Skipping it here leaked those for the app's whole remaining lifetime.
                cancelClockTweens(screen);
                screen.reset?.();
            }
            this._releaseUnmanaged(layer);
            layer.destroy();
        }
        this._layers.clear();
        this.events.clear();
        for (const screen of this._prefetchCache.values()) {
            screen.reset?.();
            screen.destroy({ children: true });
        }
        this._prefetchCache.clear();
    }

    // ----- Plugin wiring (called by ScenePlugin) -----

    /**
     * Internal: store the scale plugin's unsubscribe handle so `destroy` can
     * detach it. Not part of the public API; invoked by {@link ScenePlugin}.
     */
    public _attachScale(off: () => void): void {
        this._scaleResizeOff = off;
    }

    /**
     * Internal: subscribe to `document.visibilitychange` and translate it to
     * `blur` / `focus` cascades. Not part of the public API.
     */
    public _installVisibilityListeners(): void {
        if (typeof document === 'undefined') return;
        this._onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') this.blur();
            else this.focus();
        };
        document.addEventListener('visibilitychange', this._onVisibilityChange);
    }

    // ----- Internal -----

    private _registerLayer(config: LayerConfig): Layer {
        if (this._layers.has(config.name)) {
            throw new Error(`[Scene] Layer "${config.name}" already registered.`);
        }
        const layer = new Layer(config);
        this._layers.set(config.name, layer);
        const parent = this._resolveLayerParent(config.name, config.output);
        parent.addChild(layer.container);
        if (parent.sortableChildren !== true) parent.sortableChildren = true;
        parent.sortChildren();
        layer.observeChildren(() => this._applyCascade());
        return layer;
    }

    /**
     * The container a layer mounts under: `app.stage` for the main canvas, or the
     * matching `multiView` output root when `output` is set. Falls back to
     * `app.stage` (with a warning) if the output is unknown.
     */
    private _resolveLayerParent(layerName: string, output: string | undefined): Container {
        if (!output || output === 'main') return this._rootContainer;
        const root = this.options.resolveOutput?.(output);
        if (root) return root;
        console.warn(`[Scene] Layer "${layerName}" output "${output}" not found in app.canvases — rendering on the main canvas.`);
        return this._rootContainer;
    }

    /**
     * Move a layer to a different `multiView` output (or back to the main canvas) at
     * runtime. The layer's container — with all its content — is reparented; nothing
     * is re-created. Queued behind the layer's other ops so it runs when the layer is idle.
     *
     * Display-only caveat: a layer on an output canvas receives no pointer events
     * (events stay bound to the main canvas). Pass `undefined` or `'main'` to return it.
     *
     * @param name - Registered layer name.
     * @param output - Target output id, or `undefined`/`'main'` for the main canvas.
     * @throws {Error} When `name` is not registered.
     */
    public setLayerOutput(name: string, output?: string): Promise<void> {
        const layer = this._requireLayer(name);
        return this._track(layer.enqueue(async () => {
            const cur = layer.output && layer.output !== 'main' ? layer.output : undefined;
            const next = output && output !== 'main' ? output : undefined;
            if (cur === next) return;
            const parent = this._resolveLayerParent(layer.name, output);
            parent.addChild(layer.container); // addChild auto-removes from the old parent
            if (parent.sortableChildren !== true) parent.sortableChildren = true;
            parent.sortChildren();
            layer.output = output;
        }));
    }

    /** The output a layer currently renders to (`undefined` = main canvas). `undefined` for unknown layers. */
    public getLayerOutput(name: string): string | undefined {
        return this._layers.get(name)?.output;
    }

    private _requireLayer(name: string): Layer {
        const layer = this._layers.get(name);
        if (!layer) throw new Error(`[Scene] Unknown layer "${name}".`);
        return layer;
    }

    private async _pushImpl<T extends AppScreen>(
        layer: Layer,
        Ctor: AppScreenCtor<T>,
        input: SceneInput,
        transition: ScreenTransition | undefined,
    ): Promise<T> {
        const prev = layer.top();
        this.events.emit({ type: 'screen:before-push', layer: layer.name, Ctor, from: prev });

        if (Ctor.assetBundles && Ctor.assetBundles.length > 0) {
            const loader = this.options.loadBundle;
            const onProgress = (progress: number) => { prev?.onLoad?.(progress * 100); };
            if (loader) await loader(Ctor.assetBundles, onProgress);
            else await Assets.loadBundle(Ctor.assetBundles, onProgress);
            prev?.onLoad?.(100);
        }

        // A `slot` layer holds exactly one occupant, so the previous one is not being covered — it
        // is leaving. Tear it down through the real pop path.
        //
        // This used to be a bare `layer.container.removeChildren()` just before `addChild`, which
        // unparented the old screen and abandoned it: it stayed on `layer.stack`, its ticker
        // listener stayed registered (so `update` kept firing on an invisible, parentless screen),
        // `hide`/`reset`/`destroy` never ran, and `depth()` grew by one per push. A later `pop()`
        // then removed the *new* screen and left `top()` pointing at the zombie, so the layer read
        // as occupied while drawing nothing. `background` is a `slot` layer by default, as are the
        // sandbox's `board` and `loading`.
        if (layer.mode === 'slot') {
            while (layer.depth() > 0) await this._popImpl(layer, transition);
        }

        // Skipped for `slot`, where `prev` was just destroyed: pausing is for a screen that will be
        // resumed when what covered it goes away, and nothing is coming back to this one.
        if (layer.mode !== 'slot' && prev && !this._runtimes.get(prev)?.paused) {
            await prev.pause?.();
            const rt = this._runtimes.get(prev);
            if (rt) rt.paused = true;
        }

        const cached = this._prefetchCache.get(Ctor) as T | undefined;
        this._prefetchCache.delete(Ctor);
        const screen = cached ?? new Ctor();
        if (!screen.label) screen.label = Ctor.name.toLowerCase();
        screen.game = this._app;
        const effectiveTransition = transition ?? this._defaultTransition;
        const runtime: ScreenRuntime = {
            created: !!cached,
            layerName: layer.name,
            transition: effectiveTransition,
            paused: false,
        };
        this._runtimes.set(screen, runtime);

        if (!cached && typeof screen.create === 'function') {
            await screen.create();
            runtime.created = true;
        }
        screen.prepare?.(input);
        const metrics = { gameWidth: this._app.screen.width, gameHeight: this._app.screen.height };
        this._sizeLayoutRoot(screen, metrics);
        screen.resize?.(metrics);

        if (typeof screen.update === 'function') {
            const bound: TickerCallback<unknown> = ticker => { if (!runtime.paused) screen.update?.(ticker); };
            this._app.ticker.add(bound);
            runtime.tickerListener = bound;
        }

        layer.stack.push(screen);
        layer.container.addChild(screen);

        if (layer.mode === 'stack' && prev) {
            prev.visible = true;
        }

        await Promise.all([
            screen.show?.(prev),
            effectiveTransition.enter(screen, prev),
        ]);

        this.events.emit({ type: 'screen:after-push', layer: layer.name, screen, from: prev });
        return screen;
    }

    private async _popImpl(layer: Layer, transition: ScreenTransition | undefined): Promise<void> {
        const screen = layer.stack.pop();
        if (!screen) return;
        const to = layer.top();
        const runtime = this._runtimes.get(screen);
        const effectiveTransition = transition ?? runtime?.transition ?? this._defaultTransition;

        this.events.emit({ type: 'screen:before-pop', layer: layer.name, screen, to });

        await Promise.all([
            screen.hide?.(to),
            effectiveTransition.exit(screen, to),
        ]);

        if (runtime?.tickerListener) {
            this._app.ticker.remove(runtime.tickerListener);
            runtime.tickerListener = undefined;
        }

        if (layer.container.children.includes(screen)) layer.container.removeChild(screen);
        screen.reset?.();
        this._runtimes.delete(screen);
        screen.destroy({ children: true });

        if (to) {
            const toRuntime = this._runtimes.get(to);
            if (toRuntime?.paused) {
                await to.resume?.();
                toRuntime.paused = false;
            }
        }

        this.events.emit({ type: 'screen:after-pop', layer: layer.name, screen, to });
    }

    /**
     * Close one screen that is **not** the top of its stack — buried under others, or a direct
     * `addChild` child of a `free` layer that never entered a stack at all.
     *
     * The top-of-stack case is delegated to {@link _popImpl} rather than reimplemented, so
     * `close(top)` and `pop(layer)` cannot drift: the resume of the revealed screen lives in
     * exactly one place.
     */
    private async _closeImpl(layer: Layer, screen: AppScreen, transition: ScreenTransition | undefined): Promise<void> {
        const index = layer.stack.indexOf(screen);
        if (index !== -1 && index === layer.stack.length - 1) {
            await this._popImpl(layer, transition);
            return;
        }

        const unmanaged = index === -1;
        if (unmanaged && !layer.container.children.includes(screen)) {
            console.warn(`[Scene] close(): screen is no longer on layer "${layer.name}" — nothing to close.`);
            return;
        }

        const runtime = this._runtimes.get(screen);
        const effectiveTransition = transition ?? runtime?.transition ?? this._defaultTransition;
        // What "takes over" from a buried screen is whatever is already on top — nothing about the
        // visible state changes, which is also why no pause/resume happens here.
        const to = unmanaged ? undefined : layer.top();

        this.events.emit({ type: 'screen:before-pop', layer: layer.name, screen, to });

        await Promise.all([
            screen.hide?.(to),
            effectiveTransition.exit(screen, to),
        ]);

        // Re-read the index: the awaits above are the one window in which a `hide` implementation
        // could have reordered the stack under us.
        const at = layer.stack.indexOf(screen);
        if (at !== -1) layer.stack.splice(at, 1);

        if (runtime?.tickerListener) {
            this._app.ticker.remove(runtime.tickerListener);
            runtime.tickerListener = undefined;
        }

        if (layer.container.children.includes(screen)) layer.container.removeChild(screen);
        screen.reset?.();
        this._runtimes.delete(screen);
        screen.destroy({ children: true });

        this.events.emit({ type: 'screen:after-pop', layer: layer.name, screen, to });
    }

    /**
     * Destroy every child of a layer's container that is not on its stack — the popups and toasts a
     * `free`-mode layer was created to hold.
     *
     * They are given the same courtesy a popped screen gets (ticker removal if they somehow have a
     * runtime, then `reset?.()` before `destroy`), because `AppScreen` is the shape a caller reaches
     * for whether it pushes or `addChild`s. No transition runs: this is a teardown path
     * ({@link removeLayer}, or an explicit `clear(name, { unmanaged: true })`), and the container is
     * either going away or being emptied on purpose.
     */
    private _releaseUnmanaged(layer: Layer): void {
        // A copy, because `removeChild` mutates the live array mid-iteration.
        for (const child of [...layer.container.children]) {
            if (layer.stack.indexOf(child as AppScreen) !== -1) continue;
            const screen = child as AppScreen;
            const runtime = this._runtimes.get(screen);
            if (runtime?.tickerListener) {
                this._app.ticker.remove(runtime.tickerListener);
                runtime.tickerListener = undefined;
            }
            layer.container.removeChild(child);
            screen.reset?.();
            this._runtimes.delete(screen);
            child.destroy({ children: true });
        }
    }

    /**
     * The layer a screen sits on, for a screen this manager never pushed — so `_runtimes`, which is
     * written on push, has no entry to read the name from. A `free` layer's `addChild` children are
     * the whole reason {@link close} needs this fallback.
     */
    private _findLayerOf(screen: AppScreen): string | undefined {
        for (const [name, layer] of this._layers) {
            if (layer.container.children.includes(screen)) return name;
        }
        return undefined;
    }

    /**
     * Recompute pause/interactivity cascade across all layers.
     *
     * Walks layers from top z-index downward. A `modal` layer with content sets
     * `blockingActive`, after which every lower layer gets `eventMode = 'none'`
     * and (if its `onUpperActive` is `'pause'`) its top screen is paused.
     * Layers above the modal stay interactive.
     *
     * Emits `layer:activated` / `layer:idle` for free-mode layers so external
     * code can sync UI badges to popup state.
     */
    private _applyCascade(): void {
        const layers = Array.from(this._layers.values()).sort((a, b) => a.config.zIndex - b.config.zIndex);
        let blockingActive = false;

        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];

            if (blockingActive) {
                if (layer.container.eventMode !== 'none') {
                    layer.container.eventMode = 'none';
                }
                if (layer.onUpperActive === 'pause') {
                    const top = layer.top();
                    if (top) {
                        const rt = this._runtimes.get(top);
                        if (rt && !rt.paused) {
                            rt.paused = true;
                            void top.pause?.();
                        }
                    }
                }
            } else {
                if (layer.container.eventMode !== 'auto') {
                    layer.container.eventMode = 'auto';
                }
                if (layer.onUpperActive === 'pause') {
                    const top = layer.top();
                    if (top) {
                        const rt = this._runtimes.get(top);
                        if (rt?.paused) {
                            rt.paused = false;
                            void top.resume?.();
                        }
                    }
                }
            }

            if (layer.hasContent && layer.modal) {
                blockingActive = true;
            }
        }

        for (const layer of layers) {
            if (layer.mode === 'free') {
                if (layer.hasContent) this.events.emit({ type: 'layer:activated', layer: layer.name });
                else this.events.emit({ type: 'layer:idle', layer: layer.name });
            }
        }
    }

    private _forEachScreen(fn: (s: AppScreen) => void): void {
        for (const layer of this._layers.values()) {
            for (const screen of layer.stack) fn(screen);
            for (const child of layer.container.children) {
                if (layer.stack.indexOf(child as AppScreen) === -1) fn(child as AppScreen);
            }
        }
    }

    private _track<T>(p: Promise<T>): Promise<T> {
        this._activeOps++;
        p.finally(() => {
            this._activeOps--;
            if (this._activeOps === 0) this.events.emit({ type: 'scene:idle' });
        }).catch(() => {
            // `p` itself is handed back to the caller, which owns its rejection. This
            // derived chain exists only to decrement the counter, so swallowing keeps a
            // failed push from surfacing twice as an unhandled rejection.
        });
        return p;
    }
}
