import {z} from 'zod';
import type {Json} from '@rewrite/sdk';
import {makeEntity,type Entity} from '@rewrite/scene';
import {stageSize,type ProjectService} from '@rewrite/project';
import {SettingsSchema,PresetsSchema,PresetSchema,section,presets,cleanSettings,type Settings} from './contracts';
export interface ParticlePorts{editable():boolean;useEditable():boolean;selected():string|null;useSelected():string|null;select(id:string):void;report(error:unknown):void;text(key:string):string}
export class ParticleEditor{
 version=0;draft:Settings={...presets[0].settings};entityId:string|null=null;dirty=false;playing=true;loop=true;private offset=0;private start=performance.now();private listeners=new Set<()=>void>();private unsub:()=>void;
 constructor(readonly project:ProjectService,readonly ports:ParticlePorts){this.unsub=project.document.subscribe(()=>{if(this.entityId&&!this.dirty){const e=this.entity(this.entityId);if(e?.components.some(c=>c.type==='pixi.particles'))this.load(this.entityId);else{this.entityId=null;this.changed();}}});}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};snapshot=()=>this.version;
 changed(){this.version++;for(const fn of this.listeners)fn();}
 entity(id:string){return this.project.document.current.scenes.find(s=>s.id===this.project.activeSceneId)?.entities.find(e=>e.id===id);}
 private edit(label:string,work:Parameters<ProjectService['document']['transact']>[1]){if(!this.ports.editable())throw Error('Stop scene Preview before editing particles');this.project.document.transact(label,work);}
 presets(){return [...presets,...PresetsSchema.parse(this.project.document.current.extensions[section]??{version:1,items:[]}).items];}
 load(id:string|null){if(id===null){this.entityId=null;this.dirty=false;this.changed();return;}const c=this.entity(id)?.components.find(c=>c.type==='pixi.particles'&&c.version===1);if(!c)throw Error('Choose a particle emitter');this.entityId=id;this.draft=cleanSettings(c.data);this.dirty=false;this.seek(0);}
 change(value:unknown){this.draft=SettingsSchema.parse(value);this.dirty=true;this.changed();}
 patch(value:Partial<Settings>){this.change({...this.draft,...value});}
 preset(id:string){const p=this.presets().find(p=>p.id===id);if(!p)throw Error('Preset not found');this.draft=structuredClone(p.settings);this.dirty=true;this.seek(0);}
 apply(entityId=this.entityId){if(!entityId)throw Error('Select a particle emitter or create one');const value=SettingsSchema.parse(this.draft);this.edit('Edit particle effect',p=>{const c=p.scenes.find(s=>s.id===this.project.activeSceneId)?.entities.find(e=>e.id===entityId)?.components.find(c=>c.type==='pixi.particles'&&c.version===1);if(!c)throw Error('Particle emitter not found in open scene');c.data=value as Json;});this.entityId=entityId;this.dirty=false;this.changed();return{entityId,settings:value};}
 create(name='Particles',raw:unknown=this.draft,at?:{x:number;y:number}){const settings=SettingsSchema.parse(raw),stage=stageSize(this.project.document.current),e=makeEntity(z.string().trim().min(1).max(100).parse(name),at?.x??stage.width/2,at?.y??stage.height/2);e.components.push({id:crypto.randomUUID(),type:'pixi.particles',version:1,data:settings});this.edit('Create particle emitter',p=>{p.scenes.find(s=>s.id===this.project.activeSceneId)!.entities.push(e);});this.entityId=e.id;this.draft=settings;this.dirty=false;this.ports.select(e.id);this.changed();return e;}
 savePreset(name:string,id:string=crypto.randomUUID()){if(presets.some(p=>p.id===id))throw Error('Built-in presets are read-only');const preset=PresetSchema.parse({id,name,settings:this.draft}),data=PresetsSchema.parse(this.project.document.current.extensions[section]??{version:1,items:[]}),index=data.items.findIndex(p=>p.id===id);if(index<0)data.items.push(preset);else data.items[index]=preset;this.edit('Save particle preset',p=>{p.extensions[section]=PresetsSchema.parse(data) as Json;});this.changed();return preset;}
 removePreset(id:string){if(presets.some(p=>p.id===id))throw Error('Built-in presets are read-only');const data=PresetsSchema.parse(this.project.document.current.extensions[section]??{version:1,items:[]});this.edit('Remove particle preset',p=>{p.extensions[section]={...data,items:data.items.filter(p=>p.id!==id)};});this.changed();}
 time(){return this.offset+(this.playing?(performance.now()-this.start)/1000:0);}
 seek(time:number){this.offset=z.number().finite().min(0).max(3600).parse(time);this.start=performance.now();this.changed();}
 play(value:boolean){this.offset=this.time();this.start=performance.now();this.playing=value;this.changed();}
 preview(){const t=this.time();return{settings:{...this.draft,autoplay:true},time:this.draft.emission==='burst'&&this.loop?t%(this.draft.lifetime+.5):t};}
 all():Entity[]{return this.project.document.current.scenes.find(s=>s.id===this.project.activeSceneId)!.entities.filter(e=>e.components.some(c=>c.type==='pixi.particles'&&c.version===1));}
 dispose(){this.unsub();this.listeners.clear();}
}
