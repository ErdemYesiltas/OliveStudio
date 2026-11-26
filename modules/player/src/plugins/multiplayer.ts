import {networkActions,readMultiplayer,multiplayerSection} from '@rewrite/multiplayer/contracts';
import {InputMapSchema,defaultInputMap,inputSection,type InputSession} from '@rewrite/input';
import {createNetworkScene,gameEndpoint} from '@rewrite/multiplayer-colyseus/client';
import type {PlayerPlugin} from '../plugin';

export default {id:'multiplayer',create(c){
 const project=c.bundle.project,settings=readMultiplayer(project.extensions[multiplayerSection]);
 const map=InputMapSchema.parse(project.extensions[inputSection]??defaultInputMap);
 let network:ReturnType<typeof createNetworkScene>;
 const clear=()=>{network?.dispose();network=undefined;};
 return {
  actions:networkActions(()=>network?((id,event)=>network?.sendEvent(id,event)):undefined),
  systems(scene){
   clear();
   network=createNetworkScene(scene,settings,map,{
    entities:c.entities,pressed:id=>Boolean((c.services.get('input') as InputSession|undefined)?.isPressed(id)),spawn:c.spawnEntity,destroy:c.destroy,emit:c.emit,
    endpoint:gameEndpoint(settings,location),bounds:project.stage??{width:960,height:540},
    name:new URLSearchParams(location.search).get('name')??'Player',
    log:(level,message)=>console[level==='info'?'log':level](`[multiplayer] ${message}`),
   });
   if(!network)return [];
   const session=network;
   let frames=0;
   return [session.system,{id:'multiplayer.status',update:()=>{
    if(c.host&&++frames%6===0)c.host.dataset.multiplayer=JSON.stringify(session.status());
   },dispose(){}}];
  },
  clear,dispose:clear,
 };
}} satisfies PlayerPlugin;
