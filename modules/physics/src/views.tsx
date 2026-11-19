import {CommitInput,finiteNumber} from '@rewrite/ui/drafts';
import {useSyncExternalStore} from 'react';
import type {Entity,SceneService} from '@rewrite/scene';
import {compilePhysics,colliderTypes,physicsLayerCount,layersCollide,setLayerPair,RigidBodySchema,JointSchema,type PhysicsService,type PhysicsSettings} from './index';

export function createPhysicsViews(bridge:{service:PhysicsService;scene:SceneService;useEditable():boolean;text(key:string):string;report(error:unknown):void}){
 const {service,scene,text}=bridge;
 const change=(work:()=>void)=>{try{work();}catch(e){bridge.report(e);}};
 function NumberSetting({k,value,disabled,step='any'}:{k:keyof PhysicsSettings;value:number;disabled:boolean;step?:string}){return <label className="field"><span>{text(`physics.${k}`)}</span><CommitInput label={text(`physics.${k}`)} type="number" step={step} disabled={disabled} value={value} commit={raw=>service.setSettings({[k]:finiteNumber(raw)})}/></label>;}
 /** Physics panel: debug outlines, the world (gravity, speed, solver, walls) and the collision layer names. */
 function Settings(){
  useSyncExternalStore(service.project.document.subscribe,()=>service.project.document.version);
  const debug=useSyncExternalStore(service.subscribe,()=>service.debug),editable=bridge.useEditable(),settings=service.settings,check=compilePhysics(scene.document.current.entities);
  const layers=settings.layers,setLayers=(next:string[])=>change(()=>service.setSettings({layers:next,...(settings.collisions?{collisions:settings.collisions.slice(0,next.length)}:{})}));
  return <div className="panel-body physics-panel" data-testid="physics-panel">
   <label className="field"><span>{text('physics.debug')}</span><input type="checkbox" aria-label={text('physics.debug')} checked={debug} onChange={e=>service.setDebug(e.target.checked)}/></label>
   <h3>{text('physics.world')}</h3>
   <NumberSetting k="gravityX" value={settings.gravityX} disabled={!editable}/><NumberSetting k="gravityY" value={settings.gravityY} disabled={!editable}/>
   <NumberSetting k="timeScale" value={settings.timeScale} disabled={!editable}/>
   <NumberSetting k="positionIterations" value={settings.positionIterations} disabled={!editable} step="1"/><NumberSetting k="velocityIterations" value={settings.velocityIterations} disabled={!editable} step="1"/>
   <label className="field"><span>{text('physics.sleeping')}</span><input type="checkbox" aria-label={text('physics.sleeping')} checked={settings.sleeping} disabled={!editable} onChange={e=>change(()=>service.setSettings({sleeping:e.target.checked}))}/></label>
   <label className="field"><span>{text('physics.walls')}</span><input type="checkbox" aria-label={text('physics.walls')} checked={settings.walls} disabled={!editable} onChange={e=>change(()=>service.setSettings({walls:e.target.checked}))}/></label>
   <p className="panel-empty">{text('physics.units')}</p>
   <h3>{text('physics.layers')}</h3>
   <div className="physics-layers" data-testid="physics-layers">{layers.map((name,i)=><div className="inline-row" key={i}><small>{i}</small>
    <CommitInput label={`${text('physics.layerName')} ${i}`} value={name} disabled={!editable} commit={raw=>{const next=[...layers];next[i]=raw.trim();setLayers(next);}}/>
    {i>0&&i===layers.length-1&&<button aria-label={`${text('physics.removeLayer')} ${name}`} disabled={!editable} onClick={()=>setLayers(layers.slice(0,-1))}>×</button>}
   </div>)}</div>
   <button disabled={!editable||layers.length>=physicsLayerCount} onClick={()=>setLayers([...layers,`Layer ${layers.length}`])}>{text('physics.addLayer')}</button>
   {layers.length>1&&<><h3>{text('physics.matrix')}</h3><p className="panel-empty">{text('physics.matrixHint')}</p>
   <table className="physics-matrix" data-testid="physics-matrix"><thead><tr><th/>{[...layers].reverse().map((name,j)=><th key={j} scope="col"><span>{name}</span></th>)}</tr></thead>
    <tbody>{layers.map((row,a)=><tr key={a}><th scope="row">{row}</th>{[...layers.keys()].reverse().map(b=>b<a?<td key={b}/>:<td key={b}><input type="checkbox" aria-label={`${text('physics.matrixPair')} ${row} × ${layers[b]}`} checked={layersCollide(settings,a,b)} disabled={!editable} onChange={e=>change(()=>service.setSettings({collisions:setLayerPair(settings,layers.length,a,b,e.target.checked)}))}/></td>)}</tr>)}</tbody></table></>}
   <p>{text('physics.bodyCount')}: {check.plans.length} · {text('physics.jointCount')}: {check.joints.length}</p>
   <p className="panel-empty">{text('physics.rules')}</p>
   {check.errors.map((e,i)=><p key={i} className="component-warning">{e}</p>)}
  </div>;
 }
 /** Inspector additions: layer and mask editors, the joint's target, and what a collider belongs to. */
 function Extra({entity,component}:{entity:Entity;component:Entity['components'][number]}){
  const editable=bridge.useEditable(),entities=scene.document.current.entities,byId=new Map(entities.map(e=>[e.id,e])),hasRigid=(e:Entity)=>e.components.some(c=>c.type==='physics.rigidBody2d');
  const hasCollider=entity.components.some(c=>(colliderTypes as readonly string[]).includes(c.type))||entities.some(e=>e.parentId===entity.id&&!hasRigid(e)&&e.components.some(c=>(colliderTypes as readonly string[]).includes(c.type)));
  const setData=(patch:Record<string,unknown>)=>change(()=>{for(const [k,v] of Object.entries(patch))scene.setField(entity.id,component.type,k,v as never);});
  if(component.type==='physics.rigidBody2d'){
   const body=RigidBodySchema.parse(component.data),layers=service.settings.layers;
   return <div className="physics-filter" data-testid="physics-filter">
    {!hasCollider&&<><p className="component-warning">{text('physics.needsCollider')}</p><div className="inline-row">{colliderTypes.map(type=><button key={type} disabled={!editable} onClick={()=>change(()=>scene.addComponent(entity.id,type))}>{text(`physics.add.${type.split('.')[1].replace('Collider2d','')}`)}</button>)}</div></>}
    <label className="field"><span>{text('physics.layer')}</span><select aria-label={text('physics.layer')} value={body.layer} disabled={!editable} onChange={e=>setData({layer:Number(e.target.value)})}>{layers.map((name,i)=><option key={i} value={i}>{`${i} · ${name}`}</option>)}{body.layer>=layers.length&&<option value={body.layer}>{body.layer}</option>}</select></label>
    <fieldset className="physics-mask"><legend>{text('physics.collidesWith')}</legend>{layers.map((name,i)=><label className="checkbox" key={i}><input type="checkbox" aria-label={`${text('physics.collidesWith')} ${name}`} checked={(body.mask&(2**i))!==0} disabled={!editable} onChange={e=>setData({mask:e.target.checked?body.mask|2**i:body.mask&~(2**i)})}/>{name}</label>)}</fieldset>
   </div>;
  }
  if(component.type==='physics.joint2d'){
   const joint=JointSchema.parse(component.data),others=entities.filter(e=>e.id!==entity.id&&(hasRigid(e)||e.components.some(c=>(colliderTypes as readonly string[]).includes(c.type))));
   return <div data-testid="joint-target">
    <label className="field"><span>{text('physics.jointTarget')}</span><select aria-label={text('physics.jointTarget')} value={joint.target} disabled={!editable} onChange={e=>setData({target:e.target.value})}>
     <option value="">{text('physics.worldPoint')}</option>{joint.target&&!byId.has(joint.target)&&<option value={joint.target}>{text('physics.missingTarget')}</option>}{others.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
    </select></label>
    <p className="panel-empty">{text(joint.target?'physics.jointHelpBody':'physics.jointHelpWorld')}</p>
    {!hasRigid(entity)&&<p className="component-warning">{text('physics.jointNeedsBody')}</p>}
   </div>;
  }
  if((colliderTypes as readonly string[]).includes(component.type)&&!hasRigid(entity)){
   for(let p=entity.parentId?byId.get(entity.parentId):undefined;p;p=p.parentId?byId.get(p.parentId):undefined)if(hasRigid(p))return <p className="panel-empty">{text('physics.partOf').replace('{name}',p.name)}</p>;
   return <p className="panel-empty">{text('physics.colliderStatic')}</p>;
  }
  return null;
 }
 return{Settings,Extra};
}
