import {useEffect, useState, useSyncExternalStore, type ReactElement} from 'react';
import type {Behaviour, Script, ScriptLibrary} from '@rewrite/scripts/contracts';
import {BehaviorSchema, behaviorEvents, definesMachine, type ActorInfo, type Behavior, type MachineInfo} from './contracts';
import {behaviorLive} from './live';
import {machineTemplate, type BehaviorProvider} from './index';

export interface BehaviorBridge {
 text(key: string): string; report(error: unknown): void; useEditable(): boolean;
 useLibrary(): ScriptLibrary;
 setBehavior(entityId: string, componentId: string, value: Behavior): void;
 /** The Script component's parameter editor (same fields, defaults and object references). */
 ParamsEditor(props: {value: Behaviour; script: Script | undefined; save(next: Behaviour): void; owner: string}): ReactElement | null;
 openScript(id: string): void;
 createScript(name: string, source: string): Script;
 /** Re-render when the script engine finishes loading (describe returns null until then). */
 useEngine(): unknown;
 select(entityId: string): void;
}

const machineCache = new Map<string, MachineInfo>();
function useMachine(provider: BehaviorProvider, bridge: BehaviorBridge, script: Script | undefined) {
 bridge.useEngine();
 if (!script?.code || script.error) return null;
 let info = machineCache.get(script.code);
 if (!info) { const next = provider.describe(script.code, script.name); if (!next) return null; info = next; machineCache.set(script.code, info); if (machineCache.size > 100) machineCache.delete(machineCache.keys().next().value!); }
 return info;
}

export function createBehaviorViews(provider: BehaviorProvider, bridge: BehaviorBridge) {
 const t = bridge.text;
 /** Behavior component: machine script, pinned machine, parameters and what the machine defines. */
 function BehaviorInspector({entityId, component}: {entityId: string; component: {id: string; data: unknown}}) {
  const library = bridge.useLibrary(), editable = bridge.useEditable(), value = BehaviorSchema.parse(component.data), script = library.items.find(s => s.id === value.scriptId), machine = useMachine(provider, bridge, script);
  const save = (next: Behavior) => { try { bridge.setBehavior(entityId, component.id, BehaviorSchema.parse(next)); } catch (error) { bridge.report(error); } };
  const pinned = value.machine, mismatch = Boolean(machine && !machine.error && pinned && (pinned.id !== machine.id || (pinned.version ?? null) !== (machine.version ?? null)));
  const candidates = library.items.filter(s => definesMachine(s.source) || s.id === value.scriptId);
  return <div className="behavior-inspector" data-testid="behavior-inspector">
   <label className="field"><span>{t('behavior.script')}</span><select aria-label={t('behavior.script')} value={value.scriptId} disabled={!editable} onChange={e => { const {machine: _old, ...rest} = value; void _old; save({...rest, scriptId: e.target.value, params: {}, refs: {}}); }}><option value="">{t('behavior.choose')}</option>{candidates.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   {!value.scriptId && <p className="component-warning">{t('behavior.noScript')}</p>}
   {value.scriptId && !script && <p className="component-warning">{t('behavior.missing')}</p>}
   {script?.error && <p className="component-warning">{script.error}</p>}
   {script && !script.error && !definesMachine(script.source) && <p className="component-warning">{t('behavior.noMachine')}</p>}
   {machine?.error && <p className="component-warning">{machine.error}</p>}
   {machine && !machine.error && <dl className="behavior-machine" data-testid="behavior-machine">
    <dt>{t('behavior.machine')}</dt><dd>{machine.id}{machine.version ? ` · v${machine.version}` : ''}</dd>
    <dt>{t('behavior.states')}</dt><dd>{machine.states.length ? machine.states.join(', ') : '—'}</dd>
    <dt>{t('behavior.events')}</dt><dd>{machine.events.length ? machine.events.join(', ') : '—'}</dd>
   </dl>}
   {mismatch && <p className="component-warning" data-testid="behavior-pin-mismatch">{t('behavior.pinMismatch').replace('{pinned}', `${pinned!.id}${pinned!.version ? ` v${pinned!.version}` : ''}`).replace('{current}', `${machine!.id}${machine!.version ? ` v${machine!.version}` : ''}`)}</p>}
   {machine && !machine.error && <label className="field"><span>{t('behavior.pin')}</span><input type="checkbox" aria-label={t('behavior.pin')} checked={Boolean(pinned) && !mismatch} disabled={!editable} onChange={e => { const {machine: _old, ...rest} = value; void _old; save(e.target.checked ? {...rest, machine: {id: machine.id, ...(machine.version ? {version: machine.version} : {})}} : rest); }}/></label>}
   <bridge.ParamsEditor value={value} script={script} save={next => save({...value, ...next})} owner="behavior"/>
   <div className="panel-actions">
    {script ? <button onClick={() => bridge.openScript(script.id)}>{t('behavior.edit')}</button>
     : <button disabled={!editable} onClick={() => { try { const created = bridge.createScript('Behavior', machineTemplate); save({scriptId: created.id, params: {}, refs: {}}); bridge.openScript(created.id); } catch (error) { bridge.report(error); } }}>{t('behavior.newAndEdit')}</button>}
   </div>
  </div>;
 }

 /** Live view of running behaviors (Preview): states, context, recent transitions, errors; sends events. */
 function BehaviorPanel() {
  useSyncExternalStore(behaviorLive.subscribe, behaviorLive.snapshot);
  const live = behaviorLive.controller;
  const [actors, setActors] = useState<ActorInfo[]>([]), [error, setError] = useState(''), [selected, setSelected] = useState(''), [draft, setDraft] = useState('');
  useEffect(() => {
   if (!live) { setActors([]); return; }
   const read = () => { try { setActors(live.inspect()); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
   read(); const timer = setInterval(read, 250);
   return () => clearInterval(timer);
  }, [live, behaviorLive.snapshot()]);
  if (!live) return <section className="behavior-panel" data-testid="behavior-panel"><p className="panel-empty">{t('behavior.notRunning')}</p></section>;
  const actor = actors.find(a => a.key === selected) ?? actors[0];
  const send = (type: string) => { if (!actor || !type.trim()) return; try { live.send(actor.entityId, {type: type.trim()}); setDraft(''); behaviorLive.refresh(); } catch (e) { bridge.report(e); } };
  return <section className="behavior-panel" data-testid="behavior-panel" data-session={live.session}>
   {error && <p className="component-warning">{error}</p>}
   {!actors.length && <p className="panel-empty">{t('behavior.none')}</p>}
   <ul className="behavior-actors" role="listbox" aria-label={t('behavior.actors')}>
    {actors.map(a => <li key={a.key} role="option" aria-selected={a === actor} data-status={a.status} onClick={() => { setSelected(a.key); bridge.select(a.entityId); }}>
     <strong>{a.object}</strong> <small>{a.machine ? `${a.machine.id}${a.machine.version ? ` v${a.machine.version}` : ''}` : a.script}</small>
     <span className="behavior-states" data-testid="behavior-states">{a.status === 'error' ? `⚠ ${a.error}` : a.states.join(' · ') || a.status}</span>
    </li>)}
   </ul>
   {actor && <div className="behavior-detail" data-testid="behavior-detail">
    <dl>
     <dt>{t('behavior.status')}</dt><dd data-status={actor.status}>{actor.status}{live.paused() ? ` · ${t('behavior.paused')}` : ''}</dd>
     <dt>{t('behavior.states')}</dt><dd>{actor.states.join(', ') || '—'}</dd>
     <dt>{t('behavior.context')}</dt><dd><code>{actor.context}</code></dd>
     {actor.children.length > 0 && <><dt>{t('behavior.children')}</dt><dd>{actor.children.join(', ')}</dd></>}
    </dl>
    <h4>{t('behavior.history')}</h4>
    <ol className="behavior-history">{actor.history.slice().reverse().map((h, i) => <li key={i}><small>{h.time.toFixed(2)}s</small> <code>{h.event}</code> {h.from.join(', ') || '∅'} → {h.to.join(', ')}</li>)}</ol>
    <div className="panel-actions behavior-send">
     {actor.events.slice(0, 12).map(type => <button key={type} disabled={actor.status !== 'active'} onClick={() => send(type)}>{type}</button>)}
     <input aria-label={t('behavior.sendEvent')} placeholder={t('behavior.sendEvent')} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(draft); }} list="behavior-events"/>
     <datalist id="behavior-events">{behaviorEvents.map(e => <option key={e.type} value={e.type}/>)}</datalist>
    </div>
   </div>}
  </section>;
 }
 return {BehaviorInspector, BehaviorPanel};
}
