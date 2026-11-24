import {ProductionRuntime} from '@rewrite/production-tools/runtime';
import {sections,WorldSchema} from '@rewrite/production-tools/contracts';
import type {PlayerPlugin} from '../plugin';
export default {id:'production',create(c){
 const runtime=new ProductionRuntime(()=>c.bundle.project,name=>Boolean((c.services.get('input') as {snapshot():Record<string,unknown>}|undefined)?.snapshot()[name]));
 const gates=()=>WorldSchema.parse(c.bundle.project.extensions[sections.world]??{version:1,rooms:[],portals:[]}).portals;
 return{systems:scene=>{const system=runtime.system(scene.id,c.entities,c.changeScene);const before=[...(c.bundle.runtimes.includes('matter')?['physics']:[]),...(c.bundle.runtimes.includes('scripts')?['scripts']:[])];return[{...system,before}];},listens:(type,id)=>type==='pointer.click'&&gates().some(g=>g.mode==='click'&&g.fromEntity===id),interaction:event=>{if(event.type==='pointer.click')for(const g of gates())if(g.mode==='click'&&g.fromEntity===event.sourceId)runtime.enter(g.id);},dispose(){}};
}} satisfies PlayerPlugin;
