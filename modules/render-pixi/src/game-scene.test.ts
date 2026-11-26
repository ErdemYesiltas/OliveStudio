import {expect,it} from 'vitest';
import {RuntimeSession,type RuntimeEntity} from '@rewrite/runtime';
import {blankScene,makeEntity,type Scene} from '@rewrite/scene';
import {GameSceneObjects,GameSceneTransitions} from '@olivestudio/engine/game-scene';

it('keeps remapping references when an already spawned subtree is copied',()=>{
 const root=makeEntity('Root'),child=makeEntity('Child');
 child.parentId=root.id;
 root.components.push({id:'link',type:'example.link',version:1,data:{target:child.id}});
 const session=new RuntimeSession([root,child] as unknown as RuntimeEntity[]);
 const live=new GameSceneObjects(session,'base',{
  scenes:()=>[],prefabs:()=>[],references:component=>component.id==='link'?[['target']]:[],
  prepare:async()=>{},rollback:()=>{},sync:()=>{},report:error=>{throw error;},
 });
 try{
  const first=live.spawn({id:root.id},10,20);
  const second=live.spawn({id:first},30,40);
  const children=session.world.entities.filter(entity=>entity.parentId===second);
  const secondRoot=session.world.entities.find(entity=>entity.id===second)! as unknown as Scene['entities'][number];
  expect(children).toHaveLength(1);
  expect(secondRoot.components.find(component=>component.type==='example.link')?.data).toEqual({target:children[0].id});
  live.destroy([first,second]);
  expect(session.world.entities.map(entity=>entity.id)).toEqual([root.id,child.id]);
 }finally{live.dispose();session.dispose();}
});

it('applies the latest queued scene change and uses one rolling rate limit',()=>{
 const first=blankScene(),second=blankScene(),scenes=[first,second];
 let time=0;
 const transitions=new GameSceneTransitions(()=>time);
 transitions.request(first.id);
 transitions.request(second.id);
 expect(transitions.take(scenes)).toBe(second);
 for(let count=1;count<8;count++){
  transitions.request(first.id);
  expect(transitions.take(scenes)).toBe(first);
 }
 transitions.request(second.id);
 expect(()=>transitions.take(scenes)).toThrow('Scene transition cycle limit');
 expect(transitions.take(scenes)).toBeUndefined();
 time=1000;
 transitions.request(second.id);
 expect(transitions.take(scenes)).toBe(second);
});
