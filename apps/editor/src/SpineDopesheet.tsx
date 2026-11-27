import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { ClipboardPaste, Copy, ListChecks, Trash2 } from 'lucide-react';
import { copySpineKeys, deleteSpineKeys, pasteSpineKeys, retimeSpineKeys, spineDopesheetTracks, spineKeyId, spineKeyShiftRange, spineKeyTime,
  type SpineDocument, type SpineKeyClipboard, type SpineKeySelection } from '@olivestudio/engine/spine-format';
import { IconButton, hint } from './chrome';
import { t } from './i18n';
import { validationMessage } from './scene';
import { SpineNumber } from './SpineNumber';

type KeyDrag = {
  pointer: number; startX: number; secondsPerPixel: number; key: SpineKeySelection; time: number; latest: number;
  min: number; max: number; selection: SpineKeySelection[]; moved: boolean;
};
type Marquee = { pointer: number; x: number; y: number; additive: boolean; moved: boolean };
type SelectionBox = { left: number; top: number; width: number; height: number };

export function SpineDopesheet({ document, animation, disabled, selectAnimation, change, report, seek, cursor }: {
  document: SpineDocument; animation: string; disabled: boolean; selectAnimation: (value: string) => void;
  change: (document: SpineDocument) => void; report: (error: string) => void; seek: (time: number) => void; cursor: number;
}) {
  const [selected, setSelected] = useState<SpineKeySelection[]>([]);
  const [clipboard, setClipboard] = useState<SpineKeyClipboard>([]);
  const [offset, setOffset] = useState(0.25);
  const [scale, setScale] = useState(1.5);
  const [query, setQuery] = useState('');
  const [snap, setSnap] = useState(false);
  const [fps, setFps] = useState(() => {
    const value = document.skeleton.fps;
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 30;
  });
  const anchor = useRef<SpineKeySelection>(null);
  const drag = useRef<KeyDrag>(null);
  const marquee = useRef<Marquee>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox>();
  const [motion, setMotion] = useState<{ offset: number; latest: number; cursor: number; selected: Set<string> }>();
  const suppressClick = useRef<string>(null);
  const result = useMemo(() => {
    try { return { tracks: spineDopesheetTracks(document, animation), error: '' }; }
    catch (error) { return { tracks: [], error: validationMessage(error) }; }
  }, [document, animation]);
  const rows = result.tracks.map(({ path, keys }) => ({ path, keys, label: path.join(' / ') }));
  const shown = rows.filter(row => row.label.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedIds = new Set(selected.map(spineKeyId));
  const end = rows.reduce((end, row) => row.keys.reduce((value, key) => Math.max(value, spineKeyTime(key)), end), 0);
  const duration = Math.max(1, end, cursor, motion?.latest ?? 0);
  const percent = (time: number) => 4 + 92 * time / duration;
  const names = Object.keys(document.animations ?? {});
  function run(action: () => void) {
    if (disabled) return;
    try { action(); report(''); }
    catch (error) { report(validationMessage(error)); }
  }
  function copy() { if (selected.length) run(() => setClipboard(copySpineKeys(document, animation, selected))); }
  function paste() {
    if (!clipboard.length || !animation) return;
    run(() => {
      const next = pasteSpineKeys(document, animation, clipboard, cursor);
      change(next.document);
      setSelected(next.selection);
      anchor.current = null;
    });
  }
  function remove() {
    if (!selected.length) return;
    run(() => {
      change(deleteSpineKeys(document, animation, selected));
      setSelected([]); anchor.current = null;
    });
  }
  function all() { setSelected(shown.flatMap(row => row.keys.map((_, index) => ({ path: row.path, index })))); }
  function pick(path: string[], index: number, time: number, event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) {
    const item = { path, index };
    const additive = event.metaKey || event.ctrlKey;
    const start = anchor.current;
    if (event.shiftKey && start && JSON.stringify(start.path) === JSON.stringify(path)) {
      const first = Math.min(index, start.index), last = Math.max(index, start.index);
      const range = Array.from({ length: last - first + 1 }, (_, i) => ({ path, index: first + i }));
      setSelected([...new Map([...(additive ? selected : []), ...range].map(key => [spineKeyId(key), key])).values()]);
    } else {
      const id = spineKeyId(item);
      setSelected(additive ? selectedIds.has(id) ? selected.filter(key => spineKeyId(key) !== id) : [...selected, item] : [item]);
      anchor.current = item;
    }
    seek(time);
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>, key: SpineKeySelection, time: number) {
    suppressClick.current = null;
    if (disabled || drag.current || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const lane = event.currentTarget.parentElement;
    const width = lane?.getBoundingClientRect().width ?? 0;
    if (!width) return;
    run(() => {
      const selection = selectedIds.has(spineKeyId(key)) ? selected : [key];
      const ids = new Set(selection.map(spineKeyId));
      let latest = time;
      for (const row of rows) row.keys.forEach((key, index) => {
        if (ids.has(spineKeyId({ path: row.path, index }))) latest = Math.max(latest, spineKeyTime(key));
      });
      drag.current = {
        pointer: event.pointerId, startX: event.clientX, secondsPerPixel: duration / (width * 0.92),
        key, time, latest, selection, moved: false, ...spineKeyShiftRange(document, animation, selection),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    });
  }
  const snappedTime = (time: number, min: number, max: number, fallback: number) => {
    if (!snap) return Math.max(min, Math.min(max, time));
    const first = Math.ceil(min * fps), last = Math.floor(max * fps);
    return first <= last ? Math.max(first, Math.min(last, Math.round(time * fps))) / fps : fallback;
  };
  const shiftAt = (active: KeyDrag, clientX: number) => {
    const time = active.time + (clientX - active.startX) * active.secondsPerPixel;
    return snappedTime(time, active.time + active.min, active.time + active.max, active.time) - active.time;
  };
  const scrubRuler = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const time = ((event.clientX - rect.left) / rect.width - 0.04) * duration / 0.92;
    seek(snappedTime(time, 0, duration, cursor));
  };
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (active?.pointer !== event.pointerId || disabled) return;
    if (!active.moved && Math.abs(event.clientX - active.startX) < 3) return;
    active.moved = true;
    const offset = shiftAt(active, event.clientX);
    setMotion({ offset, latest: active.latest + offset, cursor: active.time + offset, selected: new Set(active.selection.map(spineKeyId)) });
  }
  function finishDrag(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const active = drag.current;
    if (active?.pointer !== event.pointerId) return;
    drag.current = null;
    setMotion(undefined);
    if (!active.moved || !commit) return;
    suppressClick.current = spineKeyId(active.key);
    run(() => {
      const offset = shiftAt(active, event.clientX);
      if (Math.abs(offset) >= 0.000001) change(retimeSpineKeys(document, animation, active.selection, { offset }));
      setSelected(active.selection);
      anchor.current = active.key;
      seek(active.time + offset);
    });
  }

  function startMarquee(event: PointerEvent<HTMLDivElement>) {
    if (disabled || drag.current || marquee.current || event.button !== 0 || !(event.target instanceof Element) ||
        event.target.closest('button, .spine-dopesheet-ruler') || !event.target.closest('.spine-dopesheet-lane')) return;
    marquee.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY,
      additive: event.metaKey || event.ctrlKey || event.shiftKey, moved: false };
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function marqueeBounds(event: PointerEvent<HTMLDivElement>, active: Marquee) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(rect.left, Math.min(rect.right, event.clientX));
    const y = Math.max(rect.top, Math.min(rect.bottom, event.clientY));
    return { left: Math.min(active.x, x) - rect.left, top: Math.min(active.y, y) - rect.top,
      width: Math.abs(x - active.x), height: Math.abs(y - active.y) };
  }
  function moveMarquee(event: PointerEvent<HTMLDivElement>) {
    const active = marquee.current;
    if (active?.pointer !== event.pointerId || disabled) return;
    if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 3) return;
    active.moved = true;
    setSelectionBox(marqueeBounds(event, active));
  }
  function finishMarquee(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const active = marquee.current;
    if (active?.pointer !== event.pointerId) return;
    marquee.current = null;
    setSelectionBox(undefined);
    if (!commit || disabled) return;
    if (!active.moved) {
      if (!active.additive) { setSelected([]); anchor.current = null; }
      return;
    }
    const box = marqueeBounds(event, active);
    const grid = event.currentTarget.getBoundingClientRect();
    const hits = new Set<string>();
    for (const button of event.currentTarget.querySelectorAll<HTMLElement>('[data-spine-key]')) {
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2 - grid.left;
      const y = rect.top + rect.height / 2 - grid.top;
      if (x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) hits.add(button.dataset.spineKey!);
    }
    const keys = shown.flatMap(row => row.keys.flatMap((_, index) => {
      const key = { path: row.path, index };
      return hits.has(spineKeyId(key)) ? [key] : [];
    }));
    setSelected(active.additive ? [...new Map([...selected, ...keys].map(key => [spineKeyId(key), key])).values()] : keys);
    anchor.current = null;
  }

  return <>
    <div className="spine-dopesheet-tools">
      <label>{t('assetAnimation')}<select value={animation} disabled={disabled || !names.length} onChange={event => {
        selectAnimation(event.currentTarget.value); seek(0); setSelected([]); anchor.current = null;
      }}>
        {!names.length && <option value="">—</option>}{names.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <input type="search" aria-label={t('spineFilterTracks')} placeholder={t('spineFilterTracks')} value={query} disabled={disabled}
        onChange={event => setQuery(event.currentTarget.value)} />
      <div className="spine-dopesheet-selection" role="group" aria-label={t('spineDopesheetKeys')}>
        <IconButton icon={ListChecks} label={t('spineSelectAllKeys')} disabled={disabled || !shown.length} onClick={all} />
        <IconButton icon={Copy} label={t('spineCopyKeys')} disabled={disabled || !selected.length} onClick={copy} />
        <IconButton icon={ClipboardPaste} label={t('spinePasteKeys')} disabled={disabled || !clipboard.length || !animation} onClick={paste} />
        <IconButton icon={Trash2} label={t('spineDeleteKeys')} disabled={disabled || !selected.length} onClick={remove} />
        <output>{t('spineKeysSelected', { count: selected.length })}</output>
      </div>
    </div>
    <div className="spine-dopesheet-tools spine-dopesheet-retiming">
      <SpineNumber label={t('spineDopesheetCursor')} value={cursor} min={0} disabled={disabled} change={seek} />
      <label>{t('spineSnapFrames')}<input type="checkbox" checked={snap} disabled={disabled}
        onChange={event => setSnap(event.currentTarget.checked)} /></label>
      {snap && <SpineNumber label={t('spineSnapFrameRate')} value={fps} min={1} step={1} disabled={disabled} change={setFps} />}
      <SpineNumber label={t('spineDopesheetOffset')} value={offset} disabled={disabled} change={setOffset} />
      <button type="button" className="bundle-command" disabled={disabled || !selected.length}
        onClick={() => run(() => change(retimeSpineKeys(document, animation, selected, { offset })))}>
        {t('spineMoveKeys')}
      </button>
      <SpineNumber label={t('spineDopesheetScale')} value={scale} min={0.0001} disabled={disabled} change={setScale} />
      <button type="button" className="bundle-command" disabled={disabled || !selected.length}
        onClick={() => run(() => change(retimeSpineKeys(document, animation, selected, { scale })))}>
        {t('spineScaleKeys')}
      </button>
    </div>
    {result.error ? <small className="error" role="alert">{result.error}</small> : !shown.length ? <small>{t('spineNoKeys')}</small> :
      <div className="spine-dopesheet" role="group" aria-label={t('spineDopesheetGrid')} tabIndex={0}
        onPointerDown={startMarquee} onPointerMove={moveMarquee} onPointerUp={event => finishMarquee(event, true)}
        onPointerCancel={event => finishMarquee(event, false)} onLostPointerCapture={event => finishMarquee(event, false)} onKeyDown={event => {
        const modifier = event.metaKey || event.ctrlKey;
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); }
        else if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); if (!disabled) all(); }
        else if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); copy(); }
        else if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); paste(); }
      }}>
        {selectionBox && <div className="spine-dopesheet-marquee" style={selectionBox} aria-hidden="true" />}
        <div className="spine-dopesheet-row spine-dopesheet-ruler">
          <span>{t('spineTimelineTrack')}</span>
          <div className="spine-dopesheet-lane spine-dopesheet-scrub" role="slider" aria-label={t('spineDopesheetRuler')}
            aria-valuemin={0} aria-valuemax={duration} aria-valuenow={cursor} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
            onPointerDown={event => {
              if (disabled || event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              scrubRuler(event);
            }}
            onPointerMove={event => { if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) scrubRuler(event); }}
            onKeyDown={event => {
              if (disabled) return;
              const step = snap ? 1 / fps : 0.01;
              const target = event.key === 'Home' ? 0 : event.key === 'End' ? duration :
                event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? cursor - step :
                event.key === 'ArrowRight' || event.key === 'ArrowUp' ? cursor + step : undefined;
              if (target === undefined) return;
              event.preventDefault();
              seek(snappedTime(target, 0, duration, cursor));
            }}>
            <i aria-hidden="true" style={{ left: `${percent(motion?.cursor ?? cursor)}%` }} />
            {[0, 1, 2, 3, 4].map(index => <span key={index} style={{ left: `${percent(duration * index / 4)}%` }}>
              {Number((duration * index / 4).toFixed(2))} s
            </span>)}
          </div>
        </div>
        {shown.map(({ path, keys, label }) => <div className="spine-dopesheet-row" key={JSON.stringify(path)}>
          <span title={label}>{label}</span>
          <div className="spine-dopesheet-lane">
            <i aria-hidden="true" style={{ left: `${percent(motion?.cursor ?? cursor)}%` }} />
            {keys.map((key, index) => {
              const time = spineKeyTime(key);
              const occurrence = keys.slice(0, index).filter(other => spineKeyTime(other) === time).length;
              const name = t('spineDopesheetKeyLabel', { track: label, time, index: index + 1 });
              const item = { path, index }, id = spineKeyId(item);
              const previewing = motion?.selected.has(id) ?? false;
              return <button type="button" key={index} data-spine-key={id} aria-label={name} className="spine-dopesheet-key" {...hint(name)}
                aria-pressed={motion ? previewing : selectedIds.has(id)} disabled={disabled}
                style={{ left: `calc(${percent(time + (previewing ? motion!.offset : 0))}% + ${occurrence * 9}px)` }}
                onPointerDown={event => startDrag(event, item, time)} onPointerMove={moveDrag}
                onPointerUp={event => finishDrag(event, true)} onPointerCancel={event => finishDrag(event, false)}
                onLostPointerCapture={event => finishDrag(event, false)}
                onClick={event => {
                  if (event.detail && suppressClick.current === id) { suppressClick.current = null; return; }
                  pick(path, index, time, event);
                }} />;
            })}
          </div>
        </div>)}
      </div>}
  </>;
}
