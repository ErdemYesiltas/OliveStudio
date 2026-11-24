// Native macOS QA via the application's public MCP. Open the saved fixture first.
// No project writes: exact IDs/hash, clean document and edit mode are required.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]??'outputs/pose3d-qa'),fixture=JSON.parse(await readFile(join(root,'fixture.json'),'utf8')),html=JSON.parse(await readFile(join(root,'html-poses.json'),'utf8'));
if(process.platform!=='darwin')throw Error('This native evidence collector currently targets macOS');
const config=JSON.parse(await readFile(join(homedir(),'Library/Application Support/OliveStudio/mcp.json'),'utf8'));let seq=0;
async function call(name,args={},timeout=30000){
 const response=await fetch(`http://127.0.0.1:${config.port}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.token}`},signal:AbortSignal.timeout(timeout),body:JSON.stringify({jsonrpc:'2.0',id:++seq,method:'tools/call',params:{name,arguments:args}})});
 if(!response.ok)throw Error(`MCP HTTP ${response.status}`);
 const data=await response.json();if(data.error||data.result?.isError)throw Error(JSON.stringify(data.error??data.result.content));
 return JSON.parse(data.result.content.find(c=>c.type==='text').text);
}
async function exec(name,args={}){const p=await call('project.get_state',{},5000);return call('automation.execute',{name,arguments:args,context:{generation:p.generation,revision:p.revision,sceneId:p.activeSceneId}});}
const source=await readFile(fixture.source,'utf8'),project=JSON.parse(source),before=await call('project.get_state',{},5000);
assert.equal(createHash('sha256').update(source).digest('hex'),fixture.sourceHash);assert.equal(html.sourceHash,fixture.sourceHash);assert.equal(before.name,project.name);assert.equal(before.activeSceneId,project.entrySceneId);assert.equal(before.dirty,false);assert.equal((await exec('preview.state')).mode,'edit');
let started=false;
try{
 await exec('preview.control',{action:'play'});started=true;await exec('preview.control',{action:'pause'});assert.equal((await exec('preview.state')).mode,'paused');
 const samples=[];
 for(const at of fixture.times){const models=[];for(const m of fixture.models){const clipTime=m.loop&&m.duration>0?(at*m.speed)%m.duration:Math.min(m.duration,at*m.speed);await exec('pixi3d-editor.animation_control',{componentId:m.componentId,action:'seek',time:clipTime});const pose=await exec('pixi3d-editor.inspect_model',{entityId:m.entityId,limit:64});assert.equal(pose.ready,true);assert.equal(pose.error,null);assert.equal(pose.nextOffset,null);assert.ok(pose.nodes.length>0);models.push({name:m.name,entityId:m.entityId,componentId:m.componentId,clipTime,pose});}samples.push({at,models});}
 const native={sourceHash:fixture.sourceHash,paused:true,samples};await writeFile(join(root,'native-poses.json'),JSON.stringify(native,null,2)+'\n');
 let fields=0,maxAbsError=0;const mismatches=[];
 function compare(a,b,path){
  if(typeof a==='number'&&typeof b==='number'){assert.ok(Number.isFinite(a)&&Number.isFinite(b),path);fields++;const delta=Math.abs(a-b);maxAbsError=Math.max(maxAbsError,delta);if(delta>1e-6)mismatches.push({path,native:a,html:b,delta});return;}
  if(Array.isArray(a)&&Array.isArray(b)){assert.equal(a.length,b.length,path);a.forEach((v,i)=>compare(v,b[i],path+'['+i+']'));return;}
  if(a&&b&&typeof a==='object'&&typeof b==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),path);for(const key of Object.keys(a))compare(a[key],b[key],path+'.'+key);return;}
  assert.equal(a,b,path);
 }
 compare(native,html,'$');const report={sourceHash:fixture.sourceHash,samples:samples.length,modelsPerSample:fixture.models.length,numericFields:fields,tolerance:1e-6,maxAbsError,mismatches,pass:mismatches.length===0};await writeFile(join(root,'comparison.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));assert.equal(report.pass,true);
}finally{
 if(started)await exec('preview.control',{action:'stop'});
 const after=await call('project.get_state',{},5000);assert.equal(after.dirty,false);assert.equal(after.revision,before.revision);assert.equal(after.generation,before.generation);assert.equal(await readFile(fixture.source,'utf8'),source);
 await writeFile(join(root,'native-final-state.json'),JSON.stringify({project:after,preview:await exec('preview.state'),animations:await exec('pixi3d-editor.animation_state')},null,2)+'\n');
}
