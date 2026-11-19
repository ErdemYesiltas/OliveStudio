export interface CameraSize {width:number;height:number}
export interface CameraBounds extends CameraSize {x:number;y:number}
export function cameraScale(size:CameraSize,zoom:number,stage:CameraSize={width:960,height:540}):number{return Math.max(.01,Math.max(.01,Math.min((size.width-80)/stage.width,(size.height-90)/stage.height))*zoom);}
/** The authoring stage defaults to 960×540 (project stage size); pan is expressed in viewport CSS pixels. */
export function cameraForBounds(bounds:CameraBounds,size:CameraSize,stage:CameraSize={width:960,height:540}):{zoom:number;pan:{x:number;y:number}}{
 if(![bounds.x,bounds.y,bounds.width,bounds.height,size.width,size.height].every(Number.isFinite)||bounds.width<0||bounds.height<0||size.width<=0||size.height<=0)throw Error('Invalid camera bounds');
 const base=cameraScale(size,1,stage),fit=Math.min(Math.max(1,size.width-128)/Math.max(32,bounds.width),Math.max(1,size.height-128)/Math.max(32,bounds.height)),zoom=Math.max(.25,Math.min(4,fit/base)),scale=cameraScale(size,zoom,stage),pan={x:(stage.width/2-(bounds.x+bounds.width/2))*scale,y:(stage.height/2-(bounds.y+bounds.height/2))*scale};
 if(!Number.isFinite(pan.x)||!Number.isFinite(pan.y))throw Error('Invalid camera center');return{zoom,pan};
}
