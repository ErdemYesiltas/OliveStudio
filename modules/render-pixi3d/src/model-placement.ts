import type {AssetRecord} from '@rewrite/assets';
import type {Authoring3D} from './model';
/** Module-owned placement request. A dialog never holds a writable document draft. */
export class ModelPlacement {
 private pending:{asset:AssetRecord;document:Authoring3D['snapshot'];targets:Authoring3D['modelTargets']}|null=null;
 private listeners=new Set<()=>void>();
 private off:()=>void;
 constructor(private editor:Authoring3D,private asset:(id:string)=>AssetRecord|undefined){
  this.off=editor.scene.document.subscribe(()=>{if(this.pending&&this.pending.document!==editor.snapshot)this.cancel();});
 }
 get state(){return this.pending;}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(){for(const listener of this.listeners)listener();}
 place(asset:AssetRecord){
  this.cancel();const parent=this.editor.modelParent();
  if(parent)return this.editor.placeModel(asset,parent);
  this.pending={asset,document:this.editor.snapshot,targets:this.editor.modelTargets};this.publish();
 }
 confirm(parentId:string|null){
  const request=this.pending;if(!request)throw Error('Model placement is no longer open');
  if(request.document!==this.editor.snapshot){this.cancel();throw Error('Scene changed; choose the model again');}
  const asset=this.asset(request.asset.id);if(!asset||asset.revision!==request.asset.revision)throw Error('Model asset changed; choose the model again');
  if(parentId!==null&&!request.targets.some(t=>t.id===parentId))throw Error('Choose a listed 3D view');
  const result=parentId===null?this.editor.placeModelInNewView(asset):this.editor.placeModel(asset,parentId);this.cancel();return result;
 }
 cancel=()=>{if(!this.pending)return;this.pending=null;this.publish();};
 dispose(){this.off();this.cancel();this.listeners.clear();}
}
