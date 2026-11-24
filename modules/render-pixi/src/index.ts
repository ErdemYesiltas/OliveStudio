import {ViewportRuntimeGate} from './runtime-features';
import type {ViewportFeature,ViewportFeatureHandle,SpatialCommit} from './viewport-features';
import {project2DScene} from '@rewrite/scene';
import {destroyLocalApplication} from './lifecycle';
import {z} from 'zod';
import {gridLines,readGridSettings,snapMove,gridNudge,gridSteps,type GridSettings} from './grid';
export {readGridSettings,gridSteps,type GridSettings} from './grid';
import {cameraForBounds,cameraScale} from './camera';
import {createMarker,rulerStep} from './badges';
import {guideTargets,snapToGuides,type GuideLine,type GuideTargets} from './guides';
export {guideTargets,snapToGuides,type GuideLine,type GuideBox,type GuideTargets} from './guides';
import 'pixi.js/unsafe-eval';
import {flipbookDefinition} from './flipbook';
export {flipbookDefinition,createFlipbookAdapter,flipbookFrame,FlipbookSchema} from './flipbook';
import type {VisualAdapter,VisualFrame,VisualHandle,SceneDecorator} from './visuals';
import { BehaviorSubject } from 'rxjs';
import { Application, BitmapText, Container, Graphics, Rectangle, Text, Sprite, Texture } from 'pixi.js';
import { setTextureFiltering } from './textures';
import { components, createItems, settings, type EditorModule, type ComponentDefinition,type CreateItemDefinition,type Json } from '@rewrite/sdk';
import { objectDefinitions } from './objects';
import { effectsDefinition,maskDefinition,createEffectsDecorator } from './effects';
import { shaderDefinition,shaderType,shadersSection } from './shaders';
import { projectToken } from '@rewrite/project';
import { tilemapDefinition } from './tilemap';
export { tilemapDefinition,createTilemapAdapter,TilemapSchema,tileAt,cellsAlong,resizeTiles,tilesetSize,type Tilemap } from './tilemap';
export { cameraView,idleCamera,snapCamera,sceneCamera,cameraOutlines,viewOffset,viewPlacement,CameraSchema,cameraType,type Camera,type CameraView,type RuntimeCameraState } from './runtime-camera';
import { CameraSchema,cameraType,viewPlacement,viewOffset,type CameraView } from './runtime-camera';
import { ScreenSpaceSchema,screenSpaceType,screenAnchors,screenSpace } from './screen';
export { ScreenSpaceSchema,screenSpaceType,screenAnchors,screenSpace,screenOffset,type ScreenSpace } from './screen';
import { sceneDecorators } from './visuals';
export { effectsDefinition,maskDefinition,createEffectsDecorator,effectFilters,EffectsSchema,MaskSchema,blendModes } from './effects';
export { objectDefinitions,createObjectAdapters,particleState,particleBounds,waveAt,TilingSpriteSchema,NineSliceSchema,MeshPlaneSchema,RopeSchema,ParticlesSchema } from './objects';
import { transform, type Scene } from '@rewrite/scene';
import { SpriteSchema,TextureMetadataSchema,ShapeSchema,TextSchema,BitmapTextSchema,fontImporter,shapeKinds,textStyle,bitmapTextStyle,bidiText } from './contracts';
import { drawShape } from './display';
import { visualKey } from './visual-signature';
import { loadFont,fontStack } from './fonts';
import { assetImporters } from '@rewrite/assets';
import { angleStep,pointerAngle,evaluateTransform,type Transform2D,type TransformTool,type TransformAxis } from './gizmo';
export type { TransformTool } from './gizmo';
import { makeEntity } from '@rewrite/scene';
import { clickTarget } from './click';
import type { AssetRecord } from '@rewrite/assets';
export { SpriteSchema,TextureMetadataSchema,ShapeSchema,TextSchema,BitmapTextSchema,FontMetadataSchema,fontImporter,fontFile,fontFamily,shapeKinds,textStyle,bitmapTextStyle,bidiText,mirrorAlign } from './contracts';
export { drawShape,shapePoints } from './display';

const shapeIs=(...kinds:string[])=>(v:Json)=>kinds.includes(String((v as {kind?:string}|null)?.kind??'rect'));
export const shapeDefinition: ComponentDefinition = { type: 'pixi.shape', version: 1, supportedSpaces:['scene.2d'], exclusiveGroup:'render.visual', titleKey: 'component.shape', defaults: () => ({ alpha:1,kind:'rect',width: 100, height: 100, color: '#7caef5', rounded: 12,sides:5,innerRadius:.5,strokeColor:'#ffffff',strokeWidth:0 }), get dataSchema(){return z.toJSONSchema(ShapeSchema,{unrepresentable:'any'});},parse: v => ShapeSchema.parse(v), fields: [
 {key:'kind',titleKey:'field.shapeKind',kind:'enum',options:shapeKinds.map(value=>({value,titleKey:`shape.${value}`}))},{key:'alpha',titleKey:'field.alpha',kind:'number'},
 { key: 'width', titleKey: 'field.width', kind: 'number' }, { key: 'height', titleKey: 'field.height', kind: 'number' }, { key: 'color', titleKey: 'field.color', kind: 'color' }, { key: 'rounded', titleKey: 'field.rounded', kind: 'number',visible:shapeIs('rect') },
 {key:'sides',titleKey:'field.sides',kind:'number',visible:shapeIs('polygon','star')},{key:'innerRadius',titleKey:'field.innerRadius',kind:'number',visible:shapeIs('star')},
 {key:'strokeWidth',titleKey:'field.strokeWidth',kind:'number'},{key:'strokeColor',titleKey:'field.strokeColor',kind:'color',visible:v=>!shapeIs('line')(v)},
] };
const wraps=(v:Json)=>Boolean((v as {wordWrap?:boolean}|null)?.wordWrap);
const wrapFields:ComponentDefinition['fields']=[{key:'wordWrap',titleKey:'field.wordWrap',kind:'boolean'},{key:'wrapWidth',titleKey:'field.wrapWidth',kind:'number',visible:wraps},{key:'lineHeight',titleKey:'field.lineHeight',kind:'number'}];
export const textDefinition: ComponentDefinition = { type: 'pixi.text', version: 1, supportedSpaces:['scene.2d'], exclusiveGroup:'render.visual', titleKey: 'component.text', defaults: () => ({ alpha:1,text: 'Hello, world', fontSize: 40, color: '#e8e8e5', font: '', fontWeight:'normal', fontStyle:'normal', align:'center', letterSpacing:0, strokeColor:'#000000', strokeWidth:0, wordWrap:false, wrapWidth:400, lineHeight:0 }), get dataSchema(){return z.toJSONSchema(TextSchema,{unrepresentable:'any'});},parse: v => TextSchema.parse(v), fields: [{key:'alpha',titleKey:'field.alpha',kind:'number'},
 { key: 'text', titleKey: 'field.text', kind: 'string' }, { key: 'font', titleKey: 'field.font', kind: 'asset', assetType: 'font.face' }, { key: 'fontSize', titleKey: 'field.fontSize', kind: 'number' }, { key: 'color', titleKey: 'field.color', kind: 'color' },
 { key: 'fontWeight', titleKey: 'field.fontWeight', kind: 'enum', options: ['normal','bold'].map(value=>({value,titleKey:`fontWeight.${value}`})) }, { key: 'fontStyle', titleKey: 'field.fontStyle', kind: 'enum', options: ['normal','italic'].map(value=>({value,titleKey:`fontStyle.${value}`})) },
 { key: 'align', titleKey: 'field.align', kind: 'enum', options: ['left','center','right'].map(value=>({value,titleKey:`textAlign.${value}`})) }, { key: 'letterSpacing', titleKey: 'field.letterSpacing', kind: 'number' },
 { key: 'strokeColor', titleKey: 'field.textStrokeColor', kind: 'color' }, { key: 'strokeWidth', titleKey: 'field.textStrokeWidth', kind: 'number' },
 ...wrapFields,
] };
export const bitmapTextDefinition:ComponentDefinition={type:'pixi.bitmapText',version:1, supportedSpaces:['scene.2d'],exclusiveGroup:'render.visual',titleKey:'component.bitmapText',defaults:()=>({alpha:1,text:'Score 0',fontSize:40,color:'#ffffff',font:'',letterSpacing:0,align:'center',wordWrap:false,wrapWidth:400,lineHeight:0}),get dataSchema(){return z.toJSONSchema(BitmapTextSchema,{unrepresentable:'any'});},parse:v=>BitmapTextSchema.parse(v),fields:[{key:'alpha',titleKey:'field.alpha',kind:'number'},{key:'text',titleKey:'field.text',kind:'string'},{key:'font',titleKey:'field.font',kind:'asset',assetType:'font.face'},{key:'fontSize',titleKey:'field.fontSize',kind:'number'},{key:'color',titleKey:'field.color',kind:'color'},{key:'letterSpacing',titleKey:'field.letterSpacing',kind:'number'},{key:'align',titleKey:'field.align',kind:'enum',options:['left','center','right'].map(value=>({value,titleKey:`textAlign.${value}`}))},...wrapFields]};
export const spriteDefinition:ComponentDefinition={type:'pixi.sprite',version:1,supportedSpaces:['scene.2d'],titleKey:'component.sprite',exclusiveGroup:'render.visual',defaults:()=>({assetId:'',width:100,height:100,anchorX:.5,anchorY:.5,alpha:1,tint:'#ffffff'}),get dataSchema(){return z.toJSONSchema(SpriteSchema,{unrepresentable:'any'});},parse:v=>SpriteSchema.parse(v),fields:[{key:'assetId',titleKey:'field.assetId',kind:'asset',assetType:'pixi.texture'},...['width','height','anchorX','anchorY','alpha'].map(key=>({key,titleKey:`field.${key}`,kind:'number' as const})),{key:'tint',titleKey:'field.tint',kind:'color'}]};
export function makeSpriteEntity(asset:AssetRecord,x=480,y=270){
 if(asset.type!=='pixi.texture')throw Error('This asset is not a texture');const meta=TextureMetadataSchema.parse(asset.metadata),entity=makeEntity(asset.name,x,y);
 entity.components.push({id:crypto.randomUUID(),type:'pixi.sprite',version:1,data:{assetId:asset.id,width:meta.width,height:meta.height,anchorX:.5,anchorY:.5,alpha:1,tint:'#ffffff'}});return entity;
}
const cameraIs=(key:'target'|'limit')=>(v:Json)=>Boolean((v as Record<string,Json>|null)?.[key]);
/** Scene camera: one per scene (the Add menu selects the existing one); the target is picked in the Inspector. */
export const cameraDefinition:ComponentDefinition={type:cameraType,version:1, supportedSpaces:['scene.2d'],titleKey:'component.camera',uniqueInScene:'Camera',defaults:()=>CameraSchema.parse({}),get dataSchema(){return z.toJSONSchema(CameraSchema,{unrepresentable:'any'});},parse:v=>CameraSchema.parse(v),fields:[
 {key:'zoom',titleKey:'camera.zoom',kind:'number'},{key:'rotate',titleKey:'camera.rotate',kind:'boolean'},{key:'target',titleKey:'camera.target',kind:'string',visible:()=>false},
 ...(['offsetX','offsetY','smoothing','deadzoneWidth','deadzoneHeight'] as const).map(key=>({key,titleKey:`camera.${key}`,kind:'number' as const,visible:cameraIs('target')})),
 {key:'limit',titleKey:'camera.limit',kind:'boolean'},...(['limitLeft','limitTop','limitRight','limitBottom'] as const).map(key=>({key,titleKey:`camera.${key}`,kind:'number' as const,visible:cameraIs('limit')})),
],remapReferences:(v,ids)=>{const c=CameraSchema.parse(v);return{...c,target:c.target?ids.entities.get(c.target)??c.target:''};}};
/** Screen Space (HUD): a top-level object drawn on the screen above the world, ignoring the camera; anchored for other screen sizes. */
export const screenSpaceDefinition:ComponentDefinition={type:screenSpaceType,version:1, supportedSpaces:['scene.2d'],titleKey:'component.screenSpace',defaults:()=>ScreenSpaceSchema.parse({}),get dataSchema(){return z.toJSONSchema(ScreenSpaceSchema,{unrepresentable:'any'});},parse:v=>ScreenSpaceSchema.parse(v),fields:[{key:'anchor',titleKey:'field.screenAnchor',kind:'enum',options:screenAnchors.map(value=>({value,titleKey:`anchor.${value}`}))}]};
export const pixiModule: EditorModule = { manifest: { id: 'pixi', version: '1.0.0', apiVersion: 1, requires: { scene: '^1' },optional:{assets:'^1',project:'^1'} }, activate(c) {
 c.contribute(assetImporters,fontImporter.id,fontImporter);
 c.contribute(components,cameraType,cameraDefinition);c.contribute(components,screenSpaceType,screenSpaceDefinition); c.contribute(components,'pixi.sprite',spriteDefinition); c.contribute(components, 'pixi.shape', shapeDefinition); c.contribute(components, 'pixi.text', textDefinition); c.contribute(components,'pixi.bitmapText',bitmapTextDefinition); c.contribute(components,'pixi.flipbook',flipbookDefinition);
 for(const definition of [...objectDefinitions,effectsDefinition,maskDefinition,tilemapDefinition])c.contribute(components,definition.type,definition);
 {let shaders:(()=>unknown)|undefined;try{const project=c.get(projectToken);shaders=()=>project.document.current.extensions[shadersSection];}catch{shaders=undefined;}c.contribute(sceneDecorators,'pixi.effects',createEffectsDecorator({shaders}));}c.contribute(components,shaderType,shaderDefinition);
 for(const [id,item] of Object.entries(pixiCreateItems))c.contribute(createItems,`pixi.${id}`,item);
 c.contribute(settings,'pixi.gridVisible',{titleKey:'setting.gridVisible',section:'setting.section.viewport',kind:'boolean',default:false,order:1});
 c.contribute(settings,'pixi.gridSnap',{titleKey:'setting.gridSnap',section:'setting.section.viewport',kind:'boolean',default:false,order:2});
 c.contribute(settings,'pixi.smartGuides',{titleKey:'setting.smartGuides',descriptionKey:'setting.smartGuidesHelp',section:'setting.section.viewport',kind:'boolean',default:true,order:4});
 c.contribute(settings,'pixi.rulers',{titleKey:'setting.rulers',section:'setting.section.viewport',kind:'boolean',default:true,order:5});
 c.contribute(settings,'pixi.gridStep',{titleKey:'setting.gridStep',section:'setting.section.viewport',kind:'enum',default:'32',order:3,options:gridSteps.map(step=>({value:String(step),titleKey:`${step} px`}))});
} };
const shape=(kind:string,data:Record<string,Json>={}):CreateItemDefinition['components']=>[{type:'pixi.shape',data:{kind,rounded:0,...data}}];
/** Toolbar Add menu entries owned by the Pixi module. */
export const pixiCreateItems:Record<string,CreateItemDefinition>={
 container:{titleKey:'create.container',category:'basic',icon:'box',name:'Container',components:[]},
 camera:{titleKey:'create.camera',category:'camera',icon:'camera',name:'Camera',components:[{type:cameraType}]},
 rect:{titleKey:'create.rect',category:'shapes',icon:'square',name:'Rectangle',components:shape('rect',{width:160,height:100})},
 roundedRect:{titleKey:'create.roundedRect',category:'shapes',icon:'squareRound',name:'Rounded rectangle',components:shape('rect',{width:160,height:100,rounded:16})},
 circle:{titleKey:'create.circle',category:'shapes',icon:'circle',name:'Circle',components:shape('ellipse')},
 ellipse:{titleKey:'create.ellipse',category:'shapes',icon:'ellipse',name:'Ellipse',components:shape('ellipse',{width:160,height:90})},
 triangle:{titleKey:'create.triangle',category:'shapes',icon:'triangle',name:'Triangle',components:shape('triangle')},
 polygon:{titleKey:'create.polygon',category:'shapes',icon:'hexagon',name:'Polygon',components:shape('polygon',{sides:6})},
 star:{titleKey:'create.star',category:'shapes',icon:'star',name:'Star',components:shape('star',{sides:5,innerRadius:.45})},
 line:{titleKey:'create.line',category:'shapes',icon:'line',name:'Line',components:shape('line',{width:160,height:0.01,strokeWidth:4})},
 sprite:{titleKey:'create.sprite',category:'sprites',icon:'image',name:'Sprite',components:[{type:'pixi.sprite'}]},
 animatedSprite:{titleKey:'create.animatedSprite',category:'sprites',icon:'film',name:'Animated sprite',components:[{type:'pixi.flipbook'}]},
 tilingSprite:{titleKey:'create.tilingSprite',category:'sprites',icon:'grid',name:'Tiling sprite',components:[{type:'pixi.tilingSprite'}]},
 tilemap:{titleKey:'create.tilemap',category:'sprites',icon:'tilemap',name:'Tilemap',components:[{type:'pixi.tilemap'}]},
 nineSlice:{titleKey:'create.nineSlice',category:'sprites',icon:'frame',name:'Nine-slice sprite',components:[{type:'pixi.nineSlice'}]},
 text:{titleKey:'create.text',category:'text',icon:'text',name:'Text',components:[{type:'pixi.text'}]},
 hudText:{titleKey:'create.hudText',category:'text',icon:'text',name:'HUD text',components:[{type:'pixi.text',data:{text:'Score 0',fontSize:28,align:'left'}},{type:screenSpaceType}]},
 bitmapText:{titleKey:'create.bitmapText',category:'text',icon:'bitmapText',name:'Bitmap text',components:[{type:'pixi.bitmapText'}]},
 mesh:{titleKey:'create.mesh',category:'meshes',icon:'mesh',name:'Mesh plane',components:[{type:'pixi.mesh'}]},
 rope:{titleKey:'create.rope',category:'meshes',icon:'rope',name:'Rope',components:[{type:'pixi.rope'}]},
 particles:{titleKey:'create.particles',category:'effects',icon:'sparkles',name:'Particles',components:[{type:'pixi.particles'}]},
};
interface GroupDrag {pointerId:number;from:{x:number;y:number};items:{id:string;node:Container;start:Transform2D}[];capture:HTMLElement;moved:boolean}
interface Marquee {pointerId:number;from:{x:number;y:number};to:{x:number;y:number};additive:boolean}
export type SelectMode='replace'|'toggle';
export interface EditorFlags{hidden:boolean;locked:boolean}
interface Drag {id:string;pointerId:number;node:Container;start:Transform2D;from:{x:number;y:number};tool:TransformTool;axis:TransformAxis;previousAngle:number;rotationDelta:number;capture:HTMLElement}
/** One onion-skin ghost: object poses at another time of the clip, drawn with this tint and opacity. */
export interface OnionFrame{poses:ReadonlyMap<string,Transform2D&{active:boolean}>;tint:string;alpha:number}
export interface ViewportDecoration{entityId?:string;points:readonly {x:number;y:number}[];color?:string}
export class SceneViewport {
 private features:ViewportFeatureHandle[]=[];
 private runtimeGate=new ViewportRuntimeGate(()=>this.features);
 async prepareRuntime(scene:Scene){this.sync(scene,this.selected);await this.runtimeGate.prepare(scene);}
 async readyRuntime(){await this.runtimeGate.ready();}
 enterRuntime(scene:Scene){this.runtimeGate.enter(scene);}
 exitRuntime(){try{this.runtimeGate.exit();}catch(error){this.callbacks.report?.(error);}}

 private eachFeature(run:(feature:ViewportFeatureHandle)=>void){for(const feature of [...this.features])try{run(feature);}catch(error){this.features=this.features.filter(f=>f!==feature);try{feature.dispose();}catch{/* Preserve the original error. */}this.callbacks.report?.(error);}}

 readonly app = new Application();
 private stage = new Container();
 private content = new Container();
 /** Screen Space (HUD) objects: above the world, outside the game camera. `game` holds both and takes the Preview mask. */
 private ui = new Container();
 private game = new Container();
 private overlay = new Graphics();
 private debugOverlay=new Graphics();
 private guideLayer=new Graphics();private guidesEnabled=true;private targets?:GuideTargets;private activeGuides:GuideLine[]=[];
 /** Screen point where the current single drag began; guides engage only after a real move (a click never snaps). */
 private dragOrigin?:{x:number;y:number;moved:boolean};
 private decorations:readonly ViewportDecoration[]=[];
 /** Onion skin: tinted, see-through copies of the animated objects at other times, drawn behind the scene. */
 private onionLayer=new Container();
 /** Preview in a right-to-left language: text alignment and layout rows mirror. */
 private rtl=false;
 setTextDirection(direction:'ltr'|'rtl'){const rtl=direction==='rtl';if(rtl===this.rtl)return;this.rtl=rtl;this.host.dataset.direction=direction;if(this.snapshot)this.sync(this.snapshot,this.selected);}
 /**
  * Draws onion-skin ghosts: for each frame, the listed objects are posed as given, the content (only those objects'
  * visuals) is captured to a texture, and the live pose is put back. null clears the ghosts.
  */
 setOnion(frames:readonly OnionFrame[]|null,shown:ReadonlySet<string>=new Set()){
  for(const child of this.onionLayer.removeChildren()){const sprite=child as Sprite;sprite.texture.destroy(true);sprite.destroy();}
  this.host.dataset.onion=String(frames?.length??0);
  if(!frames?.length||this.disposed||!this.app.renderer){this.render();return;}
  const entityNodes=new Set(this.nodes.values()),hidden:Container[]=[];
  for(const [id,node] of this.nodes)if(!shown.has(id))for(const child of node.children)if(!entityNodes.has(child as Container)&&child.visible){child.visible=false;hidden.push(child as Container);}
  try{
   for(const frame of frames){
    const saved=[...frame.poses.keys()].flatMap(id=>{const n=this.nodes.get(id);return n?[{n,x:n.x,y:n.y,angle:n.angle,sx:n.scale.x,sy:n.scale.y,kx:n.skew.x,ky:n.skew.y,px:n.pivot.x,py:n.pivot.y,visible:n.visible}]:[];});
    try{
     for(const [id,t] of frame.poses){const n=this.nodes.get(id);if(!n)continue;n.position.set(t.x,t.y);n.angle=t.rotation;n.scale.set(t.scaleX,t.scaleY);n.skew.set((t.skewX??0)*Math.PI/180,(t.skewY??0)*Math.PI/180);n.pivot.set(t.pivotX??0,t.pivotY??0);n.visible=t.active;}
     const bounds=this.content.getLocalBounds();if(bounds.width<1||bounds.height<1)continue;
     const scale=Math.min(this.app.renderer.resolution*Math.max(1,Math.abs(this.stage.scale.x)),4096/Math.max(bounds.width,bounds.height)),texture=this.app.renderer.generateTexture({target:this.content,resolution:scale,frame:new Rectangle(bounds.x,bounds.y,bounds.width,bounds.height)});
     const ghost=new Sprite(texture);ghost.position.set(bounds.x,bounds.y);ghost.width=bounds.width;ghost.height=bounds.height;ghost.alpha=frame.alpha;ghost.tint=frame.tint;this.onionLayer.addChild(ghost);
    }finally{for(const s of saved){s.n.position.set(s.x,s.y);s.n.angle=s.angle;s.n.scale.set(s.sx,s.sy);s.n.skew.set(s.kx,s.ky);s.n.pivot.set(s.px,s.py);s.n.visible=s.visible;}}
   }
  }finally{for(const child of hidden)child.visible=true;}
  this.render();
 }
 private frame = new Graphics();
 /** During Preview the world is clipped to the stage, like the game screen (also for pointer hits); only in the tree while masking, or it would draw. */
 private stageMask = new Graphics();
 private grid=new Graphics();
 private gridSettings:GridSettings=readGridSettings(null);
 private nodes = new Map<string, Container>();
 private texts = new Map<string, Text|BitmapText>();
 private custom=new Map<string,{componentId:string;handle:VisualHandle}>();
 private observer?: ResizeObserver;
 private drag?: Drag;
 /** Transforms of the objects being dragged on the canvas, before they are committed (empty when nothing is dragged). */
 readonly dragging$ = new BehaviorSubject<ReadonlyMap<string, Transform2D>>(new Map());
 private preview(entries: Iterable<readonly [string, Container]>) { this.dragging$.next(new Map([...entries].map(([id, n]) => [id, {x: n.x, y: n.y, rotation: n.angle, scaleX: n.scale.x, scaleY: n.scale.y}]))); }
 private endPreview() { this.readout.visible=false; delete this.host.dataset.readout; if (this.dragging$.value.size) this.dragging$.next(new Map()); }
 /** Rulers along the top and left edges (scene units, the selection's extent highlighted); edit mode and Scene view. */
 private rulers=new Container();private rulerBands=new Graphics();private rulerLabels:Text[]=[];private rulersOn=true;
 /** Live numbers next to the pointer while moving, rotating or scaling. */
 private readout=new Text({text:'',style:{fontSize:11,fill:'#e6ebf0',fontFamily:'system-ui, sans-serif',stroke:{color:'#111417',width:4}}});
 /** Preview: false shows the game camera's view (masked); true is the free Scene view with the camera's frame drawn. */
 private sceneView=false;private lastView:CameraView|null=null;private cameraFrame=new Graphics();
 /** Device preview: what a screen of a chosen size shows of the stage (stage pixels); null hides it. Edit mode only. */
 private device:{x:number;y:number;width:number;height:number;label:string}|null=null;private deviceLayer=new Graphics();private deviceLabel=new Text({text:'',style:{fontSize:12,fill:'#f2a35c',fontFamily:'system-ui, sans-serif',stroke:{color:'#111417',width:3}}});
 setDeviceFrame(frame:{x:number;y:number;width:number;height:number;label:string}|null){this.device=frame;this.drawDevice();}
 private drawDevice(){const g=this.deviceLayer,f=this.device;g.clear();this.deviceLabel.visible=Boolean(f);if(!f){delete this.host.dataset.deviceFrame;return;}
  const big=1e5,w=1/Math.max(.01,this.scale);g.rect(-big,-big,big*2,f.y+big).rect(-big,f.y+f.height,big*2,big).rect(-big,f.y,f.x+big,f.height).rect(f.x+f.width,f.y,big,f.height).fill({color:0x000000,alpha:.35});
  g.rect(f.x,f.y,f.width,f.height).stroke({color:'#f2a35c',width:2*w});this.deviceLabel.text=f.label;this.deviceLabel.scale.set(w);this.deviceLabel.position.set(f.x+4*w,f.y+4*w);
  this.host.dataset.deviceFrame=JSON.stringify([Math.round(f.x),Math.round(f.y),Math.round(f.width),Math.round(f.height)]);this.render();}
 setRulers(on:boolean){this.rulersOn=on;this.drawRulers();}
 setSceneView(on:boolean){if(this.sceneView===on)return;this.sceneView=on;this.host.dataset.sceneView=String(on);this.setRuntimeView(this.lastView);this.drawRulers();}
 private showReadout(text:string,clientX:number,clientY:number){const b=this.host.getBoundingClientRect();this.readout.text=text;this.readout.position.set(Math.min(clientX-b.left+16,b.width-this.readout.width-4),Math.min(clientY-b.top+18,b.height-this.readout.height-4));this.readout.visible=true;this.host.dataset.readout=text;}
 private drawRulers(){
  if(this.disposed||!this.app.renderer)return;
  const g=this.rulerBands,width=this.app.screen.width,height=this.app.screen.height,size=18;g.clear();
  const shown=this.rulersOn&&(!this.game.mask||this.sceneView);this.rulers.visible=shown;this.host.dataset.rulers=String(shown);if(!shown||!width)return;
  const step=rulerStep(this.scale),minor=step/5*this.scale>=6?step/5:step/2,toX=(x:number)=>this.stage.x+x*this.scale,toY=(y:number)=>this.stage.y+y*this.scale;
  g.rect(0,0,width,size).rect(0,0,size,height).fill({color:this.background,alpha:.94});
  const box=this.selected?this.sceneBounds([...this.selectedSet]).values():[];let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const b of box){minX=Math.min(minX,b.x);maxX=Math.max(maxX,b.x+b.width);minY=Math.min(minY,b.y);maxY=Math.max(maxY,b.y+b.height);}
  if(Number.isFinite(minX))g.rect(toX(minX),0,Math.max(1,(maxX-minX)*this.scale),size).rect(0,toY(minY),size,Math.max(1,(maxY-minY)*this.scale)).fill({color:this.accent,alpha:.28});
  let used=0;const label=(text:string,x:number,y:number,vertical:boolean)=>{let t=this.rulerLabels[used];if(!t){t=new Text({text:'',style:{fontSize:9,fill:'#8f99a3',fontFamily:'system-ui, sans-serif'}});this.rulerLabels.push(t);this.rulers.addChild(t);}used++;t.text=text;t.visible=true;t.rotation=vertical?-Math.PI/2:0;t.position.set(x,y);};
  const x0=(size-this.stage.x)/this.scale,x1=(width-this.stage.x)/this.scale,y0=(size-this.stage.y)/this.scale,y1=(height-this.stage.y)/this.scale,fmt=(v:number)=>String(Math.round(v*100)/100);
  for(let v=Math.floor(x0/minor)*minor;v<=x1;v+=minor){const x=Math.round(toX(v))+.5,major=Math.abs(v/step-Math.round(v/step))<1e-6;g.moveTo(x,major?0:size-5).lineTo(x,size);if(major)label(fmt(v),x+3,1,false);}
  for(let v=Math.floor(y0/minor)*minor;v<=y1;v+=minor){const y=Math.round(toY(v))+.5,major=Math.abs(v/step-Math.round(v/step))<1e-6;g.moveTo(major?0:size-5,y).lineTo(size,y);if(major)label(fmt(v),1,y-3,true);}
  g.stroke({color:'#6b747d',width:1}).rect(0,0,size,size).fill(this.background).moveTo(0,size+.5).lineTo(width,size+.5).moveTo(size+.5,0).lineTo(size+.5,height).stroke({color:'#3a4148',width:1});
  for(let i=used;i<this.rulerLabels.length;i++)this.rulerLabels[i].visible=false;
 }
 /** Badges keep one screen size whatever the zoom or the object's own scale. */
 private sizeMarkers(){const out:Record<string,string>={};for(const [id,node] of this.nodes){const marker=node.children.find(c=>c.label==='editor-marker');if(!marker)continue;let s=1;for(let n:Container|null=node;n&&n!==this.app.stage;n=n.parent)s*=Math.max(1e-4,Math.abs(n.scale.x),Math.abs(n.scale.y));marker.scale.set(1/s);out[id]=(marker as Container&{glyph?:string}).glyph??'';}this.host.dataset.markers=JSON.stringify(out);}
 private group?: GroupDrag;
 private marquee?: Marquee;
 private selectedSet: ReadonlySet<string> = new Set();
 private tool:TransformTool='move';
 private editing=true;
 private handles=document.createElement('div');
 private handleButtons=new Map<string,HTMLButtonElement>();
 private selected: string | null = null;
 private visualSignature = "";
 private snapshot?:Scene;
 private textures=new Map<string,{texture:Texture;bitmap:ImageBitmap}>();
 private loading=new Map<string,AbortController>();
 private failed=new Set<string>();
 private wanted=new Set<string>();
 private assetRefresh=0;
 private fonts=new Set<string>();
 private fontLoads=new Set<string>();
 /** Starts loading an imported font once; the scene is re-projected when it is ready. */
 private fontFor(assetId:string):string{
  if(!assetId)return fontStack('',false);if(this.fonts.has(assetId))return fontStack(assetId,true);
  const url=this.callbacks.resolveFont?.(assetId)?.url;
  if(url&&!this.fontLoads.has(assetId)){this.fontLoads.add(assetId);void loadFont(assetId,url).then(()=>{if(this.disposed)return;this.fonts.add(assetId);this.visualSignature='';if(this.snapshot)this.sync(this.snapshot,this.selected);},()=>{this.fontLoads.delete(assetId);});}
  return fontStack(assetId,false);
 }
 private disposed = false;
 private scale = 1;
 private stageSize = {width: 960, height: 540};
 private zoom = 1;
 private pan = { x: 0, y: 0 };
 private accent = '#7caef5';
 private background = '#17191c';
 private clearVisuals(){this.eachFeature(feature=>feature.clear());for(const e of this.custom.values())e.handle.dispose();this.custom.clear();for(const d of this.callbacks.decorators?.()??[]){try{d.clear();}catch(error){this.callbacks.report?.(error);}}}
 get visualDiagnostics():Record<string,Json>[]{return [...[...this.custom].map(([entityId,v])=>({entityId,componentId:v.componentId,...v.handle.diagnostics()})),...this.features.flatMap(f=>(f.diagnostics?.()??[]).map(d=>({entityId:d.entityId,ready:d.ready,...(d.error?{error:d.error}:{})})))];}
 private customFrame(id:string):VisualFrame{return this.callbacks.visualFrame?.(id)??{token:'edit',time:0,emit:false,silent:true};}
 private updateVisuals(scene:Scene){const byId=new Map(scene.entities.map(e=>[e.id,e]));for(const[id,v]of this.custom){const c=byId.get(id)?.components.find(c=>c.id===v.componentId);if(c)v.handle.update(c.data,this.customFrame(c.id));}}
 constructor(private host: HTMLElement, private callbacks: { select(id: string | null, mode?: SelectMode): void; selectMany?(ids:readonly string[],additive:boolean):void; commitTransform(id:string,value:Transform2D,original:Transform2D):void; commitTransforms?(changes:readonly {id:string;value:Transform2D;expected:Transform2D}[]):void; flags?(id:string):EditorFlags; report?(error:unknown):void; text?(key:string):string; playing(): boolean;interact?(entityId:string):void;
 /** While playing: whether anything reacts to clicks on this object (others let clicks through). Without it every object takes clicks. */
 clickable?(entityId:string):boolean;
 /** Preview pointer in scene pixels while playing (physics dragging, script pointer hooks): presses inside the stage, moves over the canvas or while pressed. */
 runtimePointer?(phase:'down'|'move'|'up',x:number,y:number):boolean|void;resolveAsset?(id:string):{url:string}|undefined;resolveFont?(id:string):{url:string}|undefined;visuals?():readonly VisualAdapter[];visualFrame?(id:string):VisualFrame;visualEpoch?():string;visualEvent?(event:unknown):void;decorators?():readonly SceneDecorator[];features?():readonly ViewportFeature[];runtimeEntities?():readonly Scene['entities'][number][]|undefined;runtimeTime?():number;runtimeSilent?():boolean;runtimeEvent?(event:{type:string;sourceId:string;silent:boolean;event?:string}):void;commitSpatial?(change:SpatialCommit):void }) {}
 private locked:ReadonlySet<string>=new Set();
 /** True when a decorator (e.g. a layout parent) owns this entity's position; the move tool skips it. */
 positionLocked(id:string){return this.locked.has(id);}
 private decorate(scene:Scene){const decorators=this.callbacks.decorators?.()??[],locked=new Set<string>();for(const d of decorators){try{d.apply(scene.entities,id=>this.nodes.get(id),this.app.renderer,{rtl:this.rtl});for(const id of d.positionLocked?.(scene.entities)??[])locked.add(id);}catch(error){this.callbacks.report?.(error);}}this.locked=locked;}
 async init(): Promise<void> {
  const prepared:ViewportFeature[]=[];for(const feature of this.callbacks.features?.()??[])try{await feature.prepare();prepared.push(feature);}catch(error){this.callbacks.report?.(error);}
  if(this.disposed)return;
  await this.app.init({ background: this.background, antialias: true, preference: 'webgl', autoStart: false, resolution: window.devicePixelRatio || 1, autoDensity: true });
  if (this.disposed) { destroyLocalApplication(this.app); return; }
  for(const feature of prepared)try{this.features.push(feature.create({app:this.app,host:this.host,node:id=>this.nodes.get(id),editable:()=>this.editing&&!this.callbacks.playing(),select:id=>this.callbacks.select(id,'replace'),commitSpatial:change=>{if(!this.callbacks.commitSpatial)throw Error('Spatial editing unavailable');this.callbacks.commitSpatial(change);},render:()=>this.render(),report:error=>this.callbacks.report?.(error),text:key=>this.label(key),runtimeEntities:()=>this.callbacks.runtimeEntities?.(),runtimeTime:()=>this.callbacks.runtimeTime?.()??0,runtimeSilent:()=>this.callbacks.runtimeSilent?.()??false,runtimeEvent:event=>this.callbacks.runtimeEvent?.(event),flags:id=>this.callbacks.flags?.(id)??{hidden:false,locked:false}}));}catch(error){this.callbacks.report?.(error);}
  this.host.appendChild(this.app.canvas); this.app.renderer.background.color=this.background; this.host.dataset.ready = 'true'; this.host.dataset.renderer=String(this.app.renderer.type);
  this.debugOverlay.eventMode='none';this.app.stage.addChild(this.stage,this.rulers,this.readout);this.rulers.addChild(this.rulerBands);this.rulers.eventMode='none';this.readout.eventMode='none';this.readout.visible=false;this.cameraFrame.eventMode='none'; this.grid.eventMode='none';this.guideLayer.eventMode='none';this.stageMask.eventMode='none';this.game.addChild(this.onionLayer,this.content,this.ui);this.onionLayer.eventMode='none';this.stage.addChild(this.frame, this.grid, this.game, this.cameraFrame, this.deviceLayer, this.deviceLabel, this.debugOverlay,this.overlay,this.guideLayer);this.deviceLayer.eventMode='none';this.deviceLabel.eventMode='none';this.deviceLabel.visible=false;
  this.app.stage.eventMode = 'static'; this.app.stage.on('pointerdown', e => { if (e.target !== this.app.stage) return; if(e.button!==0||this.callbacks.playing()||!this.editing||this.drag||this.group){if(!this.callbacks.playing())this.callbacks.select(null);return;} const p={x:e.global.x,y:e.global.y};this.marquee={pointerId:e.pointerId,from:p,to:p,additive:e.shiftKey||e.metaKey||e.ctrlKey}; });
  this.handles.className='transform-handles';this.handles.setAttribute('role','group');this.handles.setAttribute('aria-label',this.label('transform.handles'));this.host.appendChild(this.handles);
  window.addEventListener('pointermove',this.onPointerMove);window.addEventListener('pointercancel',this.cancelPointer);window.addEventListener('lostpointercapture',this.cancelPointer);window.addEventListener('keydown',this.onKey);window.addEventListener('blur',this.cancelGesture);
  this.host.addEventListener('wheel', this.wheel, { passive: false });this.host.addEventListener('pointerdown',this.paintDown,{capture:true});this.host.addEventListener('pointerdown',this.runtimeDown);window.addEventListener('pointermove',this.runtimeMove);window.addEventListener('pointerup',this.runtimeUp);
  window.addEventListener('pointerup', this.endDrag);
  this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(this.host); this.resize();
 }
 private wheel = (e: WheelEvent) => {
  e.preventDefault();
  if(this.drag||this.group||this.marquee)return;
  if (e.ctrlKey || e.metaKey) this.zoom = Math.max(.25, Math.min(4, this.zoom * Math.exp(-e.deltaY * .005)));
  else { this.pan.x -= e.deltaX; this.pan.y -= e.deltaY; }
  this.resize();
 };
 private resize(): void {
  if (this.disposed || !this.app.renderer) return;
  const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
  if(width!==this.app.screen.width||height!==this.app.screen.height)this.cancelGesture();
  this.app.renderer.resize(width, height); this.app.stage.hitArea = new Rectangle(0, 0, width, height);
  this.scale = cameraScale({width,height},this.zoom,this.stageSize);
  this.stage.scale.set(this.scale); this.stage.position.set((width - this.stageSize.width * this.scale) / 2 + this.pan.x, (height - this.stageSize.height * this.scale) / 2 + this.pan.y);
  this.drawFrame();
  this.selection(this.selected);this.sizeMarkers();if(this.device)this.drawDevice();
 }
 /** Scene point at the middle of the visible canvas (where new objects appear). */
 viewCenter(){const bounds=this.host.getBoundingClientRect();return this.screenToScene(bounds.left+bounds.width/2,bounds.top+bounds.height/2);}
 screenToScene(clientX:number,clientY:number){const bounds=this.host.getBoundingClientRect();return this.stage.toLocal({x:clientX-bounds.left,y:clientY-bounds.top});}
 refreshAssets(){this.assetRefresh++;this.failed.clear();this.visualSignature='';if(this.snapshot)this.sync(this.snapshot,this.selected);}
 /** Active sprites' textures by state (readiness): still loading, failed to load or decode, or with no imported asset/URL. */
 get textureStates():{loading:string[];failed:string[];unresolved:string[]}{
  const out={loading:new Set<string>(),failed:new Set<string>(),unresolved:new Set<string>()};if(!this.snapshot)return{loading:[],failed:[],unresolved:[]};
  const objects=new Map(this.snapshot.entities.map(e=>[e.id,e]));
  for(const e of this.snapshot.entities){let n:typeof e|undefined=e,active=true;while(n){if(!n.active){active=false;break;}n=n.parentId?objects.get(n.parentId):undefined;}if(!active)continue;
   for(const c of e.components){if(c.type!=='pixi.sprite'||c.version!==1)continue;const p=SpriteSchema.parse(c.data),url=this.callbacks.resolveAsset?.(p.assetId)?.url,id=p.assetId||'(no texture)';
    if(!url)out.unresolved.add(id);else if(this.failed.has(url))out.failed.add(id);else if(!this.textures.has(url))out.loading.add(id);}}
  return{loading:[...out.loading],failed:[...out.failed],unresolved:[...out.unresolved]};
 }
 get missingAssets():string[]{
  if(!this.snapshot)return[];const objects=new Map(this.snapshot.entities.map(e=>[e.id,e]));
  return this.snapshot.entities.flatMap(e=>{let n:typeof e|undefined=e;while(n){if(!n.active)return[];n=n.parentId?objects.get(n.parentId):undefined;}return e.components.flatMap(c=>{if(c.type!=='pixi.sprite'||c.version!==1)return[];const p=SpriteSchema.parse(c.data),url=this.callbacks.resolveAsset?.(p.assetId)?.url;return !url||!this.textures.has(url)?[p.assetId||'(no texture)']:[];});});
 }
 private loadTexture(url:string){
  if(this.loading.has(url)||this.failed.has(url)||this.textures.has(url))return;
  const abort=new AbortController();this.loading.set(url,abort);
  void (async()=>{const response=await fetch(url,{signal:abort.signal});if(!response.ok)throw Error('Texture unavailable');const blob=await response.blob();if(blob.size>64*1024*1024)throw Error('Texture too large');const bitmap=await createImageBitmap(blob);
   if(this.disposed||abort.signal.aborted||!this.wanted.has(url)){bitmap.close();return;}
   this.textures.set(url,{texture:Texture.from(bitmap),bitmap});
  })().catch(()=>{if(!abort.signal.aborted)this.failed.add(url);}).finally(()=>{
   if(this.loading.get(url)===abort)this.loading.delete(url);
   if(!this.disposed&&this.wanted.has(url)&&this.snapshot){this.visualSignature='';this.sync(this.snapshot,this.selected);}
  });
 }
 frameSelection(id:string|null=this.selected):boolean{
  if(this.disposed||this.callbacks.playing()||!id)return false;const node=this.nodes.get(id);if(!node)return false;
  this.cancelGesture();const bounds=node.getBounds(),scale=this.stage.scale.x;
  const camera=cameraForBounds({x:(bounds.x-this.stage.x)/scale,y:(bounds.y-this.stage.y)/scale,width:bounds.width/scale,height:bounds.height/scale},{width:this.host.clientWidth,height:this.host.clientHeight},this.stageSize);this.restoreCamera(camera);return true;
 }
 /** Game look mirrored from the project's render settings: stage background and pixel-art filtering. */
 private stageBackground='#20272d';
 setGameLook(look:{background:string;pixelArt:boolean}){if(this.disposed)return;const mode=look.pixelArt?'nearest':'linear';setTextureFiltering(mode);for(const t of this.textures.values())t.texture.source.scaleMode=mode;if(look.background===this.stageBackground&&this.host.dataset.pixelArt===String(look.pixelArt))return;this.stageBackground=look.background;this.host.dataset.pixelArt=String(look.pixelArt);this.host.dataset.stageBackground=look.background;if(this.app.renderer){this.drawFrame();this.render();}}
 private drawFrame(){this.frame.clear().rect(0,0,this.stageSize.width,this.stageSize.height).fill(this.stageBackground).stroke({ color: '#8a929b', width: 1 / Math.max(.01,this.scale) });this.stageMask.clear().rect(0,0,this.stageSize.width,this.stageSize.height).fill(0xffffff);}
 /** Project stage (game resolution); the camera fits and centres this rectangle. */
 setStage(size:{width:number;height:number}):void{if(size.width===this.stageSize.width&&size.height===this.stageSize.height)return;this.cancelGesture();this.stageSize={width:size.width,height:size.height};this.host.dataset.stage=`${size.width}x${size.height}`;this.resize();this.render();}
 resetView():void{if(this.disposed||this.callbacks.playing())return;this.cancelGesture();this.restoreCamera({zoom:1,pan:{x:0,y:0}});}
 /** Smart guides: snap single moves to other objects' and the stage's edges/centres (grid snap takes precedence). */
 setGuides(enabled:boolean){this.guidesEnabled=enabled;}
 /** Game camera during play (moves the world, not the editor view); null restores the authored framing. */
 setRuntimeView(view:CameraView|null){this.lastView=view;if(this.borrowed)return;const c=this.content;if(view&&this.sceneView){this.freeView(view);return;}if(this.cameraFrame.visible){this.cameraFrame.clear();this.cameraFrame.visible=false;delete this.host.dataset.cameraFrame;}if(!view){if(c.x||c.y||c.pivot.x||c.pivot.y||c.scale.x!==1||c.angle){c.pivot.set(0,0);c.position.set(0,0);c.scale.set(1);c.angle=0;this.render();}if(this.game.mask){this.game.mask=null;this.stage.removeChild(this.stageMask);this.markers(true);this.drawRulers();this.render();}delete this.host.dataset.runtimeCamera;delete this.host.dataset.runtimeView;delete this.host.dataset.stageMask;return;}
  if(this.game.mask!==this.stageMask){this.stage.addChildAt(this.stageMask,this.stage.getChildIndex(this.game));this.game.mask=this.stageMask;this.markers(false);this.host.dataset.stageMask='true';this.drawRulers();this.render();}
  const p=viewPlacement(view,this.stageSize);if(c.pivot.x!==p.pivot.x||c.pivot.y!==p.pivot.y||c.x!==p.position.x||c.y!==p.position.y||c.scale.x!==p.scale||c.angle!==p.angle){c.pivot.set(p.pivot.x,p.pivot.y);c.position.set(p.position.x,p.position.y);c.scale.set(p.scale);c.angle=p.angle;this.render();}
  this.host.dataset.runtimeCamera=JSON.stringify(viewOffset(view,this.stageSize));this.host.dataset.runtimeView=JSON.stringify(view);}
 /** Scene view in Preview: the world unmasked at its authored place, the game camera's view drawn as a frame. */
 private freeView(view:CameraView){
  const c=this.content;if(c.x||c.y||c.pivot.x||c.pivot.y||c.scale.x!==1||c.angle){c.pivot.set(0,0);c.position.set(0,0);c.scale.set(1);c.angle=0;}
  if(this.game.mask){this.game.mask=null;this.stage.removeChild(this.stageMask);this.markers(true);delete this.host.dataset.stageMask;this.drawRulers();}
  const p=viewPlacement(view,this.stageSize),a=p.angle*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a),k=1/Math.max(1e-6,p.scale),{width,height}=this.stageSize;
  const pts=[[0,0],[width,0],[width,height],[0,height]].map(([x,y])=>{const dx=(x-p.position.x)*k,dy=(y-p.position.y)*k;return{x:p.pivot.x+dx*cos+dy*sin,y:p.pivot.y-dx*sin+dy*cos};});
  this.cameraFrame.clear().poly(pts.flatMap(q=>[q.x,q.y])).stroke({color:'#f2c94c',width:2/Math.max(.01,this.scale)});this.cameraFrame.visible=true;
  this.host.dataset.cameraFrame=JSON.stringify(pts.map(q=>[Math.round(q.x),Math.round(q.y)]));this.host.dataset.runtimeCamera=JSON.stringify(viewOffset(view,this.stageSize));this.host.dataset.runtimeView=JSON.stringify(view);this.render();
 }
 /** The object's own visuals (not its child objects or editor badge) in its local space: where a pivot preset points. */
 ownBounds(id:string){const node=this.nodes.get(id);if(!node)return null;const entities=new Set(this.nodes.values());let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const child of node.children){if(entities.has(child as Container)||child.label==='editor-marker'||!child.visible)continue;const b=child.getLocalBounds();for(const [x,y] of [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]]){const p=node.toLocal({x,y},child);minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}}
  return Number.isFinite(minX)?{x:minX,y:minY,width:maxX-minX,height:maxY-minY}:null;}
 /** An entity's origin in world (content) coordinates, independent of the camera offset. */
 contentPosition(id:string){const node=this.nodes.get(id);if(!node)return undefined;const p=this.content.toLocal(node.toGlobal({x:node.pivot.x,y:node.pivot.y}));return{x:p.x,y:p.y};}
 /**
  * Painting tool (e.g. tilemap brush): while set, left-button strokes on the canvas go to `paint` in the entity's
  * local space instead of selecting or moving; Escape or a cancelled pointer ends the stroke with `cancel`.
  */
 private painter:{entityId:string|null;paint(local:{x:number;y:number},phase:'start'|'move'|'end'|'cancel'):void}|null=null;private painting?:number;
 setPainter(painter:{entityId:string|null;paint(local:{x:number;y:number},phase:'start'|'move'|'end'|'cancel'):void}|null){if(this.painting!==undefined)this.painter?.paint({x:0,y:0},'cancel');this.painting=undefined;this.painter=painter;this.host.dataset.painting=painter?(painter.entityId??'world'):'';}
 private paintLocal(e:PointerEvent){const node=this.painter?(this.painter.entityId?this.nodes.get(this.painter.entityId):this.stage):undefined;if(!node)return undefined;const b=this.host.getBoundingClientRect(),p=node.toLocal({x:e.clientX-b.left,y:e.clientY-b.top});return Number.isFinite(p.x)&&Number.isFinite(p.y)?{x:p.x,y:p.y}:undefined;}
 /** While playing, the pointer in content (scene) space goes to the runtime: down on the canvas, move and up anywhere. */
 private runtimePoint(e:PointerEvent){const b=this.host.getBoundingClientRect(),p=this.content.toLocal({x:e.clientX-b.left,y:e.clientY-b.top});return Number.isFinite(p.x)&&Number.isFinite(p.y)?p:undefined;}
 private runtimeHeld=false;
 private runtimeDown=(e:PointerEvent)=>{if(!this.callbacks.playing()||e.button!==0)return;const b=this.host.getBoundingClientRect(),s=this.stage.toLocal({x:e.clientX-b.left,y:e.clientY-b.top});if(!(s.x>=0&&s.y>=0&&s.x<=this.stageSize.width&&s.y<=this.stageSize.height))return;const p=this.runtimePoint(e);if(p){this.runtimeHeld=true;this.callbacks.runtimePointer?.('down',p.x,p.y);}};
 private runtimeMove=(e:PointerEvent)=>{if(!this.callbacks.playing()||!this.runtimeHeld&&!(e.target instanceof Node&&this.host.contains(e.target)))return;const p=this.runtimePoint(e);if(p)this.callbacks.runtimePointer?.('move',p.x,p.y);};
 private runtimeUp=(e:PointerEvent)=>{if(!this.runtimeHeld)return;this.runtimeHeld=false;const p=this.runtimePoint(e);this.callbacks.runtimePointer?.('up',p?.x??0,p?.y??0);};
 private paintDown=(e:PointerEvent)=>{if(!this.painter||e.button!==0||!this.editing||this.callbacks.playing())return;const local=this.paintLocal(e);if(!local)return;e.stopPropagation();e.preventDefault();this.painting=e.pointerId;try{this.host.setPointerCapture(e.pointerId);}catch{/* synthetic pointer */}this.painter.paint(local,'start');const move=(m:PointerEvent)=>{if(m.pointerId!==this.painting)return;const p=this.paintLocal(m);if(p)this.painter?.paint(p,'move');},up=(u:PointerEvent)=>{if(u.pointerId!==this.painting)return;finish(this.paintLocal(u),'end');},cancel=()=>finish(undefined,'cancel'),key=(k:KeyboardEvent)=>{if(k.key==='Escape'){k.preventDefault();cancel();}},finish=(p:{x:number;y:number}|undefined,phase:'end'|'cancel')=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',key,true);if(this.painting===undefined)return;this.painting=undefined;this.painter?.paint(p??{x:0,y:0},phase);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',key,true);};
 private showGuides(lines:GuideLine[]){this.activeGuides=lines;this.guideLayer.clear();const {width,height}=this.stageSize,pad=4000;for(const l of lines){if(l.axis==='x')this.guideLayer.moveTo(l.value,-pad).lineTo(l.value,height+pad);else this.guideLayer.moveTo(-pad,l.value).lineTo(width+pad,l.value);}if(lines.length)this.guideLayer.stroke({color:'#ff4fa3',width:1/Math.max(.01,this.scale)});this.host.dataset.guides=JSON.stringify(lines);}
 setGridSettings(settings:GridSettings):void{this.cancelGesture();this.gridSettings=readGridSettings(settings);this.selection(this.selected);}
 /** Dots that show objects without a visual while editing; Preview hides them like the game does. */
 private markers(visible:boolean){for(const node of this.nodes.values())for(const child of node.children)if(child.label==='editor-marker')child.visible=visible;}
 /** A small PNG of the stage as the game shows it (edit mode only): the Hub's project thumbnail. */
 /** One extraction at a time: a second call while one runs shares it (the game is borrowed from the stage meanwhile). */
 private thumbnailing:Promise<string|null>|null=null;
 /** True while the game is lent to a thumbnail: overlays drawn now would use the wrong space, so they wait. */
 private borrowed=false;
 thumbnail(width=320):Promise<string|null>{if(!this.thumbnailing)this.thumbnailing=this.extractThumbnail(width).finally(()=>{this.thumbnailing=null;});return this.thumbnailing;}
 private async extractThumbnail(width:number):Promise<string|null>{
  if(this.disposed||!this.app.renderer||this.callbacks.playing())return null;
  const {width:w,height:h}=this.stageSize,box=new Container(),bg=new Graphics().rect(0,0,w,h).fill(this.stageBackground),parent=this.game.parent,index=parent?.getChildIndex(this.game)??0;
  // The game leaves the stage while it is extracted: hold the ticker so no frame shows the stage without it.
  const ticking=this.app.ticker.started;this.app.ticker.stop();
  box.addChild(bg,this.game);this.markers(false);this.borrowed=true;
  try{return await this.app.renderer.extract.base64({target:box,frame:new Rectangle(0,0,w,h),resolution:width/w,format:'png'});}
  finally{this.markers(true);box.removeChild(this.game);parent?.addChildAt(this.game,index);this.borrowed=false;bg.destroy();box.destroy();this.setRuntimeView(this.lastView);this.selection(this.selected);this.render();if(ticking)this.app.ticker.start();}
 }
 captureCamera() { return {zoom:this.zoom,pan:{...this.pan}}; }
 restoreCamera(camera:{zoom:number;pan:{x:number;y:number}}):void {this.zoom=camera.zoom;this.pan={...camera.pan};this.resize();}
 setTheme(background: string, accent: string): void { this.background = background; this.accent = accent; if (this.app.renderer) { this.app.renderer.background.color = background; this.selection(this.selected); } }
 sync(scene: Scene, selected: string | null): void {
  const original=scene;scene=project2DScene(scene);
  if (this.disposed || !this.app.renderer) return;
  if(this.drag){if(scene===this.snapshot&&selected===this.drag.id&&!this.callbacks.playing()){this.selection(selected);return;}this.cancelGesture();}
  if(this.group){if(scene===this.snapshot&&!this.callbacks.playing()){this.selection(selected);return;}this.cancelGesture();}
  this.snapshot=scene;
  const requested=new Set(scene.entities.flatMap(e=>e.components.flatMap(c=>{if(c.type!=='pixi.sprite'||c.version!==1)return[];const url=this.callbacks.resolveAsset?.(SpriteSchema.parse(c.data).assetId)?.url;return url?[url]:[];})));
  this.wanted=requested;
  for(const [url,load]of this.loading)if(!requested.has(url)){load.abort();this.loading.delete(url);}
  // Destroy old display objects before releasing a texture they may reference.
  const stale=[...this.textures.keys()].some(url=>!requested.has(url));if(stale){this.clearVisuals();for(const layer of [this.content,this.ui])layer.removeChildren().forEach(child=>child.destroy({children:true,context:true}));this.nodes.clear();this.texts.clear();this.visualSignature='';for(const [url,value]of this.textures)if(!requested.has(url)){value.texture.destroy(true);value.bitmap.close();this.textures.delete(url);}}
  for(const url of requested)this.loadTexture(url);
  const resourceSignature=[...requested].map(url=>[url,this.textures.has(url),this.failed.has(url),this.assetRefresh]);
  const adapters=this.callbacks.visuals?.()??[];
  const signature=JSON.stringify([this.callbacks.visualEpoch?.(),this.rtl,resourceSignature,scene.entities.map(e=>({id:e.id,parentId:e.parentId,name:e.name,components:e.components.filter(c=>c.type!=='scene.transform2d').map(c=>{const adapter=adapters.find(a=>a.type===c.type&&a.version===c.version);return adapter?{id:c.id,type:c.type,version:c.version,key:adapter.key(c.data)}:visualKey(c);})}))]);
  if(signature===this.visualSignature){
   for(const e of scene.entities){const n=this.nodes.get(e.id)!;const c=e.components.find(c=>c.type==='scene.transform2d');const t=c?.version===1?transform(e):{x:0,y:0,rotation:0,scaleX:1,scaleY:1};n.position.set(t.x,t.y);n.angle=t.rotation;n.scale.set(t.scaleX,t.scaleY);n.skew.set((t.skewX??0)*Math.PI/180,(t.skewY??0)*Math.PI/180);n.pivot.set(t.pivotX??0,t.pivotY??0);this.applyFlags(n,e);const visual=e.components.find(c=>['pixi.shape','pixi.text','pixi.bitmapText','pixi.sprite'].includes(c.type)&&c.version===1);if(visual&&n.children[0])n.children[0].alpha=Number((visual.data as {alpha?:number}).alpha??1);}
   // Text content is outside the signature (Play rewrites templated text every change), so it updates in place.
   for(const e of scene.entities)for(const c of e.components){const node=this.texts.get(c.id);if(!node)continue;const text=String((c.data as {text?:unknown}).text??''),next=node instanceof Text?bidiText(text):text;if(node.text!==next)node.text=next;}
   this.updateVisuals(scene);this.decorate(scene);this.eachFeature(feature=>feature.sync(original,selected));this.selection(selected);this.sizeMarkers();return;
  }
  this.visualSignature=signature;
  this.clearVisuals();for(const layer of [this.content,this.ui])layer.removeChildren().forEach(child => child.destroy({children:true,context:true})); this.nodes.clear();this.texts.clear();
  this.drawFrame();
  for (const entity of scene.entities) {
   const node = new Container(), supported=entity.components.some(c=>c.type==='scene.transform2d'&&c.version===1), t = supported?transform(entity):{x:0,y:0,rotation:0,scaleX:1,scaleY:1};
   node.position.set(t.x,t.y); node.angle = t.rotation; node.scale.set(t.scaleX,t.scaleY);node.skew.set((t.skewX??0)*Math.PI/180,(t.skewY??0)*Math.PI/180);node.pivot.set(t.pivotX??0,t.pivotY??0); this.applyFlags(node,entity);
   node.label = entity.id; node.cursor = 'pointer';
   for (const component of entity.components) {
    if (component.type === 'pixi.shape' && component.version===1) { const p = ShapeSchema.parse(component.data); node.addChild(drawShape(p));node.children[0].alpha=p.alpha; }
    if (component.type === 'pixi.text' && component.version===1) { const p = TextSchema.parse(component.data); const text = new Text({ text: bidiText(p.text), style: textStyle(p, this.fontFor(p.font), this.rtl) }); text.anchor.set(.5); node.addChild(text);text.alpha=p.alpha;this.texts.set(component.id,text); }
    if (component.type === 'pixi.bitmapText' && component.version===1) { const p = BitmapTextSchema.parse(component.data); const text = new BitmapText({ text: p.text, style: bitmapTextStyle(p, this.fontFor(p.font)) }); text.anchor.set(.5); node.addChild(text);text.alpha=p.alpha;this.texts.set(component.id,text); }
   }
   for(const component of entity.components)if(component.type==='pixi.sprite'&&component.version===1){
    const p=SpriteSchema.parse(component.data),url=this.callbacks.resolveAsset?.(p.assetId)?.url,resource=url?this.textures.get(url):undefined;
    if(resource){const sprite=new Sprite(resource.texture);sprite.anchor.set(p.anchorX,p.anchorY);sprite.width=p.width;sprite.height=p.height;sprite.alpha=p.alpha;sprite.tint=p.tint;node.addChild(sprite);}
    else{const placeholder=new Graphics().rect(-p.anchorX*p.width,-p.anchorY*p.height,p.width,p.height).fill('#4d3747').stroke({color:'#d29bbd',width:1}).moveTo(-p.anchorX*p.width,-p.anchorY*p.height).lineTo((1-p.anchorX)*p.width,(1-p.anchorY)*p.height).stroke({color:'#d29bbd',width:1});node.addChild(placeholder);}
   }
   for(const component of entity.components){const adapter=adapters.find(a=>a.type===component.type&&a.version===component.version);if(adapter){const handle=adapter.create(component.data,{entityId:entity.id,componentId:component.id,frame:()=>this.customFrame(component.id),changed:()=>{if(!this.disposed)this.selection(this.selected);},event:event=>this.callbacks.visualEvent?.(event)});node.addChild(handle.view);this.custom.set(entity.id,{componentId:component.id,handle});}}
   if (!node.children.length&&!(this.callbacks.features?.()??[]).some(f=>f.ownsVisual?.(entity))){const marker=createMarker(entity.name,entity.components.map(c=>c.type));marker.visible=!this.game.mask||this.sceneView;node.addChild(marker);}
   node.on('pointertap',e=>{if(!this.callbacks.playing())return;e.stopPropagation();const clickable=this.callbacks.clickable,id=clickable?clickTarget(this.app.renderer.events,e.global,n=>{for(const feature of this.features){const id=feature.hitEntity?.(n,e.global,clickable);if(id)return id;}for(const [k,v] of this.nodes)if(v===n)return k;return undefined;},clickable):entity.id;if(id)this.callbacks.interact?.(id);});
   node.on('pointerdown', e => {
    e.stopPropagation(); if (this.callbacks.playing()) return;
    if(e.button!==0)return;
    if(e.shiftKey||e.metaKey||e.ctrlKey){this.callbacks.select(entity.id,'toggle');return;}
    const grouped=this.selectedSet.size>1&&this.selectedSet.has(entity.id);
    if(!grouped)this.callbacks.select(entity.id,'replace');
    if(supported&&this.tool==='move'&&(grouped||!this.locked.has(entity.id))){if(grouped)this.beginGroup(e.pointerId,e.clientX,e.clientY,this.app.canvas);else this.beginGesture(entity.id,e.pointerId,e.clientX,e.clientY,'move','xy',this.app.canvas);}
   });
   this.nodes.set(entity.id,node);
  }
  for (const e of scene.entities) { const node = this.nodes.get(e.id)!; (e.parentId ? this.nodes.get(e.parentId)! : screenSpace(e) ? this.ui : this.content).addChild(node); }
  this.updateVisuals(scene);this.decorate(scene);this.eachFeature(feature=>feature.sync(original,selected));this.selection(selected);this.sizeMarkers(); this.render();
 }
 private outline(node:Container){const b=node.getLocalBounds(),points=[[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(([x,y])=>this.stage.toLocal(node.toGlobal({x,y})));this.overlay.moveTo(points[0].x,points[0].y);for(const p of [...points.slice(1),points[0]])this.overlay.lineTo(p.x,p.y);this.overlay.stroke({color:this.background,width:4/Math.max(.01,this.scale)}).stroke({color:this.accent,width:1.5/Math.max(.01,this.scale)});}
 private visible(node:Container):boolean{let current:Container|null=node;while(current){if(!current.visible)return false;current=current.parent;}return true;}
 private label(key:string){return this.callbacks.text?.(key)??key;}
 /** Editor-only hide/lock: never applied while playing, so Preview and export are unaffected. */
 private applyFlags(node:Container,entity:Scene['entities'][number]){const editing=!this.callbacks.playing(),flags=editing?this.callbacks.flags?.(entity.id):undefined;node.visible=entity.active&&!flags?.hidden;node.eventMode=entity.active&&!flags?.locked?'static':'none';}
 /** Full selection set (primary included); outlines are drawn for all, transform handles only for a single object. */
 setSelection(ids:readonly string[],primary:string|null){this.selectedSet=new Set(ids);if(this.group&&![...this.group.items].every(i=>this.selectedSet.has(i.id)))this.cancelGesture();this.selection(primary);}
 /** Axis-aligned bounds in scene (stage) coordinates. */
 sceneBounds(ids:readonly string[]):Map<string,{x:number;y:number;width:number;height:number}>{const out=new Map<string,{x:number;y:number;width:number;height:number}>(),s=Math.max(.01,this.stage.scale.x);for(const id of ids){const node=this.nodes.get(id);if(!node)continue;const b=node.getBounds();out.set(id,{x:(b.x-this.stage.x)/s,y:(b.y-this.stage.y)/s,width:b.width/s,height:b.height/s});}return out;}
 private interactive(node:Container){let current:Container|null=node;while(current&&current!==this.content&&current!==this.ui){if(!current.visible||current.eventMode==='none')return false;current=current.parent;}return true;}
 private beginGroup(pointerId:number,clientX:number,clientY:number,capture:HTMLElement){
  if(!this.editing||this.callbacks.playing()||this.drag||this.group||!this.snapshot)return;
  const byId=new Map(this.snapshot.entities.map(e=>[e.id,e])),items=[...this.selectedSet].filter(id=>{for(let p=byId.get(id)?.parentId;p;p=byId.get(p)?.parentId)if(this.selectedSet.has(p))return false;return true;}).flatMap(id=>{const node=this.nodes.get(id),entity=byId.get(id);return node?.parent&&!this.locked.has(id)&&entity?.components.some(c=>c.type==='scene.transform2d'&&c.version===1)?[{id,node,start:transform(entity)}]:[];});
  if(!items.length)return;const bounds=this.host.getBoundingClientRect();
  this.group={pointerId,from:{x:clientX-bounds.left,y:clientY-bounds.top},items,capture,moved:false};
  try{capture.setPointerCapture(pointerId);}catch{/* Synthetic events may not have a capture target. */}
 }
 private drawMarquee(){const m=this.marquee;if(!m||Math.hypot(m.to.x-m.from.x,m.to.y-m.from.y)<3)return;const a=this.stage.toLocal(m.from),b=this.stage.toLocal(m.to);this.overlay.rect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y)).fill({color:this.accent,alpha:.08}).stroke({color:this.accent,width:1/Math.max(.01,this.scale)});}
 private finishMarquee(){
  const m=this.marquee;if(!m)return;this.marquee=undefined;
  if(Math.hypot(m.to.x-m.from.x,m.to.y-m.from.y)<3){if(!m.additive)this.callbacks.select(null);else this.selection(this.selected);return;}
  const box={minX:Math.min(m.from.x,m.to.x),minY:Math.min(m.from.y,m.to.y),maxX:Math.max(m.from.x,m.to.x),maxY:Math.max(m.from.y,m.to.y)},hit=new Set<string>();
  for(const[id,node]of this.nodes){if(!this.interactive(node))continue;const b=node.getBounds();if(b.x<=box.maxX&&b.x+b.width>=box.minX&&b.y<=box.maxY&&b.y+b.height>=box.minY)hit.add(id);}
  const byId=new Map(this.snapshot?.entities.map(e=>[e.id,e])??[]),ids=[...hit].filter(id=>{for(let p=byId.get(id)?.parentId;p;p=byId.get(p)?.parentId)if(hit.has(p))return false;return true;});
  if(this.callbacks.selectMany)this.callbacks.selectMany(ids,m.additive);else this.selection(this.selected);
 }
 setTool(tool:TransformTool){if(this.tool===tool)return;this.cancelGesture();this.tool=tool;this.selection(this.selected);}
 setEditing(editing:boolean){this.editing=editing;if(!editing)this.cancelGesture();this.selection(this.selected);}
 private apply(node:Container,t:Transform2D){node.position.set(t.x,t.y);node.angle=t.rotation;node.scale.set(t.scaleX,t.scaleY);node.skew.set((t.skewX??0)*Math.PI/180,(t.skewY??0)*Math.PI/180);node.pivot.set(t.pivotX??0,t.pivotY??0);}
 private beginGesture(id:string,pointerId:number,clientX:number,clientY:number,tool:TransformTool,axis:TransformAxis,capture:HTMLElement){
  if(!this.editing||this.callbacks.playing()||this.drag||tool==='move'&&this.locked.has(id))return;
  const node=this.nodes.get(id),entity=this.snapshot?.entities.find(e=>e.id===id);
  if(!node?.parent||!entity||!entity.components.some(c=>c.type==='scene.transform2d'&&c.version===1))return;
  const bounds=this.host.getBoundingClientRect(),from=node.parent.toLocal({x:clientX-bounds.left,y:clientY-bounds.top}),start=transform(entity);
  if(!Number.isFinite(from.x)||!Number.isFinite(from.y))return;
  this.drag={id,pointerId,node,start,from:{x:from.x,y:from.y},tool,axis,previousAngle:pointerAngle(from,start),rotationDelta:0,capture};
  this.dragOrigin={x:clientX,y:clientY,moved:false};
  if(tool==='move'&&this.guidesEnabled&&this.snapshot){const moving=new Set([id]);let grown=true;while(grown){grown=false;for(const e of this.snapshot.entities)if(e.parentId&&moving.has(e.parentId)&&!moving.has(e.id)){moving.add(e.id);grown=true;}}const others=[...this.nodes.keys()].filter(other=>!moving.has(other)&&this.visible(this.nodes.get(other)!)&&!this.locked.has(other));this.targets=guideTargets([...this.sceneBounds(others).values()].filter(b=>b.width>0&&b.height>0),this.stageSize);}
  try{capture.setPointerCapture(pointerId);}catch{/* Synthetic events may not have a capture target. */}
 }
 private onPointerMove=(e:PointerEvent)=>{
  const bounds0=this.host.getBoundingClientRect(),local={x:e.clientX-bounds0.left,y:e.clientY-bounds0.top};
  // A marquee never outlives the button: a missed pointerup (other window, synthetic input) ends it on the next move.
  if(this.marquee){if((e.buttons&1)===0){this.marquee.to=local;this.finishMarquee();return;}this.marquee.to=local;this.selection(this.selected);return;}
  const group=this.group;
  if(group&&e.pointerId===group.pointerId){
   if(Math.hypot(local.x-group.from.x,local.y-group.from.y)>2)group.moved=true;
   for(const item of group.items){const p0=item.node.parent!.toLocal(group.from),p1=item.node.parent!.toLocal(local);if(![p0.x,p0.y,p1.x,p1.y].every(Number.isFinite))continue;this.apply(item.node,{...item.start,x:item.start.x+p1.x-p0.x,y:item.start.y+p1.y-p0.y});}
   if(group.moved){this.preview(group.items.map(i=>[i.id,i.node] as const));const i=group.items[0],r=(v:number)=>Math.round(v*10)/10;if(i)this.showReadout(`Δx ${r(i.node.x-i.start.x)}  Δy ${r(i.node.y-i.start.y)}  ·  ${group.items.length} objects`,e.clientX,e.clientY);}
   this.selection(this.selected);return;
  }
  const drag=this.drag;if(!drag||e.pointerId!==drag.pointerId)return;
  const bounds=this.host.getBoundingClientRect(),point=drag.node.parent!.toLocal({x:e.clientX-bounds.left,y:e.clientY-bounds.top});
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return;
  if(drag.tool==='rotate'){const angle=pointerAngle(point,drag.start);drag.rotationDelta+=angleStep(drag.previousAngle,angle);drag.previousAngle=angle;}
  const value=evaluateTransform(drag.start,drag.from,point,drag.tool,drag.axis,e.shiftKey,drag.rotationDelta),snapped=this.gridSettings.snap&&drag.tool==='move'?snapMove(value,drag.axis,this.gridSettings.step):value;this.apply(drag.node,snapped);
  if(this.dragOrigin&&!this.dragOrigin.moved&&Math.hypot(e.clientX-this.dragOrigin.x,e.clientY-this.dragOrigin.y)>3)this.dragOrigin.moved=true;
  if(drag.tool==='move'&&this.targets&&this.dragOrigin?.moved&&!this.gridSettings.snap&&!e.altKey){const box=this.sceneBounds([drag.id]).get(drag.id);if(box){const hit=snapToGuides(box,this.targets,6/Math.max(.01,this.scale)),dx=drag.axis==='y'?0:hit.dx,dy=drag.axis==='x'?0:hit.dy;if(dx||dy){const parent=drag.node.parent!,a=parent.toLocal(this.stage.toGlobal({x:0,y:0})),b=parent.toLocal(this.stage.toGlobal({x:dx,y:dy}));const tidy=(v:number)=>Math.round(v*1e6)/1e6;/* the stage↔parent conversion leaves float noise (299.99999999999994): a snapped position lands on the guide */this.apply(drag.node,{...snapped,x:tidy(snapped.x+b.x-a.x),y:tidy(snapped.y+b.y-a.y)});}this.showGuides(hit.guides.filter(g=>g.axis==='x'?drag.axis!=='y':drag.axis!=='x'));}}
  this.preview([[drag.id,drag.node]]);
  if(this.dragOrigin?.moved){const n=drag.node,st=drag.start,r=(v:number)=>Math.round(v*10)/10;this.showReadout(drag.tool==='move'?`Δx ${r(n.x-st.x)}  Δy ${r(n.y-st.y)}  ·  ${r(n.x)}, ${r(n.y)}`:drag.tool==='rotate'?`${r(n.angle)}°  (Δ ${r(n.angle-st.rotation)}°)`:`${n.scale.x.toFixed(2)} × ${n.scale.y.toFixed(2)}`,e.clientX,e.clientY);}
  this.selection(drag.id);
 };
 private release(drag:Drag){this.targets=undefined;this.dragOrigin=undefined;this.showGuides([]);try{if(drag.capture.hasPointerCapture(drag.pointerId))drag.capture.releasePointerCapture(drag.pointerId);}catch{/* The capture target may already have been removed. */}}
 private endDrag=(e:PointerEvent)=>{
  if(this.marquee){const bounds=this.host.getBoundingClientRect();this.marquee.to={x:e.clientX-bounds.left,y:e.clientY-bounds.top};this.finishMarquee();return;}
  const group=this.group;
  if(group&&e.pointerId===group.pointerId){
   this.onPointerMove(e);this.group=undefined;try{if(group.capture.hasPointerCapture(group.pointerId))group.capture.releasePointerCapture(group.pointerId);}catch{/* already released */}
   const changes=group.items.map(i=>({id:i.id,value:{...i.start,x:i.node.x,y:i.node.y,rotation:i.node.angle,scaleX:i.node.scale.x,scaleY:i.node.scale.y},expected:i.start})).filter(c=>c.value.x!==c.expected.x||c.value.y!==c.expected.y);
   if(group.moved&&changes.length){try{this.callbacks.commitTransforms?.(changes);}catch(error){this.callbacks.report?.(error);}}
   this.endPreview();
   if(this.snapshot)this.sync(this.snapshot,this.selected);return;
  }
  const drag=this.drag;if(!drag||e.pointerId!==drag.pointerId)return;
  this.onPointerMove(e);this.drag=undefined;this.release(drag);
  const node=drag.node,value={...drag.start,x:node.x,y:node.y,rotation:node.angle,scaleX:node.scale.x,scaleY:node.scale.y};
  try{this.callbacks.commitTransform(drag.id,value,drag.start);}catch(error){this.callbacks.report?.(error);}
  this.endPreview();
  // A rejected/no-op transaction must also restore the authoring projection.
  if(this.snapshot)this.sync(this.snapshot,this.selected);
 };
 private cancelPointer=(e:PointerEvent)=>{if(e.pointerId===this.drag?.pointerId||e.pointerId===this.group?.pointerId||this.marquee)this.cancelGesture();};
 private cancelGesture=()=>{this.endPreview();if(this.marquee){this.marquee=undefined;this.selection(this.selected);}const group=this.group;if(group){this.group=undefined;try{if(group.capture.hasPointerCapture(group.pointerId))group.capture.releasePointerCapture(group.pointerId);}catch{/* already released */}for(const i of group.items)this.apply(i.node,i.start);this.selection(this.selected);}const drag=this.drag;if(!drag)return;this.drag=undefined;this.release(drag);this.apply(drag.node,drag.start);this.selection(this.selected);};
 private onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&(this.drag||this.group||this.marquee)){e.preventDefault();this.cancelGesture();}};
 private handle(id:string,key:string,x:number,y:number,tool:TransformTool,axis:TransformAxis){
  let button=this.handleButtons.get(key);
  if(!button){button=document.createElement('button');button.type='button';button.className='transform-handle';button.dataset.handle=key;button.textContent=key==='move-x'?'X':key==='move-y'?'Y':'';button.setAttribute('aria-label',this.label(`transform.${key}`));button.title=this.label(`transform.${key}`);
   button.onpointerdown=e=>{e.stopPropagation();if(e.button!==0)return;e.preventDefault();this.beginGesture(this.selected!,e.pointerId,e.clientX,e.clientY,tool,axis,button!);};
   button.onkeydown=e=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||!this.editing||this.callbacks.playing())return;e.preventDefault();e.stopPropagation();
    const entity=this.snapshot?.entities.find(n=>n.id===this.selected);if(!entity)return;const start=transform(entity),value={...start},sign=e.key==='ArrowLeft'||e.key==='ArrowDown'?-1:1,amount=e.shiftKey?10:1;
    if(tool==='move'){const x=axis==='x'||axis==='xy'&&(e.key==='ArrowLeft'||e.key==='ArrowRight'),key=x?'x':'y',direction=e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1;value[key]=this.gridSettings.snap?gridNudge(start[key],direction,this.gridSettings.step,amount):start[key]+direction*amount;}
    else if(tool==='rotate')value.rotation+=sign*(e.shiftKey?15:1);
    else{const factor=1+sign*(e.shiftKey?.1:.01);if(axis!=='y')value.scaleX=Math.max(.01,Math.min(100,start.scaleX*factor));if(axis!=='x')value.scaleY=Math.max(.01,Math.min(100,start.scaleY*factor));}
    try{this.callbacks.commitTransform(entity.id,value,start);}catch(error){this.callbacks.report?.(error);}
   };
   this.handleButtons.set(key,button);this.handles.appendChild(button);
  }
  button.hidden=false;button.style.left=`${x}px`;button.style.top=`${y}px`;button.dataset.entity=id;
 }
 selection(id: string | null): void {
  this.selected=id;this.eachFeature(feature=>feature.selection?.(id));if(this.borrowed)return;this.drawRulers();this.overlay.clear();for(const button of this.handleButtons.values())button.hidden=true;
  const all=new Set(this.selectedSet);if(id)all.add(id);const single=all.size<=1;
  if(!this.callbacks.playing())for(const other of all){const n=other===id?undefined:this.nodes.get(other);if(n&&this.visible(n))this.outline(n);}
  const node=id?this.nodes.get(id):undefined,entity=this.snapshot?.entities.find(e=>e.id===id);
  if(node&&this.visible(node)&&!this.callbacks.playing()){
   const b=node.getLocalBounds(),corners=[[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(([x,y])=>node.toGlobal({x,y}));
   const points=corners.map(p=>this.stage.toLocal(p));
   this.overlay.moveTo(points[0].x,points[0].y);for(const p of [...points.slice(1),points[0]])this.overlay.lineTo(p.x,p.y);this.overlay.stroke({color:this.background,width:4/Math.max(.01,this.scale)}).stroke({color:this.accent,width:1.5/Math.max(.01,this.scale)});
   if(single&&this.editing&&entity?.components.some(c=>c.type==='scene.transform2d'&&c.version===1)){
    const origin=node.toGlobal({x:node.pivot.x,y:node.pivot.y});
    if(this.tool==='scale')for(const[i,p]of corners.entries()){if(Math.hypot(p.x-origin.x,p.y-origin.y)>1)this.handle(id!,`scale-${i}`,p.x,p.y,'scale','xy');}
    else if(this.tool==='rotate'){
     const top=node.toGlobal({x:b.x+b.width/2,y:b.y});let dx=top.x-origin.x,dy=top.y-origin.y,length=Math.hypot(dx,dy);if(length<1e-6){dx=0;dy=-1;length=1;}
     const end={x:top.x+dx/length*30,y:top.y+dy/length*30},a=this.stage.toLocal(top),z=this.stage.toLocal(end);
     this.overlay.moveTo(a.x,a.y).lineTo(z.x,z.y).stroke({color:this.background,width:4/Math.max(.01,this.scale)}).stroke({color:this.accent,width:1.5/Math.max(.01,this.scale)});this.handle(id!,'rotate',end.x,end.y,'rotate','xy');
    }else{
     const parent=node.parent!,axis=(dx:number,dy:number)=>{const p=parent.toGlobal({x:node.x+dx,y:node.y+dy}),length=Math.hypot(p.x-origin.x,p.y-origin.y)||1;return{x:origin.x+(p.x-origin.x)/length*55,y:origin.y+(p.y-origin.y)/length*55};};
     for(const key of ['x','y']as const){const end=axis(key==='x'?1:0,key==='y'?1:0),a=this.stage.toLocal(origin),b=this.stage.toLocal(end);this.overlay.moveTo(a.x,a.y).lineTo(b.x,b.y).stroke({color:this.background,width:4/Math.max(.01,this.scale)}).stroke({color:this.accent,width:1.5/Math.max(.01,this.scale)});this.handle(id!,`move-${key}`,end.x,end.y,'move',key);}
     this.handle(id!,'move-xy',origin.x,origin.y,'move','xy');
    }
   }
  }
  this.drawMarquee();this.host.dataset.selection=JSON.stringify([...all]);
  this.host.dataset.transformTool=this.tool;this.host.dataset.manipulating=String(Boolean(this.drag||this.group));this.render();
 }
 setDecorations(shapes:readonly ViewportDecoration[],renderNow=true){this.decorations=shapes;this.host.dataset.decorations=String(shapes.length);if(renderNow)this.render();}
 private drawDecorations(){this.debugOverlay.clear();let count=0;for(const shape of this.decorations){const node=shape.entityId?this.nodes.get(shape.entityId):undefined;if(shape.entityId&&(!node||!this.visible(node)))continue;if(shape.points.length<2)continue;const points=shape.points.map(p=>node?this.stage.toLocal(node.toGlobal(p)):p);this.debugOverlay.moveTo(points[0].x,points[0].y);for(const p of [...points.slice(1),points[0]])this.debugOverlay.lineTo(p.x,p.y);this.debugOverlay.stroke({color:shape.color??this.accent,width:1.5/Math.max(.01,this.scale)});count++;}this.host.dataset.decorations=String(count);}
 private drawGrid():void{
  this.grid.clear();const visible=this.gridSettings.visible&&!this.callbacks.playing(),parent=this.selected?this.nodes.get(this.selected)?.parent:undefined,plane=parent??this.content;let lines=0,displayStep=this.gridSettings.step;
  if(visible){const corners=[[0,0],[this.app.screen.width,0],[this.app.screen.width,this.app.screen.height],[0,this.app.screen.height]].map(([x,y])=>plane.toLocal({x,y})),result=gridLines({minX:Math.min(...corners.map(p=>p.x)),minY:Math.min(...corners.map(p=>p.y)),maxX:Math.max(...corners.map(p=>p.x)),maxY:Math.max(...corners.map(p=>p.y))},this.gridSettings.step);displayStep=result.step;
   for(const [from,to]of result.segments){const a=this.stage.toLocal(plane.toGlobal(from)),b=this.stage.toLocal(plane.toGlobal(to));if(![a.x,a.y,b.x,b.y].every(Number.isFinite))continue;this.grid.moveTo(a.x,a.y).lineTo(b.x,b.y);lines++;}if(lines)this.grid.stroke({color:this.accent,alpha:.18,width:1/this.scale});
  }this.host.dataset.grid=JSON.stringify({...this.gridSettings,visible,displayStep,lines,parentId:this.selected?this.snapshot?.entities.find(e=>e.id===this.selected)?.parentId??null:null});
 }
 private drawQueued=false;private drawnThisFrame=false;private drawNextFrame=false;
 /**
  * At most one GPU draw per displayed frame, however many render() calls arrive. With the app ticker running (the studio starts it) the ticker's own render is that draw. Otherwise: effects that read the camera's previous
  * frame (3D motion blur) need it, and extra draws are wasted work. A frame's first request draws at the end of the current
  * task (no added latency); later ones in that frame collapse into one draw at the start of the next. Diagnostics stay synchronous.
  */
 private drawSoon(){// A running app ticker already draws once at the end of every frame.
  if(this.app.ticker?.started)return;if(this.drawQueued)return;if(this.drawnThisFrame&&typeof requestAnimationFrame==='function'){this.drawNextFrame=true;return;}
  this.drawQueued=true;queueMicrotask(()=>{this.drawQueued=false;if(this.disposed||!this.app.renderer)return;this.app.render();
   if(typeof requestAnimationFrame!=='function')return;this.drawnThisFrame=true;requestAnimationFrame(()=>{this.drawnThisFrame=false;if(this.drawNextFrame){this.drawNextFrame=false;this.drawSoon();}});});}
 render(): void {
  if (this.disposed || !this.app.renderer) return;
  this.drawGrid();this.drawDecorations();this.eachFeature(feature=>feature.frame?.());this.drawSoon();
  this.host.dataset.transforms = JSON.stringify(Object.fromEntries([...this.nodes].map(([id,n]) => [id,{x:n.x,y:n.y,rotation:n.angle,scaleX:n.scale.x,scaleY:n.scale.y,...(n.skew.x||n.skew.y?{skewX:n.skew.x*180/Math.PI,skewY:n.skew.y*180/Math.PI}:{}),...(n.pivot.x||n.pivot.y?{pivotX:n.pivot.x,pivotY:n.pivot.y}:{})}])));
  this.host.dataset.visuals=JSON.stringify(this.visualDiagnostics);
  this.host.dataset.opacities=JSON.stringify(Object.fromEntries([...this.nodes].map(([id,n])=>[id,n.children[0]?.alpha??1])));
  this.host.dataset.camera=JSON.stringify(this.captureCamera());this.host.dataset.zoom = String(this.zoom);this.host.dataset.missingAssets=JSON.stringify(this.missingAssets);this.host.dataset.loadedTextures=String(this.textures.size);
 }
 dispose(): void {
  if (this.disposed) return;this.cancelGesture();this.disposed = true; this.observer?.disconnect();
  this.host.removeEventListener('wheel',this.wheel);this.host.removeEventListener('pointerdown',this.paintDown,{capture:true});this.host.removeEventListener('pointerdown',this.runtimeDown);window.removeEventListener('pointermove',this.runtimeMove);window.removeEventListener('pointerup',this.runtimeUp); window.removeEventListener('pointerup',this.endDrag);window.removeEventListener('pointermove',this.onPointerMove);window.removeEventListener('pointercancel',this.cancelPointer);window.removeEventListener('lostpointercapture',this.cancelPointer);window.removeEventListener('keydown',this.onKey);window.removeEventListener('blur',this.cancelGesture);this.handles.remove();
  for(const load of this.loading.values())load.abort();this.loading.clear();
  this.exitRuntime();this.clearVisuals();this.eachFeature(feature=>feature.dispose());this.features=[];if (this.app.renderer) destroyLocalApplication(this.app);
  for(const value of this.textures.values()){value.texture.destroy(true);value.bitmap.close();}this.textures.clear();
 }
}
