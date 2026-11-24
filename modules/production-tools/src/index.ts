import {z} from 'zod';
import {token,panels,components,automationTools,automationTool,type EditorModule,type Json,type ModuleContext} from '@rewrite/sdk';
import {projectToken,projectSections} from '@rewrite/project';
import {ProductionService,type ProductionPorts} from './service';
import {createProductionPanel,titles} from './views';
import {keys,sections,schemas,GraphSchema,CharacterSchema,Point,id} from './contracts';
import {characterDefinition,platformDefinition} from './runtime';
import {connectivity,statePaths,validateData,unique} from './models';
export * from './service';
export const productionToken=token<ProductionService>('production.core','production.service');
const empty=z.object({}).strict();
function tools(c:ModuleContext,s:ProductionService,key:typeof keys[number]|'kits'){
 const add=<T,>(name:string,schema:z.ZodType<T>,definition:Parameters<typeof automationTool<T>>[1])=>c.contribute(automationTools,`production.${name}`,automationTool(schema,definition));
 if(key!=='kits'){
  add(`${key}.read`,empty,{description:`Read the versioned ${key} document.`,effect:'read',execute:()=>s.read(key)});
  add(`${key}.save`,z.object({value:schemas[key]}).strict(),{description:`Replace the validated ${key} document in one undoable transaction. Read first to preserve existing records.`,effect:'edit',execute:a=>{s.save(key,a.value);return s.read(key);}});
 }
 if(key==='world'){
  add('world.move_room',z.object({sceneId:id,x:z.number().finite(),y:z.number().finite()}).strict(),{description:'Place a room on the world map; does not change scene geometry.',effect:'edit',execute:a=>s.room(a.sceneId,a.x,a.y)});
  add('world.diagnostics',empty,{description:'Report missing portal references and rooms unreachable from the entry scene.',effect:'read',execute:()=>connectivity(s.project.document.current)});
 }
 if(key==='brushes')add('brushes.stroke',z.object({brushId:id,points:z.array(Point).min(1).max(2048),entityId:id.optional(),erase:z.boolean().default(false)}).strict(),{description:'Bake a seeded prefab stroke in world coordinates or terrain stroke in tilemap local pixels. One undo step.',effect:'edit',execute:a=>s.stroke(a.brushId,a.points,a.entityId,a.erase)});
 if(key==='graphs')add('graphs.compile',z.object({graph:GraphSchema,entityId:id.optional()}).strict(),{description:'Validate and compile an owned statechart into an XState behavior script; optionally attach to an object. Protects custom script edits.',effect:'edit',execute:a=>s.graph(a.graph,a.entityId)});
 if(key==='lab')add('lab.apply',z.object({entityId:id,values:CharacterSchema}).strict(),{description:'Apply a provider-neutral kinematic controller to a root object, one undo step.',effect:'edit',execute:a=>s.applyCharacter(a.entityId,a.values)});
 if(key==='data'){
  add('data.apply',empty,{description:'Apply all validated table-to-component bindings, one undo step.',effect:'edit',execute:()=>s.applyData()});
  add('data.export_csv',z.object({tableId:id}).strict(),{description:'Export typed table as RFC-style CSV text.',effect:'read',execute:a=>({csv:s.csv(a.tableId)})});
  add('data.import_csv',z.object({tableId:id,csv:z.string().max(2000000)}).strict(),{description:'Replace table rows from CSV, preserving typed schema; validates before transaction.',effect:'edit',execute:a=>s.csv(a.tableId,a.csv)});
 }
 if(key==='tests'){
  add('tests.run',z.object({testId:id}).strict(),{description:'Run a saved fixed-frame Preview scenario with assertions, cancellation, samples and source-fingerprinted proof. Stops Preview afterwards.',effect:'job',cancellable:true,execute:async(a,c)=>{const r=await s.run(a.testId,c.signal);const {samples,...summary}=r;return {...summary,sampleCount:samples.length};}});
  add('tests.samples',z.object({run:z.number().int().min(0).max(9).default(0),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(100).default(20)}).strict(),{description:'Page cached observations from a recent run (0 is latest); read-only, no physics rewind.',effect:'read',execute:a=>{const r=s.reports[a.run];if(!r)throw Error('Run not found');return{total:r.samples.length,samples:r.samples.slice(a.offset,a.offset+a.limit),nextOffset:a.offset+a.limit<r.samples.length?a.offset+a.limit:null};}});
  add('tests.record_start',z.object({name:z.string().min(1).max(100)}).strict(),{description:'Start a fresh paused frame-0 Preview and begin recording raw keyboard edges. Resume Preview to play.',effect:'job',execute:a=>s.recordStart(a.name)});
  add('tests.record_cancel',empty,{description:'Cancel input recording and release its keyboard listener.',effect:'session',execute:()=>s.cancelRecord()});
  add('tests.record_finish',empty,{description:'Finish recording and return a scenario draft. Stop Preview, add assertions, then save through tests.save.',effect:'session',execute:()=>s.recordStop()});
  add('tests.results',empty,{description:'Read latest bounded test runs, samples and assertion failures.',effect:'read',execute:()=>s.reports.map(({samples,...r})=>({...r,sampleCount:samples.length}))});
 }
 if(key==='reviews'){
  add('reviews.capture',z.object({name:z.string().min(1).max(100)}).strict(),{description:'Capture local scene, asset and prefab baseline (max five), undoable.',effect:'edit',execute:a=>s.baseline(a.name)});
  add('reviews.compare',z.object({id}).strict(),{description:'Read stable-ID changes against a local baseline.',effect:'read',execute:a=>s.compare(a.id)});
  add('reviews.git',z.object({revision:z.string().min(1).max(100)}).strict(),{description:'Read project differences against a Git revision without checkout or mutation.',effect:'read',execute:a=>s.compareGit(a.revision)});
 }
 if(key==='quality')add('quality.report',empty,{description:'Read budgets, source fingerprint, required fresh test proofs and world/data reference diagnostics.',effect:'read',execute:()=>s.quality()});
 if(key==='kits'){
  add('kits.create',z.object({kind:z.enum(['platformer','topdown']),name:z.string().min(1).max(100).default('Player'),width:z.number().int().min(64).max(4096).default(960),height:z.number().int().min(64).max(4096).default(540)}).strict(),{description:'Add a configured character, ground and missing input actions in one undoable transaction.',effect:'edit',execute:a=>({entities:s.kit(a.kind,a.name,a.width,a.height)})});
  add('kits.search',z.object({query:z.string().min(1).max(200)}).strict(),{description:'Search names, IDs, components and serialized references across all scenes (max 200 hits).',effect:'read',execute:a=>s.search(a.query)});
 }
}
/** Independent manifests, shared public service and normal document transactions; no host feature branches. */
export function createProductionModules(ports:ProductionPorts):EditorModule[]{return[
 {manifest:{id:'production.core',version:'1.0.0',apiVersion:1,requires:{project:'^1',scene:'^1'}},activate(c){const s=new ProductionService(c.get(projectToken),ports);c.provide(productionToken,s);c.own(()=>s.dispose());}},
 ...([...keys,'kits']as const).map((key):EditorModule=>({manifest:{id:`production.${key}`,version:'1.0.0',apiVersion:1,requires:{'production.core':'^1',scripts:'^1',behavior:'^1'}},activate(c){const s=c.get(productionToken);if(key!=='kits')c.contribute(projectSections,`${c.id}.section`,{key:sections[key],parse:v=>schemas[key].parse(v) as Json,validate:p=>{if(p.extensions[sections[key]]===undefined)return;if(key==='graphs'){const g=schemas.graphs.parse(p.extensions[sections.graphs]);unique(g.items.map(x=>x.id),'graph');for(const graph of g.items)statePaths(graph);}if(key==='data')validateData(p.extensions[sections.data],p,s.ports.definitions(),true);if(key==='world'){const w=schemas.world.parse(p.extensions[sections.world]);unique(w.rooms.map(r=>r.sceneId),'room');unique(w.portals.map(r=>r.id),'portal');}},...(key==='world'?{sceneReferences:p=>schemas.world.parse(p.extensions[sections.world]??{version:1,rooms:[],portals:[]}).portals.flatMap(g=>[{targetSceneId:g.fromScene,label:`Portal ${g.name}`},{targetSceneId:g.toScene,label:`Portal ${g.name}`}])}:{})});if(key==='lab'){c.contribute(components,`${c.id}.character`,characterDefinition);c.contribute(components,`${c.id}.platform`,platformDefinition);}c.contribute(panels,`${c.id}.panel`,{titleKey:`production.panel.${key}`,icon:({world:'tilemap',brushes:'prefab',graphs:'logic',tests:'activity',lab:'input',data:'grid',reviews:'git',quality:'export',kits:'sparkles'}as const)[key],view:createProductionPanel(s,key),preferredWidth:480,preferredHeight:620,defaultDock:key==='world'||key==='graphs'?'bottom':'right'});tools(c,s,key);}})),
 ];}
export {titles};
