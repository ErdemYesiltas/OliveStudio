import {BitmapText,Graphics,Sprite,Text,type Container,type PointData,type Texture} from 'pixi.js';
import {bidiText,bitmapTextStyle,textStyle,type BitmapTextSchema,type Shape,type SpriteSchema,type TextData} from './contracts.js';
import type {z} from 'zod';
import type {Transform2D} from './types.js';

export function applyTransform2D(node:Container,pose:Transform2D,offset?:PointData){
 node.position.set(pose.x+(offset?.x??0),pose.y+(offset?.y??0));
 node.angle=pose.rotation;
 node.scale.set(pose.scaleX,pose.scaleY);
 node.skew.set((pose.skewX??0)*Math.PI/180,(pose.skewY??0)*Math.PI/180);
 node.pivot.set(pose.pivotX??0,pose.pivotY??0);
}

export function createSpriteView(data:z.infer<typeof SpriteSchema>,texture:Texture):Sprite{
 const view=new Sprite(texture);
 applySpriteView(view,data,texture);
 return view;
}

export function applySpriteView(view:Sprite,data:z.infer<typeof SpriteSchema>,texture:Texture){
 if(view.texture!==texture)view.texture=texture;
 view.anchor.set(data.anchorX,data.anchorY);
 view.width=data.width;
 view.height=data.height;
 view.tint=data.tint;
 view.alpha=data.alpha;
}

export function createTextView(data:TextData,font:string|string[],rtl:boolean,text=data.text):Text{
 const view=new Text({text:bidiText(text),style:textStyle(data,font,rtl)});
 view.anchor.set(.5);
 view.alpha=data.alpha;
 return view;
}

export function createBitmapTextView(data:z.infer<typeof BitmapTextSchema>,font:string|string[],text=data.text):BitmapText{
 const view=new BitmapText({text,style:bitmapTextStyle(data,font)});
 view.anchor.set(.5);
 view.alpha=data.alpha;
 return view;
}

/** Outline points of a shape, centred on the origin (rect and ellipse use native Pixi paths instead). */
export function shapePoints(p: Pick<Shape, 'kind' | 'width' | 'height' | 'sides' | 'innerRadius'>): number[] {
 const rx = p.width / 2, ry = p.height / 2;
 if (p.kind === 'triangle') return [0, -ry, rx, ry, -rx, ry];
 const count = p.kind === 'star' ? p.sides * 2 : p.sides, points: number[] = [];
 for (let i = 0; i < count; i++) {
  const angle = -Math.PI / 2 + i * 2 * Math.PI / count, r = p.kind === 'star' && i % 2 ? p.innerRadius : 1;
  points.push(Math.round(Math.cos(angle) * rx * r * 1e4) / 1e4, Math.round(Math.sin(angle) * ry * r * 1e4) / 1e4);
 }
 return points;
}

/** One drawing routine for the editor and the exported player. */
export function drawShape(p: Shape, g = new Graphics()): Graphics {
 g.clear();
 if (p.kind === 'line') return g.moveTo(-p.width / 2, -p.height / 2).lineTo(p.width / 2, p.height / 2).stroke({color: p.color, width: Math.max(1, p.strokeWidth), cap: 'round'});
 if (p.kind === 'rect') g.roundRect(-p.width / 2, -p.height / 2, p.width, p.height, p.rounded);
 else if (p.kind === 'ellipse') g.ellipse(0, 0, p.width / 2, p.height / 2);
 else g.poly(shapePoints(p));
 g.fill(p.color);
 if (p.strokeWidth > 0) g.stroke({color: p.strokeColor, width: p.strokeWidth, join: 'round'});
 return g;
}
