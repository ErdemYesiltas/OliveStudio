import {useEffect,useRef,useState} from 'react';
import {panels,type EditorModule} from '@rewrite/sdk';
import {initialSnapshot,type Backend} from './contracts';
import type {LabRuntime} from './runtime';
import './lab.css';
import {labText} from './strings';
export {labStrings} from './strings';
export function LabPanel({text=labText}:{text?:(key:string)=>string}){
 const target=useRef<HTMLDivElement>(null),runtime=useRef<LabRuntime|undefined>(undefined);
 const [backend,setBackend]=useState<Backend>('webgl'),[run,setRun]=useState(0),[active,setActive]=useState(false),[state,setState]=useState(initialSnapshot('webgl'));
 const closing=useRef<Promise<void>>(Promise.resolve());
 useEffect(()=>{
  let cancelled=false;let instance:LabRuntime|undefined;
  if(active){setState({...initialSnapshot(backend),phase:'starting'});void(async()=>{
   try{await closing.current;const {LabRuntime}=await import('./runtime');if(cancelled||!target.current)return;
    instance=new LabRuntime(target.current,backend,s=>{if(!cancelled)setState(s);});runtime.current=instance;await instance.start();
   }catch(error){await instance?.dispose().catch(cleanupError=>console.error('3D Lab cleanup',cleanupError));if(!cancelled)setState(s=>({...s,phase:'failed',error:String(error)}));}
  })();}
  return()=>{cancelled=true;runtime.current=undefined;if(instance)closing.current=instance.dispose().catch(error=>console.error('3D Lab cleanup',error));};
 },[active,backend,run]);
 const ready=state.phase==='ready'&&active;
 return <section className="pixi3d-lab" aria-label={text('lab3d.title')}>
  <h2>{text('lab3d.title')} <small>{text('lab3d.experimental')}</small></h2>
  <p>{text('lab3d.help')}</p>
  <div className="pixi3d-controls">
   <label>{text('lab3d.backend')} <select value={backend} onChange={e=>setBackend(e.target.value as Backend)}><option value="webgl">WebGL 2</option><option value="webgpu">WebGPU</option></select></label>
   <button onClick={()=>{setActive(true);setRun(n=>n+1);}}>{text('lab3d.start')}</button>
   <button disabled={!active} onClick={()=>{setActive(false);setState(initialSnapshot(backend));}}>{text('lab3d.stop')}</button>
  </div>
  <div ref={target} className="pixi3d-surface" data-testid="pixi3d-surface"/>
  <div className="pixi3d-controls">
   <button disabled={!ready} onClick={()=>runtime.current?.play()}>{text('lab3d.play')}</button>
   <button disabled={!ready} onClick={()=>runtime.current?.pause()}>{text('lab3d.pause')}</button>
   <button disabled={!ready} onClick={()=>runtime.current?.step()}>{text('lab3d.step')}</button>
   <button disabled={!ready} onClick={()=>runtime.current?.seek(0)}>{text('lab3d.reset')}</button>
   <button disabled={!ready} onClick={()=>runtime.current?.seek(1)}>{text('lab3d.seek')}</button>
   <button disabled={!ready} onClick={()=>runtime.current?.freezeSecond()}>{text('lab3d.freeze')}</button>
   <button disabled={!ready||state.instances<2} onClick={()=>runtime.current?.removeFirst()}>{text('lab3d.remove')}</button>
  </div>
  <p role="status">{state.phase} · {state.selected??'—'} · {state.reason}</p>
  {state.error&&<p role="alert">{state.error}</p>}
  <output data-testid="pixi3d-lab-state">{JSON.stringify(state,null,2)}</output>
 </section>;
}
export function createPixi3dLabModule(text:(key:string)=>string=labText):EditorModule{return{
 manifest:{id:'pixi3d-lab',version:'1.0.0',apiVersion:1},
 activate(c){const View=()=> <LabPanel text={text}/>;c.contribute(panels,'pixi3d-lab.preview',{titleKey:'lab3d.title',icon:'box',view:View,preferredWidth:760,preferredHeight:760,defaultDock:'right'});}
};}
