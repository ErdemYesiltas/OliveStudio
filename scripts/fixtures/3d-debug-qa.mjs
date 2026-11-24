// Plays the F9 Hub examples as HTML exports on WebGL and WebGPU: hover outlines (a skinned model included) with a real
// mouse, wireframe overlay colours, bounding boxes and the velocity debug view. Writes outputs/debug3d-qa.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve('.'),out=join(root,'outputs/debug3d-qa'),base='http://127.0.0.1:5209/debug3d-qa',sharp=createRequire(join(root,'apps/editor-desktop/package.json'))('sharp');
const screen=(eye,pitch,[x,y,z])=>{const t=-pitch*Math.PI/180,dx=x-eye[0],dy=y-eye[1],dz=z-eye[2],cy=dy*Math.cos(t)-dz*Math.sin(t),cz=dy*Math.sin(t)+dz*Math.cos(t),f=270/Math.tan(22.5*Math.PI/180);return[480+dx/-cz*f,270-cy/-cz*f];};
const examples={'pixi3d-outlines':'Outlines','pixi3d-wireframe-overlay':'Wireframe overlay','pixi3d-bounds':'Bounding boxes','pixi3d-motion-view':'Motion blur and velocity view'};
const count=async(png,[x0,y0,x1,y1],test)=>{const {data,info}=await sharp(png).resize(960,540).raw().toBuffer({resolveWithObject:true});let n=0;for(let y=Math.max(0,Math.round(y0));y<Math.min(540,y1);y++)for(let x=Math.max(0,Math.round(x0));x<Math.min(960,x1);x++){const o=(y*960+x)*info.channels;if(test(data[o],data[o+1],data[o+2]))n++;}return n;};
const near=(r,g,b,[R,G,B],d=60)=>Math.abs(r-R)+Math.abs(g-G)+Math.abs(b-B)<d;
const report={};
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-webgpu']});
try{for(const [id,title] of Object.entries(examples))for(const renderer of ['webgl','webgpu']){
 const dir=join(out,`${id}-${renderer}`);await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
 const project=JSON.parse(await readFile(join(root,'examples',id,`${title}.pixieditor`),'utf8'));project.extensions['pixi.render']={version:1,renderer};
 await writeFile(join(dir,'qa.pixieditor'),JSON.stringify(project));await cp(join(root,'examples',id,`${title}.pixieditor.assets`),join(dir,'qa.pixieditor.assets'),{recursive:true}).catch(()=>{});
 execFileSync(process.execPath,[join(root,'scripts/fixtures/3d-project-export.mjs'),join(dir,'qa.pixieditor'),join(dir,'html')],{cwd:root,stdio:'pipe'});
 const html=(await readdir(join(dir,'html'))).find(n=>n.startsWith('Pixi-HTML-'));
 const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`${base}/${id}-${renderer}/html/${html}/index.html`);await page.getByRole('button',{name:/start/i}).click({timeout:5000}).catch(()=>{});await page.waitForTimeout(2500);
 const canvas=page.locator('canvas').first(),box=await canvas.boundingBox(),shot=()=>canvas.screenshot(),to=([x,y])=>[box.x+x*box.width/960,box.y+y*box.height/540];
 const r={checks:{}};
 if(id==='pixi3d-outlines'){const eye=[0,1.6,6.4],pitch=-10,orange=(R,G,B)=>near(R,G,B,[255,154,42],90),area=([x,y],w=90,h=110)=>[x-w,y-h,x+w,y+h/2];
  const knot=screen(eye,pitch,[-.9,0,0]),tent=screen(eye,pitch,[2.6,-.2,0]);await page.mouse.move(...to([480,500]));await page.waitForTimeout(300);let s=await shot();
  r.checks.knotBefore=await count(s,area(knot),orange);r.checks.tentacleBefore=await count(s,area(tent,110,150),orange);r.checks.toonInk=await count(s,area(screen(eye,pitch,[-2.7,0,0])),orange);
  await page.mouse.move(...to(knot),{steps:4});await page.waitForTimeout(300);s=await shot();await writeFile(join(out,`${id}-${renderer}-hover.png`),s);r.checks.knotHover=await count(s,area(knot),orange);
  await page.mouse.move(...to(tent),{steps:4});await page.waitForTimeout(300);s=await shot();await writeFile(join(out,`${id}-${renderer}-tentacle.png`),s);r.checks.knotAfterLeave=await count(s,area(knot),orange);r.checks.tentacleHover=await count(s,area(tent,110,150),orange);
  r.pass=r.checks.knotBefore<10&&r.checks.knotHover>150&&r.checks.knotAfterLeave<10&&r.checks.tentacleBefore<10&&r.checks.tentacleHover>150&&r.checks.toonInk>150;}
 const s=await shot();await page.waitForTimeout(400);const s2=await shot();r.checks.animates=!s.equals(s2);
 if(id==='pixi3d-wireframe-overlay'){const eye=[0,1.3,6.2],pitch=-8,at=p=>{const [x,y]=screen(eye,pitch,p);return[x-80,y-90,x+80,y+70];};
  r.checks.torusMagenta=await count(s,at([.9,0,0]),(R,G,B)=>near(R,G,B,[255,60,210],90));r.checks.tentacleGreen=await count(s,at([2.6,.3,0]),(R,G,B)=>near(R,G,B,[60,255,138],110));r.checks.sphereWhite=await count(s,at([-2.7,0,0]),(R,G,B)=>R>205&&G>205&&B>205);
  r.pass=r.checks.torusMagenta>80&&r.checks.tentacleGreen>80&&r.checks.sphereWhite>80;}
 // ACES tone mapping pales the thin lines, so match by hue, not exact colour.
 if(id==='pixi3d-bounds'){r.checks.yellow=await count(s,[0,100,960,500],(R,G,B)=>R>150&&G>140&&B<R-50);r.checks.green=await count(s,[0,100,960,500],(R,G,B)=>G>140&&G>R+25&&G>B+15);r.checks.pink=await count(s,[0,100,960,500],(R,G,B)=>R>160&&B>130&&G<R-40);
  r.pass=r.checks.yellow>60&&r.checks.green>60&&r.checks.pink>60&&r.checks.animates;}
 if(id==='pixi3d-motion-view'){r.checks.velocityColoured=await count(s,[490,60,950,480],(R,G,B)=>Math.max(R,G,B)>120&&Math.max(R,G,B)-Math.min(R,G,B)>100);r.pass=r.checks.velocityColoured>20000&&r.checks.animates;}
 await writeFile(join(out,`${id}-${renderer}.png`),s2);r.errors=errors;r.pass=Boolean(r.pass)&&!errors.length;report[`${id}-${renderer}`]=r;await page.close();
 console.log(`${r.pass?'PASS':'FAIL'} ${id} ${renderer} ${JSON.stringify(r.checks)} ${errors.join(' | ')}`);
}}finally{await browser.close();}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,1)+'\n');
