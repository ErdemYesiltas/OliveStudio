import {ProductionRuntime} from '@rewrite/production-tools/runtime';
import type {PlayerPlugin} from '../plugin';
export default {id:'production',create(c){
 const runtime=new ProductionRuntime(()=>c.bundle.project,name=>Boolean((c.services.get('input') as {snapshot():Record<string,unknown>}|undefined)?.snapshot()[name]));
 return{systems:scene=>[runtime.system(scene.id,c.entities,c.changeScene)],listens:(type,id)=>runtime.listens(type,id),interaction:event=>runtime.observe(event),dispose(){}};
}} satisfies PlayerPlugin;
