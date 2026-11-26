import { movementAxes, type NetStatus } from '@rewrite/multiplayer/contracts';
import { scriptConsole } from '@rewrite/scripts/console';
import type { MultiplayerSession } from '@rewrite/multiplayer-colyseus/client';
import type { InputMap } from '@rewrite/input';
import type { NetworkPlan } from './networkModel';
import type { SceneObject } from './scene';
import type { PreviewInput } from './input';

type Host = {
  spawn(template: SceneObject, x: number, y: number): string;
  destroy(id: string): void;
  visible(id: string, visible: boolean): void;
  place(id: string, x: number, y: number): void;
  changed(): void;
};

export class SceneMultiplayer {
  private session?: MultiplayerSession;
  private stopSession?: () => void;
  private status?: NetStatus;
  private publish?: (status: NetStatus | undefined) => void;
  private last = -Infinity;
  get active() { return !!this.session; }
  get localObject() { return this.status?.players.find(player => player.local)?.objectId; }

  start(plan: NetworkPlan, endpoint: string, name: string, map: InputMap, input: PreviewInput,
    host: Host, publish: (status: NetStatus | undefined) => void) {
    this.stop();
    const { settings, rules, template } = plan;
    if (!settings.enabled || !rules || !template) return () => {};
    let canceled = false;
    const stop = () => {
      canceled = true;
      this.session?.dispose();
      this.session = undefined;
      this.status = undefined;
      this.stopSession = undefined;
      this.publish = undefined;
      this.last = -Infinity;
      host.visible(template.node.id, template.node.visible);
      publish(undefined);
    };
    this.stopSession = stop;
    this.publish = publish;
    const connecting: NetStatus = {
      status: 'connecting', endpoint, room: settings.room, roomId: '', sessionId: '', error: '', players: [], pending: 0, rejected: 0, ping: null,
    };
    publish(connecting);
    void import('@rewrite/multiplayer-colyseus/client').then(({ MultiplayerSession }) => {
      if (canceled) return;
      const names = new Map(map.actions.map(action => [action.id, action.name]));
      this.session = new MultiplayerSession(settings, { speed: rules.speed, bounds: rules.bounds },
        { id: template.node.id, name: template.node.label }, endpoint, {
          spawn: (_templateId, x, y) => host.spawn(template.node, x, y),
          destroy: host.destroy,
          setActive: host.visible,
          place: host.place,
          axes: () => movementAxes(template.player, map, { has: id => input.snapshot()[names.get(id) ?? ''] === true }),
          now: () => performance.now(),
          emit: () => {},
          log: scriptConsole.log,
        }, name);
      host.changed();
      this.session.system.start?.();
    }).catch(error => {
      if (!canceled) publish({ ...connecting, status: 'error', error: error instanceof Error ? error.message : String(error) });
    });
    return () => { if (this.stopSession === stop) this.stop(); };
  }

  tick(dt: number) {
    if (!this.session) return;
    this.session.system.update?.(dt);
    const now = performance.now();
    if (now - this.last < 100) return;
    this.last = now;
    const status = this.session.status();
    if (JSON.stringify(status) !== JSON.stringify(this.status)) {
      this.status = status;
      this.publish?.(status);
    }
  }

  stop() { this.stopSession?.(); }
}
