import {useEffect, useMemo, useRef, useState} from 'react';
import {breakdown, categories, categoryColors, summarize, toCsv, type Category, type ProfileRecorder, type ProfileSample} from './index';

const SHOWN = 300;
const ms = (v: number) => `${v < 10 ? v.toFixed(2) : v.toFixed(1)} ms`;
/** Stacked bars, one per frame (newest on the right), with 60 and 30 fps budget lines. */
function draw(canvas: HTMLCanvasElement, samples: readonly ProfileSample[], selected: number | null) {
 const g = canvas.getContext('2d'); if (!g) return;
 const ratio = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
 if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
 g.setTransform(ratio, 0, 0, ratio, 0, 0); g.clearRect(0, 0, w, h);
 const style = getComputedStyle(canvas), line = style.getPropertyValue('--border') || '#555', text = style.color;
 const top = Math.max(40, ...samples.map(s => s.frameMs)) * 1.1, y = (v: number) => h - v / top * h, bar = w / SHOWN;
 samples.forEach((s, i) => {
  const x = w - (samples.length - i) * bar, parts = breakdown(s);
  let base = 0;
  for (const c of categories) { const v = parts[c]; if (v <= 0) continue; g.fillStyle = c === 'idle' ? 'rgba(127,127,127,.18)' : categoryColors[c]; g.fillRect(x, y(base + v), Math.max(1, bar - .5), y(base) - y(base + v)); base += v; }
  if (selected === i) { g.strokeStyle = text; g.lineWidth = 1.5; g.strokeRect(x - .5, 0.5, bar + .5, h - 1); }
 });
 g.font = '10px ui-monospace,Menlo,monospace'; g.lineWidth = 1; g.setLineDash([4, 3]);
 for (const [v, label] of [[1000 / 60, '60 fps'], [1000 / 30, '30 fps']] as const) { g.strokeStyle = line; g.beginPath(); g.moveTo(0, y(v)); g.lineTo(w, y(v)); g.stroke(); g.fillStyle = text; g.fillText(label, 4, y(v) - 3); }
 g.setLineDash([]);
}

/**
 * Profiler panel: what each frame of Preview costs. Bars stack scripts, physics, animation, audio, logic and drawing
 * per frame; click a bar to inspect that frame. Capture pauses, clears and copies as CSV.
 */
export function createProfilerPanel(bridge: {text(key: string): string; recorder: ProfileRecorder; report(error: unknown): void}) {
 const t = bridge.text, recorder = bridge.recorder;
 return function Profiler() {
  const [version, setVersion] = useState(0), [paused, setPaused] = useState(recorder.paused), [selected, setSelected] = useState<number | null>(null), [copied, setCopied] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { let dirty = false; const off = recorder.subscribe(() => { dirty = true; }); const timer = setInterval(() => { if (dirty) { dirty = false; setVersion(v => v + 1); } }, 250); return () => { off(); clearInterval(timer); }; }, []);
  const all = recorder.samples(), samples = useMemo(() => all.slice(-SHOWN), [all, version]);
  const frame = selected !== null ? samples[selected] : undefined, summary = useMemo(() => summarize(frame ? [frame] : samples), [samples, frame]);
  useEffect(() => { if (canvas.current) draw(canvas.current, samples, selected); }, [samples, selected]);
  useEffect(() => { if (selected !== null && selected >= samples.length) setSelected(null); }, [samples.length, selected]);
  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
   const box = e.currentTarget.getBoundingClientRect(), from = Math.floor((box.right - e.clientX) / (box.width / SHOWN)), index = samples.length - 1 - from;
   setSelected(index >= 0 && index !== selected ? index : null);
  };
  const copy = () => { void navigator.clipboard.writeText(toCsv(recorder.samples())).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, bridge.report); };
  const tiles: [string, string, string?][] = frame
   ? [[t('profiler.frame'), ms(frame.frameMs)], [t('profiler.render'), ms(frame.renderMs)], [t('profiler.drawCalls'), String(frame.drawCalls)], [t('profiler.objects'), String(frame.objects)], [t('profiler.steps'), String(frame.steps)]]
   : [[t('profiler.fps'), String(summary.fps)], [t('profiler.average'), ms(summary.average)], [t('profiler.p95'), ms(summary.p95)], [t('profiler.spikes'), String(summary.spikes), summary.spikes ? 'warn' : undefined], [t('profiler.drawCalls'), String(summary.drawCalls)], [t('profiler.objects'), String(summary.objects)], ...(summary.heapMb !== undefined ? [[t('profiler.heap'), `${summary.heapMb.toFixed(0)} MB`] as [string, string]] : [])];
  return <div className="panel-body profiler" data-testid="profiler" data-frames={all.length}>
   <div className="profiler-toolbar" role="toolbar" aria-label={t('profiler.capture')}>
    <button aria-pressed={paused} onClick={() => { recorder.paused = !recorder.paused; setPaused(recorder.paused); }}>{paused ? t('profiler.resume') : t('profiler.pause')}</button>
    <button onClick={() => { recorder.clear(); setSelected(null); }} disabled={!all.length}>{t('profiler.clear')}</button>
    <button onClick={copy} disabled={!all.length}>{copied ? t('profiler.copied') : t('profiler.copyCsv')}</button>
    <span className="profiler-scope">{frame ? t('profiler.selectedFrame') : `${t('profiler.lastFrames')} ${samples.length}`}</span>
   </div>
   {!all.length ? <p className="empty-hint" data-testid="profiler-empty">{t('profiler.empty')}</p> : <>
    <div className="profiler-tiles">{tiles.map(([label, value, tone]) => <div key={label} className="profiler-tile" data-tone={tone}><small>{label}</small><strong data-testid={`profiler-${label}`}>{value}</strong></div>)}</div>
    <canvas ref={canvas} className="profiler-chart" role="img" aria-label={t('profiler.chart')} onClick={pick} data-testid="profiler-chart"/>
    <div className="profiler-legend">{categories.filter(c => c !== 'idle').map(c => <span key={c}><i style={{background: categoryColors[c]}}/>{t(`profiler.category.${c}`)}</span>)}</div>
    <table className="profiler-table" aria-label={t('profiler.systems')}>
     <thead><tr><th>{t('profiler.system')}</th><th>{t('profiler.avg')}</th><th>{t('profiler.max')}</th><th>{t('profiler.share')}</th></tr></thead>
     <tbody>{summary.systems.map(s => <tr key={s.id} data-system={s.id}><td><i style={{background: categoryColors[s.category as Category]}}/>{s.id === 'render' ? t('profiler.category.render') : s.id}</td><td>{ms(s.average)}</td><td>{ms(s.max)}</td><td><span className="profiler-share" style={{width: `${Math.round(s.share * 100)}%`}}/>{`${Math.round(s.share * 100)}%`}</td></tr>)}</tbody>
    </table>
   </>}
  </div>;
 };
}
