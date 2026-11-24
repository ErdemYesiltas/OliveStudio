import {afterEach,expect,it,vi} from 'vitest';
import {Container} from 'pixi.js';
import {Material3D,PhongMaterial,FlatMaterial,Mesh3D} from '@pixi/3d';
import {ToonMaterial,OutlinePass} from '@pixi/3d/extras';
import {SceneService,transformDefinition} from '@rewrite/scene';
import {transform3dDefinition,viewport3dDefinition} from '@rewrite/scene3d';
import type {AssetRecord} from '@rewrite/assets';
import {authoring3dDefinitions,Primitive3DSchema,primitive3dDefinition} from './contracts';
import {model3dDefinition} from './model-contracts';
import {Authoring3D} from './model';
import {Scene3DProjection} from './projection';
import {runtime3DProblems} from './preflight';
import {uvMatrix,applyUv,surfaceTextureIds} from './surface';
const defs=()=>new Map([transformDefinition,transform3dDefinition,viewport3dDefinition,model3dDefinition,...authoring3dDefinitions].map(d=>[d.type,d]));
function fixture(){const scene=new SceneService(defs),editor=new Authoring3D(scene,()=>{},()=>null,()=>true,()=>({x:480,y:270})),ids=editor.createView(),host=new Container(),errors:unknown[]=[];return{scene,ids,host,errors,context:{node:(id:string)=>id===ids.viewId?host:undefined,changed(){},report(e:unknown){errors.push(e);}}};}
const cube=(f:ReturnType<typeof fixture>)=>f.scene.document.current.entities.find(e=>e.name==='Cube')!;
const edit=(f:ReturnType<typeof fixture>,data:object)=>f.scene.document.transact('Surface',s=>{Object.assign(s.entities.find(e=>e.name==='Cube')!.components.find(c=>c.type==='pixi3d.primitive')!.data as object,data);});
const material=(p:Scene3DProjection,id:string)=>(p.slots[0].nodes.get(id)!.children.find(c=>c instanceof Mesh3D) as Mesh3D).material;
const texture=(id:string,type='pixi.texture')=>({id,name:id,type,revision:'a'.repeat(64),source:{extension:'png',bytes:10},metadata:{width:64,height:64,processedBytes:10,pipeline:'test'}}) as unknown as AssetRecord;
const near=(a:readonly number[],b:readonly number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],9));
afterEach(()=>{vi.unstubAllGlobals();});
it('keeps primitives saved before materials as opaque, one-sided PBR',()=>{
 const old=Primitive3DSchema.parse({shape:'cube',color:'#ffffff',roughness:.5,metallic:0});
 expect(old).toMatchObject({material:'pbr',alphaMode:'opaque',alpha:1,doubleSided:false,flatShading:false,baseColorTexture:'',uvScaleX:1,uvRotation:0,shininess:32,toonBands:3,toonOutline:true});
 expect(()=>Primitive3DSchema.parse({...old,material:'glass'})).toThrow();expect(()=>Primitive3DSchema.parse({...old,toonBands:2.5})).toThrow();
});
it('shows each field only for the models it changes',()=>{
 const shown=(data:object)=>primitive3dDefinition.fields.filter(f=>!f.visible||f.visible(Primitive3DSchema.parse({shape:'cube',color:'#ffffff',roughness:.5,metallic:0,...data}) as never)).map(f=>f.key);
 expect(shown({})).toEqual(expect.arrayContaining(['material','alphaMode','doubleSided','baseColorTexture','metallicRoughnessTexture','normalTexture']));
 expect(shown({})).not.toEqual(expect.arrayContaining(['shininess']));expect(shown({})).not.toContain('alpha');expect(shown({})).not.toContain('uvScaleX');expect(shown({})).not.toContain('normalScale');
 expect(shown({material:'phong'})).toEqual(expect.arrayContaining(['shininess','specularColor','normalTexture']));expect(shown({material:'phong'})).not.toContain('metallicRoughnessTexture');
 expect(shown({material:'flat'})).not.toContain('normalTexture');expect(shown({material:'flat'})).not.toContain('flatShading');
 expect(shown({material:'toon'})).toEqual(expect.arrayContaining(['toonBands','toonOutline']));
 expect(shown({alphaMode:'mask'})).toContain('alphaCutoff');expect(shown({alphaMode:'blend'})).toContain('alpha');
 expect(shown({baseColorTexture:'t',normalTexture:'n'})).toEqual(expect.arrayContaining(['uvScaleX','uvScrollY','normalScale']));
});
it('places UVs: tile, offset and scroll from the corner, turn about the centre, and flip V first',()=>{
 const base={uvScaleX:1,uvScaleY:1,uvOffsetX:0,uvOffsetY:0,uvRotation:0,uvScrollX:0,uvScrollY:0};
 near(uvMatrix(base),[1,0,0,1,0,0]);
 near(applyUv(uvMatrix({...base,uvScaleX:4,uvScaleY:2}),1,1),[4,2]);
 near(applyUv(uvMatrix({...base,uvOffsetX:.25,uvScrollX:.5,uvScrollY:-1},2),0,0),[1.25,-2]);
 const turned=uvMatrix({...base,uvRotation:90});near(applyUv(turned,.5,.5),[.5,.5]);near(applyUv(turned,1,.5),[.5,1]);
 const flipped=uvMatrix(base,0,true);near(applyUv(flipped,0,0),[0,1]);near(applyUv(flipped,1,1),[1,0]);
 near(applyUv(uvMatrix({...base,uvScaleY:2},0,true),0,0),[0,2]);
 expect(surfaceTextureIds({baseColorTexture:'a',normalTexture:'b',emissiveTexture:'a',occlusionTexture:''})).toEqual(['a','b']);
});
it('builds the material each model asks for, with its sides, faceting and transparency',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{const id=cube(f).id;
  p.sync(f.scene.document.current);expect(material(p,id)).toBeInstanceOf(Material3D);
  edit(f,{material:'phong',shininess:90,specularStrength:2,doubleSided:true,flatShading:true});p.sync(f.scene.document.current);
  const phong=material(p,id) as PhongMaterial;expect(phong).toBeInstanceOf(PhongMaterial);expect({s:phong.shininess,k:phong.specularStrength,two:phong.doubleSided,flat:phong.flatShading}).toEqual({s:90,k:2,two:true,flat:true});
  edit(f,{material:'flat',alphaMode:'blend',alpha:.4,flatShading:true});p.sync(f.scene.document.current);
  const flat=material(p,id) as FlatMaterial;expect(flat).toBeInstanceOf(FlatMaterial);expect(flat.alphaMode).toBe('blend');expect(flat.alpha).toBeCloseTo(.4,6);expect(flat.flatShading).toBe(false);
  edit(f,{material:'pbr',alphaMode:'mask',alphaCutoff:.3,alpha:.4});p.sync(f.scene.document.current);
  const masked=material(p,id) as Material3D;expect(masked.alphaMode).toBe('mask');expect(masked.alphaCutoff).toBeCloseTo(.3,6);expect(masked.alpha).toBe(1);
  expect(p.slots[0].view.passes.some(x=>x instanceof OutlinePass)).toBe(false);
  edit(f,{material:'toon',toonBands:2,toonOutline:true});p.sync(f.scene.document.current);expect(material(p,id)).toBeInstanceOf(ToonMaterial);
  expect(p.slots[0].view.passes[0]).toBeInstanceOf(OutlinePass);
  edit(f,{toonOutline:false});p.sync(f.scene.document.current);expect(p.slots[0].view.passes.some(x=>x instanceof OutlinePass)).toBe(false);
  expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('loads Library maps behind the readiness gate, places their UVs and scrolls them with time',async()=>{
 const assets=new Map([['wall',texture('wall')],['bump',texture('bump')],['clip',texture('clip','pixi3d.model')]]),port={get:(id:string)=>assets.get(id),url:(a:AssetRecord,file:string)=>`asset://${a.id}/${file}`};
 const fetches:string[]=[];vi.stubGlobal('fetch',(url:string)=>{fetches.push(url);return new Promise(()=>{});});
 const f=fixture(),p=new Scene3DProjection(f.context,port);try{const id=cube(f).id;
  edit(f,{baseColorTexture:'wall',normalTexture:'bump',uvScaleX:3,uvScrollX:.5});p.sync(f.scene.document.current);
  expect(fetches.sort()).toEqual(['asset://bump/image.webp','asset://wall/image.webp']);expect(p.slots[0].loads).toHaveLength(2);
  const m=material(p,id) as Material3D,start=m.uvTransform!;expect([start.a,start.d,start.tx,start.ty]).toEqual([3,-1,0,1]);
  p.setParticleTime(2);expect(m.uvTransform!.tx).toBeCloseTo(1,9);
  edit(f,{baseColorTexture:'gone'});p.sync(f.scene.document.current);expect(String(f.errors.at(-1))).toMatch(/Cube: baseColorTexture: the image is missing/);
  edit(f,{baseColorTexture:'clip'});p.sync(f.scene.document.current);expect(String(f.errors.at(-1))).toMatch(/missing from the Library/);
 }finally{await p.dispose();f.host.destroy();}
});
it('flags missing maps before export',()=>{
 const f=fixture();edit(f,{baseColorTexture:'wall',normalTexture:'bump'});const scene=f.scene.document.current;
 const problems=runtime3DProblems(scene,id=>id==='wall'?texture('wall'):undefined);expect(problems.join()).toMatch(/Cube: the normal map image is missing/);expect(problems.join()).not.toMatch(/baseColor/);
 expect(runtime3DProblems(scene,id=>texture(id))).toEqual([]);
});
it('opens each PBR extension group only when it does something, and keeps plain surfaces bare',async()=>{
 const f=fixture(),p=new Scene3DProjection(f.context);try{const id=cube(f).id;
  p.sync(f.scene.document.current);const plain=material(p,id) as Material3D;
  expect([plain.clearcoat,plain.sheen,plain.transmission,plain.iridescence,plain.anisotropy,plain.specular]).toEqual([undefined,undefined,undefined,undefined,undefined,undefined]);
  expect((p.slots[0].view as unknown as {_composite?:boolean})._composite).toBeFalsy();
  edit(f,{ior:1.8,specularFactor:.5,specularColor:'#ff8800',clearcoat:.8,clearcoatRoughness:.2,sheenColor:'#4455ff',sheenRoughness:.6,transmission:1,thickness:.5,attenuationDistance:2,attenuationColor:'#33aa55',iridescence:1,iridescenceIor:1.4,iridescenceThicknessMin:200,iridescenceThicknessMax:600,anisotropy:.7,anisotropyRotation:90});p.sync(f.scene.document.current);
  const m=material(p,id) as Material3D;
  expect(m.ior).toBeCloseTo(1.8,6);expect(m.specular?.factor).toBeCloseTo(.5,6);expect(m.clearcoat?.factor).toBeCloseTo(.8,6);expect(m.clearcoat?.roughness).toBeCloseTo(.2,6);
  expect(m.sheen?.roughness).toBeCloseTo(.6,6);expect(m.transmission?.factor).toBe(1);expect(m.transmission?.thickness).toBeCloseTo(.5,6);expect(m.transmission?.attenuationDistance).toBeCloseTo(2,6);
  expect(m.iridescence?.ior).toBeCloseTo(1.4,6);expect(m.iridescence?.thicknessMaximum).toBe(600);expect(m.anisotropy?.strength).toBeCloseTo(.7,6);expect(m.anisotropy?.rotation).toBeCloseTo(Math.PI/2,6);
  // Glass draws through the view's own texture, so WebGL shows what is behind it.
  expect((p.slots[0].view as unknown as {_composite?:boolean})._composite).toBe(true);
  edit(f,{material:'phong'});p.sync(f.scene.document.current);expect((p.slots[0].view as unknown as {_composite?:boolean})._composite).toBeFalsy();
  expect(f.errors).toEqual([]);
 }finally{await p.dispose();f.host.destroy();}
});
it('shows extension rows only once their group is on, and checks videos before export',()=>{
 const shown=(data:object)=>primitive3dDefinition.fields.filter(f=>!f.visible||f.visible(Primitive3DSchema.parse({shape:'cube',color:'#ffffff',roughness:.5,metallic:0,...data}) as never)).map(f=>f.key);
 expect(shown({})).toEqual(expect.arrayContaining(['clearcoat','sheenColor','transmission','iridescence','anisotropy','ior','videoTexture']));expect(shown({})).not.toContain('clearcoatRoughness');expect(shown({})).not.toContain('thickness');
 expect(shown({clearcoat:.5,transmission:.5,sheenColor:'#ff0000'})).toEqual(expect.arrayContaining(['clearcoatRoughness','clearcoatTexture','thickness','attenuationColor','sheenRoughness','sheenTexture']));
 expect(shown({material:'phong',clearcoat:.5})).not.toContain('clearcoat');
 const f=fixture();edit(f,{videoTexture:'clip'});const scene=f.scene.document.current;
 expect(runtime3DProblems(scene,()=>undefined).join()).toMatch(/Cube: the video is missing/);expect(runtime3DProblems(scene,id=>({...texture(id),type:'media.video'}) as AssetRecord)).toEqual([]);
});
