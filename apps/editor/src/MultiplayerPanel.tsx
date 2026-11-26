import type { MultiplayerSettings, NetStatus, ServerStatus } from '@rewrite/multiplayer/contracts';
import { Network, Play, Plus, Square, Unplug } from 'lucide-react';
import { IconButton, PanelHeader } from './chrome';
import { Numeric } from './Inspector';
import { t } from './i18n';
import type { NetworkPlan } from './networkModel';

const numericFields = [
  ['maxPlayers', 1, 16], ['tickRate', 10, 60], ['reconnectSeconds', 0, 120], ['interpolationMs', 0, 500],
] as const;

export function MultiplayerPanel({ plan, editable, server, client, error, busy, canSetup, change, setup, action }: {
  plan: NetworkPlan; editable: boolean; server?: ServerStatus; client?: NetStatus; error: string;
  busy: boolean; canSetup: boolean;
  change: (patch: Partial<MultiplayerSettings>) => void; setup: () => void;
  action: (type: 'start' | 'stop' | 'client' | 'latency' | 'drop', value?: number | string) => void;
}) {
  const ready = !!plan.rules && !busy;
  const { settings } = plan;
  return <section className="panel" aria-label={t('networkPanel')}>
    <PanelHeader icon={Network} label={t('networkPanel')} description={t('networkPanelHint')}>
      <IconButton icon={Play} label={t('networkServerStart')} disabled={!ready || !!server?.running} onClick={() => action('start')} />
      <IconButton icon={Square} label={t('networkServerStop')} disabled={busy || !server?.running} onClick={() => action('stop')} />
      <IconButton icon={Plus} label={t('networkTestClient')} disabled={!ready} onClick={() => action('client')} />
    </PanelHeader>
    <div className="panel-body network-body">
      <fieldset className="network-fields" disabled={!editable || !!server?.running || busy}>
        <label className="physics-field"><span>{t('networkEnabled')}</span>
          <input type="checkbox" checked={settings.enabled} onChange={event => change({ enabled: event.target.checked })} />
        </label>
        <label className="physics-field"><span>{t('networkRoom')}</span><input key={settings.room} defaultValue={settings.room} maxLength={32}
          onBlur={event => change({ room: event.target.value.trim() })} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
        <label className="physics-field"><span>{t('networkEndpoint')}</span><input key={settings.endpoint} defaultValue={settings.endpoint}
          placeholder="wss://game.example.com" maxLength={200} onBlur={event => change({ endpoint: event.target.value.trim() })}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
        {numericFields.map(([field, min, max]) => <label className="physics-field" key={field}><span>{t(`network_${field}`)}</span>
          <Numeric label={t(`network_${field}`)} value={settings[field]} min={min} max={max} step={1} commit={value => change({ [field]: value })} />
        </label>)}
        <div className="network-template"><span>{plan.template?.node.label ?? t('networkChooseTemplate')}</span>
          <button type="button" disabled={!canSetup} onClick={setup}>{t('networkSetup')}</button></div>
      </fieldset>
      {(error || server?.error || plan.problems.length > 0) && <ul className="physics-errors" role="alert">
        {[...new Set([error, server?.error, ...plan.problems].filter(Boolean))].map(item => <li key={item}>{item}</li>)}
      </ul>}
      <section aria-label={t('networkDiagnostics')} className="network-diagnostics">
        <output>{server?.running ? server.endpoint : t('networkOffline')}</output>
        {client && <div className="network-client-status">
          <strong>{t(`networkStatus_${client.status}`)}</strong>
          {client.sessionId && <code>{client.sessionId}</code>}
          {client.ping !== null && <span>{t('networkPing', { ms: client.ping })}</span>}
          {client.error && <span className="physics-errors">{client.error}</span>}
        </div>}
        {server?.running && <label className="physics-field"><span>{t('networkLatency')}</span>
          <Numeric label={t('networkLatency')} value={server.latencyMs} min={0} max={2000} step={1}
            disabled={busy} commit={ms => action('latency', ms)} /></label>}
        {server?.rooms.map(room => <section key={room.roomId} aria-label={t('networkRoomLabel', { room: room.name })} className="network-room">
          <strong>{t('networkRoomStatus', { name: room.name, players: room.clients, max: room.maxClients })}</strong>
          <table>
            <thead><tr><th scope="col">{t('networkPlayer')}</th><th scope="col">X</th><th scope="col">Y</th><th scope="col">{t('networkConnection')}</th></tr></thead>
            <tbody>{room.players.map(player => <tr key={player.sessionId} data-player={player.sessionId}>
              <th scope="row">{player.name}</th><td>{player.x}</td><td>{player.y}</td>
              <td>{t(player.connected ? 'networkStatus_connected' : 'networkStatus_reconnecting')}
                <IconButton icon={Unplug} label={t('networkDrop', { name: player.name })} disabled={!player.connected || busy}
                  onClick={() => action('drop', player.sessionId)} /></td>
            </tr>)}</tbody>
          </table>
        </section>)}
      </section>
    </div>
  </section>;
}
