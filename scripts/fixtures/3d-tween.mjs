// Derived QA project: the UV/alpha project plus a tween.player moving the UV quad on X and stretching scaleY.
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const from=resolve('outputs/uv-alpha3d-qa'),out=resolve(process.argv[2]??'outputs/tween3d-qa'),fixture=JSON.parse(await readFile(join(from,'fixture.json'),'utf8'));await mkdir(out,{recursive:true});
const project=JSON.parse(await readFile(fixture.file,'utf8')),scene=project.scenes[0],quad=scene.entities.find(e=>e.id===fixture.layout.uv.entityId),t3=quad.components.find(c=>c.type==='scene3d.transform');
project.name='3D Tween QA';scene.name='Transform3D tween';
quad.components.push({id:crypto.randomUUID(),type:'tween.player',version:1,data:{duration:1.5,delay:0,ease:'linear',repeat:0,yoyo:false,autoplay:true,tracks:[{id:'x',entityId:quad.id,componentId:t3.id,property:'x',from:-2.2,to:2.2},{id:'sy',entityId:quad.id,componentId:t3.id,property:'scaleY',from:1.6,to:2.4}]}});
const file=join(out,'3D Tween QA.pixieditor');await cp(fixture.file+'.assets',file+'.assets',{recursive:true});await writeFile(file,JSON.stringify(project,null,2)+'\n');
const sourceHash=createHash('sha256').update(await readFile(file)).digest('hex');await writeFile(join(out,'fixture.json'),JSON.stringify({file,sourceHash,entityId:quad.id,expected:{x:[-2.2,2.2],scaleY:[1.6,2.4],duration:1.5}},null,2)+'\n');console.log(JSON.stringify({file,sourceHash}));
