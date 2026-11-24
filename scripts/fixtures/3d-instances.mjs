// QA project for 3D instancing. Usage: 3d-instances.mjs <outDir> grid|scatter|separate|batched|colors|wide-off|wide-cpu|wide-gpu webgl|webgpu
// grid: 10×10 cubes over a ground plane with a shadow-casting sun, for WebGL/WebGPU parity.
// scatter: 20000 spheres for frame-time measurement.
// wide-*: 20000 spheres over a 600×600 field seen from a low camera at its centre, with that culling mode.
// colors: single, random-mix and gradient grids side by side (per-copy tint shader bit).
// separate / batched: the same 20×20 cubes as 400 primitive entities, or as one instances component, for draw-call counts.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const [out,mode='grid',renderer='webgl']=[resolve(process.argv[2]??'outputs/instances3d-qa/grid-webgl'),process.argv[3],process.argv[4]];await mkdir(out,{recursive:true});
if(!['grid','scatter','separate','batched','colors','wide-off','wide-cpu','wide-gpu'].includes(mode))throw Error('Unknown mode');
const euler=(x,y,z)=>{const h=Math.PI/360,sx=Math.sin(x*h),cx=Math.cos(x*h),sy=Math.sin(y*h),cy=Math.cos(y*h),sz=Math.sin(z*h),cz=Math.cos(z*h);return{qx:sx*cy*cz+cx*sy*sz,qy:cx*sy*cz-sx*cy*sz,qz:cx*cy*sz+sx*sy*cz,qw:cx*cy*cz-sx*sy*sz};};
const template=JSON.parse(await readFile('outputs/uv-alpha3d-qa/3D UV Alpha QA.pixieditor','utf8')),scene=template.scenes[0],view=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.viewport'));
const t3=(x,y,z,q,s=1)=>({id:randomUUID(),type:'scene3d.transform',version:1,data:{x,y,z,...q,scaleX:s,scaleY:s,scaleZ:s}});
const entity=(name,components)=>({id:randomUUID(),name,parentId:view.id,active:true,spatial:'scene3d.transform',components});
const camera=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.camera'));camera.components.find(c=>c.type==='scene3d.transform').data={x:0,y:9,z:14,...euler(-32,0,0),scaleX:1,scaleY:1,scaleZ:1};
const sun=scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.light'&&c.data.kind==='directional'));Object.assign(sun.components.find(c=>c.type==='scene3d.transform').data,euler(-55,30,0));sun.components.find(c=>c.type==='pixi3d.light').data.castShadow=mode==='grid';
const prim=(shape,color)=>({id:randomUUID(),type:'pixi3d.primitive',version:1,data:{shape,color,roughness:.8,metallic:0,castShadow:true,receiveShadow:true,emissiveColor:'#000000',emissiveStrength:0}});
const base={shape:'cube',color:'#9fb7d6',roughness:.6,metallic:0,castShadow:true,receiveShadow:true,layout:'grid',columns:10,rows:10,layers:1,spacing:1.5,count:200,areaWidth:10,areaDepth:10,areaHeight:0,seed:1,scale:1,scaleRandom:0,yawRandom:0,jitter:0};
const instances=(name,pose,data)=>entity(name,[pose,{id:randomUUID(),type:'pixi3d.instances',version:1,data:{...base,...data}}]);
scene.entities=scene.entities.filter(e=>!e.components.some(c=>['pixi3d.modelRenderer','pixi3d.primitive'].includes(c.type)));
if(mode==='grid')scene.entities.push(entity('Ground',[t3(0,-.5,0,euler(-90,0,0),20),prim('plane','#d9d2c3')]),instances('Crates',t3(0,0,0,euler(0,0,0)),{columns:10,rows:10,spacing:1.4,scale:.8,scaleRandom:.4,yawRandom:45,jitter:.3,seed:4}));
else if(mode==='scatter')scene.entities.push(instances('Field',t3(0,-1,-6,euler(0,0,0)),{shape:'sphere',layout:'scatter',count:20000,areaWidth:30,areaDepth:30,areaHeight:2,scale:.15,scaleRandom:.6,color:'#c4e38f',castShadow:false}));
else if(mode.startsWith('wide-')){camera.components.find(c=>c.type==='scene3d.transform').data={x:0,y:2,z:0,...euler(-4,0,0),scaleX:1,scaleY:1,scaleZ:1};const cam=camera.components.find(c=>c.type==='pixi3d.camera');if(cam)cam.data.far=2000;
 scene.entities.push(instances('Wide field',t3(0,0,0,euler(0,0,0)),{shape:'sphere',layout:'scatter',count:20000,areaWidth:600,areaDepth:600,areaHeight:4,scale:1,scaleRandom:.5,color:'#c4e38f',castShadow:false,cull:mode.slice(5)}));}
else if(mode==='colors')scene.entities.push(...[['single',-6.5],['random',0],['gradient',6.5]].map(([colorMode,x])=>instances('Colours '+colorMode,t3(x,0,0,euler(0,0,0)),{colorMode,color:'#e04848',color2:'#3f7fe0',gradientAxis:'x',columns:6,rows:6,spacing:1,scale:.8,castShadow:false,seed:9})));
else if(mode==='batched')scene.entities.push(instances('Batched',t3(0,0,0,euler(0,0,0)),{columns:20,rows:20,spacing:.8,scale:.5,castShadow:false}));
else for(let i=0;i<400;i++)scene.entities.push(entity('Cube '+i,[t3(((i%20)-9.5)*.8,0,(Math.floor(i/20)-9.5)*.8,euler(0,0,0),.5),{...prim('cube','#9fb7d6'),data:{...prim('cube','#9fb7d6').data,roughness:.6,castShadow:false}}]));
template.name=`3D Instances QA ${mode} ${renderer}`;template.extensions={'pixi.render':{version:1,renderer},'assets.registry':{version:1,items:[]}};
const file=join(out,'3D Instances QA.pixieditor');await writeFile(file,JSON.stringify(template,null,2)+'\n');await mkdir(file+'.assets/sources',{recursive:true});
console.log(JSON.stringify({file,sha:createHash('sha256').update(await readFile(file)).digest('hex')}));
