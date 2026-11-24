// Turning toward a point: pure quaternion math shared by the Look at 3D add-on and scripts.
export type V={x:number;y:number;z:number};
const norm=(v:V):V=>{const l=Math.hypot(v.x,v.y,v.z)||1;return{x:v.x/l,y:v.y/l,z:v.z/l};},cross=(a:V,b:V):V=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
/** A rotation matrix's quaternion [x, y, z, w] from its columns (right, up, front). */
function fromBasis(r:V,u:V,f:V):[number,number,number,number]{
 const m00=r.x,m11=u.y,m22=f.z,trace=m00+m11+m22;
 if(trace>0){const s=.5/Math.sqrt(trace+1);return[(u.z-f.y)*s,(f.x-r.z)*s,(r.y-u.x)*s,.25/s];}
 if(m00>m11&&m00>m22){const s=2*Math.sqrt(1+m00-m11-m22);return[.25*s,(u.x+r.y)/s,(f.x+r.z)/s,(u.z-f.y)/s];}
 if(m11>m22){const s=2*Math.sqrt(1+m11-m00-m22);return[(u.x+r.y)/s,.25*s,(f.y+u.z)/s,(f.x-r.z)/s];}
 const s=2*Math.sqrt(1+m22-m00-m11);return[(f.x+r.z)/s,(f.y+u.z)/s,.25*s,(r.y-u.x)/s];}
/**
 * The rotation that turns `axis` (+Z or −Z) toward `direction` while keeping `up` as up as far as it can (no roll).
 * `yawOnly` flattens the direction first. Null when the direction is zero (target on top of the object), or straight up
 * or down with nothing left to turn around in `yawOnly`.
 */
export function lookRotation(direction:V,up:V={x:0,y:1,z:0},axis:'+Z'|'-Z'='+Z',yawOnly=false):[number,number,number,number]|null{
 let d=direction;if(yawOnly){const u=norm(up),k=d.x*u.x+d.y*u.y+d.z*u.z;d={x:d.x-u.x*k,y:d.y-u.y*k,z:d.z-u.z*k};}
 if(Math.hypot(d.x,d.y,d.z)<1e-9)return null;
 let f=norm(axis==='+Z'?d:{x:-d.x,y:-d.y,z:-d.z}),r=cross(up,f);
 // Looking straight along `up`: any right vector will do, so take one that keeps the turn smooth.
 if(Math.hypot(r.x,r.y,r.z)<1e-6)r=cross({x:0,y:0,z:1},f);
 r=norm(r);const u=cross(f,r);f=norm(f);return fromBasis(r,u,f);
}
