import {useEffect, useRef, useState} from 'react';
import {SfxSchema, encodeWav, presetSfx, renderSfx, seeded, sfxDuration, sfxPresets, waveforms, type Sfx, type SfxPreset} from './sfx';

const RATE = 44100;
type NumberKey = Exclude<keyof Sfx, 'wave'>;
const ranges: Record<NumberKey, [number, number, number]> = {
 frequency: [20, 4000, 1], slide: [-8, 8, .05], duty: [.05, .95, .01], attack: [0, 2, .001], sustain: [0, 3, .005], decay: [.005, 3, .005], punch: [0, 1, .01],
 vibrato: [0, 12, .05], vibratoSpeed: [0, 40, .1], arp: [-24, 24, 1], arpTime: [0, 2, .01], lowpass: [0, 20000, 10], volume: [0, 1, .01],
};
let context: AudioContext | null = null;
function play(samples: Float32Array) {
 context ??= new AudioContext();
 const buffer = context.createBuffer(1, samples.length, RATE); buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
 const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
}

/**
 * Sound Lab: make game sound effects without files. Pick a kind (each click is a new variation), tweak the synth,
 * listen, then add the WAV to the Library (or straight into the scene as a sound object).
 */
export function createSoundLab(bridge: {text(key: string): string; report(error: unknown): void; useEditable(): boolean; add(bytes: Uint8Array, name: string, place: boolean): Promise<void>}) {
 const t = bridge.text, counters = new Map<SfxPreset, number>();
 return function SoundLab() {
  const editable = bridge.useEditable();
  const [sfx, setSfx] = useState<Sfx>(() => presetSfx('pickup', 1)), [name, setName] = useState('Pickup 1'), [busy, setBusy] = useState(false), canvas = useRef<HTMLCanvasElement>(null);
  const samples = useRef<Float32Array>(new Float32Array(0));
  useEffect(() => {
   samples.current = renderSfx(sfx, RATE);
   const c = canvas.current, g = c?.getContext('2d'); if (!c || !g) return;
   const s = samples.current, w = c.width, h = c.height, per = Math.max(1, Math.floor(s.length / w)), color = getComputedStyle(c).color;
   g.clearRect(0, 0, w, h); g.fillStyle = color;
   for (let x = 0; x < w; x++) { let lo = 1, hi = -1; for (let i = x * per; i < Math.min(s.length, (x + 1) * per); i++) { lo = Math.min(lo, s[i]); hi = Math.max(hi, s[i]); } if (hi >= lo) g.fillRect(x, (1 - hi) * h / 2, 1, Math.max(1, (hi - lo) * h / 2)); }
  }, [sfx]);
  const preset = (kind: SfxPreset) => { const n = (counters.get(kind) ?? 0) + 1; counters.set(kind, n); const next = presetSfx(kind, n); setSfx(next); setName(`${t(`sfx.kind.${kind}`)} ${n}`); try { play(renderSfx(next, RATE)); } catch (e) { bridge.report(e); } };
  const mutate = () => { const r = seeded(Math.floor(Math.random() * 1e9)), next = {...sfx}; for (const key of Object.keys(ranges) as NumberKey[]) { if (r() < .5) continue; const [lo, hi] = ranges[key]; next[key] = Math.max(lo, Math.min(hi, next[key] + (r() - .5) * (hi - lo) * .08)); } const parsed = SfxSchema.parse(next); setSfx(parsed); try { play(renderSfx(parsed, RATE)); } catch (e) { bridge.report(e); } };
  const set = (key: NumberKey, value: number) => { if (!Number.isFinite(value)) return; const [lo, hi] = ranges[key]; setSfx(s => ({...s, [key]: Math.max(lo, Math.min(hi, value))})); };
  const add = (place: boolean) => { setBusy(true); void bridge.add(encodeWav(samples.current, RATE), name.trim().replace(/[^\w .()#-]/g, '') || 'Sound', place).catch(bridge.report).finally(() => setBusy(false)); };
  const shown = (key: NumberKey) => key !== 'duty' || sfx.wave === 'square';
  return <div className="panel-body sound-lab" data-testid="sound-lab">
   <div className="sound-lab-presets" role="group" aria-label={t('sfx.presets')}>{sfxPresets.map(kind => <button key={kind} onClick={() => preset(kind)}>{t(`sfx.kind.${kind}`)}</button>)}<button onClick={mutate}>{t('sfx.mutate')}</button></div>
   <canvas ref={canvas} className="sound-lab-wave" width={480} height={80} aria-label={t('sfx.waveform')} data-samples={samples.current.length}/>
   <div className="sound-lab-actions">
    <button onClick={() => { try { play(samples.current.length ? samples.current : renderSfx(sfx, RATE)); } catch (e) { bridge.report(e); } }}>{t('sfx.play')}</button>
    <small data-testid="sfx-duration">{`${sfxDuration(sfx).toFixed(2)} s`}</small>
    <input aria-label={t('sfx.name')} value={name} maxLength={60} onChange={e => setName(e.target.value)}/>
    <button disabled={!editable || busy} onClick={() => add(false)}>{t('sfx.addLibrary')}</button>
    <button disabled={!editable || busy} onClick={() => add(true)}>{t('sfx.addObject')}</button>
   </div>
   <div className="sound-lab-params">
    <label className="field"><span>{t('sfx.wave')}</span><select aria-label={t('sfx.wave')} value={sfx.wave} onChange={e => setSfx(s => ({...s, wave: e.target.value as Sfx['wave']}))}>{waveforms.map(w => <option key={w} value={w}>{t(`sfx.waveform.${w}`)}</option>)}</select></label>
    {(Object.keys(ranges) as NumberKey[]).filter(shown).map(key => { const [lo, hi, step] = ranges[key]; return <label key={key} className="field sound-lab-param"><span>{t(`sfx.${key}`)}</span><input type="range" aria-label={`${t(`sfx.${key}`)} slider`} min={lo} max={hi} step={step} value={sfx[key]} onChange={e => set(key, Number(e.target.value))}/><input type="number" aria-label={t(`sfx.${key}`)} min={lo} max={hi} step={step} value={Number(sfx[key].toPrecision(4))} onChange={e => set(key, Number(e.target.value))}/></label>; })}
   </div>
  </div>;
 };
}
