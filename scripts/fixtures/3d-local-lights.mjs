// QA project for point and spot lights. Usage: 3d-local-lights.mjs <outDir> point|spot webgl|webgpu
// A dark scene (sun off, faint ambient) with a ground and three cubes. point: a warm bulb with range 6 at the centre;
// spot: a shadow-casting cone aimed down from above-front (cone 25°, soft edge 0.3), so the cubes shadow the floor inside it.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const [out,mode='point',renderer='webgl']=[resolve(process.argv[2]??'outputs/local-lights3d-qa/point-webgl'),process.argv[3],process.argv[4]];await mkdir(out,{recursive:true});
if(!['point','spot'].includes(mode))throw Error('Mode must be point or spot');
const euler=(x,y,z)=>{const h=Math.PI/360,sx=Math.sin(x*h),cx=Math.cos(x*h),sy=Math.sin(y*h),cy=Math.cos(y*h),sz=Math.sin(z*h),cz=Math.cos(z*h);return{qx:sx*cy*cz+cx*sy*sz,qy:cx*sy*cz-sx*cy*sz,qz:cx*cy*sz+sx*sy*cz,qw:cx*cy*cz-sx*sy*sz};};
const template=JSON.parse(await readFile('outputs/uv-alpha3d-qa/3D UV Alpha QA.pixieditor','utf8')),scene=template.scenes[0],view=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.viewport'));
const t3=(x,y,z,q,s=[1,1,1])=>({id:randomUUID(),type:'scene3d.transform',version:1,data:{x,y,z,...q,scaleX:s[0],scaleY:s[1],scaleZ:s[2]}});
const entity=(name,components)=>({id:randomUUID(),name,parentId:view.id,active:true,spatial:'scene3d.transform',components});
const prim=(shape,color)=>({id:randomUUID(),type:'pixi3d.primitive',version:1,data:{shape,color,roughness:.7,metallic:0,castShadow:true,receiveShadow:true,emissiveColor:'#000000',emissiveStrength:0}});
const light=data=>({id:randomUUID(),type:'pixi3d.light',version:1,data:{color:'#ffffff',intensity:1,castShadow:false,range:10,radius:.1,coneAngle:30,penumbra:.2,...data}});
const camera=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.camera'));camera.components.find(c=>c.type==='scene3d.transform').data={x:0,y:6,z:10,...euler(-30,0,0),scaleX:1,scaleY:1,scaleZ:1};
for(const e of scene.entities)for(const c of e.components)if(c.type==='pixi3d.light')Object.assign(c.data,c.data.kind==='ambient'?{intensity:.08}:{intensity:0,castShadow:false});
scene.entities=scene.entities.filter(e=>!e.components.some(c=>['pixi3d.modelRenderer','pixi3d.primitive'].includes(c.type)));
scene.entities.push(entity('Ground',[t3(0,-.5,0,euler(-90,0,0),[24,24,1]),prim('plane','#d9d2c3')]));
for(const [x,z] of [[-2,0],[0,-1.5],[2,0]])scene.entities.push(entity('Cube',[t3(x,0,z,euler(0,20,0),[.8,1,.8]),prim('cube','#8fb0d6')]));
if(mode==='point')scene.entities.push(entity('Bulb',[t3(0,1.2,1.2,euler(0,0,0)),light({kind:'point',color:'#ffc27a',intensity:30,range:6,radius:.2})]));
else scene.entities.push(entity('Spot',[t3(0,6,3,euler(-65,0,0)),light({kind:'spot',color:'#ffffff',intensity:120,range:20,radius:.1,coneAngle:25,penumbra:.3,castShadow:true,shadowBias:.001})]));
template.name=`3D Local Lights QA ${mode} ${renderer}`;template.extensions={'pixi.render':{version:1,renderer},'assets.registry':{version:1,items:[]}};
const file=join(out,'3D Local Lights QA.pixieditor');await writeFile(file,JSON.stringify(template,null,2)+'\n');await mkdir(file+'.assets/sources',{recursive:true});
console.log(JSON.stringify({file,sha:createHash('sha256').update(await readFile(file)).digest('hex')}));
