import {expect,it} from 'vitest';
import {ChatRequestSchema} from '@rewrite/ai-lm/contracts';
import {assistantCatalog,assistantToolName} from './assistant-catalog';
it('keeps a provider-compatible gateway while all installed module tools remain discoverable',()=>{
 const catalog=[...Array.from({length:180},(_,i)=>({name:`feature.item_${i}`,description:'Module capability',inputSchema:{type:'object'}})),...['get_editor_state','add_object','automation.capabilities','automation.execute','automation.describe_tool'].map(name=>({name,description:name,inputSchema:{type:'object'}}))];
 const tools=assistantCatalog(catalog);expect(tools).toHaveLength(5);expect(ChatRequestSchema.safeParse({model:'local',messages:[{role:'user',content:'Edit'}],tools}).success).toBe(true);expect(assistantToolName(catalog,'automation__execute')).toBe('automation.execute');
});
