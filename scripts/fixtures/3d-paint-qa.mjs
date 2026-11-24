// Plays the Paint example as an HTML export on WebGL and WebGPU with a real mouse: strokes dragged across the ball,
// the box and the board leave paint right under the pointer path, a swatch changes the brush and Clear wipes it.
// Writes outputs/paint3d-qa.
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve('.'),out=join(root,'outputs/paint3d-qa'),base='http://127.0.0.1:5209/paint3d-qa',sharp=createRequire(join(root,'apps/editor-desktop/package.json'))('sharp');
const screen=(eye,pitch,[x,y,z])=>{const t=-pitch*Math.PI/180,dx=x-eye[0],dy=y-eye[1],dz=z-eye[2],cy=dy*Math.cos(t)-dz*Math.sin(t),cz=dy*Math.sin(t)+dz*Math.cos(t),f=270/Math.tan(22.5*Math.PI/180);return[480+dx/-cz*f,270-cy/-cz*f];};
const eye=[0,2.6,7],pitch=-16,report={};
// Share of sample points along each stroke whose pixel matches `test`.
const onPath=async(png,paths,test)=>{const {data,info}=await sharp(png).resize(960,540).raw().toBuffer({resolveWithObject:true});let hit=0,n=0;for(const [a,b] of paths)for(let k=1;k<10;k++){const x=Math.round(a[0]+(b[0]-a[0])*k/10),y=Math.round(a[1]+(b[1]-a[1])*k/10),o=(y*960+x)*info.channels;n++;if(test(data[o],data[o+1],data[o+2]))hit++;}return +(hit/n).toFixed(2);};
const red=(r,g,b)=>r>180&&g<120&&b<130,yellow=(r,g,b)=>r>180&&g>160&&b<110;
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-webgpu']});
try{for(const renderer of ['webgl','webgpu']){
 const dir=join(out,`paint-${renderer}`);await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
 const project=JSON.parse(await readFile(join(root,'examples/pixi3d-paint/Paint.pixieditor'),'utf8'));project.extensions['pixi.render']={version:1,renderer};
 await writeFile(join(dir,'qa.pixieditor'),JSON.stringify(project));await cp(join(root,'examples/pixi3d-paint/Paint.pixieditor.assets'),join(dir,'qa.pixieditor.assets'),{recursive:true}).catch(()=>{});
 execFileSync(process.execPath,[join(root,'scripts/fixtures/3d-project-export.mjs'),join(dir,'qa.pixieditor'),join(dir,'html')],{cwd:root,stdio:'pipe'});
 const html=(await readdir(join(dir,'html'))).find(n=>n.startsWith('Pixi-HTML-'));
 const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`${base}/paint-${renderer}/html/${html}/index.html`);await page.getByRole('button',{name:/start/i}).click({timeout:5000}).catch(()=>{});await page.waitForTimeout(2500);
 const canvas=page.locator('canvas').first(),box=await canvas.boundingBox(),to=([x,y])=>[box.x+x*box.width/960,box.y+y*box.height/540];
 const drag=async(a,b)=>{await page.mouse.move(...to(a));await page.mouse.down();for(let k=1;k<=12;k++){await page.mouse.move(...to([a[0]+(b[0]-a[0])*k/12,a[1]+(b[1]-a[1])*k/12]));await page.waitForTimeout(16);}await page.mouse.up();await page.waitForTimeout(150);};
 const click=async p=>{await page.mouse.move(...to(p));await page.mouse.down();await page.mouse.up();await page.waitForTimeout(200);};
 const [bx,by]=screen(eye,pitch,[-2.4,1.1,1]),[cx,cy]=screen(eye,pitch,[0,1.3,.4]),[dx,dy]=screen(eye,pitch,[2.4,1.2,-.4]);
 const strokes=[[[bx-40,by-30],[bx+40,by+20]],[[cx-30,cy],[cx+30,cy]],[[dx-50,dy-40],[dx+40,dy+30]]];
 const before=await canvas.screenshot(),r={checks:{redBefore:await onPath(before,strokes,red)}};
 for(const [a,b] of strokes)await drag(a,b);const s1=await canvas.screenshot();await writeFile(join(out,`paint-${renderer}-red.png`),s1);r.checks.redOnPath=await onPath(s1,strokes,red);
 await click(screen(eye,pitch,[-.8,.22,2.2]));const yl=[[[dx-50,dy+40],[dx+40,dy-30]]];await drag(...yl[0]);const s2=await canvas.screenshot();await writeFile(join(out,`paint-${renderer}-yellow.png`),s2);r.checks.yellowOnPath=await onPath(s2,yl,yellow);
 await click(screen(eye,pitch,[2.6,.12,2.2]));const s3=await canvas.screenshot();await writeFile(join(out,`paint-${renderer}-cleared.png`),s3);r.checks.redAfterClear=await onPath(s3,strokes,red);
 r.errors=errors;r.pass=r.checks.redBefore<.1&&r.checks.redOnPath>=.8&&r.checks.yellowOnPath>=.6&&r.checks.redAfterClear<.1&&!errors.length;report[`paint-${renderer}`]=r;await page.close();
 console.log(`${r.pass?'PASS':'FAIL'} paint ${renderer} ${JSON.stringify(r.checks)} ${errors.join(' | ').slice(0,300)}`);
}}finally{await browser.close();}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,1)+'\n');
