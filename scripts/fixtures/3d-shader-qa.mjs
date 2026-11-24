// S3 (Shader 3D) in exported HTML on WebGL and WebGPU: the shapes scripts build with game.geometry draw.
// - Extra bits: stripes on the PBR shapes, moving with game time. Own material: the hologram's tinted pattern.
// - Lighting model: the right knot shades warm and cool, the built-in one beside it does not.
// - Projected textures: cloud shadows on the ground, drifting.
// - Broken (the stripes shader with an undefined name): the shapes fall back to their own material, the rest of the
//   scene still draws, and the warning names the user's section and line.
// Writes outputs/shader3d-qa (serve outputs/ on port 5209 first).
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve('.'),out=join(root,'outputs/shader3d-qa'),base='http://127.0.0.1:5209/shader3d-qa',sharp=createRequire(join(root,'apps/editor-desktop/package.json'))('sharp');
const pixels=async png=>(await sharp(png).resize(960,540).raw().toBuffer({resolveWithObject:true})).data;
const count=async(png,[x0,y0,x1,y1],test)=>{const d=await pixels(png);let n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const o=(y*960+x)*3;if(test(d[o],d[o+1],d[o+2]))n++;}return n;};
const changed=async(a,b)=>{const x=await pixels(a),y=await pixels(b);let d=0;for(let i=0;i<x.length;i++)d+=Math.abs(x[i]-y[i]);return +(d/x.length).toFixed(2);};
const checks={
 async 'pixi3d-shader-extra-bits'(page,shot){await page.waitForTimeout(2000);const a=await shot();await page.waitForTimeout(500);const b=await shot();
  // Thresholds from sampled pixels: a lit yellow stripe on the knot is about (172, 152, 104).
  const stripe=(r,g,b)=>r>150&&g>130&&b<130&&r-b>50,white=(r,g,b)=>r>215&&g>215&&b>215;const v={yellowStripes:await count(a,[220,220,400,320],stripe),whiteStripes:await count(a,[380,120,600,400],white),moved:await changed(a,b)};
  return{values:v,pass:v.yellowStripes>150&&v.whiteStripes>1000&&v.moved>.3};},
 async 'pixi3d-shader-extra-bits/broken'(page,shot,logs,mouse,warnings){await page.waitForTimeout(2200);const a=await shot();
  const orange=(r,g,b)=>r>170&&g>80&&g<150&&b<110,stripe=(r,g,b)=>r>200&&g>170&&b<110;
  const v={orangeBall:await count(a,[380,120,600,400],orange),stripes:await count(a,[150,120,420,400],stripe),floor:await count(a,[0,420,960,540],(r,g,b)=>b>60&&r<110),warning:warnings.find(w=>/does not compile/.test(w))?.slice(0,200)??null};
  return{values:v,pass:v.orangeBall>3000&&v.stripes<50&&v.floor>20000&&/material line 2/.test(v.warning??'')};},
 async 'pixi3d-shader-material'(page,shot){await page.waitForTimeout(2000);const a=await shot();const cyan=(r,g,b)=>b>150&&g>120&&r<120,pink=(r,g,b)=>r>150&&b>130&&g<130;
  const v={cyan:await count(a,[200,100,480,420],cyan),pink:await count(a,[500,100,800,420],pink)};return{values:v,pass:v.cyan>2000&&v.pink>2000};},
 async 'pixi3d-shader-lighting'(page,shot){await page.waitForTimeout(2000);const a=await shot();// Sampled: warm (220, 188, 170) and cool (132, 120, 174) on the shaded knot, neutral (207, 212, 220) on the built-in one; the floor is excluded by brightness.
  const warm=(r,g,b)=>r>170&&r-b>30,cool=(r,g,b)=>b-r>35&&r>100&&g<150;
  const v={rightWarm:await count(a,[560,230,720,360],warm),rightCool:await count(a,[560,230,720,360],cool),leftWarm:await count(a,[240,230,400,360],warm),leftCool:await count(a,[240,230,400,360],cool)};
  return{values:v,pass:v.rightWarm>150&&v.rightCool>150&&v.leftWarm<v.rightWarm/5&&v.leftCool<v.rightCool/5};},
 async 'pixi3d-shader-projected'(page,shot){await page.waitForTimeout(1500);const a=await shot();await page.waitForTimeout(1200);const b=await shot();
  // Sampled: lit ground (153, 190, 148), under a cloud (118, 159, 116).
  const shade=(r,g)=>g<172&&g>r+28,light=(r,g)=>g>182&&g>r+25;const v={shadowed:await count(a,[0,300,960,540],shade),lit:await count(a,[0,300,960,540],light),drift:await changed(a,b)};
  return{values:v,pass:v.shadowed>8000&&v.lit>8000&&v.drift>.15};},
};

const catalog=JSON.parse(await readFile(join(root,'examples/catalog.json'),'utf8')).examples,report={};let failed=0;
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-webgpu']});
try{for(const id of Object.keys(checks))for(const renderer of ['webgl','webgpu']){
 const [exampleId,variant]=id.split('/'),entry=catalog.find(e=>e.id===exampleId),file=join(root,'examples',entry.file),dir=join(out,`${id.replace('/','-')}-${renderer}`);await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
 const project=JSON.parse(await readFile(file,'utf8'));project.extensions['pixi.render']={version:1,renderer};if(variant==='broken')for(const s of project.extensions['pixi3d.shaders'].items){s.wgsl.material=`  // broken on purpose\n  albedo *= nope_shade;`;s.glsl.material=`  // broken on purpose\n  albedo *= nope_shade;`;}
 await writeFile(join(dir,'qa.pixieditor'),JSON.stringify(project));await cp(file+'.assets',join(dir,'qa.pixieditor.assets'),{recursive:true}).catch(()=>{});
 execFileSync(process.execPath,[join(root,'scripts/fixtures/3d-project-export.mjs'),join(dir,'qa.pixieditor'),join(dir,'html')],{cwd:root,stdio:'pipe'});
 const html=(await readdir(join(dir,'html'))).find(n=>n.startsWith('Pixi-HTML-'));
 // The local Python file server sometimes resets a connection; such a case runs once more (other errors never do).
 for(let attempt=1;;attempt++){
 const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[],logs=[],warnings=[];page.on('console',m=>{if(m.type()==='warning'&&m.text().startsWith('[3D]'))warnings.push(m.text());});page.on('console',m=>{if(m.text().startsWith('[script]'))logs.push(m.text());});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'||/^\[script\]/.test(m.text())&&m.type()!=='log')errors.push(m.text());});
 await page.goto(`${base}/${id.replace('/','-')}-${renderer}/html/${html}/index.html`);await page.getByRole('button',{name:/start/i}).click({timeout:5000}).catch(()=>{});
 const canvas=page.locator('canvas').first();let k=0;const shot=async()=>{const png=await canvas.screenshot();await writeFile(join(out,`${id.replace('/','-')}-${renderer}-${k++}.png`),png);return png;};
 const box=await canvas.boundingBox(),r=await checks[id](page,shot,logs,{move:(x,y)=>page.mouse.move(box.x+x*box.width/960,box.y+y*box.height/540),down:()=>page.mouse.down(),up:()=>page.mouse.up()},warnings);r.errors=errors;r.pass=r.pass&&!errors.length;report[`${id}-${renderer}`]=r;await page.close();
 if(!r.pass&&attempt<2&&errors.length&&errors.every(e=>/ERR_CONNECTION_RESET/.test(e))){console.log(`retry ${id} ${renderer}: connection reset`);continue;}if(!r.pass)failed++;
 console.log(`${r.pass?'PASS':'FAIL'} ${id} ${renderer} ${JSON.stringify(r.values)} ${errors.join(' | ').slice(0,300)}`);
 break;}
}}finally{await browser.close();}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,1)+'\n');if(failed)process.exitCode=1;
