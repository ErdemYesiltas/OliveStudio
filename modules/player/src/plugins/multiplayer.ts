import {networkActions,applyEntity,findNetworkPlayer, movementAxes, readMultiplayer, multiplayerSection, type NetStatus} from '@rewrite/multiplayer/contracts';
import {InputMapSchema, defaultInputMap, inputSection} from '@rewrite/input';
import {MultiplayerSession, gameEndpoint} from '@rewrite/multiplayer-colyseus/client';
import type {PlayerPlugin} from '../plugin';
/**
 * Multiplayer for exported games (Colyseus client): in a scene with the Network Player template, joins the room at
 * the configured endpoint (or the page's host on port 2567), spawns a copy per player, predicts the local one from the
 * input actions and interpolates the rest. The game element's `data-multiplayer` shows the connection for diagnostics.
 * Leaving the scene leaves the room. The server is a separate export; this runtime carries no credentials.
 */
export default {id: 'multiplayer', create(c) {
 const project = c.bundle.project, settings = readMultiplayer(project.extensions[multiplayerSection]), map = InputMapSchema.parse(project.extensions[inputSection] ?? defaultInputMap), pressed = new Set<string>();
 const stage = project.stage ?? {width: 960, height: 540};
 let session: MultiplayerSession | undefined, frames = 0;
 const publish = (status: NetStatus) => { if (c.host) c.host.dataset.multiplayer = JSON.stringify(status); };
 return {
  actions:networkActions(()=>session?((id,event)=>session!.sendEvent(id,event)):undefined),
  interaction(e) { if (e.type === 'input.pressed') pressed.add(e.sourceId); else if (e.type === 'input.released') pressed.delete(e.sourceId); },
  systems(scene) {
   session?.dispose(); session = undefined;
   const found = findNetworkPlayer({scenes: [scene]});
   if (!settings.enabled || !found) return [];
   const name = new URLSearchParams(location.search).get('name') ?? 'Player';
   const current = session = new MultiplayerSession(settings, {speed: found.player.speed, bounds: stage}, {id: found.entity.id, name: found.entity.name}, gameEndpoint(settings, location), {
    replica:patch=>{const e=c.entities().find(e=>e.id===patch.id);if(e)applyEntity(e,patch);},removeReplica:id=>c.destroy(id),
    spawn: (template, x, y) => c.spawnEntity(template, x, y), destroy: id => c.destroy(id), setActive: (id, value) => c.setActive(id, value),
    place: (id, x, y) => { const t = c.entities().find(e => e.id === id)?.components.find(x => x.type === 'scene.transform2d'); if (t) Object.assign(t.data as object, {x, y}); },
    emit: e => c.emit(e), axes: () => movementAxes(found.player, map, pressed), now: () => performance.now(),
    log: (level, message) => console[level === 'info' ? 'log' : level](`[multiplayer] ${message}`),
   }, name);
   return [current.system, {id: 'multiplayer.status', update: () => { if (++frames % 6 === 0) publish(current.status()); }, dispose() {}}];
  },
  clear() { session?.dispose(); session = undefined; },
  dispose() { session?.dispose(); session = undefined; },
 };
}} satisfies PlayerPlugin;
