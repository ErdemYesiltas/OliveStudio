// S2a (script-made geometry) in exported HTML on WebGL and WebGPU: the shapes scripts build with game.geometry draw.
// - Geometry from arrays: the textured hills (checker both light and dark) and the flat-shaded gem.
// - Vertex colours: the left sphere is colourful, the right one (same data, switch off) is grey.
// - Vertex formats: the packed sphere looks like the float one (mirrored halves of the picture nearly equal).
// - Morph targets from arrays: the blob's outline changes as the weights move.
// Writes outputs/geometry3d-qa (serve outputs/ on port 5209 first).
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve('.'),out=join(root,'outputs/geometry3d-qa'),base='http://127.0.0.1:5209/geometry3d-qa',sharp=createRequire(join(root,'apps/editor-desktop/package.json'))('sharp');
const pixels=async png=>(await sharp(png).resize(960,540).raw().toBuffer({resolveWithObject:true})).data;
const count=async(png,[x0,y0,x1,y1],test)=>{const d=await pixels(png);let n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const o=(y*960+x)*3;if(test(d[o],d[o+1],d[o+2]))n++;}return n;};
const changed=async(a,b)=>{const x=await pixels(a),y=await pixels(b);let d=0;for(let i=0;i<x.length;i++)d+=Math.abs(x[i]-y[i]);return +(d/x.length).toFixed(2);};
const framesPerSecond=page=>page.evaluate(()=>new Promise(done=>{let n=0;const start=performance.now(),tick=()=>{n++;if(performance.now()-start<2000)requestAnimationFrame(tick);else done(Math.round(n/((performance.now()-start)/1000)));};requestAnimationFrame(tick);}));
const saturated=(r,g,b)=>Math.max(r,g,b)-Math.min(r,g,b)>60;
const checks={
 async 'pixi3d-geometry-arrays'(page,shot){await page.waitForTimeout(2000);const a=await shot(),light=await count(a,[0,250,960,540],(r,g,b)=>r>200&&g>200&&b>200),dark=await count(a,[0,250,960,540],(r,g,b)=>b>60&&r<70&&g<80&&b-r>15),gem=await count(a,[380,120,580,300],(r,g,b)=>b>170&&g>140&&r<170);
  return{values:{light,dark,gem},pass:light>20000&&dark>20000&&gem>800};},
 async 'pixi3d-vertex-colors'(page,shot){await page.waitForTimeout(2000);const a=await shot(),left=await count(a,[150,140,450,420],saturated),right=await count(a,[510,140,810,420],saturated);
  return{values:{leftColourful:left,rightColourful:right},pass:left>15000&&right<left/20};},
 // Reference: the same project with the right sphere stored as floats. Colours depend only on height and the sphere
 // is round, so its turning does not change the picture; the packed run must match this one pixel for pixel (nearly).
 async 'pixi3d-vertex-formats/reference'(page,shot){await page.waitForTimeout(2000);reference[current]=await pixels(await shot());return{values:{},pass:true};},
 async 'pixi3d-vertex-formats'(page,shot){await page.waitForTimeout(2000);const d=await pixels(await shot());let diff=0,n=0,lit=0;
  for(let y=140;y<430;y++)for(let x=510;x<810;x++){const o=(y*960+x)*3;if(d[o]+d[o+1]+d[o+2]>330)lit++;for(let c=0;c<3;c++){diff+=Math.abs(d[o+c]-reference[current][o+c]);n++;}}
  return{values:{packedSphere:lit,meanDiffToFloat:+(diff/n).toFixed(3)},pass:lit>15000&&diff/n<1.5};},
 // S2b: per-frame script writes. Frame rate over two seconds in the page, so the bridge's cost shows.
 async 'pixi3d-particle-container'(page,shot){await page.waitForTimeout(1500);const fps=await framesPerSecond(page),a=await shot();await page.waitForTimeout(400);const b=await shot();
  const lit=await count(a,[100,60,860,500],(r,g,b)=>r+g+b>300),moved=await changed(a,b);return{values:{lit,moved,fps},pass:lit>8000&&moved>.5&&fps>45};},
 async 'pixi3d-custom-emitter'(page,shot){await page.waitForTimeout(900);const a=await shot();await page.waitForTimeout(2200);const fps=await framesPerSecond(page),b=await shot();
  const sign=(r,g,b)=>r>170&&g>150&&b>110&&r-b<90,spark=(r,g,b)=>r>200&&g>90&&b<120&&r-b>100;
  const v={signEarly:await count(a,[100,120,860,420],sign),signLater:await count(b,[100,120,860,420],sign),sparks:await count(b,[100,60,860,420],spark),fps};return{values:v,pass:v.signEarly>v.signLater*1.3&&v.sparks>200&&fps>45};},
 async 'pixi3d-batched-mesh'(page,shot,logs,mouse){await page.waitForTimeout(2000);const a=await shot();const colourful=await count(a,[0,100,960,540],(r,g,b)=>Math.max(r,g,b)-Math.min(r,g,b)>40&&r+g+b>350);
  await mouse.move(480,300);await mouse.down();for(let k=1;k<=10;k++){await mouse.move(480+k*6,300);await page.waitForTimeout(16);}await mouse.up();await page.waitForTimeout(600);const b=await shot();
  const written=logs.some(l=>/clay shapes 20000/.test(l));return{values:{colourful,written,orbit:await changed(a,b)},pass:colourful>30000&&written&&(await changed(a,b))>2};},
 async 'pixi3d-geometry-morph'(page,shot){const blob=(r,g,b)=>b>150&&b>r+30;const areas=[];for(let i=0;i<6;i++){await page.waitForTimeout(450);areas.push(await count(await shot(),[250,60,710,440],blob));}
  return{values:{areas},pass:Math.max(...areas)-Math.min(...areas)>4000&&Math.min(...areas)>8000};},
};
const reference={};let current='';
const catalog=JSON.parse(await readFile(join(root,'examples/catalog.json'),'utf8')).examples,report={};let failed=0;
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-webgpu']});
try{for(const id of Object.keys(checks))for(const renderer of ['webgl','webgpu']){
 current=renderer;const [exampleId,variant]=id.split('/'),entry=catalog.find(e=>e.id===exampleId),file=join(root,'examples',entry.file),dir=join(out,`${id.replace('/','-')}-${renderer}`);await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
 const project=JSON.parse(await readFile(file,'utf8'));project.extensions['pixi.render']={version:1,renderer};if(variant==='reference')for(const e of project.scenes[0].entities)for(const c of e.components)if(c.type==='scripts.behaviour'&&e.name==='Packed sphere')c.data.params.packed=false;
 await writeFile(join(dir,'qa.pixieditor'),JSON.stringify(project));await cp(file+'.assets',join(dir,'qa.pixieditor.assets'),{recursive:true}).catch(()=>{});
 execFileSync(process.execPath,[join(root,'scripts/fixtures/3d-project-export.mjs'),join(dir,'qa.pixieditor'),join(dir,'html')],{cwd:root,stdio:'pipe'});
 const html=(await readdir(join(dir,'html'))).find(n=>n.startsWith('Pixi-HTML-'));
 // The local Python file server sometimes resets a connection; such a case runs once more (other errors never do).
 for(let attempt=1;;attempt++){
 const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[],logs=[];page.on('console',m=>{if(m.text().startsWith('[script]'))logs.push(m.text());});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'||/^\[script\]/.test(m.text())&&m.type()!=='log')errors.push(m.text());});
 await page.goto(`${base}/${id.replace('/','-')}-${renderer}/html/${html}/index.html`);await page.getByRole('button',{name:/start/i}).click({timeout:5000}).catch(()=>{});
 const canvas=page.locator('canvas').first();let k=0;const shot=async()=>{const png=await canvas.screenshot();await writeFile(join(out,`${id.replace('/','-')}-${renderer}-${k++}.png`),png);return png;};
 const box=await canvas.boundingBox(),r=await checks[id](page,shot,logs,{move:(x,y)=>page.mouse.move(box.x+x*box.width/960,box.y+y*box.height/540),down:()=>page.mouse.down(),up:()=>page.mouse.up()});r.errors=errors;r.pass=r.pass&&!errors.length;report[`${id}-${renderer}`]=r;await page.close();
 if(!r.pass&&attempt<2&&errors.length&&errors.every(e=>/ERR_CONNECTION_RESET/.test(e))){console.log(`retry ${id} ${renderer}: connection reset`);continue;}if(!r.pass)failed++;
 console.log(`${r.pass?'PASS':'FAIL'} ${id} ${renderer} ${JSON.stringify(r.values)} ${errors.join(' | ').slice(0,300)}`);
 break;}
}}finally{await browser.close();}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,1)+'\n');if(failed)process.exitCode=1;
