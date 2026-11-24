// Optional QA runtime contribution. Uses public runtime services, never private player/Pixi handles.
import type {PlayerPlugin} from '@rewrite/player/plugin';
import type {ModelAnimationControls} from '@rewrite/render-pixi3d/animation-contracts';
interface Probe{models:{name:string;entityId:string;componentId:string;duration:number;speed:number;loop:boolean}[];times:number[];sourceHash:string;rooms?:{id:string;entities:string[]}}
export default {id:'qa.pose-probe',create(c){
 const config=c.bundle.project.extensions['qa.pose-probe'] as unknown as Probe,panel=document.createElement('section'),button=document.createElement('button'),out=document.createElement('pre');
 panel.setAttribute('aria-label','Runtime pose verification');panel.style.cssText='position:fixed;z-index:1000;left:12px;top:12px;max-width:520px;max-height:75vh;overflow:auto;background:#19212be8;color:#e7edf6;border:1px solid #627080;border-radius:10px;padding:12px;font:12px system-ui';
 button.textContent='Sample all model poses';button.disabled=true;out.id='pose-probe-output';out.textContent='Start the game first';out.style.cssText='max-height:40vh;overflow:auto;font:11px monospace;white-space:pre-wrap';panel.append(button,out);c.host!.append(panel);
 button.onclick=()=>{try{c.simulation.pause();const service=c.services.get('animation3d') as ModelAnimationControls|undefined,inspect=c.inspectors.get('pixi3d.models');if(!service||!inspect)throw Error('3D runtime inspection is unavailable');const samples=config.times.map(at=>({at,models:config.models.map(m=>{const clipTime=m.loop&&m.duration>0?(at*m.speed)%m.duration:Math.min(m.duration,at*m.speed);service.control(m.componentId,'seek',clipTime);return{name:m.name,entityId:m.entityId,componentId:m.componentId,clipTime,pose:inspect({entityId:m.entityId,limit:64})};})}));c.changed();out.textContent=JSON.stringify({sourceHash:config.sourceHash,paused:c.simulation.paused,samples},null,2);panel.dataset.state='complete';}catch(error){out.textContent=String(error);panel.dataset.state='failed';}};
 const roomOut=document.createElement('pre');roomOut.id='room-probe-output';roomOut.style.cssText='max-height:25vh;overflow:auto;font:11px monospace';const roomButtons:HTMLButtonElement[]=[];let candidateRoom=false,holdRoom=false,failRoom=false,releaseRoom:(()=>void)|undefined;const starts:string[]=[],spawned:string[][]=[];
 const writeRooms=()=>{roomOut.textContent=JSON.stringify({time:c.simulation.time,paused:c.simulation.paused,held:holdRoom,objects:c.entities().map(e=>e.id),starts,spawned},null,2);};
 if(config.rooms){const row=document.createElement('div');row.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin-top:8px';panel.append(row,roomOut);const add=(name:string,run:()=>void)=>{const b=document.createElement('button');b.textContent=name;b.disabled=true;b.onclick=()=>{try{run();writeRooms();}catch(error){roomOut.textContent=String(error);}};row.append(b);roomButtons.push(b);};
  add('Load second room (delayed)',()=>{holdRoom=true;c.addScene(config.rooms!.id);});
  add('Inspect room loading',writeRooms);
  add('Release room resources',()=>{holdRoom=false;releaseRoom?.();releaseRoom=undefined;});
  add('Remove second room',()=>{c.removeScene(config.rooms!.id);holdRoom=false;releaseRoom?.();releaseRoom=undefined;});
  add('Fail second room load',()=>{failRoom=true;c.addScene(config.rooms!.id);});
 }
 c.signal.addEventListener('abort',()=>releaseRoom?.(),{once:true});
 return{
  decorate(entities){candidateRoom=Boolean(config.rooms&&entities.some(e=>config.rooms!.entities.includes(e.id)));},
  async ready(){if(!candidateRoom)return;if(failRoom){failRoom=false;throw Error('QA: second room resource failure');}if(holdRoom){writeRooms();await new Promise<void>(resolve=>{releaseRoom=resolve;});}},
  interaction(event){if(event.type==='scene.start'){starts.push(event.sourceId);writeRooms();}},
  systems:()=>[{id:'qa.pose-probe',start(){button.disabled=false;for(const b of roomButtons)b.disabled=false;},spawned(ids){spawned.push([...ids]);writeRooms();},dispose(){button.disabled=true;for(const b of roomButtons)b.disabled=true;}}],
  clear(){holdRoom=false;candidateRoom=false;releaseRoom?.();releaseRoom=undefined;button.disabled=true;out.textContent='Preparing scene…';delete panel.dataset.state;},dispose(){releaseRoom?.();panel.remove();}
 };

}} satisfies PlayerPlugin;
