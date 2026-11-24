// Pure strip-LUT maths shared by the effect, preflight and tests. No pixi imports.
/** Largest LUT edge accepted: 64³ is a 4096 × 64 strip, the widest a WebGL 2 device has to support. */
export const maxLutSize=64;
/**
 * The edge length N of a strip LUT image: N² wide and N tall, N blue slices side by side, each with red across and
 * green down (the Unreal/Unity "strip" layout, 256 × 16 or 1024 × 32). Throws for any other shape.
 */
export function lutSize(width:number,height:number){
 if(!Number.isInteger(height)||height<2||height>maxLutSize||width!==height*height)throw Error(`A colour LUT must be a strip N² wide and N tall (for example 256 × 16 or 1024 × 32, N up to ${maxLutSize}); this image is ${width} × ${height}`);
 return height;}
/**
 * Reference lookup, the same maths the shader runs: `rgb` in 0..1 display colour, `sample(x, y)` reads the strip at
 * pixel centres with linear filtering. Blue picks two neighbouring slices and blends them; red and green come from the
 * filtered read inside each slice.
 */
export function lutLookup(rgb:readonly [number,number,number],size:number,sample:(u:number,v:number)=>[number,number,number]):[number,number,number]{
 const c=rgb.map(v=>Math.min(1,Math.max(0,v))),n=size,b=c[2]*(n-1),b0=Math.floor(b),b1=Math.min(b0+1,n-1),f=b-b0;
 const x=(c[0]*(n-1)+.5)/(n*n),y=(c[1]*(n-1)+.5)/n,s0=sample(x+b0/n,y),s1=sample(x+b1/n,y);
 return[s0[0]+(s1[0]-s0[0])*f,s0[1]+(s1[1]-s0[1])*f,s0[2]+(s1[2]-s0[2])*f];}
