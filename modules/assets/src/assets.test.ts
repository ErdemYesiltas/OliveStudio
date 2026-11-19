import { expect,it } from 'vitest';
import { AssetService,RegistrySchema,sectionKey,type AssetPort,type AssetRecord } from './index';
import { ProjectService,projectSections } from '@rewrite/project';
import { transformDefinition } from '@rewrite/scene';
import { ModuleHost } from '@rewrite/kernel';
import { assetsModule } from './index';
const record=(id=crypto.randomUUID(),revision='a'.repeat(64)):AssetRecord=>({id,name:'Image',type:'pixi.texture',revision,source:{extension:'png',bytes:100},metadata:{width:20,height:10}});
const project=()=>new ProjectService(()=>new Map([[transformDefinition.type,transformDefinition]]),()=>[{key:sectionKey,parse:v=>RegistrySchema.parse(v)}]);
it('imports/renames/reimports as aggregate history without changing IDs or other project sections',async()=>{
 const p=project(),first=record(),port:AssetPort={sessionId:'session',import:async()=>[first],cancel:async()=>{}},assets=new AssetService(p,port);
 p.document.transact('opaque',d=>{d.extensions.other={preserved:true};});await assets.import('image');assets.rename(first.id,'Renamed');expect(assets.get(first.id)?.revision).toBe(first.revision);
 port.import=async()=>[{...first,name:'Renamed',revision:'b'.repeat(64),metadata:{width:40,height:30}}];await assets.import('image',first.id);expect(assets.get(first.id)?.revision).toBe('b'.repeat(64));
 p.sceneDocument.undo();expect(assets.get(first.id)?.revision).toBe(first.revision);p.document.redo();expect(assets.get(first.id)?.id).toBe(first.id);
 expect(p.document.current.extensions.other).toEqual({preserved:true});expect(assets.url(first)).toContain(first.revision);
});
it('does not commit late imports into a replaced or disposed project',async()=>{
 const p=project();let resolve!:(v:AssetRecord[])=>void,cancelled=false;
 const service=new AssetService(p,{sessionId:'s',import:()=>new Promise(r=>{resolve=r;}),cancel:async()=>{cancelled=true;}});
 const task=service.import('image');p.fresh();resolve([record()]);await expect(task).rejects.toThrow('Project changed');expect(service.items).toEqual([]);
 const other=service.import('image');await service.dispose();resolve([record()]);await expect(other).rejects.toThrow();expect(cancelled).toBe(true);expect(service.items).toEqual([]);
});
it('rejects mismatched reimport identity atomically and clears busy on failure',async()=>{
 const p=project(),first=record(),port:AssetPort={sessionId:'s',import:async()=>[first],cancel:async()=>{}},a=new AssetService(p,port);await a.import('image');const before=p.document.current;
 port.import=async()=>[record()];await expect(a.import('image',first.id)).rejects.toThrow('target changed');expect(p.document.current).toBe(before);expect(a.busy).toBe(false);
 port.import=async()=>{throw Error('decoder failed');};await expect(a.import('image')).rejects.toThrow();expect(p.document.current).toBe(before);
});
it('registers the assets feature through the host without embedding image types in project schema',async()=>{
 const host=new ModuleHost();const projectKey=(await import('@rewrite/project')).projectToken;
 await host.start([{manifest:{id:'project',version:'1.0.0',apiVersion:1},activate(c){c.provide(projectKey,project());}},assetsModule({sessionId:'s',import:async()=>null,cancel:async()=>{}})]);
 expect(host.entries(projectSections).map(e=>e.value.key)).toEqual([sectionKey,'assets.library']);await host.stop();
});
