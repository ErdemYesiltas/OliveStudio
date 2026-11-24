import {EditorCameraMemory,EditorCameraCommandSchema,EditorViewQuerySchema,DebugPanelsSchema,EditorPickSchema,EditorHandleDragSchema,frameNode} from './editor-camera';
import {shaderValidator} from './shader3d-validator';
import type {ScriptGeometry} from './mesh3d';
import {RuntimeSession} from '@rewrite/runtime';
import {ModelAnimations,type ModelAnimationState} from './animation';
import type {ModelAnimationAction} from './animation-contracts';
import {runtime3DProblems} from './preflight';
import {Scene3DProjection,applyPose3D as apply,visible3D as available,type ProjectedView3D} from './projection';
import type {ModelAssetPort} from './model-resources';
import {Camera3D,PointLight,SpotLight,Mesh3D,Container3D,type View3D} from '@pixi/3d';
import {OrbitCamera,GraphDebugOverlay,GeometryThumbnailGenerator} from '@pixi/3d/extras';
import {Graphics,Text} from 'pixi.js';
import type {Scene} from '@rewrite/scene';
import {transform3D,type Transform3D} from '@rewrite/scene3d';
import type {ViewportFeatureContext,ViewportFeatureHandle} from '@rewrite/render-pixi/viewport-features';
import {axisDelta,axisPose,type Axis,type Mode} from './math';
import {Light3DSchema,Camera3DSchema} from './contracts';
import {lightGizmo,cameraGizmo,pickLightIcon,lightHandles,dragHandle,handleReach,type GizmoHandle} from './light-gizmos';
type Point={x:number;y:number};
type Slot=ProjectedView3D&{editorCamera:Camera3D;orbit:OrbitCamera;overlay:Graphics;labels:Text[]};
type Handle={axis:Axis;from:Point;to:Point;projected:Point};
const distance=(p:Point,a:Point,b:Point)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
export interface ModelAnimationPreview{control(id:string,action:ModelAnimationAction,time?:number):unknown;state(id:string):ModelAnimationState|undefined;subscribe(fn:()=>void):()=>void;snapshot():number;states():Record<string,ModelAnimationState|undefined>;inspectModel(query:unknown):ReturnType<Scene3DProjection['inspectModel']>;inspectMaterials(query:unknown):ReturnType<Scene3DProjection['inspectMaterials']>;inspectDeformation(query:unknown):ReturnType<Scene3DProjection['inspectDeformation']>}
export interface Authoring3DHandle extends ViewportFeatureHandle{animation:ModelAnimationPreview;viewState(input?:unknown):unknown;debugPanels(input:unknown):unknown;cameraControl(input:unknown):unknown;pick(input:unknown):unknown;dragHandle(input:unknown):unknown}
/** Commits one component edit (undoable) for gizmo drags; `expected` is the data the drag began from. */
export type CommitComponent=(entityId:string,type:string,data:Record<string,unknown>,expected:unknown)=>void;
export function createAuthoringViewport(ctx:ViewportFeatureContext,assets?:ModelAssetPort,commitComponent?:CommitComponent,shaders?:()=>unknown):Authoring3DHandle{
 let source:Scene|undefined,selected:string|null=null,mode:Mode='move',playing=false,slots:Slot[]=[],handles:Handle[]=[],dead=false;
 const projection=new Scene3DProjection({resync:()=>{if(source&&!dead){sync(source,selected);ctx.render();}},shaderLibrary:shaders as never,shaderValidator:shaderValidator(),warn:message=>ctx.report(Error(message)),renderer:ctx.app.renderer,node:ctx.node,flags:id=>playing?{hidden:false,locked:false}:ctx.flags(id),changed:ctx.render,report:ctx.report,beforeClear:clearEditor,
  // Called from pointer events (render now) and from the frame itself (attach holds): a render from inside a frame would recurse.
  moved:(id,p)=>{if(!playing)return;const transform=ctx.runtimeEntities?.()?.find(e=>e.id===id)?.components.find(c=>c.type==='scene3d.transform');if(transform)Object.assign(transform.data as object,p);if(!framing)ctx.render();},
  emit:(type,sourceId)=>{if(playing)ctx.runtimeEvent?.({type,sourceId,silent:false});}},assets);
 const animations=new ModelAnimations(id=>slots.flatMap(s=>[s.models.get(id)?.instance?.player]).find(Boolean),id=>assets?.get(id),(id,silent)=>ctx.runtimeEvent?.({type:'animation3d.complete',sourceId:id,silent}));
 const listeners=new Set<()=>void>();let version=0,published=0;
 const publish=(force=false)=>{if(force||performance.now()-published>100){published=performance.now();version++;for(const listener of listeners)listener();}};
 const previewClock=new RuntimeSession([],()=>[{id:'animation3d.preview',update:()=>animations.advanceTo(previewClock.time,true),dispose(){}}],{paused:true});
 const previewTick=(tick:{deltaMS:number})=>{if(dead||playing||previewClock.paused||!ctx.editable())return;previewClock.advance(tick.deltaMS/1000);if(!Object.values(animations.diagnostics).some(s=>s?.playing))previewClock.pause();ctx.render();publish();};ctx.app.ticker.add(previewTick);
 const animation:ModelAnimationPreview={inspectDeformation:query=>projection.inspectDeformation(query),inspectMaterials:query=>projection.inspectMaterials(query),inspectModel:query=>projection.inspectModel(query),states:()=>animations.diagnostics,subscribe:fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},snapshot:()=>version,state:id=>animations.state(id),control(id,action,time){if(!source)throw Error('Scene is not ready');animations.sync(playing?(ctx.runtimeEntities?.()??source.entities):source.entities,playing,playing);const result=animations.control(id,action,time);if(!playing){if(action==='play'||action==='resume')previewClock.resume();else if(!Object.values(animations.diagnostics).some(s=>s?.playing))previewClock.pause();}ctx.render();publish(true);return result;}};
 const saved=new EditorCameraMemory();
 let gesture:{pointer:number;slot:Slot;start:Point;last:Point;kind:'orbit'|'pan'|'pick'|'axis'|'gizmo';axis?:Axis;id?:string;pose?:Transform3D;next?:Transform3D;parentId?:string|null;projected?:Point;handle?:{key:GizmoHandle['key'];anchor:Point;at:Point;data:Record<string,unknown>;value:number;length:number;next:number}}|undefined;
 /** Screen handles of the selected light, rebuilt with every overlay draw. */
 let lightHandleHits:{slot:string;id:string;key:GizmoHandle['key'];anchor:Point;at:Point}[]=[];
 const toolbar=document.createElement('div');toolbar.className='spatial3d-tools';toolbar.hidden=true;toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','3D tools');ctx.host.append(toolbar);
 const selectedSlot=()=>slots.find(s=>s.id===selected||s.nodes.has(selected??''));
 const button=(label:string,click:()=>void)=>{const b=document.createElement('button');b.textContent=ctx.text(label);b.type='button';b.onclick=()=>{try{click();ctx.render();}catch(e){ctx.report(e);}};toolbar.append(b);return b;};
 const modes=(['move','rotate','scale'] as Mode[]).map(m=>button('scene3d.'+m,()=>{mode=m;frame();}));
 button('scene3d.resetView',()=>{const s=selectedSlot();if(s)cameraControl({viewId:s.id,action:'reset'});});
 button('scene3d.frameSelected',()=>{const s=selectedSlot();if(s)cameraControl({viewId:s.id,action:'frame',entityId:selected});});
 const cameraButton=button('scene3d.sceneCamera',()=>{const s=selectedSlot();if(!s)return;const camera=s.cameraId?s.cameras.get(s.cameraId):undefined;if(s.view.camera!==s.editorCamera){s.view.camera=s.editorCamera;return;}if(!(camera instanceof Camera3D)||!available(camera))throw Error('Assign an active camera inside this 3D view');s.view.camera=camera;});
 const help=document.createElement('span');help.className='spatial3d-help';help.textContent=ctx.text('scene3d.help');toolbar.append(help);
 // Developer panels for the selected view: the render graph recorder and previews of the geometry it draws. Editor only.
 let graphOverlay:GraphDebugOverlay|undefined,geometryPanel:HTMLElement|undefined;const thumbnails=new GeometryThumbnailGenerator({size:96});
 const graphButton=button('scene3d.renderGraph',()=>debugPanels({graph:!graphOverlay})),geometryButton=button('scene3d.geometryPanel',()=>debugPanels({geometry:!geometryPanel}));
 function fillGeometry(){if(!geometryPanel)return{count:0,unsupported:0};geometryPanel.replaceChildren();const s=selectedSlot()??slots[0],seen=new Set<number>();let unsupported=0;
  s?.view.root.traverse(n=>{if(!(n instanceof Mesh3D)||seen.has(n.geometry.uid))return;seen.add(n.geometry.uid);const r=thumbnails.getThumbnail(n.geometry),cell=document.createElement('figure'),label=document.createElement('figcaption');
   let owner:Container3D|null=n;while(owner&&s.nodes.get(owner.label??'')!==owner)owner=owner.parent as Container3D|null;label.textContent=`${(owner&&source?.entities.find(e=>e.id===owner!.label)?.name)??'mesh'} · ${n.geometry.vertexCount} v`;
   if(r.status==='ready')cell.append(r.canvas);else{unsupported++;const why=document.createElement('span');why.textContent=r.reason;cell.append(why);}cell.append(label);geometryPanel!.append(cell);});
  return{count:seen.size,unsupported};}
 function debugPanels(input:unknown){const want=DebugPanelsSchema.parse(input);
  if(want.graph!==undefined&&want.graph!==Boolean(graphOverlay)){if(graphOverlay){graphOverlay.destroy();graphOverlay=undefined;}else graphOverlay=new GraphDebugOverlay({view:()=>(selectedSlot()??slots[0])?.view as View3D,parent:ctx.host,renderer:ctx.app.renderer as never});}
  if(want.geometry!==undefined&&want.geometry!==Boolean(geometryPanel)){if(geometryPanel){geometryPanel.remove();geometryPanel=undefined;}else{geometryPanel=document.createElement('div');geometryPanel.className='spatial3d-geometry';geometryPanel.setAttribute('aria-label',ctx.text('scene3d.geometryPanel'));ctx.host.append(geometryPanel);}}
  const geometry=fillGeometry();graphButton.setAttribute('aria-pressed',String(Boolean(graphOverlay)));geometryButton.setAttribute('aria-pressed',String(Boolean(geometryPanel)));
  return{graph:Boolean(graphOverlay),geometry:geometryPanel?geometry:false};}
 const point=(e:PointerEvent|WheelEvent):Point=>{const r=ctx.app.canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*ctx.app.screen.width/r.width,y:(e.clientY-r.top)*ctx.app.screen.height/r.height};};
 const at=(p:Point)=>[...slots].reverse().find(s=>{if(!s.host.visible)return false;const l=s.view.toLocal(p);return l.x>=0&&l.y>=0&&l.x<s.view.width&&l.y<s.view.height;});
 const consume=(e:Event)=>{e.preventDefault();e.stopImmediatePropagation();};
 function cancel(){if(gesture?.pose&&gesture.id){const node=gesture.slot.nodes.get(gesture.id);if(node)apply(node,gesture.pose);}if(gesture?.handle&&gesture.id)liveLight(gesture.slot,gesture.id,gesture.handle.key,gesture.handle.value);gesture=undefined;}
 /** Starts a gizmo drag when `p` (app-screen) is on a handle of the selected light in `s`. */
 function grabHandle(s:Slot,p:Point,pointer:number){const grip=commitComponent?lightHandleHits.find(h=>h.slot===s.id&&Math.hypot(p.x-h.at.x,p.y-h.at.y)<9):undefined;if(!grip)return false;
  const data=source?.entities.find(x=>x.id===grip.id)?.components.find(c=>c.type==='pixi3d.light')?.data as Record<string,unknown>|undefined;if(!data)return false;const parsed=Light3DSchema.parse(data),value=grip.key==='range'?parsed.range:parsed.coneAngle,length=handleReach(parsed);
  gesture={pointer,slot:s,start:p,last:p,kind:'gizmo',id:grip.id,handle:{key:grip.key,anchor:grip.anchor,at:grip.at,data,value,length,next:value}};return true;}
 function dragTo(g:NonNullable<typeof gesture>,p:Point){if(!g.handle||!g.id)return;g.handle.next=dragHandle(g.handle.key,{value:g.handle.value,length:g.handle.length},g.handle.anchor,g.handle.at,p);liveLight(g.slot,g.id,g.handle.key,g.handle.next);}
 function releaseHandle(g:NonNullable<typeof gesture>){if(g.handle&&g.id&&g.handle.next!==g.handle.value)commitComponent!(g.id,'pixi3d.light',{...g.handle.data,[g.handle.key]:g.handle.next},g.handle.data);}
 /** The pointer path for automation: grab the selected light's handle, drag it to view-local (x,y), release (one undo). */
 function dragHandleTool(input:unknown){const q=EditorHandleDragSchema.parse(input),s=slots.find(v=>v.id===q.viewId);if(!s)throw Error('3D view is not in the editor');if(playing)throw Error('Dragging needs edit mode');
  const h=lightHandleHits.find(x=>x.slot===s.id&&x.key===q.key);if(!h)throw Error(`The selected light has no ${q.key} handle in this view`);
  if(!grabHandle(s,h.at,-1))throw Error('The handle could not be grabbed');const g=gesture!;gesture=undefined;try{dragTo(g,s.view.toGlobal({x:q.x,y:q.y}));releaseHandle(g);}catch(error){if(g.handle&&g.id)liveLight(g.slot,g.id,g.handle.key,g.handle.value);throw error;}
  ctx.render();return{id:g.id,key:q.key,from:g.handle!.value,to:g.handle!.next,committed:g.handle!.next!==g.handle!.value,handle:s.view.toLocal(h.at)};}
 /** Previews a gizmo drag on the projected light itself; the document changes only on release. */
 function liveLight(s:Slot,id:string,key:GizmoHandle['key'],value:number){const light=s.nodes.get(id)?.children.find(c=>c instanceof PointLight||c instanceof SpotLight) as PointLight|SpotLight|undefined;if(!light)return;if(key==='range')light.range=value;else if(light instanceof SpotLight)light.coneAngle=value;}
 function clearEditor(){cancel();for(const s of slots){if(!playing)saved.set(s.id,{position:{x:s.editorCamera.x,y:s.editorCamera.y,z:s.editorCamera.z},target:{x:s.orbit.target.x,y:s.orbit.target.y,z:s.orbit.target.z},zoom:s.editorCamera.zoom,sceneCamera:s.view.camera!==s.editorCamera});s.orbit.destroy();const clip=s.overlay.mask;s.overlay.destroy();if(clip instanceof Graphics)clip.destroy();for(const label of s.labels)label.destroy();}slots=[];handles=[];toolbar.hidden=true;}
 function clear(){projection.clear();source=undefined;}
 function sync(scene:Scene,id:string|null){if(!playing&&source?.id!==scene.id){previewClock.pause();animations.clear();animations.rebase(previewClock.time);}if(source!==scene||selected!==id)cancel();selected=id;source=scene;
  if(projection.sync(scene)){slots=projection.slots.map(slot=>{const old=saved.get(slot.id),editorCamera=slot.defaultCamera;editorCamera.position.set(old?.position.x??4,old?.position.y??3,old?.position.z??7);editorCamera.zoom=old?.zoom??1;editorCamera.lookAt(old?.target??{x:0,y:0,z:0});const orbit=new OrbitCamera({view:slot.view,enabled:false,autoUpdate:false,enableDamping:false,target:old?.target}),overlay=new Graphics(),bounds=slot.view.getLocalBounds(),clip=new Graphics().rect(slot.view.x+bounds.x,slot.view.y+bounds.y,bounds.width,bounds.height).fill(0xffffff);overlay.eventMode='none';clip.eventMode='none';slot.host.addChild(clip,overlay);overlay.mask=clip;const labels=[0,1,2].map(()=>{const label=new Text({text:'',style:{fontSize:12}});label.eventMode='none';slot.host.addChild(label);return label;});const camera=slot.cameraId?slot.cameras.get(slot.cameraId):undefined;if(old?.sceneCamera&&camera&&available(camera))slot.view.camera=camera;return Object.assign(slot,{editorCamera,orbit,overlay,labels});});}
  if(geometryPanel)fillGeometry();
  if(playing){projection.useSceneCameras();for(const s of slots)s.view.eventMode='static';}frame();
 }
 function viewState(input:unknown={}){const query=EditorViewQuerySchema.parse(input),views=slots.filter(s=>!query.viewId||s.id===query.viewId);return{playing,rendersPerFrame,totalViews:views.length,resources:projection.diagnostics().resources,sharedResources:projection.diagnostics().sharedResources,rebuilds:projection.diagnostics().rebuilds,highlights:projection.diagnostics().views.flatMap(v=>v.highlights),views:views.slice(0,16).map(s=>({id:s.id,camera:s.view.camera===s.editorCamera?'editor':'scene',position:{x:s.editorCamera.x,y:s.editorCamera.y,z:s.editorCamera.z},target:{x:s.orbit.target.x,y:s.orbit.target.y,z:s.orbit.target.z},zoom:s.editorCamera.zoom,mode:s.editorCamera.mode,models:[...s.models].slice(0,64).map(([id,m])=>({id,ready:m.ready,error:m.error??null})),gizmos:(gizmoStats.get(s.id)??[]).slice(0,32),totalNodes:s.nodes.size,nodesTruncated:s.nodes.size>64,nodes:[...s.nodes].slice(0,64).map(([id,n])=>({id,visible:n.visible,interactive:n.eventMode!=='none'}))}))};}
 function cameraControl(input:unknown){
  if(playing||!ctx.editable())throw Error('Stop Preview before changing the editor camera');
  const command=EditorCameraCommandSchema.parse(input),s=slots.find(s=>s.id===command.viewId);if(!s)throw Error('3D view is missing');
  if(command.action==='scene'){const camera=s.cameraId?s.cameras.get(s.cameraId):undefined;if(!camera||!available(camera))throw Error('Assign an active camera inside this 3D view');s.view.camera=camera;}
  else if(command.action==='editor')s.view.camera=s.editorCamera;
  else{
   const targetId=command.action==='frame'?(command.entityId??selected):selected, node=command.action==='frame'?(targetId===s.id?s.view.root:s.nodes.get(targetId??'')):undefined;
   if(command.action==='frame'&&!node)throw Error('Select a 3D object in this view to frame');
   if(node)for(const [id,model]of s.models){for(let n:import('@pixi/3d').Container3D|null=s.nodes.get(id)??null;n;n=n.parent)if(n===node&&!model.ready)throw Error('Wait for model loading before framing');}
   const next=command.action==='set'?command:node?frameNode(node,s.view,s.editorCamera):{position:{x:4,y:3,z:7},target:{x:0,y:0,z:0},zoom:1};
   s.orbit.destroy();s.view.camera=s.editorCamera;s.editorCamera.position.set(next.position.x,next.position.y,next.position.z);s.editorCamera.zoom=next.zoom;s.editorCamera.lookAt(next.target);s.orbit=new OrbitCamera({view:s.view,enabled:false,autoUpdate:false,enableDamping:false,target:next.target});
  }
  ctx.render();return viewState({viewId:s.id});
 }
 /** Last drawn light and camera gizmos per view, for view_state: which lights got one, how many segments, how many reached the screen. */
 const gizmoStats=new Map<string,{id:string;kind:string;selected:boolean;segments:number;drawn:number;icon:{x:number;y:number}|null}[]>(),lightIcons=new Map<string,{id:string;x:number;y:number}[]>();
 function drawLights(s:Slot){const stats:{id:string;kind:string;selected:boolean;segments:number;drawn:number;icon:{x:number;y:number}|null}[]=[],icons:{id:string;x:number;y:number}[]=[];gizmoStats.set(s.id,stats);lightIcons.set(s.id,icons);
  for(const [id,node] of s.nodes){const entity=source?.entities.find(e=>e.id===id),lightData=entity?.components.find(c=>c.type==='pixi3d.light'&&c.version===1),cameraData=entity?.components.find(c=>c.type==='pixi3d.camera'&&c.version===1);if(!(lightData||cameraData)||!available(node))continue;
   // A scene camera the view is looking through would sit on the eye; skip its gizmo.
   if(!lightData&&s.view.camera===s.cameras.get(id))continue;
   const dragged=gesture?.kind==='gizmo'&&gesture.id===id&&gesture.handle?{...gesture.handle.data,[gesture.handle.key]:gesture.handle.next}:undefined;
   const isSelected=id===selected,toWorld=(p:{x:number;y:number;z:number})=>node.toGlobal(p),d=lightData?Light3DSchema.parse(dragged??lightData.data):undefined,camera=cameraData&&!lightData?Camera3DSchema.parse(cameraData.data):undefined;
   const gizmo=d?lightGizmo(d,toWorld,isSelected):cameraGizmo(camera!,s.view.width/s.view.height,toWorld,isSelected);if(!gizmo)continue;const kind=d?d.kind:'camera';
   const color=d?parseInt(d.color.slice(1),16):0x9fd3ff,screen=(p:{x:number;y:number;z:number})=>{const q=s.view.worldToScreen(p);return q?s.host.toLocal(q):undefined;};let drawn=0;
   for(const [a,b] of gizmo.segments){const pa=screen(a),pb=screen(b);if(!pa||!pb)continue;s.overlay.moveTo(pa.x,pa.y).lineTo(pb.x,pb.y);drawn++;}
   if(drawn)s.overlay.stroke({color,width:1.5,alpha:.85});
   const global=s.view.worldToScreen(gizmo.origin),local=global?s.view.toLocal(global):null;if(global&&local&&local.x>=0&&local.y>=0&&local.x<s.view.width&&local.y<s.view.height)icons.push({id,x:global.x,y:global.y});
   const o=screen(gizmo.origin);if(o){s.overlay.circle(o.x,o.y,isSelected?7:5).fill({color,alpha:.9}).stroke({color:0x111418,width:1.5});
    if(kind==='camera')s.overlay.rect(o.x-8,o.y-5,11,10).moveTo(o.x+3,o.y).lineTo(o.x+9,o.y-5).lineTo(o.x+9,o.y+5).lineTo(o.x+3,o.y);
    if(kind==='directional')for(let i=0;i<8;i++){const a=i*Math.PI/4;s.overlay.moveTo(o.x+Math.cos(a)*9,o.y+Math.sin(a)*9).lineTo(o.x+Math.cos(a)*13,o.y+Math.sin(a)*13);}
    if(kind==='spot')s.overlay.moveTo(o.x-6,o.y+9).lineTo(o.x,o.y+3).lineTo(o.x+6,o.y+9);
    s.overlay.stroke({color,width:1.5,alpha:.9});}
   if(d&&isSelected&&ctx.editable()&&!ctx.flags(id).locked)for(const h of lightHandles(d,toWorld)){const at=s.view.worldToScreen(h.point),anchor=s.view.worldToScreen(h.anchor);if(!at||!anchor)continue;lightHandleHits.push({slot:s.id,id,key:h.key,anchor:{x:anchor.x,y:anchor.y},at:{x:at.x,y:at.y}});const q=s.host.toLocal(at);s.overlay.rect(q.x-5,q.y-5,10,10).fill({color:h.key==='range'?0xffd166:0x7fd6ff}).stroke({color:0x111418,width:1.5});}
   stats.push({id,kind,selected:isSelected,segments:gizmo.segments.length,drawn,icon:local?{x:Math.round(local.x*10)/10,y:Math.round(local.y*10)/10}:null});}
 }
 /** What a click at an app-screen point selects: a light or camera icon first (neither has a surface), then a mesh, else the view. */
 function resolvePick(s:Slot,p:Point):{id:string;via:'light'|'camera'|'mesh'|'view'}{const icon=pickLightIcon(p,lightIcons.get(s.id)??[]);if(icon)return{id:icon,via:s.cameras.has(icon)&&!source?.entities.find(e=>e.id===icon)?.components.some(c=>c.type==='pixi3d.light')?'camera':'light'};const mesh=projection.pick(s,p);return mesh?{id:mesh,via:'mesh'}:{id:s.id,via:'view'};}
 function pick(input:unknown){const q=EditorPickSchema.parse(input),s=slots.find(v=>v.id===q.viewId);if(!s)throw Error('3D view is not in the editor');if(playing)throw Error('Picking needs edit mode');
  if(q.x<0||q.y<0||q.x>=s.view.width||q.y>=s.view.height)throw Error('Point is outside the 3D view');const result=resolvePick(s,s.view.toGlobal({x:q.x,y:q.y}));if(q.select){ctx.select(result.id);ctx.render();}return{...result,selected:q.select};}
 /** The camera each view drew with last frame: a switch (editor ↔ scene camera, Play, Stop) is a cut, so motion blur starts fresh. */
 const lastCamera=new Map<string,Camera3D>();
 /** Most editor GPU draws in one displayed frame over the last 30 frames: camera-history effects (motion blur) need at most one. */
 let rendersThisFrame=0,rendersPerFrame=0,frameStamp=-1;
 let maxDraws=0;const frameTick=()=>{if(dead)return;frameStamp++;maxDraws=Math.max(maxDraws,rendersThisFrame);rendersThisFrame=0;if(frameStamp%30===0){rendersPerFrame=maxDraws;maxDraws=0;}if(typeof requestAnimationFrame==='function')requestAnimationFrame(frameTick);};if(typeof requestAnimationFrame==='function')requestAnimationFrame(frameTick);
 const drawCounter={prerender:()=>{rendersThisFrame++;}};
 // Counts real GPU draws of the editor app per animation frame, not render() requests.
 (ctx.app.renderer as unknown as {runners?:{prerender?:{add(item:object):void;remove(item:object):void}}}).runners?.prerender?.add(drawCounter);
 function noteCameraCuts(){for(const s of slots){const camera=s.view.camera,previous=lastCamera.get(s.id);if(previous&&previous!==camera)camera.resetHistory();lastCamera.set(s.id,camera);}}
 let framing=false;
 function frame(){if(dead||framing)return;framing=true;try{frameNow();}finally{framing=false;}}
 function frameNow(){if(source){animations.sync(playing?(ctx.runtimeEntities?.()??source.entities):source.entities,playing,playing);if(playing)animations.advanceTo(ctx.runtimeTime?.()??0,ctx.runtimeSilent?.()??false);}projection.setParticleTime(playing?ctx.runtimeTime?.()??0:0);publish();for(const s of slots)for(const [id,node] of s.nodes){const e=source?.entities.find(e=>e.id===id);node.visible=Boolean(e?.active)&&(playing||!ctx.flags(id).hidden);node.eventMode=!playing&&ctx.flags(id).locked?'none':'static';}toolbar.hidden=playing||!selectedSlot();const active=selectedSlot();modes.forEach((b,i)=>b.setAttribute('aria-pressed',String(mode===(['move','rotate','scale'] as const)[i])));lightHandleHits=[];cameraButton.textContent=ctx.text(active?.view.camera!==active?.editorCamera?'scene3d.editorCamera':'scene3d.sceneCamera');handles=[];
  for(const s of slots){if(!playing&&!available(s.view.camera))s.view.camera=s.editorCamera;s.overlay.clear();for(const label of s.labels)label.visible=false;if(playing){gizmoStats.set(s.id,[]);lightIcons.set(s.id,[]);}else drawLights(s);const node=s.nodes.get(selected??'');if(playing||!node||!available(node)||!ctx.editable()||ctx.flags(selected!).locked)continue;const origin=node.getGlobalPosition(),from=s.view.worldToScreen(origin);if(!from)continue;
   for(const [i,axis] of (['x','y','z'] as Axis[]).entries()){const local=mode==='scale'?{x:0,y:0,z:0}:{x:node.position.x,y:node.position.y,z:node.position.z};local[axis]+=1;const world=(mode==='scale'?node:node.parent!).toGlobal(local),projection=s.view.worldToScreen(world);if(!projection)continue;const projected={x:projection.x-from.x,y:projection.y-from.y},length=Math.hypot(projected.x,projected.y);if(length<5)continue;const to={x:from.x+projected.x/length*65,y:from.y+projected.y/length*65},a=s.host.toLocal(from),b=s.host.toLocal(to),color=[0xf17c80,0x94ce8b,0x85b7fa][i];s.overlay.moveTo(a.x,a.y).lineTo(b.x,b.y).stroke({color,width:2}).circle(b.x,b.y,4).fill(color);const label=s.labels[i];label.text=axis.toUpperCase();label.style.fill=color;label.position.set(b.x+5,b.y-8);label.visible=true;handles.push({axis,from:{...from},to,projected});
   }
  }
  noteCameraCuts();ctx.host.dataset.spatial3d=JSON.stringify({gizmoHandles:lightHandleHits.map(h=>({id:h.id,key:h.key})),selected,mode,views:slots.map(s=>({id:s.id,camera:s.view.camera===s.editorCamera?'editor':'scene',models:[...s.models].map(([id,state])=>({id,key:state.key,ready:state.ready,error:state.error??null})),nodes:[...s.nodes].map(([id,n])=>({id,screen:s.view.worldToScreen(n.getGlobalPosition())}))})),axes:handles,animations:animations.diagnostics,animationErrors:animations.errors,resources:projection.resources?.stats??null});
 }
 const down=(e:PointerEvent)=>{if(e.target!==ctx.app.canvas||!ctx.editable())return;const p=point(e),s=at(p);if(!s||![0,1].includes(e.button))return;consume(e);if(e.button===0&&!e.altKey&&grabHandle(s,p,e.pointerId)){ctx.app.canvas.setPointerCapture(e.pointerId);return;}
  const entity=source?.entities.find(e=>e.id===selected),axis=handles.find(h=>distance(p,h.from,h.to)<8),pose=entity?.spatial==='scene3d.transform'?transform3D(entity):undefined;
  gesture={pointer:e.pointerId,slot:s,start:p,last:p,kind:e.altKey?'orbit':e.button===1?'pan':axis&&pose?'axis':'pick',axis:axis?.axis,id:entity?.id,pose,next:pose,parentId:entity?.parentId,projected:axis?.projected};ctx.app.canvas.setPointerCapture(e.pointerId);
 };
 const move=(e:PointerEvent)=>{const g=gesture;if(!g||g.pointer!==e.pointerId)return;consume(e);try{const p=point(e),dx=p.x-g.last.x,dy=p.y-g.last.y;g.last=p;
  if(g.kind==='orbit'&&g.slot.view.camera===g.slot.editorCamera)g.slot.orbit.rotate(-dx*.008,-dy*.008);
  if(g.kind==='pan'&&g.slot.view.camera===g.slot.editorCamera)g.slot.orbit.pan(dx,dy);
  if(g.kind==='gizmo')dragTo(g,p);
  if(g.kind==='axis'&&g.pose&&g.axis&&g.id){if(!g.projected)return;const delta=mode==='move'?axisDelta(p.x-g.start.x,p.y-g.start.y,g.projected):(p.x-g.start.x-p.y+g.start.y)*.01;g.next=axisPose(g.pose,g.axis,mode,delta,e.shiftKey);apply(g.slot.nodes.get(g.id)!,g.next);}
  ctx.render();
 }catch(error){cancel();ctx.report(error);}};
 const up=(e:PointerEvent)=>{const g=gesture;if(!g||g.pointer!==e.pointerId)return;consume(e);gesture=undefined;try{if(g.kind==='gizmo')releaseHandle(g);else if(g.kind==='axis'&&g.pose&&g.next&&g.id)ctx.commitSpatial({id:g.id,data:g.next,expected:g.pose,parentId:g.parentId!});else if(g.kind==='pick'&&Math.hypot(point(e).x-g.start.x,point(e).y-g.start.y)<4){ctx.select(resolvePick(g.slot,point(e)).id);}ctx.render();}catch(error){if(g.pose&&g.id)apply(g.slot.nodes.get(g.id)!,g.pose);if(g.handle&&g.id)liveLight(g.slot,g.id,g.handle.key,g.handle.value);ctx.report(error);}};
 const wheel=(e:WheelEvent)=>{if(e.target!==ctx.app.canvas||!ctx.editable())return;const s=at(point(e));if(!s)return;consume(e);if(s.view.camera===s.editorCamera)s.orbit.zoom(Math.exp(e.deltaY*.001));ctx.render();};
 const key=(e:KeyboardEvent)=>{if(!selectedSlot()||!ctx.editable()||(e.target instanceof HTMLElement&&e.target.closest('input,textarea,select,[contenteditable=true]')))return;if(e.key.toLowerCase()==='f'&&!e.metaKey&&!e.ctrlKey&&!e.altKey){consume(e);const s=selectedSlot();try{if(s)cameraControl({viewId:s.id,action:'frame',entityId:selected});}catch(error){ctx.report(error);}}else if(e.key==='Escape'&&gesture){consume(e);cancel();ctx.render();}else if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&['w','e','r'].includes(e.key.toLowerCase())){consume(e);mode=({w:'move',e:'rotate',r:'scale'} as const)[e.key.toLowerCase() as 'w'|'e'|'r'];ctx.render();}else if(source?.entities.find(n=>n.id===selected)?.spatial==='scene3d.transform'&&e.key.startsWith('Arrow'))consume(e);};
 const abort=()=>{cancel();if(!dead)ctx.render();};
 ctx.host.addEventListener('pointerdown',down,true);ctx.host.addEventListener('wheel',wheel,{capture:true,passive:false});window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',abort);window.addEventListener('blur',abort);window.addEventListener('keydown',key,true);
 return{sync,animation,viewState,debugPanels,cameraControl,pick,dragHandle:dragHandleTool,diagnostics:()=>slots.flatMap(s=>[...s.models].map(([entityId,m])=>({entityId,ready:m.ready,...(m.error?{error:m.error}:{})}))),
 runtime:{spatialTypes:['scene3d.transform'],ready:()=>projection.ready(),validate:scene=>runtime3DProblems(scene,id=>assets?.get(id),shaders?.()??{version:1,items:[]}),async prepare(scene){sync(scene,selected);await projection.ready();
  // Play refuses a shader that does not compile on either backend (the export runs on both); a missing backend is skipped.
  const failed=await projection.verifyShaders();if(failed.length)throw Error(failed.join('\n'));},enter(){cancel();previewClock.pause();if(source)animations.reset(source.entities);for(const s of slots)saved.set(s.id,{position:{x:s.editorCamera.x,y:s.editorCamera.y,z:s.editorCamera.z},target:{x:s.orbit.target.x,y:s.orbit.target.y,z:s.orbit.target.z},zoom:s.editorCamera.zoom,sceneCamera:s.view.camera!==s.editorCamera});playing=true;projection.resetPointers();if(source)projection.update(source);projection.useSceneCameras();for(const s of slots)s.view.eventMode='static';frame();},exit(){playing=false;projection.stopCameraControls();projection.resetPointers();animations.clear();animations.rebase(previewClock.time);if(source)projection.update(source);for(const s of slots){s.view.eventMode='none';const camera=s.cameraId?s.cameras.get(s.cameraId):undefined;s.view.camera=saved.get(s.id)?.sceneCamera&&camera&&available(camera)?camera:s.editorCamera;}frame();}},
 scripts3d:{raycast:point=>playing?projection.raycastHit(point):null,model:id=>slots.length?projection.modelState(id):undefined,stats:()=>projection.resources?.stats??null,
  defineGeometry:(id:string,data:unknown)=>{if(playing)projection.defineGeometry(id,data as ScriptGeometry);},setMeshGeometry:(entityId,id)=>{if(playing)projection.setMeshGeometry(entityId,id);},setMorph:(entityId,w)=>{if(playing)projection.setMorph(entityId,w);},
  writeParticles:(entityId,d,n)=>{if(playing)projection.writeScriptParticles(entityId,d,n);},setBatchGeometries:(entityId,ids)=>{if(playing)projection.setBatchGeometries(entityId,ids);},writeBatch:(entityId,d,n)=>{if(playing)projection.writeBatch(entityId,d,n);}},
 hitEntity(node,point,clickable){if(!playing)return;const slot=slots.find(s=>s.view===node);return slot?projection.pick(slot,point,clickable)??undefined:undefined;},
 selection(id){if(selected!==id)cancel();selected=id;frame();},frame,clear(){clear();source=undefined;},dispose(){dead=true;graphOverlay?.destroy();graphOverlay=undefined;geometryPanel?.remove();geometryPanel=undefined;thumbnails.clear();(ctx.app.renderer as unknown as {runners?:{prerender?:{remove(item:object):void}}}).runners?.prerender?.remove(drawCounter);ctx.app.ticker.remove(previewTick);previewClock.dispose();animations.clear();listeners.clear();clear();toolbar.remove();delete ctx.host.dataset.spatial3d;ctx.host.removeEventListener('pointerdown',down,true);ctx.host.removeEventListener('wheel',wheel,true);window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',abort);window.removeEventListener('blur',abort);window.removeEventListener('keydown',key,true);saved.clear();void projection.dispose().catch(ctx.report);}};
}
