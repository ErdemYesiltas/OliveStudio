import { ExtensionType } from 'pixi.js';
import type { Application } from 'pixi.js';
import { CameraService } from './CameraService.js';

declare module 'pixi.js' {
    interface Application { cameras?: CameraService }
}

/**
 * Application plugin that installs {@link CameraService} as `app.cameras`.
 *
 * Register via `extensions.add(CameraPlugin)`.
 */
export class CameraPlugin {
    static extension = { type: ExtensionType.Application, name: 'cameras', priority: 50 } as const;

    static init(this: Application): void {
        // The app, so `create` can register into `app.cameras` and default a camera's viewport
        // to the screen without every caller passing both.
        const service = new CameraService(this);
        this.cameras = service;
    }

    static destroy(this: Application): void {
        const service = (this as { cameras?: CameraService }).cameras;
        service?.destroy();
        delete this.cameras;
    }
}
