// Synthetic equirectangular Radiance panorama (flat RGBE scanlines): warm sky above, blue ground below, a bright sun.
export function hdrPanorama(width=256,height=128,{sky=[2.4,1.2,.5],ground=[.08,.18,.6],sun=[60,52,40]}={}){
 const header=Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`,'latin1'),pixels=Buffer.alloc(width*height*4);
 const rgbe=(r,g,b,o)=>{const m=Math.max(r,g,b);if(m<1e-32){pixels.fill(0,o,o+4);return;}const e=Math.ceil(Math.log2(m))+1,f=2**-e*256;pixels[o]=Math.min(255,r*f);pixels[o+1]=Math.min(255,g*f);pixels[o+2]=Math.min(255,b*f);pixels[o+3]=e+128;};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const up=y<height/2,dx=x-width*.25,dy=y-height*.3,c=up&&dx*dx+dy*dy<16?sun:up?sky:ground;rgbe(c[0],c[1],c[2],(y*width+x)*4);}
 return Buffer.concat([header,pixels]);
}
