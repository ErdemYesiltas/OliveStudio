import {it,expect} from 'vitest';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {shapeDefinition,spriteDefinition,textDefinition,bitmapTextDefinition,cameraDefinition,screenSpaceDefinition} from '../../render-pixi/src/index';
import {objectDefinitions} from '../../render-pixi/src/objects';
import {rigidBodyDefinition,boxColliderDefinition,circleColliderDefinition,capsuleColliderDefinition,polygonColliderDefinition,jointDefinition} from '../../physics/src/index';
import {identity3D,makeViewport3D,transform3dDefinition,viewport3dDefinition} from './index';
it('rejects real 2D visuals, camera and Matter contracts on a 3D entity before any runtime can consume them',()=>{
 const twoD=[shapeDefinition,spriteDefinition,textDefinition,bitmapTextDefinition,cameraDefinition,screenSpaceDefinition,...objectDefinitions,rigidBodyDefinition,boxColliderDefinition,circleColliderDefinition,capsuleColliderDefinition,polygonColliderDefinition,jointDefinition];
 const definitions=new Map([...twoD,transformDefinition,transform3dDefinition,viewport3dDefinition].map(d=>[d.type,d]));
 const scene=new SceneService(()=>definitions),view=makeViewport3D();scene.document.transact('View',s=>{s.entities.push(view);});const id=scene.createSpatial('Mesh','scene3d.transform',view.id,identity3D()),before=JSON.stringify(scene.document.current);
 for(const def of twoD){expect(()=>scene.addComponent(id,def.type),def.type).toThrow('does not support spatial space');expect(JSON.stringify(scene.document.current)).toBe(before);}
});
