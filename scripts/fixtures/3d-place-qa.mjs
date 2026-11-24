// Plays the Decals, Event flow and Attach examples as HTML exports on WebGL and WebGPU with a real mouse: clicks
// stamp decals, hovering cups enters the table group once, and a clicked crate rides the cart until the pad unloads it.
// Writes outputs/place3d-qa.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve('.'),out=join(root,'outputs/place3d-qa'),base='http://127.0.0.1:5209/place3d-qa',sharp=createRequire(join(root,'apps/editor-desktop/package.json'))('sharp');
const screen=(eye,pitch,[x,y,z])=>{const t=-pitch*Math.PI/180,dx=x-eye[0],dy=y-eye[1],dz=z-eye[2],cy=dy*Math.cos(t)-dz*Math.sin(t),cz=dy*Math.sin(t)+dz*Math.cos(t),f=270/Math.tan(22.5*Math.PI/180);return[480+dx/-cz*f,270-cy/-cz*f];};
const warm=async png=>{const {data,info}=await sharp(png).raw().toBuffer({resolveWithObject:true});let n=0;for(let i=0;i<data.length;i+=info.channels)if(data[i]>200&&data[i+2]<120&&data[i]-data[i+2]>110)n++;return n;};
const examples={'pixi3d-decals':'Decals','pixi3d-event-flow':'Event flow','pixi3d-attach':'Find and reparent'},report={};
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-webgpu']});
try{for(const [id,title] of Object.entries(examples))for(const renderer of ['webgl','webgpu']){
 const dir=join(out,`${id}-${renderer}`);await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
 const project=JSON.parse(await readFile(join(root,'examples',id,`${title}.pixieditor`),'utf8'));project.extensions['pixi.render']={version:1,renderer};
 await writeFile(join(dir,'qa.pixieditor'),JSON.stringify(project));await cp(join(root,'examples',id,`${title}.pixieditor.assets`),join(dir,'qa.pixieditor.assets'),{recursive:true}).catch(()=>{});
 execFileSync(process.execPath,[join(root,'scripts/fixtures/3d-project-export.mjs'),join(dir,'qa.pixieditor'),join(dir,'html')],{cwd:root,stdio:'pipe'});
 const html=(await readdir(join(dir,'html'))).find(n=>n.startsWith('Pixi-HTML-'));
 const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`${base}/${id}-${renderer}/html/${html}/index.html`);await page.getByRole('button',{name:/start/i}).click({timeout:5000}).catch(()=>{});await page.waitForTimeout(2500);
 const canvas=page.locator('canvas').first(),box=await canvas.boundingBox(),to=([x,y])=>[box.x+x*box.width/960,box.y+y*box.height/540],ids=Object.fromEntries(project.scenes[0].entities.map(e=>[e.name,e.id]));
 const state=()=>page.evaluate(()=>{const h=document.querySelector('[data-poses]');return{poses:JSON.parse(h?.dataset.poses??'{}'),texts:Object.values(JSON.parse(h?.dataset.texts??'{}'))};});
 const click=async p=>{await page.mouse.move(...to(p),{steps:3});await page.mouse.down();await page.mouse.up();await page.waitForTimeout(200);};
 const r={checks:{}};let pass=false;
 if(id==='pixi3d-decals'){const eye=[0,3.4,7.5],pitch=-22,before=await warm(await canvas.screenshot());for(const p of [[-2.5,1.4,-2.3],[-1,0,2],[2,0,1.6],[0,1.4,-2.3]])await click(screen(eye,pitch,p));const s=await canvas.screenshot();r.checks={before,after:await warm(s)};await writeFile(join(out,`${id}-${renderer}.png`),s);pass=r.checks.after>before+1500;}
 if(id==='pixi3d-event-flow'){const eye=[0,3.2,6.4],pitch=-24,cup=x=>screen(eye,pitch,[x,1.1,0]);await page.mouse.move(...to([480,500]));await page.waitForTimeout(200);
  await page.mouse.move(...to(cup(-.9)),{steps:3});await page.waitForTimeout(250);let s=await state();r.checks.onRed={text:s.texts.find(t=>t.startsWith('Table')),ring:s.poses[ids['Table ring']].active};await writeFile(join(out,`${id}-${renderer}.png`),await canvas.screenshot());
  await page.mouse.move(...to(cup(.9)),{steps:6});await page.waitForTimeout(250);s=await state();r.checks.onGreen={text:s.texts.find(t=>t.startsWith('Table')),ring:s.poses[ids['Table ring']].active};
  await page.mouse.move(...to([480,500]),{steps:3});await page.waitForTimeout(250);s=await state();r.checks.away={ring:s.poses[ids['Table ring']].active};
  pass=r.checks.onRed.text==='Table entered 1× · cups entered 1×'&&r.checks.onRed.ring&&r.checks.onGreen.text.startsWith('Table entered 1×')&&r.checks.onGreen.ring&&!r.checks.away.ring;}
 if(id==='pixi3d-attach'){const eye=[0,4.2,8],pitch=-26,ps=async()=>(await state()).poses,cart=ids['Cart'],crate=ids['Crate 1'];
  // World place of the crate: its own, plus the cart's while it rides (the cart group is neither turned nor scaled).
  // The cart only moves in x, so y and z show whether reparenting kept the crate where it was.
  const at=async()=>{const p=await ps(),c=p[crate],on=c.parentId===cart;return{x:on?p[cart].x+c.x:c.x,y:on?p[cart].y+c.y:c.y,z:on?p[cart].z+c.z:c.z,parentId:c.parentId};};
  const rebuilds=()=>page.evaluate(()=>JSON.parse(document.querySelector('[data-spatial3d]')?.dataset.spatial3d??'{}').rebuilds);
  const start=await at(),r0=await rebuilds();await click(screen(eye,pitch,[-2.6,.3,1.6]));await page.waitForTimeout(100);const loaded=await at();
  await page.waitForTimeout(700);const a=await at();await page.waitForTimeout(500);const b=await at();await click(screen(eye,pitch,[0,0,2.4]));await page.waitForTimeout(300);const c=await at();await page.waitForTimeout(600);const d=await at();
  r.checks={start:+start.x.toFixed(3),jumpOnLoadYZ:+Math.hypot(loaded.y-start.y,loaded.z-start.z).toFixed(6),ridingMoves:+(b.x-a.x).toFixed(3),afterDrop:[+c.x.toFixed(3),+d.x.toFixed(3)],parents:[start.parentId===cart,a.parentId===cart,c.parentId===cart],rebuilds:[r0,await rebuilds()]};await writeFile(join(out,`${id}-${renderer}.png`),await canvas.screenshot());
  pass=r.checks.jumpOnLoadYZ<1e-4&&Math.abs(b.x-a.x)>.05&&Math.abs(d.x-c.x)<1e-6&&Math.abs(c.x-start.x)>.01&&!r.checks.parents[0]&&r.checks.parents[1]&&!r.checks.parents[2]&&r.checks.rebuilds[0]===r.checks.rebuilds[1];}
 r.errors=errors;r.pass=pass&&!errors.length;report[`${id}-${renderer}`]=r;await page.close();
 console.log(`${r.pass?'PASS':'FAIL'} ${id} ${renderer} ${JSON.stringify(r.checks)} ${errors.join(' | ').slice(0,300)}`);
}}finally{await browser.close();}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,1)+'\n');
