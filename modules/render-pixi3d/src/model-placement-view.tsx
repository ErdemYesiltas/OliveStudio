import {useState,useSyncExternalStore} from 'react';
import {Dialog} from 'radix-ui';
import {Box,Plus,X} from 'lucide-react';
import type {ModelPlacement} from './model-placement';
import {authoring3dStrings} from './strings';
export function createModelPlacementView(controller:ModelPlacement,text?:(key:string)=>string){
 const t=text??((key:string)=>authoring3dStrings[key]??key);
 function Choice({request}:{request:NonNullable<ModelPlacement['state']>}){
  const [target,setTarget]=useState(request.targets[0]?.id??''),[error,setError]=useState('');
  return <Dialog.Content className="model-placement-dialog"><Dialog.Title>{t('scene3d.placeTitle')}</Dialog.Title><Dialog.Description>{t('scene3d.placeDescription').replace('{name}',request.asset.name)}</Dialog.Description>
   <form onSubmit={event=>{event.preventDefault();try{controller.confirm(target||null);}catch(e){setError(String(e instanceof Error?e.message:e));}}}>
    <fieldset><legend>{t('scene3d.placeTarget')}</legend>{request.targets.map(view=><label key={view.id}><input type="radio" name="model-target" value={view.id} checked={target===view.id} onChange={()=>setTarget(view.id)}/><Box size={17} aria-hidden="true"/><span>{view.label}</span></label>)}
     <label><input type="radio" name="model-target" value="" checked={target===''} onChange={()=>setTarget('')}/><Plus size={17} aria-hidden="true"/><span>{t('scene3d.placeNewView')}</span></label>
    </fieldset><p className="model-placement-hint">{t('scene3d.placeHint')}</p>{error&&<p role="alert">{error}</p>}
    <footer><button type="button" onClick={controller.cancel}>{t('scene3d.placeCancel')}</button><button type="submit">{t('scene3d.placeConfirm')}</button></footer>
   </form><Dialog.Close className="model-placement-close" aria-label={t('scene3d.placeCancel')}><X size={18}/></Dialog.Close>
  </Dialog.Content>;
 }
 return function ModelPlacementDialog(){const request=useSyncExternalStore(controller.subscribe,()=>controller.state);return <Dialog.Root open={request!==null} onOpenChange={open=>{if(!open)controller.cancel();}}><Dialog.Portal><Dialog.Overlay className="model-placement-overlay"/>{request&&<Choice key={request.asset.id} request={request}/>}</Dialog.Portal></Dialog.Root>;};
}
