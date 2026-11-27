import { Application, Assets, Texture } from 'pixi.js';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PreviewMode } from './chrome';
import { t } from './i18n';
import { SceneParticles } from './sceneParticles';
import type { ParticleObject } from './scene';

const width = 256;
const height = 160;

export function ParticlePreview({ node, texture }: { node: ParticleObject; texture?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState(false);
  const runtime = useRef<{ app: Application; emitter: SceneParticles } | undefined>(undefined);
  const time = useRef(0);
  const play = useRef(false);
  play.current = running;
  const mode = useContext(PreviewMode);
  useLayoutEffect(() => {
    play.current = false;
    setRunning(false);
  }, [mode]);
  function seek(value: number) {
    const current = runtime.current;
    if (!current) return;
    current.emitter.restart(node.id);
    let remaining = value;
    while (remaining > 1e-8) {
      const step = Math.min(remaining, 1 / 60);
      current.emitter.update(step, () => true);
      remaining -= step;
    }
    time.current = value;
    setPosition(value);
    current.app.render();
  }
  useEffect(() => {
    const app = new Application();
    const emitter = new SceneParticles();
    let disposed = false;
    let initialized = false;
    let frame = 0;
    setError(false);
    void (async () => {
      await app.init({ width, height, autoStart: false, backgroundAlpha: 0, preference: 'webgl' });
      initialized = true;
      if (disposed) { app.destroy({ removeView: true }); return; }
      const particleTexture = texture ? await Assets.load<Texture>(texture).catch(() => Texture.WHITE) : Texture.WHITE;
      if (disposed || !host.current) return;
      const display = emitter.project({ ...node, playing: true }, particleTexture);
      display.position.set(width / 2, height / 2);
      app.stage.addChild(display);
      app.canvas.setAttribute('aria-label', t('particlePreview'));
      host.current.appendChild(app.canvas);
      let last = performance.now();
      const loop = (now: number) => {
        const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
        last = now;
        if (play.current) {
          time.current += dt;
          if (time.current >= node.lifetime * 2) { time.current = 0; emitter.restart(node.id); }
          emitter.update(dt, () => true);
          app.render();
          if (Math.floor(time.current * 10) !== Math.floor((time.current - dt) * 10)) setPosition(time.current);
        }
        frame = requestAnimationFrame(loop);
      };
      runtime.current = { app, emitter };
      seek(0);
      frame = requestAnimationFrame(loop);
    })().catch(() => { if (!disposed) setError(true); });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      runtime.current = undefined;
      emitter.destroy();
      if (initialized) app.destroy({ removeView: true }, { children: true });
    };
  }, [node, texture]);
  return <section className="emitter-preview" aria-label={t('particlePreview')}>
    <div className="emitter-preview-frame" ref={host} />
    {error && <p className="error">{t('previewUnavailable')}</p>}
    <div className="inline-row">
      <button type="button" aria-pressed={running} onClick={() => setRunning(!running)}>{t(running ? 'particlePausePreview' : 'particlePlayPreview')}</button>
      <button type="button" onClick={() => seek(0)}>{t('particleRestartPreview')}</button>
      <input aria-label={t('particleSeekPreview')} type="range" min={0} max={node.lifetime * 2} step={0.02} value={position}
        onChange={event => { setRunning(false); seek(event.currentTarget.valueAsNumber); }} />
    </div>
  </section>;
}
