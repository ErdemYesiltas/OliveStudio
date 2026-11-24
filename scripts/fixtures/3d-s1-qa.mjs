// S1 (3D scripts) in exported HTML on WebGL and WebGPU, with real mouse input:
// - Keyframes in code: the tiles assemble from script-built tracks; pressing a tile (game.raycast) makes only that tile
//   hop while the logo stays; pressing empty space replays the tracks from the start (the logo breaks up).
// - Model lifetime: Hide keeps the model file loaded; Unload frees it (the 3D view holds no model file); Bring back
//   loads it again and the castle is drawn.
// Writes outputs/s1-qa (serve outputs/ on port 5209 first).
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {probeProject,probeEye} from './s1-probe.mjs';
const root=resolve('.'),out=join(root,'outputs/s1-qa'),base='http://127.0.0.1:5209/s1-qa',sharp=createRequire(join(root,'apps/editor-desktop/package.json'))('sharp');
const screen=(eye,pitch,[x,y,z])=>{const t=-pitch*Math.PI/180,dx=x-eye[0],dy=y-eye[1],dz=z-eye[2],cy=dy*Math.cos(t)-dz*Math.sin(t),cz=dy*Math.sin(t)+dz*Math.cos(t),f=270/Math.tan(22.5*Math.PI/180);return[480+dx/-cz*f,270-cy/-cz*f];};
const box=(c,w,h)=>[c[0]-w,c[1]-h,c[0]+w,c[1]+h];
const count=async(png,[x0,y0,x1,y1],test)=>{const {data,info}=await sharp(png).resize(960,540).raw().toBuffer({resolveWithObject:true});let n=0;for(let y=Math.max(0,Math.round(y0));y<Math.min(540,y1);y++)for(let x=Math.max(0,Math.round(x0));x<Math.min(960,x1);x++){const o=(y*960+x)*info.channels;if(test(data[o],data[o+1],data[o+2]))n++;}return n;};
const green=(r,g,b)=>g>90&&g>r+8&&g>b+15;
const castleColour=(r,g,b)=>(r>150&&g>140&&b>110&&Math.abs(r-g)<40)||(r>130&&g<90&&b<90);
const checks={
 async 'pixi3d-keyframes'(page,click,shot){
  const eye=[0,1.2,7.5],pitch=-6,logo=box(screen(eye,pitch,[0,.4,0]),150,150),tile=screen(eye,pitch,[-1.24,1.64,0]),tileArea=box(tile,40,40);
  await page.waitForTimeout(3200);const assembled=await shot(),g0=await count(assembled,logo,green),t0=await count(assembled,tileArea,green);
  await click(tile[0],tile[1]);await page.waitForTimeout(350);const kicked=await shot(),g1=await count(kicked,logo,green),t1=await count(kicked,tileArea,green);
  // Bigger and turned: the pressed tile covers a different area than before; the rest of the logo stays.
  await page.waitForTimeout(900);const settled=await shot(),t2=await count(settled,tileArea,green);
  const empty=screen(eye,pitch,[-3.2,.4,0]);await click(empty[0],empty[1]);await page.waitForTimeout(400);const replay=await shot(),g3=await count(replay,logo,green);
  return{values:{assembled:g0,tileBefore:t0,afterTilePress:g1,tilePressed:t1,tileSettled:t2,afterReplay:g3},pass:g0>40000&&g1>g0*.8&&Math.abs(t1-t0)>t0*.2&&Math.abs(t2-t0)<t0*.1&&g3<g0*.5};
 },
 // The probe copy of Keyframes: hover enter/leave, game.pointer3d, a drag's drop and lookAt in the real runtime.
 async 's1-probe'(page,click,shot,logs,mouse){
  const eye=[0,1.2,7.5],pitch=-6,at=screen(eye,pitch,probeEye),tile=screen(eye,pitch,[-1.24,1.64,0]);
  await page.waitForTimeout(3000);await mouse.move(...at);await page.waitForTimeout(300);await mouse.move(...tile);await page.waitForTimeout(300);await mouse.move(100,100);await page.waitForTimeout(300);
  await mouse.move(...at);await page.waitForTimeout(200);await mouse.down();for(let k=1;k<=10;k++){await mouse.move(at[0]+k*8,at[1]);await page.waitForTimeout(16);}await mouse.up();await page.waitForTimeout(300);await shot();
  const text=logs.join('\n'),count=re=>(text.match(re)||[]).length,dot=Number(/lookdot (\S+)/.exec(text)?.[1]),x=Number(/dropped Probe eye (\S+)/.exec(text)?.[1]);
  const values={enters:count(/enter Probe eye/g),leaves:count(/leave Probe eye/g),drops:count(/dropped Probe eye/g),droppedX:x,lookDot:dot,pointer3d:[...text.matchAll(/pointer3d (.+)/g)].map(m=>m[1])};
  return{values,pass:values.enters>=2&&values.leaves>=1&&values.drops===1&&x>3.2&&dot>.999&&['Probe eye','Tile 1','-'].every(n=>values.pointer3d.includes(n))};
 },
 // S0b: the reflection keeps left and right (red left, blue right inside the glass) and follows an orbit drag.
 async 'pixi3d-mirror'(page,click,shot,logs,mouse){
  const eye=[0,1.7,5.5],pitch=-9,[l,t]=screen(eye,pitch,[-1.5,2.25,-2]),[r,bm]=screen(eye,pitch,[1.5,.25,-2]),mid=(l+r)/2;
  const red=(R,G,B)=>R>150&&G<110&&B<100,blue=(R,G,B)=>B>150&&R<110&&G<160;
  await page.waitForTimeout(2500);const a=await shot();
  // Above the real blocks' tops (they stand in front of the glass's lower edge), so only reflections are counted.
  const top=Math.min(bm-6,screen(eye,pitch,[0,.72,-.3])[1]-4),glassLeft=[l+6,t+6,mid,top],glassRight=[mid,t+6,r-6,top];
  const v={redLeft:await count(a,glassLeft,red),redRight:await count(a,glassRight,red),blueLeft:await count(a,glassLeft,blue),blueRight:await count(a,glassRight,blue)};
  await mouse.move(480,470);await mouse.down();for(let k=1;k<=12;k++){await mouse.move(480+k*4,470);await page.waitForTimeout(16);}await mouse.up();await page.waitForTimeout(700);const b=await shot();
  const {data:da}=await sharp(a).resize(960,540).raw().toBuffer({resolveWithObject:true}),{data:db}=await sharp(b).resize(960,540).raw().toBuffer({resolveWithObject:true});let diff=0;for(let i=0;i<da.length;i++)diff+=Math.abs(da[i]-db[i]);
  v.orbitChange=+(diff/da.length).toFixed(2);
  return{values:v,pass:v.redLeft>300&&v.redRight<v.redLeft/10&&v.blueRight>300&&v.blueLeft<v.blueRight/10&&v.orbitChange>3};
 },
 async 'pixi3d-asset-lifetime'(page,click,shot){
  const eye=[0,2.6,7],pitch=-16,area=box(screen(eye,pitch,[0,.8,0]),190,120);
  const files=()=>page.evaluate(()=>{const d=JSON.parse(document.querySelector('[data-spatial3d]')?.dataset.spatial3d??'{}');return{resources:d.resources?.resources??-1,loaded:d.resources?.loaded??-1,models:(d.views??[]).flatMap(v=>v.models??[]).length};});
  const step=async(x,wait)=>{if(x!==null)await click(x,480);await page.waitForTimeout(wait);return{castle:await count(await shot(),area,castleColour),...await files()};};
  const start=await step(null,2500),hidden=await step(220,600),back=await step(740,300),unloaded=await step(480,900),reloaded=await step(740,2000);
  return{values:{start,hidden,back,unloaded,reloaded},pass:start.castle>3000&&start.loaded===1&&hidden.castle<start.castle*.05&&hidden.loaded===1&&back.castle>start.castle*.9&&unloaded.castle<start.castle*.05&&unloaded.resources===0&&unloaded.models===0&&reloaded.loaded===1&&reloaded.castle>start.castle*.9};
 },
};
const catalog=JSON.parse(await readFile(join(root,'examples/catalog.json'),'utf8')).examples,report={};
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-webgpu']});
let failed=0;
try{for(const id of Object.keys(checks))for(const renderer of ['webgl','webgpu']){
 const entry=catalog.find(e=>e.id===(id==='s1-probe'?'pixi3d-keyframes':id)),file=join(root,'examples',entry.file),dir=join(out,`${id}-${renderer}`);await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
 let project=JSON.parse(await readFile(file,'utf8'));if(id==='s1-probe')project=probeProject(project,root);project.extensions['pixi.render']={version:1,renderer};
 await writeFile(join(dir,'qa.pixieditor'),JSON.stringify(project));await cp(file+'.assets',join(dir,'qa.pixieditor.assets'),{recursive:true}).catch(()=>{});
 execFileSync(process.execPath,[join(root,'scripts/fixtures/3d-project-export.mjs'),join(dir,'qa.pixieditor'),join(dir,'html')],{cwd:root,stdio:'pipe'});
 const html=(await readdir(join(dir,'html'))).find(n=>n.startsWith('Pixi-HTML-'));
 const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[],logs=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());else if(m.text().startsWith('[script]'))logs.push(m.text());});
 await page.goto(`${base}/${id}-${renderer}/html/${html}/index.html`);await page.getByRole('button',{name:/start/i}).click({timeout:5000}).catch(()=>{});
 const canvas=page.locator('canvas').first(),rect=await canvas.boundingBox();
 const click=async(x,y)=>{await page.mouse.move(rect.x+x*rect.width/960,rect.y+y*rect.height/540);await page.mouse.down();await page.mouse.up();};
 let n=0;const shot=async()=>{const png=await canvas.screenshot();await writeFile(join(out,`${id}-${renderer}-${n++}.png`),png);return png;};
 const r=await checks[id](page,click,shot,logs,{move:(x,y)=>page.mouse.move(rect.x+x*rect.width/960,rect.y+y*rect.height/540),down:()=>page.mouse.down(),up:()=>page.mouse.up()});r.errors=errors;r.logs=logs.slice(0,20);r.pass=r.pass&&!errors.length;report[`${id}-${renderer}`]=r;if(!r.pass)failed++;await page.close();
 console.log(`${r.pass?'PASS':'FAIL'} ${id} ${renderer} ${JSON.stringify(r.values)} ${errors.join(' | ').slice(0,300)}`);
}}finally{await browser.close();}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,1)+'\n');
if(failed)process.exitCode=1;
