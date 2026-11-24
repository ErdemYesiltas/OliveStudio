import {z} from 'zod';
import type {ComponentDefinition} from '@rewrite/sdk';
import type {ActionDefinition} from '@rewrite/interactions';
// Stamping decals where the player clicks, and attaching one object to another while the game runs. Pure: no pixi.
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const decalsType='pixi3d.decals',attachType='pixi3d.attach',decalShapes=['splat','ring','star'] as const;
/**
 * While the game runs, a click (press and release without dragging) on a surface in this object's view stamps a flat
 * decal there, lying on the surface and riding with the object that was hit. The oldest goes once `max` are down.
 * `onlyOn` limits stamping to one object (its ID); empty means any surface. Decals are not saved in the scene.
 */
export const DecalsSchema=z.object({shape:z.enum(decalShapes).default('splat'),image:z.string().max(128).default(''),color:color.default('#ff4a6a'),color2:color.default('#ffd23c'),size:z.number().finite().min(.01).max(100).default(.5),sizeRandom:z.number().finite().min(0).max(.95).default(.3),max:z.number().int().min(1).max(500).default(60),onlyOn:z.string().max(128).default(''),seed:z.number().int().min(0).max(2**31-1).default(1)}).strict();
export type Decals=z.infer<typeof DecalsSchema>;
export const decalsFields:ComponentDefinition['fields']=[{key:'shape',titleKey:'field.decalShape',kind:'enum',options:decalShapes.map(value=>({value,titleKey:'scene3d.decal.'+value}))},{key:'image',titleKey:'field.decalImage',kind:'asset',assetType:'pixi.texture'},{key:'color',titleKey:'field.color',kind:'color'},{key:'color2',titleKey:'field.color2',kind:'color'},{key:'size',titleKey:'field.size',kind:'number'},{key:'sizeRandom',titleKey:'field.sizeRandom',kind:'number'},{key:'max',titleKey:'field.decalMax',kind:'number'},{key:'onlyOn',titleKey:'field.decalOnlyOn',kind:'string'},{key:'seed',titleKey:'field.seed',kind:'number'}];
/**
 * While `enabled` (switched by the on/off action), this object keeps the place it had relative to `targetId` at the
 * moment it was attached, so it rides along; switched off, it stays where it is. Only while the game runs.
 */
export const AttachSchema=z.object({targetId:z.string().max(128).default(''),enabled:z.boolean().default(false)}).strict();
export type Attach=z.infer<typeof AttachSchema>;
export const attachFields:ComponentDefinition['fields']=[{key:'targetId',titleKey:'field.attachTarget',kind:'string'},{key:'enabled',titleKey:'field.enabled',kind:'boolean'}];
function random(seed:number,i:number,salt:number){let h=Math.imul(seed^0x9e3779b9,0x85ebca6b)^Math.imul(i+1,0xc2b2ae35)^Math.imul(salt+13,0x165667b1);h=Math.imul(h^(h>>>15),0x2c1b3c6d);h=Math.imul(h^(h>>>12),0x297a2d39);h^=h>>>15;return(h>>>0)/4294967296;}
const lerp=(a:string,b:string,k:number)=>{const x=parseInt(a.slice(1),16),y=parseInt(b.slice(1),16);return[16,8,0].reduce((out,s)=>out|Math.round(((x>>s)&255)+(((y>>s)&255)-((x>>s)&255))*k)<<s,0);};
/** The look of decal number `i`: size, turn around the surface normal (radians) and colour (0xRRGGBB), from the seed. */
export function decalLook(d:Decals,i:number){return{size:d.size*(1-d.sizeRandom*random(d.seed,i,1)),spin:random(d.seed,i,2)*Math.PI*2,color:lerp(d.color,d.color2,random(d.seed,i,3))};}
/** Ids of `id` and its ancestors among `parents` (id → parent id), innermost first; stops at an unknown parent. */
export function ancestry(id:string|undefined,parents:ReadonlyMap<string,string|null|undefined>){const out:string[]=[];for(let at=id;at&&!out.includes(at);at=parents.get(at)??undefined){out.push(at);if(!parents.has(at))break;}return out;}
/**
 * Hover changes as enter / leave lists, like the DOM's pointerenter and pointerleave: leaving a child for its sibling
 * leaves only the child; their shared group stays entered. Leaves come innermost first, enters outermost first.
 */
export function hoverChanges(before:readonly string[],after:readonly string[]){return{leave:before.filter(id=>!after.includes(id)),enter:after.filter(id=>!before.includes(id)).reverse()};}
export const paintableType='pixi3d.paintable';
/**
 * Lets the player paint the primitive while the game runs: pressing and dragging over it lays brush dabs at the
 * texture point under the pointer. The paint lives in a canvas that starts as `background` (empty: the primitive's own colour) and is
 * not saved; `brushColor` and the clear count change at run time through the paint actions.
 */
export const PaintableSchema=z.object({brushColor:color.default('#ff4a6a'),brushSize:z.number().finite().min(.002).max(.5).default(.03),resolution:z.number().int().min(64).max(2048).default(512),background:color.or(z.literal('')).default(''),clears:z.number().int().min(0).default(0)}).strict();
export type Paintable=z.infer<typeof PaintableSchema>;
export const paintableFields:ComponentDefinition['fields']=[{key:'brushColor',titleKey:'field.brushColor',kind:'color'},{key:'brushSize',titleKey:'field.brushSize',kind:'number'},{key:'resolution',titleKey:'field.paintResolution',kind:'number'},{key:'background',titleKey:'field.paintBackground',kind:'color'}];
/**
 * Dab centres from `a` to `b` (texture UVs, 0–1), spaced a third of the brush apart so a fast stroke stays a line;
 * `a` itself is left out (the previous move drew it). Never more than 256 per move; a jump past 0.2 starts afresh.
 */
export function strokeDabs(a:{u:number;v:number},b:{u:number;v:number},size:number){const d=Math.hypot(b.u-a.u,b.v-a.v);
 // A jump this large crossed a face edge or a seam (u wrapping 1 → 0): joining would paint across unrelated texture.
 if(d>.2)return[b];const n=Math.min(256,Math.max(1,Math.ceil(d/(size/3))));return Array.from({length:n},(_,i)=>({u:a.u+(b.u-a.u)*(i+1)/n,v:a.v+(b.v-a.v)*(i+1)/n}));}
const paintRefs:ActionDefinition['references']=c=>c.entities.flatMap(e=>e.components.filter(x=>x.type===paintableType).map(x=>({id:x.id,name:e.name})));
/** Brush colour (`to`, a #rrggbb text) and clearing for Paintable 3D surfaces while the game runs; never the document. */
export const paint3dActions:ActionDefinition[]=[
 {type:'pixi3d.paintColor',titleKey:'interaction.paintColor3d',references:paintRefs,execute:(a,c)=>{if(!c.setData)throw Error('Runtime component data is unavailable');const to=String(a.to??'');if(!/^#[0-9a-fA-F]{6}$/.test(to))throw Error('Brush colour must be #rrggbb');c.setData(a.targetId,{brushColor:to});}},
 // Any new number clears; game time in ms changes with every call made on a different frame.
 {type:'pixi3d.clearPaint',titleKey:'interaction.clearPaint3d',references:paintRefs,execute:(a,c)=>{if(!c.setData)throw Error('Runtime component data is unavailable');c.setData(a.targetId,{clears:Math.round((c.time?.()??0)*1000)+1});}},
];
/**
 * UVs for a paintable box: every face of a cube spans the whole 0–1 texture, so paint on one face would show on all six.
 * Each face (grouped by its normal: +X, −X, +Y, −Y, +Z, −Z) gets its own cell of a 3 × 2 atlas instead.
 */
export function boxAtlasUvs(normals:ArrayLike<number>,uvs:ArrayLike<number>){const out=new Float32Array(uvs.length);
 for(let i=0;i*2<uvs.length;i++){const x=normals[i*3],y=normals[i*3+1],z=normals[i*3+2],ax=Math.abs(x),ay=Math.abs(y),az=Math.abs(z),cell=ax>=ay&&ax>=az?(x>0?0:1):ay>=az?(y>0?2:3):(z>0?4:5);
  out[i*2]=(cell%3+uvs[i*2])/3;out[i*2+1]=(Math.floor(cell/3)+uvs[i*2+1])/2;}return out;}
