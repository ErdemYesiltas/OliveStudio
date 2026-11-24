import {it,expect,vi} from 'vitest';
import {AbstractRenderer,Container,GlobalResourceRegistry,type Application} from 'pixi.js';
import {destroyLocalApplication} from './lifecycle';

it('destroys a local renderer without releasing another renderer’s global resources',()=>{
 // Exercise Pixi's real renderer teardown. Boolean true used here before the fix
 // calls GlobalResourceRegistry.release(), invalidating the other live renderer.
 const shared={clear:vi.fn()},localDestroy=vi.fn();GlobalResourceRegistry.register(shared);
 const renderer=Object.create(AbstractRenderer.prototype) as Application['renderer'];
 Object.assign(renderer,{runners:{destroy:{items:[],emit:localDestroy,destroy:vi.fn()}},removeAllListeners:vi.fn()});
 const stage=new Container(),child=new Container();stage.addChild(child);
 const application={renderer:renderer as Application['renderer'],destroy(options:Parameters<Application['destroy']>[0],children:Parameters<Application['destroy']>[1]){stage.destroy(children);renderer.destroy(options);this.renderer=null as unknown as Application['renderer'];}};
 try{destroyLocalApplication(application);expect(localDestroy).toHaveBeenCalledWith({removeView:true,releaseGlobalResources:false});expect(stage.destroyed).toBe(true);expect(child.destroyed).toBe(true);expect(shared.clear).not.toHaveBeenCalled();destroyLocalApplication(application);expect(localDestroy).toHaveBeenCalledTimes(1);}finally{GlobalResourceRegistry.unregister(shared);}
});
