import {expect,it} from 'vitest';
import {qaApprovable} from './automation-bridge';
it('lets QA mode approve only requests that replace the open project',()=>{
 expect(['project.open','project.new','hub.create_example'].every(qaApprovable)).toBe(true);
 expect(['project.save','build.export','recovery.remove','git.commit','assets.import_files'].some(qaApprovable)).toBe(false);
});
