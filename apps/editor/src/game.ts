import { Howler } from 'howler';
import { storageStore } from '@rewrite/achievements';
import { matchLanguage } from '@rewrite/interactions';
import { defaultPhysicsSettings } from '@rewrite/physics/contracts';
import { scriptConsole } from '@rewrite/scripts/console';
import { projectBundle, readManifest } from './assets';
import { gameSlots, readGameSlot, writeGameSlot, type GameSlot } from './globals';
import { t } from './i18n';
import { networkPlan } from './networkModel';
import { playCinematic } from './playCinematic';
import { cameraInScene, followProjectSceneLink, parseProject, popScene, readScene, sceneRecord, type SceneLink, type ScenePlayback } from './project';
import { SceneView } from './runtime';
import { configRegistry, configSchema, validationMessage } from './scene';
import type { PreviewProfile } from './Settings';
import './game.css';

const host = document.querySelector<HTMLElement>('#game')!;
const launch = document.querySelector<HTMLElement>('#launch')!;
const status = document.querySelector<HTMLElement>('#status')!;
const start = document.querySelector<HTMLButtonElement>('#start')!;
const report = (error: unknown) => {
  status.textContent = t('gameLaunchFailed', { error: validationMessage(error) });
  launch.hidden = false;
  start.hidden = true;
};

async function json(url: URL) {
  const response = await fetch(url);
  if (!response.ok && response.status !== 0) throw new Error(`${url.pathname} (${response.status})`);
  return response.json();
}

async function optionalConfig() {
  const response = await fetch(new URL('./config.json', location.href));
  if (response.status === 404) return undefined;
  if (!response.ok && response.status !== 0) throw new Error(`config.json (${response.status})`);
  return configSchema.parse(await response.json());
}

function displayProfile(width: number, height: number): PreviewProfile {
  const narrow = matchMedia('(pointer: coarse)').matches || width <= 760;
  return { device: narrow ? (Math.min(width, height) < 600 ? 'mobile' : 'tablet') : 'desktop',
    orientation: width >= height ? 'landscape' : 'portrait' };
}

async function prepare() {
  document.title = document.querySelector('meta[name="game-title"]')?.getAttribute('content') ?? document.title;
  status.textContent = t('gameLoading');
  const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;
  const assetRoot = meta('olive-asset-root') ?? new URL('./assetpack/', location.href).href;
  const peerProject = meta('olive-game-project');
  const manifest = new URL('manifest.json', assetRoot);
  const [data, packed, config] = await Promise.all([
    json(new URL(peerProject ?? './project.json', location.href)), json(manifest), peerProject ? undefined : optionalConfig(),
  ]);
  const project = parseProject(config && data && typeof data === 'object' ? { ...data, config } : data);
  const progress = storageStore('olive:achievements:' + (project.gameSave?.key ?? location.pathname + ':' + project.startup), localStorage);
  const network = networkPlan(project);
  const builtIn = readManifest(packed, new URL('./', manifest).href);
  const assets = new Map([...builtIn, projectBundle(project.assets)].flatMap(bundle => bundle.assets.map(asset => [asset.alias, asset])));
  const scene = readScene(project, project.startup);
  const view = await SceneView.create(scene, {
    sourceFor(alias) { const asset = assets.get(alias); return asset?.kind === 'audio' ? asset.url : undefined; },
    publishAudio: audio => { if (audio.state === 'error') console.error(audio); },
    publishSource: (id, source) => { if (source?.state === 'error') console.error(id, source); },
    onReload: () => {
      if (!started) return;
      stopInput?.();
      stopGlobals?.();
      stopGlobals = view.attachGlobals(project.globals, () => {});
      stopInput = view.attachInput(project.inputMap, host, () => {});
      showScene(playback);
    },
  }, missing => { if (missing.size) console.error(t('gameAssetErrors'), [...missing]); },
  displayProfile(host.clientWidth || innerWidth, host.clientHeight || innerHeight));
  host.append(view.app.canvas);
  view.app.audio.sources.setMixer(project.audioMix);
  view.setShaderLibrary(project.shaders);
  if (project.content) view.setGameLanguage(project.content.localization, matchLanguage(project.content.localization, navigator.languages));
  const updateSize = () => {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    const profile = displayProfile(width, height);
    const config = configRegistry.forPreview(project.config, profile.device, profile.orientation);
    document.body.style.backgroundColor = config.renderer.background;
    view.configure(config, profile, width, height, project.config.renderer);
  };
  new ResizeObserver(updateSize).observe(host);

  let playback: ScenePlayback = { main: project.startup, added: [] };
  let stopScene: (() => void) | undefined;
  let stopGlobals: (() => void) | undefined;
  let stopInput: (() => void) | undefined;
  let queued: ScenePlayback | undefined;
  let queuedGlobals: Record<string, unknown> | undefined;
  const changeScene = (target: string, mode: SceneLink['mode'], link?: SceneLink) => {
    if (!project.scenes.some(record => record.id === target)) return;
    const previous = queued ?? playback;
    const next = followProjectSceneLink(project, previous, link ?? { target, mode });
    if (previous === next) return;
    schedule(next);
  };
  function schedule(next: ScenePlayback, globals?: Record<string, unknown>) {
    const pending = !!queued;
    queued = next;
    if (globals) queuedGlobals = globals;
    if (!pending) queueMicrotask(() => {
      if (!queued) return;
      const next = queued;
      const values = queuedGlobals;
      queued = undefined;
      queuedGlobals = undefined;
      try {
        if (values) view.app.globals.restore(values);
        showScene(next);
      } catch (error) { report(error); }
    });
  }
  function showScene(next: ScenePlayback) {
    stopScene?.();
    view.stopTimeline();
    view.app.audio.sources.stopScene();
    playback = next;
    const primary = sceneRecord(project, next.main);
    const nodes = [primary, ...next.added.map(id => sceneRecord(project, id))].flatMap(record => record.objects);
    const cameraId = cameraInScene(primary.objects)?.id;
    const transitionLayer = next.transitionLayer && {
      exit: next.transitionLayer.exit,
      rootIds: sceneRecord(project, next.transitionLayer.id).objects.map(node => node.id),
    };
    view.show(nodes, assets, { id: next.main, cameraId, transition: next.transition, transitionLayer }, project.globals, primary.lighting);
    updateSize();
    const online = !!network.rules && network.template?.scene === primary.id;
    const authored = online ? nodes.filter(node => node.id !== network.template?.node.id) : nodes;
    const stopPhysics = view.attachPhysics(authored, project.physics ?? defaultPhysicsSettings, state =>
      state?.errors.forEach(error => console.error(error)));
    const stopScripts = view.attachScripts({
      library: project.scripts, scene: primary, scenes: project.scenes, objects: authored,
      inputMap: project.inputMap, globals: project.globals, changeScene, popScene: () => {
        const current = queued ?? playback, previous = popScene(current);
        if (previous !== current) schedule(previous);
      }, debug: false, production: project,
    }, project.content, host, progress);
    const stopCinematic = playCinematic(view, project, primary.id);
    view.app.audio.sources.playScene();
    let canceled = false;
    let stopNetwork: (() => void) | undefined;
    if (online) void import('@rewrite/multiplayer-colyseus/client').then(({ gameEndpoint }) => {
      if (canceled) return;
      const name = ((meta('olive-game-peer') ?? new URLSearchParams(location.search).get('name'))?.trim() || t('networkGamePlayer')).slice(0, 32);
      stopNetwork = view.attachNetwork(network, gameEndpoint(network.settings, location), name, project.inputMap, client => {
        if (client?.error) console.warn(client.error);
      });
    }).catch(error => { if (!canceled) console.error(error); });
    stopScene = () => { canceled = true; stopNetwork?.(); stopCinematic?.(); stopScripts(); stopPhysics(); };
  }

  const saves = document.querySelector<HTMLDetailsElement>('#saves')!;
  if (project.gameSave) {
    const config = project.gameSave;
    const slot = document.querySelector<HTMLSelectElement>('#slot')!;
    const result = document.querySelector<HTMLOutputElement>('#save-status')!;
    saves.querySelector('summary')!.textContent = t('gameSavesHeading');
    document.querySelector('#slot-label')!.textContent = t('gameSaveSlot');
    for (const index of gameSlots) slot.add(new Option(String(index), String(index)));
    const save = document.querySelector<HTMLButtonElement>('#save')!;
    const load = document.querySelector<HTMLButtonElement>('#load')!;
    save.textContent = t('saveGameSlot');
    load.textContent = t('loadGameSlot');
    save.onclick = () => {
      const index = Number(slot.value) as GameSlot;
      try {
        if (writeGameSlot(localStorage, config, index, { ...playback, values: view.app.globals.values() })) {
          result.value = t('gameSlotSaved', { index });
          return;
        }
      } catch { /* unavailable */ }
      result.value = t('gameSlotUnavailable', { index });
    };
    load.onclick = () => {
      const index = Number(slot.value) as GameSlot;
      try {
        const entry = readGameSlot(localStorage, config, index);
        if (entry.status === 'ok') {
          const known = new Set(project.scenes.map(scene => scene.id));
          const main = known.has(entry.data.main) ? entry.data.main : project.startup;
          const added = entry.data.added.filter(id => id !== main && known.has(id));
          const stack = entry.data.stack?.filter(frame => known.has(frame.main)).map(frame => ({
            ...frame, added: [...new Set(frame.added)].filter(id => id !== frame.main && known.has(id)),
          }));
          schedule({ main, added: [...new Set(added)], stack }, entry.data.values);
          result.value = t('gameSlotLoaded', { index });
          return;
        }
        const message = { empty: 'gameSlotEmpty', revision: 'gameSlotRevision', invalid: 'gameSlotInvalid', unavailable: 'gameSlotUnavailable' } as const;
        result.value = t(message[entry.status], { index });
      } catch { result.value = t('gameSlotUnavailable', { index }); }
    };
    saves.addEventListener('toggle', () => { if (!saves.open) host.focus(); });
  }

  const stopConsole = scriptConsole.subscribe(() => {
    const line = scriptConsole.lines().at(-1);
    if (line) console[line.level](line.message);
  });
  let started = false;
  const visibility = () => {
    if (!started) return;
    view.setGameSuspended(document.hidden);
    if (document.hidden) view.app.audio.sources.pauseScene();
    else view.app.audio.sources.playScene();
  };
  start.textContent = t('gameStart');
  status.textContent = document.title;
  start.hidden = false;
  start.onclick = () => {
    if (started) return;
    try {
      stopGlobals = view.attachGlobals(project.globals, () => {});
      stopInput = view.attachInput(project.inputMap, host, () => {});
      showScene(playback);
      if (Howler.ctx) void Howler.ctx.resume().catch(() => {});
      started = true;
      launch.hidden = true;
      saves.hidden = !project.gameSave;
      host.focus();
      document.addEventListener('visibilitychange', visibility);
    } catch (error) { report(error); }
  };
  host.addEventListener('pointerdown', () => host.focus({ preventScroll: true }));
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    document.removeEventListener('visibilitychange', visibility);
    stopScene?.();
    stopInput?.();
    stopGlobals?.();
    stopConsole();
    view.destroy();
  }, { once: false });
  if (document.querySelector('link[rel="manifest"]') && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('./sw.js').catch(error => console.warn(error));
  }
}

void prepare().catch(report);
