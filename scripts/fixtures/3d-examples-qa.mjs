// Plays the examples added for features that already existed as HTML exports on WebGL and WebGPU: every one runs
// without errors and draws, the animated ones move, and each post-processing pair differs between its Off (left) and On
// (right) halves, which show the same scene. Writes outputs/examples3d-qa.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve('.'),out=join(root,'outputs/examples3d-qa'),base='http://127.0.0.1:5209/examples3d-qa',sharp=createRequire(join(root,'apps/editor-desktop/package.json'))('sharp');
const ids=process.argv.slice(2).length?process.argv.slice(2):['pixi3d-bloom','pixi3d-ssao','pixi3d-depth-of-field','pixi3d-tilt-shift','pixi3d-antialiasing','pixi3d-effect-stack','pixi3d-hierarchy','pixi3d-transforms','pixi3d-hello-cube','pixi3d-model-viewer','pixi3d-gltf','pixi3d-model-materials','pixi3d-batching','pixi3d-instance-data'];
const screen=(eye,pitch,[x,y,z])=>{const t=-pitch*Math.PI/180,dx=x-eye[0],dy=y-eye[1],dz=z-eye[2],cy=dy*Math.cos(t)-dz*Math.sin(t),cz=dy*Math.sin(t)+dz*Math.cos(t),f=270/Math.tan(22.5*Math.PI/180);return[480+dx/-cz*f,270-cy/-cz*f];};
const count=async(png,[x0,y0,x1,y1],test)=>{const {data,info}=await raw(png);let n=0;for(let y=Math.max(0,Math.round(y0));y<Math.min(540,y1);y++)for(let x=Math.max(0,Math.round(x0));x<Math.min(960,x1);x++){const o=(y*960+x)*info.channels;if(test(data[o],data[o+1],data[o+2]))n++;}return n;};
const box=(c,w,h)=>[c[0]-w,c[1]-h,c[0]+w,c[1]+h];
/** Per-example checks on the settled frame: what each one is meant to show, measured in pixels. */
const special={
 'pixi3d-render-state':async png=>{const wall=screen([0,1.8,6.5],-10,[-2.4,0,0]);const orange=await count(png,box(wall,60,60),(r,g,b)=>r>150&&g<130&&b<110);return{crateThroughWall:orange,pass:orange>500};},
 'pixi3d-gltf-scenes':async png=>{const e=[0,1.4,5.2],p=-8,win=x=>box(screen(e,p,[x,.4,0]),80,45),warm=(r,g,b)=>r>215&&g>210&&r-b>48,day=await count(png,win(-1.4),warm),night=await count(png,win(1.4),warm);return{windowDay:day,windowNight:night,pass:night>60&&day<night/3};},
 'pixi3d-compression':async png=>{const e=[0,1.2,5],p=-8,rocks=await Promise.all([-2,0,2].map(x=>count(png,box(screen(e,p,[x,0,0]),70,60),(r,g)=>Math.abs(r-g)<30&&r>40&&r<200)));return{rockPixels:rocks,pass:rocks.every(n=>n>2000)};},
};
const moving=new Set(['pixi3d-hierarchy','pixi3d-hello-cube','pixi3d-model-viewer','pixi3d-gltf','pixi3d-batching']);
const raw=async png=>(await sharp(png).resize(960,540).raw().toBuffer({resolveWithObject:true}));
/** Mean absolute difference per channel between the left and right 480 × 460 views (rows 40–500). */
const halves=async png=>{const {data,info}=await raw(png);let sum=0,n=0;for(let y=40;y<500;y++)for(let x=0;x<480;x++){const a=(y*960+x)*info.channels,b=(y*960+x+480)*info.channels;for(let c=0;c<3;c++){sum+=Math.abs(data[a+c]-data[b+c]);n++;}}return sum/n;};
const lit=async png=>{const {data,info}=await raw(png);let n=0;for(let i=0;i<data.length;i+=info.channels)if(data[i]+data[i+1]+data[i+2]>90)n++;return n;};
const catalog=JSON.parse(await readFile(join(root,'examples/catalog.json'),'utf8')).examples,report={};
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-webgpu']});
try{for(const id of ids)for(const renderer of ['webgl','webgpu']){
 const entry=catalog.find(e=>e.id===id),file=join(root,'examples',entry.file),dir=join(out,`${id}-${renderer}`);await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
 const project=JSON.parse(await readFile(file,'utf8'));project.extensions['pixi.render']={version:1,renderer};
 await writeFile(join(dir,'qa.pixieditor'),JSON.stringify(project));await cp(file+'.assets',join(dir,'qa.pixieditor.assets'),{recursive:true}).catch(()=>{});
 execFileSync(process.execPath,[join(root,'scripts/fixtures/3d-project-export.mjs'),join(dir,'qa.pixieditor'),join(dir,'html')],{cwd:root,stdio:'pipe'});
 const html=(await readdir(join(dir,'html'))).find(n=>n.startsWith('Pixi-HTML-'));
 const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`${base}/${id}-${renderer}/html/${html}/index.html`);await page.getByRole('button',{name:/start/i}).click({timeout:5000}).catch(()=>{});await page.waitForTimeout(3000);
 const canvas=page.locator('canvas').first(),a=await canvas.screenshot();await page.waitForTimeout(500);const b=await canvas.screenshot();
 const r={checks:{lit:await lit(b),animates:!a.equals(b)}};let pass=r.checks.lit>(id==='pixi3d-hierarchy'?5000:20000);
 if(moving.has(id))pass&&=r.checks.animates;
 if(special[id]){const sp=await special[id](b);r.checks.special=sp;pass&&=sp.pass;}
 if(entry.category==='Post-processing'&&id!=='pixi3d-outlines'){r.checks.offOnDifference=+(await halves(b)).toFixed(2);// FXAA and ambient occlusion are subtle by nature; the others change the picture a lot.
 pass&&=r.checks.offOnDifference>({'pixi3d-antialiasing':.15,'pixi3d-ssao':1}[id]??1.5);}
 await writeFile(join(out,`${id}-${renderer}.png`),b);r.errors=errors;r.pass=pass&&!errors.length;report[`${id}-${renderer}`]=r;await page.close();
 console.log(`${r.pass?'PASS':'FAIL'} ${id} ${renderer} ${JSON.stringify(r.checks)} ${errors.join(' | ').slice(0,300)}`);
}}finally{await browser.close();}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,1)+'\n');
