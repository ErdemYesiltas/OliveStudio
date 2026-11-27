import { type Application, type ApplicationOptions, ExtensionType } from 'pixi.js';
import { DirectorService } from './DirectorService.js';
import type { DirectorOptions } from './DirectorService.js';

export type { DirectorOptions } from './DirectorService.js';

/**
 * Application plugin that installs {@link DirectorService} as `app.director`.
 *
 * Register via `extensions.add(DirectorPlugin)`, then configure with
 * `ApplicationOptions.director`.
 */
export class DirectorPlugin {
    static extension = {
        type: ExtensionType.Application,
        name: 'director',
        priority: 150,
    } as const;

    static init(this: Application, options: Partial<ApplicationOptions>) {
        const service = new DirectorService(this, (options as { director?: DirectorOptions }).director);
        (this as unknown as { director: DirectorService }).director = service;
    }

    static destroy(this: Application) {
        const service = (this as unknown as { director: DirectorService | null }).director;
        service?.destroy();
        (this as unknown as { director: DirectorService | null }).director = null;
    }
}
