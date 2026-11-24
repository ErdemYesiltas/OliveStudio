import type {ToolSpec} from '@rewrite/ai-lm/contracts';
export interface CatalogTool {name:string;description:string;inputSchema:Record<string,unknown>}
/** Keep a portable (<64) function surface. Every module tool remains reachable through discovery + execute. */
const gateway=new Set(['automation.capabilities','automation.describe_tool','automation.execute','automation.execute_batch','automation.jobs','automation.job','automation.cancel','project.get_state','project.file_access','project.list_files','scene.list_objects','scene.get_object','scene.get_component','scene.describe_components','soundlab.presets','soundlab.preset','soundlab.create','project.save','build.targets','build.export']);
export function assistantCatalog(catalog:readonly CatalogTool[]):ToolSpec[]{
 const selected=catalog.filter(t=>!t.name.includes('.')||gateway.has(t.name));
 if(selected.length>64)throw Error('Assistant gateway exceeds the provider tool limit');
 const names=new Set<string>();return selected.map(t=>{const name=t.name.replaceAll('.','__');if(names.has(name))throw Error('Ambiguous assistant tool alias: '+name);names.add(name);return{type:'function',function:{name,description:t.description,parameters:t.inputSchema}};});
}
export function assistantToolName(catalog:readonly CatalogTool[],alias:string){return catalog.find(t=>t.name.replaceAll('.','__')===alias)?.name??alias;}
