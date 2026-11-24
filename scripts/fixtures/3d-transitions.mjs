// Separate native lifecycle QA project. The source project and its asset sidecar stay unchanged.
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID as uuid} from 'node:crypto';
const source=resolve('outputs/animation3d-qa/3D Animation QA.pixieditor'),root=resolve('outputs/camera3d-qa');await mkdir(root,{recursive:true});
const project=JSON.parse(await readFile(source,'utf8')),a=project.scenes[0],map=new Map(a.entities.flatMap(e=>[[e.id,uuid()],...e.components.map(c=>[c.id,uuid()])])),rewrite=value=>typeof value==='string'?(map.get(value)??value):Array.isArray(value)?value.map(rewrite):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v)])):value;
const b=rewrite(a);b.id=uuid();b.name='Room B';a.name='Room A';project.name='3D Camera Lifecycle QA';project.scenes.push(b);
function button(scene,name,type,target,x){const id=uuid();scene.entities.push({id,name,parentId:null,active:true,components:[{id:uuid(),type:'scene.transform2d',version:1,data:{x,y:40,rotation:0,scaleX:1,scaleY:1}},{id:uuid(),type:'pixi.shape',version:1,data:{kind:'rect',width:120,height:40,color:'#78909c',alpha:1,rounded:8,sides:5,innerRadius:.5,strokeColor:'#ffffff',strokeWidth:0}},{id:uuid(),type:'interactions.bindings',version:1,data:{rules:[{id:uuid(),trigger:{type:'pointer.click',sourceId:id,event:''},actions:[{id:uuid(),type,targetId:target,value:true}]}]}}]});return id;}
const change=button(a,'Go to Room B','scene.change',b.id,120),add=button(a,'Add Room B','scene.add',b.id,280),remove=button(a,'Remove Room B','scene.remove',b.id,440),back=button(b,'Back to Room A','scene.change',a.id,120);
const file=join(root,'3D Camera Lifecycle QA.pixieditor');await writeFile(file,JSON.stringify(project,null,2)+'\n');await cp(source+'.assets',file+'.assets',{recursive:true});
const view=scene=>scene.entities.find(e=>e.components.some(c=>c.type==='pixi3d.viewport')).id;
await writeFile(join(root,'fixture.json'),JSON.stringify({file,sceneA:a.id,sceneB:b.id,viewA:view(a),viewB:view(b),change,add,remove,back,blueA:a.entities.find(e=>e.components.some(c=>c.id==='animation3d-qa-blue')).id,blueB:map.get(a.entities.find(e=>e.components.some(c=>c.id==='animation3d-qa-blue')).id)},null,2)+'\n');console.log(file);
