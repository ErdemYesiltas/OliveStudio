// QA project for fog and bloom: a row of cubes running away from the camera and a glowing sphere. Usage: 3d-postfx.mjs <outDir> plain|fog|bloom|ssao|dof|tint|fxaa|moving|moving-blur webgl|webgpu (moving*: the camera slides on X with a tween)
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const [out,mode='plain',renderer='webgl']=[resolve(process.argv[2]??'outputs/postfx3d-qa/plain-webgl'),process.argv[3],process.argv[4]];await mkdir(out,{recursive:true});
if(!['plain','fog','bloom','ssao','dof','tint','fxaa','moving','moving-blur'].includes(mode))throw Error('Unknown mode');
const euler=(x,y,z)=>{const h=Math.PI/360,sx=Math.sin(x*h),cx=Math.cos(x*h),sy=Math.sin(y*h),cy=Math.cos(y*h),sz=Math.sin(z*h),cz=Math.cos(z*h);return{qx:sx*cy*cz+cx*sy*sz,qy:cx*sy*cz-sx*cy*sz,qz:cx*cy*sz+sx*sy*cz,qw:cx*cy*cz-sx*sy*sz};};
const template=JSON.parse(await readFile('outputs/uv-alpha3d-qa/3D UV Alpha QA.pixieditor','utf8')),scene=template.scenes[0],view=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.viewport'));
const t3=(x,y,z,q,s=1)=>({id:randomUUID(),type:'scene3d.transform',version:1,data:{x,y,z,...q,scaleX:s,scaleY:s,scaleZ:s}});
const entity=(name,components)=>({id:randomUUID(),name,parentId:view.id,active:true,spatial:'scene3d.transform',components});
const camera=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.camera'));camera.components.find(c=>c.type==='scene3d.transform').data={x:0,y:1.5,z:6,...euler(-10,0,0),scaleX:1,scaleY:1,scaleZ:1};
const prim=(shape,color,glow)=>({id:randomUUID(),type:'pixi3d.primitive',version:1,data:{shape,color,roughness:.8,metallic:0,castShadow:true,receiveShadow:true,emissiveColor:glow?'#ffaa33':'#000000',emissiveStrength:glow?8:0}});
scene.entities=scene.entities.filter(e=>!e.components.some(c=>c.type==='pixi3d.modelRenderer'));
scene.entities.push(entity('Ground',[t3(0,-1,-10,euler(-90,0,0),40),prim('plane','#8a8f80')]));
for(let i=0;i<6;i++)scene.entities.push(entity('Cube '+i,[t3(-1.6,-.4,2-i*4,euler(0,25,0),1.2),prim('cube','#d6e2f0')]));
scene.entities.push(entity('Lamp',[t3(1.4,0,0,euler(0,0,0),1),prim('sphere','#332211',true)]));
const viewport=view.components.find(c=>c.type==='pixi3d.viewport').data;
Object.assign(viewport,{toneMapping:'aces',background:'color',backgroundColor:'#19212b',fog:mode==='fog'?'linear':'none',fogColor:'#19212b',fogNear:4,fogFar:20,bloom:mode==='bloom',bloomThreshold:1,bloomIntensity:1.2,bloomRadius:.8,ssao:mode==='ssao',ssaoRadius:.6,ssaoIntensity:1.6,depthOfField:mode==='dof',focusDistance:5,focusRange:1,focusFalloff:6,focusBlur:14,tint:mode==='tint'?'#ffb070':'#ffffff',antialias:mode==='fxaa',motionBlur:mode==='moving-blur',motionBlurIntensity:4,motionBlurSamples:16,motionBlurMaxLength:128});
if(mode.startsWith('moving')){const t=camera.components.find(c=>c.type==='scene3d.transform');camera.components.push({id:randomUUID(),type:'tween.player',version:1,data:{duration:.15,delay:0,ease:'linear',repeat:100,yoyo:true,autoplay:true,tracks:[{id:'x',entityId:camera.id,componentId:t.id,property:'x',from:-2,to:2}]}});}
template.name=`3D PostFX QA ${mode} ${renderer}`;template.extensions={'pixi.render':{version:1,renderer},'assets.registry':{version:1,items:[]}};
const file=join(out,'3D PostFX QA.pixieditor');await writeFile(file,JSON.stringify(template,null,2)+'\n');await mkdir(file+'.assets/sources',{recursive:true});
console.log(JSON.stringify({file,sha:createHash('sha256').update(await readFile(file)).digest('hex')}));
