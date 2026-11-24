// Plays the Particles Hub examples as HTML exports on WebGL and WebGPU: the campfire and fountains animate, a click on
// the button fires its burst, the world-space trail is longer than the local-space cloud and the flipbook sheet loads.
// Writes outputs/particles3d-qa.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve('.'),out=join(root,'outputs/particles3d-qa'),base='http://127.0.0.1:5209/particles3d-qa',sharp=createRequire(join(root,'apps/editor-desktop/package.json'))('sharp');
const screen=(eye,pitch,[x,y,z])=>{const t=-pitch*Math.PI/180,dx=x-eye[0],dy=y-eye[1],dz=z-eye[2],cy=dy*Math.cos(t)-dz*Math.sin(t),cz=dy*Math.sin(t)+dz*Math.cos(t),f=270/Math.tan(22.5*Math.PI/180);return[480+dx/-cz*f,270-cy/-cz*f];};
const examples={'pixi3d-particle-basics':'Particle basics','pixi3d-particle-spawn':'Spawn shapes and bursts','pixi3d-particle-flipbook':'Flipbook particles','pixi3d-particle-spaces':'Local and world space'};
// Pixels in a stage rectangle that pass `test` (r, g, b) on a 960 × 540 screenshot.
const count=async(png,[x0,y0,x1,y1],test)=>{const {data,info}=await sharp(png).resize(960,540).raw().toBuffer({resolveWithObject:true});let n=0;for(let y=Math.max(0,Math.round(y0));y<Math.min(540,y1);y++)for(let x=Math.max(0,Math.round(x0));x<Math.min(960,x1);x++){const o=(y*960+x)*info.channels;if(test(data[o],data[o+1],data[o+2]))n++;}return n;};
const spanX=async(png,[y0,y1],test)=>{const {data,info}=await sharp(png).resize(960,540).raw().toBuffer({resolveWithObject:true});let lo=960,hi=-1;for(let y=y0;y<y1;y++)for(let x=0;x<960;x++){const o=(y*960+x)*info.channels;if(test(data[o],data[o+1],data[o+2])){lo=Math.min(lo,x);hi=Math.max(hi,x);}}return hi<0?0:hi-lo;};
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
 const canvas=page.locator('canvas').first(),box=await canvas.boundingBox(),shot=()=>canvas.screenshot();
 const r={renderer:await page.evaluate(()=>document.querySelector('[data-renderer]')?.dataset.renderer??null),checks:{}};
 const a=await shot();await page.waitForTimeout(400);const b=await shot();r.checks.animates=!a.equals(b);
 if(id==='pixi3d-particle-spawn'){const eye=[0,2.6,8],pitch=-12,[bx,by]=screen(eye,pitch,[3,.25,1.2]),[,top]=screen(eye,pitch,[3,2.4,1.2]),area=[bx-110,top,bx+110,by-30],green=(R,G,B)=>G>150&&G>R+40&&G>B+40;
  r.checks.greenBefore=await count(a,area,green);await page.mouse.click(box.x+bx*box.width/960,box.y+by*box.height/540);await page.waitForTimeout(350);const c=await shot();r.checks.greenAfter=await count(c,area,green);await page.waitForTimeout(1600);r.checks.greenLater=await count(await shot(),area,green);
  await writeFile(join(out,`${id}-${renderer}-burst.png`),c);r.pass=r.checks.greenAfter>200&&r.checks.greenBefore<20&&r.checks.greenLater<20;}
 else if(id==='pixi3d-particle-spaces'){const eye=[0,1.4,7],pitch=-6,yl=Math.round(screen(eye,pitch,[0,1.7,0])[1]),yw=Math.round(screen(eye,pitch,[0,.2,0])[1]),bright=(R,G,B)=>R+G+B>360;
  r.checks.localWidth=await spanX(b,[yl-40,yl+40],bright);r.checks.worldWidth=await spanX(b,[yw-30,yw+30],bright);r.pass=r.checks.worldWidth>r.checks.localWidth*2&&r.checks.localWidth>30;}
 else if(id==='pixi3d-particle-flipbook'){r.checks.lit=await count(b,[100,120,860,460],(R,G,B)=>R+G+B>420);r.pass=r.checks.lit>3000;}
 else{r.checks.fire=await count(b,[380,180,580,420],(R,G)=>R>200&&G>120);r.pass=r.checks.fire>800;}
 await writeFile(join(out,`${id}-${renderer}.png`),b);r.errors=errors;r.pass=Boolean(r.pass)&&r.checks.animates&&!errors.length;report[`${id}-${renderer}`]=r;await page.close();
 console.log(`${r.pass?'PASS':'FAIL'} ${id} ${renderer} ${JSON.stringify(r.checks)} ${errors.join(' | ')}`);
}}finally{await browser.close();}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,1)+'\n');
