import {AchievementSession,type AchievementHost} from './index';
import type {RuntimeSystem} from '@rewrite/sdk';

/** A short "Achievement unlocked" card over the game (DOM; stacks, fades after a few seconds). */
export function createAchievementToasts(host: HTMLElement) {
 const doc = host.ownerDocument;
 if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
 const stack = doc.createElement('div');
 stack.dataset.achievementToasts = 'true'; stack.setAttribute('aria-live', 'polite');
 stack.style.cssText = 'position:absolute;top:12px;right:12px;z-index:31;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:min(320px,80%)';
 host.appendChild(stack);
 const timers = new Set<ReturnType<typeof setTimeout>>();
 return {
  show(title: string, name: string, description: string) {
   const card = doc.createElement('div');
   card.setAttribute('role', 'status'); card.dataset.achievementToast = name;
   card.style.cssText = 'background:rgba(10,14,24,.9);border:1px solid rgba(255,210,122,.6);border-radius:10px;padding:10px 12px;color:#f3f6fb;font:13px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4);transition:opacity .4s';
   const head = doc.createElement('div'); head.textContent = `🏆 ${title}`; head.style.cssText = 'font-size:11px;letter-spacing:.05em;color:#ffd27a;text-transform:uppercase';
   const body = doc.createElement('strong'); body.textContent = name;
   card.append(head, body);
   if (description) { const d = doc.createElement('div'); d.textContent = description; d.style.opacity = '.8'; card.append(d); }
   stack.appendChild(card);
   const fade = setTimeout(() => { card.style.opacity = '0'; const gone = setTimeout(() => { card.remove(); timers.delete(gone); }, 450); timers.add(gone); timers.delete(fade); }, 3500);
   timers.add(fade);
  },
  dispose() { for (const t of timers) clearTimeout(t); timers.clear(); stack.remove(); },
 };
}

/** Keep persistent progress in the host's storage and own transient toasts per scene. */
export function createSceneAchievements(host:Omit<AchievementHost,'unlocked'>,target?:HTMLElement,title=()=> 'Achievement unlocked'){
 let toasts:ReturnType<typeof createAchievementToasts>|undefined;
 const session=new AchievementSession({...host,unlocked:achievement=>{
  if(!target)return;
  toasts??=createAchievementToasts(target);
  toasts.show(title(),achievement.name,achievement.description);
 }});
 const system:RuntimeSystem={...session.system,dispose(){toasts?.dispose();toasts=undefined;}};
 return {session,system};
}
