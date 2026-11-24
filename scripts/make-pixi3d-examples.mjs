// Builds the Hub's PixiJS 3D examples (examples/pixi3d-<id>/): OliveStudio versions of the examples at
// https://pixijs.com/3d/examples, made from editor components and textures generated here (none of the site's assets).
// Each project is exported to HTML with the stock runtime and photographed there for its thumbnail (WebGL, no page
// errors allowed). The catalog keeps every other example and replaces only the pixi3d-* entries.
// Usage (after `pnpm build`): node scripts/make-pixi3d-examples.mjs [id ...]
import {createServer as vite} from 'vite';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname,extname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=dirname(dirname(fileURLToPath(import.meta.url))),sharp=createRequire(join(root,'apps/editor-desktop/package.json'))('sharp');
const only=new Set(process.argv.slice(2));
const ssr=await vite({configFile:false,root,logLevel:'error',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},ssr:{noExternal:[/^@rewrite\//]}});
const {Primitive3DSchema,Light3DSchema,Camera3DSchema}=await ssr.ssrLoadModule('/modules/render-pixi3d/src/contracts.ts');
const {Viewport3DSchema}=await ssr.ssrLoadModule('/modules/scene3d/src/index.ts');
const {cubeDirection,cubeLayout,cubeFaces}=await ssr.ssrLoadModule('/modules/render-pixi3d/src/cubemap.ts');
const {Particles3DSchema,particles3dDefaults}=await ssr.ssrLoadModule('/modules/render-pixi3d/src/particles3d.ts');
const {Instances3DSchema,instances3dDefaults}=await ssr.ssrLoadModule('/modules/render-pixi3d/src/instances3d.ts');
const {buildModel}=await ssr.ssrLoadModule('/modules/render-pixi3d/src/model.node.ts');
const {compileScript}=await ssr.ssrLoadModule('/modules/scripts/src/compile.ts');

// ---------- deterministic ids, so regenerating an example keeps its file stable ----------
const uuid=(...parts)=>{const h=createHash('sha256').update(parts.join('/')).digest('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const euler=(x,y,z)=>{const h=Math.PI/360,sx=Math.sin(x*h),cx=Math.cos(x*h),sy=Math.sin(y*h),cy=Math.cos(y*h),sz=Math.sin(z*h),cz=Math.cos(z*h);return{qx:sx*cy*cz+cx*sy*sz,qy:cx*sy*cz-sx*cy*sz,qz:cx*cy*sz+sx*sy*cz,qw:cx*cy*cz-sx*sy*sz};};

// ---------- procedural textures (RGBA, rows top to bottom) ----------
const png=async(w,h,pixel)=>{const raw=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const c=pixel(x,y);raw.set([c[0],c[1],c[2],c[3]??255].map(v=>Math.max(0,Math.min(255,Math.round(v)))),(y*w+x)*4);}return sharp(raw,{raw:{width:w,height:h,channels:4}}).png({compressionLevel:9}).toBuffer();};
const hash2=(x,y)=>{let h=Math.imul(x*374761393+y*668265263,1274126177);h^=h>>>13;return((h>>>0)%1000)/1000;};
// Bricks 4 × 8 per tile: height 1 on a brick, 0 in the mortar, with a bevel; each brick gets its own shade.
const brick=(u,v)=>{const rows=8,row=Math.floor(v*rows),bu=u*4+(row%2?.5:0),col=Math.floor(bu),fx=bu-col,fy=v*rows-row,edge=Math.min(fx,1-fx,fy*.5,(1-fy)*.5)*8;return{height:Math.max(0,Math.min(1,(edge-.15)*3)),shade:hash2(col,row),mortar:edge<.15};};
const textures={
 // A 4 × 4 flipbook of white flower shapes: petals 3–6 across a row, larger each row; particles tint them.
 flipbook:()=>png(256,256,(x,y)=>{const col=Math.floor(x/64),row=Math.floor(y/64),k=row*4+col,u=(x%64-31.5)/32,v=(y%64-31.5)/32,r=Math.hypot(u,v),a=Math.atan2(v,u),edge=.32+row*.13+.1*Math.cos((3+col)*a+k),soft=Math.max(0,Math.min(1,(edge-r)*14)),core=Math.max(0,1-r/(edge*.45));return[255,255-core*30,255-core*80,soft*255];}),
 brickColor:()=>png(256,256,(x,y)=>{const b=brick(x/256,y/256),n=hash2(x,y)*18;return b.mortar?[150+n,146+n,138+n]:[150+b.shade*50+n,62+b.shade*20+n,48+n];}),
 brickNormal:()=>png(256,256,(x,y)=>{const h=(a,b)=>brick(((a+256)%256)/256,((b+256)%256)/256).height,dx=(h(x+1,y)-h(x-1,y))*2,dy=(h(x,y+1)-h(x,y-1))*2,l=Math.hypot(dx,dy,1);return[(-dx/l*.5+.5)*255,(dy/l*.5+.5)*255,(1/l*.5+.5)*255];}),
 // glTF metal-rough: green is roughness, blue is metalness. Bricks rough, mortar rougher, a metal band across the middle.
 brickMetalRough:()=>png(256,256,(x,y)=>{const b=brick(x/256,y/256),metal=y>112&&y<144;return[0,metal?60:b.mortar?250:200,metal?255:0];}),
 brickOcclusion:()=>png(256,256,(x,y)=>{const b=brick(x/256,y/256);return Array(3).fill(80+b.height*175);}),
 brickGlow:()=>png(256,256,(x,y)=>{const b=brick(x/256,y/256),crack=b.mortar&&hash2(Math.floor(x/16),Math.floor(y/32))>.7;return crack?[255,140,40]:[0,0,0];}),
 fence:()=>png(128,128,(x,y)=>{const bar=(x%32)<10||(y%32)<10;return bar?[120,170,90,255]:[0,0,0,0];}),
 // A 2 × 2 atlas of numbered-looking frames: each quarter its own colour with an arrow pointing up (+V up in the image).
 atlas:()=>png(256,256,(x,y)=>{const q=(x<128?0:1)+(y<128?0:2),cols=[[230,90,80],[90,170,230],[110,200,120],[240,200,80]][q],lx=x%128,ly=y%128,arrow=Math.abs(lx-64)<(ly-24)*.5&&ly>24&&ly<70||Math.abs(lx-64)<10&&ly>=70&&ly<104,border=lx<4||ly<4||lx>123||ly>123;return border?[30,30,40]:arrow?[255,255,255]:cols;}),
 stripes:()=>png(128,128,(x,y)=>((x+y)%64)<32?[250,210,70]:[40,40,48]),
 tree:()=>png(128,192,(x,y)=>{const trunk=Math.abs(x-64)<9&&y>130;const crown=Math.hypot((x-64)/52,(y-78)/70)<1;const shade=hash2(x>>3,y>>3)*30;return crown?[50+shade,140+shade,60,255]:trunk?[110,72,40,255]:[0,0,0,0];}),
 glow:()=>png(128,128,(x,y)=>{const r=Math.hypot(x-64,y-64)/64,a=Math.max(0,1-r)**1.6;return[255,220,140,a*255];}),
 sign:()=>png(256,128,(x,y)=>{const border=x<8||y<8||x>247||y>119,arrow=Math.abs(y-64)<14&&x>40&&x<170||x>=170&&x<220&&Math.abs(y-64)<(220-x);return border?[250,250,250,255]:arrow?[255,255,255,255]:[40,110,200,255];}),
 checker:()=>png(256,256,(x,y)=>((x>>5)+(y>>5))%2?[235,235,228]:[48,56,72]),
 // Tileable soft clouds: a few octaves of wrapped value noise (red = cloud cover).
 clouds:()=>png(256,256,(x,y)=>{const n=(f,s)=>{const gx=x/256*f,gy=y/256*f,ix=Math.floor(gx),iy=Math.floor(gy),fx=gx-ix,fy=gy-iy,h=(a,b)=>hash2(((a%f)+f)%f+s,((b%f)+f)%f+s*7),sm=t=>t*t*(3-2*t),a=h(ix,iy),b=h(ix+1,iy),c=h(ix,iy+1),d=h(ix+1,iy+1),u=sm(fx),v=sm(fy);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;};const v=n(4,1)*.55+n(8,2)*.3+n(16,3)*.15,k=Math.max(0,Math.min(1,(v-.42)*3));return[k*255,k*255,k*255];}),
 // A hologram pattern: a fine grid with a brighter frame.
 grid:()=>png(128,128,(x,y)=>{const line=x%16<2||y%16<2,frame=x<4||y<4||x>123||y>123;return frame?[255,255,255]:line?[170,220,255]:[30,60,90];}),
 // Red scales the coat: chipped patches have none.
 coatChips:()=>png(256,256,(x,y)=>{const n=hash2(Math.floor(x/24),Math.floor(y/24));return n>.72?[0,0,0]:[255,255,255];}),
 // Red scales transmission: lead lines between panes stay opaque.
 leading:()=>png(256,256,(x,y)=>{const lead=(x%64)<5||(y%64)<5||Math.abs(((x+y)%128)-64)<3;return lead?[0,0,0]:[255,255,255];}),
 // Packed iridescence: red is the factor, green the film thickness (rings).
 swirl:()=>png(256,256,(x,y)=>{const r=Math.hypot(x-128,y-128)/128;return[255,128+127*Math.sin(r*18),0];}),
 // Sheen colour in RGB, roughness in alpha: a woven pattern.
 weave:()=>png(256,256,(x,y)=>{const warp=((x>>3)+(y>>4))%2===0;return warp?[255,120,200,90]:[90,200,255,200];}),
};

// A sky with mountains on the horizon and a sun, as linear light: shared by the cube map (clamped to white) and the HDR panorama (sun far brighter).
const sunDir=(()=>{const v=[.45,.42,-.79],l=Math.hypot(...v);return v.map(x=>x/l);})();
function skyLight([x,y,z]){const az=Math.atan2(x,-z),ridge=.06+.05*Math.sin(az*5)+.03*Math.sin(az*13+1)+.015*Math.sin(az*31);
 if(y<0)return[.16+.05*(-y),.13+.03*(-y),.1];if(y<ridge)return[.22,.27,.3];
 const h=Math.pow(Math.min(1,y),.45),sky=[.95-.7*h,1-.55*h,1.05-.2*h].map(v=>v*1.1),sun=x*sunDir[0]+y*sunDir[1]+z*sunDir[2];
 return sun>.9995?[60,55,45]:sky.map(v=>v+Math.pow(Math.max(0,sun),64)*.8);}
const toSrgb=v=>255*(v<=.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-.055);
async function skyCross(face=256){const layout=cubeLayout(face*4,face*3),raw=Buffer.alloc(face*4*face*3*4);
 for(const f of cubeFaces){const o=layout.faces[f];for(let j=0;j<face;j++)for(let i=0;i<face;i++){const c=skyLight(cubeDirection(f,(i+.5)/face*2-1,(j+.5)/face*2-1)),k=((o.y+j)*face*4+o.x+i)*4;raw.set([...c.map(v=>Math.min(255,Math.round(toSrgb(Math.min(1,v))))),255],k);}}
 return sharp(raw,{raw:{width:face*4,height:face*3,channels:4}}).png({compressionLevel:9}).toBuffer();}
/** An equirectangular Radiance .hdr (flat RGBE scanlines) of the same sky; its sun keeps light far brighter than white. */
function skyHdr(w=512,h=256){const head=Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`,'latin1'),px=Buffer.alloc(w*h*4);let peak=0;
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){const lon=(i+.5)/w*2*Math.PI-Math.PI,lat=Math.PI/2-(j+.5)/h*Math.PI,d=[Math.cos(lat)*Math.sin(lon),Math.sin(lat),-Math.cos(lat)*Math.cos(lon)],c=skyLight(d),m=Math.max(...c);peak=Math.max(peak,m);
  if(m<1e-32){px.set([0,0,0,0],(j*w+i)*4);continue;}const e=Math.ceil(Math.log2(m)+1e-9),scale=256/Math.pow(2,e);px.set([...c.map(v=>Math.min(255,Math.floor(v*scale))),e+128],(j*w+i)*4);}
 return{bytes:Buffer.concat([head,px]),width:w,height:h,peak};}

// ---------- generated animated models (glTF via gltf-transform) ----------
const gltf=createRequire(join(root,'modules/render-pixi3d/package.json'))('@gltf-transform/core');
const q=(ax,deg)=>{const h=deg*Math.PI/360,s=Math.sin(h);return ax==='x'?[s,0,0,Math.cos(h)]:ax==='y'?[0,s,0,Math.cos(h)]:[0,0,s,Math.cos(h)];};
/** A tapered tentacle on a four-bone chain (Root, Mid, Upper, Tip) with clips Idle, Wave and Twist. */
async function tentacle(color=[.85,.42,.3,1]){const {Document,NodeIO}=gltf,doc=new Document(),buffer=doc.createBuffer(),acc=(type,arr)=>doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
 const rings=24,sides=14,height=2,pos=[],nor=[],joints=[],weights=[],idx=[];
 for(let r=0;r<=rings;r++){const y=r/rings*height,rad=.26-.18*(y/height),seg=Math.min(2.999,y/.5),b=Math.floor(seg),f=seg-b;for(let k=0;k<sides;k++){const a=k/sides*Math.PI*2;pos.push(Math.cos(a)*rad,y,Math.sin(a)*rad);nor.push(Math.cos(a),.09,Math.sin(a));joints.push(b,Math.min(3,b+1),0,0);weights.push(1-f,f,0,0);}}
 for(let r=0;r<rings;r++)for(let k=0;k<sides;k++){const a=r*sides+k,b=r*sides+(k+1)%sides,c=a+sides,d=b+sides;idx.push(a,c,b,b,c,d);}
 const top=pos.length/3;pos.push(0,height,0);nor.push(0,1,0);joints.push(3,0,0,0);weights.push(1,0,0,0);for(let k=0;k<sides;k++)idx.push(rings*sides+k,top,rings*sides+(k+1)%sides);
 const prim=doc.createPrimitive().setAttribute('POSITION',acc('VEC3',new Float32Array(pos))).setAttribute('NORMAL',acc('VEC3',new Float32Array(nor))).setAttribute('JOINTS_0',acc('VEC4',new Uint16Array(joints))).setAttribute('WEIGHTS_0',acc('VEC4',new Float32Array(weights))).setIndices(acc('SCALAR',new Uint16Array(idx))).setMaterial(doc.createMaterial('Clay').setBaseColorFactor(color.map((v,i)=>i<3?v**2.2:v)).setRoughnessFactor(.6).setMetallicFactor(0));
 const names=['Root','Mid','Upper','Tip'],bones=names.map((n,i)=>doc.createNode(n).setTranslation([0,i?.5:0,0]));for(let i=1;i<4;i++)bones[i-1].addChild(bones[i]);
 const ibm=[];for(let i=0;i<4;i++)ibm.push(1,0,0,0,0,1,0,0,0,0,1,0,0,-i*.5,0,1);const skin=doc.createSkin('Rig').setSkeleton(bones[0]).setInverseBindMatrices(acc('MAT4',new Float32Array(ibm)));bones.forEach(b=>skin.addJoint(b));
 const body=doc.createNode('Body').setMesh(doc.createMesh('Tentacle').addPrimitive(prim)).setSkin(skin),rootNode=doc.createNode('Tentacle').addChild(bones[0]).addChild(body);doc.createScene('Scene').addChild(rootNode);
 const clip=(name,duration,frame)=>{const anim=doc.createAnimation(name),steps=24,times=Array.from({length:steps+1},(_,i)=>i/steps*duration);bones.forEach((bone,i)=>{const out=times.flatMap(t=>frame(i,t/duration*Math.PI*2));const sampler=doc.createAnimationSampler().setInput(acc('SCALAR',new Float32Array(times))).setOutput(acc('VEC4',new Float32Array(out))).setInterpolation('LINEAR');anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(bone).setTargetPath('rotation').setSampler(sampler));});};
 clip('Idle',2.4,(i,a)=>q('z',Math.sin(a+i*.6)*8));clip('Wave',1.2,(i,a)=>q('z',Math.sin(a-i*.9)*(18+i*8)));clip('Twist',1.6,(i,a)=>{const z=q('z',22),y=q('y',Math.sin(a)*60*(i?1:0)+Math.cos(a)*10);return[y[0]*z[3]+y[3]*z[0]+y[1]*z[2]-y[2]*z[1],y[1]*z[3]+y[3]*z[1]+y[2]*z[0]-y[0]*z[2],y[2]*z[3]+y[3]*z[2]+y[0]*z[1]-y[1]*z[0],y[3]*z[3]-y[0]*z[0]-y[1]*z[1]-y[2]*z[2]];});
 return Buffer.from(await new NodeIO().writeBinary(doc));}
/** A bumpy rock (about 12,000 triangles), as a plain GLB, or compressed with meshopt or Draco through gltf-transform. */
async function rock(compression='none'){const {Document,NodeIO}=gltf,{EXTMeshoptCompression,KHRDracoMeshCompression}=createRequire(join(root,'modules/render-pixi3d/package.json'))('@gltf-transform/extensions'),doc=new Document(),buffer=doc.createBuffer(),acc=(type,arr)=>doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
 const lat=64,lon=96,pos=[],nor=[],idx=[],h=(x,y,z)=>.5+.06*Math.sin(x*9+y*4)*Math.cos(z*7)+.04*Math.sin(x*23+z*17)+.02*Math.sin(y*41+x*13);
 const at=(th,ph)=>{const x=Math.sin(th)*Math.cos(ph),y=Math.cos(th),z=Math.sin(th)*Math.sin(ph),r=h(x,y,z);return[x*r,y*r*.8,z*r];};
 // Normals from the displaced surface (the sphere's would light the bumps wrongly), pointing outward.
 for(let i=0;i<=lat;i++){const th=Math.min(Math.PI-1e-4,Math.max(1e-4,i/lat*Math.PI));for(let j=0;j<=lon;j++){const ph=j/lon*Math.PI*2,p=at(th,ph),e=1e-3,a=at(th+e,ph),b=at(th,ph+e),u=[a[0]-p[0],a[1]-p[1],a[2]-p[2]],v=[b[0]-p[0],b[1]-p[1],b[2]-p[2]];let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];const l=Math.hypot(...n)||1;n=n.map(c=>c/l);if(n[0]*p[0]+n[1]*p[1]+n[2]*p[2]<0)n=n.map(c=>-c);pos.push(...p);nor.push(...n);}}
 // Counter-clockwise seen from outside.
 for(let i=0;i<lat;i++)for(let j=0;j<lon;j++){const a=i*(lon+1)+j,b=a+lon+1;idx.push(a,a+1,b,a+1,b+1,b);}
 const prim=doc.createPrimitive().setAttribute('POSITION',acc('VEC3',new Float32Array(pos))).setAttribute('NORMAL',acc('VEC3',new Float32Array(nor))).setIndices(acc('SCALAR',new Uint16Array(idx))).setMaterial(doc.createMaterial('Rock').setBaseColorFactor([.45**2.2,.42**2.2,.38**2.2,1]).setRoughnessFactor(.9));
 doc.createScene('Scene').addChild(doc.createNode('Rock').setMesh(doc.createMesh('Rock').addPrimitive(prim)));
 const io=new NodeIO();
 if(compression==='meshopt'){const {MeshoptEncoder}=createRequire(join(root,'modules/render-pixi3d/package.json'))('meshoptimizer');await MeshoptEncoder.ready;io.registerExtensions([EXTMeshoptCompression]).registerDependencies({'meshopt.encoder':MeshoptEncoder});doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.FILTER});}
 if(compression==='draco'){const draco=createRequire(join(root,'modules/render-pixi3d/package.json'))('draco3dgltf');io.registerExtensions([KHRDracoMeshCompression]).registerDependencies({'draco3d.encoder':await draco.createEncoderModule()});doc.createExtension(KHRDracoMeshCompression).setRequired(true);}
 return Buffer.from(await io.writeBinary(doc));}
/** A little scene file with two named scenes: Day (house and sun) and Night (house, moon and a lit window). */
async function dayNight(){const {Document,NodeIO}=gltf,doc=new Document(),buffer=doc.createBuffer(),acc=(type,arr)=>doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer),lin=v=>v**2.2;
 const box=(name,[sx,sy,sz],[r,g,b],emit=0)=>{const P=[],N=[],I=[];const faces=[[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]];faces.forEach(([nx,ny,nz])=>{const ux=ny?1:0,uy=0,uz=ny?0:nx?0:1,vx=0,vy=ny?0:1,vz=ny?1:0,base=P.length/3;
   const u=[nx?0:ux||1,uy,nx?nz||1:uz];const t=[ux,uy,uz].some(Boolean)?[ux,uy,uz]:[0,0,1];const w=[ny?0:0,ny?0:1,ny?1:0];
   for(const [a,c] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const p=[nx*.5+(ny?a*.5:nz?a*.5:0),ny*.5+(ny?0:c*.5),nz*.5+(ny?c*.5:nx?a*.5:0)];P.push(p[0]*sx,p[1]*sy,p[2]*sz);N.push(nx,ny,nz);}
   const flip=(nx+ny+nz)>0?(nx?1:ny?-1:1):(nx?-1:ny?1:-1);I.push(...(flip>0?[base,base+1,base+2,base,base+2,base+3]:[base,base+2,base+1,base,base+3,base+2]));void u;void t;void w;void vx;void vy;void vz;});
  const mat=doc.createMaterial(name).setBaseColorFactor([lin(r),lin(g),lin(b),1]).setRoughnessFactor(.8);if(emit)mat.setEmissiveFactor([lin(r)*emit,lin(g)*emit,lin(b)*emit]);
  return doc.createMesh(name).addPrimitive(doc.createPrimitive().setAttribute('POSITION',acc('VEC3',new Float32Array(P))).setAttribute('NORMAL',acc('VEC3',new Float32Array(N))).setIndices(acc('SCALAR',new Uint16Array(I))).setMaterial(mat));};
 const node=(name,mesh,t)=>doc.createNode(name).setMesh(mesh).setTranslation(t);const walls=box('Walls',[1.2,.8,1],[.85,.8,.7]),roof=box('Roof',[1.4,.15,1.2],[.6,.25,.2]);
 doc.createScene('Day').addChild(node('Walls',walls,[0,.4,0])).addChild(node('Roof',roof,[0,.875,0])).addChild(node('Sun',box('Sun',[.35,.35,.35],[1,.85,.3],2),[-.9,1.7,-.3]));
 doc.createScene('Night').addChild(node('Walls',walls,[0,.4,0])).addChild(node('Roof',roof,[0,.875,0])).addChild(node('Moon',box('Moon',[.25,.25,.25],[.8,.85,1],1.5),[.9,1.7,-.3])).addChild(node('Window',box('Window',[.3,.25,.02],[1,.75,.3],3),[0,.45,.51]));
 return Buffer.from(await new NodeIO().writeBinary(doc));}
/** A desk lamp in three parts (Base, Pole, Shade), each its own material in that order, turned from profiles. */
/** A small castle of boxes (keep, four towers, walls, red roofs) for the asset lifetime example. */
async function castle(){const {Document,NodeIO}=gltf,doc=new Document(),buffer=doc.createBuffer(),acc=(type,arr)=>doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer),scene=doc.createScene('Scene'),lin=v=>v**2.2;
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],mats=new Map();
 const mat=(name,[r,g,b])=>{if(!mats.has(name))mats.set(name,doc.createMaterial(name).setBaseColorFactor([lin(r),lin(g),lin(b),1]).setRoughnessFactor(.85));return mats.get(name);};
 // Each face: corners n/2 ± u/2 ± v/2 with v = n × u, so u × v = n and the corners run counter-clockwise seen from outside.
 const box=(name,[cx,cy,cz],[sx,sy,sz],color,material)=>{const P=[],N=[],I=[];for(const n of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const u=n[1]?[1,0,0]:[0,1,0],v=cross(n,u),base=P.length/3;
   for(const [a,c] of [[-1,-1],[1,-1],[1,1],[-1,1]]){P.push((n[0]+a*u[0]+c*v[0])*.5*sx,(n[1]+a*u[1]+c*v[1])*.5*sy,(n[2]+a*u[2]+c*v[2])*.5*sz);N.push(...n);}I.push(base,base+1,base+2,base,base+2,base+3);}
  const prim=doc.createPrimitive().setAttribute('POSITION',acc('VEC3',new Float32Array(P))).setAttribute('NORMAL',acc('VEC3',new Float32Array(N))).setIndices(acc('SCALAR',new Uint16Array(I))).setMaterial(mat(material,color));
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)).setTranslation([cx,cy,cz]));};
 const stone=[.78,.74,.66],roof=[.72,.22,.18];
 box('Keep',[0,.75,0],[1,1.5,1],stone,'Stone');box('Keep roof',[0,1.62,0],[1.1,.24,1.1],roof,'Roof');
 for(const [x,z] of [[-1.2,-1.2],[1.2,-1.2],[-1.2,1.2],[1.2,1.2]]){box(`Tower ${x>0?'E':'W'}${z>0?'S':'N'}`,[x,.6,z],[.5,1.2,.5],stone,'Stone');box(`Tower roof ${x>0?'E':'W'}${z>0?'S':'N'}`,[x,1.3,z],[.62,.2,.62],roof,'Roof');}
 for(const [x,z,sx,sz] of [[0,-1.2,1.9,.22],[0,1.2,1.9,.22],[-1.2,0,.22,1.9],[1.2,0,.22,1.9]])box('Wall',[x,.35,z],[sx,.7,sz],stone,'Stone');
 box('Gate',[0,.25,1.32],[.5,.5,.06],[.35,.22,.12],'Wood');
 return Buffer.from(await new NodeIO().writeBinary(doc));}
async function lamp(){const {Document,NodeIO}=gltf,doc=new Document(),buffer=doc.createBuffer(),acc=(type,arr)=>doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer),scene=doc.createScene('Scene');
 const lathe=(name,profile,material)=>{const seg=40,pos=[],nor=[],idx=[];
  for(let i=0;i<profile.length;i++){const [r,y]=profile[i],[r0,y0]=profile[Math.max(0,i-1)],[r1,y1]=profile[Math.min(profile.length-1,i+1)],dr=r1-r0,dy=y1-y0,l=Math.hypot(dr,dy)||1;
   for(let j=0;j<=seg;j++){const a=j/seg*Math.PI*2,c=Math.cos(a),s=Math.sin(a);pos.push(r*c,y,r*s);nor.push(dy/l*c,-dr/l,dy/l*s);}}
  for(let i=0;i+1<profile.length;i++)for(let j=0;j<seg;j++){const a=i*(seg+1)+j,b=a+seg+1;idx.push(a,a+1,b,a+1,b+1,b);}
  const prim=doc.createPrimitive().setAttribute('POSITION',acc('VEC3',new Float32Array(pos))).setAttribute('NORMAL',acc('VEC3',new Float32Array(nor))).setIndices(acc('SCALAR',new Uint16Array(idx))).setMaterial(material);
  const node=doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));scene.addChild(node);return node;};
 const lin=v=>v**2.2,mat=(n,[r,g,b],rough,metal)=>doc.createMaterial(n).setBaseColorFactor([lin(r),lin(g),lin(b),1]).setRoughnessFactor(rough).setMetallicFactor(metal);
 lathe('Base',[[0,0],[.42,0],[.44,.03],[.42,.08],[.12,.1],[0,.1]],mat('Base',[.2,.22,.26],.4,.8));
 lathe('Pole',[[0,.1],[.045,.1],[.045,1.1],[0,1.1]],mat('Pole',[.85,.66,.32],.3,1));
 // The shade leans 20° on the pole top, so the lamp has a front and a random turn shows.
 const h=10*Math.PI/180;lathe('Shade',[[.08,1.05],[.12,1.12],[.42,1.42],[.44,1.44]],mat('Shade',[.95,.9,.78],.7,0).setDoubleSided(true)).setRotation([0,0,Math.sin(h),Math.cos(h)]).setTranslation([1.05*Math.sin(2*h),1.1-1.05*Math.cos(2*h),0]);
 return Buffer.from(await new NodeIO().writeBinary(doc));}
/** A round blob with morph targets Squash and Spike and a clip Wobble that plays them. */
async function blob(){const {Document,NodeIO}=gltf,doc=new Document(),buffer=doc.createBuffer(),acc=(type,arr)=>doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
 const lat=24,lon=36,pos=[],nor=[],squash=[],spike=[],idx=[];
 for(let i=0;i<=lat;i++){const th=i/lat*Math.PI;for(let j=0;j<=lon;j++){const ph=j/lon*Math.PI*2,x=Math.sin(th)*Math.cos(ph),y=Math.cos(th),z=Math.sin(th)*Math.sin(ph);pos.push(x*.5,y*.5,z*.5);nor.push(x,y,z);squash.push(x*.2,-y*.22,z*.2);const bump=Math.max(0,Math.sin(th*5)*Math.sin(ph*6))**2*.16;spike.push(x*bump,y*bump,z*bump);}}
 for(let i=0;i<lat;i++)for(let j=0;j<lon;j++){const a=i*(lon+1)+j,b=a+lon+1;idx.push(a,b,a+1,a+1,b,b+1);}
 const prim=doc.createPrimitive().setAttribute('POSITION',acc('VEC3',new Float32Array(pos))).setAttribute('NORMAL',acc('VEC3',new Float32Array(nor))).setIndices(acc('SCALAR',new Uint16Array(idx))).setMaterial(doc.createMaterial('Jelly').setBaseColorFactor([.36**2.2,.7**2.2,.95**2.2,1]).setRoughnessFactor(.35));
 prim.addTarget(doc.createPrimitiveTarget('Squash').setAttribute('POSITION',acc('VEC3',new Float32Array(squash)))).addTarget(doc.createPrimitiveTarget('Spike').setAttribute('POSITION',acc('VEC3',new Float32Array(spike))));
 const mesh=doc.createMesh('Blob').addPrimitive(prim).setWeights([0,0]).setExtras({targetNames:['Squash','Spike']}),node=doc.createNode('Blob').setMesh(mesh);doc.createScene('Scene').addChild(node);
 const times=Array.from({length:25},(_,i)=>i/24*2),out=times.flatMap(t=>[Math.max(0,Math.sin(t*Math.PI)),Math.max(0,-Math.sin(t*Math.PI))]),sampler=doc.createAnimationSampler().setInput(acc('SCALAR',new Float32Array(times))).setOutput(acc('SCALAR',new Float32Array(out))).setInterpolation('LINEAR');
 doc.createAnimation('Wobble').addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('weights').setSampler(sampler));
 return Buffer.from(await new NodeIO().writeBinary(doc));}

// ---------- scene building blocks ----------
function builder(id){const entities=[],assets=[],sources=new Map(),globals=[],scripts=[],shaders=[];let n=0;const next=what=>uuid(id,what,String(n++));
 const view=next('view'),camera=next('camera');
 const tf2=(x,y)=>({id:next('t2'),type:'scene.transform2d',version:1,data:{x,y,rotation:0,scaleX:1,scaleY:1}});
 const tf3=(p=[0,0,0],r=[0,0,0],s=1)=>({id:next('t3'),type:'scene3d.transform',version:1,data:{x:p[0],y:p[1],z:p[2],...euler(...r),...(Array.isArray(s)?{scaleX:s[0],scaleY:s[1],scaleZ:s[2]}:{scaleX:s,scaleY:s,scaleZ:s})}});
 const child=(name,components,parent=view)=>{const e={id:next('e'),name,parentId:parent,active:true,spatial:'scene3d.transform',components};entities.push(e);return e;};
 return{
  view,camera,entities,assets,sources,globals,scripts,shaders,
  /** A Shader 3D (project section pixi3d.shaders); returns its id. */
  shader(item){const sid=uuid(id,'shader',item.name);shaders.push({params:[],...item,id:sid,wgsl:{header:'',material:'',preLighting:'',perLight:'',postLighting:'',...item.wgsl},glsl:{header:'',material:'',preLighting:'',perLight:'',postLighting:'',...item.glsl}});return sid;},
  /** Puts a shader on an object (primitive or Mesh 3D) with parameter values. */
  useShader(target,shaderId,values={}){const e=typeof target==='string'?entities.find(x=>x.id===target):target;e.components.push({id:next('shader'),type:'pixi3d.shader',version:1,data:{shaderId,values}});},
  /** A behaviour script (TypeScript) on an entity (or entity id), compiled like the editor does; the same source is reused by name. */
  script(target,name,source,params={},refs={}){const e=typeof target==='string'?entities.find(x=>x.id===target):target;let item=scripts.find(x=>x.name===name);if(!item){const built=compileScript(source,name);if(built.error)throw Error(built.error);item={id:uuid(id,'script',name),name,source,...built};scripts.push(item);}e.components.push({id:next('script'),type:'scripts.behaviour',version:1,data:{scriptId:item.id,params,refs}});},
  /** A number global (shared play-session value) for rules and {name} text templates; returns its id. */
  global(name,initial=0){const gid=next('global');globals.push({id:gid,name,type:'number',initial});return gid;},
  /** A rule on an entity: when `trigger` fires for `sourceId`, run actions ([type, targetId, extra]). */
  rule(entityId,trigger,sourceId,actions){const e=entities.find(x=>x.id===entityId);let c=e.components.find(x=>x.type==='interactions.bindings');if(!c){c={id:next('rules'),type:'interactions.bindings',version:1,data:{rules:[]}};e.components.push(c);}c.data.rules.push({id:next('rule'),trigger:{type:trigger,sourceId,event:''},actions:actions.map(([type,targetId,extra={}])=>({id:next('action'),type,targetId,value:true,...extra}))});},
  drag(entityId,data={}){entities.find(x=>x.id===entityId).components.push({id:next('drag'),type:'pixi3d.draggable',version:1,data:{plane:'ground',snap:0,...data}});},
  setView(data={}){entities.unshift({id:view,name:'3D View',parentId:null,active:true,components:[tf2(0,0),{id:next('vp'),type:'pixi3d.viewport',version:1,data:Viewport3DSchema.parse({width:960,height:540,cameraId:camera,toneMapping:'aces',background:'color',backgroundColor:'#1d2530',environment:'hemisphere',skyColor:'#bcd4ff',groundColor:'#5b5246',environmentIntensity:.8,shadowQuality:'high',shadowFilter:'pcf',...data})}]});},
  camera3d(p,r,data={}){/* the view's camera */entities.push({id:camera,name:'Camera',parentId:view,active:true,spatial:'scene3d.transform',components:[tf3(p,r),{id:next('cam'),type:'pixi3d.camera',version:1,data:Camera3DSchema.parse({mode:'perspective',fov:45,near:.1,far:200,orthographicSize:5,...data})}]});},
  light(name,r,data,p=[0,0,0]){child(name,[tf3(p,r),{id:next('light'),type:'pixi3d.light',version:1,data:Light3DSchema.parse({color:'#ffffff',intensity:2,castShadow:false,...data})}]);},
  prim(name,p,data,r=[0,0,0],s=1,parent=view){return child(name,[tf3(p,r,s),{id:next('prim'),type:'pixi3d.primitive',version:1,data:Primitive3DSchema.parse({shape:'sphere',color:'#d9d9d9',roughness:.5,metallic:0,...data})}],parent);},
  sprite(name,p,data){return child(name,[tf3(p),{id:next('sprite'),type:'pixi3d.sprite3d',version:1,data:{texture:'',tint:'#ffffff',alpha:1,alphaMode:'mask',alphaCutoff:.5,billboard:'spherical',pixelSize:.01,anchorX:.5,anchorY:.5,castShadow:false,receiveShadow:false,...data}}]);},
  label(text,x,y,size=15,color='#e8edf2'){entities.push({id:next('label'),name:`Label: ${text}`,parentId:null,active:true,components:[tf2(x,y),{id:next('x'),type:'pixi.text',version:1,data:{alpha:1,text,fontSize:size,color,font:'',fontWeight:'normal',fontStyle:'normal',align:'center',letterSpacing:0,strokeColor:'#0b0f14',strokeWidth:4}}]});},
  async video(name){const bytes=Buffer.from(await recordClip(),'base64'),asset={id:uuid(id,'video'),name,type:'media.video',revision:sha(bytes),source:{extension:'webm',bytes:bytes.length},metadata:{format:'webm',processedBytes:bytes.length,pipeline:'video-original-v1'}};assets.push(asset);sources.set(`${asset.id}-${asset.revision}.webm`,bytes);return asset.id;},
  /** Another 3D view at stage rectangle [x, y, w, h] with its own camera; returns adders bound to it. */
  subview(name,[x,y,w,h],data,eye,pitch,cameraData={},yaw=0){const vid=next('view'),cid=next('camera');
   entities.push({id:vid,name,parentId:null,active:true,components:[tf2(x,y),{id:next('vp'),type:'pixi3d.viewport',version:1,data:Viewport3DSchema.parse({width:w,height:h,cameraId:cid,toneMapping:'aces',background:'color',backgroundColor:'#1d2530',environment:'hemisphere',skyColor:'#bcd4ff',groundColor:'#5b5246',environmentIntensity:.8,shadowQuality:'high',shadowFilter:'pcf',...data})}]});
   entities.push({id:cid,name:`${name} camera`,parentId:vid,active:true,spatial:'scene3d.transform',components:[tf3(eye,[pitch,yaw,0]),{id:next('cam'),type:'pixi3d.camera',version:1,data:Camera3DSchema.parse({mode:'perspective',fov:45,near:.1,far:200,orthographicSize:5,...cameraData})}]});
   return{prim:(n,p,d,r=[0,0,0],sc=1)=>child(n,[tf3(p,r,sc),{id:next('prim'),type:'pixi3d.primitive',version:1,data:Primitive3DSchema.parse({shape:'sphere',color:'#d9d9d9',roughness:.5,metallic:0,...d})}],vid),light:(n,r,d,p=[0,0,0])=>child(n,[tf3(p,r),{id:next('light'),type:'pixi3d.light',version:1,data:Light3DSchema.parse({color:'#ffffff',intensity:2,castShadow:false,...d})}],vid)};},
  async cubemap(name){const bytes=await skyCross(),asset={id:uuid(id,'cubemap'),name,type:'pixi.texture',revision:sha(bytes),source:{extension:'png',bytes:bytes.length},metadata:{width:1024,height:768,processedBytes:bytes.length,pipeline:'pixi3d-examples'}};assets.push(asset);sources.set(`${asset.id}-${asset.revision}.png`,bytes);return asset.id;},
  hdr(name){const {bytes,width,height,peak}=skyHdr(),asset={id:uuid(id,'hdr'),name,type:'pixi3d.environment',revision:sha(bytes),source:{extension:'hdr',bytes:bytes.length},metadata:{pipeline:'radiance-hdr-v1',width,height,peak}};assets.push(asset);sources.set(`${asset.id}-${asset.revision}.hdr`,bytes);return asset.id;},
  tween(entityId,property,from,to,duration){const e=entities.find(x=>x.id===entityId),t=e.components.find(c=>c.type==='scene3d.transform'||c.type==='scene.transform2d');e.components.push({id:next('tween'),type:'tween.player',version:1,data:{duration,delay:0,ease:'sine.inOut',repeat:100,yoyo:true,autoplay:true,tracks:[{id:property,entityId,componentId:t.id,property,from,to}]}});},
  control(cameraId,data){const e=entities.find(x=>x.id===cameraId);e.components.push({id:next('control'),type:'pixi3d.cameraControl',version:1,data:{mode:'orbit',targetX:0,targetY:0,targetZ:0,minDistance:1,maxDistance:50,enableZoom:true,enablePan:true,damping:true,autoRotate:false,autoRotateSpeed:2,moveSpeed:4,lookSpeed:.0025,pointerLock:true,...data}});},
  camera2(name,p,r,data={}){return child(name,[tf3(p,r),{id:next('cam'),type:'pixi3d.camera',version:1,data:Camera3DSchema.parse({mode:'perspective',fov:45,near:.1,far:200,orthographicSize:5,...data})}]).id;},
  /** A 2D object (shape, text, group) on the stage or inside a 2D parent; returns its id. */
  node2d(name,x,y,components=[],parent=null,active=true){const id=next('n2d');entities.push({id,name,parentId:parent,active,components:[tf2(x,y),...components]});return id;},
  shape2d(kind,w,h,color,more={}){return{id:next('shape'),type:'pixi.shape',version:1,data:{alpha:1,kind,width:w,height:h,color,rounded:0,sides:5,innerRadius:.5,strokeColor:'#ffffff',strokeWidth:0,...more}};},
  text2d(text,size,color='#ffffff',more={}){return{id:next('text'),type:'pixi.text',version:1,data:{alpha:1,text,fontSize:size,color,font:'',fontWeight:'bold',fontStyle:'normal',align:'center',letterSpacing:0,strokeColor:'#000000',strokeWidth:0,...more}};},
  effects(entityId,data){entities.find(x=>x.id===entityId).components.push({id:next('fx'),type:'pixi.effects',version:1,data:{blendMode:'normal',blur:0,brightness:1,contrast:1,saturation:1,hue:0,noise:0,shadowAlpha:0,shadowColor:'#000000',shadowX:4,shadowY:4,shadowBlur:2,glowStrength:0,glowColor:'#ffd27a',glowDistance:12,outlineWidth:0,outlineColor:'#ffffff',pixelate:0,...data}});},
  mask(entityId,data){entities.find(x=>x.id===entityId).components.push({id:next('mask'),type:'pixi.mask',version:1,data:{shape:'rect',width:100,height:100,offsetX:0,offsetY:0,radius:0,inverse:false,...data}});},
  follow(entityId,targetId,data={}){entities.find(x=>x.id===entityId).components.push({id:next('follow'),type:'pixi3d.follow',version:1,data:{targetId,offsetX:0,offsetY:0,offsetZ:0,hideBehind:true,...data}});},
  /** The id of a subview (the last one added). */
  get lastView(){return [...entities].reverse().find(e=>e.components.some(c=>c.type==='pixi3d.viewport')).id;},
  async model(key,name,bytes){const id2=uuid(id,'model',key),revision=sha(bytes),asset={id:id2,name,type:'pixi3d.model',revision,source:{extension:'glb',bytes:bytes.length},metadata:{}};
   const cache=await mkdtemp(join(tmpdir(),'pixi3d-model-'));try{await mkdir(join(cache,'sources'));await writeFile(join(cache,'sources',`${id2}-${revision}.glb`),bytes);asset.metadata=(await buildModel({root:cache,asset,importerId:'pixi3d-editor.glb'})).metadata;}finally{await rm(cache,{recursive:true,force:true});}
   assets.push(asset);sources.set(`${id2}-${revision}.glb`,bytes);return id2;},
  modelEntity(name,p,assetId,anim,r=[0,0,0],sc=1,extra={},parent=view){const e=child(name,[tf3(p,r,sc),{id:next('model'),type:'pixi3d.modelRenderer',version:1,data:{assetId,overrideMaterial:false,color:'#ffffff',roughness:.5,metallic:0,materialSlots:[],castShadow:true,receiveShadow:true,...extra}},...anim?[{id:next('anim'),type:'animation3d.model',version:1,data:{clip:'',loop:true,speed:1,autoplay:true,blendClip:'',blendWeight:.5,fadeDuration:.3,startOffset:0,...anim}}]:[]],parent);return e;},
  /** A 3D particle emitter (pixi3d.particles) under `parent`; returns the entity. */
  particles(name,p,data,parent=view,r=[0,0,0]){return child(name,[tf3(p,r),{id:next('particles'),type:'pixi3d.particles',version:1,data:Particles3DSchema.parse({...particles3dDefaults(),...data})}],parent);},
  /** A Batch 3D (many copies of script-made shapes); returns the entity. */
  batch3d(name,p,data={},parent=null){return child(name,[tf3(p),{id:next('batch'),type:'pixi3d.batch',version:1,data:{size:1000,color:'#ffffff',roughness:.6,metallic:0,castShadow:true,receiveShadow:true,...data}}],parent??view);},
  /** A Mesh 3D (shape from a script); returns the entity. */
  mesh3d(name,p,data={},r=[0,0,0],sc=1,parent=null){return child(name,[tf3(p,r,sc),{id:next('mesh'),type:'pixi3d.mesh',version:1,data:{color:'#ffffff',roughness:.5,metallic:0,texture:'',vertexColors:false,doubleSided:false,flatShading:false,castShadow:true,receiveShadow:true,...data}}],parent??view);},
  /** An empty 3D group (transform only); returns the entity. `parent` null means the view. */
  node3d(name,p,parent=null,r=[0,0,0],sc=1){return child(name,[tf3(p,r,sc)],parent??view);},
  /** An Instances 3D entity; returns it. */
  instances(name,p,data){return child(name,[tf3(p),{id:next('inst'),type:'pixi3d.instances',version:1,data:Instances3DSchema.parse({...instances3dDefaults(),...data})}]);},
  /** An add-on component (outline, wireframe overlay, bounds box…) on an entity; returns the component id. */
  addon(entity,type,data={}){const id=next('addon');entity.components.push({id,type,version:1,data:{enabled:true,...data}});return id;},
  aim(entity,data){entity.components.push({id:next('aim'),type:'pixi3d.boneAim',version:1,data:{bone:'',targetId:'',axis:'+Y',weight:1,...data}});},
  async texture(key,name){const bytes=await textures[key](),meta=await sharp(bytes).metadata(),asset={id:uuid(id,'texture',key),name,type:'pixi.texture',revision:sha(bytes),source:{extension:'png',bytes:bytes.length},metadata:{width:meta.width,height:meta.height,processedBytes:bytes.length,pipeline:'pixi3d-examples'}};assets.push(asset);sources.set(`${asset.id}-${asset.revision}.png`,bytes);return asset.id;},
 };}
/** Screen position (stage pixels) of a world point for a camera at `eye` looking down −Z after `pitch` degrees, fov 45 on a 960 × 540 view. */
const screen=(eye,pitch,[x,y,z])=>{const t=-pitch*Math.PI/180,dx=x-eye[0],dy=y-eye[1],dz=z-eye[2],cy=dy*Math.cos(t)-dz*Math.sin(t),cz=dy*Math.sin(t)+dz*Math.cos(t),f=270/Math.tan(22.5*Math.PI/180);return[480+dx/-cz*f,270-cy/-cz*f];};
const sun=(b,intensity=2.4,fill=.15)=>{b.light('Sun',[-50,35,0],{kind:'directional',intensity,castShadow:true,shadowBias:.001});b.light('Fill',[0,0,0],{kind:'ambient',intensity:fill});};
const floor=(b,y=-1,color='#3a4350')=>b.prim('Floor',[0,y,0],{shape:'plane',color,roughness:.9},[-90,0,0],30);

const browser=await chromium.launch({channel:'chrome'});
/** A 4-second 320 × 180 WebM drawn on a canvas in Chrome and recorded with MediaRecorder (no encoder needed on the machine). */
async function recordClip(){const page=await browser.newPage();try{return await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const g=c.getContext('2d'),stream=c.captureStream(30),rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:600000}),chunks=[];rec.ondataavailable=e=>chunks.push(e.data);
 const start=performance.now();rec.start();await new Promise(done=>{const frame=()=>{const t=(performance.now()-start)/1000;g.fillStyle='#14202c';g.fillRect(0,0,320,180);const hues=[0,40,120,200,280];hues.forEach((h,i)=>{g.fillStyle=`hsl(${(h+t*60)%360} 80% 55%)`;g.fillRect(((i*64+t*80)%384)-64,0,64,120);});g.fillStyle='#fff';g.font='bold 44px sans-serif';g.textAlign='center';g.fillText(`${t.toFixed(1)} s`,160,165);if(t<4)requestAnimationFrame(frame);else done();};frame();});
 rec.stop();await new Promise(r=>rec.onstop=r);const blob=new Blob(chunks,{type:'video/webm'}),buf=new Uint8Array(await blob.arrayBuffer());let bin='';for(let i=0;i<buf.length;i+=32768)bin+=String.fromCharCode(...buf.subarray(i,i+32768));return btoa(bin);});}finally{await page.close();}}
const entities_of=b=>b.entities;
// ---------- the examples ----------
const SPHERE_SOURCE=`// A UV sphere from arrays: rows × columns vertices, triangles as indices.
function sphere(rows: number, columns: number) {
  const positions: number[] = [], indices: number[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) {
    const th = r / rows * Math.PI, ph = c / columns * Math.PI * 2;
    positions.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) { const a = r * (columns + 1) + c, b = a + columns + 1; indices.push(a, a + 1, b, a + 1, b + 1, b); }
  return {positions, indices};
}`;
const examples=[
 {id:'pixi3d-lighting-models',title:'PBR, Phong, Flat and Toon',category:'Materials',source:'materials_lighting-models',
  description:'The four lighting models side by side in one colour: physically based (metal and roughness), Phong (a highlight you size), Flat (no lighting at all) and Toon (shade bands, a rim light and an ink outline). Pick a sphere and switch its Material in the Inspector.',
  async build(b){const eye=[0,1.2,7],pitch=-8;b.setView({outlineWidth:.035});b.camera3d(eye,[pitch,0,0]);sun(b,1.6,.2);floor(b);
   const models=[['pbr','PBR',{roughness:.35}],['phong','Phong',{shininess:64,specularStrength:1.2}],['flat','Flat',{castShadow:false}],['toon','Toon',{toonBands:3,toonRimIntensity:.5,toonSpecularSize:.04}]];
   models.forEach(([material,name,extra],i)=>{const x=(i-1.5)*2.3;b.prim(name,[x,0,0],{color:'#e0784a',material,...extra},[0,0,0],1.6);const [sx,sy]=screen(eye,pitch,[x,-1,0]);b.label(name,sx,sy+18);});
   b.label('Four lighting models, one colour',480,36,22);}},
 {id:'pixi3d-metal-roughness',title:'Metal and roughness',category:'Materials',source:'materials_pbr',
  description:'The standard PBR material in three numbers: colour, metallic and roughness. Rows go from plastic to metal, columns from mirror-smooth to fully rough, all lit by the same sky-and-ground environment light and a sun.',
  async build(b){const eye=[0,0,9.5],pitch=0;b.setView({environmentIntensity:1.1});b.camera3d(eye,[pitch,0,0]);sun(b);
   for(let r=0;r<3;r++)for(let c=0;c<5;c++){const x=(c-2)*1.6,y=(1-r)*1.6;b.prim(`Metal ${[1,.5,0][r]} rough ${c/4}`,[x,y,0],{color:'#d8b25a',metallic:[1,.5,0][r],roughness:Math.max(.05,c/4)},[0,0,0],1.25);}
   for(let c=0;c<5;c++){const [sx]=screen(eye,pitch,[(c-2)*1.6,0,0]);b.label(`rough ${(c/4).toFixed(2)}`,sx,500,13);}
   for(let r=0;r<3;r++){const [,sy]=screen(eye,pitch,[0,(1-r)*1.6,0]);b.label(`metal ${[1,.5,0][r]}`,70,sy,13);}
   b.label('Metallic × roughness',480,32,22);}},
 {id:'pixi3d-transparency',title:'Transparency',category:'Materials',source:'materials_alpha',
  description:'How a surface treats alpha: Opaque ignores it, Cut-out (mask) keeps only pixels above a threshold, so a fence texture gets real holes and sharp shadows, and Blend mixes with what is behind for glass. Double-sided shows a card from behind too.',
  async build(b){const eye=[0,1.4,8],pitch=-10,fence=await b.texture('fence','Fence (alpha)');b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b);
   b.prim('Back wall',[0,.6,-2.5],{shape:'cube',color:'#5d7fb8',roughness:.6},[0,0,0],[9,3.2,.2]);
   const items=[['Opaque',{alphaMode:'opaque'}],['Cut-out',{alphaMode:'mask',alphaCutoff:.5,doubleSided:true}],['Blend',{alphaMode:'blend',alpha:.35,doubleSided:true,color:'#bfe4ff',baseColorTexture:'',roughness:.05}],['Double-sided',{alphaMode:'mask',doubleSided:true}]];
   items.forEach(([name,extra],i)=>{const x=(i-1.5)*2.3;b.prim(name,[x,.2,0],{shape:'plane',color:'#ffffff',roughness:.7,baseColorTexture:fence,...extra},[0,i===3?160:20,0],1.8);const [sx,sy]=screen(eye,pitch,[x,-1,0]);b.label(name,sx,sy+16);});
   b.label('Opaque, cut-out, blend, double-sided',480,36,22);}},
 {id:'pixi3d-low-poly',title:'Low-poly look',category:'Materials',source:'materials_flat-shading',
  description:'Faceted shading: with "Faceted (flat normals)" each triangle gets one normal, so a curved shape reads as a cut gem or a low-poly prop. The same sphere, smooth on the left and faceted on the right.',
  async build(b){const eye=[0,1,6.5],pitch=-8;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b);
   [['Smooth',-1.3,false],['Faceted',1.3,true]].forEach(([name,x,flat])=>{b.prim(name,[x,0,0],{shape:'sphere',color:'#6fbf8e',flatShading:flat,material:'phong',shininess:40},[0,30,0],1.9);const [sx,sy]=screen(eye,pitch,[x,-1,0]);b.label(name,sx,sy+16,15);});
   b.label('Smooth and faceted normals',480,36,22);}},
 {id:'pixi3d-texture-set',title:'PBR texture set',category:'Materials',source:'materials_textures',
  description:'A PBR material from five images, adding one map at a time from left to right: colour, normal (bumps catch the light), metal-rough (a metal band and rough mortar), occlusion (darker gaps) and a glow map (embers in the cracks).',
  async build(b){const eye=[0,0,8.6],pitch=0;b.setView({toneMapping:'aces',bloom:true,bloomThreshold:1,bloomIntensity:.8,bloomRadius:.6});b.camera3d(eye,[pitch,0,0]);sun(b);
   const ids={baseColorTexture:await b.texture('brickColor','Brick colour'),normalTexture:await b.texture('brickNormal','Brick normal'),metallicRoughnessTexture:await b.texture('brickMetalRough','Brick metal-rough'),occlusionTexture:await b.texture('brickOcclusion','Brick occlusion'),emissiveTexture:await b.texture('brickGlow','Brick glow')};
   const steps=['baseColorTexture','normalTexture','metallicRoughnessTexture','occlusionTexture','emissiveTexture'],names=['Colour','+ Normal','+ Metal-rough','+ Occlusion','+ Glow'];
   steps.forEach((_,i)=>{const maps=Object.fromEntries(steps.slice(0,i+1).map(k=>[k,ids[k]])),x=(i-2)*2.1;b.prim(`Panel ${names[i]}`,[x,0,0],{shape:'plane',color:'#ffffff',roughness:1,metallic:1,normalScale:1.5,emissiveColor:'#ffffff',emissiveStrength:i===4?4:0,...maps,...i<2?{metallic:0,roughness:.85}:{}},[0,-12+i*6,0],1.9);const [sx]=screen(eye,pitch,[x,0,0]);b.label(names[i],sx,410,14);});
   b.label('One map at a time',480,40,22);}},
 {id:'pixi3d-toon',title:'Toon shading',category:'Materials',source:'materials_toon',
  description:'Cel shading: the Toon material splits light into a few flat bands, adds a sharp highlight and a rim light, and the view draws an ink outline around every toon surface that asks for one (Outline width and colour live on the 3D View).',
  async build(b){const eye=[0,1.3,7],pitch=-9;b.setView({outlineWidth:.04,outlineColor:'#1a1020',skyColor:'#ffe6c2',groundColor:'#6b5a8a',environmentIntensity:.35});b.camera3d(eye,[pitch,0,0]);sun(b,1.1,.25);floor(b,-1,'#8fb6a0');
   [['2 bands',-2.4,2,'#f2a65a','sphere'],['3 bands',-.8,3,'#5aa9e6','sphere'],['5 bands',.8,5,'#e85d75','sphere'],['No outline',2.4,3,'#9bc53d','sphere']].forEach(([name,x,bands,color,shape],i)=>{b.prim(name,[x,0,0],{shape,color,material:'toon',toonBands:bands,toonSpecularSize:.04,toonRimIntensity:.5,toonOutline:i!==3},[0,35,0],shape==='cube'?1.1:1.4);const [sx,sy]=screen(eye,pitch,[x,-1,0]);b.label(name,sx,sy+16,14);});
   b.label('Bands, rim light and ink outline',480,36,22);}},
 {id:'pixi3d-uv-transform',title:'UV transform',category:'Materials',source:'materials_uv-transform',
  description:'Placing a texture on a surface: Scroll moves it every second (a conveyor belt, press Play), Tile repeats it, Atlas frame shows one quarter of a 2 × 2 sheet with a scale of 0.5 and an offset, and Rotation turns it about the centre.',
  async build(b){const eye=[0,0,8.2],pitch=0,atlas=await b.texture('atlas','Atlas 2×2'),stripes=await b.texture('stripes','Hazard stripes');b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);
   const items=[['Scroll (Play)',{baseColorTexture:stripes,uvScrollX:.25}],['Tile 3 × 3',{baseColorTexture:atlas,uvScaleX:3,uvScaleY:3}],['Atlas frame',{baseColorTexture:atlas,uvScaleX:.5,uvScaleY:.5,uvOffsetX:.5,uvOffsetY:0}],['Rotation 45°',{baseColorTexture:atlas,uvRotation:45}]];
   items.forEach(([name,extra],i)=>{const x=(i-1.5)*2.4;b.prim(name,[x,0,0],{shape:'plane',color:'#ffffff',material:'flat',castShadow:false,...extra},[0,0,0],2);const [sx]=screen(eye,pitch,[x,0,0]);b.label(name,sx,410,15);});
   b.label('Scroll, tile, atlas frame, rotate',480,40,22);}},
 {id:'pixi3d-clearcoat',title:'Clear coat',category:'Materials',source:'materials_clearcoat',
  description:'A clear lacquer over the base material, with its own roughness, like car paint: the same rough red metal with no coat, a glossy coat and a satin coat. The coat keeps a sharp highlight while the base underneath stays soft.',
  async build(b){const eye=[0,.8,7],pitch=-6;b.setView({environmentIntensity:1.2});b.camera3d(eye,[pitch,0,0]);sun(b);floor(b);
   [['No coat',-2.3,0,0],['Glossy coat',0,1,0],['Satin coat',2.3,1,.45]].forEach(([name,x,coat,rough])=>{b.prim(name,[x,0,0],{color:'#b3122e',metallic:.6,roughness:.55,clearcoat:coat,clearcoatRoughness:rough},[0,0,0],1.7);const [sx,sy]=screen(eye,pitch,[x,-1,0]);b.label(name,sx,sy+16);});
   b.label('Clear coat over rough paint',480,36,22);}},
 {id:'pixi3d-sheen',title:'Sheen (velvet)',category:'Materials',source:'materials_sheen',
  description:'Sheen is the soft glow cloth and velvet get at grazing angles. Each ball is the same dark fabric; the sheen colour lights its edges, and sheen roughness spreads that glow wider.',
  async build(b){const eye=[0,.8,7],pitch=-6;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b);
   [['No sheen',-2.4,'#000000',0],['Red, tight',-.8,'#ff3355',.25],['Blue, soft',.8,'#4f8bff',.8],['Gold, soft',2.4,'#ffcc55',.8]].forEach(([name,x,sheen,rough])=>{b.prim(name,[x,0,0],{color:'#2a1830',roughness:.9,sheenColor:sheen,sheenRoughness:rough},[0,0,0],1.4);const [sx,sy]=screen(eye,pitch,[x,-1,0]);b.label(name,sx,sy+16,14);});
   b.label('Sheen at grazing angles',480,36,22);}},
 {id:'pixi3d-glass',title:'Glass and liquids',category:'Materials',source:'materials_transmission',
  description:'Transmission lets light through: clear glass bends and tints what is behind it, frosted glass blurs it with roughness, and a coloured liquid absorbs light the deeper it goes (absorb colour and distance). The view draws through its own texture so WebGL can see behind the glass.',
  async build(b){const eye=[0,.9,7],pitch=-6,checker=await b.texture('checker','Checker');b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b);
   b.prim('Backdrop',[0,.8,-2.2],{shape:'plane',color:'#ffffff',material:'flat',castShadow:false,baseColorTexture:checker,uvScaleX:3,uvScaleY:1.2},[0,0,0],[9,3.6,1]);
   [['Clear glass',-2.4,{roughness:.02,transmission:1,thickness:1,ior:1.5,color:'#ffffff'},'sphere'],['Frosted',-.8,{roughness:.45,transmission:1,thickness:1,color:'#ffffff'},'sphere'],['Green bottle',.8,{roughness:.05,transmission:1,thickness:1.2,attenuationColor:'#2e8b57',attenuationDistance:.6,color:'#ffffff'},'cube'],['Red wine',2.4,{roughness:.05,transmission:1,thickness:1.4,attenuationColor:'#a3122a',attenuationDistance:1.2,color:'#ffffff'},'sphere']].forEach(([name,x,glass,shape])=>{b.prim(name,[x,0,0],{shape,...glass},[0,25,0],shape==='cube'?1.1:1.4);const [sx,sy]=screen(eye,pitch,[x,-1,0]);b.label(name,sx,sy+16,14);});
   b.label('Clear, frosted and coloured glass',480,36,22);}},
 {id:'pixi3d-iridescence',title:'Iridescence',category:'Materials',source:'materials_iridescence',
  description:'A thin film over the surface, like a soap bubble or oil on water: its colour shifts with the viewing angle. The film thickness range picks which colours appear; a thicker film shows more bands.',
  async build(b){const eye=[0,.8,7],pitch=-6;b.setView({environmentIntensity:1.2});b.camera3d(eye,[pitch,0,0]);sun(b);floor(b);
   [['Plain',-2.4,0,100,400],['Thin film',-.8,1,100,400],['Thick film',.8,1,300,900],['Soap bubble',2.4,1,200,700]].forEach(([name,x,ir,lo,hi],i)=>{b.prim(name,[x,0,0],{color:i===3?'#ffffff':'#c4c9d2',metallic:i===3?0:1,roughness:.22,iridescence:ir,iridescenceThicknessMin:lo,iridescenceThicknessMax:hi,...i===3?{transmission:1,thickness:0}:{}},[0,0,0],1.4);const [sx,sy]=screen(eye,pitch,[x,-1,0]);b.label(name,sx,sy+16,14);});
   b.label('Colour that shifts with the angle',480,36,22);}},
 {id:'pixi3d-anisotropy',title:'Anisotropy (brushed metal)',category:'Materials',source:'materials_anisotropy',
  description:'Anisotropy stretches highlights along one direction on the surface, the look of brushed metal or a vinyl record. Strength sets how long the streak is; the angle turns its direction.',
  async build(b){const eye=[0,.8,7],pitch=-6;b.setView({environmentIntensity:1.1});b.camera3d(eye,[pitch,0,0]);sun(b);floor(b);
   [['Plain metal',-2.4,0,0],['Brushed',-.8,.8,0],['Brushed 90°',.8,.8,90],['Brushed 45°',2.4,.8,45]].forEach(([name,x,a,rot])=>{b.prim(name,[x,0,0],{color:'#c9ccd2',metallic:1,roughness:.35,anisotropy:a,anisotropyRotation:rot},[0,0,0],1.4);const [sx,sy]=screen(eye,pitch,[x,-1,0]);b.label(name,sx,sy+16,14);});
   b.label('Highlights stretched in one direction',480,36,22);}},
 {id:'pixi3d-specular-ior',title:'Specular and IOR',category:'Materials',source:'materials_specular-ior',
  description:'How strongly a non-metal reflects: the index of refraction (1.0 air, 1.33 water, 1.5 glass, 2.4 diamond) sets the base reflection, and Reflection strength and Highlight colour scale and tint it.',
  async build(b){const eye=[0,0,8.6],pitch=0;b.setView({environmentIntensity:1.2});b.camera3d(eye,[pitch,0,0]);sun(b);
   [1,1.33,1.5,2.4].forEach((ior,i)=>{const x=(i-1.5)*2.1;b.prim(`IOR ${ior}`,[x,.9,0],{color:'#1b3a5c',roughness:.2,ior},[0,0,0],1.4);const [sx,sy]=screen(eye,pitch,[x,.1,0]);b.label(`IOR ${ior}`,sx,sy+8,13);});
   [[0,'#ffffff'],[.5,'#ffffff'],[1,'#ffffff'],[1,'#ff9a3c']].forEach(([f,c],i)=>{const x=(i-1.5)*2.1;b.prim(`Specular ${f} ${c}`,[x,-1.1,0],{color:'#1b3a5c',roughness:.2,specularFactor:f,specularColor:c},[0,0,0],1.4);const [sx,sy]=screen(eye,pitch,[x,-1.9,0]);b.label(c==='#ffffff'?`strength ${f}`:'orange tint',sx,sy+8,13);});
   b.label('Index of refraction and reflection strength',480,32,22);}},
 {id:'pixi3d-extension-maps',title:'PBR extension maps',category:'Materials',source:'materials_extension-maps',
  description:'A texture map varies an extension across one surface instead of setting it everywhere: chips in a clear coat, lead lines in stained glass, rings in an iridescent film and a woven sheen pattern.',
  async build(b){const eye=[0,.4,8.4],pitch=-3,chips=await b.texture('coatChips','Coat chips'),lead=await b.texture('leading','Leading'),swirl=await b.texture('swirl','Film rings'),weave=await b.texture('weave','Weave'),checker=await b.texture('checker','Checker');b.setView({environmentIntensity:1.2});b.camera3d(eye,[pitch,0,0]);sun(b);
   b.prim('Backdrop',[0,.4,-2],{shape:'plane',color:'#ffffff',material:'flat',castShadow:false,baseColorTexture:checker,uvScaleX:4,uvScaleY:1.6},[0,0,0],[10,4,1]);
   const items=[['Chipped coat',{color:'#b3122e',metallic:.6,roughness:.55,clearcoat:1,clearcoatTexture:chips}],['Stained glass',{color:'#e7c45a',roughness:.05,transmission:1,transmissionTexture:lead,doubleSided:true}],['Film rings',{color:'#20242c',metallic:1,roughness:.15,iridescence:1,iridescenceThicknessMin:100,iridescenceThicknessMax:800,iridescenceTexture:swirl}],['Woven sheen',{color:'#1c1424',roughness:.9,sheenColor:'#ffffff',sheenRoughness:.5,sheenTexture:weave}]];
   items.forEach(([name,extra],i)=>{const x=(i-1.5)*2.4;b.prim(name,[x,0,0],{shape:i===1?'plane':'sphere',...extra},[0,i===1?15:0,0],i===1?1.9:1.6);const [sx]=screen(eye,pitch,[x,-1.1,0]);b.label(name,sx,420,14);});
   b.label('Maps that vary an extension',480,36,22);}},
 {id:'pixi3d-video',title:'Video texture',category:'Materials',source:'materials_video',
  description:'One video clip feeds two screens, so both always show the same frame. The clip plays muted in a loop as the colour map; a Flat material keeps it as bright as the video itself. Import your own .mp4 or .webm from the Library.',
  async build(b){const eye=[0,.6,7],pitch=-4,clip=await b.video('Colour bars');b.setView({environment:'none'});b.camera3d(eye,[pitch,0,0]);sun(b,1.4,.4);floor(b);
   b.prim('Screen A',[-1.7,.5,0],{shape:'plane',color:'#ffffff',material:'flat',castShadow:false,videoTexture:clip},[0,18,0],[3.2,1.8,1]);
   b.prim('Screen B',[1.7,.5,0],{shape:'plane',color:'#ffffff',material:'flat',castShadow:false,videoTexture:clip},[0,-18,0],[3.2,1.8,1]);
   b.prim('Stand A',[-1.7,-.6,0],{shape:'cube',color:'#3b3f46',roughness:.5},[0,18,0],[.2,1,.2]);b.prim('Stand B',[1.7,-.6,0],{shape:'cube',color:'#3b3f46',roughness:.5},[0,-18,0],[.2,1,.2]);
   b.label('One clip, two screens',480,36,22);}},
 {id:'pixi3d-shapes',title:'Built-in shapes',category:'Geometry',source:'geometry_shapes',
  description:'The nine built-in shapes: cube, sphere, plane, cylinder, cone, capsule, torus, torus knot and icosahedron. Each fits a unit box, so the transform scale sizes it; shape options such as smoothness, tube thickness, knot winds or gem detail sit under Shape in the Inspector.',
  async build(b){const eye=[0,0,10.5],pitch=0;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);
   const shapes=[['Cube','cube',{}],['Sphere','sphere',{}],['Plane','plane',{doubleSided:true}],['Cylinder','cylinder',{radiusTop:.35}],['Cone','cone',{}],['Capsule','capsule',{}],['Torus','torus',{tube:.14}],['Torus knot','torusKnot',{tube:.09}],['Icosahedron','icosahedron',{detail:0,flatShading:true}]];
   const colors=['#e0784a','#5aa9e6','#9bc53d','#f2c14e','#e85d75','#8e7dbe','#4ecdc4','#ff9f1c','#c3d350'];
   shapes.forEach(([name,shape,extra],i)=>{const col=i%3,row=Math.floor(i/3),x=(col-1)*3,y=(1-row)*2.35+.15,z=0;b.prim(name,[x,y,z],{shape,color:colors[i],roughness:.45,...extra},shape==='plane'?[-60,20,0]:[20,30,0],1.3);const [sx,sy]=screen(eye,pitch,[x,y-.75,z]);b.label(name,sx,sy+6,13);});
   b.label('Nine built-in shapes',480,32,22);}},
 {id:'pixi3d-lines-points',title:'Lines and points',category:'Geometry',source:'geometry_lines-and-points',
  description:'"Draw as" shows the same geometry three ways: as a lit surface, as a wireframe of its triangle edges (each shared edge once) and as a point at every vertex. Smoothness changes how many triangles, edges and points there are.',
  async build(b){const eye=[0,.6,7.4],pitch=-5;b.setView({environment:'none'});b.camera3d(eye,[pitch,0,0]);sun(b,2,.3);
   [['Surface','surface'],['Wireframe','wireframe'],['Points','points']].forEach(([name,draw],i)=>{const x=(i-1)*2.6;b.prim(`${name} knot`,[x,.9,0],{shape:'torusKnot',tube:.1,segments:24,color:'#5ad1e6',material:draw==='surface'?'pbr':'flat',draw},[20,0,0],1.9);b.prim(`${name} sphere`,[x,-1.1,0],{shape:'sphere',segments:16,color:'#f2c14e',material:draw==='surface'?'pbr':'flat',draw},[20,0,0],1.4);const [sx]=screen(eye,pitch,[x,0,0]);b.label(name,sx,505,15);});
   b.label('Surface, wireframe, points',480,32,22);}},
 {id:'pixi3d-sprites',title:'Sprites in 3D',category:'Sprites',source:'sprites_sprite3d',
  description:'A Sprite 3D is a picture on a flat quad, sized from its image (Size per pixel) and turned toward the camera: trees turn only around their upright axis, the glow faces the camera from every side, and the road sign stays a flat card. Cut-out transparency gives the leaves clean edges.',
  async build(b){const eye=[0,2,9],pitch=-12,tree=await b.texture('tree','Tree'),glow=await b.texture('glow','Glow'),sign=await b.texture('sign','Road sign');b.setView({skyColor:'#bfe0ff',groundColor:'#4f6b3a'});b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-1,'#5f7f45');
   [[-3.4,-1.5],[-2.2,.5],[-1,-2.5],[1.4,-1.8],[2.8,.2],[3.6,-3]].forEach(([x,z],i)=>b.sprite(`Tree ${i+1}`,[x,-1,z],{texture:tree,billboard:'cylindrical',pixelSize:.016,anchorY:1,alphaMode:'mask'}));
   b.sprite('Glow',[0,2.4,-3],{texture:glow,billboard:'spherical',pixelSize:.03,alphaMode:'blend',tint:'#ffd58a'});
   b.sprite('Road sign',[0,-.2,1.2],{texture:sign,billboard:'none',pixelSize:.008,alphaMode:'opaque'});
   b.label('Upright trees, a glow and a flat sign',480,32,22);}},
 {id:'pixi3d-tangent-space',title:'Tangent space',category:'Geometry',source:'geometry_tangent-space',
  description:'A normal map stores bump directions in the surface\'s own space (its tangent space), so one brick map lights correctly on any shape: the bricks catch the sun the same way on a flat panel, a cylinder, a sphere and a torus.',
  async build(b){const eye=[0,.6,7.4],pitch=-5,normal=await b.texture('brickNormal','Brick normal'),color=await b.texture('brickColor','Brick colour');b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b);
   [['Panel','cube',{uvScaleX:1,uvScaleY:1}],['Cylinder','cylinder',{uvScaleX:3}],['Sphere','sphere',{uvScaleX:3,uvScaleY:2}],['Torus','torus',{tube:.18,uvScaleX:4,uvScaleY:1}]].forEach(([name,shape,uv],i)=>{const x=(i-1.5)*2.3;b.prim(name,[x,0,0],{shape,color:'#ffffff',roughness:.8,baseColorTexture:color,normalTexture:normal,normalScale:2,...uv},shape==='torus'?[70,0,0]:[0,25,0],1.5);const [sx,sy]=screen(eye,pitch,[x,-1,0]);b.label(name,sx,sy+16,14);});
   b.label('One normal map, any shape',480,36,22);}},
 {id:'pixi3d-environment-light',title:'Environment light (cube map)',category:'Lighting',source:'lighting_environment',
  description:'A cube map lights a scene from all around and is what shiny surfaces reflect: the chrome ball mirrors the sky, mountains and sun, the matte ball takes only its soft colours, and the background shows the same cube. Load your own sky as one image: a 4:3 cross, a 6:1 strip or a 1:6 column.',
  async build(b){const eye=[0,.4,6.4],pitch=-4,sky=await b.cubemap('Mountain sky (cross)');b.setView({environment:'cubemap',cubemapAssetId:sky,background:'environment',exposure:1});b.camera3d(eye,[pitch,0,0]);b.light('Sun',[-50,35,0],{kind:'directional',intensity:1.5,castShadow:true,shadowBias:.001});
   [['Chrome',-2.2,{color:'#ffffff',metallic:1,roughness:.04}],['Brushed gold',0,{color:'#e8b84a',metallic:1,roughness:.35}],['Matte',2.2,{color:'#e0e0e0',metallic:0,roughness:1}]].forEach(([name,x,m])=>{b.prim(name,[x,0,0],m,[0,0,0],1.6);const [sx,sy]=screen(eye,pitch,[x,-.9,0]);b.label(name,sx,sy+14,14);});
   b.label('Light and reflections from a cube map',480,32,22);}},
 {id:'pixi3d-hdr-environment',title:'HDR environment',category:'Lighting',source:'lighting_hdr-environment',
  description:'A Radiance .hdr sky keeps light brighter than white: its sun is about 60 times brighter than the sky, so even two stops darker it still glints in metal, where an 8-bit sky image would have turned grey. Import your own .hdr panorama from the Library.',
  async build(b){const eye=[0,.4,6.4],pitch=-4,hdr=b.hdr('Mountain sky (HDR)');b.setView({environment:'hdr',environmentAssetId:hdr,background:'environment',toneMapping:'aces',exposure:.25});b.camera3d(eye,[pitch,0,0]);
   [['Chrome',-2.2,{color:'#ffffff',metallic:1,roughness:.04}],['Rough metal',0,{color:'#c9ccd2',metallic:1,roughness:.4}],['Matte',2.2,{color:'#e0e0e0',metallic:0,roughness:1}]].forEach(([name,x,m])=>{b.prim(name,[x,0,0],m,[0,0,0],1.6);const [sx,sy]=screen(eye,pitch,[x,-.9,0]);b.label(name,sx,sy+14,14);});
   b.label('Exposure 0.25: the sun still glints',480,32,22);}},
 {id:'pixi3d-fog',title:'Fog',category:'Lighting',source:'lighting_fog',
  description:'Distance fog fades far objects into a colour: Linear between a near and a far distance, Exponential and Exponential squared by density. Match the background to the fog colour so the horizon disappears.',
  async build(b){const views=[['Linear',{fog:'linear',fogNear:4,fogFar:22}],['Exponential',{fog:'exponential',fogDensity:.09}],['Exp squared',{fog:'exp2',fogDensity:.09}]];
   views.forEach(([name,fog],i)=>{const v=b.subview(`${name} view`,[i*320,60,316,420],{background:'color',backgroundColor:'#b8c6d6',fogColor:'#b8c6d6',...fog},[0,1.5,6],-10);v.light('Sun',[-50,35,0],{kind:'directional',intensity:2.2});v.light('Fill',[0,0,0],{kind:'ambient',intensity:.2});
    v.prim('Floor',[0,-1,-15],{shape:'plane',color:'#6d7a5a',roughness:.9},[-90,0,0],60);for(let k=0;k<8;k++)v.prim(`Pillar ${k+1}`,[(k%2?1:-1)*1.3,.2,2-k*3.5],{shape:'cylinder',color:'#c9784a',roughness:.6},[0,0,0],[.7,2.4,.7]);b.label(name,i*320+158,500,15);});
   b.label('Linear, exponential and exponential squared fog',480,30,20);}},
 {id:'pixi3d-tone-mapping',title:'Tone mapping',category:'Lighting',source:'lighting_tone-mapping',
  description:'Tone mapping turns scene light, which can be far brighter than white, into colours a screen can show. None clips bright light to flat white, while ACES, Reinhard and Uncharted 2 roll it off and keep colour in the glowing spheres.',
  async build(b){const tones=['none','aces','reinhard','uncharted2'],names=['None','ACES','Reinhard','Uncharted 2'];
   tones.forEach((tone,i)=>{const v=b.subview(`${names[i]} view`,[i*240,60,236,420],{toneMapping:tone,exposure:1.2,environment:'hemisphere',environmentIntensity:.6},[0,.6,5.2],-6);v.light('Sun',[-50,35,0],{kind:'directional',intensity:4});
    [['#ff6a3d',8],['#ffd23d',3],['#3da9ff',1.5]].forEach(([c,glow],k)=>v.prim(`Glow ${k+1}`,[0,1.3-k*1.25,0],{color:c,emissiveColor:c,emissiveStrength:glow,roughness:.4},[0,0,0],.95));b.label(names[i],i*240+118,500,15);});
   b.label('None, ACES, Reinhard and Uncharted 2',480,30,20);}},
 {id:'pixi3d-light-types',title:'Light types',category:'Lighting',source:'lighting_light-types',
  description:'The four kinds of light, one per view: Directional (parallel sun rays with shadows), Ambient (flat light everywhere, no direction), Point (a bulb that fades with its range) and Spot (a cone with a soft edge and shadows). Select a light to see its gizmo.',
  async build(b){const kinds=[['Directional',{kind:'directional',intensity:2.5,castShadow:true,shadowBias:.001},[-50,35,0],[0,0,0]],['Ambient',{kind:'ambient',intensity:.9},[0,0,0],[0,0,0]],['Point',{kind:'point',intensity:25,range:6,color:'#ffd9a0'},[0,0,0],[0,1.2,.6]],['Spot',{kind:'spot',intensity:70,range:12,coneAngle:22,penumbra:.35,castShadow:true,shadowBias:.001},[-70,0,0],[0,4,1.2]]];
   kinds.forEach(([name,light,rot,pos],i)=>{const v=b.subview(`${name} view`,[i*240,60,236,420],{environment:'none'},[0,2.2,6],-18);v.light(name,rot,light,pos);if(name!=='Ambient')v.light('Faint fill',[0,0,0],{kind:'ambient',intensity:.05});
    v.prim('Floor',[0,-.5,0],{shape:'plane',color:'#cfc8b8',roughness:.9},[-90,0,0],8);v.prim('Ball',[-.6,0,0],{color:'#5aa9e6',roughness:.4},[0,0,0],.9);v.prim('Block',[.7,0,-.4],{shape:'cube',color:'#e0784a',roughness:.6},[0,30,0],.9);b.label(name,i*240+118,500,15);});
   b.label('Directional, ambient, point and spot',480,30,20);}},
 {id:'pixi3d-many-lights',title:'Many lights',category:'Lighting',source:'lighting_many-lights',
  description:'Twenty-four coloured point lights at once, one between each group of spheres. Each light reaches only as far as its range, so a pixel pays only for the lights near it, and every pool of colour stays local.',
  async build(b){const eye=[0,7,11],pitch=-34;b.setView({environment:'none',toneMapping:'aces'});b.camera3d(eye,[pitch,0,0]);b.light('Faint fill',[0,0,0],{kind:'ambient',intensity:.04});
   b.prim('Floor',[0,-.5,0],{shape:'plane',color:'#2a2e36',roughness:.5,metallic:.3},[-90,0,0],30);
   for(let r=0;r<5;r++)for(let c=0;c<7;c++)b.prim(`Ball ${r*7+c+1}`,[(c-3)*1.6,0,(r-2)*1.6],{color:'#d8d8d8',roughness:.35},[0,0,0],.7);
   const hex=h=>{const f=n=>{const k=(n+h/30)%12,v=.5-.5*Math.max(-1,Math.min(k-3,9-k,1));return Math.round(v*255).toString(16).padStart(2,'0');};return`#${f(0)}${f(8)}${f(4)}`;};
   for(let r=0;r<4;r++)for(let c=0;c<6;c++){const k=r*6+c;b.light(`Light ${k+1}`,[0,0,0],{kind:'point',intensity:5,range:2.6,color:hex((k*137)%360)},[(c-2.5)*1.6,.55,(r-1.5)*1.6]);}
   b.label('24 point lights, each with a range',480,32,22);}},
 {id:'pixi3d-shadows',title:'Shadows',category:'Shadows',source:'shadows_basics',
  description:'A shadow needs a light that casts (Cast shadows on the sun) and meshes that cast and receive. Shadow quality sets the shadow map size and Shadow edges its filter: Low and hard on the left, High and soft in the middle, Ultra and softer on the right.',
  async build(b){const set=[['Low, hard',{shadowQuality:'low',shadowFilter:'hard'}],['High, soft',{shadowQuality:'high',shadowFilter:'pcf'}],['Ultra, softer',{shadowQuality:'ultra',shadowFilter:'pcf-high'}]];
   set.forEach(([name,q],i)=>{const v=b.subview(`${name} view`,[i*320,60,316,420],q,[0,2.4,5],-24);v.light('Sun',[-55,40,0],{kind:'directional',intensity:2.6,castShadow:true,shadowBias:.001});v.light('Fill',[0,0,0],{kind:'ambient',intensity:.25});
    v.prim('Floor',[0,-.5,0],{shape:'plane',color:'#d8d2c4',roughness:.9},[-90,0,0],10);v.prim('Torus knot',[0,.5,0],{shape:'torusKnot',tube:.09,color:'#e0784a',roughness:.5},[20,0,0],1.3);v.prim('Fence post',[1.2,.2,.6],{shape:'cylinder',color:'#6b8e4e'},[0,0,0],[.15,1.4,.15]);b.label(name,i*320+158,500,15);});
   b.label('Shadow map size and edge filter',480,30,20);}},
 {id:'pixi3d-shadows-large',title:'Shadows over a large scene',category:'Shadows',source:'shadows_large-scenes',
  description:'One shadow map stretched over a large world gets blurry. Cascades split the view by distance and give the near part its own sharp map, so the posts by the camera and those far away both keep shadows. Shadow distance limits how far they reach.',
  async build(b){const eye=[0,2.2,6],pitch=-12;b.setView({shadowQuality:'high',shadowFilter:'pcf'});b.camera3d(eye,[pitch,0,0]);
   b.light('Sun',[-40,30,0],{kind:'directional',intensity:2.6,castShadow:true,shadowPlacement:'cascades',shadowCascades:3,shadowMaxDistance:80,shadowLambda:.7,shadowBias:.001});b.light('Fill',[0,0,0],{kind:'ambient',intensity:.2});
   b.prim('Field',[0,-.5,-40],{shape:'plane',color:'#8fae6a',roughness:.95},[-90,0,0],100);
   for(let r=0;r<16;r++)for(let c=-3;c<=3;c++)b.prim(`Post ${r}.${c}`,[c*2.2+(r%2)*1.1,.4,2-r*4.5],{shape:'cylinder',color:'#7a5536',roughness:.8},[0,0,0],[.25,1.8,.25]);
   b.label('Cascaded shadows, near and far',480,32,22);}},
 {id:'pixi3d-lod',title:'Level of detail',category:'Instancing',source:'instancing_lod',
  description:'Level of detail swaps a far object for a coarser copy: each sphere past its Simplify distance drops to a few segments, with a 10% band so it never flickers at the boundary. The wireframe makes the swap visible; press Play and the camera dollies in and out.',
  async build(b){const eye=[0,1.2,4],pitch=-6;b.setView({environment:'none'});b.camera3d(eye,[pitch,0,0]);b.light('Sun',[-40,30,0],{kind:'directional',intensity:2});b.light('Fill',[0,0,0],{kind:'ambient',intensity:.3});
   for(let k=0;k<10;k++)b.prim(`Sphere ${k+1}`,[k%2?1.1:-1.1,.4,-k*2.6],{shape:'sphere',segments:40,lodDistance:12,lodSegments:6,draw:'wireframe',material:'flat',color:k*2.6+4>12?'#ffb347':'#5ad1e6'},[0,0,0],1.4);
   b.tween(b.camera,'z',4,-12,6);
   b.label('Near spheres: 40 segments · far: 6',480,32,22);}},
 {id:'pixi3d-orbit-camera',title:'Orbit camera',category:'Cameras',source:'cameras_orbit',
  description:'A Camera control in Orbit mode on the scene camera: in Play, drag to turn around the target, scroll to zoom and right-drag to pan, within the min and max distance. Auto-rotate turns it on its own until you take over.',
  async build(b){const eye=[0,2.6,7],pitch=-18;b.setView();b.camera3d(eye,[pitch,0,0]);b.control(b.camera,{targetY:.4,minDistance:3,maxDistance:16,autoRotate:true,autoRotateSpeed:3});sun(b);floor(b,-.6,'#56606e');
   b.prim('Pedestal',[0,-.35,0],{shape:'cylinder',color:'#c9ccd2',roughness:.5},[0,0,0],[2.2,.5,2.2]);b.prim('Knot',[0,.9,0],{shape:'torusKnot',tube:.09,color:'#e0784a',roughness:.35,metallic:.3},[0,0,0],1.6);
   for(let k=0;k<6;k++){const a=k/6*Math.PI*2;b.prim(`Post ${k+1}`,[Math.cos(a)*3.4,.2,Math.sin(a)*3.4],{shape:'capsule',color:'#5aa9e6'},[0,0,0],[.5,1.4,.5]);}
   b.label('Play, then drag, scroll and right-drag',480,32,20);}},
 {id:'pixi3d-first-person',title:'First-person camera',category:'Cameras',source:'cameras_first-person',
  description:'A Camera control in First person mode: in Play, click the view to look around with the mouse (the pointer locks; Esc frees it) and walk with W A S D. Walk speed and look speed are on the control.',
  async build(b){const eye=[0,.6,4.5],pitch=0;b.setView({fog:'linear',fogColor:'#c9d4e2',fogNear:4,fogFar:26,background:'color',backgroundColor:'#c9d4e2'});b.camera3d(eye,[pitch,0,0]);b.control(b.camera,{mode:'firstPerson',moveSpeed:3});sun(b,2.2,.25);floor(b,-.5,'#b9a98a');
   const maze=['#########','#...#...#','#.#.#.#.#','#.#...#.#','#.#####.#','#.......#','###.#####'];
   maze.forEach((row,z)=>[...row].forEach((cell,x)=>{if(cell==='#')b.prim(`Wall ${x}.${z}`,[(x-4)*1.6,.4,(z-6)*1.6],{shape:'cube',color:(x+z)%2?'#d8b48a':'#cfa77a',roughness:.85},[0,0,0],[1.6,1.8,1.6]);}));
   b.label('Play, click, then W A S D and the mouse',480,32,20);}},
 {id:'pixi3d-second-cameras',title:'Second cameras',category:'Cameras',source:'cameras_render-to-texture',
  description:'A second camera draws the scene into a texture a surface shows: the monitor plays a security camera aimed at the statue, and the small panel is a minimap from an orthographic camera looking straight down. Set a surface\'s "Show camera" to a camera\'s ID; the feed size is on that camera.',
  async build(b){const eye=[0,2.2,7.2],pitch=-14;b.setView({toneMapping:'none',environmentIntensity:.9});b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.5,'#7f9168');
   b.prim('Statue',[-1.8,.6,-1.2],{shape:'torusKnot',tube:.1,color:'#e85d75',roughness:.4},[0,0,0],1.5);b.prim('Box',[-3.2,0,.5],{shape:'cube',color:'#f2c14e'},[0,30,0],.9);b.prim('Ball',[.2,0,-2.8],{color:'#5aa9e6'},[0,0,0],.9);
   const security=b.camera2('Security camera',[-1.8,1.3,1.6],[-8,0,0],{fov:40,feedWidth:320,feedHeight:180}),top=b.camera2('Minimap camera',[-1,8,-1],[-90,0,0],{mode:'orthographic',orthographicSize:4.5,feedWidth:256,feedHeight:256});
   b.prim('Monitor',[2.1,.9,0],{shape:'plane',color:'#ffffff',material:'flat',castShadow:false,feedCameraId:security},[0,-25,0],[2.4,1.35,1]);b.prim('Monitor frame',[2.12,.9,-.05],{shape:'cube',color:'#2a2e36'},[0,-25,0],[2.6,1.5,.06]);
   b.prim('Minimap',[3.6,1.35,1.2],{shape:'plane',color:'#ffffff',material:'flat',castShadow:false,feedCameraId:top},[0,-30,0],1.1);b.prim('Minimap frame',[3.62,1.35,1.15],{shape:'cube',color:'#2a2e36'},[0,-30,0],[1.2,1.2,.06]);
   b.label('A security feed and a minimap',480,32,22);}},
 {id:'pixi3d-projection',title:'Perspective and orthographic',category:'Cameras',source:'cameras_projection',
  description:'How a camera flattens 3D onto the screen: Perspective shrinks what is far away by the field of view; Orthographic keeps sizes, which with a camera turned 45° and tilted down gives the isometric look of strategy and puzzle games.',
  async build(b){[['Perspective',{},[5.2,4.4,5.2],-35,45],['Orthographic (isometric)',{mode:'orthographic',orthographicSize:3.2},[6,4.9,6],-35.26,45]].forEach(([name,cam,eye,pitch,yaw],i)=>{
    const v=b.subview(`${name} view`,[i*480,60,476,420],{},eye,pitch,cam,yaw);v.light('Sun',[-55,30,0],{kind:'directional',intensity:2.4,castShadow:true,shadowBias:.001});v.light('Fill',[0,0,0],{kind:'ambient',intensity:.25});
    v.prim('Ground',[0,-.5,0],{shape:'plane',color:'#8fae6a'},[-90,0,0],8);for(let x=0;x<3;x++)for(let z=0;z<3;z++)v.prim(`Block ${x}.${z}`,[(x-1)*1.5,(x+z)%3*.25,(z-1)*1.5],{shape:'cube',color:['#e0784a','#f2c14e','#5aa9e6'][(x+z)%3]},[0,0,0],[1,.5+(x+z)%3*.5,1]);b.label(name,i*480+238,500,15);});
   b.label('Perspective and isometric orthographic',480,30,20);}},
 {id:'pixi3d-clipping',title:'Clipping planes',category:'Cameras',source:'cameras_clipping',
  description:'A camera draws only what lies between its Near clip and Far clip distances. Left: the default range shows the whole row. Middle: a near clip of 4 cuts away the posts closest to the camera. Right: a far clip of 9 drops everything beyond it.',
  async build(b){[['Near 0.1, far 200',{near:.1,far:200}],['Near 4',{near:4,far:200}],['Far 9',{near:.1,far:9}]].forEach(([name,cam],i)=>{const v=b.subview(`${name} view`,[i*320,60,316,420],{background:'color',backgroundColor:'#20262e'},[0,1.2,3],-8,cam);v.light('Sun',[-50,30,0],{kind:'directional',intensity:2.4});v.light('Fill',[0,0,0],{kind:'ambient',intensity:.25});
    for(let k=0;k<9;k++)v.prim(`Post ${k+1}`,[(k%2?.9:-.9),0,-k*1.6],{shape:'cylinder',color:['#e0784a','#f2c14e','#9bc53d','#4ecdc4','#5aa9e6','#8e7dbe','#e85d75','#ff9f1c','#c3d350'][k]},[0,0,0],[.6,1.6,.6]);b.label(name,i*320+158,500,15);});
   b.label('Near and far clipping',480,30,20);}},
 {id:'pixi3d-portal',title:'Portals',category:'Cameras',source:'post_portal',
  description:'A portal surface shows the far side of another surface, its exit, as if looking through an opening: here a door in a grey room opens onto a sunny garden that sits elsewhere in the scene, hidden behind the wall. Set the entry\'s "Portal exit" to the exit object\'s ID.',
  async build(b){const eye=[0,.9,5],pitch=-4;b.setView({toneMapping:'aces'});b.camera3d(eye,[pitch,0,0]);sun(b,2.2,.3);
   b.prim('Room floor',[0,-.5,0],{shape:'plane',color:'#7a7f88',roughness:.9},[-90,0,0],[8,8,1]);b.prim('Back wall',[0,1,-1.2],{shape:'cube',color:'#9aa0a8',roughness:.9},[0,0,0],[8,3,.2]);
   const door=b.prim('Door (entry)',[0,.55,-1.05],{shape:'plane',color:'#ffffff'},[0,0,0],[1.4,2.1,1]);
   b.prim('Garden ground',[0,-.5,-24],{shape:'plane',color:'#6fa84f',roughness:.95},[-90,0,0],14);for(let k=0;k<7;k++)b.prim(`Flower ${k+1}`,[(k-3)*1.3,0,-27-(k%3)*1.4],{color:['#e85d75','#f2c14e','#ffffff','#8e7dbe'][k%4],roughness:.5},[0,0,0],.7);b.prim('Garden tree',[1.5,.8,-29],{shape:'cone',color:'#2f7d3a'},[0,0,0],[1.6,2.6,1.6]);
   const exit=b.prim('Garden gate (exit)',[0,.55,-22],{shape:'plane',color:'#ffffff',castShadow:false},[0,180,0],[1.4,2.1,1]);
   const d=door.components.find(c=>c.type==='pixi3d.primitive');d.data.portalExitId=exit.id;d.data.castShadow=false;
   b.label('A door that opens onto the garden',480,32,22);}},
 {id:'pixi3d-container-texture',title:'2D on a 3D surface',category:'2D and 3D',source:'2d3d_container-texture',
  description:'A surface can show a live 2D object: set its "Show 2D object" to the ID of a 2D group and it captures that group every frame, here a panel with a title, a bouncing ball and a moving bar. The group sits off the stage, so it only shows on the monitor. Flat keeps it as bright as a screen.',
  async build(b){const eye=[0,.9,5.4],pitch=-6;b.setView({toneMapping:'none',environmentIntensity:.9});b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.5,'#5c6470');
   const panel=b.node2d('Screen content (off stage)',-1400,0);b.node2d('Panel background',256,128,[b.shape2d('rect',512,256,'#1b1430')],panel);
   b.node2d('Title',256,40,[b.text2d('PIXI ON A SCREEN',34,'#ffc46b')],panel);const ball=b.node2d('Ball',60,150,[b.shape2d('ellipse',56,56,'#4ecdc4')],panel);b.tween(ball,'x',60,452,1.6);
   const bar=b.node2d('Bar',40,222,[b.shape2d('rect',140,14,'#e85d75')],panel);b.tween(bar,'x',30,342,2.3);
   b.prim('Monitor',[0,.7,0],{shape:'plane',material:'flat',color:'#ffffff',castShadow:false,screenSourceId:panel,screenWidth:512,screenHeight:256},[0,0,0],[3.2,1.6,1]);b.prim('Monitor body',[0,.7,-.06],{shape:'cube',color:'#2a2e36'},[0,0,0],[3.4,1.8,.08]);b.prim('Stand',[0,-.25,-.06],{shape:'cylinder',color:'#2a2e36'},[0,0,0],[.25,.5,.25]);
   b.label('A live 2D panel on a monitor (press Play)',480,32,20);}},
 {id:'pixi3d-screen-world',title:'Screen and world',category:'2D and 3D',source:'2d3d_coordinates',
  description:'A 2D object with "Follow 3D object" rides on a 3D object\'s place on screen while the game runs: each name tag follows its moving ball, a little above it, and hides if the ball goes behind the camera. Health bars and markers work the same way.',
  async build(b){const eye=[0,2.6,7.5],pitch=-18;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.5,'#56606e');
   [['Ruby','#e85d75',-2],['Jade','#9bc53d',0],['Sky','#5aa9e6',2]].forEach(([name,color,x],i)=>{const ball=b.prim(name,[x,0,0],{color,roughness:.4},[0,0,0],.8);b.tween(ball.id,'z',-2.5,2,1.8+i*.5);
    const tag=b.node2d(`${name} tag`,0,0);b.node2d(`${name} tag back`,0,0,[b.shape2d('rect',84,30,'#10151c',{alpha:.85,rounded:8})],tag);b.node2d(`${name} tag text`,0,0,[b.text2d(name,16,color)],tag);b.follow(tag,ball.id,{offsetY:.75});});
   b.label('Name tags that follow 3D objects (press Play)',480,32,20);}},
 {id:'pixi3d-view-filters',title:'Filters on a 3D view',category:'2D and 3D',source:'2d3d_filters',
  description:'A 3D view is a 2D object too, so Effects and Mask work on it like on a sprite: the left view is pixelated, the middle one hue-shifted with a glow, and the right one cut to a circle by a mask.',
  async build(b){const looks=[['Pixelate',{pixelate:8}],['Hue + glow',{hue:120,saturation:1.4}],['Circle mask',null]];
   looks.forEach(([name,fx],i)=>{const v=b.subview(`${name} view`,[i*320+8,70,300,300],{},[0,1.6,4.2],-20);v.light('Sun',[-50,35,0],{kind:'directional',intensity:2.4});v.light('Fill',[0,0,0],{kind:'ambient',intensity:.3});v.prim('Knot',[0,.3,0],{shape:'torusKnot',tube:.1,color:'#e0784a',roughness:.35},[0,0,0],1.6);v.prim('Floor',[0,-.6,0],{shape:'plane',color:'#4e5866'},[-90,0,0],6);
    const id=b.lastView,camId=entities_of(b).find(e=>e.id===id).components.find(c=>c.type==='pixi3d.viewport').data.cameraId;b.control(camId,{autoRotate:true,autoRotateSpeed:4,minDistance:2,maxDistance:8});if(fx)b.effects(id,fx);else b.mask(id,{shape:'ellipse',width:300,height:300,offsetX:150,offsetY:150});b.label(name,i*320+158,410,15);});
   b.label('Effects and a mask on 3D views',480,32,20);}},
 {id:'pixi3d-many-views',title:'Many views',category:'2D and 3D',source:'2d3d_many-views',
  description:'Many 3D views side by side on one 2D stage, each with its own scene, lights and camera. Every camera here has an Orbit control with auto-rotate, so in Play each object turns in its own window.',
  async build(b){const shapes=[['torusKnot','#e0784a'],['icosahedron','#9bc53d'],['capsule','#5aa9e6'],['torus','#f2c14e'],['cone','#e85d75'],['cylinder','#8e7dbe']];
   shapes.forEach(([shape,color],i)=>{const x=(i%3)*316+10,y=Math.floor(i/3)*236+60;const v=b.subview(`${shape} view`,[x,y,304,224],{environmentIntensity:.9},[0,1.2,3.6],-18);v.light('Sun',[-50,35,0],{kind:'directional',intensity:2.2});v.prim(shape,[0,0,0],{shape,color,roughness:.4,detail:0,flatShading:shape==='icosahedron',tube:.12},[0,0,0],1.5);
    const view=entities_of(b).find(e=>e.id===b.lastView),camId=view.components.find(c=>c.type==='pixi3d.viewport').data.cameraId;b.control(camId,{autoRotate:true,autoRotateSpeed:4+i,minDistance:2,maxDistance:8});});
   b.label('Six views, six scenes',480,30,20);}},
 {id:'pixi3d-view-in-ui',title:'A view in a 2D UI',category:'2D and 3D',source:'2d3d_view-in-ui',
  description:'A 3D view sits inside a 2D layout like any panel: its transparent background lets the 2D card show through, the 2D title, price and button draw around it, and its Orbit camera turns the product on its own until you drag it.',
  async build(b){b.node2d('Card',480,290,[b.shape2d('rect',600,460,'#f4efe6',{rounded:24})]);b.node2d('Title',480,80,[b.text2d('Clay Teapot Knot',30,'#2a2e36')]);b.node2d('Price',480,410,[b.text2d('$ 42',26,'#e0784a')]);
   const button=b.node2d('Button',480,462);b.node2d('Button back',0,0,[b.shape2d('rect',200,48,'#2a2e36',{rounded:24})],button);b.node2d('Button label',0,0,[b.text2d('Add to cart',18,'#ffffff')],button);
   const v=b.subview('Product view',[230,110,500,280],{background:'transparent',environmentIntensity:1},[0,1,4.2],-12);v.light('Sun',[-50,35,0],{kind:'directional',intensity:2.2});v.prim('Product',[0,.2,0],{shape:'torusKnot',tube:.11,color:'#d97b4f',roughness:.5},[0,0,0],1.6);
   const view=entities_of(b).find(e=>e.id===b.lastView),camId=view.components.find(c=>c.type==='pixi3d.viewport').data.cameraId;b.control(camId,{autoRotate:true,autoRotateSpeed:3,minDistance:2.5,maxDistance:7,enablePan:false});
   b.label('A transparent 3D view inside a 2D card',480,20,18,'#e8edf2');}},
 {id:'pixi3d-glass-over-2d',title:'3D over 2D',category:'2D and 3D',source:'2d3d_glass-over-2d',
  description:'A view with a transparent background draws its 3D over whatever 2D sits behind it: the stripes and the 2D text show around the metal ring and through the see-through ball (Transparency: Blend). Glass (transmission) bends only the 3D scene, not 2D behind the view.',
  async build(b){for(let k=0;k<12;k++)b.node2d(`Stripe ${k+1}`,k*80+20,270,[b.shape2d('rect',40,540,k%2?'#f2c14e':'#5aa9e6',{alpha:.9})]);b.node2d('Back text',480,470,[b.text2d('2D BEHIND THE VIEW',40,'#1b1430')]);
   const v=b.subview('Glass view',[0,0,960,540],{background:'transparent',environmentIntensity:1},[0,0,6],0);v.light('Sun',[-50,35,0],{kind:'directional',intensity:2.4});v.prim('Clear ball',[-1.2,.2,0],{roughness:.05,alphaMode:'blend',alpha:.35,color:'#dff2ff'},[0,0,0],1.8);v.prim('Ring',[1.6,.2,0],{shape:'torus',tube:.12,color:'#c9ccd2',metallic:1,roughness:.2},[70,0,0],1.6);
   b.label('3D drawn over 2D',480,30,22,'#1b1430');}},
 {id:'pixi3d-playing-clips',title:'Playing clips',category:'Animation',source:'animation_clips',
  description:'One skinned model, three Model animation settings: Idle on its own, Wave on its own, and Idle blended with Wave at half strength ("Blend with clip"). Change the clip while it plays and it crossfades over "Crossfade (s)" instead of cutting.',
  async build(b){const eye=[0,1.4,6.2],pitch=-6,t=await b.model('tentacle','Tentacle',await tentacle());b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.02,'#56606e');
   [['Idle',-2.2,{clip:'Idle'}],['Wave',0,{clip:'Wave'}],['Idle + Wave 50%',2.2,{clip:'Idle',blendClip:'Wave',blendWeight:.5}]].forEach(([name,x,anim])=>{b.modelEntity(name,[x,0,0],t,anim);const [sx,sy]=screen(eye,pitch,[x,0,0]);b.label(name,sx,sy+18,14);});
   b.label('Clips, and a blend of two (press Play)',480,32,20);}},
 {id:'pixi3d-crowd',title:'Crowd',category:'Animation',source:'animation_crowd',
  description:'Twenty copies of one animated model, each with its own Model animation: clips mixed, speeds from 0.7 to 1.3 and "Start at" offsets, so no two move in step. The model file loads once and every copy shares it.',
  async build(b){const eye=[0,4.2,9.5],pitch=-20,t=await b.model('tentacle','Tentacle',await tentacle([.55,.72,.4,1]));b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.02,'#4d5a3f');
   const clips=['Idle','Wave','Twist'];for(let r=0;r<4;r++)for(let c=0;c<5;c++){const k=r*5+c;b.modelEntity(`Dancer ${k+1}`,[(c-2)*1.5+(r%2)*.4,0,(r-1.5)*1.6],t,{clip:clips[(k*7)%3],speed:.7+((k*37)%7)/10,startOffset:((k*53)%17)/10},[0,(k*47)%360,0],.8);}
   b.label('Twenty dancers, one model (press Play)',480,32,20);}},
 {id:'pixi3d-morph-targets',title:'Morph targets',category:'Animation',source:'animation_morph-targets',
  description:'A model\'s morph targets are extra shapes its surface blends toward. The left blob plays its Wobble clip, which animates the Squash and Spike weights; the right one sets them by hand ("Set morph weights by hand", Morph 1 = 0.6, Morph 2 = 0.8).',
  async build(b){const eye=[0,.9,5.2],pitch=-8,bl=await b.model('blob','Blob',await blob());b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.6,'#56606e');
   b.modelEntity('Wobbling',[-1.3,0,0],bl,{clip:'Wobble'},[0,0,0],1.6);b.modelEntity('Set by hand',[1.3,0,0],bl,null,[0,0,0],1.6,{morphOverride:true,morph1:.6,morph2:.8});
   [['Clip: Wobble',-1.3],['By hand',1.3]].forEach(([n,x])=>{const [sx,sy]=screen(eye,pitch,[x,-.9,0]);b.label(n,sx,sy+10,14);});
   b.label('Morph weights from a clip and by hand',480,32,20);}},
 {id:'pixi3d-driving-bones',title:'Driving bones',category:'Animation',source:'animation_bones',
  description:'"Aim a bone" turns one bone of a playing model toward another object after its clip poses it: each tentacle waves, but its Tip bone keeps pointing (along +Y) at the glowing ball that circles above. Aim strength blends between the clip and the aim.',
  async build(b){const eye=[0,2.2,6.4],pitch=-14,t=await b.model('tentacle','Tentacle',await tentacle([.62,.48,.9,1]));b.setView({bloom:true,bloomThreshold:1,bloomIntensity:.8,bloomRadius:.5});b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.02,'#3d4450');
   const ball=b.prim('Target',[0,1.7,1],{color:'#ffcc55',emissiveColor:'#ffaa33',emissiveStrength:6,castShadow:false},[0,0,0],.35);b.tween(ball.id,'x',-3.2,3.2,2.6);
   [-1.8,0,1.8].forEach((x,i)=>{const e=b.modelEntity(`Tentacle ${i+1}`,[x,0,0],t,{clip:'Idle',startOffset:i*.4});b.aim(e,{bone:'Tip',targetId:ball.id,axis:'+Y',weight:[.5,1,1][i]});});
   b.label('Tips that follow the ball (press Play)',480,32,20);}},
 {id:'pixi3d-tweening',title:'Tweening 3D objects',category:'Animation',source:'animation_gsap',
  description:'A Tween player on a 3D object animates its transform without any clip: one cube slides, one turns (rotation tweens take the short way round), one breathes in scale. Tweens can loop, yoyo and ease like their 2D cousins.',
  async build(b){const eye=[0,1.4,6],pitch=-10;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.6,'#56606e');
   const slide=b.prim('Slide',[-2,0,0],{shape:'cube',color:'#e0784a'},[0,0,0],.8);b.tween(slide.id,'z',-1.5,1.5,1.4);
   const spin=b.prim('Turn',[0,0,0],{shape:'cube',color:'#5aa9e6'},[0,0,0],.8);const t=spin.components.find(c=>c.type==='scene3d.transform');spin.components.push({id:t.id+'-spin',type:'tween.player',version:1,data:{duration:1.6,delay:0,ease:'cubic.inOut',repeat:100,yoyo:true,autoplay:true,tracks:[{id:'turn',entityId:spin.id,componentId:t.id,property:'rotation',from:[0,0,0,1],to:[0,Math.SQRT1_2,0,Math.SQRT1_2]}]}});
   const scale=b.prim('Scale',[2,0,0],{shape:'cube',color:'#9bc53d'},[0,0,0],.8),st=scale.components.find(c=>c.type==='scene3d.transform');scale.components.push({id:st.id+'-breathe',type:'tween.player',version:1,data:{duration:.9,delay:0,ease:'sine.inOut',repeat:100,yoyo:true,autoplay:true,tracks:['scaleX','scaleY','scaleZ'].map(property=>({id:property,entityId:scale.id,componentId:st.id,property,from:.6,to:1.1}))}});
   b.label('Slide, turn and breathe (press Play)',480,32,20);}},
 {id:'pixi3d-pointer-events',title:'Pointer events',category:'Interaction',source:'interaction_pointer-events',
  description:'In the game, 3D objects answer the pointer like 2D ones. Each shape has rules: "Pointer enters a 3D object" lights the ring under it, "Pointer leaves" turns it off, and a click ("Pointer click", which works on 3D objects too) adds 1 to the clicks global the counter text shows.',
  async build(b){const eye=[0,3.2,7.5],pitch=-20;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.75,'#3d4450');const clicks=b.global('clicks');
   [['Cube',-2.4,{shape:'cube',color:'#e0784a'}],['Ball',0,{shape:'sphere',color:'#5aa9e6'}],['Knot',2.4,{shape:'torusKnot',color:'#9bc53d',tube:.12}]].forEach(([name,x,d])=>{
    const ring=b.prim(`${name} ring`,[x,-.72,0],{shape:'torus',tube:.06,color:'#ffd27a',emissiveColor:'#ffcc55',emissiveStrength:4,castShadow:false,hitVolume:'none'},[0,0,0],1.6);ring.active=false;
    const shape=b.prim(name,[x,0,0],d,[0,30,0],1.1);
    b.rule(shape.id,'pixi3d.pointerEnter',shape.id,[['entity.active',ring.id]]);b.rule(shape.id,'pixi3d.pointerLeave',shape.id,[['entity.active',ring.id,{value:false}]]);b.rule(shape.id,'pointer.click',shape.id,[['global.add',clicks,{amount:1}]]);});
   b.label('Hover and click the shapes (press Play)',480,32,20);b.label('Clicks: {clicks}',480,500,24,'#ffd27a');}},
 {id:'pixi3d-dragging',title:'Dragging objects',category:'Interaction',source:'interaction_drag',
  description:'A Draggable component lets the player move a 3D object with the pointer. The crates slide on the ground and snap to a half-unit grid; the ball moves on a plane facing the camera, so it can be lifted. "3D object dropped" counts every drop.',
  async build(b){const eye=[0,5,7.5],pitch=-32;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);const drops=b.global('drops');
   b.prim('Floor',[0,-.5,0],{shape:'plane',color:'#3a4350',roughness:.9,hitVolume:'none'},[-90,0,0],30);
   for(let k=-4;k<=4;k++){b.prim(`Grid X ${k+5}`,[k,-.49,0],{shape:'cube',color:'#55606f',castShadow:false,hitVolume:'none'},[0,0,0],[.02,.01,8]);b.prim(`Grid Z ${k+5}`,[0,-.49,k],{shape:'cube',color:'#55606f',castShadow:false,hitVolume:'none'},[0,0,0],[8,.01,.02]);}
   [['Crate 1',-2,0,'#e0784a'],['Crate 2',0,1,'#f2c14e'],['Crate 3',2,-1,'#9bc53d']].forEach(([name,x,z,color])=>{const crate=b.prim(name,[x,0,z],{shape:'cube',color},[0,0,0],.9);b.drag(crate.id,{plane:'ground',snap:.5});b.rule(crate.id,'pixi3d.dragEnd',crate.id,[['global.add',drops,{amount:1}]]);});
   const ball=b.prim('Ball',[0,1,-2],{shape:'sphere',color:'#5aa9e6',metallic:.3,roughness:.3},[0,0,0],.9);b.drag(ball.id,{plane:'view'});b.rule(ball.id,'pixi3d.dragEnd',ball.id,[['global.add',drops,{amount:1}]]);
   b.label('Drag the crates and the ball (press Play)',480,32,20);b.label('Drops: {drops}',480,500,24,'#ffd27a');}},
 {id:'pixi3d-hit-volumes',title:'Hit volumes',category:'Interaction',source:'interaction_hit-volumes',
  description:'"Clickable shape" sets what the pointer is tested against. Geometry uses the real triangles, so the hole in the ring misses; Box and Sphere use a simple shape around it, so the hole hits; None never hits. Each ring counts its own clicks.',
  async build(b){const eye=[0,1.2,7.5],pitch=-6;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-1.2,'#3d4450');
   [['Geometry','geometry',-3.3,'#e0784a'],['Box','box',-1.1,'#f2c14e'],['Sphere','sphere',1.1,'#5aa9e6'],['None','none',3.3,'#8b93a1']].forEach(([name,hitVolume,x,color])=>{
    const count=b.global(`${name.toLowerCase()}Hits`),ring=b.prim(`${name} ring`,[x,.1,0],{shape:'torus',tube:.12,color,hitVolume},[90,0,0],1.8);b.rule(ring.id,'pointer.click',ring.id,[['global.add',count,{amount:1}]]);
    const [sx,sy]=screen(eye,pitch,[x,-1.1,0]);b.label(`${name}: {${name.toLowerCase()}Hits}`,sx,sy+14,16);});
   b.label('Click the rings and their holes (press Play)',480,32,20);}},
 {id:'pixi3d-particle-basics',title:'Particle basics',category:'Particles',source:'particles_basics',
  description:'A campfire from three Particles 3D emitters: additive flames that shrink and redden, grey smoke with normal blending that rises slowly and grows, and fast sparks that gravity pulls back down. Every particle is a function of time, so Pause, Step and scrubbing show the same frame.',
  async build(b){const eye=[0,2.2,6.5],pitch=-12;b.setView({background:'color',backgroundColor:'#10141c',environmentIntensity:.25,bloom:true,bloomThreshold:1,bloomIntensity:.7,bloomRadius:.5});b.camera3d(eye,[pitch,0,0]);b.light('Moon',[-50,35,0],{kind:'directional',intensity:.6,castShadow:false});b.light('Fire light',[0,0,0],{kind:'point',color:'#ff9a4a',intensity:6,range:8,castShadow:false},[0,.6,0]);floor(b,-.02,'#2b2f36');
   [0,72,144,216,288].forEach((a,k)=>b.prim(`Log ${k+1}`,[Math.cos(a*Math.PI/180)*.35,.08,Math.sin(a*Math.PI/180)*.35],{shape:'cylinder',color:'#5a3a24',roughness:.9},[90,a,0],[.18,1,.18]));
   b.particles('Flames',[0,.1,0],{count:260,lifetime:1.1,lifetimeRandom:.4,speed:1.2,speedRandom:.5,spread:14,gravity:-.6,spawnShape:'sphere',spawnRadius:.28,size:.55,sizeRandom:.4,endScale:.15,alpha:.9,endAlpha:0,tint:'#ffd27a',endTint:'#ff3a10',blendMode:'add'});
   b.particles('Smoke',[0,1.1,0],{count:90,lifetime:4,lifetimeRandom:.3,speed:.5,speedRandom:.5,spread:12,gravity:-.05,spawnShape:'sphere',spawnRadius:.2,size:.5,sizeRandom:.3,endScale:4,alpha:.25,endAlpha:0,tint:'#5c5a58',endTint:'#2a2c30',blendMode:'normal',rotationSpeed:30});
   b.particles('Sparks',[0,.3,0],{count:60,lifetime:1.4,lifetimeRandom:.5,speed:3.2,speedRandom:.6,spread:28,gravity:4,spawnShape:'point',size:.05,sizeRandom:.3,endScale:.5,alpha:1,endAlpha:.2,tint:'#fff0b0',endTint:'#ff8a20',blendMode:'add',particleTexture:'circle'});
   b.label('A campfire from three emitters (press Play)',480,32,20);}},
 {id:'pixi3d-particle-spawn',title:'Spawn shapes and bursts',category:'Particles',source:'particles_spawn',
  description:'Where particles start: a point, inside a sphere, inside a box. The firework is a burst that repeats every 1.6 s ("Repeat burst every"); the green one waits until you click the button, whose rule runs "Play particles" on it.',
  async build(b){const eye=[0,2.6,8],pitch=-12;b.setView({background:'color',backgroundColor:'#121826',environmentIntensity:.4,bloom:true,bloomThreshold:1,bloomIntensity:.6,bloomRadius:.5});b.camera3d(eye,[pitch,0,0]);sun(b,1.4,.2);floor(b,-.02,'#2e3542');
   const fountain={count:220,lifetime:1.6,lifetimeRandom:.3,speed:2.4,speedRandom:.3,spread:12,gravity:2.6,size:.12,sizeRandom:.4,endScale:.4,alpha:1,endAlpha:0,blendMode:'add'};
   [['Point',-3,{spawnShape:'point',tint:'#7ad7ff',endTint:'#2a6bff'}],['Sphere',-1,{spawnShape:'sphere',spawnRadius:.45,tint:'#ffd27a',endTint:'#ff6a2a'}],['Box',1,{spawnShape:'box',spawnWidth:1,spawnHeight:.1,spawnDepth:1,tint:'#ff9bd2',endTint:'#a23bff'}]].forEach(([name,x,d])=>{b.particles(name,[x,.05,0],{...fountain,...d});const [sx,sy]=screen(eye,pitch,[x,-.1,0]);b.label(name,sx,sy+14,15);});
   b.particles('Firework',[3,2.2,-1],{emission:'burst',burstInterval:1.6,count:300,lifetime:1.3,lifetimeRandom:.2,speed:2.6,speedRandom:.15,spread:180,gravity:1.2,size:.09,endScale:.3,alpha:1,endAlpha:0,tint:'#ffffff',endTint:'#ff4a6a',blendMode:'add',particleTexture:'circle'});
   const pop=b.particles('Click burst',[3,.6,1.2],{emission:'burst',autoplay:false,count:180,lifetime:1,lifetimeRandom:.3,speed:2,speedRandom:.4,spread:60,gravity:2,size:.1,endScale:.2,alpha:1,endAlpha:0,tint:'#b6ff7a',endTint:'#2aa84a',blendMode:'add'});
   const button=b.prim('Button',[3,.25,1.2],{shape:'cylinder',color:'#3fbf6a',emissiveColor:'#1f8f3f',emissiveStrength:1},[0,0,0],[.7,.3,.7]);b.rule(button.id,'pointer.click',button.id,[['particles.play',pop.components.find(c=>c.type==='pixi3d.particles').id]]);
   const [bx,by]=screen(eye,pitch,[3,-.1,1.2]);b.label('Click me',bx,by+18,15,'#b6ff7a');b.label('Spawn shapes, a repeating and a clicked burst (press Play)',480,32,20);}},
 {id:'pixi3d-particle-flipbook',title:'Flipbook particles',category:'Particles',source:'particles_flipbook',
  description:'A Library image as the particle: a 4 × 4 sheet of flower shapes ("Flipbook columns" and "rows"). Left: frames follow each particle\'s life; middle: they loop at 8 frames per second; right: each particle keeps one random frame.',
  async build(b){const eye=[0,2,7],pitch=-10,sheet=await b.texture('flipbook','Flower sheet');b.setView({background:'color',backgroundColor:'#162033',environmentIntensity:.5});b.camera3d(eye,[pitch,0,0]);sun(b,1.2,.3);floor(b,-.02,'#2c3a4c');
   const common={textureAsset:sheet,frameColumns:4,frameRows:4,count:70,lifetime:3,lifetimeRandom:.2,speed:.9,speedRandom:.4,spread:20,gravity:-.1,spawnShape:'sphere',spawnRadius:.3,size:.55,sizeRandom:.3,endScale:1,alpha:1,endAlpha:0,blendMode:'normal',rotationSpeed:40};
   [['Over the lifetime',-2.4,{frameMode:'overLife',tint:'#ffe27a',endTint:'#ff7a3a'}],['Loop at 8 fps',0,{frameMode:'loop',frameRate:8,tint:'#8ad8ff',endTint:'#5a7aff'}],['Random frame',2.4,{frameMode:'random',tint:'#ffa8e0',endTint:'#c46aff'}]].forEach(([name,x,d])=>{b.particles(name,[x,.2,0],{...common,...d});const [sx,sy]=screen(eye,pitch,[x,-.1,0]);b.label(name,sx,sy+14,15);});
   b.label('One sprite sheet, three frame modes (press Play)',480,32,20);}},
 {id:'pixi3d-particle-spaces',title:'Local and world space',category:'Particles',source:'particles_spaces',
  description:'Two balls slide side to side, each carrying an emitter. Top: "Local" space, so its particles travel with the ball as a cloud around it (and shrink with its scale). Bottom: "World" space, so each particle stays where the ball was when it was born and the ball leaves a trail.',
  async build(b){const eye=[0,1.4,7],pitch=-6;b.setView({background:'color',backgroundColor:'#141a24',environmentIntensity:.5,bloom:true,bloomThreshold:1,bloomIntensity:.5,bloomRadius:.4});b.camera3d(eye,[pitch,0,0]);sun(b,1.6,.25);floor(b,-.9,'#2c3440');
   const trail={count:240,lifetime:1.6,lifetimeRandom:.2,speed:.9,speedRandom:.5,spread:180,gravity:0,spawnShape:'sphere',spawnRadius:.6,size:.22,sizeRandom:.3,endScale:.1,alpha:.9,endAlpha:0,blendMode:'add'};
   [['Local',1.7,'local','#7ad7ff','#3a6bff'],['World',.2,'world','#ffd27a','#ff4a2a']].forEach(([name,y,space,tint,endTint])=>{const ball=b.prim(`${name} ball`,[-2.6,y,0],{color:tint,emissiveColor:tint,emissiveStrength:1.5,castShadow:false},[0,0,0],.4);b.tween(ball.id,'x',-2.6,2.6,1.8);b.particles(`${name} emitter`,[0,0,0],{...trail,space,tint,endTint},ball.id);b.label(`${name} space`,110,screen(eye,pitch,[0,y,0])[1],16,tint);});
   b.label('Local travels with the ball, world stays behind (press Play)',480,32,20);}},
 {id:'pixi3d-outlines',title:'Outlines',category:'Post-processing',source:'post_passes-per-mesh',
  description:'The Outline 3D add-on draws an ink shell around one object, whatever its material, in the view\'s outline width and colour. The toon ball always has its ink; the others get an outline only while the pointer is over them: rules run "Turn 3D outline on/off" on enter and leave. Width is in the object\'s own units.',
  async build(b){const eye=[0,1.6,6.4],pitch=-10,t=await b.model('tentacle','Tentacle',await tentacle([.62,.48,.9,1]));b.setView({outlineWidth:.04,outlineColor:'#ff9a2a'});b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.6,'#3d4450');
   b.prim('Toon ball',[-2.7,0,0],{material:'toon',color:'#5aa9e6',toonOutline:true},[0,0,0],1.1);
   const items=[b.prim('Knot',[-.9,0,0],{shape:'torusKnot',color:'#9bc53d',tube:.12},[0,30,0],1.1),b.prim('Capsule',[.8,0,0],{shape:'capsule',color:'#e0784a'},[0,0,20],1.1),b.modelEntity('Tentacle',[2.6,-.6,0],t,{clip:'Wave'},[0,0,0],1)];
   for(const e of items){const id=b.addon(e,'pixi3d.outline',{enabled:false});b.rule(e.id,'pixi3d.pointerEnter',e.id,[['pixi3d.highlight',id,{value:true}]]);b.rule(e.id,'pixi3d.pointerLeave',e.id,[['pixi3d.highlight',id,{value:false}]]);}
   b.label('Hover the objects to outline them (press Play)',480,32,20);}},
 {id:'pixi3d-wireframe-overlay',title:'Wireframe overlay',category:'Post-processing',source:'post_material-passes',
  description:'The Wireframe overlay 3D add-on draws an object\'s edges over its shaded surface, in its own colour. Primitives get their exact edges; a model is drawn by the view\'s wireframe pass (one colour per view), here on a tentacle whose clip bends the lines with it.',
  async build(b){const eye=[0,1.3,6.2],pitch=-8,t=await b.model('tentacle','Tentacle',await tentacle([.85,.42,.3,1]));b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.7,'#3d4450');
   [['Sphere',-2.7,{shape:'sphere',segments:16,color:'#5aa9e6'},'#ffffff'],['Icosahedron',-.9,{shape:'icosahedron',detail:1,color:'#f2c14e'},'#1b1430'],['Torus',.9,{shape:'torus',segments:14,tube:.15,color:'#9bc53d'},'#ff3cd2']].forEach(([n,x,d,color])=>{const e=b.prim(n,[x,0,0],d,[n==='Torus'?60:0,20,0],1.2);b.addon(e,'pixi3d.wireframeOverlay',{color});});
   const m=b.modelEntity('Tentacle',[2.6,-.7,0],t,{clip:'Twist'},[0,0,0],1);b.addon(m,'pixi3d.wireframeOverlay',{color:'#3cff8a'});
   b.label('Edges over shaded surfaces (press Play)',480,32,20);}},
 {id:'pixi3d-bounds',title:'Bounding boxes',category:'Scene',source:'scene_bounds',
  description:'The Bounding box 3D add-on draws the world-axis box around an object every frame: a turning bar\'s box grows and shrinks with its corners, a scaled ball\'s box stretches, and a sliding group\'s box travels with it. A rule can switch a box on and off like an outline.',
  async build(b){const eye=[0,2.4,7],pitch=-14;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.8,'#3d4450');
   const bar=b.prim('Turning bar',[-2.4,0,0],{shape:'cube',color:'#e0784a'},[0,0,0],[1.6,.3,.3]);const tf=bar.components.find(c=>c.type==='scene3d.transform');bar.components.push({id:tf.id+'-turn',type:'tween.player',version:1,data:{duration:2.4,delay:0,ease:'sine.inOut',repeat:100,yoyo:true,autoplay:true,tracks:[{id:'turn',entityId:bar.id,componentId:tf.id,property:'rotation',from:[0,0,0,1],to:[0,Math.SQRT1_2,0,Math.SQRT1_2]}]}});b.addon(bar,'pixi3d.boundsHelper',{color:'#ffd23c'});
   const ball=b.prim('Stretched ball',[0,0,0],{color:'#5aa9e6'},[0,0,0],[1,1.6,.7]);b.addon(ball,'pixi3d.boundsHelper',{color:'#3cff8a'});
   const slide=b.prim('Sliding knot',[2.4,0,0],{shape:'torusKnot',color:'#9bc53d',tube:.12},[20,0,0],1);b.tween(slide.id,'z',-1.2,1.2,1.6);b.addon(slide,'pixi3d.boundsHelper',{color:'#ff6ad2'});
   b.label('Boxes that follow each object (press Play)',480,32,20);}},
 {id:'pixi3d-motion-view',title:'Motion blur and velocity view',category:'Post-processing',source:'post_motion-blur',
  description:'Two views of one scene, both cameras circling it (Camera control: orbit, auto-rotate). Left: "Motion blur" streaks what the camera\'s motion sweeps across. Right: "Debug view: Motion (velocity)" paints how far each pixel moved since the last frame, which is what the blur reads. Only camera motion counts: an object moving in front of a still camera stays sharp.',
  async build(b){const eye=[0,1.6,5.6],pitch=-14;
   for(const [name,x,data] of [['Motion blur',0,{motionBlur:true,motionBlurIntensity:1,motionBlurSamples:16}],['Velocity view',480,{debugView:'velocity',velocityScale:3}]]){const v=b.subview(name,[x,40,480,460],data,eye,pitch);v.light('Sun',[-50,35,0],{kind:'directional',intensity:2.4});v.light('Fill',[0,0,0],{kind:'ambient',intensity:.2});v.prim('Floor',[0,-.8,0],{shape:'plane',color:'#3d4450',roughness:.9},[-90,0,0],20);
    [['Crate',-1.3,0,{shape:'cube',color:'#e0784a'}],['Ball',0,-.8,{color:'#5aa9e6'}],['Knot',1.3,.3,{shape:'torusKnot',color:'#9bc53d',tube:.12}]].forEach(([n,px,pz,d])=>v.prim(n,[px,-.2,pz],d,[0,25,0],1));
    for(let k=0;k<8;k++)v.prim(`Pillar ${k+1}`,[Math.cos(k*Math.PI/4)*3,.2,Math.sin(k*Math.PI/4)*3],{shape:'cylinder',color:k%2?'#f2c14e':'#c9ccd2'},[0,0,0],[.35,2,.35]);
    b.control(b.entities.find(e=>e.name===`${name} camera`).id,{mode:'orbit',autoRotate:true,autoRotateSpeed:40,enableZoom:false,enablePan:false,damping:false});b.label(name,x+240,24,18);}
   b.label('Blur and the motion it reads (press Play)',480,520,18);}},
 // ---------- examples for features that already existed (45th round) ----------
 ...[['pixi3d-bloom','Bloom','post_bloom','Bloom spreads light from pixels brighter than "Bloom threshold" into a glow. Left: off. Right: on; the glowing tubes and orbs have emissive strength above 1, which only bloom turns into halos.',{bloom:true,bloomThreshold:1,bloomIntensity:1,bloomRadius:.6},
    v=>{v.prim('Floor',[0,-.8,0],{shape:'plane',color:'#1e232c',roughness:.9},[-90,0,0],20);[['#ff4a6a',-1.1],['#3cd2ff',0],['#ffd23c',1.1]].forEach(([c,x],k)=>{v.prim(`Orb ${k+1}`,[x,-.2,0],{color:c,emissiveColor:c,emissiveStrength:4},[0,0,0],.6);v.prim(`Tube ${k+1}`,[x,.8,-.6],{shape:'capsule',color:c,emissiveColor:c,emissiveStrength:2.5},[0,0,90],[.25,1,.25]);});},{background:'color',backgroundColor:'#0b0e14',environmentIntensity:.2}],
   ['pixi3d-ssao','Ambient occlusion','post_ssao','Ambient occlusion darkens creases and corners that the sky light cannot reach. Left: off. Right: "Ambient occlusion" on; look where the crates meet the floor and each other.',{ssao:true,ssaoRadius:.5,ssaoIntensity:2},
    v=>{v.prim('Floor',[0,-.8,0],{shape:'plane',color:'#c9ccd2',roughness:.9},[-90,0,0],20);v.prim('Wall',[0,1,-1.6],{shape:'cube',color:'#c9ccd2',roughness:.9},[0,0,0],[6,3.6,.2]);v.prim('Side wall',[-1.9,1,0],{shape:'cube',color:'#c9ccd2',roughness:.9},[0,0,0],[.2,3.6,3.4]);[[-1,-.4,-1.1,.8],[-.1,-.5,-1.15,.6],[.9,-.35,-1,.9],[.3,-.6,-.2,.4],[-1.2,.35,-1.1,.6]].forEach(([x,y,z,s],k)=>v.prim(`Crate ${k+1}`,[x,y,z],{shape:'cube',color:'#d8c6a4',roughness:.8},[0,k*17,0],s));},{environmentIntensity:1.4}],
   ['pixi3d-depth-of-field','Depth of field','post_depth-of-field','Depth of field blurs what lies outside a band around "Focus distance", like a camera lens. Left: all sharp. Right: focus on the middle pillar (5 units away); nearer and farther ones blur more the further they are.',{depthOfField:true,focusDistance:5,focusRange:.8,focusFalloff:3,focusBlur:14},
    v=>{v.prim('Floor',[0,-.8,0],{shape:'plane',color:'#3d4450',roughness:.9},[-90,0,0],40);for(let k=0;k<7;k++)v.prim(`Pillar ${k+1}`,[(k%2?.7:-.7),.2,1.6-k*1.6],{shape:'cylinder',color:['#e0784a','#f2c14e','#9bc53d','#5aa9e6','#a27ae0','#ff6ad2','#c9ccd2'][k]},[0,0,0],[.5,2,.5]);},{}],
   ['pixi3d-tilt-shift','Tilt-shift','post_tilt-shift','Tilt-shift is depth of field with a narrow band and a strong blur, seen from high above: a real town starts to look like a model. Left: off. Right: a 0.6-unit sharp band at the crossroads.',{depthOfField:true,focusDistance:12,focusRange:.6,focusFalloff:2.5,focusBlur:20},
    v=>{v.prim('Ground',[0,-.02,0],{shape:'plane',color:'#6f9a5a',roughness:1},[-90,0,0],40);v.prim('Road A',[0,0,0],{shape:'cube',color:'#3b3f46',roughness:.9},[0,0,0],[30,.02,1.2]);v.prim('Road B',[0,0,0],{shape:'cube',color:'#3b3f46',roughness:.9},[0,0,0],[1.2,.02,30]);
     const colors=['#e0784a','#f2c14e','#c9ccd2','#5aa9e6','#e8d6b4','#a27ae0'];let k=0;for(let i=-5;i<=5;i++)for(let j=-5;j<=5;j++){if(Math.abs(i)<1||Math.abs(j)<1||(i*7+j*3)%4===0)continue;const h=.6+((i*13+j*7+100)%5)*.35;v.prim(`House ${++k}`,[i*1.5,h/2,j*1.5],{shape:'cube',color:colors[(i*3+j*5+60)%6],roughness:.8},[0,(i*j*23)%90,0],[.9,h,.9]);}},{},[0,9,8],-48],
   ['pixi3d-antialiasing','Antialiasing (FXAA)','post_antialiasing','FXAA smooths jagged edges after the frame is drawn, cheaply. Left: off. Right: "Antialiasing (FXAA)" on; thin poles, wires and diagonal edges lose their stair steps.',{antialias:true},
    v=>{v.prim('Floor',[0,-.8,0],{shape:'plane',color:'#3d4450',roughness:.9},[-90,0,0],40);for(let k=0;k<9;k++)v.prim(`Pole ${k+1}`,[-2+k*.5,.4,-.5-k*.35],{shape:'cylinder',color:'#f2f2f2'},[0,0,8+k*3],[.04,2.4,.04]);v.prim('Fence',[0,-.2,.6],{shape:'cube',color:'#e0784a'},[0,30,12],[3.2,.05,.05]);v.prim('Wire ball',[1.5,.4,.3],{shape:'icosahedron',detail:2,draw:'wireframe',color:'#5ad1e6',material:'flat'},[0,0,0],1.4);},{}],
   ['pixi3d-effect-stack','Effect stack','post_effect-stack','Post effects run in a fixed order on one view: ambient occlusion and bloom on linear light, then depth of field, tint, colour grading and FXAA last. Left: plain. Right: AO, bloom, depth of field, a warm tint and FXAA together.',{ssao:true,ssaoRadius:.5,ssaoIntensity:1.2,bloom:true,bloomThreshold:1,bloomIntensity:.8,bloomRadius:.5,depthOfField:true,focusDistance:5.4,focusRange:1.2,focusFalloff:4,focusBlur:10,tint:'#ffe2c4',antialias:true},
    v=>{v.prim('Floor',[0,-.8,0],{shape:'plane',color:'#b9bcc4',roughness:.9},[-90,0,0],30);v.prim('Lamp orb',[0,.6,-.4],{color:'#ffcc55',emissiveColor:'#ffaa33',emissiveStrength:5},[0,0,0],.5);[[-1.2,-.4,0,.8],[1.1,-.45,-.3,.7],[.2,-.5,1.4,.6],[-.6,-.3,-3,1],[1.6,-.3,-4,1]].forEach(([x,y,z,sc],k)=>v.prim(`Block ${k+1}`,[x,y,z],{shape:'cube',color:['#e0784a','#5aa9e6','#9bc53d','#c9ccd2','#a27ae0'][k],roughness:.7},[0,k*21,0],sc));},{}]].map(([id,title,source,description,on,scene,base,eye=[0,1.4,5.6],pitch=-12])=>({id,title,category:'Post-processing',source,description,
   async build(b){for(const [name,x,data] of [['Off',0,{}],['On',480,on]]){const v=b.subview(name,[x,40,480,460],{...base,...data},eye,pitch);v.light('Sun',[-50,35,0],{kind:'directional',intensity:2.4,castShadow:true,shadowBias:.001});v.light('Fill',[0,0,0],{kind:'ambient',intensity:.25});scene(v);b.label(name==='Off'?'Off':`On: ${title}`,x+240,22,18);}
    b.label(`${title}: left off, right on`,480,520,18);}})),
 {id:'pixi3d-hierarchy',title:'Hierarchy',category:'Scene',source:'scene_hierarchy',
  description:'Objects inside objects: a sun carries an orbit group of three planets, and each planet carries its own group of moons. Turning a group turns everything inside it, so each body only needs its own small spin. (The groups turn by a third of a circle and repeat; with three bodies the loop is seamless.)',
  async build(b){const eye=[0,6,9],pitch=-32;b.setView({background:'color',backgroundColor:'#0b0e14',environment:'none',bloom:true,bloomThreshold:1,bloomIntensity:.7,bloomRadius:.5});b.camera3d(eye,[pitch,0,0]);b.light('Sun light',[0,0,0],{kind:'point',intensity:60,range:20,color:'#fff1d0'},[0,0,0]);b.light('Fill',[0,0,0],{kind:'ambient',intensity:.15});
   const turn=(e,duration)=>{const tf=e.components.find(c=>c.type==='scene3d.transform'),h=Math.PI/3;e.components.push({id:tf.id+'-turn',type:'tween.player',version:1,data:{duration,delay:0,ease:'linear',repeat:100,yoyo:false,autoplay:true,tracks:[{id:'turn',entityId:e.id,componentId:tf.id,property:'rotation',from:[0,0,0,1],to:[0,Math.sin(h),0,Math.cos(h)]}]}});};
   b.prim('Sun',[0,0,0],{color:'#ffcc55',emissiveColor:'#ffaa33',emissiveStrength:4,castShadow:false},[0,0,0],1.4);
   const orbit=b.node3d('Orbit group',[0,0,0]);turn(orbit,9);
   ['#5aa9e6','#e0784a','#9bc53d'].forEach((c,k)=>{const a=k*2*Math.PI/3,planet=b.node3d(`Planet ${k+1} group`,[Math.cos(a)*3.2,0,Math.sin(a)*3.2],orbit.id);b.prim(`Planet ${k+1}`,[0,0,0],{color:c},[0,0,0],.55,planet.id);const moons=b.node3d(`Moons ${k+1}`,[0,0,0],planet.id);turn(moons,2+k*.7);
    for(let m=0;m<3;m++){const am=m*2*Math.PI/3;b.prim(`Moon ${k+1}.${m+1}`,[Math.cos(am)*.75,0,Math.sin(am)*.75],{color:'#c9ccd2'},[0,0,0],.16,moons.id);}});
   b.label('Groups inside groups (press Play)',480,32,20);}},
 {id:'pixi3d-transforms',title:'Local and world transforms',category:'Scene',source:'scene_transforms',
  description:'A child\'s position, rotation and scale are in its parent\'s space. Each orange ball sits at the same local position (1, 0, 0) under a different parent: a plain one, one turned 45°, and one scaled ×2, so the same numbers land in three different places.',
  async build(b){const eye=[0,4.5,7.5],pitch=-28;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.5,'#3d4450');
   [['Plain parent',-3,[0,0,0],1],['Turned 45°',0,[0,45,0],1],['Scaled ×2',3,[0,0,0],2]].forEach(([name,x,r,sc])=>{const parent=b.node3d(name,[x,0,0],null,r,sc);b.prim(`${name} marker`,[0,0,0],{shape:'cube',color:'#5aa9e6'},[0,0,0],.3,parent.id);b.prim(`${name} axis`,[.5,0,0],{shape:'cube',color:'#8b93a1'},[0,0,0],[1,.04,.04],parent.id);b.prim(`${name} child`,[1,0,0],{color:'#e0784a'},[0,0,0],.3,parent.id);const [lx,ly]=screen(eye,pitch,[x,-.5,1.2]);b.label(name,lx,ly+10,16);});
   b.label('Child at local (1, 0, 0) under three parents',480,32,20);}},
 {id:'pixi3d-hello-cube',title:'Hello cube',category:'Getting started',source:'start_hello-cube',
  description:'The smallest 3D scene: a 3D View with a camera, a sun light and one cube that a rotation tween keeps turning (a quarter turn that repeats, which looks the same on a cube).',
  async build(b){b.setView();b.camera3d([0,1.2,4],[-14,0,0]);sun(b);const cube=b.prim('Cube',[0,0,0],{shape:'cube',color:'#e0784a'},[0,0,0],1.2),tf=cube.components.find(c=>c.type==='scene3d.transform');
   cube.components.push({id:tf.id+'-turn',type:'tween.player',version:1,data:{duration:2,delay:0,ease:'linear',repeat:100,yoyo:false,autoplay:true,tracks:[{id:'turn',entityId:cube.id,componentId:tf.id,property:'rotation',from:[0,0,0,1],to:[0,Math.SQRT1_2,0,Math.SQRT1_2]}]}});b.label('Hello, cube (press Play)',480,32,22);}},
 {id:'pixi3d-model-viewer',title:'Model viewer',category:'Getting started',source:'start_model-viewer',
  description:'A glTF model in an HDR sky: Model 3D shows the imported GLB, "Environment: HDR" lights it, Camera control (orbit) lets the player drag to turn around it and scroll to zoom, and it turns slowly on its own until touched.',
  async build(b){const hdr=b.hdr('Sky HDR'),lampId=await b.model('lamp','Desk lamp',await lamp());b.setView({environment:'hdr',environmentAssetId:hdr,background:'environment',environmentIntensity:1});b.camera3d([0,1.6,3.6],[-12,0,0]);b.light('Sun',[-50,35,0],{kind:'directional',intensity:1.6,castShadow:true,shadowBias:.001});
   b.prim('Plinth',[0,-.15,0],{shape:'cylinder',color:'#2b2f36',roughness:.6},[0,0,0],[1.6,.3,1.6]);b.modelEntity('Desk lamp',[0,0,0],lampId,null,[0,0,0],1);b.control(b.camera,{mode:'orbit',targetY:.7,minDistance:1.5,maxDistance:8,autoRotate:true,autoRotateSpeed:6});
   b.label('Drag to orbit, scroll to zoom (press Play)',480,32,20);}},
 {id:'pixi3d-gltf',title:'glTF models',category:'Assets',source:'assets_gltf',
  description:'Three GLB files imported into the Library and placed with Model 3D: a lamp of three meshes and materials, a skinned tentacle playing a clip, and a blob with morph targets. The importer keeps meshes, materials, skins, morphs and clips.',
  async build(b){const eye=[0,1.4,6],pitch=-8,l=await b.model('lamp','Desk lamp',await lamp()),t=await b.model('tentacle','Tentacle',await tentacle()),bl=await b.model('blob','Blob',await blob());b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.02,'#3d4450');
   b.modelEntity('Desk lamp',[-2.2,0,0],l,null,[0,20,0],1.1);b.modelEntity('Tentacle',[0,0,0],t,{clip:'Wave'});b.modelEntity('Blob',[2.2,.55,0],bl,{clip:'Wobble'},[0,0,0],1.1);
   [['Lamp: 3 meshes',-2.2],['Skinned + clip',0],['Morph targets',2.2]].forEach(([n,x])=>{const [sx,sy]=screen(eye,pitch,[x,-.1,0]);b.label(n,sx,sy+12,15);});b.label('Imported glTF (.glb) models (press Play)',480,32,20);}},
 {id:'pixi3d-model-materials',title:'Model materials',category:'Assets',source:'assets_model-materials',
  description:'One lamp model, three instances. Left: as imported. Middle: "Override material" tints the whole instance. Right: material slots change only the Shade (index 2) and the Pole (index 1); the file and the other instances stay as they were.',
  async build(b){const eye=[0,1.3,5],pitch=-8,l=await b.model('lamp','Desk lamp',await lamp()),rev=b.assets.find(a=>a.id===l).revision;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.02,'#3d4450');
   b.modelEntity('As imported',[-1.8,0,0],l,null,[0,20,0],1);b.modelEntity('Whole override',[0,0,0],l,null,[0,20,0],1,{overrideMaterial:true,color:'#5aa9e6',roughness:.35,metallic:.2});
   b.modelEntity('Slot overrides',[1.8,0,0],l,null,[0,20,0],1,{materialSlots:[{index:2,sourceRevision:rev,color:'#e0784a',roughness:.5,metallic:0},{index:1,sourceRevision:rev,color:'#c9ccd2',roughness:.15,metallic:1}]});
   [['As imported',-1.8],['Override material',0],['Slots: Shade, Pole',1.8]].forEach(([n,x])=>{const [sx,sy]=screen(eye,pitch,[x,-.1,0]);b.label(n,sx,sy+12,15);});b.label('One model, three material setups',480,32,20);}},
 {id:'pixi3d-batching',title:'Batching',category:'Instancing',source:'instancing_batching',
  description:'Instances 3D draws many copies of one shape as a single batch: here a 100 × 100 grid, 10,000 cubes in one draw call, coloured by a gradient across X. Moving the whole field is one transform.',
  async build(b){b.setView({shadowQuality:'medium'});b.camera3d([0,14,22],[-34,0,0]);sun(b,2,.25);const field=b.instances('Cube field',[0,0,0],{shape:'cube',columns:100,rows:100,layers:1,spacing:.3,scale:.2,colorMode:'gradient',color:'#5aa9e6',color2:'#e0784a',gradientAxis:'x'});b.tween(field.id,'y',-.4,.4,2.4);
   b.label('10,000 cubes, one draw (press Play)',480,32,20);}},
 {id:'pixi3d-instance-data',title:'Instance data',category:'Instancing',source:'instancing_instance-data',
  description:'Each copy can differ: the spheres take random colours between two, random sizes ("Scale random") and spread ("Scatter"); the lamps are model instances, each turned at random ("Yaw random"). All of it comes from the seed, so it is the same every time.',
  async build(b){const l=await b.model('lamp','Desk lamp',await lamp());b.setView();b.camera3d([0,5,10],[-24,0,0]);sun(b);floor(b,0,'#3d4450');
   b.instances('Spheres',[-2.5,.4,0],{layout:'scatter',shape:'sphere',count:400,areaWidth:5,areaDepth:6,areaHeight:.6,scale:.3,scaleRandom:.7,colorMode:'random',color:'#ffd23c',color2:'#ff4a6a',seed:7});
   b.instances('Lamps',[2.8,0,0],{source:'model',assetId:l,layout:'grid',columns:5,rows:5,spacing:1,scale:.5,yawRandom:180,jitter:.3,seed:3});b.label('Random colour, size, place and turn per copy',480,32,20);}},
 {id:'pixi3d-look-at',title:'Look at',category:'Scene',source:'scene_look-at',
  description:'Look at 3D turns an object toward another every frame while the game runs. The turrets "Stay upright", turning only around Y; the eyes turn fully; the spotlight uses its −Z front, as lights and cameras do, and follows the ball as well. In the editor\'s own camera the authored rotation stays, so it can still be edited.',
  async build(b){const eye=[0,3.4,8],pitch=-18;b.setView({environmentIntensity:.5});b.camera3d(eye,[pitch,0,0]);b.light('Fill',[0,0,0],{kind:'ambient',intensity:.25});b.light('Moon',[-50,35,0],{kind:'directional',intensity:.9,castShadow:true,shadowBias:.001});floor(b,0,'#3d4450');
   const ball=b.prim('Target',[0,.5,1],{color:'#ffcc55',emissiveColor:'#ffaa33',emissiveStrength:2},[0,0,0],.5);const tf=ball.components.find(c=>c.type==='scene3d.transform');ball.components.push({id:tf.id+'-roam',type:'tween.player',version:1,data:{duration:2.2,delay:0,ease:'sine.inOut',repeat:100,yoyo:true,autoplay:true,tracks:[{id:'x',entityId:ball.id,componentId:tf.id,property:'x',from:-3,to:3},{id:'z',entityId:ball.id,componentId:tf.id,property:'z',from:1.8,to:-.6}]}});
   const look=(e,data)=>e.components.push({id:e.id+'-look',type:'pixi3d.lookAt',version:1,data:{targetId:ball.id,axis:'+Z',yawOnly:false,weight:1,...data}});
   [-3,-1,1,3].forEach((x,k)=>{const g=b.node3d(`Turret ${k+1}`,[x,0,-2.6]);look(g,{yawOnly:true});b.prim(`Turret ${k+1} base`,[0,.25,0],{shape:'cylinder',color:'#8b93a1',roughness:.4,metallic:.6},[0,0,0],[.7,.5,.7],g.id);b.prim(`Turret ${k+1} barrel`,[0,.4,.45],{shape:'cylinder',color:'#5aa9e6',roughness:.3,metallic:.6},[90,0,0],[.14,.8,.14],g.id);});
   [-.7,.7].forEach((x,k)=>{const g=b.node3d(`Eye ${k+1}`,[x,2.4,-1.2]);look(g);b.prim(`Eye ${k+1} white`,[0,0,0],{color:'#f2f2f2',roughness:.3},[0,0,0],.6,g.id);b.prim(`Eye ${k+1} pupil`,[0,0,.26],{color:'#111111',roughness:.2},[0,0,0],[.22,.22,.1],g.id);});
   b.light('Spot',[0,0,0],{kind:'spot',intensity:40,range:14,color:'#bfe0ff',castShadow:false,coneAngle:16,penumbra:.4},[0,4.5,2]);const spot=b.entities.find(e=>e.name==='Spot');look(spot,{axis:'-Z'});
   b.label('Everything watches the ball (press Play)',480,32,20);}},
 {id:'pixi3d-raycast',title:'Raycast',category:'Interaction',source:'interaction_raycast',
  description:'Follow the pointer 3D casts a ray from the pointer into the scene every move: the ring sits on whatever surface is under it, lying flat on slopes and box sides ("Lie flat on the surface"), and drops to the ground plane past the objects. The turrets Look at the ring, so they aim wherever you point.',
  async build(b){const eye=[0,5,8.5],pitch=-30;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);b.prim('Floor',[0,0,0],{shape:'plane',color:'#3d4450',roughness:.9,hitVolume:'geometry'},[-90,0,0],30);
   b.prim('Crate',[-1.6,.6,0],{shape:'cube',color:'#e0784a',hitVolume:'geometry'},[0,20,0],1.2);b.prim('Ramp',[1.2,.5,.3],{shape:'cube',color:'#9bc53d',hitVolume:'geometry'},[0,0,25],[2.2,.15,1.6]);b.prim('Dome',[.1,0,-1.6],{shape:'sphere',color:'#5aa9e6',hitVolume:'geometry'},[0,0,0],1.6);
   const ring=b.prim('Cursor ring',[0,.02,2],{shape:'torus',tube:.08,color:'#ffd23c',emissiveColor:'#ffd23c',emissiveStrength:2,castShadow:false},[0,0,0],.6);ring.components.push({id:ring.id+'-follow',type:'pixi3d.pointerFollow',version:1,data:{surface:'objects',groundY:0,align:true,lift:.03,hideWhenMissed:true}});
   [-3.2,3.2].forEach((x,k)=>{const g=b.node3d(`Turret ${k+1}`,[x,0,2.4]);g.components.push({id:g.id+'-look',type:'pixi3d.lookAt',version:1,data:{targetId:ring.id,axis:'+Z',yawOnly:false,weight:1}});b.prim(`Turret ${k+1} body`,[0,.35,0],{color:'#8b93a1',roughness:.4,metallic:.6},[0,0,0],.7,g.id);b.prim(`Turret ${k+1} barrel`,[0,.35,.5],{shape:'cylinder',color:'#ff6ad2',roughness:.3},[90,0,0],[.12,.7,.12],g.id);});
   b.label('Point at the scene (press Play)',480,32,20);}},
 {id:'pixi3d-decals',title:'Decals',category:'Interaction',source:'interaction_decals',
  description:'Decals 3D stamps a flat mark where you click, lying on the surface that was hit and riding with it: the marks on the sliding crate travel with it. Each decal\'s size, turn and colour come from the seed; past "Most decals at once" the oldest goes. Decals are not saved in the scene.',
  async build(b){const eye=[0,3.4,7.5],pitch=-22;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);
   b.prim('Floor',[0,0,0],{shape:'plane',color:'#c9ccd2',roughness:.9,hitVolume:'geometry'},[-90,0,0],30);b.prim('Wall',[0,1.1,-2.4],{shape:'cube',color:'#d8c6a4',roughness:.9,hitVolume:'geometry'},[0,0,0],[8,2.2,.2]);
   const crate=b.prim('Sliding crate',[0,.6,0],{shape:'cube',color:'#5aa9e6',hitVolume:'geometry'},[0,0,0],1.2);b.tween(crate.id,'x',-2.4,2.4,2.6);b.prim('Dome',[2.8,0,.8],{color:'#9bc53d',hitVolume:'geometry'},[0,0,0],1.4);
   const stamper=b.node3d('Paint stamper',[0,0,0]);stamper.components.push({id:stamper.id+'-decals',type:'pixi3d.decals',version:1,data:{shape:'splat',color:'#ff4a6a',color2:'#ffd23c',size:.8,sizeRandom:.4,max:80,onlyOn:'',seed:7}});
   b.label('Click surfaces to splat them (press Play)',480,32,20);}},
 {id:'pixi3d-event-flow',title:'Event flow',category:'Interaction',source:'interaction_event-flow',
  description:'Pointer enter and leave flow up through groups, like the web\'s pointerenter: entering a cup also enters the Table group it sits in, so the table\'s rule lights the ring under it while the cup\'s own rule outlines the cup. Moving from cup to cup leaves only the cup; the table stays entered.',
  async build(b){const eye=[0,3.2,6.4],pitch=-24;b.setView({outlineWidth:.05,outlineColor:'#ffd23c'});b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,0,'#3d4450');const tableEnters=b.global('tableEnters'),cupEnters=b.global('cupEnters');
   const table=b.node3d('Table',[0,0,0]);const ring=b.prim('Table ring',[0,.03,0],{shape:'torus',tube:.05,color:'#5ad1e6',emissiveColor:'#5ad1e6',emissiveStrength:3,castShadow:false,hitVolume:'none'},[0,0,0],[4.6,1,2.6]);ring.active=false;
   b.prim('Table top',[0,.8,0],{shape:'cube',color:'#8a5a3a',roughness:.7},[0,0,0],[3.2,.12,1.6],table.id);[[-1.4,-.6],[1.4,-.6],[-1.4,.6],[1.4,.6]].forEach(([x,z],k)=>b.prim(`Leg ${k+1}`,[x,.4,z],{shape:'cylinder',color:'#6a4a2a'},[0,0,0],[.12,.8,.12],table.id));
   b.rule(table.id,'pixi3d.pointerEnter',table.id,[['entity.active',ring.id,{value:true}],['global.add',tableEnters,{amount:1}]]);b.rule(table.id,'pixi3d.pointerLeave',table.id,[['entity.active',ring.id,{value:false}]]);
   [['Red cup',-.9,'#e0784a'],['Blue cup',0,'#5aa9e6'],['Green cup',.9,'#9bc53d']].forEach(([n,x,c])=>{const cup=b.prim(n,[x,1.1,0],{shape:'cylinder',color:c,radiusTop:.5},[0,0,0],[.45,.5,.45],table.id),o=b.addon(cup,'pixi3d.outline',{enabled:false});b.rule(cup.id,'pixi3d.pointerEnter',cup.id,[['pixi3d.highlight',o,{value:true}],['global.add',cupEnters,{amount:1}]]);b.rule(cup.id,'pixi3d.pointerLeave',cup.id,[['pixi3d.highlight',o,{value:false}]]);});
   b.label('Hover the cups and the table (press Play)',480,32,20);b.label('Table entered {tableEnters}× · cups entered {cupEnters}×',480,500,18,'#ffd23c');}},
 {id:'pixi3d-attach',title:'Find and reparent',category:'Scene',source:'scene_find-and-reparent',
  description:'A script finds objects by name and moves them to another parent while the game runs: click a crate and it becomes a child of the moving cart (self.parent = game.find(\'Cart\')), keeping its place in the world, so it rides along; click the green pad and every crate on the cart goes back to the top of the 3D view (crate.parent = null), staying where it was dropped. The view is not rebuilt when a parent changes.',
  async build(b){const eye=[0,4.2,8],pitch=-26;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,0,'#3d4450');
   // The cart is an unscaled group so the crates under it keep their shape; its body carries the flat scale.
   const cart=b.node3d('Cart',[0,.3,-.5]);b.prim('Cart body',[0,0,0],{shape:'cube',color:'#8b93a1',roughness:.4,metallic:.5},[0,0,0],[2.2,.3,1.4],cart.id);b.tween(cart.id,'x',-3,3,4);
   const pad=b.prim('Drop pad',[0,.02,2.4],{shape:'cylinder',color:'#3fbf6a',emissiveColor:'#1f8f3f',emissiveStrength:1},[0,0,0],[1.6,.04,1.6]);
   [[-2.6,1.6,'#e0784a'],[-1.3,1.9,'#f2c14e'],[1.3,1.9,'#5aa9e6'],[2.6,1.6,'#a27ae0']].forEach(([x,z,c],k)=>{const crate=b.prim(`Crate ${k+1}`,[x,.3,z],{shape:'cube',color:c},[0,k*15,0],.6);
    b.script(crate,'Load',`// Click: this crate becomes a child of the cart, keeping where it is in the world, so it rides along.
export function onClick(self: GameObject3D) {
  self.parent = game.find<GameObject3D>('Cart');
}
`);});
   b.script(pad,'Unload',`// Click: every crate riding on the cart goes back to the top of the 3D view, staying where it is.
export function onClick(self: GameObject3D) {
  for (const crate of game.find<GameObject3D>('Cart')!.children) if (crate.name.startsWith('Crate')) crate.parent = null;
}
`);
   {const [sx,sy]=screen(eye,pitch,[0,0,2.4]);b.label('Click to unload',sx,sy+24,15,'#9be8b0');}b.label('Click a crate: it becomes the cart’s child and rides along (press Play)',480,32,20);}},
 {id:'pixi3d-paint',title:'Paint',category:'Interaction',source:'interaction_paint',
  description:'Paintable 3D turns a primitive\'s colour into a canvas you paint on while the game runs: press and drag over the ball, the box or the board. The brush lands at the texture point under the pointer, so it wraps around curves and stays on each face. Click a swatch to change the brush ("Set 3D brush colour"), the white button to clear ("Clear 3D paint"). Paint is not saved.',
  async build(b){const eye=[0,2.6,7],pitch=-16;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b,2,.35);floor(b,0,'#3d4450');
   const paintable=(e,extra={})=>{const id=e.id+'-paint';e.components.push({id,type:'pixi3d.paintable',version:1,data:{brushColor:'#ff4a6a',brushSize:.025,resolution:512,background:'',clears:0,...extra}});return id;};
   const ids=[paintable(b.prim('Ball',[-2.4,1.1,0],{color:'#f2f2f2',segments:48,roughness:.6},[0,0,0],2)),paintable(b.prim('Box',[0,.8,0],{shape:'cube',color:'#f2e6c9',roughness:.7},[0,30,0],1.6)),paintable(b.prim('Board',[2.4,1.2,-.4],{shape:'plane',color:'#ffffff',roughness:.8},[0,-25,0],[2,2,1]),{brushSize:.015})];
   ['#ff4a6a','#ffd23c','#3fbf6a','#5aa9e6','#1b1430'].forEach((c,k)=>{const sw=b.prim(`Swatch ${k+1}`,[-1.6+k*.8,.22,2.2],{color:c,roughness:.4},[0,0,0],.4);b.rule(sw.id,'pointer.click',sw.id,ids.map(id=>['pixi3d.paintColor',id,{to:c}]));});
   const clear=b.prim('Clear button',[2.6,.12,2.2],{shape:'cylinder',color:'#f2f2f2'},[0,0,0],[.6,.24,.6]);b.rule(clear.id,'pointer.click',clear.id,ids.map(id=>['pixi3d.clearPaint',id]));
   const [cx,cy]=screen(eye,pitch,[2.6,0,2.2]);b.label('Clear',cx,cy+22,15);b.label('Press and drag to paint (press Play)',480,32,20);}},
 // ---------- S0: render state, glTF scenes, compression, renderers, developer panels ----------
 {id:'pixi3d-render-state',title:'Render state',category:'Materials',source:'materials_render-state',
  description:'Render state decides how a surface draws against what is already there. Left to right: "Depth test" off shows the crate through the wall; "Skip faces: Front faces" draws the inside of the box; and three glowing panels overlap with Add, Multiply and Screen blending over a white card.',
  async build(b){const eye=[0,1.8,6.5],pitch=-10;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.8,'#3d4450');
   b.prim('Wall',[-2.4,0,0],{shape:'cube',color:'#8b93a1'},[0,0,0],[1.6,1.6,.15]);b.prim('Crate behind',[-2.4,0,-1],{shape:'cube',color:'#e0784a',depthTest:false},[0,25,0],.8);
   b.prim('Inside-out box',[0,0,0],{shape:'cube',color:'#5aa9e6',cull:'front'},[0,35,0],1.4);
   b.prim('Card',[2.4,0,-.4],{shape:'plane',color:'#f2f2f2'},[0,0,0],[2,1.6,1]);[['Add','add','#ff4a6a',-.35,.2],['Multiply','multiply','#3cd2ff',.35,.2],['Screen','screen','#ffd23c',0,-.3]].forEach(([n,blend,c,x,y])=>b.prim(`${n} panel`,[2.4+x,y,-.3],{shape:'plane',color:c,alphaMode:'blend',alpha:.85,blend,depthWrite:false},[0,0,0],[.9,.9,1]));
   [['Depth test off',-2.4],['Front faces skipped',0],['Add · Multiply · Screen',2.4]].forEach(([n,x])=>{const [sx,sy]=screen(eye,pitch,[x,-.8,0]);b.label(n,sx,sy+16,15);});b.label('Depth, culling and blending per surface',480,32,20);}},
 {id:'pixi3d-gltf-scenes',title:'glTF scenes',category:'Assets',source:'assets_gltf-scenes',
  description:'One glTF file can hold several scenes. This one has Day (house and sun) and Night (house, moon and a lit window); Model 3D\'s "glTF scene" picks which one an instance shows, sharing the same meshes and materials.',
  async build(b){const eye=[0,1.4,5.2],pitch=-8,id=await b.model('daynight','Day and night',await dayNight());b.setView();b.camera3d(eye,[pitch,0,0]);sun(b,1.6,.3);floor(b,0,'#3d4450');
   b.modelEntity('Day',[-1.4,0,0],id,null,[0,25,0],1,{scene:'Day'});b.modelEntity('Night',[1.4,0,0],id,null,[0,-25,0],1,{scene:'Night'});
   [['scene: Day',-1.4],['scene: Night',1.4]].forEach(([n,x])=>{const [sx,sy]=screen(eye,pitch,[x,0,.6]);b.label(n,sx,sy+16,15);});b.label('Two scenes in one glTF file',480,32,20);}},
 {id:'pixi3d-compression',title:'Compressed models',category:'Assets',source:'assets_compression',
  description:'Compressed GLB files are decoded once, on import: EXT_meshopt_compression and KHR_draco_mesh_compression become plain geometry, so games ship no decoder. The same 12,000-triangle rock, imported from three files; the labels give each file\'s size.',
  async build(b){const eye=[0,1.2,5],pitch=-8;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.5,'#3d4450');
   const {prepareModel}=await ssr.ssrLoadModule('/modules/render-pixi3d/src/model.node.ts');
   for(const [kind,x] of [['none',-2],['meshopt',0],['draco',2]]){const raw=await rock(kind),dir=await mkdtemp(join(tmpdir(),'rock-'));let imported;try{await writeFile(join(dir,'rock.glb'),raw);imported=(await prepareModel(join(dir,'rock.glb'))).bytes;}finally{await rm(dir,{recursive:true,force:true});}
    const id=await b.model(`rock-${kind}`,`Rock (${kind==='none'?'plain':kind})`,Buffer.from(imported));b.modelEntity(`Rock ${kind}`,[x,0,0],id,null,[0,x*20,0],1.3);const [sx,sy]=screen(eye,pitch,[x,-.5,.6]);b.label(`${kind==='none'?'Plain':kind==='meshopt'?'meshopt':'Draco'}: ${Math.round(raw.length/1024)} KB file`,sx,sy+16,15);}
   b.label('One rock from plain, meshopt and Draco files',480,32,20);}},
 {id:'pixi3d-renderers',title:'Renderers',category:'Getting started',source:'start_renderers',
  description:'The same project runs on WebGL 2 or WebGPU. Project settings → Renderer picks Auto (WebGPU where the browser supports it, else WebGL 2), WebGL 2 or WebGPU; the scene, materials and effects are the same on both, which OliveStudio checks for every 3D feature.',
  async build(b){b.setView({bloom:true,bloomThreshold:1,bloomIntensity:.6,bloomRadius:.5});b.camera3d([0,1.6,5],[-12,0,0]);sun(b);floor(b,-.6,'#3d4450');
   b.prim('Glass',[-1.5,0,0],{color:'#dff2ff',transmission:1,roughness:.05,thickness:.5},[0,0,0],1);b.prim('Metal knot',[0,0,0],{shape:'torusKnot',tube:.12,color:'#c9ccd2',metallic:1,roughness:.2},[0,0,0],1.1);b.prim('Glow',[1.5,0,0],{color:'#ffcc55',emissiveColor:'#ffaa33',emissiveStrength:4},[0,0,0],.8);
   b.label('Project settings → Renderer: Auto · WebGL 2 · WebGPU',480,32,20);}},
 {id:'pixi3d-keyframes',title:'Keyframes in code',category:'Animation',source:'animation_keyframes',
  description:'A script builds keyframe tracks in code: position, rotation and scale keys for each of 16 tiles, eased between keys and sampled every frame. The tiles fly in from the floor, turn and settle into a logo, then scatter and do it again. Press a tile and game.raycast finds it, so it hops; press empty space to start over. Open the Assemble script to change the keys.',
  async build(b){const eye=[0,1.2,7.5],pitch=-6;b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-1.8,'#3d4450');
   const logo=b.node3d('Logo',[0,.4,0]);const cells=[];for(let r=0;r<5;r++)for(let c=0;c<5;c++)if(r===0||r===4||c===0||c===4)cells.push([c,r]);
   cells.forEach(([c,r],i)=>b.prim(`Tile ${i+1}`,[(c-2)*.62,(2-r)*.62,0],{shape:'cube',color:'#'+[[155,197,61],[60,141,90]][0].map((a,k)=>Math.round(a+([60,141,90][k]-a)*i/15).toString(16).padStart(2,'0')).join(''),roughness:.45},[0,0,0],.56,logo.id));
   b.script(logo,'Assemble',`// Keyframe tracks built in code: every tile gets position, rotation and scale keys, eased between keys
// and sampled each frame. Times are in seconds of one loop.
type Key = {t: number; p: number[]; r: number[]; s: number};
export const params = {loop: param.number(7, {min: 3, max: 20, label: 'Loop (s)'})};
const ease = (k: number) => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k);
function sample(track: Key[], t: number) {
  let i = 0;
  while (i < track.length - 2 && t > track[i + 1].t) i++;
  const a = track[i], b = track[i + 1], k = ease(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))));
  return {p: mix(a.p, b.p, k), r: mix(a.r, b.r, k), s: a.s + (b.s - a.s) * k};
}
export function start(self: GameObject3D) {
  self.state.time = 0;
  self.state.tracks = self.children.map((tile, i) => {
    const home = [tile.position.x, tile.position.y, tile.position.z];
    const angle = i * 2.4, away = [Math.cos(angle) * (2.5 + i % 3), -2, Math.sin(angle) * 1.5 - 1];
    const tumble = [90 * (i % 3), (i * 67) % 360, 45], late = i * 0.05;
    const keys: Key[] = [
      {t: 0, p: away, r: tumble, s: 0.2},
      {t: 0.3 + late, p: away, r: tumble, s: 0.2},
      {t: 1.5 + late, p: [home[0] * 1.6, home[1] + 1.4, 1.6], r: [0, 180, 0], s: 1.2},
      {t: 2.4 + late, p: home, r: [0, 360, 0], s: 1},
      {t: 5.6, p: home, r: [0, 360, 0], s: 1},
      {t: 6.6, p: away, r: tumble, s: 0.2},
      {t: 7, p: away, r: tumble, s: 0.2},
    ];
    return keys;
  });
}
export function update(self: GameObject3D, dt: number) {
  self.state.time = (self.state.time + dt) % self.params.loop;
  const t = self.state.time * 7 / self.params.loop;
  self.children.forEach((tile, i) => {
    const key = sample(self.state.tracks[i], t);
    // A pressed tile hops toward the camera and flips once, on top of its keys.
    const kick = self.state.kick && self.state.kick.index === i ? game.time - self.state.kick.at : 1;
    const hop = kick < 1 ? Math.sin(kick * Math.PI) : 0;
    tile.position.set(key.p[0], key.p[1], key.p[2] + hop * 1.5);
    tile.rotation.set(key.r[0] + (kick < 1 ? kick * 360 : 0), key.r[1], key.r[2]);
    tile.scale = key.s;
  });
}
// game.raycast finds the 3D object under the pointer: a tile hops, empty space replays the tracks.
export function onPointerDown(self: GameObject3D, x: number, y: number) {
  const hit = game.raycast(x, y), index = hit ? self.children.findIndex(c => c.id === hit.object.id) : -1;
  if (index >= 0) self.state.kick = {index, at: game.time};
  else self.state.time = 0;
}
`);
   b.label('Keyframe tracks built in a script · press a tile, or empty space to replay',480,32,20);}},
 {id:'pixi3d-asset-lifetime',title:'Model lifetime',category:'Assets',source:'assets_lifetime',
  description:'Two ways to take a castle out of the scene, and what each keeps. Hide turns the object off: it is not drawn, but its model stays loaded, so it comes back at once. Unload frees the model\'s GPU resources while the object stays in the scene; Bring back loads it again. The status line shows the shared model files the 3D view holds.',
  async build(b){const eye=[0,2.6,7],pitch=-16,id=await b.model('castle','Castle',await castle());b.setView();b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,0,'#4b5a3c');
   const keep=b.modelEntity('Castle',[0,0,0],id,null,[0,30,0],1.1);
   const status=b.node2d('Status',480,404,[b.text2d('',16,'#e8edf2',{fontWeight:'normal',strokeColor:'#0b0f14',strokeWidth:4})]);
   b.script(status,'Lifetime',`// Takes the castle out of the scene two ways and brings it back; the text shows what is still loaded.
export const params = {castle: param.object<GameObject3D>({label: 'Castle'})};
export function start(self: GameObject) { self.state.note = 'In the scene'; }
export function onMessage(self: GameObject, message: string) {
  const castle = self.params.castle as GameObject3D;
  if (message === 'hide') { castle.active = false; self.state.note = 'Hidden: not drawn, its model stays loaded'; }
  if (message === 'unload') { castle.model.unload(); self.state.note = 'Unloaded: the object stays, its model is freed'; }
  if (message === 'back') {
    castle.active = true; self.state.note = 'Loading…';
    castle.model.load().then(() => { self.state.note = 'Back in the scene'; });
  }
}
export function update(self: GameObject) {
  const castle = self.params.castle as GameObject3D, files = game.assets.stats();
  self.text = self.state.note + '\\nactive: ' + castle.active + ' · model: ' + castle.model.state + ' · model files loaded: ' + (files ? files.loaded : 0);
}
`,{},{castle:keep.id});
   [['Hide','hide',-260,'#5a6b80'],['Unload','unload',0,'#9a5a4a'],['Bring back','back',260,'#4a8a5a']].forEach(([text,message,dx,color])=>{const button=b.node2d(`${text} button`,480+dx,480,[b.shape2d('rect',200,52,color,{rounded:10})]);b.node2d(`${text} label`,0,0,[b.text2d(text,20)],button);
    b.script(button,'Button',`// Sends its message to every script (the Lifetime script on the status line reacts).
export const params = {message: param.choice(['hide', 'unload', 'back'])};
export function onClick(self: GameObject) { game.send(self.params.message); }
`,{message});});
   b.label('Hide or unload a model, then bring it back',480,32,20);}},
 {id:'pixi3d-mirror',title:'Mirror',category:'Cameras',source:'cameras_mirror',
  description:'Mirror 3D on a plane reflects the scene from wherever the camera stands: the view is drawn again from the camera reflected in the mirror and shown on the glass. Left stays left in a mirror, so the red block on the left is on the left in the reflection too. Drag to orbit and watch the reflection follow.',
  async build(b){const eye=[0,1.7,5.5],pitch=-9,checker=await b.texture('checker','Checker floor');b.setView();b.camera3d(eye,[pitch,0,0]);b.control(b.camera,{targetX:0,targetY:.8,targetZ:-.5,minDistance:2.5,maxDistance:12});sun(b);
   b.prim('Floor',[0,0,0],{shape:'plane',color:'#ffffff',roughness:.85,baseColorTexture:checker,uvScaleX:6,uvScaleY:6},[-90,0,0],[14,14,1]);
   b.prim('Frame',[0,1.25,-2.08],{shape:'cube',color:'#5a4632',roughness:.6},[0,0,0],[3.3,2.3,.12]);
   const glass=b.prim('Mirror',[0,1.25,-2],{shape:'plane',color:'#ffffff',castShadow:false},[0,0,0],[3,2,1]);glass.components.push({id:'mirror-component',type:'pixi3d.mirror',version:1,data:{tint:'#e6ecf0',resolution:1}});
   b.prim('Red block',[-1,.35,-.3],{shape:'cube',color:'#e0443a'},[0,20,0],.7);b.prim('Blue block',[1,.35,-.3],{shape:'cube',color:'#3a7be0'},[0,-20,0],.7);
   b.prim('Green ball',[0,.3,.6],{shape:'sphere',color:'#5ac85a'},[0,0,0],.6);b.prim('Tall cone',[-1.9,.6,-1],{shape:'cone',color:'#f2c14e'},[0,0,0],[.5,1.2,.5]);
   b.label('Mirror 3D · drag to orbit',480,32,20);}},
 {id:'pixi3d-geometry-arrays',title:'Geometry from arrays',category:'Geometry',source:'geometry_custom',
  description:'Mesh 3D takes its shape from a script: game.geometry({positions, indices, normals, uvs}) builds it from plain arrays and self.mesh.geometry shows it. The hills are a 48 × 48 grid with heights, uvs for the checker map and normals the host computes; the gem is eight triangles without indices, shaded flat. Shapes live for the play session; in the editor a Mesh 3D shows a cube stand-in.',
  async build(b){const checker=await b.texture('checker','Checker');b.setView();b.camera3d([0,3.2,7],[-22,0,0]);sun(b);
   const hills=b.mesh3d('Hills',[0,-.6,0],{texture:checker,roughness:.9});
   b.script(hills,'Hills',`// A height field from arrays: one vertex per grid point, two triangles per cell, uvs for the colour map.
export const params = {size: param.number(48, {min: 4, max: 200, label: 'Cells per side'})};
export function start(self: GameObject3D) {
  const n = self.params.size, positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) {
    const u = x / n, v = z / n, px = (u - 0.5) * 8, pz = (v - 0.5) * 8;
    positions.push(px, Math.sin(px * 1.3) * Math.cos(pz * 1.1) * 0.45 + Math.sin(px * 0.4 + pz * 0.7) * 0.3, pz);
    uvs.push(u * 4, v * 4);
  }
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { const a = z * (n + 1) + x, b = a + n + 1; indices.push(a, b, a + 1, a + 1, b, b + 1); }
  // No normals given: the host works them out from the triangles.
  self.mesh.geometry = game.geometry({positions, uvs, indices});
}
`);
   const gem=b.mesh3d('Gem',[0,1.1,.8],{color:'#7fd6ff',roughness:.15,metallic:.2,flatShading:true});
   b.script(gem,'Gem',`// Eight triangles listed vertex by vertex (no indices): every face keeps its own normal, so it shades flat.
export function start(self: GameObject3D) {
  const top = [0, 0.7, 0], bottom = [0, -0.7, 0], ring = [[0.5, 0, 0], [0, 0, -0.5], [-0.5, 0, 0], [0, 0, 0.5]], positions: number[] = [];
  for (let i = 0; i < 4; i++) { const a = ring[i], b = ring[(i + 1) % 4]; positions.push(...top, ...b, ...a, ...bottom, ...a, ...b); }
  self.mesh.geometry = game.geometry({positions});
}
export function update(self: GameObject3D, dt: number) { self.rotation.y += 45 * dt; }
`);
   b.label('Shapes built from arrays in a script',480,32,20);}},
 {id:'pixi3d-vertex-colors',title:'Vertex colours',category:'Geometry',source:'geometry_vertex-data',
  description:'Per-vertex data: each vertex of the left sphere carries a colour (r, g, b, a) and Mesh 3D\'s "Vertex colours" multiplies the surface by it; the right sphere has the same shape and colours with that switch off. A second colour set (colors1) is stored too, but only a custom shader can read it (planned with Shader 3D assets).',
  async build(b){b.setView();b.camera3d([0,1.2,5.2],[-10,0,0]);sun(b);floor(b,-1.1,'#3d4450');
   const src=`SPHERE
// Colours per vertex: a rainbow around the sphere, darker toward the bottom.
export function start(self: GameObject3D) {
  const {positions, indices} = sphere(32, 48), colors: number[] = [], colors1: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const hue = (Math.atan2(positions[i + 2], positions[i]) / (Math.PI * 2) + 1) % 1, shade = 0.35 + (positions[i + 1] * 0.5 + 0.5) * 0.65;
    const k = (n: number) => (n + hue * 12) % 12, f = (n: number) => (0.5 - 0.5 * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * shade;
    colors.push(f(0), f(8), f(4), 1);
    colors1.push(positions[i + 1] * 0.5 + 0.5, 0, 0, 1);
  }
  self.mesh.geometry = game.geometry({positions, indices, colors, colors1});
}
export function update(self: GameObject3D, dt: number) { self.rotation.y += 20 * dt; }
`.replace('SPHERE',SPHERE_SOURCE);
   b.script(b.mesh3d('With vertex colours',[-1.3,0,0],{vertexColors:true}),'Rainbow sphere',src);b.script(b.mesh3d('Without',[1.3,0,0],{vertexColors:false}),'Rainbow sphere',src);
   b.label('Vertex colours on',300,440,16);b.label('Vertex colours off',660,440,16);b.label('Colours stored per vertex',480,32,20);}},
 {id:'pixi3d-vertex-formats',title:'Vertex formats',category:'Geometry',source:'geometry_vertex-formats',
  description:'The same sphere twice: on the left every value is a 32-bit float; on the right the script asks for packed storage with game.geometry\'s format option (positions as 16-bit snorm, normals as 8-bit snorm, colours as 8-bit unorm), so the GPU reads them back as floats from fewer bytes. The labels give each copy\'s vertex bytes.',
  async build(b){b.setView();b.camera3d([0,1.2,5.2],[-10,0,0]);sun(b);floor(b,-1.1,'#3d4450');
   const floatLabel=b.node2d('Float label',300,440,[b.text2d('',16,'#e8edf2',{fontWeight:'normal',strokeColor:'#0b0f14',strokeWidth:4})]),packedLabel=b.node2d('Packed label',660,440,[b.text2d('',16,'#e8edf2',{fontWeight:'normal',strokeColor:'#0b0f14',strokeWidth:4})]);
   const src=`SPHERE
// One sphere, stored two ways. Floats: 12 + 12 + 16 bytes per vertex (position, normal, colour).
// Packed: positions as snorm16 (x, y, z + padding: 8 bytes), normals as snorm8 (4), colours as unorm8 (4).
export const params = {packed: param.bool(false), label: param.object({label: 'Size label'})};
export function start(self: GameObject3D) {
  const {positions, indices} = sphere(40, 64), colors: number[] = [];
  for (let i = 0; i < positions.length; i += 3) colors.push(0.6 + positions[i + 1] * 0.4, 0.55, 0.6 - positions[i + 1] * 0.4, 1);
  const packed = self.params.packed;
  const g = game.geometry({positions, normals: positions, indices, colors, format: packed ? {positions: 'snorm16', normals: 'snorm8', colors: 'unorm8'} : {}});
  self.mesh.geometry = g;
  const label = self.params.label as GameObject | null;
  if (label) label.text = (packed ? 'Packed: ' : 'Float32: ') + g.vertexCount * (packed ? 16 : 40) + ' bytes';
}
export function update(self: GameObject3D, dt: number) { self.rotation.y += 20 * dt; }
`.replace('SPHERE',SPHERE_SOURCE);
   b.script(b.mesh3d('Float sphere',[-1.3,0,0],{vertexColors:true}),'Format sphere',src,{packed:false},{label:floatLabel});b.script(b.mesh3d('Packed sphere',[1.3,0,0],{vertexColors:true}),'Format sphere',src,{packed:true},{label:packedLabel});
   b.label('Same sphere: float32 vs packed vertex formats',480,32,20);}},
 {id:'pixi3d-geometry-morph',title:'Morph targets from arrays',category:'Geometry',source:'geometry_morph-targets',
  description:'Morph targets store extra shapes as offsets for every vertex; Mesh 3D\'s morph weights blend them in. The script gives a sphere two targets, Squash and Spikes, and moves their weights over time; the bars show the weights.',
  async build(b){b.setView();b.camera3d([0,1.2,5],[-10,0,0]);sun(b);floor(b,-1.2,'#3d4450');
   const blob=b.mesh3d('Blob',[0,0,0],{color:'#7cc4ff',roughness:.3});
   const bars=['Squash','Spikes'].map((name,k)=>{b.label(name,300,470+k*30,15);return b.node2d(`${name} bar`,490,470+k*30,[b.shape2d('rect',240,14,k?'#f2c14e':'#5aa9e6',{rounded:7})]);});
   b.script(blob,'Blob morphs',`SPHERE
// Two morph targets: offsets from the sphere for every vertex (and for its normals, so the light follows).
export const params = {squashBar: param.object({label: 'Squash bar'}), spikesBar: param.object({label: 'Spikes bar'})};
export function start(self: GameObject3D) {
  const {positions, indices} = sphere(48, 64), squash: number[] = [], spikes: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2], bump = Math.pow(Math.max(0, Math.sin(Math.acos(y) * 6) * Math.sin(Math.atan2(z, x) * 8)), 2) * 0.35;
    squash.push(x * 0.35, -y * 0.45, z * 0.35);
    spikes.push(x * bump, y * bump, z * bump);
  }
  self.mesh.geometry = game.geometry({positions, normals: positions, indices, morphTargets: [{positions: squash}, {positions: spikes}]});
}
export function update(self: GameObject3D) {
  const w = [Math.max(0, Math.sin(game.time * 1.4)), Math.max(0, -Math.sin(game.time * 1.4))];
  self.mesh.morph = w;
  const bars = [self.params.squashBar, self.params.spikesBar] as (GameObject | null)[];
  // Bars grow from their left end (x 370): a bar 240 px wide is centred on its x.
  bars.forEach((bar, i) => { if (!bar) return; const s = 0.05 + w[i] * 0.95; bar.scaleX = s; bar.x = 370 + 120 * s; });
}
`.replace('SPHERE',SPHERE_SOURCE),{},{squashBar:bars[0],spikesBar:bars[1]});
   b.label('Morph targets blended by weight',480,32,20);}},
 {id:'pixi3d-particle-container',title:'Particle container',category:'Particles',source:'particles_container',
  description:'A Particles 3D whose "Driven by" is A script is a fixed pool drawn in one call, and the script says where every particle is each frame: self.particles.write(numbers) with x, y, z, size, colour and alpha per particle. Here 4,000 particles orbit as a spiral galaxy, inner ones faster.',
  async build(b){b.setView({background:'color',backgroundColor:'#05070d',bloom:true,bloomThreshold:.6,bloomIntensity:.8,bloomRadius:.6});b.camera3d([0,4.2,6.5],[-32,0,0]);b.light('Fill',[0,0,0],{kind:'ambient',intensity:.2});
   const g=b.particles('Galaxy',[0,0,0],{count:4000,driver:'script',blendMode:'add',particleTexture:'soft',autoplay:false});
   b.script(g,'Galaxy',`// Every frame: where each of the pool's particles is, its size, colour and alpha (8 numbers each).
export const params = {arms: param.number(3, {min: 1, max: 8}), speed: param.number(0.6, {min: 0, max: 5})};
export function start(self: GameObject3D) {
  const n = self.particles.count, seeds = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { seeds[i * 3] = Math.pow(Math.random(), 0.7) * 3; seeds[i * 3 + 1] = (Math.random() - 0.5) * 0.6; seeds[i * 3 + 2] = (Math.random() - 0.5) * 0.25; }
  self.state.seeds = seeds; self.state.data = new Float32Array(n * 8);
}
export function update(self: GameObject3D) {
  const n = self.particles.count, seeds: Float32Array = self.state.seeds, data: Float32Array = self.state.data, arms = self.params.arms;
  for (let i = 0; i < n; i++) {
    const r = seeds[i * 3], arm = (i % arms) / arms * Math.PI * 2, a = arm + r * 1.6 + seeds[i * 3 + 1] - game.time * self.params.speed / (0.4 + r * 0.5), o = i * 8;
    data[o] = Math.cos(a) * r; data[o + 1] = seeds[i * 3 + 2] * (1 - r / 3.2); data[o + 2] = Math.sin(a) * r; data[o + 3] = 0.05 + (1 - r / 3) * 0.08;
    const t = Math.min(1, r / 3); data[o + 4] = 1 - t * 0.6; data[o + 5] = 0.75 - t * 0.35; data[o + 6] = 0.45 + t * 0.55; data[o + 7] = 0.9;
  }
  self.particles.write(data, n);
}
`);
   b.label('4,000 particles placed by a script every frame',480,32,20);}},
 {id:'pixi3d-custom-emitter',title:'Custom emitter',category:'Particles',source:'particles_custom-emitter',
  description:'A custom emitter shape: a sign made of 768 small tiles (a Batch 3D) burns from left to right, and sparks start on the tiles at the burning edge, rise, cool and fade. One script runs both: it writes the tiles\' colour and size and the sparks\' places every frame (self.batch.write, self.particles.write).',
  async build(b){b.setView({background:'color',backgroundColor:'#0a0c12',bloom:true,bloomThreshold:.7,bloomIntensity:.9,bloomRadius:.6});b.camera3d([0,.3,5.4],[-4,0,0]);b.light('Key',[-30,25,0],{kind:'directional',intensity:1.6});b.light('Fill',[0,0,0],{kind:'ambient',intensity:.35});
   const sign=b.batch3d('Sign',[0,0,0],{size:768,roughness:.8,castShadow:false});
   const sparks=b.particles('Sparks',[0,0,0],{count:1500,driver:'script',blendMode:'add',particleTexture:'soft',autoplay:false});
   b.script(sparks,'Burn',`// A burn sweeps across a sign of tiles; sparks are emitted on the tiles at its edge (a custom emitter shape).
export const params = {sign: param.object({label: 'Sign (Batch 3D)'}), seconds: param.number(6, {min: 2, max: 30, label: 'Burn time'})};
const COLS = 48, ROWS = 16, TILE = 0.075;
export function start(self: GameObject3D) {
  const sign = self.params.sign as GameObject3D, s = 0.5;
  // One unit cube from arrays: 24 vertices (4 per face, so each face keeps its own normal).
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (const [nx, ny, nz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const u = ny ? [1, 0, 0] : [0, 1, 0], v = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]], base = positions.length / 3;
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { positions.push((nx + a * u[0] + c * v[0]) * s, (ny + a * u[1] + c * v[1]) * s, (nz + a * u[2] + c * v[2]) * s); normals.push(nx, ny, nz); }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  sign.batch.geometries = [game.geometry({positions, normals, indices})];
  self.state.tiles = new Float32Array(COLS * ROWS * 12); self.state.noise = Float32Array.from({length: COLS * ROWS}, () => Math.random() * 0.35);
  const n = self.particles.count; self.state.sparks = new Float32Array(n * 6); self.state.out = new Float32Array(n * 8); self.state.next = 0;
}
export function update(self: GameObject3D, dt: number) {
  const sign = self.params.sign as GameObject3D, tiles: Float32Array = self.state.tiles, noise: Float32Array = self.state.noise;
  const front = ((game.time % (self.params.seconds + 1.5)) / self.params.seconds) * 1.5 - 0.2, edge: number[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c, o = i * 12, x = (c - (COLS - 1) / 2) * TILE * 1.1, y = ((ROWS - 1) / 2 - r) * TILE * 1.1, burn = (front - c / COLS - noise[i]) * 6;
    // burn < 0: untouched sign; 0–1: glowing; past 1: charred and shrinking away.
    const glow = Math.max(0, Math.min(1, 1 - Math.abs(burn - 0.5) * 2)), gone = Math.max(0, Math.min(1, burn - 1));
    if (glow > 0.2) edge.push(x, y);
    const k = burn < 0 ? 0 : Math.min(1, burn), size = TILE * (1 - gone);
    tiles[o] = 0; tiles[o + 1] = x; tiles[o + 2] = y; tiles[o + 3] = 0; tiles[o + 4] = 0; tiles[o + 5] = 0; tiles[o + 6] = 0; tiles[o + 7] = 1; tiles[o + 8] = Math.max(0.0001, size);
    tiles[o + 9] = (0.85 * (1 - k) + 0.12 * k) + glow * 1.2; tiles[o + 10] = (0.78 * (1 - k) + 0.08 * k) + glow * 0.45; tiles[o + 11] = (0.62 * (1 - k) + 0.06 * k) + glow * 0.05;
  }
  sign.batch.write(tiles, COLS * ROWS);
  // Sparks: 6 numbers each (x, y, z, vx, vy, age); new ones start on the burning edge's tiles.
  const sparks: Float32Array = self.state.sparks, out: Float32Array = self.state.out, n = self.particles.count;
  for (let k = 0; k < 30 && edge.length; k++) { const i = self.state.next, j = Math.floor(Math.random() * edge.length / 2) * 2, o = i * 6; self.state.next = (i + 1) % n;
    sparks[o] = edge[j] + (Math.random() - 0.5) * TILE; sparks[o + 1] = edge[j + 1] + (Math.random() - 0.5) * TILE; sparks[o + 2] = TILE * 0.6; sparks[o + 3] = (Math.random() - 0.5) * 0.4; sparks[o + 4] = 0.3 + Math.random() * 0.8; sparks[o + 5] = 0.001; }
  for (let i = 0; i < n; i++) { const o = i * 6, p = i * 8, age = sparks[o + 5];
    if (age <= 0 || age > 1.4) { out[p + 3] = 0; out[p + 7] = 0; continue; }
    sparks[o] += sparks[o + 3] * dt; sparks[o + 1] += sparks[o + 4] * dt; sparks[o + 4] -= 0.25 * dt; sparks[o + 5] = age + dt;
    const t = age / 1.4; out[p] = sparks[o]; out[p + 1] = sparks[o + 1]; out[p + 2] = sparks[o + 2]; out[p + 3] = 0.05 * (1 - t * 0.6);
    out[p + 4] = 1; out[p + 5] = 0.75 - t * 0.6; out[p + 6] = 0.3 - t * 0.3; out[p + 7] = 1 - t;
  }
  self.particles.write(out, n);
}
`,{},{sign:sign.id});
   b.label('Sparks emitted on the burning edge of a tiled sign',480,32,20);}},
 {id:'pixi3d-batched-mesh',title:'Batch 3D',category:'Instancing',source:'instancing_batched-mesh',
  description:'Batch 3D is one scene node that draws many copies of several shapes: a script builds a sphere, a cube and a cone from arrays, hands them to self.batch.geometries, and writes 20,000 items (shape, place, turn, size, colour) once with self.batch.write. Drag to orbit.',
  async build(b){b.setView();b.camera3d([0,9,15],[-32,0,0]);b.control(b.camera,{targetX:0,targetY:0,targetZ:0,minDistance:4,maxDistance:40});sun(b,2.2,.25);floor(b,-.05,'#3d4450');
   const clay=b.batch3d('Clay',[0,0,0],{size:20000,roughness:.75});
   b.script(clay,'Clay',`SPHERE
// Three shapes from arrays and 20,000 items, written once: shape index, x, y, z, qx, qy, qz, qw, scale, r, g, b.
export const params = {count: param.number(20000, {min: 1, max: 20000})};
function cube() { const positions: number[] = [], indices: number[] = [];
  for (const [nx, ny, nz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const u = ny ? [1, 0, 0] : [0, 1, 0], v = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]], base = positions.length / 3;
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) positions.push((nx + a * u[0] + c * v[0]) * 0.5, (ny + a * u[1] + c * v[1]) * 0.5, (nz + a * u[2] + c * v[2]) * 0.5);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3); }
  return {positions, indices}; }
function cone(sides: number) { const positions: number[] = [0, 0.6, 0], indices: number[] = [];
  for (let i = 0; i <= sides; i++) { const a = i / sides * Math.PI * 2; positions.push(Math.cos(a) * 0.45, -0.4, Math.sin(a) * 0.45); }
  for (let i = 1; i <= sides; i++) indices.push(0, i + 1, i);
  return {positions, indices}; }
export function start(self: GameObject3D) {
  const ball = sphere(12, 16);
  self.batch.geometries = [game.geometry({positions: ball.positions.map(v => v * 0.5), normals: ball.positions, indices: ball.indices}), game.geometry(cube()), game.geometry(cone(14))];
  const n = Math.min(self.params.count, self.batch.size), data = new Float32Array(n * 12);
  for (let i = 0; i < n; i++) {
    const o = i * 12, a = i * 2.39996, r = Math.sqrt(i / n) * 7.5, turn = Math.random() * Math.PI, s = 0.12 + Math.random() * 0.1;
    data[o] = i % 3; data[o + 1] = Math.cos(a) * r; data[o + 2] = s * 0.5; data[o + 3] = Math.sin(a) * r;
    data[o + 4] = 0; data[o + 5] = Math.sin(turn / 2); data[o + 6] = 0; data[o + 7] = Math.cos(turn / 2); data[o + 8] = s;
    const h = (r / 7.5 + i % 3 * 0.1) % 1; data[o + 9] = 0.75 + 0.25 * Math.cos(h * 6.28); data[o + 10] = 0.65 + 0.25 * Math.cos(h * 6.28 - 2.1); data[o + 11] = 0.65 + 0.25 * Math.cos(h * 6.28 + 2.1);
  }
  self.batch.write(data, n);
  game.log('clay shapes', n);
}
export function update(self: GameObject3D, dt: number) { self.rotation.y += 4 * dt; }
`.replace('SPHERE',SPHERE_SOURCE));
   b.label('20,000 clay shapes in one Batch 3D',480,32,20);}},
 {id:'pixi3d-shader-extra-bits',title:'Extra bits',category:'Shaders',source:'shaders_extra-bits',
  description:'A Shader 3D of kind "extra" adds its code to an object\'s own material: these PBR shapes keep their colour, roughness and lights, and the shader paints moving stripes on top (material.stripe, material.density, material.speed; material.time is game time). Each shader is written in WGSL (WebGPU) and GLSL (WebGL); open the Shaders panel to edit it. A shader only joins a material after it compiled on that renderer.',
  async build(b){b.setView();b.camera3d([0,1.6,6],[-12,0,0]);sun(b);floor(b,-1,'#3d4450');
   const stripes=b.shader({name:'Stripes',kind:'extra',params:[{name:'stripe',type:'color',default:'#ffd23c'},{name:'density',type:'float',default:6},{name:'speed',type:'float',default:.4}],
    wgsl:{material:`  // Bands along world height, moving with game time.
  let band = step(0.5, fract(input.vPosition.y * material.density - material.time * material.speed));
  albedo = mix(albedo, material.stripe.rgb, band * 0.85);`},
    glsl:{material:`  // Bands along world height, moving with game time.
  float band = step(0.5, fract(vPosition.y * material.density - material.time * material.speed));
  albedo = mix(albedo, material.stripe.rgb, band * 0.85);`}});
   const knot=b.prim('Knot',[-1.7,.2,0],{shape:'torusKnot',tube:.12,color:'#5aa9e6',roughness:.3,metallic:.3},[0,0,0],1);b.useShader(knot,stripes);
   const ball=b.prim('Ball',[0,.1,0],{color:'#e0784a',roughness:.4},[0,0,0],1.2);b.useShader(ball,stripes,{stripe:'#ffffff',density:9,speed:-.3});
   const box=b.prim('Box',[1.7,.1,0],{shape:'cube',color:'#9bc53d',roughness:.6},[0,30,0],1);b.useShader(box,stripes,{stripe:'#3a2a6a',density:4});
   b.label('Shader code added to built-in materials',480,32,20);}},
 {id:'pixi3d-shader-material',title:'Your own material',category:'Shaders',source:'shaders_custom-material',
  description:'A Shader 3D of kind "material" replaces the surface with your own code: a texture (pattern) and three values (tint, lines, speed) become an unlit hologram with moving scan lines. The parameters show on the Shader 3D add-on, and each object can set its own.',
  async build(b){const grid=await b.texture('grid','Hologram grid');b.setView({background:'color',backgroundColor:'#060a12',bloom:true,bloomThreshold:.6,bloomIntensity:.7,bloomRadius:.6});b.camera3d([0,1.4,5.5],[-10,0,0]);sun(b);floor(b,-1,'#1a2230');
   const holo=b.shader({name:'Hologram',kind:'material',params:[{name:'pattern',type:'texture'},{name:'tint',type:'color',default:'#59d8ff'},{name:'lines',type:'float',default:14},{name:'speed',type:'float',default:1.2}],
    wgsl:{material:`  // The pattern, tinted, with bright scan lines running up the object.
  let tex = samplePattern(input.vUV * 2.0);
  let scan = 0.55 + 0.45 * sin((input.vPosition.y * material.lines - material.time * material.speed) * 6.2831);
  albedo = tex.rgb * material.tint.rgb * scan * 1.6;
  alpha = 1.0;`},
    glsl:{material:`  // The pattern, tinted, with bright scan lines running up the object.
  vec4 tex = samplePattern(vUV * 2.0);
  float scan = 0.55 + 0.45 * sin((vPosition.y * material.lines - material.time * material.speed) * 6.2831);
  albedo = tex.rgb * material.tint.rgb * scan * 1.6;
  alpha = 1.0;`}});
   b.useShader(b.prim('Hologram sphere',[-1.3,0,0],{color:'#ffffff'},[0,0,0],1.4),holo,{pattern:grid});
   b.useShader(b.prim('Hologram box',[1.3,0,0],{shape:'cube',color:'#ffffff'},[0,25,0],1.1),holo,{pattern:grid,tint:'#ff7ad9',lines:8,speed:-.8});
   b.label('Your own material: a texture and three values',480,32,20);}},
 {id:'pixi3d-shader-lighting',title:'Custom lighting model',category:'Shaders',source:'shaders_lighting-model',
  description:'A Shader 3D of kind "lighting" keeps a plain surface (colour, colour map) and lets your code decide how it answers light: before the light loop, once per light (nDotL, attenuation, shadow, light.color are ready), and after it. This one shades from a cool colour to a warm one and adds a rim; the left knot uses the built-in lighting for comparison.',
  async build(b){b.setView();b.camera3d([0,1.4,5.6],[-10,0,0]);sun(b,2.6,.2);b.light('Back',[20,160,0],{kind:'directional',intensity:1.2,color:'#9fc4ff'});floor(b,-1,'#3d4450');
   const gooch=b.shader({name:'Warm and cool',kind:'lighting',params:[{name:'warm',type:'color',default:'#ffb35c'},{name:'cool',type:'color',default:'#2c4a8c'},{name:'rim',type:'float',default:.6}],
    wgsl:{preLighting:`  var shade = vec3<f32>(0.0);`,perLight:`    // From cool (facing away) to warm (facing the light), in the light's colour.
    let lit = nDotL * attenuation * shadow;
    shade += mix(material.cool.rgb, material.warm.rgb, lit) * light.color * 0.6;`,postLighting:`  let rimLight = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0) * material.rim;
  finalColor = albedo * (shade + material.cool.rgb * 0.25) + vec3<f32>(rimLight);`},
    glsl:{preLighting:`  vec3 shade = vec3(0.0);`,perLight:`    // From cool (facing away) to warm (facing the light), in the light's colour.
    float lit = nDotL * attenuation * shadow;
    shade += mix(material.cool.rgb, material.warm.rgb, lit) * light.color * 0.6;`,postLighting:`  float rimLight = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0) * material.rim;
  finalColor = albedo * (shade + material.cool.rgb * 0.25) + vec3(rimLight);`}});
   b.prim('Built-in lighting',[-1.4,.1,0],{shape:'torusKnot',tube:.14,color:'#e8e8e8',roughness:.5},[0,0,0],1);
   b.useShader(b.prim('Warm and cool',[1.4,.1,0],{shape:'torusKnot',tube:.14,color:'#e8e8e8'},[0,0,0],1),gooch);
   b.label('Built-in lighting',300,430,16);b.label('Custom lighting model',660,430,16);b.label('Your code decides how light shades a surface',480,32,20);}},
 {id:'pixi3d-shader-projected',title:'Projected textures',category:'Shaders',source:'shaders_projected-textures',
  description:'One cloud texture projected across several objects: the "extra" shader samples it by world position (x and z), not by each object\'s uvs, so the cloud shadows line up across the ground, the boxes and the dome, and drift with game time.',
  async build(b){const clouds=await b.texture('clouds','Clouds');b.setView();b.camera3d([0,4.5,8],[-28,0,0]);sun(b,2.6,.25);
   const proj=b.shader({name:'Cloud shadows',kind:'extra',params:[{name:'clouds',type:'texture'},{name:'scale',type:'float',default:.12},{name:'speed',type:'float',default:.05},{name:'darkness',type:'float',default:.65}],
    wgsl:{material:`  // World x and z pick the spot in the cloud texture (it repeats), so every object agrees.
  let uv = input.vPosition.xz * material.scale + vec2<f32>(material.time * material.speed, 0.0);
  let cover = sampleClouds(uv).r;
  albedo *= 1.0 - cover * material.darkness;`},
    glsl:{material:`  // World x and z pick the spot in the cloud texture (it repeats), so every object agrees.
  vec2 uv = vPosition.xz * material.scale + vec2(material.time * material.speed, 0.0);
  float cover = sampleClouds(uv).r;
  albedo *= 1.0 - cover * material.darkness;`}});
   const values={clouds};const ground=floor(b,-.5,'#7fa86a');b.useShader(ground,proj,values);
   [[-2.4,0,-1,'#d9c7a3'],[0,0,-2,'#c9b48c'],[2.4,0,-.5,'#e3d6b8']].forEach(([x,y,z,c],k)=>b.useShader(b.prim(`House ${k+1}`,[x,y,z],{shape:'cube',color:c},[0,k*20,0],1),proj,values));
   b.useShader(b.prim('Dome',[0,-.5,1.6],{shape:'sphere',color:'#e8e8e8'},[0,0,0],1.6),proj,values);
   b.label('One texture projected in world space',480,32,20);}},
 {id:'pixi3d-render-graph',title:'Render graph panel',category:'Debug',source:'debug_graph-overlay',
  description:'A developer panel, not part of the game: select the 3D View and press "Render graph" in its toolbar to record frames and see each pass (shadows, the opaque and transparent scene, bloom, outlines) with its draws and why any were rebuilt. Nothing is recorded unless you press Record.',
  async build(b){const eye=[0,2,6],pitch=-12;b.setView({bloom:true,bloomThreshold:1,bloomIntensity:.6,bloomRadius:.5,outlineWidth:.04,outlineColor:'#ffd23c'});b.camera3d(eye,[pitch,0,0]);sun(b);floor(b,-.6,'#3d4450');
   const k=b.prim('Outlined knot',[-1.6,0,0],{shape:'torusKnot',tube:.12,color:'#9bc53d'},[0,0,0],1.1);b.addon(k,'pixi3d.outline');b.prim('Glass ball',[0,0,0],{color:'#dff2ff',alphaMode:'blend',alpha:.4},[0,0,0],1);b.prim('Glow',[1.6,0,0],{color:'#ffcc55',emissiveColor:'#ffaa33',emissiveStrength:4},[0,0,0],.8);
   b.label('Select the 3D View → Render graph',480,32,20);}},
 {id:'pixi3d-geometry-panel',title:'Geometry panel',category:'Debug',source:'debug_thumbnails',
  description:'A developer panel, not part of the game: select the 3D View and press "Geometry" in its toolbar for a small shaded preview of every geometry the view draws, with its vertex count, drawn on the CPU so it costs the scene nothing.',
  async build(b){const lampId=await b.model('lamp','Desk lamp',await lamp());b.setView();b.camera3d([0,3,8],[-18,0,0]);sun(b);floor(b,-.6,'#3d4450');
   ['cube','sphere','cylinder','cone','capsule','torus','torusKnot','icosahedron'].forEach((shape,k)=>b.prim(shape,[(k%4-1.5)*1.6,0,(Math.floor(k/4)-.5)*1.8],{shape,color:['#e0784a','#5aa9e6','#9bc53d','#f2c14e','#a27ae0','#ff6ad2','#3cd2ff','#c9ccd2'][k]},[0,20,0],.9));b.modelEntity('Desk lamp',[0,-.6,-2.4],lampId,null,[0,0,0],1);
   b.label('Select the 3D View → Geometry',480,32,20);}},
];

// ---------- write, export, photograph ----------
const base=JSON.parse(await readFile(join(root,'examples/end-to-end/Interactive demo.pixieditor'),'utf8'));
const modules={...base.modules,scene3d:'1.0.0','pixi3d-editor':'1.0.0'};
const server=await new Promise(done=>{const s=createServer(async(req,res)=>{try{const path=resolve(join(staticRoot,decodeURIComponent(new URL(req.url,'http://x').pathname)));if(!path.startsWith(staticRoot+sep))throw 0;const body=await readFile(path);const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.webp':'image/webp','.png':'image/png','.css':'text/css','.wasm':'application/wasm','.glb':'model/gltf-binary'};res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1',()=>done(s));});
let staticRoot='';
const catalogFile=join(root,'examples/catalog.json'),catalog=JSON.parse(await readFile(catalogFile,'utf8'));
try{for(const example of examples){if(only.size&&!only.has(example.id))continue;
 const b=builder(example.id);await example.build(b);
 const scene={formatVersion:1,id:uuid(example.id,'scene'),name:example.title,entities:b.entities};
 const project={formatVersion:1,name:example.title,entrySceneId:scene.id,scenes:[scene],modules,providers:base.providers,extensions:{'assets.registry':{version:1,items:b.assets},...b.globals.length?{'interactions.globals':{version:1,items:b.globals}}:{},...b.scripts.length?{'scripts.library':{version:1,items:b.scripts}}:{},...b.shaders.length?{'pixi3d.shaders':{version:1,items:b.shaders}}:{}}};
 const dir=join(root,'examples',example.id),file=join(dir,`${example.title}.pixieditor`);await rm(dir,{recursive:true,force:true});await mkdir(join(file+'.assets','sources'),{recursive:true});
 await writeFile(file,JSON.stringify(project,null,1)+'\n');for(const [name,bytes] of b.sources)await writeFile(join(file+'.assets','sources',name),bytes);
 const out=await mkdtemp(join(tmpdir(),'pixi3d-example-'));
 try{execFileSync(process.execPath,[join(root,'scripts/fixtures/3d-project-export.mjs'),file,out],{cwd:root,stdio:'pipe'});
  const html=(await readdir(out)).find(n=>n.startsWith('Pixi-HTML-'));staticRoot=resolve(out,html);
  const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);await page.getByRole('button',{name:/start/i}).click({timeout:5000}).catch(()=>{});await page.waitForTimeout(3500);
  const text=await page.evaluate(()=>document.body.innerText.trim());if(errors.length||/error/i.test(text))throw Error(`${example.id}: ${[...errors,text].join(' | ')}`);
  const shot=await page.locator('canvas').first().screenshot();await page.close();
  await sharp(shot).resize(480,270,{fit:'cover'}).png().toFile(join(dir,'thumbnail.png'));
 }finally{await rm(out,{recursive:true,force:true});}
 const entry={id:example.id,title:example.title,description:example.description,tags:['PixiJS 3D',example.category,'3D'],category:example.category,origin:`https://pixijs.com/3d/examples?example=${example.source}`,file:`${example.id}/${example.title}.pixieditor`,thumbnail:`${example.id}/thumbnail.png`};
 const at=catalog.examples.findIndex(e=>e.id===example.id);if(at>=0)catalog.examples[at]=entry;else catalog.examples.push(entry);
 // Written after every example, so a later failure never drops the ones already built.
 await writeFile(catalogFile,JSON.stringify(catalog,null,1)+'\n');
 console.log(`PASS ${example.id}: ${b.entities.length} entities, ${b.assets.length} textures`);}
}finally{await browser.close();server.close();}
await writeFile(catalogFile,JSON.stringify(catalog,null,1)+'\n');console.log(`catalog: ${catalog.examples.length} examples`);
await ssr.close();
