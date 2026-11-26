import { useEffect, useRef, useState } from 'react';
import { AnimatedSprite, Application, Container } from 'pixi.js';
import { Pause, Play, Square } from 'lucide-react';
import { loadAnimation, type AnimationSource } from './animationAssets';
import type { Asset } from './assets';
import { t } from './i18n';

type PreviewPlayer = {
  animations: string[]; skins: string[];
  selectAnimation: (name: string) => void; selectSkin: (name: string) => void;
  play: () => void; pause: () => void; stop: () => void; loop: (value: boolean) => void;
  dispose: () => void;
};

async function createPreview(asset: Pick<Asset, 'url' | 'media'>, completed: () => void, cancelled: () => boolean) {
  const app = new Application();
  const group = new Container();
  let source: AnimationSource | undefined;
  const dispose = () => {
    if (!group.parent) group.destroy({ children: true });
    if (app.renderer) app.destroy({ removeView: true }, { children: true });
    else app.stage.destroy({ children: true });
    source?.dispose();
  };
  let loop = true;
  let ended = false;
  const render = () => app.render();
  function fit() {
    const bounds = group.getLocalBounds();
    const { width, height } = app.screen;
    if (bounds.width > 0 && bounds.height > 0) {
      const scale = Math.min((width - 28) / bounds.width, (height - 28) / bounds.height, 8);
      group.scale.set(scale);
      group.position.set(width / 2 - (bounds.x + bounds.width / 2) * scale,
        height / 2 - (bounds.y + bounds.height / 2) * scale);
    }
    render();
  }
  const finish = () => {
    if (!loop) {
      ended = true;
      app.stop();
      completed();
    }
  };

  try {
    source = await loadAnimation(asset);
    if (cancelled()) { dispose(); return null; }
    await app.init({ width: 320, height: 240, backgroundAlpha: 0, autoStart: false, antialias: true, preference: 'webgl' });
    app.stage.addChild(group);
    let animations: string[];
    let skins: string[] = [];
    let reset: () => void;
    let selectAnimation: (name: string) => void;
    let selectSkin = (_name: string) => {};
    let setLoop: (value: boolean) => void;
    let startAnimation: () => void;
    if (source.kind === 'spine') {
      const data = source.skeleton;
      const spine = source.createSpine();
      group.addChild(spine);
      animations = data.animations.map(animation => animation.name);
      skins = data.skins.map(skin => skin.name);
      let current = animations[0];
      reset = () => {
        spine.state.clearTracks();
        spine.skeleton.setToSetupPose();
        if (current) spine.state.setAnimation(0, current, loop);
        spine.update(0);
      };
      selectAnimation = name => { current = name; reset(); fit(); };
      selectSkin = name => {
        spine.skeleton.setSkinByName(name);
        spine.skeleton.setSlotsToSetupPose();
        spine.update(0);
        fit();
      };
      setLoop = value => {
        const track = spine.state.getCurrent(0);
        if (track) track.loop = value;
      };
      startAnimation = () => {};
      spine.state.addListener({ complete: finish });
      app.ticker.add(ticker => spine.update(ticker.deltaMS / 1000));
    } else {
      const { clips: groups, frames: allFrames } = source;
      if (!groups.size) groups.set(t('allSheetFrames'), allFrames);
      animations = [...groups.keys()];
      const frames = groups.get(animations[0]) ?? allFrames;
      const sprite = new AnimatedSprite({ textures: frames, autoUpdate: false, animationSpeed: 10 / 60 });
      group.addChild(sprite);
      sprite.onComplete = finish;
      reset = () => sprite.gotoAndStop(0);
      selectAnimation = name => {
        const selected = groups.get(name);
        if (selected?.length) { sprite.textures = selected; reset(); fit(); }
      };
      setLoop = value => { sprite.loop = value; };
      startAnimation = () => sprite.play();
      app.ticker.add(ticker => sprite.update(ticker));
    }
    if (cancelled()) { dispose(); return null; }
    reset();
    fit();
    app.canvas.setAttribute('aria-label', t('assetAnimationPreview'));
    const player: PreviewPlayer = {
      animations, skins,
      selectAnimation: name => { app.stop(); ended = false; selectAnimation(name); },
      selectSkin,
      play: () => {
        if (!animations.length) return;
        if (ended) { reset(); ended = false; }
        startAnimation();
        app.start();
      },
      pause: () => { app.stop(); },
      stop: () => { app.stop(); ended = false; reset(); fit(); },
      loop: value => { loop = value; setLoop(value); },
      dispose,
    };
    return { player, canvas: app.canvas };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function AnimatedAssetPreview({ asset }: { asset: Asset }) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<PreviewPlayer>(null);
  const [choices, setChoices] = useState<{ animations: string[]; skins: string[] }>();
  const [animation, setAnimation] = useState('');
  const [skin, setSkin] = useState('');
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [error, setError] = useState<string>();
  const { media, url } = asset;

  useEffect(() => {
    if (!media) return;
    let cancelled = false;
    void createPreview({ media, url }, () => { if (!cancelled) setPlaying(false); }, () => cancelled).then(result => {
      if (!result) return;
      if (cancelled) { result.player.dispose(); return; }
      player.current = result.player;
      container.current?.replaceChildren(result.canvas);
      const { animations, skins } = result.player;
      setChoices({ animations, skins });
      setAnimation(animations[0] ?? '');
      const initialSkin = skins.includes('default') ? 'default' : skins[0];
      if (initialSkin) result.player.selectSkin(initialSkin);
      setSkin(initialSkin ?? '');
    }).catch(failure => {
      if (!cancelled) setError(t('assetAnimationError', { detail: failure instanceof Error ? failure.message : String(failure) }));
    });
    return () => {
      cancelled = true;
      player.current?.dispose();
      player.current = null;
    };
  }, [media, url]);

  return <div className="asset-animation-controls">
    <div className="asset-animation-canvas" ref={container} />
    {!choices && !error && <small role="status">{t('previewLoading')}</small>}
    {error && <p className="error" role="alert">{error}</p>}
    {!!choices?.skins.length && <label>{t('assetSkin')}
      <select value={skin} onChange={event => {
        player.current?.selectSkin(event.target.value);
        setSkin(event.target.value);
      }}><option value="" disabled>{t('assetSkin')}</option>
        {choices.skins.map(name => <option key={name}>{name}</option>)}
      </select>
    </label>}
    {!!choices?.animations.length && <>
      <label>{t('assetAnimation')}<select value={animation} onChange={event => {
        player.current?.selectAnimation(event.target.value);
        setAnimation(event.target.value);
        setPlaying(false);
      }}>{choices.animations.map(name => <option key={name}>{name}</option>)}</select></label>
      <div className="asset-animation-buttons">
        <button className="bundle-command" type="button" onClick={() => {
          if (playing) player.current?.pause();
          else player.current?.play();
          setPlaying(!playing);
        }}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          {t(playing ? 'pauseAnimation' : 'playAnimation')}</button>
        <button className="bundle-command" type="button" onClick={() => { player.current?.stop(); setPlaying(false); }}>
          <Square size={15} aria-hidden="true" />{t('stopAnimation')}</button>
        <label className="asset-loop-option"><input type="checkbox" checked={loop} onChange={event => {
          player.current?.loop(event.target.checked);
          setLoop(event.target.checked);
        }} />{t('loopAnimation')}</label>
      </div>
    </>}
  </div>;
}
