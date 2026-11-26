import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {extname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {build} from 'vite';

const root=fileURLToPath(new URL('../',import.meta.url));
const version=JSON.parse(await readFile(join(root,'modules/engine/package.json'),'utf8')).version;
const tarball=join(root,'outputs/engine',`olivestudio-engine-${version}.tgz`);
const scratch=await realpath(await mkdtemp(join(tmpdir(),'olive-standalone-engine-')));
let browser,server;
try{
 await writeFile(join(scratch,'package.json'),JSON.stringify({private:true,type:'module',dependencies:{
  '@olivestudio/engine':`file:${tarball}`,'pixi.js':'8.23.0',
 }}));
 const install=spawnSync('pnpm',['install','--prefer-offline','--ignore-scripts'],{cwd:scratch,stdio:'inherit'});
 if(install.status!==0)throw install.error??Error('Standalone install failed');
 const headless=spawnSync(process.execPath,['--input-type=module','-e',`
  import {RuntimeSession} from '@olivestudio/engine/runtime';
  const session=new RuntimeSession([{id:'test',active:true}],()=>[],{paused:true});
  session.step();
  if(session.frame!==1)throw Error('Headless fixed step failed');
  session.dispose();
 `],{cwd:scratch,stdio:'inherit'});
 if(headless.status!==0)throw headless.error??Error('Standalone runtime import failed');
 const require=createRequire(join(scratch,'package.json'));
 for(const forbidden of ['@rewrite/render-pixi','@rewrite/sdk','@rewrite/scene','react','electron']){
  expect(()=>require.resolve(forbidden)).toThrow();
 }
 await writeFile(join(scratch,'index.html'),'<!doctype html><style>body{margin:0}</style><script type="module" src="/game.ts"></script>');
 await writeFile(join(scratch,'game.ts'),`
  import {PixiGameApplication,SceneVisualProjection,type Entity,type RuntimeEntity} from '@olivestudio/engine';
  import {Container} from 'pixi.js';
  async function boot(){
  const app=new PixiGameApplication();
  await app.init({width:96,height:64,background:'#000000',autoStart:false,preference:'webgl'});
  document.body.appendChild(app.canvas);
  const entity:Entity={id:'marker',name:'Marker',parentId:null,active:true,components:[
   {id:'shape',type:'pixi.shape',version:1,data:{width:20,height:20,color:'#ff0000',rounded:0}},
  ]};
  const scene=app.game.createScene([{...entity,x:20}],(world,install)=>{
   install({id:'move',fixedUpdate(){world.entities[0].x=Number(world.entities[0].x)+16;},dispose(){document.body.dataset.disposed='true';}});
  },true);
  const node=new Container();
  app.stage.addChild(node);
  const views=new SceneVisualProjection({
   texture:()=>undefined,textures:app.textures,font:()=> 'system-ui',text:value=>value,rtl:()=>false,
   frame:()=>({time:scene.time,token:'demo',silent:true,emit:scene.started}),changed(){},event(){},
  });
  views.build(entity,node,[]);
  app.game.setFramePorts({
   flush(){},eventsPending:()=>false,project(){
    const object:RuntimeEntity=scene.world.entities[0];
    node.position.set(Number(object.x),32);
    views.update(entity);
    document.body.dataset.x=String(node.x);
   },paint:()=>app.render(),
  });
  await app.game.startScene(scene,{prepare:async()=>{},started(){}});
  app.game.step();
  Object.assign(window,{stopEngine:()=>app.game.stop()});
  }
  void boot();
 `);
 const typecheck=spawnSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','game.ts'],{cwd:scratch,stdio:'inherit'});
 if(typecheck.status!==0)throw typecheck.error??Error('Standalone types failed');
 const output=join(scratch,'site');
 await mkdir(output);
 await build({root:scratch,configFile:false,logLevel:'warn',build:{target:'es2022',outDir:output}});
 server=createServer(async(req,res)=>{
  try{
   const pathname=new URL(req.url,'http://localhost').pathname;
   const path=resolve(output,'.'+(pathname==='/'?'/index.html':pathname));
   if(!path.startsWith(output+sep))throw Error('Outside test output');
   res.setHeader('Content-Type',extname(path)==='.html'?'text/html':'text/javascript');
   res.end(await readFile(path));
  }catch{res.statusCode=404;res.end();}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await expect(page.locator('body')).toHaveAttribute('data-x','36');
 const image=await page.locator('canvas').screenshot();
 const sharp=createRequire(join(root,'apps/editor/package.json'))('sharp');
 const pixel=await sharp(image).extract({left:36,top:32,width:1,height:1}).removeAlpha().raw().toBuffer();
 expect([...pixel]).toEqual([255,0,0]);
 await page.evaluate(()=>window.stopEngine());
 await expect(page.locator('body')).toHaveAttribute('data-disposed','true');
 expect(errors).toEqual([]);
 console.log('PASS standalone engine: tarball, declarations, Pixi frame, scene step and disposal without editor packages');
}finally{
 await browser?.close();
 if(server)await new Promise(done=>server.close(done));
 await rm(scratch,{recursive:true,force:true,maxRetries:3});
}
