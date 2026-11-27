import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatedSprite, Application, Container } from 'pixi.js';
import { Pause, Play, Plus, Square, Volume2, VolumeX } from 'lucide-react';
import type { Event as SpineEvent } from '@esotericsoftware/spine-core';
import { loadAnimation, type AnimationSource } from './animationAssets';
import { spineEmbeddedAudioUrl, type Asset } from './assets';
import { DirectorAudio } from './directorAudio';
import { hint, IconButton, PreviewMode } from './chrome';
import { t } from './i18n';
import { applySpineSkins } from '@olivestudio/engine/spine';
import { SpineSkinLayers } from './SpineSkinLayers';

const physicsPreviewStep = 1 / 60;
const physicsPreviewWarmup = 15;

type PreviewPlayer = {
  animations: string[]; skins: string[];
  selectAnimation: (name: string) => void; selectSkin: (name: string, layers: string[]) => void;
  play: () => void; pause: () => void; stop: () => void; loop: (value: boolean) => void;
  seek?: (seconds: number) => void; duration?: () => number;
  mute?: (muted: boolean) => void;
  dispose: () => void;
};

async function createPreview(asset: Pick<Asset, 'path' | 'url' | 'media'>, completed: () => void, cancelled: () => boolean,
  scrubbed?: (time: number) => void, setupPose = false) {
  const app = new Application();
  const group = new Container();
  let source: AnimationSource | undefined;
  let audio: DirectorAudio | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    audio?.stopCues();
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
    let selectSkin: PreviewPlayer['selectSkin'] = () => {};
    let setLoop: (value: boolean) => void;
    let startAnimation: () => void;
    let seek: PreviewPlayer['seek'];
    let duration: PreviewPlayer['duration'];
    let mute: PreviewPlayer['mute'];
    let pose: (() => void) | undefined;
    if (source.kind === 'spine') {
      const data = source.skeleton;
      const spine = source.createSpine();
      group.addChild(spine);
      animations = data.animations.map(animation => animation.name);
      skins = data.skins.map(skin => skin.name);
      let current = animations[0];
      const sounds = new Map<string, string>();
      for (const event of data.events) {
        if (!event.audioPath || sounds.has(event.audioPath)) continue;
        const url = spineEmbeddedAudioUrl(asset.media, event.audioPath);
        if (url) sounds.set(event.audioPath, url);
      }
      let muted = false;
      let phase: 'idle' | 'setup' | 'playing' = 'idle';
      let opening: SpineEvent[] = [];
      const playSound = (event: SpineEvent) => {
        const path = event.data.audioPath;
        if (audio && !muted && path && sounds.has(path)) audio.playCue(path, event.volume, event.balance);
      };
      if (sounds.size) {
        audio = new DirectorAudio(path => sounds.get(path), () => ({ volume: 1, muted: false }));
        mute = value => {
          muted = value;
          if (muted) audio?.stopCues();
        };
      }
      const resetPose = () => {
        spine.skeleton.setToSetupPose();
        spine.skeleton.time = 0;
        for (const constraint of spine.skeleton.physicsConstraints) constraint.reset();
      };
      reset = () => {
        opening = [];
        spine.state.clearTracks();
        resetPose();
        if (current) spine.state.setAnimation(0, current, loop);
        phase = 'setup';
        try { spine.update(0); } finally { phase = 'idle'; }
      };
      selectAnimation = name => { current = name; reset(); fit(); };
      selectSkin = (name, layers) => {
        applySpineSkins(spine.skeleton, name || null, layers);
        spine.update(0);
        fit();
      };
      setLoop = value => {
        const track = spine.state.getCurrent(0);
        if (track) track.loop = value;
      };
      pose = () => {
        opening = [];
        spine.state.clearTracks();
        resetPose();
        spine.update(0);
      };
      startAnimation = () => { if (!spine.state.getCurrent(0)) reset(); };
      duration = () => spine.state.getCurrent(0)?.animationEnd ?? (current ? data.findAnimation(current)?.duration ?? 0 : 0);
      seek = seconds => {
        app.stop();
        audio?.stopCues();
        ended = false;
        reset();
        if (seconds > 0) opening = [];
        const track = spine.state.getCurrent(0);
        if (!track) return;
        // Reset before seeking so attachment and constraint changes are deterministic when scrubbing backwards.
        const previousLoop = track.loop;
        track.loop = false;
        try {
          const target = Math.max(0, Math.min(seconds, track.animationEnd));
          const simulate = spine.skeleton.physicsConstraints.some(constraint => constraint.isActive());
          // Bound the work on unusually long clips while giving physics time to settle before the requested frame.
          const origin = simulate ? Math.max(0, target - physicsPreviewWarmup) : target;
          if (origin > 0) {
            track.trackTime = origin;
            if (simulate) resetPose();
            spine.update(0);
          }
          const count = Math.floor((target - origin) / physicsPreviewStep);
          for (let index = 0; index < count; index++) spine.update(physicsPreviewStep);
          const remaining = target - origin - count * physicsPreviewStep;
          if (remaining > 0) spine.update(remaining);
        } finally { track.loop = previousLoop; }
        render();
      };
      spine.state.addListener({
        event: (track, event) => {
          if (track !== spine.state.getCurrent(0) || !event.data.audioPath) return;
          if (phase === 'setup') opening.push(event);
          if (phase === 'playing') playSound(event);
        },
        complete: () => { if (phase === 'playing') finish(); },
      });
      app.ticker.add(ticker => {
        for (const event of opening) playSound(event);
        opening = [];
        phase = 'playing';
        try { spine.update(ticker.deltaMS / 1000); } finally { phase = 'idle'; }
        const track = spine.state.getCurrent(0);
        if (track && scrubbed) scrubbed(track.getAnimationTime());
      });
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
    const restore = setupPose && pose ? pose : reset;
    restore();
    fit();
    app.canvas.setAttribute('aria-label', t('assetAnimationPreview'));
    const player: PreviewPlayer = {
      animations, skins,
      selectAnimation: name => { app.stop(); audio?.stopCues(); ended = false; selectAnimation(name); },
      selectSkin,
      play: () => {
        if (!animations.length) return;
        if (ended) { audio?.stopCues(); reset(); ended = false; }
        audio?.pause(false);
        startAnimation();
        app.start();
      },
      pause: () => { app.stop(); audio?.pause(true); },
      stop: () => { app.stop(); audio?.stopCues(); ended = false; restore(); fit(); },
      loop: value => { loop = value; setLoop(value); },
      seek, duration, mute, dispose,
    };
    return { player, canvas: app.canvas };
  } catch (error) {
    dispose();
    throw error;
  }
}

export type AnimationPreviewSelection = { animation: string | null; skin: string | null; skinLayers: string[]; loop: boolean };

export function AnimatedAssetPreview({ asset, scrub = false, preferredAnimation, preferredSkin, preferredTime, setupPose = false,
  onAddToScene, addDisabled }: {
  asset: Asset; scrub?: boolean; preferredAnimation?: string; preferredSkin?: string; preferredTime?: number; setupPose?: boolean;
  onAddToScene?: (selection?: AnimationPreviewSelection) => void; addDisabled?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<PreviewPlayer>(null);
  const requestedTime = useRef(preferredTime);
  const [choices, setChoices] = useState<{ animations: string[]; skins: string[] }>();
  const [animation, setAnimation] = useState('');
  const [skin, setSkin] = useState('');
  const [skinLayers, setSkinLayers] = useState<string[]>([]);
  const selectedLayers = useRef<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const loopEnabled = useRef(true);
  const [error, setError] = useState<string>();
  const [time, setTime] = useState(0);
  const [sound, setSound] = useState(true);
  const soundEnabled = useRef(true);
  const { media, path, url } = asset;
  const mode = useContext(PreviewMode);

  useLayoutEffect(() => { requestedTime.current = preferredTime; }, [preferredTime]);
  useLayoutEffect(() => {
    player.current?.stop();
    setPlaying(false);
  }, [mode]);

  useEffect(() => {
    if (!media) return;
    setPlaying(false);
    setTime(0);
    setError(undefined);
    setChoices(undefined);
    let cancelled = false;
    void createPreview({ media, path, url }, () => { if (!cancelled) setPlaying(false); }, () => cancelled,
      scrub ? value => setTime(Math.round(value * 100) / 100) : undefined, setupPose).then(result => {
      if (!result) return;
      if (cancelled) { result.player.dispose(); return; }
      player.current = result.player;
      result.player.mute?.(!soundEnabled.current);
      result.player.loop(loopEnabled.current);
      container.current?.replaceChildren(result.canvas);
      const { animations, skins } = result.player;
      setChoices({ animations, skins });
      const initialAnimation = preferredAnimation && animations.includes(preferredAnimation) ? preferredAnimation : animations[0];
      if (initialAnimation && initialAnimation !== animations[0]) result.player.selectAnimation(initialAnimation);
      setAnimation(initialAnimation ?? '');
      const initialSkin = preferredSkin && skins.includes(preferredSkin) ? preferredSkin : skins.includes('default') ? 'default' : skins[0];
      const layers = selectedLayers.current.filter(name => name !== initialSkin && skins.includes(name));
      selectedLayers.current = layers;
      setSkinLayers(layers);
      if (initialSkin) result.player.selectSkin(initialSkin, layers);
      setSkin(initialSkin ?? '');
      const requested = requestedTime.current;
      if (requested !== undefined && result.player.seek) {
        const next = Math.min(requested, result.player.duration?.() ?? requested);
        result.player.seek(next);
        setTime(next);
      }
    }).catch(failure => {
      if (!cancelled) setError(t('assetAnimationError', { detail: failure instanceof Error ? failure.message : String(failure) }));
    });
    return () => {
      cancelled = true;
      player.current?.dispose();
      player.current = null;
    };
  }, [media, path, url, scrub, preferredAnimation, preferredSkin, setupPose]);

  useEffect(() => {
    if (preferredTime === undefined) return;
    const frame = requestAnimationFrame(() => {
      const active = player.current;
      if (!active?.seek) return;
      const next = Math.min(preferredTime, active.duration?.() ?? preferredTime);
      active.seek(next);
      setPlaying(false);
      setTime(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [preferredTime]);

  function chooseSkins(name: string, layers: string[]) {
    selectedLayers.current = layers;
    player.current?.selectSkin(name, layers);
    setSkin(name);
    setSkinLayers(layers);
  }

  return <div className="asset-animation-controls">
    <div className="asset-animation-canvas" ref={container} />
    {!choices && !error && <small role="status">{t('previewLoading')}</small>}
    {error && <p className="error" role="alert">{error}</p>}
    {!!choices?.skins.length && <label>{t('assetSkin')}
      <select value={skin} onChange={event => {
        const name = event.target.value;
        chooseSkins(name, skinLayers.filter(layer => layer !== name));
      }}><option value="" disabled>{t('assetSkin')}</option>
        {choices.skins.map(name => <option key={name}>{name}</option>)}
      </select>
    </label>}
    {(choices?.skins.length ?? 0) > 1 && <details>
      <summary {...hint(t('spineSkinLayers'), t('spineSkinLayersHint'))}>{t('spineSkinLayers')}</summary>
      <SpineSkinLayers skins={choices!.skins} base={skin} layers={skinLayers} change={layers => chooseSkins(skin, layers)} />
    </details>}
    {!!choices?.animations.length && <>
      <label>{t('assetAnimation')}<select value={animation} onChange={event => {
        player.current?.selectAnimation(event.target.value);
        setAnimation(event.target.value);
        setPlaying(false);
        setTime(0);
      }}>{choices.animations.map(name => <option key={name}>{name}</option>)}</select></label>
      {scrub && !!player.current?.duration?.() && <label>{t('spinePreviewTime')}
        <input type="range" min={0} max={player.current.duration()} step={preferredTime === undefined ? 0.01 : 'any'} value={time}
          onChange={event => {
            const value = event.currentTarget.valueAsNumber;
            player.current?.seek?.(value);
            setPlaying(false);
            setTime(value);
          }} />
        <output>{time.toFixed(2)} s</output>
      </label>}
      <div className="asset-animation-buttons">
        <button className="bundle-command" type="button" onClick={() => {
          if (playing) player.current?.pause();
          else player.current?.play();
          setPlaying(!playing);
        }}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          {t(playing ? 'pauseAnimation' : 'playAnimation')}</button>
        <button className="bundle-command" type="button" onClick={() => { player.current?.stop(); setPlaying(false); setTime(0); }}>
          <Square size={15} aria-hidden="true" />{t('stopAnimation')}</button>
        <label className="asset-loop-option"><input type="checkbox" checked={loop} onChange={event => {
          const enabled = event.target.checked;
          loopEnabled.current = enabled;
          player.current?.loop(enabled);
          setLoop(enabled);
        }} />{t('loopAnimation')}</label>
        {player.current?.mute && <IconButton icon={sound ? Volume2 : VolumeX} label={t('spinePreviewSound')}
          description={t('spinePreviewSoundHint')} aria-pressed={sound} onClick={() => {
            const next = !soundEnabled.current;
            soundEnabled.current = next;
            player.current?.mute?.(!next);
            setSound(next);
          }} />}
      </div>
    </>}
    {onAddToScene && <IconButton icon={Plus} label={t('addAssetToScene')} description={t('addAssetToSceneHint')}
      disabled={addDisabled || !choices} onClick={() => onAddToScene(media?.kind === 'spine' ? {
        animation: animation || null, skin: skin || null, skinLayers, loop,
      } : undefined)} />}
  </div>;
}
