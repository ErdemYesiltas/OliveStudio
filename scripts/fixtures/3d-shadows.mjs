// QA project for directional shadows: a ground plane, a cube above it, a high sun. Usage: 3d-shadows.mjs <outDir> on|off webgl|webgpu
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const [out,shadows='on',renderer='webgl']=[resolve(process.argv[2]??'outputs/shadow3d-qa/on-webgl'),process.argv[3],process.argv[4]];await mkdir(out,{recursive:true});
const euler=(x,y,z)=>{const h=Math.PI/360,sx=Math.sin(x*h),cx=Math.cos(x*h),sy=Math.sin(y*h),cy=Math.cos(y*h),sz=Math.sin(z*h),cz=Math.cos(z*h);return{qx:sx*cy*cz+cx*sy*sz,qy:cx*sy*cz-sx*cy*sz,qz:cx*cy*sz+sx*sy*cz,qw:cx*cy*cz-sx*sy*sz};};
const template=JSON.parse(await readFile('outputs/uv-alpha3d-qa/3D UV Alpha QA.pixieditor','utf8')),scene=template.scenes[0],view=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.viewport'));
const t3=(x,y,z,q,s=1)=>({id:randomUUID(),type:'scene3d.transform',version:1,data:{x,y,z,...q,scaleX:s,scaleY:s,scaleZ:s}});
const entity=(name,components)=>({id:randomUUID(),name,parentId:view.id,active:true,spatial:'scene3d.transform',components});
const camera=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.camera'));camera.components.find(c=>c.type==='scene3d.transform').data={x:0,y:3,z:7,...euler(-23.2,0,0),scaleX:1,scaleY:1,scaleZ:1};
const sun=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.light'&&c.data.kind==='directional'));Object.assign(sun.components.find(c=>c.type==='scene3d.transform').data,euler(-62,28,0));sun.components.find(c=>c.type==='pixi3d.light').data.castShadow=shadows==='on';
const prim=(shape,color)=>({id:randomUUID(),type:'pixi3d.primitive',version:1,data:{shape,color,roughness:.8,metallic:0,castShadow:true,receiveShadow:true}});
scene.entities=scene.entities.filter(e=>!e.components.some(c=>c.type==='pixi3d.modelRenderer'));
scene.entities.push(entity('Ground',[t3(0,-1,0,euler(-90,0,0),8),prim('plane','#d9d2c3')]),entity('Cube',[t3(0,.2,0,euler(0,30,0),1.4),prim('cube','#5a8fd6')]));
template.name=`3D Shadows QA ${shadows} ${renderer}`;template.extensions={'pixi.render':{version:1,renderer},'assets.registry':{version:1,items:[]}};
const file=join(out,'3D Shadows QA.pixieditor');await writeFile(file,JSON.stringify(template,null,2)+'\n');await mkdir(file+'.assets/sources',{recursive:true});
console.log(JSON.stringify({file,sha:createHash('sha256').update(await readFile(file)).digest('hex')}));
