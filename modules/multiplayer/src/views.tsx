import {useEffect, useState, useSyncExternalStore} from 'react';
import {NetworkEntitySchema,MultiplayerSettingsSchema, findNetworkPlayer, multiplayerProblems, multiplayerSection, readMultiplayer, type MultiplayerSettings, type NetStatus, type ServerStatus} from './contracts';
import {multiplayerLive} from './live';
import type {MultiplayerServerPort} from './index';
import type {Project} from '@rewrite/project';

export interface MultiplayerBridge {
 text(key: string): string; report(error: unknown): void; useEditable(): boolean;
 useProject(): Project;
 change(label: string, mutate: (project: Project) => void): void;
 server: MultiplayerServerPort;
 /** Rules from the open project (throws without a Network Player). */
 start(): Promise<ServerStatus>;
 /** Enable multiplayer, keep/choose the template and add movement input actions (the multiplayer.setup tool). */
 setup(): void;
 previews?(action:'open'|'close'):Promise<unknown>;
}

export function createMultiplayerViews(bridge: MultiplayerBridge) {
 const t = bridge.text;
 /** Settings › Multiplayer: provider, room, players, tick, reconnection, smoothing, the exported game's endpoint. */
 function NetworkEntityInspector({entity,save}:{entity:import('@rewrite/scene').Entity;save(value:unknown):void}){
  const editable=bridge.useEditable(),component=entity.components.find(c=>c.type==='multiplayer.entity')!,value=NetworkEntitySchema.parse(component.data);
  const change=(patch:Partial<typeof value>)=>{try{save(NetworkEntitySchema.parse({...value,...patch}));}catch(error){bridge.report(error);}};
  return <div><p className="field-help">{t('net.serverAuthority')}</p>
   {entity.components.filter(c=>!['multiplayer.entity','behavior.machine','scripts.behaviour'].includes(c.type)).map(c=><fieldset key={c.id} disabled={!editable}><legend>{c.type}</legend>{c.data&&typeof c.data==='object'&&!Array.isArray(c.data)&&Object.keys(c.data).map(key=><label className="field" key={key}><span>{key}</span><input type="checkbox" checked={value.fields.some(f=>f.component===c.type&&f.keys.includes(key))} onChange={e=>{const keys=value.fields.find(f=>f.component===c.type)?.keys??[],next=e.target.checked?[...keys,key]:keys.filter(k=>k!==key);change({fields:[...value.fields.filter(f=>f.component!==c.type),...(next.length?[{component:c.type,keys:next}]:[])]});}}/></label>)}</fieldset>)}
   <label className="field"><span>{t('net.behaviorStates')}</span><input type="checkbox" checked={value.behavior} disabled={!editable} onChange={e=>change({behavior:e.target.checked})}/></label>
   <label className="field"><span>{t('net.allowedEvents')}</span><input defaultValue={value.events.join(', ')} key={value.events.join(',')} disabled={!editable} onBlur={e=>change({events:[...new Set(e.target.value.split(',').map(v=>v.trim()).filter(Boolean))]})}/></label>
  </div>;
 }
 function MultiplayerSettingsView() {
  const project = bridge.useProject(), editable = bridge.useEditable(), value = readMultiplayer(project.extensions[multiplayerSection]), problems = value.enabled ? multiplayerProblems(project) : [];
  const save = (patch: Partial<MultiplayerSettings>) => { try { const next = MultiplayerSettingsSchema.parse({...value, ...patch}); bridge.change('Multiplayer settings', p => { p.extensions[multiplayerSection] = next as never; }); } catch (error) { bridge.report(error); } };
  const number = (key: 'maxPlayers' | 'tickRate' | 'reconnectSeconds' | 'interpolationMs', min: number, max: number, step = 1) => <label className="field"><span>{t(`net.${key}`)}</span><input type="number" aria-label={t(`net.${key}`)} min={min} max={max} step={step} defaultValue={value[key]} key={`${key}-${value[key]}`} disabled={!editable} onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== value[key]) save({[key]: v}); }}/></label>;
  return <section className="settings-section" data-testid="multiplayer-settings">
   <p className="panel-empty">{t('net.help')}</p>
   <label className="field"><span>{t('net.enabled')}</span><input type="checkbox" aria-label={t('net.enabled')} checked={value.enabled} disabled={!editable} onChange={e => save({enabled: e.target.checked})}/></label>
   <label className="field"><span>{t('net.provider')}</span><select aria-label={t('net.provider')} value={value.provider} disabled><option value="colyseus">Colyseus 0.18</option></select></label>
   <label className="field"><span>{t('net.room')}</span><input aria-label={t('net.room')} defaultValue={value.room} key={value.room} disabled={!editable} onBlur={e => { if (e.target.value !== value.room) save({room: e.target.value.trim()}); }}/></label>
   {number('maxPlayers', 1, 16)}{number('tickRate', 10, 60)}{number('reconnectSeconds', 0, 120)}{number('interpolationMs', 0, 500, 10)}
   <label className="field"><span>{t('net.endpoint')}</span><input aria-label={t('net.endpoint')} placeholder="wss://play.example.com" defaultValue={value.endpoint} key={value.endpoint} disabled={!editable} onBlur={e => { if (e.target.value.trim() !== value.endpoint) save({endpoint: e.target.value.trim()}); }}/></label>
   <p className="field-help">{t('net.endpointHelp')}</p>
   {problems.map(p => <p key={p} className="component-warning">{p}</p>)}
   <div className="panel-actions"><button disabled={!editable} onClick={() => { try { bridge.setup(); } catch (error) { bridge.report(error); } }}>{t('net.setup')}</button></div>
  </section>;
 }

 /** Multiplayer panel: the local server (start/stop, rooms, players, refused messages, latency, drop) and Preview's client. */
 function MultiplayerPanel() {
  const project = bridge.useProject(), settings = readMultiplayer(project.extensions[multiplayerSection]), template = findNetworkPlayer(project);
  useSyncExternalStore(multiplayerLive.subscribe, multiplayerLive.snapshot);
  const [server, setServer] = useState<ServerStatus | null>(null), [client, setClient] = useState<NetStatus | null>(null), [busy, setBusy] = useState(false), [latency, setLatency] = useState(0);
  useEffect(() => {
   let live = true;
   const read = () => { void bridge.server.status().then(s => { if (live) setServer(s); }, () => undefined); const c = multiplayerLive.client; setClient(c ? c.status() : null); };
   read(); const timer = setInterval(read, 500);
   return () => { live = false; clearInterval(timer); };
  }, []);
  const run = (work: () => Promise<ServerStatus>) => { setBusy(true); void work().then(setServer, bridge.report).finally(() => setBusy(false)); };
  return <section className="multiplayer-panel" data-testid="multiplayer-panel">
   {!settings.enabled && <p className="panel-empty">{t('net.disabled')}</p>}
   {settings.enabled && !template && <p className="component-warning">{t('net.noTemplate')}</p>}
   <h4>{t('net.server')}</h4>
   <dl data-testid="multiplayer-server" data-running={server?.running ? 'true' : 'false'}>
    <dt>{t('net.status')}</dt><dd>{server?.running ? `${t('net.running')} · ${server.endpoint}` : t('net.stopped')}</dd>
    {server?.error && <><dt>{t('net.error')}</dt><dd className="component-warning">{server.error}</dd></>}
   </dl>
   <div className="panel-actions">
    <button disabled={busy || !settings.enabled || !template} onClick={() => run(() => bridge.start())}>{server?.running ? t('net.restart') : t('net.start')}</button>
    <button disabled={busy || !server?.running} onClick={() => run(() => bridge.server.stop())}>{t('net.stop')}</button>
    <label className="field inline"><span>{t('net.latency')}</span><input type="number" aria-label={t('net.latency')} min={0} max={2000} step={10} value={latency} disabled={!server?.running} onChange={e => setLatency(Number(e.target.value))} onBlur={() => run(() => bridge.server.latency(latency))}/></label>
   </div>
   {bridge.previews&&<div className="panel-actions"><button disabled={busy||!settings.enabled||!template} onClick={()=>{setBusy(true);void bridge.previews!('open').catch(bridge.report).finally(()=>setBusy(false));}}>{t('net.openClients')}</button><button disabled={busy} onClick={()=>{void bridge.previews!('close').catch(bridge.report);}}>{t('net.closeClients')}</button></div>}
   {server?.rooms.map(room => <div key={room.roomId} className="multiplayer-room" data-room={room.roomId}>
    <strong>{room.name}</strong> <small>{room.roomId} · {room.clients}/{room.maxClients} · {t('net.rejected')}: {room.rejected}</small>
    <ul>{room.players.map(p => <li key={p.sessionId} data-connected={p.connected}>{p.name} <small>{p.sessionId}</small> ({Math.round(p.x)}, {Math.round(p.y)}) {p.connected ? '' : `· ${t('net.reconnecting')}`}
     <button disabled={!p.connected} title={t('net.dropHelp')} onClick={() => run(() => bridge.server.drop(p.sessionId))}>{t('net.drop')}</button></li>)}</ul>
    {room.world&&<details><summary>{t('net.entities')} · {room.world.entities.length}</summary><ul>{room.world.entities.map(e=><li key={e.id}><code>{e.id}</code> {e.states?.join(' · ')}<pre>{JSON.stringify(e.fields,null,2)}</pre></li>)}</ul>{room.world.diagnostics.map((message,i)=><p className="component-warning" key={i}>{message}</p>)}</details>}
    {room.recentRejections.length > 0 && <details><summary>{t('net.recentRejections')}</summary><ul>{room.recentRejections.map((r, i) => <li key={i}><code>{r}</code></li>)}</ul></details>}
   </div>)}
   <h4>{t('net.client')}</h4>
   {client ? <dl data-testid="multiplayer-client" data-status={client.status}>
    <dt>{t('net.status')}</dt><dd>{client.status}{client.error ? ` · ${client.error}` : ''}</dd>
    <dt>{t('net.session')}</dt><dd>{client.sessionId || '—'}</dd>
    <dt>{t('net.ping')}</dt><dd>{client.ping === null ? '—' : `${client.ping} ms`} · {t('net.pending')}: {client.pending}</dd>
    <dt>{t('net.players')}</dt><dd>{client.players.map(p => `${p.name}${p.local ? ' (you)' : ''}`).join(', ') || '—'}</dd>
   </dl> : <p className="panel-empty">{t('net.noClient')}</p>}
  </section>;
 }
 return {MultiplayerSettingsView, MultiplayerPanel,NetworkEntityInspector};
}
