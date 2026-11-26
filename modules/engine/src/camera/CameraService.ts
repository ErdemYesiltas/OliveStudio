import type { Application } from 'pixi.js';
import { Camera as CameraCtor } from './Camera.js';
import type { CameraOptions } from './types.js';

type Camera = CameraCtor;
type Container = ConstructorParameters<typeof CameraCtor>[0];

/**
 * Named registry of {@link Camera} instances, installed as `app.cameras`
 * by {@link CameraPlugin}.
 *
 * A {@link Camera} created with a `name` (and `app`) auto-registers here and
 * removes itself on `dispose`. {@link CameraStrategy} resolves the camera a
 * step targets from this registry, so director compositions reference cameras
 * by name without any manual wiring.
 *
 * @example
 * new Camera(worldLayer, { app, name: 'main', viewport: () => app.screen });
 * app.cameras.get('main');   // by name
 * app.cameras.get();         // the sole camera when only one is registered
 */
export class CameraService {
    private readonly _map = new Map<string, Camera>();

    /** The app a created camera registers into and takes its default viewport from. */
    constructor(private readonly _app: Application) {}

    /**
     * Create a camera on `target` and register it, or return the one already under `name`.
     *
     * **The factory this registry was missing.** It had `register` and `get` and no way to make
     * one, so anything that could not `import { Camera }` — a tool shipping as its own bundle, a
     * host driving the app from outside — had to be handed the class itself. That is a strange
     * thing for a registry to require, and the workaround was worse: devtools reached the
     * constructor off a global.
     *
     * **Idempotent by name**, which is what makes it safe to call from anywhere. A caller that
     * wants *the* camera for something asks for it by name and gets the same one every time,
     * whoever asked first; there is no create-or-get dance and no way to end up with two cameras
     * quietly fighting over one container's transform.
     *
     * `viewport` defaults to the app's screen, because `focus` and `follow` silently degrade
     * without one and every caller so far wanted exactly that.
     *
     * The target must be a container nothing else positions — a scene layer, a world container, the
     * stage. A camera owns its target's `position`/`pivot`/`scale`/`rotation` outright; see the
     * note on {@link Camera}.
     */
    create(name: string, target: Container, options: Omit<CameraOptions, 'app' | 'name'> = {}): Camera {
        const existing = this._map.get(name);
        if (existing) return existing;
        return new CameraCtor(target, {
            viewport: () => this._app.screen,
            ...options,
            app: this._app,
            name,
        });
    }

    /** Register a camera under `name`. */
    register(name: string, camera: Camera): void {
        if (this._map.has(name)) {
            console.warn(`[CameraService] Camera "${name}" already registered — overwriting.`);
        }
        this._map.set(name, camera);
    }

    /** Remove a camera by `name`. */
    unregister(name: string): void {
        this._map.delete(name);
    }

    /** Resolve a camera by `name`; with `name` omitted, the sole camera when exactly one is registered. */
    get(name?: string): Camera | undefined {
        if (name !== undefined) return this._map.get(name);
        return this._map.size === 1 ? this._map.values().next().value : undefined;
    }

    /** Whether a camera is registered under `name`. */
    has(name: string): boolean {
        return this._map.has(name);
    }

    /** Registered camera names. */
    get names(): string[] {
        return [...this._map.keys()];
    }

    /** Dispose all registered cameras and clear the registry. */
    destroy(): void {
        for (const camera of [...this._map.values()]) camera.dispose();
        this._map.clear();
    }
}
