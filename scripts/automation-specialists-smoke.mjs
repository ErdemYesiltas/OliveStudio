import {expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {launchMcpFixture} from './helpers/mcp-fixture.mjs';
const f=await launchMcpFixture();const {call,approve,job}=f;
try{
 await f.grant();await approve(await call('project.new'));
 const preset=await call('soundlab.preset',{preset:'pickup',seed:7});const sound=await job(await call('soundlab.create',{name:'MCP Coin',parameters:preset,place:true}));expect(sound.assets[0].type).toBe('audio.clip');expect(sound.objectId).toBeTruthy();await call('project.undo');expect((await call('assets.list')).total).toBe(0);expect((await call('scene.list_objects')).total).toBe(0);await call('project.redo');
 const source='export function update(self: GameObject, dt: number) {\n const speed=120;\n self.state.frames=(self.state.frames??0)+1;\n self.x+=speed*dt;\n}';
 const script=await call('scripts.upsert',{name:'Mover',source}),actor=await call('add_object',{item:'pixi.rect',name:'Debugger actor',x:100,y:100});await call('add_component',{objectId:actor.id,component:'scripts.behaviour'});await call('scene.set_component',{objectId:actor.id,component:'scripts.behaviour',data:{scriptId:script.id,params:{},refs:{}}});
 await call('debugger.breakpoint',{scriptId:script.id,line:4,enabled:true});await call('debugger.watch',{expression:'self.state.frames',action:'add'});await call('profiler.control',{action:'record'});
 await expect.poll(async()=>{const response=await f.raw('preview.control',{action:'play'});if(response.result.isError&&!/still loading/.test(response.result.content[0].text))throw Error(response.result.content[0].text);return response.result.isError;},{timeout:30000}).toBe(false);
 await expect.poll(async()=>(await call('debugger.state')).hit?.line).toBe(4);const values=await call('debugger.evaluate');expect(values.values).toContain('1');await call('debugger.control',{action:'step'});expect((await call('debugger.evaluate')).values).toContain('2');await call('debugger.clear');await call('debugger.control',{action:'resume'});
 await expect.poll(async()=>(await call('profiler.state')).summary.frames).toBeGreaterThan(2);const paused=await call('profiler.control',{action:'pause'});expect((await call('profiler.state')).summary.frames).toBe(paused.frames);expect((await call('profiler.csv')).csv).toContain('scripts_ms');expect((await call('profiler.frames',{limit:1})).items).toHaveLength(1);await call('preview.control',{action:'stop'});
 const dir=join(f.temp,'game');await mkdir(dir);const file=join(dir,'Türkçe game.pixieditor');await approve(await call('project.save',{path:file}));await approve(await call('git.init',{projectPath:file}));expect((await call('git.status')).repo).toBe(true);
 const files=(await call('git.status')).changes.map(c=>c.file);expect(files).toContain('Türkçe game.pixieditor');const first=await approve(await call('git.commit',{projectPath:file,message:'First game',files}));
 await call('rename_project',{name:'Updated game'});await approve(await call('project.save',{path:file}));await approve(await call('git.commit',{projectPath:file,message:'Rename game',files:['Türkçe game.pixieditor']}));expect((await call('git.history')).length).toBe(2);expect(JSON.parse((await call('git.show',{hash:first.hash})).text).name).not.toBe('Updated game');await approve(await call('git.restore',{projectPath:file,hash:first.hash}));expect((await call('project.get_state')).name).not.toBe('Updated game');expect(f.errors).toEqual([]);
 console.log('PASS specialist MCP: actual Sound Lab WAV/import/object atomic Undo; script breakpoints/watches/Step/Resume; profiler recording/pages/CSV; approved Git init/explicit commit/history/show/restore with unicode filenames');
}finally{await f.close();}
