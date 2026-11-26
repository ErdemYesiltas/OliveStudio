import '@pixi/layout';
import { ExtensionType, type Application, type ApplicationOptions } from 'pixi.js';
import { SceneManager } from './SceneManager.js';
import type { SceneOptions } from './types.js';

declare module 'pixi.js' {
    interface Application { scene?: SceneManager }
    interface ApplicationOptions { oliveScenes?: SceneOptions }
}

export class ScenePlugin {
    static extension = { type: ExtensionType.Application, name: 'scenes', priority: -900 } as const;

    static init(this: Application, options: Partial<ApplicationOptions>) {
        if (!options.oliveScenes) return;
        this.scene = new SceneManager(this, options.oliveScenes);
        this.scene._installVisibilityListeners();
    }

    static destroy(this: Application) {
        this.scene?.destroy();
        delete this.scene;
    }
}
