import {AchievementSession, achievementActions, achievementsSection, readAchievements, storageStore} from '@rewrite/achievements';
import {createAchievementToasts} from '@rewrite/achievements/toast';
import type {PlayerPlugin} from '../plugin';
/** Achievements and leaderboards for exported games: progress in this browser's storage, toasts, rules and scripts. */
export default {id: 'achievements', create(c) {
 const library = () => readAchievements(c.bundle.project.extensions[achievementsSection]);
 const store = storageStore(`olive:achievements:${c.bundle.project.name}`, typeof localStorage === 'undefined' ? undefined : localStorage);
 const toasts = c.host ? createAchievementToasts(c.host) : undefined;
 let session: AchievementSession | undefined;
 return {
  systems() {
   session = new AchievementSession({library, store, globals: () => c.globals(), emit: e => c.emit(e), silent: () => false, unlocked: a => toasts?.show('Achievement unlocked', a.name, a.description)});
   c.services.set('achievements', session);
   return [session.system];
  },
  actions: achievementActions(library, () => session),
  clear() { session = undefined; c.services.delete('achievements'); },
  dispose() { toasts?.dispose(); },
 };
}} satisfies PlayerPlugin;
