import {useEffect, useState, useSyncExternalStore} from 'react';
import {GlobalNameSchema} from '@rewrite/interactions';
import {InputMapSchema, bindingLabel, type Binding, type InputMap} from './index';

type Capture = {action: number; mode: 'button' | 'negative' | 'positive'; negative?: string};
/**
 * Input map editor. "Listen" captures the next key, mouse button or gamepad button (Escape cancels); axes capture a
 * key pair (negative, then positive) or use a gamepad axis. Every change is one undo step.
 */
export function createInputPanel(bridge: {
 read(): InputMap; write(next: InputMap): void; subscribe(listener: () => void): () => void; version(): number;
 /** Number globals an axis can write. */
 globals(): readonly {id: string; name: string}[]; useEditable(): boolean; text(key: string): string; report(error: unknown): void;
 /** While the game runs: which actions are held right now (the rows light up); null in edit mode. */
 live?(): {isPressed(id: string): boolean} | null;
}) {
 return function InputPanel() {
  useSyncExternalStore(bridge.subscribe, bridge.version);
  const editable = bridge.useEditable(), map = bridge.read(), t = bridge.text, [capture, setCapture] = useState<Capture | null>(null);
  const [held, setHeld] = useState('');
  useEffect(() => {
   const live = bridge.live?.(); if (!live) { setHeld(''); return; }
   let frame = 0;
   const tick = () => { const ids = map.actions.filter(a => live.isPressed(a.id)).map(a => a.id).join(','); setHeld(h => h === ids ? h : ids); frame = requestAnimationFrame(tick); };
   frame = requestAnimationFrame(tick);
   return () => cancelAnimationFrame(frame);
  }, [editable, map.actions.map(a => a.id).join()]);
  const heldIds = new Set(held ? held.split(',') : []);
  const write = (fn: (next: InputMap) => void) => { try { const next = structuredClone(map); fn(next); bridge.write(InputMapSchema.parse(next)); } catch (e) { bridge.report(e); } };
  const add = (index: number, binding: Binding) => write(next => {
   const action = next.actions[index];
   if (!action.bindings.some(b => JSON.stringify(b) === JSON.stringify(binding))) action.bindings.push(binding);
  });

  useEffect(() => {
   if (!capture) return;
   let frame = 0;
   const done = (binding?: Binding) => { setCapture(null); if (binding) add(capture.action, binding); };
   const key = (e: KeyboardEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { done(); return; }
    if (capture.mode === 'button') done({type: 'key', code: e.code});
    else if (capture.mode === 'negative') setCapture({...capture, mode: 'positive', negative: e.code});
    else done({type: 'keyAxis', negative: capture.negative!, positive: e.code});
   };
   const mouse = (e: PointerEvent) => {
    if (capture.mode !== 'button' || !(e.target instanceof HTMLElement) || !e.target.closest('[data-input-capture]')) return;
    e.preventDefault(); done({type: 'mouse', button: e.button});
   };
   const poll = () => {
    const pad = [...(navigator.getGamepads?.() ?? [])].find(p => p);
    const pressed = pad?.buttons.findIndex(b => b.pressed) ?? -1;
    if (capture.mode === 'button' && pressed >= 0) { done({type: 'gamepadButton', index: pressed}); return; }
    frame = requestAnimationFrame(poll);
   };
   window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', mouse, true); frame = requestAnimationFrame(poll);
   return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', mouse, true); cancelAnimationFrame(frame); };
  });

  const globals = bridge.globals();
  return <div className="panel-body input-panel" data-testid="input-panel">
   <p className="panel-empty">{t('input.help')}</p>
   {map.actions.map((a, i) => <fieldset key={a.id} className="input-action" data-action={a.name} data-held={heldIds.has(a.id) || undefined}>
    <legend>{a.name}{heldIds.has(a.id) && <span className="input-held"> ● {t('input.held')}</span>}</legend>
    <div className="input-action-head">
     <input aria-label={`${t('input.name')} ${i + 1}`} key={a.name} defaultValue={a.name} disabled={!editable} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      onBlur={e => { const name = e.currentTarget.value.trim(); if (name === a.name) return; if (!GlobalNameSchema.safeParse(name).success) { bridge.report(Error(t('input.invalidName'))); e.currentTarget.value = a.name; return; } write(next => { next.actions[i].name = name; }); }}/>
     <select aria-label={`${t('input.kind')} ${a.name}`} value={a.kind} disabled={!editable} onChange={e => write(next => { next.actions[i] = {id: a.id, name: a.name, kind: e.target.value as 'button' | 'axis', bindings: []}; })}>
      <option value="button">{t('input.button')}</option><option value="axis">{t('input.axis')}</option>
     </select>
     <button aria-label={`${t('input.remove')} ${a.name}`} disabled={!editable} onClick={() => write(next => { next.actions.splice(i, 1); })}>×</button>
    </div>
    <ul className="input-bindings" aria-label={`${t('input.bindings')} ${a.name}`}>
     {a.bindings.map((b, j) => <li key={j}><span>{bindingLabel(b)}</span><button aria-label={`${t('input.removeBinding')} ${bindingLabel(b)}`} disabled={!editable} onClick={() => write(next => { next.actions[i].bindings.splice(j, 1); })}>×</button></li>)}
     {!a.bindings.length && <li className="panel-empty">{t('input.noBindings')}</li>}
    </ul>
    {capture?.action === i
     ? <div className="input-capture" data-input-capture="true" role="status" tabIndex={-1}>{capture.mode === 'button' ? t('input.listening') : capture.mode === 'negative' ? t('input.listenNegative') : t('input.listenPositive')}</div>
     : <div className="panel-actions">
      {a.kind === 'button' ? <>
       <button disabled={!editable || a.bindings.length >= 16} onClick={() => setCapture({action: i, mode: 'button'})}>{t('input.listen')}</button>
       <button disabled={!editable || a.bindings.length >= 16} onClick={() => add(i, {type: 'touch'})}>{t('input.addTouch')}</button>
      </> : <>
       <button disabled={!editable || a.bindings.length >= 16} onClick={() => setCapture({action: i, mode: 'negative'})}>{t('input.listenPair')}</button>
       <select aria-label={`${t('input.addAxis')} ${a.name}`} value="" disabled={!editable || a.bindings.length >= 16} onChange={e => { const [index, invert] = e.target.value.split(':'); if (index) add(i, {type: 'gamepadAxis', index: Number(index), invert: invert === 'i'}); }}>
        <option value="">{t('input.addAxis')}</option>{[0, 1, 2, 3].flatMap(n => [<option key={n} value={`${n}:`}>{`${t('input.gamepadAxis')} ${n}`}</option>, <option key={`${n}i`} value={`${n}:i`}>{`${t('input.gamepadAxis')} ${n} (${t('input.inverted')})`}</option>])}
       </select>
       <select aria-label={`${t('input.global')} ${a.name}`} value={a.globalId ?? ''} disabled={!editable} onChange={e => write(next => { if (e.target.value) next.actions[i].globalId = e.target.value; else delete next.actions[i].globalId; })}>
        <option value="">{t('input.noGlobal')}</option>{globals.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
       </select>
      </>}
     </div>}
   </fieldset>)}
   <button disabled={!editable || map.actions.length >= 64} onClick={() => write(next => { const names = new Set(next.actions.map(a => a.name)); let n = next.actions.length + 1; while (names.has(`action${n}`)) n++; next.actions.push({id: crypto.randomUUID(), name: next.actions.length ? `action${n}` : 'jump', kind: 'button', bindings: []}); })}>{t('input.add')}</button>
  </div>;
 };
}
