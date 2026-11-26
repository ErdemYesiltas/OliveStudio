import type {Application} from 'pixi.js';

/** A panel/player owns one renderer, never Pixi's process-wide pools and caches.
 * Pixi 8's boolean `true` also releases global resources used by other live renderers.
 */
export function destroyLocalApplication(app:Pick<Application,'renderer'|'destroy'>):void{
 if(!app.renderer)return;
 app.destroy({removeView:true,releaseGlobalResources:false},{children:true});
}
