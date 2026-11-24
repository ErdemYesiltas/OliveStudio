// Plays the Look at and Raycast examples as HTML exports on WebGL and WebGPU: the watchers turn as the ball roams, and
// with a real mouse the cursor ring lands on the crate top, lies tilted on the ramp and drops to the ground past the
// objects. Writes outputs/look3d-qa.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve('.'),out=join(root,'outputs/look3d-qa'),base='http://127.0.0.1:5209/look3d-qa';
const screen=(eye,pitch,[x,y,z])=>{const t=-pitch*Math.PI/180,dx=x-eye[0],dy=y-eye[1],dz=z-eye[2],cy=dy*Math.cos(t)-dz*Math.sin(t),cz=dy*Math.sin(t)+dz*Math.cos(t),f=270/Math.tan(22.5*Math.PI/180);return[480+dx/-cz*f,270-cy/-cz*f];};
const examples={'pixi3d-look-at':'Look at','pixi3d-raycast':'Raycast'},report={};
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
 const pose=async name=>page.evaluate(id=>JSON.parse(document.querySelector('[data-poses]')?.dataset.poses??'{}')[id],ids[name]);
 const r={checks:{}};let pass=true;
 if(id==='pixi3d-look-at'){const a=await canvas.screenshot();await page.waitForTimeout(700);const b=await canvas.screenshot();r.checks.animates=!a.equals(b);await writeFile(join(out,`${id}-${renderer}.png`),b);pass=r.checks.animates;}
 else{const eye=[0,5,8.5],pitch=-30,at=async(p,name)=>{await page.mouse.move(...to(screen(eye,pitch,p)),{steps:3});await page.waitForTimeout(250);const q=await pose('Cursor ring');r.checks[name]={y:+q.y.toFixed(3),tilt:+(2*Math.acos(Math.min(1,Math.abs(q.qw)))*180/Math.PI).toFixed(1)};await writeFile(join(out,`${id}-${renderer}-${name}.png`),await canvas.screenshot());};
  await at([-1.6,1.2,0],'crateTop');await at([1.2,.55,.3],'ramp');await at([2.5,0,2.5],'ground');
  const c=r.checks;pass=Math.abs(c.crateTop.y-1.23)<.08&&c.crateTop.tilt<2&&Math.abs(c.ramp.tilt-25)<3&&c.ramp.y>.3&&Math.abs(c.ground.y-.03)<.02&&c.ground.tilt<1;}
 r.errors=errors;r.pass=pass&&!errors.length;report[`${id}-${renderer}`]=r;await page.close();
 console.log(`${r.pass?'PASS':'FAIL'} ${id} ${renderer} ${JSON.stringify(r.checks)} ${errors.join(' | ').slice(0,300)}`);
}}finally{await browser.close();}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,1)+'\n');
