export const workspacePresets=['studio','canvas','designer','animator','developer'] as const;
export type WorkspacePreset=typeof workspacePresets[number];
type Placement={id:string;side:'left'|'right'|'below';tabWith?:string;edge?:boolean};
/** Match installed contributions by presentation role; no feature imports or hardcoded module IDs. */
export function presetPanels(entries:readonly {id:string;value:{icon:string}}[],preset:WorkspacePreset):Placement[]{
 if(preset==='studio'){
  const find=(role:string)=>entries.find(e=>e.value.icon===role)?.id;
  const group=(roles:readonly string[],side:Placement['side'])=>{
   const ids=roles.flatMap(role=>{const id=find(role);return id?[id]:[];});
   return ids.map((id,index):Placement=>index?{id,side,tabWith:ids[0]}:{id,side});
  };
  const inspector=find('properties');
  return [...group(['library','prefab','console'],'below'),...group(['layers','scenes'],'left'),...(inspector?[{id:inspector,side:'right' as const,edge:true}]:[])];
 }
 const roles={canvas:[],designer:[['layers','left'],['properties','right'],['library','below']],animator:[['layers','left'],['properties','right'],['animation','below']],developer:[['scenes','left'],['properties','right'],['script','below']]} as const;
 return roles[preset].flatMap(([icon,side])=>{const entry=entries.find(e=>e.value.icon===icon);return entry?[{id:entry.id,side}]:[];});
}
