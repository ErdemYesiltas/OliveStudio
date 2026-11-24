import './diagnostics';
import {loadRuntimePlugins} from 'virtual:runtime-profile';
import {GamePlayer,type GameBundle} from '@rewrite/player';
const status=document.querySelector<HTMLElement>('#status')!,button=document.querySelector<HTMLButtonElement>('#start')!,host=document.querySelector<HTMLElement>('#game')!;
let player:GamePlayer|undefined;let failed=false;
// Installable web app builds (Settings → Web app) carry a manifest link: cache the game for offline play. Not inside the Capacitor app shell.
if('serviceWorker' in navigator&&document.querySelector('link[rel="manifest"]')&&/^https?:$/.test(location.protocol)&&!(window as {Capacitor?:unknown}).Capacitor)void navigator.serviceWorker.register('./sw.js').then(()=>{host.dataset.offline='registered';}).catch(e=>{host.dataset.offline='failed';console.warn('Offline cache unavailable',e);});
const fail=(e:unknown)=>{if(closed)return;failed=true;host.dataset.startupPhase='failed';status.setAttribute('role','alert');status.hidden=false;status.textContent=String(e);button.disabled=true;player?.dispose();};
// The entry must finish synchronous ESM evaluation before Pixi lazily imports parsers.
// Rollup can place shared parser helpers in this entry: top-level await would then
// make parser -> entry -> await parser a cold-load deadlock.
const lifetime=new AbortController();let closed=false;
window.addEventListener('pagehide',()=>{closed=true;lifetime.abort();player?.dispose();},{once:true});
const phase=(name:string,message:string)=>{if(closed)return;host.dataset.startupPhase=name;status.textContent=message;};
async function boot(){try{
 phase('project','Loading project…');const response=await fetch('./project.json',{signal:lifetime.signal});if(!response.ok)throw Error('Project unavailable');const bundle=await response.json() as GameBundle;if(closed)return;
 phase('plugins','Loading runtime…');const plugins=await loadRuntimePlugins(bundle.runtimes);if(closed)return;
 phase('initialize','Preparing scene…');player=new GamePlayer(host,bundle,fail,plugins,message=>{if(closed)return;status.textContent=message;status.hidden=false;status.setAttribute('role','status');});await player.init();if(closed||failed)return;
 phase('ready','Ready');button.disabled=false;button.addEventListener('click',async()=>{if(closed)return;button.disabled=true;try{phase('start','Starting scene…');await player!.start();if(closed||failed)return;host.dataset.startupPhase='running';button.hidden=true;status.hidden=true;}catch(e){if(!closed)fail(e);}});
}catch(e){if(!closed)fail(e);}}
// Intentionally fire without await so dependent dynamic chunks can evaluate.
void boot();
