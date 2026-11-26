import {expect,it} from 'vitest';
import {makeEntity,SceneService,transformDefinition,transform,type Entity} from '@rewrite/scene';
import {RuntimeSession,type RuntimeEntity} from '@rewrite/runtime';
import {ModuleHost} from '@rewrite/kernel';
import {projectModule,ProjectService} from '@rewrite/project';
import {PhysicsSession,PhysicsService,compilePhysics,colliderOutlines,defaultRigidBody,defaultPhysicsSettings,rigidBodyDefinition,boxColliderDefinition,circleColliderDefinition,jointDefinition,physicsModule,physicsProviders,type PhysicsEvent} from '@rewrite/physics';
import {compileTweens} from '@rewrite/tween';
import {validateMotion,newClip} from '@rewrite/animation';
import {matterProvider,matterModule} from './index';
function body(id:string,x:number,y:number,kind:'box'|'circle'='box'){const e=makeEntity(id,x,y);e.id=id;e.components.push({id:`rb-${id}`,type:'physics.rigidBody2d',version:1,data:{...defaultRigidBody,airFriction:0}},{id:`collider-${id}`,type:kind==='box'?'physics.boxCollider2d':'physics.circleCollider2d',version:1,data:{...(kind==='box'?{width:40,height:40}:{radius:20}),offsetX:0,offsetY:0,sensor:false}});return e;}
const definitions=new Map([transformDefinition,rigidBodyDefinition,boxColliderDefinition,circleColliderDefinition].map(d=>[d.type,d]));
function floor(){const e=body('floor',0,200);e.components=e.components.filter(c=>c.type!=='physics.rigidBody2d');e.components[1].data={width:2000,height:20,offsetX:0,offsetY:0,sensor:false};return e;}
it('compiles root bodies and treats a collider without RigidBody as static',()=>{const box=body('box',0,0),ground=floor(),result=compilePhysics([box,ground]);expect(result.errors).toEqual([]);expect(result.plans[1].spec.settings.bodyType).toBe('static');expect(result.plans[0].spec.parts).toEqual([{kind:'box',width:40,height:40,chamfer:0,x:0,y:0,angle:0,sensor:false}]);});
it('uses fixed 60 Hz updates, pauses, steps once and never mutates the source document',()=>{const source=body('box',0,0),before=structuredClone(source);let physics:PhysicsSession|undefined;const runtime=new RuntimeSession([source as unknown as RuntimeEntity],world=>{physics=new PhysicsSession(()=>world.entities as unknown as Entity[],defaultPhysicsSettings,matterProvider);return[physics.system];});runtime.pause();runtime.advance(1);expect(physics!.diagnostics.steps).toBe(0);runtime.step();expect(physics!.diagnostics.steps).toBe(1);expect(physics!.diagnostics.bodies[0].y).toBeGreaterThan(0);expect(source).toEqual(before);runtime.resume();runtime.advance(1/30);expect(physics!.diagnostics.steps).toBe(3);runtime.dispose();expect(physics!.diagnostics.bodies).toEqual([]);});
it('falls onto a static floor instead of passing through it',()=>{const box=body('box',0,0),ground=floor(),session=new PhysicsSession(()=>[box,ground],defaultPhysicsSettings,matterProvider);session.start();for(let i=0;i<180;i++)session.system.fixedUpdate!(1/60);expect(transform(box).y).toBeCloseTo(170,0);expect(transform(ground).y).toBe(200);session.dispose();});
it('reports stable sensor enter/exit events without a collision response and flags silent steps',()=>{const box=body('box',0,0),sensor=body('sensor',0,100);sensor.components=sensor.components.filter(c=>c.type!=='physics.rigidBody2d');sensor.components[1].data={width:500,height:10,offsetX:0,offsetY:0,sensor:true};const events:PhysicsEvent[]=[],session=new PhysicsSession(()=>[box,sensor],defaultPhysicsSettings,matterProvider,{silent:()=>true,event:e=>events.push(e)});session.start();for(let i=0;i<60;i++)session.system.fixedUpdate!(1/60);expect(transform(box).y).toBeGreaterThan(300);expect(events.map(e=>e.phase)).toEqual(['enter','exit']);expect(events[0]).toMatchObject({sensor:true,silent:true,colliderA:expect.stringContaining('collider-'),colliderB:expect.stringContaining('collider-')});session.dispose();});
it('supports actual circles and locks rotation despite authored angular velocity',()=>{const circle=body('circle',0,0,'circle');circle.components[1].data={...defaultRigidBody,airFriction:0,angularVelocity:180,lockRotation:true};const session=new PhysicsSession(()=>[circle],{...defaultPhysicsSettings,gravityX:0,gravityY:0},matterProvider);session.start();for(let i=0;i<60;i++)session.system.fixedUpdate!(1/60);expect(transform(circle).rotation).toBe(0);expect(session.diagnostics.bodies[0].angularVelocity).toBe(0);session.dispose();});
it('converts degrees/s and px/s and preserves an offset pivot during rotation',()=>{const e=body('offset',100,100);e.components[1].data={...defaultRigidBody,airFriction:0,angularVelocity:90,velocityX:60};e.components[2].data={width:40,height:40,offsetX:20,offsetY:0,sensor:false};const s=new PhysicsSession(()=>[e],{...defaultPhysicsSettings,gravityX:0,gravityY:0},matterProvider);s.start();for(let i=0;i<60;i++)s.system.fixedUpdate!(1/60);const pose=s.diagnostics.bodies[0];expect(pose.rotation).toBeCloseTo(90,5);expect(pose.x).toBeCloseTo(180,4);expect(transform(e).x).toBeCloseTo(180,4);expect(transform(e).y).toBeCloseTo(80,4);s.dispose();});
it('allows child bodies; rejects nonuniform circles, missing colliders and invalid scaled dimensions',()=>{const parent=makeEntity('parent',0,0);parent.id='parent';const e=body('child',0,0);e.parentId='parent';expect(compilePhysics([parent,e]).errors).toEqual([]);const c=body('circle',0,0,'circle');(c.components[0].data as Record<string,number>).scaleX=2;expect(compilePhysics([c]).errors.join()).toContain('uniform');const bare=body('bare',0,0);bare.components.pop();expect(compilePhysics([bare]).errors.join()).toContain('needs a collider');const tiny=body('tiny',0,0);Object.assign(tiny.components[0].data!,{scaleX:.0001,scaleY:.0001});expect(compilePhysics([tiny]).errors.join()).toContain('dimensions');});
it('reserves transform channels against both Tween and Animation but allows opacity',()=>{const e=body('box',0,0),writers=new Map<string,string>();compilePhysics([e],writers);e.components.push({id:'tween',type:'tween.player',version:1,data:{duration:1,delay:0,repeat:0,yoyo:false,ease:'linear',autoplay:true,tracks:[{id:'t',entityId:e.id,componentId:e.components[0].id,property:'x',from:0,to:1}]}});const channel={componentType:'scene.transform2d',version:1,property:'x',titleKey:'x'};expect(compileTweens([e],[channel],undefined,writers).errors.join()).toContain('already owned');e.components.pop();const clip=newClip();clip.tracks.push({id:'track',entityId:e.id,componentId:e.components[0].id,property:'x',keys:[{id:'start',time:0,value:0,ease:'linear'},{id:'end',time:1,value:1,ease:'linear'}]});e.components.push({id:'animation',type:'animation.player',version:1,data:{activeClipId:clip.id,autoplay:true,clips:[clip]}});const ownership=new Map<string,string>();compilePhysics([e],ownership);expect(validateMotion([e],[channel],ownership).join()).toContain('already owned');e.components.pop();e.components.push({id:'visual',type:'render.visual',version:1,data:{alpha:1}},{id:'fade',type:'tween.player',version:1,data:{duration:1,delay:0,repeat:0,yoyo:false,ease:'linear',autoplay:true,tracks:[{id:'fade-track',entityId:e.id,componentId:'visual',property:'alpha',from:1,to:0}]}});const fadeOwners=new Map<string,string>();compilePhysics([e],fadeOwners);expect(validateMotion([e],[{componentType:'render.visual',version:1,property:'alpha',titleKey:'alpha',min:0,max:1}],fadeOwners)).toEqual([]);});
it('removes inactive bodies, recreates on activation and releases sensor pairs only once',()=>{const a=body('a',0,0),b=body('b',0,0);b.components=b.components.filter(c=>c.type!=='physics.rigidBody2d');b.components[1].data={width:100,height:100,offsetX:0,offsetY:0,sensor:true};const events:PhysicsEvent[]=[],s=new PhysicsSession(()=>[a,b],{...defaultPhysicsSettings,gravityX:0,gravityY:0},matterProvider,{event:e=>events.push(e)});s.start();s.system.fixedUpdate!(1/60);a.active=false;s.system.fixedUpdate!(1/60);s.system.fixedUpdate!(1/60);expect(events.map(e=>e.phase)).toEqual(['enter','exit']);expect(s.diagnostics.bodies).toHaveLength(1);a.active=true;s.system.fixedUpdate!(1/60);expect(s.diagnostics.bodies).toHaveLength(2);expect(events.at(-1)?.phase).toBe('enter');s.dispose();expect(events).toHaveLength(3);});
it('disposes sessions without leaking callbacks, bodies, or a Runner clock into the next session',()=>{const e=body('box',0,0),events:PhysicsEvent[]=[],a=new PhysicsSession(()=>[e],defaultPhysicsSettings,matterProvider,{event:e=>events.push(e)});a.start();a.system.fixedUpdate!(1/60);a.dispose();a.system.fixedUpdate!(1/60);expect(a.diagnostics.bodies).toEqual([]);const b=new PhysicsSession(()=>[body('box',0,0)],defaultPhysicsSettings,matterProvider);b.start();expect(b.diagnostics.bodies[0].y).toBe(0);expect(b.diagnostics.steps).toBe(0);b.dispose();expect(events).toEqual([]);});
it('persists gravity through project transactions and keeps debug preferences outside history',()=>{const p=new ProjectService(()=>definitions,()=>[]);let debug=false;const service=new PhysicsService(p,{get:()=>debug,set:value=>{debug=value;}});service.setSettings({gravityY:980});expect(p.document.canUndo).toBe(false);service.setDebug(true);expect(debug).toBe(true);expect(p.document.dirty).toBe(false);service.setSettings({gravityY:400});expect(service.settings.gravityY).toBe(400);p.document.undo();expect(service.settings.gravityY).toBe(980);expect(p.document.dirty).toBe(false);service.dispose();});
it('allows several collider types on one object (compound) and produces local debug outlines',()=>{const s=new SceneService(()=>definitions),id=s.create();s.addComponent(id,'physics.boxCollider2d');s.addComponent(id,'physics.circleCollider2d');const outlines=colliderOutlines(s.document.current.entities);expect(outlines.map(o=>o.points.length)).toEqual([4,40]);});
it('applies restitution and friction to the actual solver',()=>{function run(restitution:number,friction:number){const e=body('box',0,0),ground=floor();e.components[1].data={...defaultRigidBody,airFriction:0,restitution,friction,velocityX:100};const s=new PhysicsSession(()=>[e,ground],defaultPhysicsSettings,matterProvider);s.start();let bounce=false;for(let i=0;i<120;i++){s.system.fixedUpdate!(1/60);if(s.diagnostics.bodies.find(p=>p.entityId==='box')!.velocityY<-20)bounce=true;}const velocity=s.diagnostics.bodies.find(p=>p.entityId==='box')!.velocityX;s.dispose();return{bounce,velocity};}expect(run(1,0).bounce).toBe(true);expect(run(0,0).bounce).toBe(false);expect(Math.abs(run(0,1).velocity)).toBeLessThan(Math.abs(run(0,0).velocity));});
it('registers neutral physics components and the Matter provider through the real host',async()=>{const host=new ModuleHost();await host.start([{manifest:{id:'scene',version:'1.0.0',apiVersion:1},activate(){}},projectModule(()=>definitions,()=>[]),physicsModule({get:()=>false,set(){}}),matterModule]);expect(host.states.get('physics')).toBe('active');expect(host.states.get('matter')).toBe('active');expect(host.entries(physicsProviders)).toHaveLength(1);await host.stop();});

const bare=(id:string,x:number,y:number,...components:Entity['components'])=>{const e=makeEntity(id,x,y);e.id=id;e.components.push(...components);return e;};
const rb=(id:string,data:Partial<typeof defaultRigidBody>={})=>({id:`rb-${id}`,type:'physics.rigidBody2d',version:1,data:{...defaultRigidBody,airFriction:0,...data}});
const box=(id:string,w=40,h=40,extra={})=>({id:`box-${id}`,type:'physics.boxCollider2d',version:1,data:{width:w,height:h,offsetX:0,offsetY:0,sensor:false,chamfer:0,...extra}});
const run=(s:PhysicsSession,n:number)=>{for(let i=0;i<n;i++)s.system.fixedUpdate!(1/60);};
const noGravity={...defaultPhysicsSettings,gravityX:0,gravityY:0};

it('kinematic bodies follow their transform and push dynamic bodies; dynamic children write parent-space poses',()=>{
 const pusher=bare('pusher',0,0,rb('pusher',{bodyType:'kinematic'}),box('pusher',40,200)),ball=bare('ball',60,0,rb('ball'),box('ball'));
 const s=new PhysicsSession(()=>[pusher,ball],noGravity,matterProvider);s.start();
 for(let i=0;i<60;i++){(pusher.components[0].data as {x:number}).x+=3;s.system.fixedUpdate!(1/60);}
 expect(transform(pusher).x).toBe(180);expect(transform(ball).x).toBeGreaterThan(200);s.dispose();
 const parent=bare('parent',100,100);Object.assign(parent.components[0].data!,{rotation:90});const child=bare('child',0,0,rb('child'),box('child'));child.parentId='parent';
 const g=new PhysicsSession(()=>[parent,child],defaultPhysicsSettings,matterProvider);g.start();run(g,30);
 const world=g.diagnostics.bodies[0];expect(world.y).toBeGreaterThan(100);expect(transform(child).x).toBeCloseTo(world.y-100,3);expect(transform(child).y).toBeCloseTo(-(world.x-100),3);g.dispose();
});

it('writes a child body back through its parent pivot, rotation and scale', () => {
 const parent = bare('pivoted', 140, 120);
 Object.assign(parent.components[0].data!, {pivotX: 23, pivotY: -17, rotation: 90, scaleX: 2, scaleY: 3});
 const child = bare('child', 45, 35, rb('child'), box('child'));
 child.parentId = parent.id;
 const session = new PhysicsSession(() => [parent, child], defaultPhysicsSettings, matterProvider);
 try {
  session.start();
  run(session, 30);
  const pose = session.diagnostics.bodies[0];
  expect(pose.y).toBeGreaterThan(164);
  expect(transform(child).x).toBeCloseTo((pose.y - 120) / 2 + 23, 5);
  expect(transform(child).y).toBeCloseTo((140 - pose.x) / 3 - 17, 5);
 } finally { session.dispose(); }
});

it('compound bodies take collider-only children as parts; tilemaps collide as merged rectangles; polygons use their convex hull',()=>{
 const car=bare('car',0,0,rb('car'),box('car',100,20)),wheel=bare('wheel',-40,20,{id:'c-w',type:'physics.circleCollider2d',version:1,data:{radius:10,offsetX:0,offsetY:0,sensor:false}});wheel.parentId='car';
 const plan=compilePhysics([car,wheel]).plans;expect(plan).toHaveLength(1);expect(plan[0].spec.parts.map(p=>[p.kind,p.x,p.y])).toEqual([['box',0,0],['circle',-40,20]]);
 const map=bare('map',0,300,{id:'tm',type:'pixi.tilemap',version:1,data:{assetId:'',tileWidth:32,tileHeight:32,columns:4,rows:2,alpha:1,tiles:[0,0,-1,0, 0,0,-1,-1],collision:'solid'}});
 const tiles=compilePhysics([map]).plans[0].spec.parts;expect(tiles.map(p=>p.kind==='box'?[p.x,p.y,p.width,p.height]:[])).toEqual([[32,32,64,64],[112,16,32,32]]);
 const ball=bare('ball',40,200,rb('ball'),box('ball',20,20)),s=new PhysicsSession(()=>[ball,map],defaultPhysicsSettings,matterProvider);s.start();run(s,90);expect(transform(ball).y).toBeCloseTo(290,0);s.dispose();
 const poly=bare('poly',0,0,rb('poly'),{id:'pg',type:'physics.polygonCollider2d',version:1,data:{points:'0,-50 50,40 0,0 -50,40',offsetX:0,offsetY:0,sensor:false}});expect(compilePhysics([poly]).errors).toEqual([]);
 expect(compilePhysics([bare('bad',0,0,rb('bad'),{id:'pg2',type:'physics.polygonCollider2d',version:1,data:{points:'1,2 3',offsetX:0,offsetY:0,sensor:false}})]).errors.join()).toContain('polygon');
});

it('collision layers, masks and groups decide who collides',()=>{
 const floorOf=()=>bare('floor',0,200,box('floor',2000,20));const ghost=bare('ghost',0,0,rb('ghost',{layer:1,mask:2}),box('ghost'));
 const s=new PhysicsSession(()=>[ghost,floorOf()],{...defaultPhysicsSettings,layers:['Default','Ghosts']},matterProvider);s.start();run(s,120);expect(transform(ghost).y).toBeGreaterThan(300);s.dispose();
 const a=bare('a',0,0,rb('a',{group:-1}),box('a')),b=bare('b',0,100,rb('b',{group:-1,bodyType:'static'}),box('b',200,20)),g=new PhysicsSession(()=>[a,b],defaultPhysicsSettings,matterProvider);g.start();run(g,60);expect(transform(a).y).toBeGreaterThan(100);g.dispose();
});

it('joints: a pin hangs a body from a world point, a distance joint keeps two bodies apart, a rope only stops stretching',()=>{
 const joint=(id:string,data:Record<string,unknown>)=>({id,type:'physics.joint2d',version:1,data:{kind:'distance',target:'',anchorX:0,anchorY:0,targetAnchorX:0,targetAnchorY:0,length:0,stiffness:1,damping:0,collideConnected:true,...data}});
 const bob=bare('bob',100,0,rb('bob'),box('bob',20,20),joint('pin',{kind:'distance',targetAnchorX:0,targetAnchorY:0}));
 const s=new PhysicsSession(()=>[bob],defaultPhysicsSettings,matterProvider);s.start();run(s,240);const p=transform(bob);expect(Math.hypot(p.x,p.y)).toBeCloseTo(100,-1);expect(p.y).toBeGreaterThan(30);expect(s.diagnostics.joints).toEqual(['pin']);s.dispose();
 const rope=bare('rope',0,0,rb('rope'),box('rope',20,20),joint('r',{kind:'rope',length:150}));const r=new PhysicsSession(()=>[rope],defaultPhysicsSettings,matterProvider);r.start();run(r,10);expect(transform(rope).y).toBeLessThan(50);run(r,240);expect(transform(rope).y).toBeLessThan(170);expect(transform(rope).y).toBeGreaterThan(120);r.dispose();
 expect(compilePhysics([bare('j',0,0,rb('j'),box('j'),joint('x',{target:'nobody'}))]).errors.join()).toContain('missing');
 const remapped=JSON.parse(JSON.stringify((jointDefinition.remapReferences!(joint('k',{target:'old'}).data as never,{entities:new Map([['old','new']]),components:new Map()}))));expect(remapped.target).toBe('new');
});

it('controls: velocity, impulse, force, teleport, gravity, gravity scale; queries: raycast, point and region; pointer drag',()=>{
 const a=bare('a',0,0,rb('a',{draggable:true}),box('a',20,20)),floating=bare('f',300,0,rb('f',{gravityScale:0}),box('f',20,20)),wall=bare('wall',500,0,box('wall',20,400));
 const s=new PhysicsSession(()=>[a,floating,wall],defaultPhysicsSettings,matterProvider);s.start();
 s.controls.setVelocity('a',600,0);run(s,1);expect(s.controls.body('a')!.velocityX).toBeCloseTo(600,0);
 const mass=s.controls.body('a')!.mass;s.controls.setVelocity('a',0,0);s.controls.applyImpulse('a',mass*120,0);expect(s.controls.body('a')!.velocityX).toBeCloseTo(120,3);
 run(s,30);expect(transform(floating).y).toBeCloseTo(0,5);expect(transform(a).y).toBeGreaterThan(5);
 s.controls.teleport('a',100,-200);run(s,1);expect(transform(a).x).toBeCloseTo(100,0);
 s.controls.setGravity(0,0);expect(s.controls.gravity()).toEqual({x:0,y:0});s.controls.setVelocity('a',0,0);const y=transform(a).y;run(s,30);expect(transform(a).y).toBeCloseTo(y,3);
 s.controls.applyForce('f',0,-mass*600*60);run(s,1);expect(s.controls.body('f')!.velocityY).toBeLessThan(-1);
 const hits=s.controls.raycast(0,0,1000,0);expect(hits.map(h=>h.entityId)).toEqual(['f','wall']);expect(hits[1].x).toBeCloseTo(490,0);expect(hits[1].normalX).toBe(-1);expect(Math.abs(hits[1].normalY)).toBeLessThan(1e-9);
 expect(s.controls.objectsAt(500,100)).toEqual(['wall']);expect(s.controls.objectsIn(480,-10,40,20).sort()).toEqual(['wall']);
 expect(()=>s.controls.setVelocity('wall',1,1)).toThrow('dynamic');
 const at=s.diagnostics.bodies.find(b=>b.entityId==='a')!;expect(s.pointer('down',at.x,at.y)).toBe(true);expect(s.diagnostics.dragging).toBe('a');for(let i=0;i<60;i++){s.pointer('move',at.x+200,at.y);s.system.fixedUpdate!(1/60);}expect(transform(a).x).toBeGreaterThan(at.x+150);s.pointer('up',0,0);expect(s.diagnostics.dragging).toBeNull();
 expect(s.pointer('down',500,0)).toBe(false);s.dispose();
});

it('contacts carry the point, normal and speed; walls keep bodies on the stage; time scale 0 freezes the world',()=>{
 const events:PhysicsEvent[]=[],ball=bare('ball',100,0,rb('ball'),box('ball',20,20)),ground=bare('ground',100,300,box('ground',400,20));
 const s=new PhysicsSession(()=>[ball,ground],defaultPhysicsSettings,matterProvider,{event:e=>events.push(e)});s.start();run(s,120);
 const hit=events.find(e=>e.phase==='enter')!;expect(hit.contact!.normalY).not.toBe(0);expect(hit.contact!.speed).toBeGreaterThan(100);expect(hit.contact!.y).toBeGreaterThan(270);s.dispose();
 const flying=bare('flying',100,100,rb('flying',{velocityX:-3000}),box('flying',20,20)),w=new PhysicsSession(()=>[flying],{...noGravity,walls:true},matterProvider,{bounds:()=>({width:960,height:540})});w.start();run(w,60);expect(transform(flying).x).toBeGreaterThan(0);w.dispose();
 const frozen=bare('frozen',0,0,rb('frozen'),box('frozen')),f=new PhysicsSession(()=>[frozen],{...defaultPhysicsSettings,timeScale:0},matterProvider);f.start();run(f,30);expect(transform(frozen).y).toBe(0);f.dispose();
});
it('duplicates a scene whose components reference objects (not scenes), e.g. a camera target or a joint', async () => {
 const {jointDefinition} = await import('@rewrite/physics');
 const map = new Map([[transformDefinition.type, transformDefinition], [jointDefinition.type, jointDefinition]]), p = new ProjectService(() => map, () => []), a = makeEntity('A'), b = makeEntity('B');
 a.components.push({id: 'j', type: jointDefinition.type, version: 1, data: {...(jointDefinition.defaults() as object), target: b.id}});
 p.fresh({formatVersion: 1, id: 'source', name: 'Level', entities: [a, b]});
 p.duplicateScene('source');
 const copy = p.sceneDocument.current;
 expect((copy.entities[0].components[1].data as {target: string}).target).toBe(copy.entities[1].id);
});
it('a concave cup holds a ball inside it, and the collision matrix lets layers pass through each other',()=>{
 const cup=makeEntity('cup',0,100);cup.id='cup';cup.components.push({id:'cup-c',type:'physics.polygonCollider2d',version:1,data:{points:'-60,-60 -40,-60 -40,40 40,40 40,-60 60,-60 60,60 -60,60',offsetX:0,offsetY:0,sensor:false}});
 const ball=body('ball',0,-100,'circle');
 const ghost=body('ghost',300,-100);const ghostBody=ghost.components.find(c=>c.type==='physics.rigidBody2d')!;ghostBody.data={...(ghostBody.data as object),layer:1};
 const ground=floor();
 const settings={...defaultPhysicsSettings,layers:['Default','Ghost'],collisions:[65535&~2,65535&~1]};
 const session=new PhysicsSession(()=>[cup,ball,ghost,ground],settings,matterProvider);session.start();expect(session.errors).toEqual([]);
 for(let i=0;i<240;i++)session.system.fixedUpdate!(1/60);
 const poses=Object.fromEntries(session.diagnostics.bodies.map(b=>[b.entityId,b]));
 // The ball rests on the cup's inner floor (y 140 − its radius), not on its hull's top edge (y 40).
 expect(poses.ball.y).toBeGreaterThan(100);expect(Math.abs(poses.ball.x)).toBeLessThan(40);
 // The Ghost layer does not collide with Default: it falls through the floor.
 expect(poses.ghost.y).toBeGreaterThan(400);
 session.dispose();
});
