import {it,expect} from 'vitest';
import {Camera3D,Container3D,View3D,Mesh3D,CubeGeometry,Material3D} from '@pixi/3d';
import {EditorCameraMemory,EditorCameraCommandSchema,frameNode} from './editor-camera';
const checkpoint=()=>({position:{x:8,y:3,z:9},target:{x:1,y:2,z:3},zoom:1.5,sceneCamera:true});
it('keeps independent snapshots across temporary scenes without retaining mutable objects or unbounded history',()=>{
 const memory=new EditorCameraMemory(2),original=checkpoint();memory.set('original-view',original);original.position.x=999;memory.set('other-scene',checkpoint());
 expect(memory.get('original-view')?.position.x).toBe(8);const copy=memory.get('original-view')!;copy.target.x=99;expect(memory.get('original-view')?.target.x).toBe(1);
 memory.set('original-view',checkpoint());memory.set('third-view',checkpoint());expect(memory.get('other-scene')).toBeUndefined();expect(memory.get('original-view')?.zoom).toBe(1.5);expect(memory.size).toBe(2);memory.clear();expect(memory.size).toBe(0);
});
it('rejects nonfinite, unbounded or coincident camera commands while keeping framing IDs explicit',()=>{
 expect(()=>EditorCameraCommandSchema.parse({viewId:'view',action:'set',position:{x:0,y:0,z:0},target:{x:0,y:0,z:0}})).toThrow();
 expect(()=>EditorCameraCommandSchema.parse({viewId:'view',action:'set',position:{x:Infinity,y:0,z:3},target:{x:0,y:0,z:0}})).toThrow();
 expect(()=>EditorCameraCommandSchema.parse({viewId:'view',action:'set',position:{x:0,y:0,z:3},target:{x:0,y:0,z:0},zoom:0})).toThrow();
 expect(EditorCameraCommandSchema.parse({viewId:'view',action:'frame',entityId:'mesh'})).toEqual({viewId:'view',action:'frame',entityId:'mesh'});
});
it('fits transformed geometry conservatively into narrow and wide perspective cameras',()=>{
 const root=new Container3D(),parent=new Container3D(),geometry=new CubeGeometry(),material=new Material3D(),mesh=new Mesh3D({geometry,material}),camera=new Camera3D({near:.1,far:1000,fov:45});root.addChild(parent);parent.position.set(6,-2,4);parent.scale.set(2,3,.5);parent.rotation.y=.7;parent.addChild(mesh);mesh.position.set(1,2,-1);camera.position.set(9,4,12);
 try{for(const [width,height]of[[1200,500],[300,900]]){const view=new View3D({width,height,autoResize:false});try{const fit=frameNode(mesh,view,camera),expected=mesh.getGlobalPosition();expect(fit.target.x).toBeCloseTo(expected.x,5);expect(fit.target.y).toBeCloseTo(expected.y,5);expect(fit.target.z).toBeCloseTo(expected.z,5);expect(fit.zoom).toBe(1);const distance=Math.hypot(fit.position.x-fit.target.x,fit.position.y-fit.target.y,fit.position.z-fit.target.z);expect(distance).toBeGreaterThan(1);camera.position.set(fit.position.x,fit.position.y,fit.position.z);camera.lookAt(fit.target);view.camera=camera;const corners=mesh.getLocalBounds();for(const x of[corners.min.x,corners.max.x])for(const y of[corners.min.y,corners.max.y])for(const z of[corners.min.z,corners.max.z]){const point=view.worldToScreen(mesh.toGlobal({x,y,z}));expect(point).not.toBeNull();expect(point!.x).toBeGreaterThan(0);expect(point!.x).toBeLessThan(width);expect(point!.y).toBeGreaterThan(0);expect(point!.y).toBeLessThan(height);}}finally{view.destroy();}}}finally{root.destroy({children:true});geometry.destroy();material.destroy();}
});
