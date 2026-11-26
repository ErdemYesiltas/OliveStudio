import { Application, Container, Rectangle, Ticker } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { CameraService } from '../camera/CameraService.js';
import { SceneManager } from './SceneManager.js';
import { FadeTransition } from './transitions/FadeTransition.js';

describe('Aperion camera and scenes', () => {
  it('pauses covered screens, resumes the same instance and advances transitions and cameras on the app ticker', async () => {
    const app = new Application();
    Object.defineProperty(app, 'screen', { value: new Rectangle(0, 0, 960, 540) });
    app.ticker = new Ticker();
    app.ticker.minFPS = 0;
    app.ticker.lastTime = 0;
    app.cameras = new CameraService(app);
    const scenes = new SceneManager(app);

    class Gameplay extends Container {
      paused = false;
      async pause() { this.paused = true; }
      async resume() { this.paused = false; }
    }
    class Menu extends Container {}

    try {
      const first = await scenes.push('main', Gameplay);
      let enterStarted!: () => void;
      const entering = new Promise<void>(resolve => { enterStarted = resolve; });
      class ObservedFade extends FadeTransition {
        override enter(screen: Menu) {
          const done = super.enter(screen);
          enterStarted();
          return done;
        }
      }
      const pushing = scenes.push('main', Menu, undefined, new ObservedFade(100));
      await entering;
      const child = scenes.top('main')!;
      expect(first.paused).toBe(true);
      expect(child.alpha).toBe(0);

      const camera = scenes.camera('main');
      expect(app.cameras.get('scene:main')).toBe(camera);
      const moving = camera.panTo({ x: 100, y: 0 }, { ms: 100, ease: 'none' });
      app.ticker.update(50);
      expect(child.alpha).toBeGreaterThan(0);
      expect(child.alpha).toBeLessThan(1);
      expect(scenes.getLayer('main').pivot.x).toBeCloseTo(50);
      app.ticker.update(100);
      expect(await moving).toBe('completed');
      expect(await pushing).toBe(child);
      expect(child.alpha).toBe(1);

      const popping = scenes.pop('main');
      await Promise.resolve();
      app.ticker.update(200);
      await popping;
      expect(scenes.top('main')).toBe(first);
      expect(first.paused).toBe(false);
    } finally {
      scenes.destroy();
      app.cameras.destroy();
      app.ticker.destroy();
      app.stage.destroy({ children: true });
    }
  });
});
