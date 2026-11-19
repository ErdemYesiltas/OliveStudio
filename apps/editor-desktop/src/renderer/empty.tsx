import { useEffect,useState } from 'react';
import { ModuleHost } from '@rewrite/kernel';
import { Shell } from './Shell';
export default function Empty(){const [host,setHost]=useState<ModuleHost|null>(null);useEffect(()=>{const h=new ModuleHost();let cancelled=false;void h.start([]).then(()=>{if(cancelled)void h.stop();else setHost(h);});return()=>{cancelled=true;if(h.states.size)void h.stop();};},[]);return host?<Shell host={host}/>:null;}
