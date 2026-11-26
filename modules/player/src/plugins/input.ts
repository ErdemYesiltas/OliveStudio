import {connectGameInput,InputMapSchema,defaultInputMap,inputSection} from '@rewrite/input';
import type {PlayerPlugin} from '../plugin';

export default {id:'input',create(c){
 const map=InputMapSchema.parse(c.bundle.project.extensions[inputSection]??defaultInputMap);
 let input:ReturnType<typeof connectGameInput>|undefined;
 return {
  unlock(){
   if(input)return;
   input=connectGameInput(map,{target:document.documentElement,emit:c.emit,globals:c.globals,report:error=>c.report(String(error))});
   c.services.set('input',input.session);
  },
  systems:()=>input?[input.system]:[],
  dispose(){c.services.delete('input');input?.detach();input=undefined;},
 };
}} satisfies PlayerPlugin;
