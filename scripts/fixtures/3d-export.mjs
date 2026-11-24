// Repeatable browser QA fixture, built through the real HTML target. No browser automation here.
import {createServer as vite} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const root=resolve('.'),out=resolve('outputs/runtime3d-qa');await mkdir(out,{recursive:true});
const ssr=await vite({configFile:false,root,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},ssr:{noExternal:[/^@rewrite\//]}});
try{
 const {SceneService,transformDefinition,makeEntity,blankScene}=await ssr.ssrLoadModule('/modules/scene/src/index.ts');
 const {newProject}=await ssr.ssrLoadModule('/modules/project/src/index.ts');
 const {transform3dDefinition,viewport3dDefinition,identity3D}=await ssr.ssrLoadModule('/modules/scene3d/src/index.ts');
 const {authoring3dDefinitions}=await ssr.ssrLoadModule('/modules/render-pixi3d/src/contracts.ts');
 const {model3dDefinition}=await ssr.ssrLoadModule('/modules/render-pixi3d/src/model-contracts.ts');
 const {Authoring3D}=await ssr.ssrLoadModule('/modules/render-pixi3d/src/model.ts');
 const {createHtmlTarget}=await ssr.ssrLoadModule('/modules/html-export/src/export.node.ts');
 const {NativeBuildService}=await ssr.ssrLoadModule('/modules/build/src/build.node.ts');
 const scene=new SceneService(()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,...authoring3dDefinitions,model3dDefinition].map(d=>[d.type,d]))),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView();
 const bytes=await readFile(join(root,'modules/pixi3d-lab/src/fixtures/animated-cube.glb')),asset={id:randomUUID(),name:'Original cube',type:'pixi3d.model',revision:createHash('sha256').update(bytes).digest('hex'),source:{extension:'glb',bytes:bytes.length},metadata:{pipeline:'gltf-transform-4.5.1/glb-v1',nodes:1,meshes:1,vertices:36,triangles:12,materials:[{index:0,name:'Olive'}],animations:[{name:'Bob',duration:2}],bounds:{min:[-.5,-.5,-.5],max:[.5,.5,.5]},warnings:[]}};
 const one=editor.placeModel(asset,ids.viewId).id,two=editor.placeModel(asset,ids.viewId).id;scene.remove(ids.entityId);scene.setSpatial(one,{...identity3D(),x:-1.2});scene.setSpatial(two,{...identity3D(),x:1.2});scene.setField(two,model3dDefinition.type,'overrideMaterial',true);scene.setField(two,model3dDefinition.type,'color','#e6a54c');
 const project=newProject(structuredClone(scene.document.current));project.name='3D Runtime QA';project.stage={width:960,height:540};
 const component=(type,data)=>({id:randomUUID(),type,version:1,data}),action=(type,targetId,value=true)=>({id:randomUUID(),type,targetId,value}),bind=(e,actions)=>e.components.push(component('interactions.bindings',{rules:[{id:randomUUID(),trigger:{type:'pointer.click',sourceId:e.id,event:''},actions}]}));
 const soundBytes=Buffer.alloc(44+22050*.2*2);soundBytes.write('RIFF');soundBytes.writeUInt32LE(soundBytes.length-8,4);soundBytes.write('WAVEfmt ',8);soundBytes.writeUInt32LE(16,16);soundBytes.writeUInt16LE(1,20);soundBytes.writeUInt16LE(1,22);soundBytes.writeUInt32LE(22050,24);soundBytes.writeUInt32LE(44100,28);soundBytes.writeUInt16LE(2,32);soundBytes.writeUInt16LE(16,34);soundBytes.write('data',36);soundBytes.writeUInt32LE(soundBytes.length-44,40);for(let i=0;i<(soundBytes.length-44)/2;i++)soundBytes.writeInt16LE(Math.round(Math.sin(i/22050*Math.PI*2*660)*5000*(1-i/4410)),44+i*2);
 const audio={id:randomUUID(),name:'QA tone',type:'audio.clip',revision:createHash('sha256').update(soundBytes).digest('hex'),source:{extension:'wav',bytes:soundBytes.length},metadata:{format:'wav',duration:.2,channels:1,sampleRate:22050,codec:'pcm_s16le',processedBytes:soundBytes.length,pipeline:'qa-generated-wav'}},sound=makeEntity('Click tone');sound.components.push(component('audio.source',{assetId:audio.id,volume:.5,loop:false,rate:1,autoplay:false}));
 project.scenes[0].entities.push(sound);project.extensions['assets.registry']={version:1,items:[asset,audio]};project.providers.audio='howler';
 const all=project.scenes[0].entities;const clipOne=component('animation3d.model',{clip:'Bob',loop:false,speed:1,autoplay:true}),clipTwo=component('animation3d.model',{clip:'Bob',loop:true,speed:.5,autoplay:true});all.find(e=>e.id===one).components.push(clipOne);all.find(e=>e.id===two).components.push(clipTwo);bind(all.find(e=>e.id===one),[action('entity.active',two,false),action('audio.play',sound.components.find(c=>c.type==='audio.source').id),action('animation3d.pause',clipTwo.id)]);
 const button=(name,x,y,color)=>{const e=makeEntity(name,x,y);e.components.push(component('pixi.shape',{width:140,height:44,color,rounded:8,alpha:1}));return e;};
 const restore=button('Restore gold',100,40,'#e6a54c');bind(restore,[action('entity.active',two,true),action('animation3d.resume',clipTwo.id)]);all.push(restore);
 const second=blankScene();second.name='Second room';const next=button('Next room',860,40,'#6ba4d9');bind(next,[action('scene.change',second.id)]);all.push(next);const back=button('Back to 3D',100,40,'#6ba4d9');bind(back,[action('scene.change',project.entrySceneId)]);second.entities.push(back);project.scenes.push(second);
 const built=await new NativeBuildService([createHtmlTarget()],join(root,'apps/editor-desktop/out/player'),async(id,_rev,file)=>{if(id===asset.id&&file==='model.glb')return bytes;if(id===audio.id&&file==='audio.wav')return soundBytes;throw Error('Unexpected asset '+file);}).run(out,project,'html');
 const minimal=newProject();const plain=await new NativeBuildService([createHtmlTarget()],join(root,'apps/editor-desktop/out/player'),async()=>{throw Error('No assets expected');}).run(out,minimal,'html');
 const minimalReport=JSON.parse(await readFile(join(plain.output,'runtime-report.json'),'utf8'));if(minimalReport.runtimes.length||minimalReport.files.some(f=>f.vendors.includes('@pixi/3d')))throw Error('3D leaked into minimal 2D export');
 await writeFile(join(out,'fixture.json'),JSON.stringify({output:built.output,minimal:plain.output,one,two,clipOne:clipOne.id,clipTwo:clipTwo.id,view:ids.viewId,scene:project.entrySceneId,second:second.id,sound:sound.id},null,2)+'\n');console.log(JSON.stringify({output:built.output,minimal:plain.output}));
}finally{await ssr.close();}
