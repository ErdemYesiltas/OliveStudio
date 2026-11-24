import {expect,it} from 'vitest';
import {Client} from '@colyseus/sdk';
import {compileScript} from '@rewrite/scripts/compile';
import {defaultRigidBody} from '@rewrite/physics';
import {ServerWorldSchema,defaultMultiplayer,defaultNetworkPlayer,serverRules,type ServerRules} from '@rewrite/multiplayer/contracts';
import {startGameServer} from './server.node';
import {createServerWorld} from './world.node';
const t=(id:string,x:number,y:number)=>({id,type:'scene.transform2d',version:1,data:{x,y,rotation:0,scaleX:1,scaleY:1}});
const source=`export const machine=xstate.setup({guards:{valid:({event})=>event.amount===2},actions:{move:({context})=>{context.self.x=80;}}}).createMachine({id:'gate',context:({input})=>({self:input.self}),initial:'closed',states:{closed:{on:{open:{guard:'valid',target:'open',actions:'move'}}},open:{}}});`;
const definition=ServerWorldSchema.parse({scene:{formatVersion:1 as const,id:'room',name:'Room',entities:[
 {id:'ball',name:'Ball',active:true,parentId:null,components:[t('bt',100,50),{id:'rb',type:'physics.rigidBody2d',version:1,data:defaultRigidBody},{id:'bc',type:'physics.boxCollider2d',version:1,data:{width:20,height:20,offsetX:0,offsetY:0,sensor:false}},{id:'bn',type:'multiplayer.entity',version:1,data:{authority:'server',fields:[{component:'scene.transform2d',keys:['y']}],events:[],behavior:false}}]},
 {id:'gate',name:'Gate',active:true,parentId:null,components:[t('gt',0,0),{id:'gb',type:'behavior.machine',version:1,data:{scriptId:'s',params:{},refs:{}}},{id:'gn',type:'multiplayer.entity',version:1,data:{authority:'server',fields:[{component:'scene.transform2d',keys:['x']}],events:['open'],behavior:true}}]},
 ]},physics:{gravityX:0,gravityY:980},scripts:{version:1 as const,items:[{id:'s',name:'Gate',source,...compileScript(source)}]}});
const rules:ServerRules={version:1,room:'world',maxPlayers:4,tickRate:30,reconnectSeconds:1,speed:100,bounds:{width:960,height:540},spawn:{x:10,y:10},world:definition};
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(read:()=>boolean){for(let i=0;i<150;i++){if(read())return;await wait(20);}throw Error('Timed out');}
it('runs the actual Matter/XState world without DOM and publishes only selected fields',async()=>{
 const world=await createServerWorld(definition,rules.bounds);
 try{
  for(let i=0;i<30;i++)world.advance(1/60);
  const ball=world.snapshot().find(e=>e.id==='ball')!;
  expect(ball.fields['scene.transform2d'].y).toBeGreaterThan(100);expect(Object.keys(ball.fields['scene.transform2d'])).toEqual(['y']);
  expect(()=>world.send('gate',{type:'teleport'},'p')).toThrow('not allowed');
  world.send('gate',{type:'open',amount:1},'p');expect(world.snapshot().find(e=>e.id==='gate')!.states).toEqual(['closed']);
  world.send('gate',{type:'open',amount:2},'p');expect(world.snapshot().find(e=>e.id==='gate')).toMatchObject({states:['open'],fields:{'scene.transform2d':{x:80}}});
  expect(world.diagnostics()).toEqual([]);
 }finally{world.dispose();}
});
it('two real SDK clients see authoritative physics/behavior and cannot set fields or bypass guards',async()=>{
 const server=await startGameServer(rules,{port:0,quiet:true}),a=await new Client(server.endpoint).joinOrCreate('world'),b=await new Client(server.endpoint).joinOrCreate('world');
 const state=(room:typeof a,id:string)=>{const json=(room.state as {entities:Map<string,string>})?.entities?.get(id);return json?JSON.parse(json):null;};
 try{
  await until(()=>Boolean(state(a,'ball')&&state(b,'gate')));
  expect(state(a,'ball').fields['scene.transform2d'].x).toBeUndefined();
  a.send('position',{id:'gate',x:999});a.send('event',{entityId:'gate',event:{type:'teleport',x:999}});a.send('event',{entityId:'gate',event:{type:'open',amount:1}});
  await wait(150);expect(state(b,'gate').states).toEqual(['closed']);
  a.send('event',{entityId:'gate',event:{type:'open',amount:2}});
  await until(()=>state(a,'gate')?.states[0]==='open'&&state(b,'gate')?.states[0]==='open');
  expect(state(b,'gate').fields['scene.transform2d'].x).toBe(80);
  expect(server.status().rooms[0].rejected).toBeGreaterThanOrEqual(2);
 }finally{await a.leave();await b.leave();await server.close();}
});
it('exports the server world from the project while excluding presentation data',()=>{
 const p={scenes:[{...definition.scene,entities:[...definition.scene.entities,{id:'player',name:'Hero',parentId:null,active:true,components:[t('pt',20,20),{id:'np',type:'multiplayer.player',version:1,data:defaultNetworkPlayer()}]}]}],extensions:{'multiplayer.settings':{...defaultMultiplayer(),enabled:true},'scripts.library':definition.scripts,'physics.world':definition.physics},stage:rules.bounds};
 const r=serverRules({...p,scenes:p.scenes.map(s=>({...s,entities:JSON.parse(JSON.stringify(s.entities))})),extensions:JSON.parse(JSON.stringify(p.extensions))});expect(r.world?.scene.entities.map(e=>e.id)).toEqual(['ball','gate']);expect(r.world?.scripts.items[0].code).toContain('machine');
 const ball=p.scenes[0].entities[0];ball.components.push({id:'visual',type:'pixi.shape',version:1,data:{color:'#abc123'}} as never);
 const n=ball.components.find(c=>c.type==='multiplayer.entity')!; (n.data as {fields:{component:string;keys:string[]}[]}).fields.push({component:'pixi.shape',keys:['color']});
 const colored=serverRules({...p,scenes:JSON.parse(JSON.stringify(p.scenes)),extensions:JSON.parse(JSON.stringify(p.extensions))});expect(colored.world?.scene.entities[0].components.some(c=>c.type==='pixi.shape')).toBe(true);
});

it('accepts a valid event immediately after room-world initialization',async()=>{
 const world=await createServerWorld(definition,rules.bounds);
 try{world.send('gate',{type:'open',amount:2},'first-client');expect(world.snapshot().find(e=>e.id==='gate')?.states).toEqual(['open']);}finally{world.dispose();}
});
