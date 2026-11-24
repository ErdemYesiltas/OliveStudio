// A QA copy of the Keyframes example with a "Probe eye": a draggable cube on the floor whose script turns toward
// Tile 1 with lookAt every frame and records hover enter/leave, drops, the game.pointer3d object names and how well
// its +Z points at the tile (1 = exactly). Used by 3d-s1-qa.mjs (HTML) and the native check (editor Preview).
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
export const probeSource=`export function update(self: GameObject3D) {
  const tile = game.find<GameObject3D>('Tile 1')!;
  self.lookAt(tile);
  const q = self.quaternion, w = self.worldPosition, t = tile.worldPosition;
  const f = {x: 2 * (q.x * q.z + q.w * q.y), y: 2 * (q.y * q.z - q.w * q.x), z: 1 - 2 * (q.x * q.x + q.y * q.y)};
  const d = {x: t.x - w.x, y: t.y - w.y, z: t.z - w.z}, l = Math.hypot(d.x, d.y, d.z);
  self.state.dot = Number(((f.x * d.x + f.y * d.y + f.z * d.z) / l).toFixed(4));
  const hit = game.pointer3d, name = hit ? hit.object.name : '-';
  if (!self.state.dotLogged && game.time > 2) { self.state.dotLogged = true; game.log('lookdot', self.state.dot); }
  if (name !== self.state.last) { self.state.last = name; self.state.seen = (self.state.seen || []).concat(name).slice(-8); game.log('pointer3d', name); }
}
export function onPointerEnter(self: GameObject3D) { self.state.enters = (self.state.enters || 0) + 1; game.log('enter', self.name); }
export function onPointerLeave(self: GameObject3D) { self.state.leaves = (self.state.leaves || 0) + 1; game.log('leave', self.name); }
export function onDragEnd(self: GameObject3D) { self.state.drops = (self.state.drops || 0) + 1; self.state.x = Number(self.position.x.toFixed(2)); game.log('dropped', self.name, self.state.x); }
`;
export const probeEye=[3,-1.52,0];
export function probeProject(project,root){
 const {transform}=createRequire(join(root,'modules/scripts/package.json'))('sucrase');
 const p=structuredClone(project),entities=p.scenes[0].entities,tile=entities.find(e=>e.name==='Tile 1'),logo=entities.find(e=>e.id===tile.parentId);
 const eye=structuredClone(tile);eye.id=randomUUID();eye.name='Probe eye';eye.parentId=logo.parentId;
 for(const c of eye.components)c.id=randomUUID();
 Object.assign(eye.components.find(c=>c.type==='scene3d.transform').data,{x:probeEye[0],y:probeEye[1],z:probeEye[2],scaleX:.56,scaleY:.56,scaleZ:.56});
 Object.assign(eye.components.find(c=>c.type==='pixi3d.primitive').data,{color:'#e0443a'});
 const id='probe-script';eye.components.push({id:randomUUID(),type:'pixi3d.draggable',version:1,data:{plane:'ground',snap:0}},{id:randomUUID(),type:'scripts.behaviour',version:1,data:{scriptId:id,params:{},refs:{}}});
 entities.push(eye);
 p.extensions['scripts.library'].items.push({id,name:'Probe',source:probeSource,code:transform(probeSource,{transforms:['typescript','imports'],filePath:'Probe.ts',production:true,disableESTransforms:true}).code});
 p.name='S1 probe';return p;
}
