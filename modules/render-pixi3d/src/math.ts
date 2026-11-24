import {quat,mat4} from 'gl-matrix';
import {Transform3DSchema,type Transform3D} from '@rewrite/scene3d';
export type Axis='x'|'y'|'z';export type Mode='move'|'rotate'|'scale';
export function withEuler(pose:Transform3D,euler:{x:number;y:number;z:number}):Transform3D{const q:quat=[0,0,0,1];quat.fromEuler(q,euler.x,euler.y,euler.z,'xyz');quat.normalize(q,q);return Transform3DSchema.parse({...pose,qx:q[0],qy:q[1],qz:q[2],qw:q[3]});}
export function eulerOf(pose:Transform3D){const m=mat4.fromQuat([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],[pose.qx,pose.qy,pose.qz,pose.qw]);const y=Math.asin(Math.max(-1,Math.min(1,m[8]))),regular=Math.abs(m[8])<.9999999;return{x:(regular?Math.atan2(-m[9],m[10]):Math.atan2(m[6],m[5]))*180/Math.PI,y:y*180/Math.PI,z:(regular?Math.atan2(-m[4],m[0]):0)*180/Math.PI};}
export function axisPose(start:Transform3D,axis:Axis,mode:Mode,delta:number,snap=false):Transform3D{
 const next={...start};if(mode==='move')next[axis]+=snap?Math.round(delta*4)/4:delta;
 else if(mode==='scale'){const key=({x:'scaleX',y:'scaleY',z:'scaleZ'} as const)[axis];next[key]=start[key]*Math.max(.01,1+(snap?Math.round(delta*10)/10:delta));}
 else{const angle=snap?Math.round(delta/(Math.PI/12))*Math.PI/12:delta,q:quat=[0,0,0,1],out:quat=[0,0,0,1];quat.setAxisAngle(q,axis==='x'?[1,0,0]:axis==='y'?[0,1,0]:[0,0,1],angle);quat.multiply(out,q,[start.qx,start.qy,start.qz,start.qw]);quat.normalize(out,out);Object.assign(next,{qx:out[0],qy:out[1],qz:out[2],qw:out[3]});}
 return Transform3DSchema.parse(next);
}
export function axisDelta(dx:number,dy:number,projected:{x:number;y:number}){const length=projected.x**2+projected.y**2;if(length<1e-6)throw Error('Axis is parallel to the camera');return (dx*projected.x+dy*projected.y)/length;}
