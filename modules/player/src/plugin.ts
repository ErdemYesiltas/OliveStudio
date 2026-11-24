import type {Container,Renderer,PointData} from 'pixi.js';
import type {RuntimeSystem,Json} from '@rewrite/sdk';
import type {Entity,Scene} from '@rewrite/scene';
import type {Project} from '@rewrite/project';
import type {AssetRecord} from '@rewrite/assets';
import type {VisualAdapter,VisualFrame} from '@rewrite/render-pixi/visuals';
import type {InteractionEvent,ActionDefinition,GlobalStore,LanguageStore} from '@rewrite/interactions';
/** Export-time atlas: sprite-only textures packed into pages; frames are pixel rectangles on a page. */
export interface GameAtlas{pages:string[];frames:Record<string,{page:number;x:number;y:number;width:number;height:number}>}
export interface GameBundle{project:Project;assets:AssetRecord[];files:Record<string,Record<string,string>>;runtimes:string[];atlas?:GameAtlas}
export interface PlayerController{play(id:string):void;stop(id:string):void;readonly diagnostics?:unknown}
export interface PlayerPluginContext{
 bundle:GameBundle;
 /** App-level simulation pause (also pauses real-time runtime systems); independent from browser visibility. */
 simulation:{pause():void;resume():void;readonly paused:boolean;readonly time:number};
 /** Run one rule action now (timeline cutscene cues). */
 act?(action:unknown,silent:boolean,owner?:string):void;
 /** The game's element (overlays such as the dialogue box go inside it). */
 host?:HTMLElement;signal:AbortSignal;assets:{get(id:string):AssetRecord|undefined;url(asset:AssetRecord,file?:string):string};
 controllers:Map<string,PlayerController>;
 /** Cross-plugin services by name (the physics plugin offers 'physics' controls to rules and scripts). */
 /** Module-owned read-only runtime snapshots; queries are validated by their module. */
 inspectors:Map<string,(query:unknown)=>Json>;
 services:Map<string,unknown>;
 /** Pointer on the game in world pixels; a listener that returns true holds the press (e.g. dragging a body). Returns an unsubscribe. */
 pointer(listener:(phase:'down'|'move'|'up',x:number,y:number)=>boolean|void):()=>void;
 /** A world-pixel point (as pointers and scripts see it) on the canvas. */
 toGlobal(x:number,y:number):{x:number;y:number};entities():readonly Entity[];frame(id:string):VisualFrame;changed():void;
 emit(event:InteractionEvent):void;publish(event:{type:string;value:unknown}):void;report(message:string):void;
 /** The world point at the stage centre (where the game camera looks): the default ear for spatial audio. */
 view():{x:number;y:number};
 /** The game camera: follow an object (null stops), shake, zoom, look at a world point, and the current view. */
 /** Copy a prefab or object by name into the running scene (scripts); remove an object and its children. */
 spawn(name:string,x:number,y:number):string;spawnEntity(id:string,x:number,y:number):string;destroy(id:string):void;
 camera:{follow(id:string|null):void;shake(amplitude:number,duration:number):void;zoom(value:number):void;lookAt(x:number,y:number):void;view():{x:number;y:number;zoom:number;rotation:number}};
 /** Game-session globals (after Start), for plugins that read or write them, such as input axes. */
 globals():GlobalStore|undefined;
 /** The game's language (i18next), when the project has a string table. */
 language?():LanguageStore|undefined;
 /** The same play-world operations interaction actions use (behaviour scripts). */
 setActive(id:string,value:boolean):void;changeScene(id:string):void;addScene(id:string):void;removeScene(id:string):void;invoke(service:string,method:'play'|'stop',id:string):void;time():number;
}
export interface PlayerExtension{
 /** Registered transform component types this extension projects (2D is built in). */
 spatialTypes?:readonly string[];
 /** Register renderer extensions before Application.init; no renderer exists yet. */
 prepare?():Promise<void>;
 /** Capability fallback before Application.init: may downgrade the project's requested backend, never upgrade it. */
 renderer?(requested:'webgl'|'webgpu'):Promise<'webgl'|'webgpu'>;
 /** Repeatable readiness for the current projection. Called for authored loading and again after
  * the isolated runtime world is projected, before system start/autoplay/scene.start. */
 ready?():Promise<void>;
 /** Resolve a hit on a 2D boundary into an owned spatial entity. */
 hitEntity?(node:Container,point:PointData,listens:(id:string)=>boolean):string|undefined;
 init?():Promise<void>;unlock?():Promise<void>|void;systems?(scene:Scene):RuntimeSystem[];
 visuals?:readonly VisualAdapter[];actions?:readonly ActionDefinition[];event?(event:{type:string;value:unknown}):void;
 errors?():readonly string[];clear?():void;dispose():void;
 /** Every dispatched interaction event of the current scene, before its rules run. */
 interaction?(event:InteractionEvent):void;
 /** Whether this plugin reacts to that event type from that object (clicks pass through objects nobody listens to). */
 listens?(type:string,sourceId:string):boolean;
 /** Post-build pass over the scene graph (after creation and every drawn frame), e.g. flexbox layout. */
 decorate?(entities:readonly Entity[],node:(id:string)=>Container|undefined,renderer:Renderer):void;
}
export interface PlayerPlugin{id:string;create(context:PlayerPluginContext):PlayerExtension}
