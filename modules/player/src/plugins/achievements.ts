import {type AchievementSession, achievementActions, achievementsSection, readAchievements, storageStore} from '@rewrite/achievements';
import {createSceneAchievements} from '@rewrite/achievements/toast';
import type {PlayerPlugin} from '../plugin';
/** Achievements and leaderboards for exported games: progress in this browser's storage, toasts, rules and scripts. */
export default {id: 'achievements', create(c) {
 const library = () => readAchievements(c.bundle.project.extensions[achievementsSection]);
 const store = storageStore(`olive:achievements:${c.bundle.project.name}`, typeof localStorage === 'undefined' ? undefined : localStorage);
 let session: AchievementSession | undefined;
 return {
  systems() {
   const runtime=createSceneAchievements({library,store,globals:c.globals,emit:c.emit,silent:()=>c.simulation.paused},c.host);
   session=runtime.session;
   c.services.set('achievements',session);
   return [runtime.system];
  },
  actions: achievementActions(library, () => session),
  clear() { session = undefined; c.services.delete('achievements'); },
  dispose() {},
 };
}} satisfies PlayerPlugin;
