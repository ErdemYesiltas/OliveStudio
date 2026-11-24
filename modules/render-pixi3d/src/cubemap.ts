// Cube map environments from one image, and level-of-detail switching. Pure: no pixi, no DOM.
export type CubeFace='right'|'left'|'top'|'bottom'|'front'|'back';
/** Face order of a strip or column: +X, −X, +Y, −Y, +Z, −Z. */
export const cubeFaces:readonly CubeFace[]=['right','left','top','bottom','front','back'];
export interface CubeLayout{kind:'cross'|'strip'|'column';size:number;faces:Record<CubeFace,{x:number;y:number}>}
/**
 * Where the six square faces sit in one image, chosen by its shape: a horizontal cross (4 × 3 faces: top above front,
 * then left, front, right, back across the middle, bottom below), a strip (6 × 1) or a column (1 × 6) in +X, −X, +Y,
 * −Y, +Z, −Z order. Throws for any other shape or faces under 8 pixels.
 */
export function cubeLayout(width:number,height:number):CubeLayout{
 const at=(cells:Record<CubeFace,[number,number]>,size:number)=>Object.fromEntries(cubeFaces.map(f=>[f,{x:cells[f][0]*size,y:cells[f][1]*size}])) as CubeLayout['faces'];
 if(width*3===height*4&&width%4===0){const size=width/4;if(size>=8)return{kind:'cross',size,faces:at({top:[1,0],left:[0,1],front:[1,1],right:[2,1],back:[3,1],bottom:[1,2]},size)};}
 if(width===height*6&&height>=8){const size=height;return{kind:'strip',size,faces:at(Object.fromEntries(cubeFaces.map((f,i)=>[f,[i,0]])) as Record<CubeFace,[number,number]>,size)};}
 if(height===width*6&&width>=8){const size=width;return{kind:'column',size,faces:at(Object.fromEntries(cubeFaces.map((f,i)=>[f,[0,i]])) as Record<CubeFace,[number,number]>,size)};}
 throw Error(`A cube map image must be a horizontal cross (4:3), a strip (6:1) or a column (1:6) of square faces; this one is ${width} × ${height}`);
}
/**
 * The world direction a cube face's texel looks along, for the usual GPU cube convention (rows run top to bottom):
 * `s` and `t` go from −1 to 1 across and down the face. Generators use it to paint seamless environments.
 */
export function cubeDirection(face:CubeFace,s:number,t:number):[number,number,number]{
 const d:[number,number,number]=face==='right'?[1,-t,-s]:face==='left'?[-1,-t,s]:face==='top'?[s,1,t]:face==='bottom'?[s,-1,-t]:face==='front'?[s,-t,1]:[-s,-t,-1];
 const l=Math.hypot(...d);return[d[0]/l,d[1]/l,d[2]/l];}
/**
 * Level of detail with a band: an object switches to its far geometry past `distance` × 1.1 and back inside
 * `distance` × 0.9, so standing near the boundary never flickers between the two. 0 turns it off.
 */
export function lodFar(distance:number,current:number,wasFar:boolean){if(distance<=0)return false;return wasFar?current>distance*.9:current>distance*1.1;}
