// Derived QA project: the UV/alpha project plus a tween.player rotating the UV quad 0→90° about Z by slerp,
// and a scalar 2D track moving the 3D View boundary (scene.transform2d.x 160→240) to cover the unchanged 2D path.
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const from=resolve('outputs/uv-alpha3d-qa'),out=resolve(process.argv[2]??'outputs/tween-rotation3d-qa'),fixture=JSON.parse(await readFile(join(from,'fixture.json'),'utf8'));await mkdir(out,{recursive:true});
const project=JSON.parse(await readFile(fixture.file,'utf8')),scene=project.scenes[0],quad=scene.entities.find(e=>e.id===fixture.layout.uv.entityId),t3=quad.components.find(c=>c.type==='scene3d.transform');
const view=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.viewport')),t2=view.components.find(c=>c.type==='scene.transform2d');project.name='3D Rotation Tween QA';scene.name='Transform3D rotation tween';const h=Math.PI/4;
quad.components.push({id:crypto.randomUUID(),type:'tween.player',version:1,data:{duration:1.5,delay:0,ease:'linear',repeat:0,yoyo:false,autoplay:true,tracks:[{id:'r',entityId:quad.id,componentId:t3.id,property:'rotation',from:[0,0,0,1],to:[0,0,Math.sin(h),Math.cos(h)]},{id:'vx',entityId:view.id,componentId:t2.id,property:'x',from:160,to:240}]}});
const file=join(out,'3D Rotation Tween QA.pixieditor');await cp(fixture.file+'.assets',file+'.assets',{recursive:true});await writeFile(file,JSON.stringify(project,null,2)+'\n');
const sourceHash=createHash('sha256').update(await readFile(file)).digest('hex');await writeFile(join(out,'fixture.json'),JSON.stringify({file,sourceHash,entityId:quad.id,expected:{viewX:[160,240],euler:{from:[0,0,0],to:[0,0,90]},quadrantsAfter:{topLeft:'green',topRight:'yellow',bottomLeft:'red',bottomRight:'blue'}}},null,2)+'\n');console.log(JSON.stringify({file,sourceHash}));
