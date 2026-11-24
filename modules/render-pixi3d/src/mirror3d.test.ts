import {expect,it} from 'vitest';
import {Container} from 'pixi.js';
import {Matrix4,Mesh3D,Quaternion,Vector3} from '@pixi/3d';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import {authoring3dDefinitions} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {runtime3DProblems} from './preflight';
import {mirror3dType,mirrorCameraMatrix,MirrorMaterial,MirrorPass,Mirror3DSchema} from './mirror3d';
const pose=(p:[number,number,number],axis:[number,number,number]=[0,1,0],deg=0,s=1)=>{const q=new Quaternion();q.setFromAxisAngle(new Vector3(...axis),deg*Math.PI/180);return new Matrix4().compose(new Vector3(...p),q,new Vector3(s,s,s));};
const det=(m:Matrix4)=>{const e=m.elements;return e[0]*(e[5]*e[10]-e[6]*e[9])-e[4]*(e[1]*e[10]-e[2]*e[9])+e[8]*(e[1]*e[6]-e[2]*e[5]);};
/** Perspective screen x of a world point for a camera at `world` (camera looks down its −Z). */
const screenX=(world:Matrix4,p:Vector3)=>{const v=p.clone().applyMatrix4(new Matrix4().getInverse(world));return v.x/-v.z;};
it('reflects the viewer in the mirror plane and keeps the camera a rotation (x flipped)',()=>{
 const cam=mirrorCameraMatrix(pose([0,0,0]),pose([1,2,5])),e=cam.elements;
 expect([e[12],e[13],e[14]].map(v=>+v.toFixed(9))).toEqual([1,2,-5]);
 expect(det(cam)).toBeCloseTo(1,5);
 // Looks back out through the mirror (+Z in the world), with right flipped.
 expect([e[8],e[9],e[10]].map(v=>+v.toFixed(9))).toEqual([0,0,-1]);expect([e[0],e[1],e[2]].map(v=>+v.toFixed(9))).toEqual([-1,0,0]);
});
it('sees a point where the viewer sees its reflection, mirrored in screen x, for a turned and moved mirror',()=>{
 const mirror=pose([2,1,-3],[0,1,0],35,1.5),viewer=pose([4,2,4],[1,0.3,0],-12),cam=mirrorCameraMatrix(mirror,viewer);
 // @pixi/3d matrices are Float32.
 expect(det(cam)).toBeCloseTo(1,3);
 const inv=new Matrix4().getInverse(mirror),flip=new Matrix4().set(1,0,0,0,0,1,0,0,0,0,-1,0,0,0,0,1),reflect=new Matrix4().multiplyMatrices(mirror,flip).multiply(inv);
 for(const p of [new Vector3(1,1.5,2),new Vector3(3.2,0.4,-1),new Vector3(-1,2,0.5)]){
  const image=p.clone().applyMatrix4(reflect);expect(screenX(cam,p)).toBeCloseTo(-screenX(viewer,image),4);
 }
});
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function scene(shape:string,extra:Record<string,unknown>={}){const s=new SceneService(defs),editor=new Authoring3D(s,()=>{},()=>null,()=>true,()=>({x:480,y:270})),view=editor.createView().viewId;
 s.document.transact('Mirror',d=>{const cube=d.entities.find(e=>e.name==='Cube')!;const prim=cube.components.find(c=>c.type==='pixi3d.primitive')!;Object.assign(prim.data as object,{shape,...extra});cube.components.push({id:'m',type:mirror3dType,version:1,data:{tint:'#ccddee',resolution:.5}});});
 return{s,view};}
it('draws a plane with Mirror 3D through a mirror material and pass, at the chosen share of the view size',()=>{
 const {s,view}=scene('plane'),host=new Container(),errors:unknown[]=[];
 const p=new Scene3DProjection({node:(id:string)=>id===view?host:undefined,changed(){},report(e:unknown){errors.push(e);}});
 try{p.sync(s.document.current);const slot=p.slots[0],cube=s.document.current.entities.find(e=>e.name==='Cube')!,mesh=slot.nodes.get(cube.id)!.children.find(c=>c instanceof Mesh3D) as Mesh3D;
  expect(errors).toEqual([]);expect(mesh.material).toBeInstanceOf(MirrorMaterial);expect(mesh.castShadow).toBe(false);
  const pass=slot.view.passes.find(x=>x instanceof MirrorPass) as MirrorPass;expect(pass.mirror).toBe(mesh);expect(pass.camera.parent).toBe(mesh);
  expect([pass.texture.width,pass.texture.height]).toEqual([Math.round(slot.view.width*.5),Math.round(slot.view.height*.5)]);
  expect(runtime3DProblems(s.document.current).join()).not.toContain('Mirror');
 }finally{void p.dispose();}
});
it('needs a plane that is not also a portal or a camera screen',()=>{
 expect(Mirror3DSchema.parse({})).toEqual({tint:'#e6ecf0',resolution:1});
 expect(runtime3DProblems(scene('cube').s.document.current).join()).toContain('Mirror 3D needs a plane primitive');
 const portal=scene('plane',{portalExitId:'x'}).s.document.current;expect(runtime3DProblems(portal).join()).toContain("a mirror can't also be a portal");
});
