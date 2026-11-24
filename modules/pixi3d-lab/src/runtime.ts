// This module is lazy-loaded before this lab's Application.init, never injected
// into the already running editor viewport's renderer.
import 'pixi.js/unsafe-eval';
import {installCspUniformCompatibility} from './csp';
import {View3D,Mesh3D,CubeGeometry,Material3D,DirectionalLight,AmbientLight,Model3D,type Scene3DSource} from '@pixi/3d';
import {Application,Assets,Graphics,Text,RendererType} from 'pixi.js';
import {RuntimeSession} from '@rewrite/runtime';
import {destroyLocalApplication} from '@rewrite/render-pixi/lifecycle';
import {SimulationTicker} from './clock';
import {probeBackend,initialSnapshot,type Backend,type LabSnapshot} from './contracts';
import {SharedResource} from './resources';
import modelUrl from './fixtures/animated-cube.glb?url';
const sourcePool=new SharedResource(()=>Assets.load<Scene3DSource>(modelUrl),()=>Assets.unload(modelUrl));
export class LabRuntime{
 private app=new Application();private ready=false;private pending?:Promise<void>;private dead=false;private raf=0;private observer?:ResizeObserver;private last=0;private publishAt=0;private lease?:Awaited<ReturnType<typeof sourcePool.acquire>>;private models:Model3D[]=[];private view?:View3D;private geometry?:CubeGeometry;private material?:Material3D;private cube?:Mesh3D;private clock?:SimulationTicker;private session?:RuntimeSession;private state:LabSnapshot;private hud?:Text;private cleanup?:Promise<void>;
 constructor(private target:HTMLElement,requested:Backend,private publish:(snapshot:LabSnapshot)=>void){this.state=initialSnapshot(requested);}
 snapshot(){const [a,b]=this.models;return{...this.state,time:this.session?.time??0,frame:this.session?.frame??0,paused:this.session?.paused??true,modelTime:a?.player?.getState('Bob').time??0,modelY:a?.getChildByLabel('Bob',true)?.y??0,otherModelTime:b?.player?.getState('Bob').time??0,otherModelY:b?.getChildByLabel('Bob',true)?.y??0,instances:this.models.length,autoUpdate:a?.player?.autoUpdate??false,sourceShared:this.models.length===2&&a.source===b.source};}
 private changed(){if(!this.dead)this.publish(this.snapshot());}
 start(){if(this.pending)throw Error('Lab already started');this.pending=this.init();return this.pending;}
 private async init(){this.state.phase='starting';this.changed();const choice=await probeBackend(this.state.requested);if(this.dead)return;Object.assign(this.state,{selected:choice.selected,reason:choice.reason});await this.app.init({width:640,height:360,preference:choice.selected,autoStart:false,background:'#18251f',antialias:true,resolution:Math.min(devicePixelRatio,2)});this.ready=true;if(this.dead)return;installCspUniformCompatibility(this.app.renderer);this.state.selected=this.app.renderer.type===RendererType.WEBGPU?'webgpu':'webgl';const gl=this.state.selected==='webgl'?this.app.canvas.getContext('webgl2'):null;this.state.webgl2=Boolean(gl);this.state.floatTargets=Boolean(gl?.getExtension('EXT_color_buffer_float'));this.target.appendChild(this.app.canvas);
  this.view=new View3D({autoResize:true});this.app.stage.addChild(this.view);this.view.camera.position.set(4,3,7);this.view.camera.lookAt({x:0,y:.5,z:0});const sun=new DirectionalLight({intensity:3});sun.position.set(3,5,4);this.view.root.addChild(sun,new AmbientLight({intensity:.5}));sun.lookAt({x:0,y:0,z:0});this.geometry=new CubeGeometry();this.material=new Material3D({baseColor:0xffc678,roughness:.5});this.cube=new Mesh3D({geometry:this.geometry,material:this.material});this.cube.position.set(0,.2,-1.8);this.view.root.addChild(this.cube);
  this.hud=new Text({text:'2D HUD · click here',style:{fontSize:17,fill:'#ffffff'}});this.hud.position.set(16,14);this.hud.eventMode='static';this.hud.cursor='pointer';this.hud.on('pointertap',()=>{this.state.hudClicks++;this.hud!.text='2D HUD clicks: '+this.state.hudClicks;this.changed();});const hudBackground=new Graphics().roundRect(8,6,250,40,10).fill({color:0x131b16,alpha:.9});this.app.stage.addChild(hudBackground,this.hud);
  this.lease=await sourcePool.acquire();if(this.dead)return;for(const x of [-1.5,1.5]){const model=new Model3D({source:this.lease.value,autoUpdate:false});model.position.set(x,0,0);this.view.root.addChild(model);this.models.push(model);}this.reset();this.state.phase='ready';this.observer=new ResizeObserver(()=>{if(this.dead||!this.ready)return;const {width}=this.target.getBoundingClientRect();this.app.renderer.resize(Math.max(200,Math.floor(width)),360);this.draw();});this.observer.observe(this.target);this.draw();this.changed();this.last=performance.now();this.raf=requestAnimationFrame(this.tick);
 }
 private reset(){this.session?.dispose();this.clock?.dispose();this.clock=new SimulationTicker();for(const model of this.models){model.player!.stop();model.player!.getState('Bob').gotoAndStop(0);model.player!.play('Bob');}this.session=new RuntimeSession([],()=>[{id:'lab.animation',fixedUpdate:dt=>{this.clock!.advance(dt);for(const model of this.models)model.player?.update(this.clock!.ticker);if(this.cube)this.cube.rotation.y+=dt*.6;},dispose(){}}],{paused:true});if(this.cube)this.cube.rotation.y=0;}
 private draw(){if(!this.dead&&this.ready){this.app.render();this.state.renders++;}}
 private tick=(now:number)=>{if(this.dead)return;try{const dt=(now-this.last)/1000;this.last=now;this.session?.advance(dt);this.draw();if(now-this.publishAt>100){this.publishAt=now;this.changed();}this.raf=requestAnimationFrame(this.tick);}catch(error){this.state.phase='failed';this.state.error=String(error);this.changed();}};
 play(){if(this.state.phase!=='ready')return;this.session!.resume();this.last=performance.now();this.changed();}
 pause(){this.session?.pause();this.changed();}
 step(){this.session?.pause();this.session?.step();this.draw();this.changed();}
 seek(seconds:number){if(!Number.isFinite(seconds)||seconds<0||seconds>10)throw Error('Seek must be 0–10 seconds');this.reset();for(let i=0;i<Math.round(seconds*60);i++)this.session!.step();this.draw();this.changed();}
 freezeSecond(){this.models[1]?.player?.getState('Bob').gotoAndStop(.5);this.draw();this.changed();}
 removeFirst(){const model=this.models.shift();model?.destroy({children:true});this.draw();this.changed();}
 dispose(){if(this.cleanup)return this.cleanup;this.dead=true;cancelAnimationFrame(this.raf);this.observer?.disconnect();this.cleanup=(async()=>{await this.pending?.catch(()=>{});this.session?.dispose();this.clock?.dispose();this.models=[];if(this.ready)destroyLocalApplication(this.app);this.geometry?.destroy();this.material?.destroy();await this.lease?.release();})();return this.cleanup;}
}
