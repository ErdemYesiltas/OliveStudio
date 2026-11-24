import {z} from 'zod';
import {ParticlesSchema,particlesDefinition} from '@rewrite/render-pixi/objects';
export const section='particles.presets';
export const SettingsSchema=ParticlesSchema.omit({startedAt:true,stoppedAt:true});
export type Settings=z.infer<typeof SettingsSchema>;
export const PresetSchema=z.object({id:z.string().min(1).max(100),name:z.string().trim().min(1).max(80),settings:SettingsSchema}).strict();
export const PresetsSchema=z.object({version:z.literal(1),items:z.array(PresetSchema).max(64)}).strict().refine(v=>new Set(v.items.map(i=>i.id)).size===v.items.length,'Duplicate preset ID');
const base=()=>SettingsSchema.parse(particlesDefinition.defaults());
export const presets=[
 {id:'fire',name:'Fire',settings:{particleTexture:'soft',count:180,lifetime:1.4,speed:95,direction:-90,spread:28,gravity:-30,size:16,endScale:.15,tint:'#ffcf63',endTint:'#d83b16',spawnShape:'circle',spawnRadius:16,blendMode:'add'}},
 {id:'smoke',name:'Smoke',settings:{particleTexture:'soft',count:90,lifetime:4,speed:30,direction:-90,spread:35,gravity:-8,size:9,endScale:4,tint:'#8e96a2',endTint:'#424953',alpha:.35,spawnShape:'circle',spawnRadius:20,rotationSpeed:16}},
 {id:'snow',name:'Snow',settings:{particleTexture:'circle',count:160,lifetime:5,speed:30,direction:90,spread:30,gravity:8,size:4,endScale:.7,tint:'#e4f4ff',spawnShape:'box',spawnWidth:420,spawnHeight:120,sizeRandom:.6}},
 {id:'rain',name:'Rain',settings:{particleTexture:'square',count:250,lifetime:1.6,speed:260,direction:100,spread:4,gravity:80,size:3,endScale:1,tint:'#80b9ed',alpha:.6,spawnShape:'box',spawnWidth:500,spawnHeight:160}},
 {id:'sparkles',name:'Sparkles',settings:{particleTexture:'soft',count:100,lifetime:2,speed:18,direction:-90,spread:360,gravity:0,size:5,endScale:0,tint:'#cfadff',endTint:'#fff0a5',spawnShape:'circle',spawnRadius:90,blendMode:'add',sizeRandom:.7}},
 {id:'explosion',name:'Explosion',settings:{particleTexture:'soft',count:220,lifetime:.8,speed:330,direction:0,spread:360,gravity:150,size:8,endScale:0,tint:'#ffda79',endTint:'#ed4d2c',emission:'burst',blendMode:'add',rotationSpeed:180}},
].map(p=>PresetSchema.parse({...p,settings:{...base(),...p.settings}}));
export function cleanSettings(input:unknown):Settings{const p=ParticlesSchema.parse(input);const {startedAt:_a,stoppedAt:_b,...settings}=p;return SettingsSchema.parse(settings);}
