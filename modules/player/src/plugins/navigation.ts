import {NavigationSession, navigationActions} from '@rewrite/navigation';
import type {PlayerPlugin} from '../plugin';
/**
 * Pathfinding for exported games: one session per scene (Nav Grid obstacles, Nav Agents walking and following),
 * `navigation.arrived` events, Walk to / Stop rules and the `navigation` service scripts use.
 */
export default {id: 'navigation', create(c) {
 let navigation: NavigationSession | undefined;
 return {
  systems() {
   navigation = new NavigationSession({entities: c.entities, emit: e => c.emit(e), silent: () => false, physics: () => c.services.get('physics') as never});
   c.services.set('navigation', navigation.controls);
   return [navigation.system];
  },
  actions: navigationActions(() => navigation?.controls),
  clear() { navigation = undefined; c.services.delete('navigation'); },
  dispose() { navigation = undefined; },
 };
}} satisfies PlayerPlugin;
