// Plays the Interaction Hub examples as HTML exports on WebGL and WebGPU and drives them with a real mouse: hover rings,
// click counters, ground and view-plane dragging with snapping, and the four hit volumes. Writes outputs/interaction3d-qa.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve('.'),out=join(root,'outputs/interaction3d-qa'),base='http://127.0.0.1:5209/interaction3d-qa';
const screen=(eye,pitch,[x,y,z])=>{const t=-pitch*Math.PI/180,dx=x-eye[0],dy=y-eye[1],dz=z-eye[2],cy=dy*Math.cos(t)-dz*Math.sin(t),cz=dy*Math.sin(t)+dz*Math.cos(t),f=270/Math.tan(22.5*Math.PI/180);return[480+dx/-cz*f,270-cy/-cz*f];};
const examples={'pixi3d-pointer-events':'Pointer events','pixi3d-dragging':'Dragging objects','pixi3d-hit-volumes':'Hit volumes'};
const report={};
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-webgpu']});
try{for(const [id,title] of Object.entries(examples))for(const renderer of ['webgl','webgpu']){
 const dir=join(out,`${id}-${renderer}`);await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
 const project=JSON.parse(await readFile(join(root,'examples',id,`${title}.pixieditor`),'utf8'));project.extensions['pixi.render']={version:1,renderer};
 await writeFile(join(dir,'qa.pixieditor'),JSON.stringify(project));await cp(join(root,'examples',id,`${title}.pixieditor.assets`),join(dir,'qa.pixieditor.assets'),{recursive:true});
 execFileSync(process.execPath,[join(root,'scripts/fixtures/3d-project-export.mjs'),join(dir,'qa.pixieditor'),join(dir,'html')],{cwd:root,stdio:'pipe'});
 const html=(await readdir(join(dir,'html'))).find(n=>n.startsWith('Pixi-HTML-'));
 const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`${base}/${id}-${renderer}/html/${html}/index.html`);await page.getByRole('button',{name:/start/i}).click({timeout:5000}).catch(()=>{});await page.waitForTimeout(2500);
 const box=await page.locator('canvas').first().boundingBox(),sx=box.width/960,sy=box.height/540,to=([x,y])=>[box.x+x*sx,box.y+y*sy];
 const state=()=>page.evaluate(()=>{const h=document.querySelector('[data-poses]');return{poses:JSON.parse(h?.dataset.poses??'{}'),texts:Object.values(JSON.parse(h?.dataset.texts??'{}'))};});
 const byName=Object.fromEntries(project.scenes[0].entities.map(e=>[e.name,e.id]));
 const move=async p=>{await page.mouse.move(...to(p),{steps:4});await page.waitForTimeout(120);},click=async p=>{await move(p);await page.mouse.down();await page.mouse.up();await page.waitForTimeout(120);};
 const r={renderer:await page.evaluate(()=>document.querySelector('[data-renderer]')?.dataset.renderer??null),checks:{}};
 if(id==='pixi3d-pointer-events'){const eye=[0,3.2,7.5],pitch=-20,cube=screen(eye,pitch,[-2.4,0,0]),ball=screen(eye,pitch,[0,0,0]);
  await move([480,120]);r.checks.ringOffAtStart=!(await state()).poses[byName['Cube ring']].active;
  await move(cube);r.checks.ringOnHover=(await state()).poses[byName['Cube ring']].active;
  await move(ball);const s=await state();r.checks.hoverMoves=!s.poses[byName['Cube ring']].active&&s.poses[byName['Ball ring']].active;
  for(let k=0;k<3;k++)await click(ball);await click(cube);r.checks.clicks=(await state()).texts.find(t=>t.startsWith('Clicks'));
  await move([480,120]);r.checks.ringOffAfterLeave=!(await state()).poses[byName['Ball ring']].active&&!(await state()).poses[byName['Cube ring']].active;
  r.pass=r.checks.ringOffAtStart&&r.checks.ringOnHover&&r.checks.hoverMoves&&r.checks.clicks==='Clicks: 4'&&r.checks.ringOffAfterLeave;}
 if(id==='pixi3d-dragging'){const eye=[0,5,7.5],pitch=-32,from=screen(eye,pitch,[-2,0,0]),target=screen(eye,pitch,[-1.1,0,2.2]);
  await move(from);await page.mouse.down();for(let k=1;k<=8;k++){await page.mouse.move(...to([from[0]+(target[0]-from[0])*k/8,from[1]+(target[1]-from[1])*k/8]));await page.waitForTimeout(30);}await page.mouse.up();await page.waitForTimeout(200);
  const crate=(await state()).poses[byName['Crate 1']];r.checks.crate={x:crate.x,y:crate.y,z:crate.z};
  const ballFrom=screen(eye,pitch,[0,1,-2]);await move(ballFrom);await page.mouse.down();await page.mouse.move(...to([ballFrom[0],ballFrom[1]-60]),{steps:6});await page.mouse.up();await page.waitForTimeout(200);
  const ball=(await state()).poses[byName['Ball']];r.checks.ball={x:ball.x,y:ball.y,z:ball.z};r.checks.drops=(await state()).texts.find(t=>t.startsWith('Drops'));
  await click(screen(eye,pitch,[2,0,-1]));r.checks.dropsAfterClick=(await state()).texts.find(t=>t.startsWith('Drops'));
  r.pass=Math.abs(crate.x+1)<1e-6&&Math.abs(crate.z-2)<1e-6&&Math.abs(crate.y)<1e-6&&ball.y>1.3&&r.checks.drops==='Drops: 2'&&r.checks.dropsAfterClick==='Drops: 2';}
 if(id==='pixi3d-hit-volumes'){const eye=[0,1.2,7.5],pitch=-6,xs={geometry:-3.3,box:-1.1,sphere:1.1,none:3.3};
  for(const x of Object.values(xs))await click(screen(eye,pitch,[x,.1,0]));
  r.checks.holes=(await state()).texts.filter(t=>/Hits|: \d/.test(t)&&!t.startsWith('Click'));
  for(const x of Object.values(xs))await click(screen(eye,pitch,[x,.1+.9*.83,0]));
  r.checks.bodies=(await state()).texts.filter(t=>/: \d/.test(t)&&!t.startsWith('Click'));
  r.pass=JSON.stringify(r.checks.holes)===JSON.stringify(['Geometry: 0','Box: 1','Sphere: 1','None: 0'])&&JSON.stringify(r.checks.bodies)===JSON.stringify(['Geometry: 1','Box: 2','Sphere: 2','None: 0']);}
 await page.screenshot({path:join(out,`${id}-${renderer}.png`)});r.errors=errors;r.pass=Boolean(r.pass)&&!errors.length;report[`${id}-${renderer}`]=r;await page.close();
 console.log(`${r.pass?'PASS':'FAIL'} ${id} ${renderer} ${JSON.stringify(r.checks)} ${errors.join(' | ')}`);
}}finally{await browser.close();}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,1)+'\n');
