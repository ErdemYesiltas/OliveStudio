// Spike-only measurement probe. Injected as a classic script before the player
// module so it can observe Howler's AudioContext. Every record is one console
// line, "PIXI_SPIKE {json}", which Capacitor forwards to the native log.
(() => {
  const t0 = performance.now();
  const shim = new URLSearchParams(location.search).get('shim') === 'on';
  const emit = (type, data = {}) => console.log('PIXI_SPIKE ' + JSON.stringify({type, t: Math.round(performance.now() - t0), ...data}));
  const contexts = [];
  let decodedStarts = 0;
  let frames = 0;

  const Native = window.AudioContext || window.webkitAudioContext;
  if (Native) {
    class Probed extends Native {
      constructor(...args) {
        super(...args);
        const id = contexts.push(this);
        emit('audio-context', {id, state: this.state, sampleRate: this.sampleRate});
        this.addEventListener('statechange', () => emit('audio-state', {id, state: this.state, time: this.currentTime}));
      }
    }
    const create = Native.prototype.createBufferSource;
    Native.prototype.createBufferSource = function () {
      const source = create.call(this), start = source.start;
      source.start = function (...args) {
        // Ignore Howler's silent unlock pulse; count real decoded clips only.
        if (source.buffer && source.buffer.duration > 0.01) {
          decodedStarts++;
          emit('audio-start', {id: contexts.indexOf(source.context) + 1, state: source.context.state, duration: source.buffer.duration});
        }
        return start.apply(this, args);
      };
      const stop = source.stop;
      source.stop = function (...args) {
        if (source.buffer && source.buffer.duration > 0.01) emit('audio-stop', {loop: source.loop});
        return stop.apply(this, args);
      };
      return source;
    };
    const decode = Native.prototype.decodeAudioData;
    Native.prototype.decodeAudioData = function (data, ...rest) {
      const id = contexts.indexOf(this) + 1, bytes = data?.byteLength;
      const result = decode.call(this, data, ...rest);
      result?.then?.(b => emit('audio-decoded', {id, bytes, duration: b.duration}), e => emit('audio-decode-error', {id, bytes, error: String(e)}));
      return result;
    };
    window.AudioContext = Probed;
    if (window.webkitAudioContext) window.webkitAudioContext = Probed;
  }

  // SPIKE-ONLY WORKAROUND, not product behavior: Capacitor iOS answers media files with a
  // status-0 response that still carries the body. Normalizing it lets the rest of the audio
  // path (decode, unlock, playback, lifecycle) be measured. The player now accepts these bodies itself; enable with ?shim=on only to reproduce the spike.
  const rawFetch = window.fetch.bind(window);
  if (shim && location.protocol === 'capacitor:') {
    window.fetch = async (...args) => {
      const response = await rawFetch(...args);
      if (response.status !== 0) return response;
      const body = await response.blob();
      emit('fetch-shim', {url: String(args[0]), bytes: body.size});
      return new Response(body, {status: body.size ? 200 : 404});
    };
  }

  let mediaPlays = 0;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    mediaPlays++;
    emit('media-play', {src: this.currentSrc || this.src || null});
    return play.apply(this, args);
  };

  const game = () => document.querySelector('#game');
  const poses = () => { try { return JSON.parse(game()?.dataset.poses || '{}'); } catch { return {}; } };
  const snapshot = () => {
    const p = poses();
    return {
      scene: game()?.dataset.sceneId ?? null,
      runtimeTime: Number(game()?.dataset.runtimeTime ?? NaN),
      buttonX: p.button?.x ?? null,
      flags: {start: p['start-flag']?.active ?? null, spine: p['spine-flag']?.active ?? null, physics: p['physics-flag']?.active ?? null},
      audio: contexts.map(c => c.state),
      decodedStarts,
      mediaPlays,
      player: (() => { try { return JSON.parse(game()?.dataset.audio || 'null'); } catch { return null; } })(),
      visibility: document.visibilityState,
    };
  };
  const layout = reason => {
    const rect = game()?.getBoundingClientRect();
    const start = document.querySelector('#start')?.getBoundingClientRect();
    emit('layout', {reason, href: location.href, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, game: rect && [rect.x, rect.y, rect.width, rect.height], start: start && [start.x, start.y, start.width, start.height], ua: navigator.userAgent});
  };

  for (const type of ['pointerdown', 'touchstart']) {
    document.addEventListener(type, e => {
      const point = e.touches?.[0] ?? e;
      emit(type, {pointerType: e.pointerType ?? 'touch', x: Math.round(point.clientX), y: Math.round(point.clientY), ...snapshot()});
    }, {capture: true, passive: true});
  }

  let hiddenAt;
  document.addEventListener('visibilitychange', () => {
    const now = snapshot();
    if (document.visibilityState === 'hidden') hiddenAt = {wall: Date.now(), runtimeTime: now.runtimeTime};
    else if (hiddenAt) {
      // The runtime clamps a frame to 8/60 s; a large runtime jump here would mean catch-up after background.
      const wallMs = Date.now() - hiddenAt.wall;
      setTimeout(() => {
        const later = snapshot();
        emit('resume-delta', {wallMs, runtimeDeltaFirst: now.runtimeTime - hiddenAt.runtimeTime, runtimeDelta500ms: later.runtimeTime - hiddenAt.runtimeTime, audio: later.audio});
        hiddenAt = undefined;
      }, 500);
    }
    emit('visibility', now);
  });
  for (const type of ['pagehide', 'pageshow', 'freeze', 'resume', 'blur', 'focus']) {
    window.addEventListener(type, e => emit(type, {persisted: e.persisted ?? null, ...snapshot()}), {capture: true});
  }

  window.addEventListener('error', e => emit('error', {message: e.message ?? null, resource: e.target?.src ?? e.target?.href ?? null}), true);
  window.addEventListener('unhandledrejection', e => emit('rejection', {reason: String(e.reason)}));
  window.addEventListener('resize', () => layout('resize'));

  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if (entry.initiatorType === 'script' || entry.initiatorType === 'link') continue;
      emit('resource', {name: entry.name, initiator: entry.initiatorType, duration: Math.round(entry.duration), status: entry.responseStatus ?? null});
    }
  }).observe({type: 'resource', buffered: true});

  const count = () => { frames++; requestAnimationFrame(count); };
  requestAnimationFrame(count);
  let lastFrames = 0;
  setInterval(() => {
    emit('sample', {fps: frames - lastFrames, ...snapshot()});
    lastFrames = frames;
  }, 1000);

  addEventListener('DOMContentLoaded', () => {
    // The native bridge may be injected after this script, so the App plugin is read here.
    const App = window.Capacitor?.Plugins?.App;
    if (App) {
      App.addListener('appStateChange', state => emit('app-state', {isActive: state.isActive, ...snapshot()}));
      App.addListener('pause', () => emit('app-pause', snapshot()));
      App.addListener('resume', () => emit('app-resume', snapshot()));
    }
    emit('boot', {shim, native: Boolean(window.Capacitor?.isNativePlatform?.()), platform: window.Capacitor?.getPlatform?.() ?? 'web', app: Boolean(App)});
    const status = document.querySelector('#status');
    if (status) new MutationObserver(() => emit('status', {text: status.textContent, hidden: status.hidden})).observe(status, {childList: true, characterData: true, subtree: true, attributes: true});
    layout('load');
    // Asset URL behavior: every exported game asset through the same fetch path the player uses.
    void (async () => {
      const bundle = await (await fetch('./project.json')).json();
      for (const files of Object.values(bundle.files)) {
        for (const url of Object.values(files)) {
          try {
            const response = await rawFetch(url);
            const bytes = (await response.arrayBuffer()).byteLength;
            emit('asset-fetch', {url, status: response.status, ok: response.ok, contentType: response.headers.get('content-type'), length: response.headers.get('content-length'), range: response.headers.get('content-range'), bytes});
          } catch (error) {
            emit('asset-fetch', {url, error: String(error)});
          }
        }
      }
    })();
  });
})();
