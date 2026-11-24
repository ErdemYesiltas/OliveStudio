// QA project for 3D particles. Usage: 3d-particles.mjs <outDir> static|fountain|budget webgl|webgpu
// static: a time-invariant burst (no speed, 60 s life, no ramps) for WebGL/WebGPU pixel parity.
// fountain: an emitter turned 90° about Z shoots along world -X; gravity must still bend it towards world down.
// budget: four 4000-particle emitters for frame-time measurement.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const [out,mode='static',renderer='webgl']=[resolve(process.argv[2]??'outputs/particles3d-qa/static-webgl'),process.argv[3],process.argv[4]];await mkdir(out,{recursive:true});
if(!['static','fountain','budget'].includes(mode))throw Error('Mode must be static, fountain or budget');
const euler=(x,y,z)=>{const h=Math.PI/360,sx=Math.sin(x*h),cx=Math.cos(x*h),sy=Math.sin(y*h),cy=Math.cos(y*h),sz=Math.sin(z*h),cz=Math.cos(z*h);return{qx:sx*cy*cz+cx*sy*sz,qy:cx*sy*cz-sx*cy*sz,qz:cx*cy*sz+sx*sy*cz,qw:cx*cy*cz-sx*sy*sz};};
const template=JSON.parse(await readFile('outputs/uv-alpha3d-qa/3D UV Alpha QA.pixieditor','utf8')),scene=template.scenes[0],view=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.viewport'));
const t3=(x,y,z,q,s=1)=>({id:randomUUID(),type:'scene3d.transform',version:1,data:{x,y,z,...q,scaleX:s,scaleY:s,scaleZ:s}});
const entity=(name,components)=>({id:randomUUID(),name,parentId:view.id,active:true,spatial:'scene3d.transform',components});
const camera=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.camera'));camera.components.find(c=>c.type==='scene3d.transform').data={x:0,y:1,z:7,...euler(-8,0,0),scaleX:1,scaleY:1,scaleZ:1};
const base={count:200,emission:'continuous',autoplay:true,seed:1,lifetime:2,lifetimeRandom:.3,speed:2,speedRandom:.5,spread:25,gravity:1,spawnShape:'point',spawnRadius:.25,spawnWidth:1,spawnHeight:1,spawnDepth:1,size:.2,sizeRandom:.3,endScale:.2,alpha:1,endAlpha:0,tint:'#ffd27a',endTint:'#ff6a2a',rotationSpeed:0,particleTexture:'soft',blendMode:'add'};
const emitter=(name,pose,data)=>entity(name,[pose,{id:randomUUID(),type:'pixi3d.particles',version:1,data:{...base,...data}}]);
scene.entities=scene.entities.filter(e=>!e.components.some(c=>c.type==='pixi3d.modelRenderer'));
if(mode==='static'){
 scene.entities.push(emitter('Static box',t3(-1.5,1,0,euler(0,0,0)),{count:400,emission:'burst',lifetime:60,lifetimeRandom:0,speed:0,gravity:0,spawnShape:'box',spawnWidth:2.4,spawnHeight:1.6,spawnDepth:1,size:.18,sizeRandom:.5,endScale:1,alpha:.9,endAlpha:.9,tint:'#7fd0ff',endTint:'#7fd0ff',particleTexture:'circle',blendMode:'normal'}),
  emitter('Static sphere',t3(1.6,1,0,euler(0,0,0)),{count:300,emission:'burst',lifetime:60,lifetimeRandom:0,speed:0,gravity:0,spawnShape:'sphere',spawnRadius:1,size:.25,endScale:1,alpha:.8,endAlpha:.8,tint:'#ffb347',endTint:'#ffb347',particleTexture:'soft',blendMode:'add'}));
}else if(mode==='fountain'){
 scene.entities.push(emitter('Sideways fountain',t3(2.5,2,0,euler(0,0,90)),{count:600,lifetime:1.6,lifetimeRandom:0,speed:4,speedRandom:.1,spread:4,gravity:6,size:.12,sizeRandom:0,endScale:1,alpha:1,endAlpha:.6,tint:'#9fffb0',endTint:'#3fae5a',particleTexture:'circle',blendMode:'normal'}));
}else{
 for(let i=0;i<4;i++)scene.entities.push(emitter('Budget '+i,t3(-3+i*2,-.5,0,euler(0,0,0)),{count:4000,lifetime:2.5,speed:2.5,spread:35,gravity:1.5,size:.06,sizeRandom:.4,seed:i+1}));
}
template.name=`3D Particles QA ${mode} ${renderer}`;template.extensions={'pixi.render':{version:1,renderer},'assets.registry':{version:1,items:[]}};
const file=join(out,'3D Particles QA.pixieditor');await writeFile(file,JSON.stringify(template,null,2)+'\n');await mkdir(file+'.assets/sources',{recursive:true});
console.log(JSON.stringify({file,sha:createHash('sha256').update(await readFile(file)).digest('hex')}));
