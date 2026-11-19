import { create } from 'zustand';
import type { Theme } from './themes';
interface UiState {
 /** Primary selection: the Inspector subject and transform-handle owner. Always the last entry of `selection`. */
 selected:string|null;
 selection:readonly string[];
 /** Editor-only view state (not saved, no history, ignored by Preview and export). */
 hidden:ReadonlySet<string>; locked:ReadonlySet<string>;
 panel:string|null; theme:string; resolvedTheme:string; customThemes:Theme[]; title:string; dirty:boolean; busy:boolean; mode:'edit'|'playing'|'paused'; notice:string;
 /** The Hub (start screen) covers the editor. */
 hub:boolean; set(value:Partial<Omit<UiState,'set'>>):void
}
let theme = 'graphite'; try { theme = localStorage.getItem('rewrite:theme') ?? theme; } catch { /* ephemeral session */ }
export const useUi = create<UiState>(set => ({ selected:null,selection:[],hidden:new Set(),locked:new Set(),panel:null,theme,resolvedTheme:'graphite',customThemes:[],title:'Untitled scene',dirty:false,busy:false,mode:'edit',notice:'',hub:false,set }));
export const notify = (error: unknown) => useUi.getState().set({ notice:String(error) });
export function select(id: string|null, mode:'replace'|'toggle'='replace') {
 const state=useUi.getState();
 if(mode==='toggle'&&id){const has=state.selection.includes(id),selection=has?state.selection.filter(x=>x!==id):[...state.selection,id];state.set({selection,selected:selection.at(-1)??null});return;}
 state.set({selected:id,selection:id?[id]:[]});
}
export function selectMany(ids: readonly string[], additive=false) {
 const state=useUi.getState(),selection=additive?[...state.selection.filter(id=>!ids.includes(id)),...ids]:[...ids];
 state.set({selection,selected:selection.at(-1)??null});
}
/** Keeps only existing objects; the primary falls back to the last remaining one. */
export function pruneSelection(exists:(id:string)=>boolean) {
 const state=useUi.getState(),selection=state.selection.filter(exists);
 if(selection.length===state.selection.length&&(state.selected===null||exists(state.selected)))return;
 state.set({selection,selected:state.selected&&exists(state.selected)?state.selected:selection.at(-1)??null});
}
export function toggleFlag(kind:'hidden'|'locked', ids: readonly string[]) {
 const state=useUi.getState(),next=new Set(state[kind]),on=!ids.every(id=>next.has(id));
 for(const id of ids){if(on)next.add(id);else next.delete(id);}
 state.set({[kind]:next});
}
