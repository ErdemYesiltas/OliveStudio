import { Container } from 'pixi.js';
import type { AppScreen, LayerActivationPolicy, LayerConfig, LayerMode } from './types.js';

type ChildListener = (child: Container) => void;

/**
 * Owns one z-ordered slice of the scene graph. Stack-mode layers maintain a
 * push/pop history; slot-mode layers hold a single occupant; free-mode layers
 * surface their `container` for external `addChild` (popups, toasts).
 *
 * The layer observes its own container's `childAdded` / `childRemoved` events
 * so the scene manager can apply pause cascade rules uniformly across all
 * three modes, including direct `addChild` usage in free mode.
 */
export class Layer {
    /** PixiJS container parented under the scene root. All occupants live as children of this node. */
    public readonly container: Container;
    /** Push/pop stack for `stack`-mode layers, or single-element slot for `slot`-mode. Empty in `free` mode. */
    public readonly stack: AppScreen[] = [];

    /**
     * The output canvas this layer currently renders to (`undefined` = main canvas).
     * Seeded from `config.output`; mutated by {@link SceneManager.setLayerOutput}.
     */
    public output?: string;

    private _opQueue: Promise<unknown> = Promise.resolve();
    private _onChildAdded: ChildListener | null = null;
    private _onChildRemoved: ChildListener | null = null;

    /**
     * @param config - Layer configuration: name, z-order, stack mode, modal flag, and activation policy.
     */
    constructor(public readonly config: LayerConfig) {
        this.container = new Container();
        this.container.label = `layer:${config.name}`;
        this.container.zIndex = config.zIndex;
        this.container.sortableChildren = true;
        this.output = config.output;
    }

    /** Layer identifier. Matches {@link LayerConfig.name}. */
    public get name(): string {
        return this.config.name;
    }

    /** Stack semantics for this layer. */
    public get mode(): LayerMode {
        return this.config.mode;
    }

    /** Whether this layer blocks interactivity on lower layers while it has content. */
    public get modal(): boolean {
        return this.config.modal ?? false;
    }

    /** Activation policy applied to lower layers when this one becomes active. Defaults to `'none'`. */
    public get onUpperActive(): LayerActivationPolicy {
        return this.config.onUpperActive ?? 'none';
    }

    /** True when the layer has any visible content (stack non-empty or container has children). */
    public get hasContent(): boolean {
        if (this.mode === 'stack' || this.mode === 'slot') return this.stack.length > 0;
        return this.container.children.length > 0;
    }

    /** Top of the stack — the currently visible screen for `stack`/`slot` layers. */
    public top(): AppScreen | undefined {
        return this.stack[this.stack.length - 1];
    }

    /** Number of screens on the stack. Always `0` for `free`-mode layers. */
    public depth(): number {
        return this.stack.length;
    }

    /**
     * Serialize layer operations so parallel push/pop calls do not interleave.
     *
     * @param op - Async operation to run after every previously queued op resolves.
     * @returns Promise that resolves to `op`'s return value once it completes.
     */
    public enqueue<T>(op: () => Promise<T>): Promise<T> {
        const run = this._opQueue.then(op, op);
        this._opQueue = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    /**
     * Install a single pair of `childAdded` / `childRemoved` listeners. Used by
     * {@link SceneManager} to drive the activation cascade based on the
     * layer's emptiness.
     */
    public observeChildren(onChange: () => void): void {
        this._onChildAdded = () => onChange();
        this._onChildRemoved = () => onChange();
        this.container.on('childAdded', this._onChildAdded);
        this.container.on('childRemoved', this._onChildRemoved);
    }

    /**
     * Detach child listeners, clear the stack, and destroy the underlying
     * {@link Container} (children included).
     */
    public destroy(): void {
        if (this._onChildAdded) this.container.off('childAdded', this._onChildAdded);
        if (this._onChildRemoved) this.container.off('childRemoved', this._onChildRemoved);
        this._onChildAdded = null;
        this._onChildRemoved = null;
        this.stack.length = 0;
        this.container.destroy({ children: true });
    }
}
