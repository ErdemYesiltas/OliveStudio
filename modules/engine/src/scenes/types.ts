import type { Application, Container, Ticker } from 'pixi.js';

export interface ResizeMetrics { gameWidth: number; gameHeight: number }
import type {} from '@pixi/layout';
type LayoutStyles = Extract<Container['layout'], object>;

/** Free-form input bag passed to `AppScreen.prepare` on push/replace. */
export type SceneInput = Record<string, unknown> | undefined;

/**
 * Lifecycle contract for a screen managed by a {@link Layer}.
 *
 * Every hook is optional — implement only what the screen needs. The scene
 * manager invokes them in the order documented on each property.
 */
export interface AppScreen extends Container {
    /** Set by the scene manager on push. Provides access to the host {@link Application}. */
    game?: Application;

    /**
     * Makes this screen a `@pixi/layout` root sized to the game area
     * (`gameWidth × gameHeight`) on mount and kept in sync on every resize.
     * Children using `layout` (e.g. `{ width: '100%', height: '100%', objectFit:
     * 'cover' }`) then resolve against the full screen — no per-scene resize wiring.
     *
     * - `true` — full-screen root with default flex (no centering).
     * - a `@pixi/layout` `LayoutStyles` object — full-screen root **with that style**;
     *   the game-area `width`/`height` are merged in on top. Use this to make the
     *   root center its children, e.g. `{ justifyContent: 'center', alignItems:
     *   'center' }`, so a single centered child needs no wrapper container.
     */
    layoutRoot?: boolean | LayoutStyles;

    /** One-time async setup. Runs once per instance after asset preload, before {@link prepare}. */
    create?(): Promise<void>;

    /** Pre-show configuration. Called every push with the caller-supplied input. */
    prepare?(input?: SceneInput): void;

    /** Entrance hook. `prev` is the screen this one is layered on top of. */
    show?(prev?: AppScreen): Promise<void>;

    /** Exit hook. `next` is the screen taking this one's place (undefined on pop-to-empty). */
    hide?(next?: AppScreen): Promise<void>;

    /** Called when a modal layer activates above; freeze game logic but keep state. */
    pause?(): Promise<void>;

    /** Called when the modal layer above empties; resume game logic. */
    resume?(): Promise<void>;

    /** Last chance to release resources before {@link Container.destroy}. */
    reset?(): void;

    /** Ticker callback registered on push, removed on pop. */
    update?(time: Ticker): void;

    /** Forwarded from {@link SceneManager.resize}. */
    resize?(metrics: ResizeMetrics): void;

    /** Browser tab/window blur. */
    blur?(): void;

    /** Browser tab/window focus. */
    focus?(): void;

    /** Asset bundle preload progress (0-100). */
    onLoad?(progress: number): void;
}

/** Constructor for a screen class. Static `assetBundles` are preloaded before push. */
export interface AppScreenCtor<T extends AppScreen = AppScreen> {
    new(): T;
    /** Asset bundles preloaded via `Assets.loadBundle` before the screen mounts. */
    assetBundles?: string[];
}

/** Policy for what happens to lower layers when this layer becomes active. */
export type LayerActivationPolicy = 'pause' | 'blur' | 'none';

/** Stack semantics for a layer. */
export type LayerMode =
    /** Single occupant. New push replaces existing content. */
    | 'slot'
    /** Push/pop stack. Top is visible/interactive; lower entries are paused. */
    | 'stack'
    /** Multiple concurrent occupants. External code calls `addChild` directly. */
    | 'free';

/** Configuration for a single layer registered with {@link SceneManager}. */
export interface LayerConfig {
    /** Unique identifier used by `push` / `pop` / `getActive` to address this layer. */
    name: string;
    /** Stacking order on the scene root. Higher values render above lower ones. */
    zIndex: number;
    /** Stack semantics — see {@link LayerMode}. */
    mode: LayerMode;
    /** What happens to lower layers when this one has content. Default: `'none'`. */
    onUpperActive?: LayerActivationPolicy;
    /** When true and this layer has content, lower layers' interactivity is blocked. */
    modal?: boolean;
    /**
     * Render this layer to a separate `multiView` output canvas instead of the main
     * one. The value is a {@link ViewOutputConfig} id from `ApplicationOptions.canvases`.
     * Omitted (or `'main'`) renders on the main canvas (`app.stage`), as usual.
     *
     * Output canvases are display-only (no pointer events) — keep interactive layers
     * on the main canvas. `zIndex` still orders this layer within its own canvas.
     */
    output?: string;
}

/**
 * Transition strategy invoked during push/pop. The scene manager awaits these
 * around screen `show`/`hide` hooks; both can run in parallel via Promise.all.
 */
export interface ScreenTransition {
    /** Animate `screen` into view. `prev` is the screen being layered over. */
    enter(screen: AppScreen, prev?: AppScreen): Promise<void>;
    /** Animate `screen` out of view. `next` is the screen taking over. */
    exit(screen: AppScreen, next?: AppScreen): Promise<void>;
}

/**
 * Discriminated union of scene events flowing through `SceneManager.events` (an
 * `EventBus<SceneEvent>`). Payload fields are flat alongside `type`, so
 * `events.on('screen:after-push', ({ layer, screen }) => …)` reads them directly.
 */
export type SceneEvent =
    | { readonly type: 'screen:before-push'; readonly layer: string; readonly Ctor: AppScreenCtor; readonly from: AppScreen | undefined }
    | { readonly type: 'screen:after-push'; readonly layer: string; readonly screen: AppScreen; readonly from: AppScreen | undefined }
    | { readonly type: 'screen:before-pop'; readonly layer: string; readonly screen: AppScreen; readonly to: AppScreen | undefined }
    | { readonly type: 'screen:after-pop'; readonly layer: string; readonly screen: AppScreen; readonly to: AppScreen | undefined }
    | { readonly type: 'layer:activated'; readonly layer: string }
    | { readonly type: 'layer:idle'; readonly layer: string }
    /**
     * A layer left the registry: its screens are destroyed, its container is gone, and the name is
     * free for `defineLayer` again. Distinct from `layer:idle`, which is an *empty* layer that
     * still exists — anything caching a layer name or a `getLayer` container has to drop it here.
     */
    | { readonly type: 'layer:removed'; readonly layer: string }
    | { readonly type: 'scene:idle' };

/** Options accepted by {@link SceneManager} (also surfaced via `ApplicationOptions.scene`). */
export interface SceneOptions {
    /** Transition strategy applied to every push/pop unless overridden at the call site. */
    defaultTransition?: ScreenTransition;
    /** Additional layers to register on top of the defaults. */
    layers?: LayerConfig[];
    loadBundle?: (bundles: string[], progress?: (fraction: number) => void) => Promise<unknown>;
    resolveOutput?: (id: string) => Container | undefined;
}

/** Options accepted by {@link SceneManager.clear}. */
export interface ClearOptions {
    /**
     * Also destroy children that were added to the layer container directly (`getLayer(name)
     * .addChild(…)`) rather than pushed as screens — the popups and toasts a `free`-mode layer
     * exists for.
     *
     * Off by default, and opt-in rather than automatic because those children have an **owner**
     * that this manager knows nothing about: it never created them, never registered a ticker
     * callback for them, and cannot tell whether the caller still holds a reference it means to
     * re-add. Destroying one out from under that owner is a decision, so it is spelled out at the
     * call site. Each child gets its `reset?.()` before `destroy({ children: true })`, matching
     * what a pop does to a managed screen.
     *
     * {@link SceneManager.removeLayer} does not take this option — it always releases them,
     * because the container they live in is destroyed either way.
     */
    unmanaged?: boolean;
}
