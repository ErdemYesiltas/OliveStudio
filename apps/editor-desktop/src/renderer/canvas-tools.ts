/** Presentation groups only: every installed panel remains reachable, including future plugins. */
export const toolGroups=['scene','motion','audio','build','automate'] as const;
export type ToolGroup=typeof toolGroups[number];
const roles:Record<Exclude<ToolGroup,'scene'>,readonly string[]>={
 motion:['animation','sparkles','effects','bone','shader'],
 audio:['audio','mixer'],
 build:['export','git','trophy','profiler','quality','package'],
 automate:['assistant','generate','jobs','skills','script','logic','input','globals','activity','workflow','gamepad'],
};
export function toolGroup(icon:string):ToolGroup{return (Object.entries(roles).find(([,icons])=>icons.includes(icon))?.[0] as ToolGroup|undefined)??'scene';}
export function filterTools<T extends {id:string;title:string;icon:string}>(entries:readonly T[],query:string,group:ToolGroup){const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);return entries.filter(e=>words.length?words.every(word=>(e.title+' '+e.id).toLocaleLowerCase().includes(word)):toolGroup(e.icon)===group);}
