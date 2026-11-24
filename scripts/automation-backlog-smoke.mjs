// MCP backlog tools in the packaged editor: one import limit everywhere, manifest bundles (sheets, animation ranges,
// sounds, in-place reimport, atomic refusal), readiness waits, frame-scheduled input sequences and filtered inspection.
import {expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchMcpFixture,workspace} from './helpers/mcp-fixture.mjs';
const sharp=createRequire(join(workspace,'apps/editor-desktop/package.json'))('sharp');
const f=await launchMcpFixture('backlog');const {call,raw,approve,job}=f;
const failure=async(name,args)=>{const r=await raw(name,args);expect(r.result.isError,JSON.stringify(r)).toBe(true);return r.result.content[0].text;};
const png=(file,width,height,color)=>sharp({create:{width,height,channels:4,background:color}}).png().toFile(file);
const wav=()=>{const n=800,b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);return b;};
try{
 await f.grant();await approve(await call('project.new'));
 // P0: the schema, the native handler and the message agree; a refused request imports nothing.
 const many=join(f.temp,'many');await mkdir(many);const paths=[];for(let i=0;i<17;i++){const p=join(many,`tile${i}.png`);await png(p,8,8,'#3366ff');paths.push(p);}
 expect(await failure('assets.import_files',{paths})).toContain('Import accepts 1 to 16 files per request (got 17)');
 expect((await call('assets.list')).total).toBe(0);
 expect((await job(await call('assets.import_files',{paths:paths.slice(0,16)}))).assets).toHaveLength(16);

 // P2: a bundle with a sheet (named ranges), a texture and a sound; reimport keeps IDs; a bad bundle adds nothing.
 const dir=join(f.temp,'hero-pack');await mkdir(join(dir,'sfx'),{recursive:true});
 await png(join(dir,'hero.png'),128,32,'#ff8800');await png(join(dir,'sky.png'),64,32,'#88ccff');await writeFile(join(dir,'sfx','jump.wav'),wav());
 const manifest={version:1,name:'Hero pack',textures:[{file:'sky.png',name:'Sky'}],sheets:[{file:'hero.png',name:'Hero',frameWidth:32,frameHeight:16,animations:{idle:{from:0,to:3},run:{from:4,to:7,fps:16}}}],sounds:[{file:'sfx/jump.wav'}]};
 await writeFile(join(dir,'pack.json'),JSON.stringify(manifest));
 const first=await job(await call('assets.import_bundle',{path:join(dir,'pack.json')}));
 expect(first.assets.map(a=>[a.name,a.kind,a.replaced])).toEqual([['Sky','texture',false],['Hero','sheet',false],['jump','sound',false]]);
 expect(first.sheets.Hero).toMatchObject({columns:4,rows:2,frames:8,animations:{run:{start:4,frames:4,fps:16,width:32,height:16}}});
 const heroId=first.sheets.Hero.assetId;expect((await call('project.get_section',{key:'assets.sheets'})).sheets?.[heroId]??(await call('project.get_section',{key:'assets.sheets'})).value?.sheets?.[heroId]).toBeTruthy();
 const actor=await call('add_object',{item:'pixi.rect',name:'Hero actor',x:300,y:120});await call('remove_component',{objectId:actor.id,component:'pixi.shape'});await call('add_component',{objectId:actor.id,component:'pixi.flipbook'});
 await call('scene.set_component',{objectId:actor.id,component:'pixi.flipbook',data:first.sheets.Hero.animations.run});
 const before=(await call('assets.list',{limit:50})).items.find(a=>a.id===heroId);
 await png(join(dir,'hero.png'),128,32,'#22aa44');
 const second=await job(await call('assets.import_bundle',{path:join(dir,'pack.json')}));
 expect(second.sheets.Hero.assetId).toBe(heroId);expect(second.assets.every(a=>a.replaced)).toBe(true);
 const after=(await call('assets.list',{limit:50})).items.find(a=>a.id===heroId);expect(after.revision).not.toBe(before.revision);
 expect((await call('scene.get_component',{objectId:actor.id,component:'pixi.flipbook'})).data?.assetId??(await call('scene.get_component',{objectId:actor.id,component:'pixi.flipbook'})).assetId).toBe(heroId);
 const count=(await call('assets.list',{limit:50})).total;
 await writeFile(join(dir,'bad.json'),JSON.stringify({...manifest,sheets:[{...manifest.sheets[0],frameWidth:30}]}));
 await expect(job(await call('assets.import_bundle',{path:join(dir,'bad.json')}))).rejects.toThrow(/nothing was added.*does not divide/);
 expect((await call('assets.list',{limit:50})).total).toBe(count);
 await writeFile(join(dir,'escape.json'),JSON.stringify({version:1,textures:[{file:'../many/tile0.png'}]}));
 await expect(job(await call('assets.import_bundle',{path:join(dir,'escape.json')}))).rejects.toThrow(/relative to the manifest/);

 // P2: readiness, then P1: a frame-scheduled scenario on a scripted mover, identical in two Preview runs.
 expect((await job(await call('preview.wait_until_ready',{target:'project',timeoutMs:15000}))).state).toBe('ready');
 await call('project.set_section',{key:'input.map',value:{version:1,deadzone:0.2,actions:[{id:'right',name:'right',kind:'button',bindings:[{type:'key',code:'ArrowRight'}]}]}});
 const mover=await call('scripts.upsert',{name:'Mover',source:"export function update(self: GameObject, dt: number) { if (game.isDown('right')) self.x += 120 * dt; }"});
 const runner=await call('add_object',{item:'pixi.rect',name:'Runner',x:100,y:300});await call('add_component',{objectId:runner.id,component:'scripts.behaviour'});await call('scene.set_component',{objectId:runner.id,component:'scripts.behaviour',data:{scriptId:mover.id,params:{},refs:{}}});
 const play=async()=>expect.poll(async()=>{const r=await raw('preview.control',{action:'play'});if(r.result.isError&&!/still loading/.test(r.result.content[0].text))throw Error(r.result.content[0].text);return r.result.isError;},{timeout:30000}).toBe(false);
 const scenario={frames:60,events:[{frame:0,code:'ArrowRight',down:true},{frame:30,code:'ArrowRight',down:false}],observe:{objectIds:[runner.id],every:30,fields:['transform']}};
 const run=async()=>{await play();await call('preview.control',{action:'pause'});expect((await job(await call('preview.wait_until_ready',{target:'preview'}))).state).toBe('ready');const state=await call('preview.inspect_runtime',{objectIds:[runner.id]});const result=await job(await call('preview.run_input_sequence',{...scenario,session:state.session}));await call('preview.control',{action:'stop'});return{state,result};};
 const a=await run(),b=await run();
 expect(b.state.session).toBeGreaterThan(a.state.session);
 const xs=r=>r.samples.map(s=>[s.frame,s.objects[runner.id].x]);
 expect(xs(a.result)).toEqual([[0,100],[30,160],[60,160]]);expect(xs(b.result)).toEqual(xs(a.result));
 expect(a.result).toMatchObject({completed:true,released:[]});
 await play();
 expect(await failure('preview.run_input_sequence',{...scenario,session:a.state.session})).toMatch(/has ended/);
 const inspected=await call('preview.inspect_runtime',{objectIds:[runner.id,actor.id,'missing'],include:['transform','scripts','components'],components:['pixi.flipbook','scripts.behaviour']});
 expect(inspected).toMatchObject({total:2,missing:['missing'],paused:false});
 expect(inspected.objects.find(o=>o.id===runner.id).scripts).toEqual([expect.objectContaining({script:'Mover'})]);
 expect(inspected.objects.find(o=>o.id===actor.id).components[0]).toMatchObject({type:'pixi.flipbook',data:{assetId:heroId,start:4}});
 await call('preview.control',{action:'stop'});
 expect(f.errors).toEqual([]);
 console.log('PASS MCP backlog: shared 16-file import limit (refused before work), manifest bundle (sheet ranges → flipbooks, sound, in-place reimport, atomic refusal, path escape), readiness waits, frame-scheduled input identical across Preview runs with session guard, filtered runtime inspection');
}finally{await f.close();}
