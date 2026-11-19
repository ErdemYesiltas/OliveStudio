import { gsap } from 'gsap';
import { animate } from 'motion';
import { Howl } from 'howler';
import { SceneViewport } from '@rewrite/render-pixi';
import { blankScene,makeEntity } from '@rewrite/scene';
const output=document.getElementById('result')!;
const assert=(ok:boolean,message:string)=>{if(!ok)throw Error(message);};
const close=(value:number,expected:number)=>assert(Math.abs(value-expected)<.05,`Expected ${expected}, got ${value}`);
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
function wav():string {
 const samples=22050,bytes=new Uint8Array(44+samples*2),view=new DataView(bytes.buffer);
 const text=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)bytes[offset+i]=value.charCodeAt(i);};
 text(0,'RIFF');view.setUint32(4,bytes.length-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,22050,true);view.setUint32(28,44100,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples*2,true);
 for(let i=0;i<samples;i++)view.setInt16(44+i*2,Math.sin(i*440*2*Math.PI/22050)*4000,true);
 return URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
}
let dispose:(()=>void)|undefined;
document.getElementById('run')!.addEventListener('click',()=>{void (async()=>{
 dispose?.();output.dataset.status='running';const log:Record<string,unknown>={};
 const voices:Howl[]=[],url=wav();let viewport:SceneViewport|undefined;
 dispose=()=>{for(const voice of voices)voice.unload();URL.revokeObjectURL(url);viewport?.dispose();};
 try{
  const model={x:0},timeline=gsap.timeline({paused:true}).to(model,{x:60,duration:1,ease:'none',lazy:false});gsap.ticker.sleep();
  timeline.totalTime(.5);close(model.x,30);timeline.totalTime(.25);close(model.x,15);log.gsap={half:30,quarter:model.x};timeline.kill();
  const motionModel={x:0},control=animate(motionModel,{x:60},{duration:1,ease:'linear',autoplay:false});
  control.pause();control.time=.5;await frame();close(motionModel.x,30);control.time=.25;await frame();close(motionModel.x,15);log.motion={half:30,quarter:motionModel.x};control.stop();
  const host=document.createElement('div');host.style.cssText='height:300px;position:relative';document.body.appendChild(host);
  viewport=new SceneViewport(host,{select(){},commitTransform(){},playing:()=>false});await viewport.init();const scene=blankScene(),entity=makeEntity('GPU shape');entity.components.push({id:'shape',type:'pixi.shape',version:1,data:{width:100,height:100,color:'#7caef5',rounded:10}});scene.entities.push(entity);viewport.sync(scene,null);log.pixi={canvas:host.querySelectorAll('canvas').length,ready:host.dataset.ready};
  const load=()=>new Promise<Howl>((resolve,reject)=>{const voice=new Howl({src:[url],format:['wav'],preload:false,loop:true,volume:.15});voices.push(voice);voice.once('load',()=>resolve(voice));voice.once('loaderror',(_id,e)=>reject(Error(String(e))));voice.load();});
  const [a,b]=await Promise.all([load(),load()]);const first=a.play(),second=b.play();await frame();assert(a.playing(first)&&b.playing(second),'Both sources must play');
  a.pause(first);assert(!a.playing(first)&&b.playing(second),'Pause must be source-owned');assert(a.play(first)===first,'Resume must retain ID');a.stop(first);assert(b.playing(second),'Stop must not stop another source');
  log.howler={sameIdResume:true,independentSources:true};b.stop();output.textContent=JSON.stringify(log,null,2);output.dataset.status='passed';
 }catch(error){output.textContent=String(error);output.dataset.status='failed';}finally{dispose?.();dispose=undefined;}
})();});
window.addEventListener('pagehide',()=>dispose?.());
