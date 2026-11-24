export type Quat=readonly [number,number,number,number];
const normalize=(q:Quat):[number,number,number,number]=>{const l=Math.hypot(...q);if(!(l>1e-12))throw Error('Quaternion has no length');return[q[0]/l,q[1]/l,q[2]/l,q[3]/l];};
/** Shortest-arc spherical interpolation; t outside [0,1] extrapolates along the same arc. */
export function slerp(a:Quat,b:Quat,t:number):[number,number,number,number]{
 const from=normalize(a);let to=normalize(b),dot=from[0]*to[0]+from[1]*to[1]+from[2]*to[2]+from[3]*to[3];
 if(dot<0){to=[-to[0],-to[1],-to[2],-to[3]];dot=-dot;}
 if(dot>.9995)return normalize(from.map((v,i)=>v+(to[i]-v)*t) as unknown as Quat);
 const theta=Math.acos(Math.min(1,dot)),sin=Math.sin(theta),wa=Math.sin((1-t)*theta)/sin,wb=Math.sin(t*theta)/sin;
 return normalize(from.map((v,i)=>v*wa+to[i]*wb) as unknown as Quat);
}
/** Degrees, XYZ order: the same convention as the 3D Inspector (gl-matrix fromEuler 'xyz'). */
export function quatFromEuler(x:number,y:number,z:number):[number,number,number,number]{
 const h=Math.PI/360,sx=Math.sin(x*h),cx=Math.cos(x*h),sy=Math.sin(y*h),cy=Math.cos(y*h),sz=Math.sin(z*h),cz=Math.cos(z*h);
 return normalize([sx*cy*cz+cx*sy*sz,cx*sy*cz-sx*cy*sz,cx*cy*sz+sx*sy*cz,cx*cy*cz-sx*sy*sz]);
}
export function eulerFromQuat(q:Quat):{x:number;y:number;z:number}{
 const [x,y,z,w]=normalize(q),m0=1-2*(y*y+z*z),m4=2*(x*y-w*z),m5=1-2*(x*x+z*z),m6=2*(y*z+w*x),m8=2*(x*z+w*y),m9=2*(y*z-w*x),m10=1-2*(x*x+y*y);
 const regular=Math.abs(m8)<.9999999,deg=180/Math.PI;
 return{x:(regular?Math.atan2(-m9,m10):Math.atan2(m6,m5))*deg,y:Math.asin(Math.max(-1,Math.min(1,m8)))*deg,z:(regular?Math.atan2(-m4,m0):0)*deg};
}
