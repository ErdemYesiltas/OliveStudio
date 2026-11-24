import {it,expect} from 'vitest';
import {ModuleHost} from '@rewrite/kernel';
import {panels} from '@rewrite/sdk';
import {createPixi3dLabModule} from './index';
it('activates independently and contributes a discoverable panel with the required module namespace',async()=>{
 const host=new ModuleHost();try{await host.start([createPixi3dLabModule()]);expect(host.diagnostics).toEqual([]);expect(host.states.get('pixi3d-lab')).toBe('active');expect(host.entries(panels).map(p=>p.id)).toEqual(['pixi3d-lab.preview']);}finally{await host.stop();}
 expect(host.entries(panels)).toEqual([]);
});
