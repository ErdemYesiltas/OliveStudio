import {slot,type Json} from '@rewrite/sdk';
import type {Application,Container} from 'pixi.js';
import type {Scene,Entity} from '@rewrite/scene';
export interface SpatialCommit{id:string;data:Json;expected:Json;parentId:string|null}
export interface ViewportFeatureContext{
 app:Application;host:HTMLElement;node(id:string):Container|undefined;editable():boolean;
 select(id:string|null):void;commitSpatial(change:SpatialCommit):void;render():void;report(error:unknown):void;text(key:string):string;
 runtimeEntities?():readonly Entity[]|undefined;runtimeTime?():number;runtimeSilent?():boolean;runtimeEvent?(event:{type:string;sourceId:string;silent:boolean;event?:string}):void;
 flags(id:string):{hidden:boolean;locked:boolean};
}
export interface SpatialHit{entityId:string;point:{x:number;y:number;z:number};normal:{x:number;y:number;z:number}|null;uv:{u:number;v:number}|null;distance:number}
export interface ViewportFeatureHandle{
 /** Optional game-mode projection lifecycle, owned by this feature rather than the desktop host. */
 runtime?:{spatialTypes:readonly string[];validate?(scene:Scene):readonly string[];prepare?(scene:Scene):Promise<void>;ready?():Promise<void>;enter?():void;exit?():void};
 /** Resolve a 2D boundary hit into a stable entity in the feature's spatial world. */
 hitEntity?(node:Container,point:{x:number;y:number},clickable:(id:string)=>boolean):string|undefined;
 /** While the game runs: scripts pick objects under a canvas point and read model load states (Script3D in @rewrite/scripts). */
 scripts3d?:{raycast(point:{x:number;y:number}):SpatialHit|null;model(entityId:string):{state:'unloaded'|'loading'|'ready'|'error';error?:string}|undefined;stats():{resources:number;refs:number;loaded:number;pendingUnloads:number}|null;
  defineGeometry?(id:string,data:unknown):void;setMeshGeometry?(entityId:string,id:string):void;setMorph?(entityId:string,weights:readonly number[]):void;
  writeParticles?(entityId:string,data:Float32Array,count:number):void;setBatchGeometries?(entityId:string,ids:readonly string[]):void;writeBatch?(entityId:string,data:Float32Array,count:number):void};
 diagnostics?():readonly {entityId:string;ready:boolean;error?:string}[];
 sync(scene:Scene,selected:string|null):void;selection?(id:string|null):void;frame?():void;
 clear():void;dispose():void;
}
/** Editor-only scene projections. Prepare happens before Application.init; each viewport owns a fresh handle. */
export interface ViewportFeature{
 prepare():Promise<void>;create(context:ViewportFeatureContext):ViewportFeatureHandle;
 ownsVisual?(entity:Entity):boolean;
}
export const viewportFeatures=slot<ViewportFeature>('pixi.viewport-features');
