import {loadRuntimePlugins} from 'virtual:runtime-profile';
import {GamePlayer,type GameBundle} from '@rewrite/player';
const status=document.querySelector<HTMLElement>('#status')!,button=document.querySelector<HTMLButtonElement>('#start')!,host=document.querySelector<HTMLElement>('#game')!;
let player:GamePlayer|undefined;
// Installable web app builds (Settings → Web app) carry a manifest link: cache the game for offline play. Not inside the Capacitor app shell.
if('serviceWorker' in navigator&&document.querySelector('link[rel="manifest"]')&&/^https?:$/.test(location.protocol)&&!(window as {Capacitor?:unknown}).Capacitor)void navigator.serviceWorker.register('./sw.js').then(()=>{host.dataset.offline='registered';}).catch(e=>{host.dataset.offline='failed';console.warn('Offline cache unavailable',e);});
const fail=(e:unknown)=>{status.textContent=String(e);button.disabled=true;player?.dispose();};
try{const response=await fetch('./project.json');if(!response.ok)throw Error('Project unavailable');const bundle=await response.json()as GameBundle;player=new GamePlayer(host,bundle,fail,await loadRuntimePlugins(bundle.runtimes));await player.init();status.textContent='Ready';button.disabled=false;button.addEventListener('click',async()=>{button.disabled=true;try{await player!.start();button.hidden=true;status.hidden=true;}catch(e){fail(e);}});}catch(e){fail(e);}
window.addEventListener('pagehide',()=>player?.dispose(),{once:true});
