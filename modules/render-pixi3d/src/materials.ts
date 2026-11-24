import type {AssetRecord} from '@rewrite/assets';
import type {SceneService} from '@rewrite/scene';
import {Model3DSchema,ModelMetadataSchema,MaterialValuesSchema,modelComponentType,type MaterialValues} from './model-contracts';
export function materialSlotProblems(data:ReturnType<typeof Model3DSchema.parse>,asset:AssetRecord|undefined){
 if(!data.materialSlots.length)return[];
 if(!asset)return['Material override source asset is missing'];
 const metadata=ModelMetadataSchema.safeParse(asset.metadata);if(!metadata.success)return['Material metadata is unavailable'];
 return data.materialSlots.flatMap(slot=>slot.sourceRevision!==asset.revision?[`Material slot ${slot.index+1}: model was reimported; reset or reapply this override`]:!metadata.data.materials.some(m=>m.index===slot.index)?[`Material slot ${slot.index+1} no longer exists`]:[]);
}
/** Normal document transaction shared by Inspector and MCP. No renderer instances in the model. */
export function setMaterialSlot(scene:SceneService,entityId:string,asset:AssetRecord,index:number,values:MaterialValues|null){
 const metadata=ModelMetadataSchema.parse(asset.metadata);if(!Number.isInteger(index)||!metadata.materials.some(m=>m.index===index)){
  // A stale slot may still be removed after reimport removed that source material.
  if(values!==null)throw Error('Choose an existing model material slot');
 }
 const next=values===null?null:MaterialValuesSchema.parse(values);
 scene.document.transact(next?'Override model material slot':'Reset model material slot',doc=>{
  const component=doc.entities.find(e=>e.id===entityId)?.components.find(c=>c.type===modelComponentType&&c.version===1);if(!component)throw Error('Model renderer missing');
  const data=Model3DSchema.parse(component.data);if(data.assetId!==asset.id)throw Error('Model asset changed; choose the material again');
  const slots=data.materialSlots.filter(s=>s.index!==index);if(next)slots.push({index,sourceRevision:asset.revision,...next});slots.sort((a,b)=>a.index-b.index);
  component.data=Model3DSchema.parse({...data,materialSlots:slots});
 });
}
