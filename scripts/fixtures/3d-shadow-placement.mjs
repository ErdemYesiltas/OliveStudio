// QA project for directional shadow placement. Usage: 3d-shadow-placement.mjs <outDir> fit|cascades|bounds|acne webgl|webgpu
// A long scene: an 80×80 ground and thin poles running 60 units away from a low camera. fit spreads one map over every
// caster (soft near shadows); cascades keep near shadows sharp; bounds shadows only the poles inside a 16-unit box;
// acne turns both biases off.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const [out,mode='fit',renderer='webgl']=[resolve(process.argv[2]??'outputs/shadow-placement3d-qa/fit-webgl'),process.argv[3],process.argv[4]];await mkdir(out,{recursive:true});
if(!['fit','cascades','bounds','acne'].includes(mode))throw Error('Mode must be fit, cascades, bounds or acne');
const euler=(x,y,z)=>{const h=Math.PI/360,sx=Math.sin(x*h),cx=Math.cos(x*h),sy=Math.sin(y*h),cy=Math.cos(y*h),sz=Math.sin(z*h),cz=Math.cos(z*h);return{qx:sx*cy*cz+cx*sy*sz,qy:cx*sy*cz-sx*cy*sz,qz:cx*cy*sz+sx*sy*cz,qw:cx*cy*cz-sx*sy*sz};};
const template=JSON.parse(await readFile('outputs/uv-alpha3d-qa/3D UV Alpha QA.pixieditor','utf8')),scene=template.scenes[0],view=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.viewport'));
const t3=(x,y,z,q,s=[1,1,1])=>({id:randomUUID(),type:'scene3d.transform',version:1,data:{x,y,z,...q,scaleX:s[0],scaleY:s[1],scaleZ:s[2]}});
const entity=(name,components)=>({id:randomUUID(),name,parentId:view.id,active:true,spatial:'scene3d.transform',components});
const prim=(shape,color)=>({id:randomUUID(),type:'pixi3d.primitive',version:1,data:{shape,color,roughness:.8,metallic:0,castShadow:true,receiveShadow:true,emissiveColor:'#000000',emissiveStrength:0}});
const camera=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.camera'));camera.components.find(c=>c.type==='scene3d.transform').data={x:0,y:2,z:9,...euler(-12,0,0),scaleX:1,scaleY:1,scaleZ:1};
const cam=camera.components.find(c=>c.type==='pixi3d.camera');if(cam)cam.data.far=200;
const sun=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.light'&&c.data.kind==='directional'));Object.assign(sun.components.find(c=>c.type==='scene3d.transform').data,euler(-40,35,0));
Object.assign(sun.components.find(c=>c.type==='pixi3d.light').data,{castShadow:true,shadowPlacement:mode==='acne'?'fit':mode,shadowCascades:3,shadowMaxDistance:60,shadowLambda:.7,shadowBoundsX:0,shadowBoundsY:0,shadowBoundsZ:0,shadowBoundsWidth:16,shadowBoundsHeight:8,shadowBoundsDepth:16,
 shadowBias:mode==='acne'?0:.001,shadowNormalBiasAuto:mode!=='acne',shadowNormalBias:0,shadowUpdate:1});
scene.entities=scene.entities.filter(e=>!e.components.some(c=>['pixi3d.modelRenderer','pixi3d.primitive'].includes(c.type)));
scene.entities.push(entity('Ground',[t3(0,-1,-30,euler(-90,0,0),[80,80,1]),prim('plane','#d9d2c3')]));
for(let i=0;i<14;i++)scene.entities.push(entity('Pole '+i,[t3(i%2?1.6:-1.6,0,4-i*5,euler(0,0,0),[.15,2,.15]),prim('cube','#5a8fd6')]));
template.name=`3D Shadow Placement QA ${mode} ${renderer}`;template.extensions={'pixi.render':{version:1,renderer},'assets.registry':{version:1,items:[]}};
const viewport=view.components.find(c=>c.type==='pixi3d.viewport').data;Object.assign(viewport,{shadowQuality:'medium',shadowFilter:'pcf'});
const file=join(out,'3D Shadow Placement QA.pixieditor');await writeFile(file,JSON.stringify(template,null,2)+'\n');await mkdir(file+'.assets/sources',{recursive:true});
console.log(JSON.stringify({file,sha:createHash('sha256').update(await readFile(file)).digest('hex')}));
