export const workspacePresets=['canvas','designer','animator','developer'] as const;
export type WorkspacePreset=typeof workspacePresets[number];
/** Match installed contributions by presentation role; no feature imports or hardcoded module IDs. */
export function presetPanels(entries:readonly {id:string;value:{icon:string}}[],preset:WorkspacePreset):{id:string;side:'left'|'right'|'below'}[]{
 const roles:Record<WorkspacePreset,readonly [string,'left'|'right'|'below'][]>= {canvas:[],designer:[['layers','left'],['properties','right'],['library','below']],animator:[['layers','left'],['properties','right'],['animation','below']],developer:[['scenes','left'],['properties','right'],['script','below']]};
 return roles[preset].flatMap(([icon,side])=>{const entry=entries.find(e=>e.value.icon===icon);return entry?[{id:entry.id,side}]:[];});
}
