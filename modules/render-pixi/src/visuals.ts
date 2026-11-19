import type {Container,Renderer} from 'pixi.js';
import {slot,type Json} from '@rewrite/sdk';
export interface VisualFrame{token:string;time:number;emit:boolean;silent:boolean}
export interface VisualContext{entityId:string;componentId:string;frame():VisualFrame;changed():void;event(event:unknown):void}
export interface VisualHandle{view:Container;update(data:Json,frame:VisualFrame):void;diagnostics():Record<string,Json>;dispose():void}
export interface VisualAdapter{type:string;version:number;key(data:Json):unknown;create(data:Json,context:VisualContext):VisualHandle}
export const visualAdapters=slot<VisualAdapter>('pixi.visuals');
/** Entity shape a decorator reads (the editor scene, runtime worlds and the player all satisfy it). */
export interface DecoratedEntity{id:string;parentId:string|null;components:readonly {type:string;version:number;data:Json}[]}
/**
 * A pass over the built scene graph after every sync or frame (e.g. flexbox layout). `clear()` runs before the host
 * destroys its display objects; `positionLocked` names entities whose position the decorator owns. With `renderer`
 * a decorator may settle immediately so bounds and selection outlines are correct before the next render.
 */
/** How the scene is shown: `rtl` for a right-to-left language (layout rows mirror). */
export interface DecorateContext{rtl?:boolean}
export interface SceneDecorator{apply(entities:readonly DecoratedEntity[],node:(id:string)=>Container|undefined,renderer?:Renderer,context?:DecorateContext):void;positionLocked?(entities:readonly DecoratedEntity[]):ReadonlySet<string>;clear():void}
export const sceneDecorators=slot<SceneDecorator>('pixi.decorators');
