import {readGridSettings,gridSteps,type GridSettings} from '@rewrite/render-pixi';
import {z} from 'zod';
import {DraftController,DraftProvider} from '@rewrite/ui/drafts';
import {createProjectViews} from '@rewrite/project/views';
import {recoveryModule,type RecoveryListing} from '@rewrite/recovery';
import {createRecoveryViews} from '@rewrite/recovery/views';
import {prefabsModule,prefabToken,PrefabRegistrySchema,prefabSection} from '@rewrite/prefabs';
import {createPrefabViews} from '@rewrite/prefabs/views';
import {buildModule,buildToken,buildTargets,type BuildService} from '@rewrite/build';
import {createBuildPanel} from '@rewrite/build/views';
import {htmlExportModule} from '@rewrite/html-export';
import {isActive,BindingsSchema,StateMachineSchema,TimerSession,type ActionContext,createInteractionsModule,interactionMediaModule,interactionTriggers,interactionActions,InteractionSession,validateInteractions,GlobalStore,type GlobalValue,formatTemplate,hasTemplate,localizeText,GlobalsSchema,defaultGlobals,globalsSection,LocalizationSchema,localizationSection,defaultLocalization,createLanguageStore,type LanguageStore,type InteractionCatalog} from '@rewrite/interactions';
import {createInteractionInspector,createGlobalsPanel,createLocalizationPanel} from '@rewrite/interactions/views';
import {createStateMachineInspector} from '@rewrite/interactions/statemachine-views';
import {createGraphPanel,GraphSummary} from '@rewrite/interactions/graph-views';
import {inputModule,InputSession,InputMapSchema,defaultInputMap,inputSection} from '@rewrite/input';
import {createInputPanel} from '@rewrite/input/views';
import { useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode } from 'react';
import { BehaviorSubject } from 'rxjs';
import { createPortal } from 'react-dom';
import { SheetSlicer } from './SheetSlicer';
import { cutoutBackground } from './cutout';
import { deviceFrame, devicePreviews } from '@rewrite/render-pixi/device-frame';
import { Copy,Trash2,Move,RotateCw,Scaling,Focus,RotateCcw,Grid2X2,Magnet,Ruler,ScanEye } from 'lucide-react';
import { DndContext,DragOverlay,PointerSensor,KeyboardSensor,useSensor,useSensors,useDroppable,pointerWithin,type DragEndEvent } from '@dnd-kit/core';
import { ModuleHost } from '@rewrite/kernel';
import { overlays,components,commands,menus,panels,tools,workspaces,createItems,settings,settingsSections,settingsToken,SettingsStore,type EditorModule,type Json } from '@rewrite/sdk';
import { RenderSettingsSchema,renderSettingsSection } from '@rewrite/render-pixi/contracts';
import { createGameSettings } from './GameSettings';
import { sceneModule,sceneToken,blankScene,makeEntity,transform,pivotKeepingPlace,subtreeRoots,subtreeIds,EntityClipboardSchema,spawnCopy,parentsFirst,referencePaths,spawnSection,worldPosition,type SceneService,type Scene,type Entity } from '@rewrite/scene';
import { createSceneViews,useScene,type AlignKind } from '@rewrite/scene/views';
import { projectModule,projectToken,projectSections,sceneDocumentToken,stageSize,type ProjectService } from '@rewrite/project';
import { assetsModule,assetToken,assetImporters,inspectAssetReferences,assetUsage,addToInbox,entryOf,LibrarySchema,emptyLibrary as emptyAssetLibrary,librarySection,type AssetPort,type AssetRecord,type AssetService } from '@rewrite/assets';
import { createAssetView } from '@rewrite/assets/views';
import { assetPackModule } from '@rewrite/assetpack';
import { pixiModule,SceneViewport,makeSpriteEntity,SpriteSchema,TextureMetadataSchema,createFlipbookAdapter,createObjectAdapters,createTilemapAdapter,TilemapSchema,cellsAlong,cameraView,idleCamera,snapCamera,sceneCamera,cameraOutlines,cameraType,type CameraView,type RuntimeCameraState,FontMetadataSchema,fontFile,type TransformTool } from '@rewrite/render-pixi';
import { RuntimeSession,type RuntimeEntity } from '@rewrite/runtime';
import {createSoundLab} from '@rewrite/audio/sfx-views';
import {audioModule,audioSourceDefinition,audioProviders,audioRanges,AudioSourceSchema,AudioMetadataSchema,AudioPreview,AudioSession,voiceSpec,MixerSchema,defaultMixer,mixerSection,type AudioSource,type Mixer} from '@rewrite/audio';
import {AudioControls,createMixerPanel} from '@rewrite/audio/views';
import {howlerModule} from '@rewrite/audio-howler';
import {tweenModule,tweenChannels,tweenProviders,TweenSession} from '@rewrite/tween';
import {createTweenInspector} from '@rewrite/tween/views';
import {gsapModule} from '@rewrite/tween-gsap';
import {tweenPixiModule} from '@rewrite/tween-pixi';
import {animationModule,AnimationSession,validateMotion,type AnimationEvent} from '@rewrite/animation';
import {createAnimationViews} from '@rewrite/animation/views';
import {physicsModule,physicsToken,physicsProviders,PhysicsSession,compilePhysics,colliderOutlines,type PhysicsService,type PhysicsEvent,type PhysicsControls} from '@rewrite/physics';
import {createPhysicsViews} from '@rewrite/physics/views';
import {spineAudioModule,validateSpineAudio,dispatchSpineAudio} from '@rewrite/spine-audio';
import {createBindingInspector} from '@rewrite/spine-audio/views';
import {spineModule,spineToken,SpineMetadataSchema,type SpineService,type SpineEvent} from '@rewrite/spine';
import {createSpineViews} from '@rewrite/spine/views';
import {visualAdapters,sceneDecorators} from '@rewrite/render-pixi/visuals';
import {layoutModule} from '@rewrite/layout';
import {comfyModule,GenerationsSchema,generationsSection,JobSchema as ComfyJobSchema,WorkflowSchema as ComfyWorkflowSchema,type WorkflowChoice} from '@rewrite/ai-comfy';
import {createGeneratePanel} from '@rewrite/ai-comfy/views';
import {quickGenerate} from '@rewrite/ai-comfy/quick';
import {lmModule,projectDiff,type ProjectShape} from '@rewrite/ai-lm';
import {scriptsModule,ScriptLibrarySchema,scriptsSection,emptyLibrary,behaviourType,BehaviourSchema} from '@rewrite/scripts';
import {scriptDebugger} from '@rewrite/scripts/debug';
import {instrumentScript} from '@rewrite/scripts/compile';
import {ScriptSession,loadScriptEngine,scriptEngineReady} from '@rewrite/scripts/session';
import {createScriptViews,flushScriptEdits,scriptConsole} from '@rewrite/scripts/views';
import {createAssistantPanel,writePrompt} from '@rewrite/ai-lm/views';
import {promptWriterMessages} from '@rewrite/ai-lm/agent';
import {translateStrings} from '@rewrite/ai-lm/translate';
import {SkillsSchema,skillsSection,emptySkills,listSkills,skillWriterMessages,parseSkillReply,assistantGuidance,writerGuidance,expandSkillMention,findSkill,skillDetails,toChoice,type Skills} from '@rewrite/ai-skills';
import {createSkillsPanel} from '@rewrite/ai-skills/views';
import {hubModule,lmStatusOf,useHubFor,decodeProblem,explainProblem,type Connection} from '@rewrite/ai-hub';
import {createHubViews} from '@rewrite/ai-hub/views';
import type {LmPort} from '@rewrite/ai-lm/contracts';
import {createAiPanel} from './AiPanel';
import {createEditorTools} from './assistant-tools';
import {matterModule} from '@rewrite/physics-matter';
import { Shell } from './Shell';
import { createTilemapInspector,type TileBrush } from './TilemapInspector';
import { createDebugOverlay,type DebugStats } from '@rewrite/render-pixi/overlay';
import { createMobileSettings } from './MobileSettings';
import { createWebAppSettings } from './WebAppSettings';
import { createCameraInspector } from './CameraInspector';
import { createShaderViews } from './ShaderPanel';
import { createNavAgentInspector } from './NavAgentInspector';
import { createCueEditor } from './CueEditor';
import { createVersionControl } from './VersionControl';
import { loadPlugins,PluginSettings } from './plugins';
import { NavigationSession,navGridDefinition,navAgentDefinition,navGridType,navAgentType,navigationTriggers,navigationActions } from '@rewrite/navigation';
import { createNavGridDecorator } from '@rewrite/navigation/overlay';
import { lightDefinition,lightingDefinition,lightType,lightingType } from '@rewrite/lighting';
import { createLightingDecorator } from '@rewrite/lighting/decorator';
import { DialogueSession,DialogueLibrarySchema,dialogueSection,dialogueTriggers,dialogueActions,readLibrary } from '@rewrite/dialogue';
import { createDialogueBox } from '@rewrite/dialogue/box';
import { createDialoguePanel } from '@rewrite/dialogue/views';
import { AchievementSession,AchievementsSchema,achievementsSection,achievementTriggers,achievementActions,readAchievements,memoryStore } from '@rewrite/achievements';
import { createAchievementToasts } from '@rewrite/achievements/toast';
import { createAchievementsPanel } from '@rewrite/achievements/views';
import { ShaderLibrarySchema,shadersSection } from '@rewrite/render-pixi/shaders';
import { createHub } from './Hub';
import { useUi,select,selectMany,pruneSelection,toggleFlag,notify } from './state';
const editableFocus=()=>{const active=globalThis.document.activeElement;return active instanceof HTMLElement&&Boolean(active.closest('input,textarea,select,[contenteditable=true]'));};
/** Object keys act only from the canvas, Layers or no focus, so Backspace in a panel never deletes objects. */
const objectFocus=()=>{const active=globalThis.document.activeElement;return !active||active===globalThis.document.body||active instanceof HTMLElement&&Boolean(active.closest('.viewport-wrap,[data-testid="layers-panel"]'))&&!active.closest('input,textarea,select,[contenteditable=true],.transform-handle');};
import { resolveTheme } from './themes';
import { ContextStyle } from './ContextTools';
import { createMcpSettings } from './McpSettings';
import { t } from './strings';
import { ProfileRecorder,countDrawCalls } from '@rewrite/profiler';
import { createProfilerPanel } from '@rewrite/profiler/views';
function mutate(work:()=>void){try{work();}catch(error){notify(error);}}
function useEditable(){return useUi(s=>s.mode==='edit'&&!s.busy);}
/** Properties and Layers stay editable during Preview when live edit is on (changes reach the running game). */
let liveEditSetting=()=>true;
/** Set where the file actions live (version control saves before committing and opens restored versions). */
let saveProjectRef:()=>Promise<void>=async()=>{},openStagedRef:(result:{text:string;path:string;warnings:string[]}|null)=>Promise<void>=async()=>{};
function useLiveEditable(){return useUi(s=>!s.busy&&(s.mode==='edit'||liveEditSetting()));}
function sample():Scene{
 const ground=makeEntity('Platform',480,420),square=makeEntity('Player',420,260),label=makeEntity('Title',480,140);
 ground.components.push({id:crypto.randomUUID(),type:'pixi.shape',version:1,data:{width:680,height:44,color:'#4c776b',rounded:16}});
 square.components.push({id:crypto.randomUUID(),type:'pixi.shape',version:1,data:{width:86,height:86,color:'#d9976e',rounded:22}});
 label.components.push({id:crypto.randomUUID(),type:'pixi.text',version:1,data:{text:'A little room to create.',fontSize:34,color:'#dee5e5'}});
 return{formatVersion:1,id:crypto.randomUUID(),name:'First scene',entities:[ground,square,label]};
}
function createStudio(host:ModuleHost,port:AssetPort,startup:RecoveryListing,hubAtStartup=false){
 let scene:SceneService,project:ProjectService,assets:AssetService;
 /** Machine-local editor settings contributed by modules (Settings dialog); legacy keys are imported once. */
 const preferences=new SettingsStore(()=>new Map(host.entries(settings).map(e=>[e.id,e.value])),{read:()=>{try{return localStorage.getItem('rewrite:settings');}catch{return null;}},write:value=>{try{localStorage.setItem('rewrite:settings',value);}catch(error){notify(error);}}});
 liveEditSetting=()=>{try{return preferences.get('studio.liveEdit')!==false;}catch{return true;}};
 try{
  const legacyGrid=localStorage.getItem('rewrite:viewport-grid');if(legacyGrid){const grid=readGridSettings(JSON.parse(legacyGrid));preferences.seed('pixi.gridVisible',grid.visible);preferences.seed('pixi.gridSnap',grid.snap);preferences.seed('pixi.gridStep',String(grid.step));}
  const legacyDebug=localStorage.getItem('rewrite:physics-debug');if(legacyDebug!==null)preferences.seed('physics.debugOutlines',legacyDebug==='true');
  const legacyRecovery=localStorage.getItem('rewrite:recovery-enabled');if(legacyRecovery!==null)preferences.seed('recovery.enabled',legacyRecovery!=='false');
 }catch{/* Unreadable legacy preferences are ignored. */}
 const settingsModule:EditorModule={manifest:{id:'settings',version:'1.0.0',apiVersion:1},activate(c){c.provide(settingsToken,preferences);}};
 let gridCache:GridSettings|undefined;
 const readGrid=():GridSettings=>{const next=readGridSettings({visible:preferences.get('pixi.gridVisible'),snap:preferences.get('pixi.gridSnap'),step:Number(preferences.get('pixi.gridStep'))});if(!gridCache||gridCache.visible!==next.visible||gridCache.snap!==next.snap||gridCache.step!==next.step)gridCache=next;return gridCache;};
 const draftScope=()=>`${project.generation}:${project.activeSceneId}`;
 const drafts=new DraftController({scope:draftScope,batch:work=>project.document.batch('Apply pending edits',work),history:{length:()=>project.document.historyLength,squash:from=>project.document.squash(undefined,from),rollback:from=>project.document.rollback(from)}});
 function EditRoot({children}:{children:ReactNode}){useSyncExternalStore(project.sceneDocument.subscribe,()=>project.sceneDocument.version);return <DraftProvider controller={drafts} scope={draftScope()}>{children}</DraftProvider>;}
 /** Canvas drags before they are committed: Properties shows them as they happen. */
 const canvasDrag$=new BehaviorSubject<ReadonlyMap<string,Readonly<Record<string,number>>>>(new Map()),subscribeDrag=(fn:()=>void)=>{const sub=canvasDrag$.subscribe(()=>fn());return()=>sub.unsubscribe();};
 /** Timeline Record keys (set once the animation views exist): canvas transform commits become keys while it is on. */
 /** Whether Record keys is on: the canvas stays editable over the animation preview pose. */
 let recordingKeys:(()=>boolean)|null=null;
 /** Prefab edit mode bar over the canvas (set once the prefab views exist). */
 let PrefabEditBar:(()=>React.ReactNode)|null=null;
 let recordKeys:((changes:readonly {id:string;value:Readonly<Partial<Record<'x'|'y'|'rotation'|'scaleX'|'scaleY'|'skewX'|'skewY',number>>>;expected?:Readonly<Partial<Record<'x'|'y'|'rotation'|'scaleX'|'scaleY'|'skewX'|'skewY',number>>>}[])=>boolean)|null=null;
 let viewport:SceneViewport|null=null,session:RuntimeSession|null=null,camera:ReturnType<SceneViewport['captureCamera']>|null=null;
 let previewLeases:ReturnType<SpineService['resources']['acquire']>[]=[];let builder:BuildService;let spine:SpineService;const spineEvents:SpineEvent[]=[];
 /** Play-session globals: created when Preview starts, kept across Preview scene transitions. */
let runtimeGlobals:GlobalStore|null=null;
/** Globals panel live column: bumps when a running global changes or Preview starts/stops. */
let liveGlobalsVersion=0;const liveGlobalsListeners=new Set<()=>void>();const publishLiveGlobals=()=>{liveGlobalsVersion++;for(const l of liveGlobalsListeners)l();};
/** Preview input: attached when Preview starts, kept across scene transitions, detached on Stop. */
let runtimeInput:{session:InputSession;detach():void}|null=null,inputDisposePending=false;
/** Preview behaviour scripts (QuickJS sandbox), one session per Preview scene. */
let runtimeScripts:ScriptSession|null=null;
let runtimeInteractions:InteractionSession|null=null,runtimeScene:Scene|null=null,pendingScene:string|null=null,transitionWindow=0,transitionCount=0;
 const triggers=()=>host.entries(interactionTriggers).map(e=>e.value),actions=()=>host.entries(interactionActions).map(e=>e.value);
 const projectGlobals=()=>GlobalsSchema.parse(project.document.current.extensions[globalsSection]??defaultGlobals);
 /** Game rendering (PixiJS) of the project; Preview and the viewport mirror background, pixel art and frame rate. */
 const projectRender=()=>RenderSettingsSchema.parse(project.document.current.extensions[renderSettingsSection]??{version:1});
 const applyGameLook=()=>{const r=projectRender();viewport?.setGameLook({background:r.background,pixelArt:r.pixelArt});};
 const projectScripts=()=>ScriptLibrarySchema.parse(project.document.current.extensions[scriptsSection]??emptyLibrary());
 let scriptStartError:string|null=null;
 /** Attached scripts must exist and compile before Preview starts. */
 const validateScripts=(source:Scene)=>{const library=projectScripts(),scene=library.scenes?.[source.id],sceneScript=scene?.scriptId?library.items.find(x=>x.id===scene.scriptId):undefined;return [...(scene?.scriptId&&!sceneScript?[`${source.name}: its scene script was deleted`]:sceneScript?.error?[sceneScript.error]:[]),...source.entities.flatMap(e=>e.components.filter(c=>c.type===behaviourType&&c.version===1).flatMap(c=>{const id=BehaviourSchema.parse(c.data).scriptId,script=library.items.find(x=>x.id===id);return !id?[`${e.name}: choose a script for its Script component`]:!script?[`${e.name}: its script was deleted`]:script.error?[script.error]:[];}))];};
 /** The script engine (~1 MB WebAssembly) loads only for projects that have scripts, off the startup path. */
 const warmScripts=()=>{if(!scriptEngineReady()&&projectScripts().items.length)void loadScriptEngine().catch(notify);};
 /** Live state-machine states for the inspector (Preview only). */
 let machineStates:Record<string,string>={},machineVersion=0;const machineListeners=new Set<()=>void>();
 /** Logic graph activity for the editor's highlight: node → game time it last ran, and the current game time. */
 let graphActivity:Record<string,Record<string,number>>={},graphNow=0,graphVersion=0;const graphListeners=new Set<()=>void>();
 const publishGraphs=()=>{const next=runtimeInteractions?.graphActivity()??{},now=session?.time??0;if(JSON.stringify(next)!==JSON.stringify(graphActivity)||Math.abs(now-graphNow)>.2){graphActivity=next;graphNow=now;graphVersion++;for(const fn of graphListeners)fn();}};
 const useGraphActivity=(id:string)=>{useSyncExternalStore(fn=>{graphListeners.add(fn);return()=>{graphListeners.delete(fn);};},()=>graphVersion);return graphActivity[id]?{nodes:graphActivity[id],now:graphNow}:undefined;};
 const publishStates=()=>{const next=runtimeInteractions?.states()??{};if(JSON.stringify(next)!==JSON.stringify(machineStates)){machineStates=next;machineVersion++;for(const fn of machineListeners)fn();}return machineStates;};
 const useMachineState=(id:string)=>{useSyncExternalStore(fn=>{machineListeners.add(fn);return()=>{machineListeners.delete(fn);};},()=>machineVersion);return machineStates[id];};
 const projectStrings=()=>LocalizationSchema.parse(project.document.current.extensions[localizationSection]??defaultLocalization);
 /** Preview language (editor-only, per session) and the play session's language store. */
 let previewLanguage='',runtimeLanguage:LanguageStore|null=null;
 /** The Library panel's drop target handler (assets dragged onto its folders). */
 let libraryDrop:((assetId:string,target:string)=>void)|null=null;
 /** Game camera and save slot during Preview (the slot lives in memory for this editor session, per project name). */
 let runtimeCamera:RuntimeCameraState=idleCamera();let runtimeTimers:TimerSession|null=null;let runtimeNavigation:NavigationSession|null=null;let runtimeAchievements:AchievementSession|null=null,runtimeToasts:ReturnType<typeof createAchievementToasts>|null=null;const previewAchievements=memoryStore();let runtimeDialogue:DialogueSession|null=null,runtimeDialogueBox:ReturnType<typeof createDialogueBox>|null=null;
 /** Preview physics for rules and scripts: delegates to the running session (errors when the scene has no bodies). */
 const physicsControls:PhysicsControls={setVelocity:(id,x,y)=>livePhysics().setVelocity(id,x,y),setAngularVelocity:(id,d)=>livePhysics().setAngularVelocity(id,d),applyForce:(id,x,y)=>livePhysics().applyForce(id,x,y),applyImpulse:(id,x,y)=>livePhysics().applyImpulse(id,x,y),teleport:(id,x,y)=>livePhysics().teleport(id,x,y),body:id=>livePhysics().body(id),gravity:()=>livePhysics().gravity(),setGravity:(x,y)=>livePhysics().setGravity(x,y),raycast:(...a)=>livePhysics().raycast(...a),objectsAt:(x,y)=>livePhysics().objectsAt(x,y),objectsIn:(...a)=>livePhysics().objectsIn(...a)};
 const livePhysics=()=>{if(!runtimePhysics)throw Error('Physics is not running in this scene');return runtimePhysics.controls;};
 /** The game camera's offset in Preview (spatial audio hears from the stage centre it shows). */
 let runtimeView:CameraView={x:480,y:270,zoom:1,rotation:0};const previewSaves=new Map<string,Record<string,GlobalValue>>();const saveKey=()=>project.document.current.name;
 const projectInput=()=>InputMapSchema.parse(project.document.current.extensions[inputSection]??defaultInputMap);
 const catalog=(entities=scene.document.current.entities):InteractionCatalog=>({entities,scenes:project.document.current.scenes,prefabs:(()=>{const r=PrefabRegistrySchema.safeParse(project.document.current.extensions[prefabSection]??{version:1,items:[]});return r.success?r.data.items.map(p=>({id:p.id,name:p.name})):[];})(),globals:projectGlobals().items,inputActions:projectInput().actions.map(a=>({id:a.id,name:a.name})),languages:projectStrings().languages,spineEvents:id=>{const meta=SpineMetadataSchema.safeParse(assets.get(id)?.metadata);return meta.success?meta.data.events:[];}});
 const applyTransition=()=>{if(!pendingScene||!session)return;const id=pendingScene;pendingScene=null;const now=performance.now();if(now-transitionWindow>1000){transitionWindow=now;transitionCount=0;}if(++transitionCount>8){notify('Scene transition cycle limit reached');return;}const source=project.document.current.scenes.find(s=>s.id===id);if(!source){notify('Scene target is missing');return;}const paused=session.paused,savedCamera=camera,leases=previewLeases;previewLeases=[];stop();previewLeases=leases;try{startRuntime(source,true,paused);}catch(e){stop();notify(e);return;}camera=savedCamera;if(paused){session?.pause();useUi.getState().set({mode:'paused'});}};
 let physics:PhysicsService,runtimePhysics:PhysicsSession|null=null;
 const physicsEvents:PhysicsEvent[]=[];
 const physicsProvider=()=>{const id=project?.document.current.providers.physics??'matter',value=host.entries(physicsProviders).find(e=>e.value.id===id)?.value;if(!value)throw Error(`Physics provider unavailable: ${id}`);return value;};
 const publishPhysics=(renderNow=true)=>{if(!viewport?.app.renderer)return;const target=viewport.app.canvas.parentElement;if(!target)return;target.dataset.physics=JSON.stringify({provider:project.document.current.providers.physics??'matter',runtime:runtimePhysics?.diagnostics??null,events:physicsEvents});const source=session?session.world.entities as unknown as Entity[]:scene.document.current.entities;viewport.setDecorations([...(physics.debug?colliderOutlines(source).map(s=>({entityId:s.entityId,points:s.points,color:s.sensor?'#d9ae69':undefined})):[]),...(session?[]:audioRanges(source,useUi.getState().selection)),...(()=>{const rig=session?undefined:sceneCamera(source);return rig?cameraOutlines(rig,stageSize(project.document.current),useUi.getState().selection.includes(rig.entityId)):[];})()],renderNow);};
 let runtimeAnimation:AnimationSession|null=null,animationPreview:{id:string;clipId:string;runtime:AnimationSession;scene:Scene;version:number;time:number}|null=null;
 /** Timeline onion skin (editor only): ghosts of the scrubbed clip's moving objects, before (red) and after (green) the playhead. */
 let onionSettings:{before:number;after:number;step:number}|null=null;
 const drawOnion=()=>{
  if(!viewport)return;const target=viewport.app.renderer?viewport.app.canvas.parentElement:null;
  if(!onionSettings||!animationPreview){viewport.setOnion(null);if(target)delete target.dataset.onionFrames;return;}
  const {runtime,scene:copy,id,time}=animationPreview,total=runtime.state(id)?.total??0,pose=()=>new Map(copy.entities.map(e=>[e.id,{...transform(e),active:e.active}])),now=pose(),moved=new Set<string>(),taken:{time:number;side:number;k:number;count:number;poses:ReturnType<typeof pose>}[]=[];
  for(const side of [-1,1]){const count=side<0?onionSettings.before:onionSettings.after;for(let k=count;k>=1;k--){const at=time+side*k*onionSettings.step/60;if(at<-1e-9||at>total+1e-9)continue;runtime.seek(Math.max(0,Math.min(total,at)));const poses=pose();for(const [entityId,p] of poses)if(JSON.stringify(p)!==JSON.stringify(now.get(entityId)))moved.add(entityId);taken.push({time:at,side,k,count,poses});}}
  runtime.seek(time);
  const byParent=new Map<string,string[]>();for(const e of copy.entities)if(e.parentId)byParent.set(e.parentId,[...(byParent.get(e.parentId)??[]),e.id]);
  const shown=new Set<string>(),visit=(entityId:string)=>{if(shown.has(entityId))return;shown.add(entityId);for(const c of byParent.get(entityId)??[])visit(c);};for(const m of moved)visit(m);
  const frames=taken.map(f=>({poses:new Map([...f.poses].filter(([entityId])=>moved.has(entityId))),tint:f.side<0?'#ff6b6b':'#4cd6a0',alpha:Math.max(.12,.45*(1-(f.k-1)/Math.max(1,f.count)))}));
  viewport.setOnion(moved.size?frames:null,shown);
  if(target)target.dataset.onionFrames=JSON.stringify(moved.size?taken.map(f=>({time:Math.round(f.time*1000)/1000,poses:Object.fromEntries([...f.poses].filter(([entityId])=>moved.has(entityId)).map(([entityId,p])=>[entityId,{x:p.x,y:p.y}]))})):[]);
 };
 const setOnionSettings=(settings:{before:number;after:number;step:number}|null)=>{onionSettings=settings;drawOnion();};
 const animationEvents:AnimationEvent[]=[];
 const publishAnimation=()=>{const target=viewport?.app.renderer?viewport.app.canvas.parentElement:null;if(target)target.dataset.animation=JSON.stringify({runtime:runtimeAnimation?.diagnostics??{},preview:animationPreview?{id:animationPreview.id,clipId:animationPreview.clipId,...animationPreview.runtime.diagnostics}:null,events:animationEvents});};
 const clearAnimationPreview=(id?:string)=>{if(!animationPreview||id&&animationPreview.id!==id)return;animationPreview.runtime.dispose();animationPreview=null;drawOnion();viewport?.setEditing(useUi.getState().mode==='edit'&&!useUi.getState().busy);if(!session)viewport?.sync(scene.document.current,useUi.getState().selected);publishAnimation();};
 const previewAnimation=(id:string,clipId:string,time:number)=>{if(session||useUi.getState().busy)throw Error('Stop runtime before scrubbing');spine.clearPreview();clearTweenPreview();if(!animationPreview||animationPreview.id!==id||animationPreview.clipId!==clipId||animationPreview.version!==scene.document.version){clearAnimationPreview();const copy=structuredClone(scene.document.current),runtime=new AnimationSession(()=>copy.entities,channels(),tweenProvider(),{only:{playerId:id,clipId}});runtime.start();if(runtime.errors.length){runtime.dispose();throw Error(runtime.errors.join('\n'));}animationPreview={id,clipId,runtime,scene:copy,version:scene.document.version,time};}animationPreview.time=time;animationPreview.runtime.seek(time);viewport?.sync(animationPreview.scene,useUi.getState().selected);drawOnion();viewport?.setEditing(Boolean(recordingKeys?.())&&useUi.getState().mode==='edit'&&!useUi.getState().busy);publishAnimation();};
 let runtimeTween:TweenSession|null=null,tweenPreview:{id:string;runtime:TweenSession;scene:Scene;version:number}|null=null;
 const channels=()=>host.entries(tweenChannels).map(e=>e.value);
 const tweenProvider=()=>{const id=project?.document.current.providers.tween??'gsap',p=host.entries(tweenProviders).find(e=>e.value.id===id)?.value;if(!p)throw Error(`Tween provider unavailable: ${id}`);return p;};
 const publishTween=()=>{const target=viewport?.app.renderer?viewport.app.canvas.parentElement:null;if(target)target.dataset.tweens=JSON.stringify({runtime:runtimeTween?.diagnostics??{},preview:tweenPreview?{id:tweenPreview.id,...tweenPreview.runtime.diagnostics}:null});};
 const clearTweenPreview=(id?:string)=>{if(!tweenPreview||id&&tweenPreview.id!==id)return;tweenPreview.runtime.dispose();tweenPreview=null;viewport?.setEditing(useUi.getState().mode==='edit'&&!useUi.getState().busy);if(!session)viewport?.sync(scene.document.current,useUi.getState().selected);publishTween();};
 const tweenBridge={scene:null as unknown as SceneService,channels,useEditable,report:notify,text:t,clear:clearTweenPreview,preview(id:string,time:number){if(session||useUi.getState().busy)throw Error('Stop runtime before scrubbing');spine.clearPreview();clearAnimationPreview();if(!tweenPreview||tweenPreview.id!==id||tweenPreview.version!==scene.document.version){clearTweenPreview();const copy=structuredClone(scene.document.current),runtime=new TweenSession(()=>copy.entities,channels(),tweenProvider(),id);runtime.start();if(runtime.errors.length){runtime.dispose();throw Error(runtime.errors.join('\n'));}tweenPreview={id,runtime,scene:copy,version:scene.document.version};}tweenPreview.runtime.seek(time);viewport?.sync(tweenPreview.scene,useUi.getState().selected);viewport?.setEditing(false);publishTween();}};
 let runtimeAudio:AudioSession|null=null,runtimeAudioCleanup:(()=>void)|undefined;
 const provider=()=>{const id=project?.document.current.providers.audio??'howler',result=host.entries(audioProviders).find(e=>e.value.id===id)?.value;if(!result)throw Error(`Audio provider is unavailable: ${id}`);return result;};
 const previews=new AudioPreview(provider);
 const specFor=(source:Pick<AudioSource,'assetId'|'volume'|'loop'|'rate'|'bus'>&{autoplay?:boolean},mixer?:Mixer)=>voiceSpec(source,assets.get(source.assetId),(a,file)=>assets.url(a,file),provider(),mixer);
 const projectMixer=()=>MixerSchema.parse(project.document.current.extensions[mixerSection]??defaultMixer);
 const publishAudio=()=>{const target=viewport?.app.renderer?viewport.app.canvas.parentElement:null;if(target)target.dataset.audio=JSON.stringify({sessionId:port.sessionId,preview:previews.diagnostics,sources:runtimeAudio?.diagnostics??{},effects:runtimeAudio?.effects??{}});};
 function SourceControls({component}:{component:Entity['components'][number]}){
  const ui=useUi(),source=AudioSourceSchema.parse(component.data);let spec,error;
  try{spec=specFor(source);}catch(e){error=String(e);}
  return <div>{error&&<p className="component-warning">{error}</p>}<AudioControls controller={runtimeAudio??previews} sourceKey={runtimeAudio?component.id:`component:${component.id}`} spec={spec} enabled={!ui.busy&&Boolean(spec)} text={t} stopOnUnmount={!runtimeAudio}/></div>;
 }
 function ClipControls({asset}:{asset:AssetRecord}){
  const ui=useUi(),meta=AudioMetadataSchema.safeParse(asset.metadata);let spec;
  try{spec=specFor({assetId:asset.id,volume:Number(preferences.get('audio.previewVolume'))/100,loop:false,rate:1,autoplay:false,bus:'ui'});}catch{/* A missing provider disables playback without changing the asset. */}
  return <div className="audio-clip">{meta.success&&<small>{meta.data.duration.toFixed(2)} s · {meta.data.sampleRate} Hz · {meta.data.channels} ch</small>}<AudioControls controller={previews} sourceKey={`asset:${asset.id}`} spec={spec} enabled={ui.mode==='edit'&&!ui.busy&&Boolean(spec)} text={t}/></div>;
 }
 let suppressClickUntil=0;
 const definitions=()=>new Map(host.entries(components).map(e=>[e.value.type,e.value]));
 const serialize=(snapshot=project.document.current)=>JSON.stringify({...snapshot,providers:{audio:'howler',tween:'gsap',physics:'matter',...snapshot.providers},modules:{...Object.fromEntries(host.versions),...snapshot.modules}},null,2)+'\n';
 const stop=()=>{viewport?.setRuntimeView(null);if(viewport?.app.ticker){viewport.app.ticker.maxFPS=0;viewport.app.ticker.minFPS=10;viewport.app.canvas.parentElement!.dataset.ticker=JSON.stringify({maxFPS:0,minFPS:10});}runtimeCamera=idleCamera();if(runtimeInput){inputDisposePending=true;queueMicrotask(()=>{if(inputDisposePending&&runtimeInput){runtimeInput.detach();runtimeInput=null;inputDisposePending=false;}});}for(const lease of previewLeases)lease.release();previewLeases=[];runtimeInteractions?.dispose();runtimeInteractions=null;runtimeTimers=null;runtimeNavigation=null;runtimeDialogueBox?.dispose();runtimeDialogueBox=null;runtimeToasts?.dispose();runtimeToasts=null;runtimeAchievements=null;runtimeDialogue?.dispose();runtimeDialogue=null;debugUnsubscribe?.();debugUnsubscribe=null;debugBreak=false;scriptDebugger.attach(null);runtimeScripts=null;runtimeScene=null;pendingScene=null;addedScenes.clear();spine?.reset();clearAnimationPreview();clearTweenPreview();previews.stopAll();session?.dispose();session=null;runtimePhysics=null;publishPhysics();runtimeAnimation=null;publishAnimation();runtimeTween=null;publishTween();runtimeAudioCleanup?.();runtimeAudioCleanup=undefined;runtimeAudio=null;publishAudio();useUi.getState().set({mode:'edit'});if(camera)viewport?.restoreCamera(camera);camera=null;viewport?.setTextDirection('ltr');viewport?.sync(scene.document.current,useUi.getState().selected);};
 /** A Sprite sheet animation object for an image at the view centre (Library slicer, generated animations); one undo step. */
 const placeSheet=(asset:AssetRecord,sheet:{columns:number;rows:number;frames:number;fps:number;loop:boolean;width:number;height:number})=>{if(session||useUi.getState().busy)throw Error('Stop Preview first');drafts.flush();let point:{x:number;y:number}|undefined;if(viewport){const b=viewport.app.canvas.getBoundingClientRect();point=viewport.screenToScene(b.x+b.width/2,b.y+b.height/2);}const scale=Math.min(1,256/Math.max(sheet.width,sheet.height)),entity=makeEntity(asset.name,point?.x,point?.y);entity.components.push({id:crypto.randomUUID(),type:'pixi.flipbook',version:1,data:{assetId:asset.id,columns:sheet.columns,rows:sheet.rows,frames:sheet.frames,fps:sheet.fps,loop:sheet.loop,autoplay:true,width:Math.round(sheet.width*scale),height:Math.round(sheet.height*scale),anchorX:.5,anchorY:.5,alpha:1}});scene.document.transact('Place animation',d=>{d.entities.push(entity);});select(entity.id);};
 /** Scenes panel previews: the edited scene is captured a moment after it changes (session only, cleared with the project). */
 const sceneThumbs=new Map<string,string>(),thumbListeners=new Set<()=>void>();let thumbTimer:ReturnType<typeof setTimeout>|undefined,thumbGeneration=-1;
 const captureThumb=()=>{clearTimeout(thumbTimer);thumbTimer=setTimeout(()=>{if(!viewport||session||useUi.getState().busy)return;if(thumbGeneration!==project.generation){sceneThumbs.clear();thumbGeneration=project.generation;}const id=project.activeSceneId;void viewport.thumbnail(240).then(url=>{if(url&&project.activeSceneId===id){sceneThumbs.set(id,url);for(const l of thumbListeners)l();}}).catch(()=>{});},700);};
 /** The object's own visual size and centre offset (shape, sprite, sheet, tiling, nine-slice, mesh…), for Fit collider. */
 const visualSize=(entity:Entity)=>{for(const c of entity.components){const d=c.data as {width?:unknown;height?:unknown;anchorX?:unknown;anchorY?:unknown};if(c.type==='scene.transform2d'||typeof d?.width!=='number'||typeof d.height!=='number'||!c.type.startsWith('pixi.'))continue;const ax=typeof d.anchorX==='number'?d.anchorX:.5,ay=typeof d.anchorY==='number'?d.anchorY:.5;return{width:d.width,height:d.height,offsetX:(.5-ax)*d.width,offsetY:(.5-ay)*d.height};}return null;};
 /** Pivot presets on the object's own visual (3 × 3 points); the object stays where it is on screen. */
 function PivotPicker({entity}:{entity:Entity}){
  const editable=useEditable(),t0=transform(entity),bounds=viewport?.ownBounds(entity.id)??null;
  if(!bounds)return null;
  const round=(v:number)=>Math.round(v*100)/100,points=[0,.5,1].flatMap(fy=>[0,.5,1].map(fx=>({fx,fy,x:round(bounds.x+bounds.width*fx),y:round(bounds.y+bounds.height*fy)})));
  const names=['topLeft','top','topRight','left','centre','right','bottomLeft','bottom','bottomRight'];
  return <div className="pivot-picker" role="group" aria-label={t('pivot.title')}><span>{t('pivot.title')}</span><div className="pivot-grid">{points.map((p,i)=>{const on=Math.abs((t0.pivotX??0)-p.x)<.01&&Math.abs((t0.pivotY??0)-p.y)<.01;return <button key={i} aria-label={`${t('pivot.title')} ${t('pivot.'+names[i])}`} aria-current={on?'true':undefined} disabled={!editable} onClick={()=>{try{drafts.flush();scene.setTransform(entity.id,pivotKeepingPlace(t0,p.x,p.y),t0);}catch(error){notify(error);}}}/>;})}</div><button className="pivot-reset" disabled={!editable||(!t0.pivotX&&!t0.pivotY)} onClick={()=>{try{drafts.flush();scene.setTransform(entity.id,pivotKeepingPlace(t0,0,0),t0);}catch(error){notify(error);}}}>{t('pivot.origin')}</button></div>;
 }
 /** Library: remove a plain background locally (new PNG "<name> cutout"); optionally swap the scene's sprites to it, one undo step. */
 function Cutout({asset}:{asset:AssetRecord}){
  const editable=useEditable(),[tolerance,setTolerance]=useState(32),[swap,setSwap]=useState(true),[busy,setBusy]=useState(false);
  const run=async()=>{if(session||useUi.getState().busy)throw Error('Stop Preview first');setBusy(true);try{
   const bitmap=await createImageBitmap(await (await fetch(assets.url(asset,'image.webp'))).blob()),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();
   const data=ctx.getImageData(0,0,canvas.width,canvas.height),result=cutoutBackground(data.data,canvas.width,canvas.height,tolerance);if(!result.removed)throw Error(t('cutout.nothing'));
   data.data.set(result.pixels);ctx.putImageData(data,0,0);const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,'image/png'));if(!blob)throw Error('PNG encoding failed');
   const name=`${asset.name} cutout`.replace(/[^\w .()#-]/g,'').slice(0,80),records=await window.platform.assets.importBytes(new Uint8Array(await blob.arrayBuffer()),name,'png'),next=(records[0] as {id:string}).id;
   drafts.flush();let swapped=0;assets.adopt(records,t('cutout.undo'),swap?draft=>{for(const sc of draft.scenes)for(const e of sc.entities)for(const c of e.components)if(c.type==='pixi.sprite'&&(c.data as {assetId?:string}).assetId===asset.id){(c.data as {assetId:string}).assetId=next;swapped++;}}:undefined);
   notify(t('cutout.done').replace('{name}',name).replace('{n}',String(swapped)));
  }finally{setBusy(false);}};
  return <div className="asset-cutout" data-testid="asset-cutout"><strong>{t('cutout.title')}</strong>
   <label className="field"><span>{t('cutout.tolerance')}</span><input type="range" aria-label={t('cutout.tolerance')} min={4} max={120} step={1} value={tolerance} disabled={!editable||busy} onChange={e=>setTolerance(Number(e.target.value))}/><output>{tolerance}</output></label>
   <label className="checkbox"><input type="checkbox" aria-label={t('cutout.swap')} checked={swap} disabled={!editable||busy} onChange={e=>setSwap(e.target.checked)}/>{t('cutout.swap')}</label>
   <button disabled={!editable||busy} onClick={()=>{void run().catch(notify);}}>{busy?t('cutout.working'):t('cutout.run')}</button></div>;
 }
 function TextureSheet({asset}:{asset:AssetRecord}){const editable=useEditable(),meta=asset.metadata as {width?:number;height?:number};if(!meta?.width||!meta.height)return null;return <SheetSlicer key={asset.id} name={asset.name} image={assets.url(asset,'image.webp')} width={meta.width} height={meta.height} editable={editable} text={t} create={grid=>{try{placeSheet(asset,grid);}catch(error){notify(error);}}}/>;}
 const place=(asset:AssetRecord,point?:{x:number;y:number})=>{
  if(session||useUi.getState().busy)return;
  if(!point&&viewport){const bounds=viewport.app.canvas.getBoundingClientRect();point=viewport.screenToScene(bounds.x+bounds.width/2,bounds.y+bounds.height/2);}
  const entity=['audio.clip','spine.skeleton'].includes(asset.type)?makeEntity(asset.name,point?.x,point?.y):makeSpriteEntity(asset,point?.x,point?.y);if(asset.type==='audio.clip')entity.components.push({id:crypto.randomUUID(),type:'audio.source',version:1,data:{assetId:asset.id,volume:1,loop:false,rate:1,autoplay:false}});if(asset.type==='spine.skeleton'){const meta=SpineMetadataSchema.parse(asset.metadata);entity.components.push({id:crypto.randomUUID(),type:'spine.renderer',version:1,data:{assetId:asset.id,skin:meta.skins[0]??'',animation:meta.animations[0]?.name??'',loop:true,timeScale:1,alpha:1}});}scene.document.transact('Place '+asset.type,d=>{d.entities.push(entity);});select(entity.id);
 };
 const publishSpine=()=>{const target=viewport?.app.renderer?viewport.app.canvas.parentElement:null;if(target)target.dataset.interactions=JSON.stringify({sceneId:runtimeScene?.id??null,errors:runtimeInteractions?.diagnostics??[],states:publishStates(),globals:runtimeGlobals?.snapshot()??{}});if(target)target.dataset.spine=JSON.stringify({resources:spine.resources.stats,preview:spine.previewState,events:spineEvents});};
 /** `{name}` text templates show live global values in Preview only; the document keeps the template. */
 const isText=(type:string)=>type==='pixi.text'||type==='pixi.bitmapText';
 const templated=(components:Entity['components'])=>{const values=runtimeGlobals;if(!values||!components.some(c=>isText(c.type)&&hasTemplate(String((c.data as {text?:unknown}).text??''))))return components;return components.map(c=>isText(c.type)&&hasTemplate(String((c.data as {text?:unknown}).text??''))?{...c,data:{...(c.data as Record<string,Json>),text:formatTemplate(String((c.data as {text?:unknown}).text),values.byName,(key,count)=>runtimeLanguage?.text(key,{...values.snapshot(),...(count===undefined?{}:{count})}))}}:c);};
 const renderRuntime=()=>{if(!session||!viewport)return;viewport.setTextDirection(runtimeLanguage?.direction??'ltr');runtimeInteractions?.flush();const source=runtimeScene??scene.document.current,byId=new Map(session.world.entities.map(e=>[e.id,e]));
  // Per-frame projection: a shallow snapshot (viewport.sync only reads it) instead of cloning the whole scene, and a second sync only when the interaction flush changed visibility.
  const authored=new Set(source.entities.map(e=>e.id)),snapshot={...source,entities:[...source.entities.flatMap(e=>{const runtime=byId.get(e.id);return runtime?[{...e,active:runtime.active,components:templated(Array.isArray(runtime.components)?runtime.components as typeof e.components:e.components)}]:[];}),...(session.world.entities as unknown as Entity[]).filter(e=>!authored.has(e.id)).map(e=>({...e,components:templated(e.components)}))]};publishPhysics(false);viewport.sync(snapshot,null);runtimeInteractions?.flush();let visibility=false;for(const e of snapshot.entities){const runtime=byId.get(e.id);if(runtime&&e.active!==runtime.active){e.active=runtime.active;visibility=true;}}if(visibility)viewport.sync(snapshot,null);{const rig=sceneCamera(snapshot.entities),follow=runtimeCamera.followId===undefined?rig?.camera.target||null:runtimeCamera.followId;runtimeView=cameraView(runtimeCamera,session.time,stageSize(project.document.current),rig,follow?viewport.contentPosition(follow):undefined);viewport.setRuntimeView(runtimeView);}viewport.app.canvas.parentElement!.dataset.runtimeTime=String(session.time);viewport.app.canvas.parentElement!.dataset.addedScenes=JSON.stringify([...addedScenes.keys()]);viewport.app.canvas.parentElement!.dataset.timers=JSON.stringify(runtimeTimers?.diagnostics??{});publishGraphs();publishTween();publishAnimation();publishSpine();publishAudio();};
 function Viewport(){
  const debug=useSyncExternalStore(physics.subscribe,()=>physics.debug);
  const ref=useRef<HTMLDivElement|null>(null),selected=useUi(s=>s.selected),selection=useUi(s=>s.selection),hidden=useUi(s=>s.hidden),locked=useUi(s=>s.locked),ui=useUi(),document=useScene(scene),{setNodeRef}=useDroppable({id:'studio.canvas'});
  const [tool,setTool]=useState<TransformTool>('move'),grid=useSyncExternalStore(preferences.subscribe.bind(preferences),readGrid);
  const gridRef=useRef(grid);gridRef.current=grid;
  const rulers=useSyncExternalStore(preferences.subscribe.bind(preferences),()=>preferences.get('pixi.rulers')!==false),[sceneView,setSceneView]=useState(false),[device,setDevice]=useState('');
  const projectVersion=useSyncExternalStore(project.document.subscribe,()=>project.document.version);
  useEffect(()=>{const preset=devicePreviews.find(d=>d.id===device);if(!viewport)return;if(!preset||ui.mode!=='edit'){viewport.setDeviceFrame(null);return;}try{const f=deviceFrame(projectRender(),stageSize(project.document.current),preset);viewport.setDeviceFrame({...f,label:`${preset.label} · ${f.scaleMode}${f.profile?` · ${f.profile.width}×${f.profile.height}`:''}`});}catch(error){notify(error);}},[device,ui.mode,projectVersion]);
  useEffect(()=>{if(ui.mode==='edit'&&sceneView)setSceneView(false);},[ui.mode,sceneView]);
  useEffect(()=>{viewport?.setSceneView(sceneView);},[sceneView]);
  const assetVersion=useSyncExternalStore(project.document.subscribe,()=>project.document.version);
  useEffect(()=>{
   let dead=false;
   const view=new SceneViewport(ref.current!,{
    select,selectMany,flags:id=>{const ui=useUi.getState();return{hidden:ui.hidden.has(id),locked:ui.locked.has(id)};},playing:()=>Boolean(session),runtimePointer:(phase,x,y)=>{const held=runtimePhysics?.pointer(phase,x,y)??false;runtimeScripts?.pointer(phase,x,y);if(held||runtimeScripts)renderRuntime();return held;},clickable:id=>runtimeInteractions?.listens('pointer.click',id)??false,interact:id=>{runtimeInteractions?.emit({type:'pointer.click',sourceId:id,silent:session?.paused??false});renderRuntime();applyTransition();},
    visuals:()=>host.entries(visualAdapters).map(e=>e.value),decorators:()=>host.entries(sceneDecorators).map(e=>e.value),visualEpoch:()=>String(spine.epoch),visualFrame:id=>spine.frame(id,session?{token:`runtime:${spine.epoch}`,time:session.time,silent:session.paused}:undefined),visualEvent:value=>{const event=value as SpineEvent;if(event.kind==='event')runtimeInteractions?.emit({type:'spine.event',sourceId:event.componentId,event:event.name,silent:event.silent});if(session&&runtimeAudio)dispatchSpineAudio(event,session.world.entities as unknown as Entity[],runtimeAudio);spineEvents.push(event);if(spineEvents.length>100)spineEvents.shift();publishSpine();},
    resolveAsset(id){const asset=assets.get(id);return asset?.type==='pixi.texture'?{url:assets.url(asset)}:undefined;},
    resolveFont(id){const asset=assets.get(id),meta=FontMetadataSchema.safeParse(asset?.metadata);return asset?.type==='font.face'&&meta.success?{url:assets.url(asset,fontFile(meta.data.format))}:undefined;},
    commitTransform(id,value,original){if(session||useUi.getState().busy)return;if(recordKeys?.([{id,value,expected:original}]))return;scene.setTransform(id,value,original);},commitTransforms(changes){if(session||useUi.getState().busy)return;if(recordKeys?.(changes))return;scene.setTransforms(changes);},report:notify,text:t,
   });
   const drag=view.dragging$.subscribe(value=>canvasDrag$.next(new Map([...value].map(([id,t])=>[id,{...t}]))));
   viewport=view;void view.init().then(()=>{if(dead)return;overlay=createDebugOverlay(view.app.canvas.parentElement!,debugStats);{const renderer=view.app.renderer,draw=renderer.render.bind(renderer);drawCalls=countDrawCalls((renderer as {gl?:WebGL2RenderingContext}).gl);renderer.render=((...args:Parameters<typeof draw>)=>{const start=performance.now();try{return draw(...args);}finally{drawMs+=performance.now()-start;}}) as typeof renderer.render;}view.setStage(stageSize(project.document.current));view.setGridSettings(gridRef.current);view.setGuides(preferences.get('pixi.smartGuides')===true);view.setRulers(preferences.get('pixi.rulers')!==false);captureThumb();applyGameLook();view.sync(scene.document.current,useUi.getState().selected);publishAudio();publishTween();publishAnimation();publishPhysics();publishSpine();view.app.ticker.add(ticker=>{
    overlay?.frame();if(!session){publishSpine();if(spine.previewing){spine.advancePreview(ticker.deltaMS/1000);view.sync(scene.document.current,useUi.getState().selected);publishSpine();}return;}if(runtimeInput){runtimeInput.session.paused=session.paused;if(!session.paused)runtimeInput.session.update();}if(session.paused){drawMs=0;drawCalls?.take();return;}session.profile=true;session.advance(ticker.deltaMS/1000);
    const syncStart=performance.now();renderRuntime();drawMs+=performance.now()-syncStart;{const heap=(performance as {memory?:{usedJSHeapSize:number}}).memory;profiler.push({time:performance.now(),frameMs:ticker.deltaMS,renderMs:drawMs,systems:Object.fromEntries(session.timings),drawCalls:drawCalls?.take()??0,objects:session.world.entities.length,steps:session.steps,...(heap?{heapMb:heap.usedJSHeapSize/1048576}:{})});drawMs=0;}applyTransition();breakIfHit();
   });view.app.ticker.start();}).catch(notify);
   const f3=(e:KeyboardEvent)=>{if(e.key==='F3'&&!editableFocus()){e.preventDefault();overlay?.toggle();}};window.addEventListener('keydown',f3);
   return()=>{dead=true;window.removeEventListener('keydown',f3);overlay?.dispose();overlay=null;drawCalls?.dispose();drawCalls=null;drag.unsubscribe();canvasDrag$.next(new Map());stop();view.dispose();viewport=null;};
  },[]);
  useEffect(()=>{viewport?.setTool(tool);},[tool]);
  useEffect(()=>{viewport?.setGridSettings(grid);},[grid]);
  useEffect(()=>{viewport?.setEditing(ui.mode==='edit'&&!ui.busy);},[ui.mode,ui.busy]);
  const navigateView=(reset=false)=>{if(useUi.getState().mode!=='edit'||useUi.getState().busy)return;try{if(reset)viewport?.resetView();else viewport?.frameSelection(useUi.getState().selected);}catch(error){notify(error);}};
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||e.repeat||e.isComposing||globalThis.document.querySelector('[role="dialog"]:not([data-editor-panel]),[role="menu"]')||e.target instanceof HTMLElement&&e.target.closest('input,textarea,select,[contenteditable=true]')||useUi.getState().mode!=='edit'||useUi.getState().busy)return;if(e.key.toLowerCase()==='f'){e.preventDefault();navigateView(e.shiftKey);return;}const next=({w:'move',e:'rotate',r:'scale'}as const)[e.key.toLowerCase() as 'w'|'e'|'r'];if(next){e.preventDefault();setTool(next);return;}
   const ids=useUi.getState().selection;if(!ids.length||!objectFocus())return;
   if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();try{drafts.flush();scene.removeMany(ids);select(null);}catch(error){notify(error);}return;}
   const step=e.shiftKey?10:1,arrow=({ArrowLeft:{x:-step,y:0},ArrowRight:{x:step,y:0},ArrowUp:{x:0,y:-step},ArrowDown:{x:0,y:step}} as Record<string,{x:number;y:number}>)[e.key];
   if(arrow){e.preventDefault();const movable=subtreeRoots(scene.document.current,ids).filter(id=>!viewport?.positionLocked(id));if(!movable.length)return;try{drafts.flush();scene.translateWorld(new Map(movable.map(id=>[id,arrow])));}catch(error){notify(error);}}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useEffect(()=>{publishPhysics(false);viewport?.setSelection(selection,selected);if(!session)viewport?.sync(animationPreview?.scene??tweenPreview?.scene??document,selected);else viewport?.render();},[document,selected,selection,hidden,locked,assetVersion,debug]);
  useEffect(()=>{const resolved=resolveTheme(ui.resolvedTheme,matchMedia('(prefers-color-scheme:dark)').matches,ui.customThemes);viewport?.setTheme(resolved.colors.viewport,resolved.colors.accent);},[ui.resolvedTheme,ui.customThemes]);
  return <div className="viewport-wrap"><div ref={node=>{ref.current=node;setNodeRef(node);}} className="canvas" data-testid="pixi-canvas" tabIndex={-1} aria-label={t('viewport.canvas')} onPointerDown={e=>{if(e.target===e.currentTarget||e.target instanceof HTMLCanvasElement)e.currentTarget.focus({preventScroll:true});}}/><div className="viewport-navigation" role="group" aria-label={t('viewport.navigation')}><button aria-label={t('viewport.grid')} title={t('viewport.gridHint')} aria-pressed={grid.visible} disabled={ui.mode!=='edit'||ui.busy} onClick={()=>preferences.set('pixi.gridVisible',!grid.visible)}><Grid2X2 size={16}/></button><button aria-label={t('viewport.snap')} title={t('viewport.snapHint')} aria-pressed={grid.snap} disabled={ui.mode!=='edit'||ui.busy} onClick={()=>preferences.set('pixi.gridSnap',!grid.snap)}><Magnet size={16}/></button><select aria-label={t('viewport.gridStep')} title={t('viewport.gridHint')} value={grid.step} disabled={ui.mode!=='edit'||ui.busy} onChange={e=>preferences.set('pixi.gridStep',e.target.value)}>{gridSteps.map(step=><option key={step} value={step}>{step}</option>)}</select><select aria-label={t('viewport.device')} title={t('viewport.deviceHint')} value={device} disabled={ui.mode!=='edit'} onChange={e=>setDevice(e.target.value)}><option value="">{t('viewport.deviceNone')}</option>{devicePreviews.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select><button aria-label={t('viewport.rulers')} title={t('viewport.rulers')} aria-pressed={rulers} disabled={ui.busy} onClick={()=>preferences.set('pixi.rulers',!rulers)}><Ruler size={16}/></button><button aria-label={t('viewport.sceneView')} title={t('viewport.sceneView')} aria-pressed={sceneView} disabled={ui.mode==='edit'} onClick={()=>setSceneView(v=>!v)}><ScanEye size={16}/></button><button aria-label={t('viewport.frame')} title={t('viewport.frame')} disabled={!selected||ui.mode!=='edit'||ui.busy} onClick={()=>navigateView()}><Focus size={16}/></button><button aria-label={t('viewport.reset')} title={t('viewport.reset')} disabled={ui.mode!=='edit'||ui.busy} onClick={()=>navigateView(true)}><RotateCcw size={16}/></button></div>{PrefabEditBar&&<PrefabEditBar/>}<span className="canvas-hint">{runtimeScene?.name??document.name} · ⌘ / Ctrl + scroll to zoom{selected&&ui.mode==='edit'&&<> · {t(`transform.hint.${tool}`)}</>}</span>{selected&&ui.mode==='edit'&&!ui.busy&&<div className="context-tools"><div role="group" aria-label={t('transform.tools')} className="transform-tools">{(['move','rotate','scale']as const).map((mode)=>{const Icon=mode==='move'?Move:mode==='rotate'?RotateCw:Scaling;return <button key={mode} aria-label={t(`transform.tool.${mode}`)} data-tip={t(`transform.tool.${mode}`)} aria-pressed={tool===mode} onClick={()=>setTool(mode)}><Icon size={14}/></button>;})}</div>{(()=>{const entity=document.entities.find(e=>e.id===selected);return entity?<ContextStyle entity={entity} selection={document.entities.filter(e=>selection.includes(e.id))} t={t} editable={ui.mode==='edit'&&!ui.busy} fonts={assets.items.filter(a=>a.type==='font.face').map(a=>({id:a.id,name:a.name}))} parse={(type,data)=>scene.definitions().get(type)?.parse(data)??data} set={(type,key,value,ids,fromField)=>mutate(()=>{const write=()=>{for(const id of ids)scene.setField(id,type,key,value);};if(fromField){write();return;}drafts.flush();project.document.batch(`Change ${key}`,write);})}/>:null;})()}<div className="context-actions"><button aria-label="Duplicate selected" data-tip={t('context.duplicate')} onClick={()=>mutate(()=>select(scene.duplicate(selected)))}><Copy size={14}/></button><button aria-label="Delete selected" data-tip={t('context.delete')} onClick={()=>mutate(()=>{scene.remove(selected);select(null);})}><Trash2 size={14}/></button></div></div>}</div>;
 }
 async function fileAction(work:()=>Promise<void>){
  if(useUi.getState().busy||assets.busy)throw Error('Finish or cancel the current file operation first');
  drafts.flush();spine.reset();clearAnimationPreview();clearTweenPreview();previews.stopAll();useUi.getState().set({busy:true});try{await work();}finally{useUi.getState().set({busy:false});}
 }
 let recoveryController:Parameters<Parameters<typeof recoveryModule>[0]['views']>[0]|undefined;
 const recovery=recoveryModule({port:window.platform.recovery,listing:startup,serialize,sessionId:()=>port.sessionId,blocked:()=>useUi.getState().busy||assets.busy,enabled:preferences.stored('recovery.enabled')!==false,views:controller=>{recoveryController=controller;return createRecoveryViews(controller,{
  text:t,report:notify,enabled:value=>preferences.set('recovery.enabled',value),startupRecent:!hubAtStartup,
  restore:id=>fileAction(async()=>{const prepared=await window.platform.recovery.prepare(id);if(!prepared)return;let accepted=false;try{const next=project.prepare(JSON.parse(prepared.text));const result=await window.platform.recovery.accept(prepared.ticket);accepted=true;stop();port.sessionId=result.sessionId;select(null);project.replace(next,true);await controller.refresh();if(result.warnings.length)notify(result.warnings.join('; '));}finally{if(!accepted)await window.platform.recovery.reject(prepared.ticket);}}),
  remove:id=>window.platform.recovery.remove(id),
  reopen:()=>fileAction(async()=>{const result=await window.platform.recovery.reopenLast();if(!result)return;const next=project.prepare(JSON.parse(result.text));const accepted=await window.platform.acceptOpen(result.path);stop();port.sessionId=accepted.sessionId??port.sessionId;select(null);project.replace(next);if(accepted.warnings?.length)notify(accepted.warnings.join('; '));if(result.warnings.length)notify(result.warnings.join('; '));}),
 })}});
 /** Group the selection in a new plain object (⌘G) / release the children of plain groups (⌘⇧G); one undo step each. */
 const groupSelection=()=>{if(session||useUi.getState().busy)return;const ids=useUi.getState().selection;if(!ids.length)return;drafts.flush();try{select(scene.group(ids));}catch(error){notify(error);}};
 const ungroupSelection=()=>{if(session||useUi.getState().busy)return;const ids=useUi.getState().selection;if(!ids.length)return;drafts.flush();try{const released=scene.ungroup(ids);if(released.length)selectMany(released,false);}catch(error){notify(error);}};
 /** Mirror the selected subtree roots on screen around the centre of their rendered bounds; one undo step. */
 const flipSelection=(axis:'x'|'y')=>{
  if(session||useUi.getState().busy||!viewport)return;drafts.flush();
  const ids=subtreeRoots(scene.document.current,useUi.getState().selection).filter(id=>!viewport?.positionLocked(id)),bounds=[...viewport.sceneBounds(ids).values()];if(!bounds.length)return;
  const minX=Math.min(...bounds.map(b=>b.x)),maxX=Math.max(...bounds.map(b=>b.x+b.width)),minY=Math.min(...bounds.map(b=>b.y)),maxY=Math.max(...bounds.map(b=>b.y+b.height));
  try{scene.flip(ids,axis,{x:(minX+maxX)/2,y:(minY+maxY)/2});}catch(error){notify(error);}
 };
 const projectUi:EditorModule={manifest:{id:'project-ui',version:'1.0.0',apiVersion:1,requires:{project:'^1',scene:'^1',assets:'^1'}},activate(c){
  project=c.get(projectToken);scene=c.get(sceneToken);assets=c.get(assetToken);
  let editingScene=scene.document.current.id,editingGeneration=project.generation;const sceneCameras=new Map<string,ReturnType<SceneViewport['captureCamera']>>();
  const sync=()=>{const id=scene.document.current.id;if(id!==editingScene||editingGeneration!==project.generation){stop();if(editingGeneration!==project.generation){sceneCameras.clear();useUi.getState().set({hidden:new Set(),locked:new Set()});}else if(viewport)sceneCameras.set(editingScene,viewport.captureCamera());editingGeneration=project.generation;editingScene=id;select(null);viewport?.restoreCamera(sceneCameras.get(id)??{zoom:1,pan:{x:0,y:0}});}const ui=useUi.getState(),ids=new Set(scene.document.current.entities.map(e=>e.id));ui.set({title:scene.document.current.name,dirty:project.document.dirty||drafts.pending});pruneSelection(id=>ids.has(id));viewport?.setStage(stageSize(project.document.current));publishAudio();void window.platform.dirty(project.document.dirty||drafts.pending).catch(notify);};
  c.own(project.sceneDocument.subscribe(()=>{spine?.clearPreview();clearAnimationPreview();clearTweenPreview();previews.stopAll();sync();}));c.own(drafts.subscribe(sync));c.own(previews.subscribe(publishAudio));c.own(()=>{stop();});
  const save=(saveAs=false)=>fileAction(async()=>{const snapshot=project.document.current,result=await window.platform.save(serialize(snapshot),saveAs);if(result){project.document.markSaved(snapshot);if(result.warnings.length)notify('Saved with missing sources: '+result.warnings.join('; '));void viewport?.thumbnail().then(url=>url?window.platform.hub.thumbnail(url):undefined).catch(()=>{});}});saveProjectRef=()=>save();
  /** Replace the open project with one the main process staged (Open…, the Hub's recent list or a new copy of an example). */
  const openStaged=async(result:{text:string;path:string;warnings:string[]}|null)=>{if(!result)return false;const next=project.prepare(JSON.parse(result.text));stop();const accepted=await window.platform.acceptOpen(result.path);port.sessionId=accepted.sessionId??port.sessionId;select(null);project.replace(next);if(accepted.warnings?.length)notify(accepted.warnings.join('; '));if(result.warnings.length)notify('Some sources could not be loaded: '+result.warnings.join('; '));return true;};openStagedRef=async result=>{await openStaged(result);};
  const hubTask=(work:()=>Promise<boolean>)=>async()=>{let done=false;await fileAction(async()=>{done=await work();});return done;};
  const Hub=createHub({text:t,report:notify,open:path=>hubTask(async()=>openStaged(await window.platform.hub.open(path)))(),create:id=>hubTask(async()=>openStaged(await window.platform.hub.create(id)))(),openFile:hubTask(async()=>openStaged(await window.platform.open())),
   newProject:hubTask(async()=>{const result=await window.platform.discard();if(!result)return false;stop();port.sessionId=result.sessionId??port.sessionId;select(null);project.fresh(blankScene());if(result.warnings?.length)notify(result.warnings.join('; '));return true;})});
  c.contribute(overlays,'project-ui.hub',{view:Hub});
  const actions:Record<string,()=>unknown>={
   new:()=>fileAction(async()=>{const result=await window.platform.discard();if(!result)return;stop();port.sessionId=result.sessionId??port.sessionId;select(null);project.fresh(blankScene());if(result.warnings?.length)notify(result.warnings.join('; '));}),
   open:()=>fileAction(async()=>{await openStaged(await window.platform.open());}),
   hub:()=>{if(!session)useUi.getState().set({hub:true});},
   save:()=>save(),saveAs:()=>save(true),
   selectAll(){const active=globalThis.document.activeElement;if(active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement){active.select();return;}if(active instanceof HTMLElement&&active.isContentEditable){globalThis.document.execCommand('selectAll');return;}if(session||useUi.getState().busy)return;const ui=useUi.getState(),current=scene.document.current;selectMany(subtreeRoots(current,current.entities.filter(e=>!ui.locked.has(e.id)&&!ui.hidden.has(e.id)).map(e=>e.id)),false);},
   flipH:()=>flipSelection('x'),flipV:()=>flipSelection('y'),group:()=>groupSelection(),ungroup:()=>ungroupSelection(),
   duplicate(){if(editableFocus()||session||useUi.getState().busy)return;const ids=useUi.getState().selection;if(!ids.length)return;try{drafts.flush();selectMany(scene.duplicateMany(ids),false);}catch(error){notify(error);}},
   undo(){if(!session&&!useUi.getState().busy){if(drafts.pending)drafts.discard();else project.document.undo();}},redo(){if(!session&&!useUi.getState().busy){if(drafts.pending)drafts.discard();else project.document.redo();}},
  };
  for(const [id,execute]of Object.entries(actions)){c.contribute(commands,`project-ui.${id}`,{titleKey:`command.${id}`,execute});c.contribute(menus,`project-ui.${id}`,{titleKey:`command.${id}`,command:`project-ui.${id}`});}
 }};
 /**
  * The project as exported: when a script spawns objects, the game also gets each component's reference paths and the
  * prefabs the scripts name (exported games carry no component definitions).
  */
 function exportText(){
  const text=serialize(),p=JSON.parse(text) as {scenes:Scene[];extensions:Record<string,Json>},library=ScriptLibrarySchema.safeParse(p.extensions[scriptsSection]),sources=library.success?library.data.items.map(i=>i.source).join('\n'):'';
  const ruleTargets=new Set(p.scenes.flatMap(s=>s.entities.flatMap(e=>e.components.flatMap(c=>c.type==='interactions.bindings'&&c.version===1?BindingsSchema.parse(c.data).rules.flatMap(r=>r.actions.filter(a=>a.type==='entity.spawn').map(a=>a.targetId)):c.type==='interactions.stateMachine'&&c.version===1?StateMachineSchema.parse(c.data).states.flatMap(st=>st.actions.filter(a=>a.type==='entity.spawn').map(a=>a.targetId)):[]))));
  if(!/\bspawn\s*\(/.test(sources)&&!ruleTargets.size)return text;
  const defs=scene.definitions(),registry=PrefabRegistrySchema.safeParse(p.extensions[prefabSection]??{version:1,items:[]}),quoted=(name:string)=>['"',"'",'`'].some(q=>sources.includes(q+name+q));
  const prefabs=registry.success?registry.data.items.filter(i=>quoted(i.name)||ruleTargets.has(`prefab:${i.id}`)).map(i=>({id:i.id,name:i.name,rootId:i.rootId,entities:i.entities})):[],references:Record<string,(string|number)[][]>={};
  for(const e of [...p.scenes.flatMap(s=>s.entities),...prefabs.flatMap(x=>x.entities)])for(const c of e.components){const d=defs.get(c.type);if(d&&d.version===c.version){const paths=referencePaths(c.data,d);if(paths.length)references[c.id]=paths;}}
  p.extensions[spawnSection]={version:1,references,prefabs} as unknown as Json;return JSON.stringify(p);
 }
 /** Spawn in Preview: a prefab (by name, or `prefab:<id>`) or a copy of a running object (by name or ID), references remapped; `near` places it relative to that object. */
 function spawnObject(target:{name?:string;id?:string},x:number,y:number,near?:string){
  if(!session)throw Error('The game is not running');
  const defs=scene.definitions(),registry=PrefabRegistrySchema.safeParse(project.document.current.extensions[prefabSection]??{version:1,items:[]}),world=session.world.entities as unknown as Entity[];
  const prefabId=target.id?.startsWith('prefab:')?target.id.slice(7):undefined,prefab=registry.success?registry.data.items.find(p=>prefabId?p.id===prefabId:target.name!==undefined&&p.name===target.name):undefined;
  const source=prefab?prefab.entities:world,rootId=prefab?prefab.rootId:target.id&&!prefabId?world.find(e=>e.id===target.id)?.id:world.find(e=>e.name===target.name)?.id;
  if(!rootId)throw Error(`Nothing to spawn: ${target.name?`no prefab or object named "${target.name}"`:'the object or prefab is missing'}`);
  const origin=near?worldPosition(world,near)??{x:0,y:0}:{x:0,y:0};
  const copy=spawnCopy(source,rootId,c=>{const d=defs.get(c.type);return d&&d.version===c.version?referencePaths(c.data,d):[];},{x:origin.x+x,y:origin.y+y}).map(e=>({...e,components:e.components.filter(c=>!defs.get(c.type)?.editorOnly)}));
  if(world.length+copy.length>10000)throw Error('A scene can have at most 10,000 objects');
  session.spawn(copy as unknown as RuntimeEntity[]);return copy[0].id;
 }
 /** Additive scenes in Preview: another scene's objects join the running one with their own IDs, once per scene; removeScene takes them out. */
 const addedScenes=new Map<string,string[]>();
 function addSceneLive(id:string){
  if(!session)throw Error('The game is not running');if(id===runtimeScene?.id)throw Error('This scene is already running');if(addedScenes.has(id))return;
  const source=project.document.current.scenes.find(s=>s.id===id);if(!source)throw Error('Scene target is missing');
  const defs=scene.definitions();for(const e of source.entities)for(const c of e.components){const d=defs.get(c.type);if(!d||d.version!==c.version)throw Error(`unsupported component: ${c.type} v${c.version}`);}
  const errors=[...validateScripts(source),...validateInteractions(catalog(source.entities),triggers(),actions())];if(errors.length)throw Error(`${source.name}: ${errors.join('\n')}`);
  const world=session.world.entities,taken=new Set(world.map(e=>e.id)),clash=source.entities.find(e=>taken.has(e.id));if(clash)throw Error(`Cannot add scene ${source.name}: object ${clash.name} is already running`);
  if(world.length+source.entities.length>10000)throw Error('A scene can have at most 10,000 objects');
  const copy=parentsFirst(source.entities.map(e=>({...structuredClone(e),components:e.components.filter(c=>!defs.get(c.type)?.editorOnly).map(c=>structuredClone(c))}))),ids=new Set(copy.map(e=>e.id));
  addedScenes.set(id,copy.filter(e=>!e.parentId||!ids.has(e.parentId)).map(e=>e.id));
  session.spawn(copy as unknown as RuntimeEntity[]);runtimeInteractions?.emit({type:'scene.start',sourceId:id,silent:false});
 }
 function removeSceneLive(id:string){const roots=addedScenes.get(id);if(!roots)return;addedScenes.delete(id);session?.despawn(roots);}
 /** Script debugger (Preview): breakpoints and watches from the Scripts panel; a hit pauses the game at the end of that frame. */
 let debugBreak=false,debugUnsubscribe:(()=>void)|null=null;
 function attachDebugger(scripts:ScriptSession){
  const key=()=>JSON.stringify([[...scriptDebugger.breakpoints],scriptDebugger.watches]);let last=key();
  const apply=()=>scriptDebugger.setValid(scripts.debug({breakpoints:scriptDebugger.breakpoints,watches:scriptDebugger.watches,build:instrumentScript,hit:hit=>{if(!scriptDebugger.hit)scriptDebugger.setHit(hit);debugBreak=true;}}));
  apply();debugUnsubscribe?.();debugUnsubscribe=scriptDebugger.subscribe(()=>{const next=key();if(next!==last){last=next;apply();}});
  scriptDebugger.attach({paused:()=>Boolean(session?.paused),instances:()=>runtimeScripts?.instances()??[],watch:list=>runtimeScripts?.watch(list)??[],
   resume:()=>{debugBreak=false;scriptDebugger.setHit(null);if(session?.paused){session.resume();useUi.getState().set({mode:'playing'});}},
   step:()=>{scriptDebugger.setHit(null);if(!session?.paused)return;session.step();renderRuntime();applyTransition();debugBreak=false;scriptDebugger.refresh();}});
 }
 /** After a frame in which a breakpoint ran: pause like the Pause button. */
 /** Live edit: scene changes made while Preview runs reach the running world (hot reload). */
 let liveBase:Scene|null=null,liveEdits=0;
 const liveEditOn=()=>liveEditSetting();
 const statefulTypes=new Set(['animation.player','tween.player','audio.source','scripts.behaviour','interactions.timer','interactions.stateMachine','navigation.agent','spine.renderer']);
 function applyLiveEdit(){
  const next=scene.document.current,prev=liveBase;
  if(!session||!runtimeScene||!prev||next.id!==runtimeScene.id||next===prev)return;
  liveBase=next;if(!liveEditOn())return;
  const strip=(e:Entity):Entity=>({...structuredClone(e),components:e.components.filter(c=>!scene.definitions().get(c.type)?.editorOnly).map(c=>structuredClone(c))});
  const world=session.world.entities as unknown as Entity[],live=new Map(world.map(e=>[e.id,e])),before=new Map(prev.entities.map(e=>[e.id,e])),same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  const respawn:string[]=[],added:Entity[]=[];let patched=0;
  for(const e of next.entities){
   const old=before.get(e.id),now=live.get(e.id);
   if(!old){added.push(e);continue;}
   if(!now||same(old,e))continue;
   const changed=e.components.filter(c=>!same(old.components.find(x=>x.id===c.id),c)),removedComponents=old.components.filter(c=>!e.components.some(x=>x.id===c.id));
   const body=e.components.some(c=>c.type==='physics.rigidBody2d');
   if(old.parentId!==e.parentId||[...changed,...removedComponents].some(c=>c.type.startsWith('physics.')||c.type.startsWith('navigation.')||statefulTypes.has(c.type)||(body&&c.type==='scene.transform2d'))){respawn.push(e.id);continue;}
   now.name=e.name;now.active=e.active;
   now.components=strip(e).components.map(c=>changed.some(x=>x.id===c.id)?c:now.components.find(x=>x.id===c.id)??c);patched++;
  }
  const removed=prev.entities.filter(e=>!next.entities.some(x=>x.id===e.id)&&live.has(e.id)).map(e=>e.id);
  if(removed.length)session.despawn(removed);
  const roots=subtreeRoots(next,respawn.filter(id=>live.has(id)));
  if(roots.length){
   const ids=subtreeIds(next,roots),keep=new Map(roots.map(id=>{const was=live.get(id),old=before.get(id),doc=next.entities.find(e=>e.id===id);const moved=!same(old?.components.find(c=>c.type==='scene.transform2d'),doc?.components.find(c=>c.type==='scene.transform2d'));return[id,moved?undefined:was?.components.find(c=>c.type==='scene.transform2d')];}));
   session.despawn(roots);
   const copies=parentsFirst(next.entities.filter(e=>ids.has(e.id))).map(e=>{const copy=strip(e),t=keep.get(e.id);if(t){const i=copy.components.findIndex(c=>c.type==='scene.transform2d');if(i>=0)copy.components[i]=structuredClone(t);}return copy;});
   session.spawn(copies as unknown as RuntimeEntity[]);
  }
  if(added.length)session.spawn(parentsFirst(added.filter(e=>!e.parentId||live.has(e.parentId)||added.some(a=>a.id===e.parentId))).map(strip) as unknown as RuntimeEntity[]);
  liveEdits+=patched+roots.length+added.length+removed.length;
  if(viewport)viewport.app.canvas.parentElement!.dataset.liveEdits=String(liveEdits);
  renderRuntime();
 }
 const liveAchievements=()=>{if(!runtimeAchievements)throw Error('Achievements are not running');return runtimeAchievements;};
 const liveDialogue=()=>{if(!runtimeDialogue)throw Error('Dialogues are not running');return runtimeDialogue;};
 const liveNavigation=()=>{if(!runtimeNavigation)throw Error('Navigation is not running');return runtimeNavigation.controls;};
 function breakIfHit(){if(!debugBreak||!session||session.paused)return;debugBreak=false;session.pause();if(viewport)viewport.app.canvas.parentElement!.dataset.runtimeTime=String(session.time);useUi.getState().set({mode:'paused'});scriptDebugger.refresh();}
 /** Debug overlay (F3) in Preview: what the running game is doing right now. */
 let overlay:ReturnType<typeof createDebugOverlay>|null=null;
 /** Profiler: one sample per Preview frame (systems, drawing, draw calls). */
 const profiler=new ProfileRecorder();let drawMs=0,drawCalls:ReturnType<typeof countDrawCalls>|null=null;
 const debugStats=():DebugStats|null=>{if(!session)return null;const entities=session.world.entities as unknown as Entity[];const running=(d:Record<string,unknown>|undefined)=>Object.values(d??{}).filter(x=>(x as {running?:boolean}).running).length;
  return{scene:runtimeScene?.name??'',objects:{active:entities.filter(e=>isActive(e,entities)).length,total:entities.length},bodies:runtimePhysics?.diagnostics.bodies.length,tweens:running(runtimeTween?.diagnostics),animations:running(runtimeAnimation?.diagnostics),voices:Object.values(runtimeAudio?.diagnostics??{}).filter(v=>(v as {state?:string}).state==='playing').length,scripts:runtimeScripts?.instances().length,timers:running(runtimeTimers?.diagnostics),globals:runtimeGlobals?.snapshot()};};
 function startRuntime(source:Scene,transition=false,startPaused=false){liveBase=source;if(session||!viewport||useUi.getState().busy)return;if(assets.busy)throw Error('Finish or cancel asset processing before Preview');if(source.id===scene.document.current.id&&scene.diagnostics.length)throw Error(scene.diagnostics.join('\n'));for(const e of source.entities)for(const c of e.components){const def=scene.definitions().get(c.type);if(!def||def.version!==c.version)throw Error(`unsupported component: ${c.type} v${c.version}`);}const root=project.document.current;if(!transition)profiler.clear();if(root.providers.render!=='pixi'||Object.entries(root.modules).some(([id,v])=>host.versions.get(id)!==v))throw Error('Required project modules/providers are missing or incompatible');if(!transition&&viewport.visualDiagnostics.some(v=>!v.ready))throw Error('Spine assets are loading or invalid. Check skeleton, skin and animation.');if(!transition&&viewport.missingAssets.length)throw Error('Textures are loading or missing. Reimport or rebuild the affected assets.');provider();tweenProvider();physicsProvider();{const r=projectRender();viewport.app.ticker.maxFPS=r.maxFPS;viewport.app.ticker.minFPS=r.minFPS;viewport.app.canvas.parentElement!.dataset.ticker=JSON.stringify({maxFPS:Math.round(viewport.app.ticker.maxFPS),minFPS:Math.round(viewport.app.ticker.minFPS)});}flushScriptEdits();const sceneScript=projectScripts().scenes?.[source.id],scriptsUsed=Boolean(sceneScript?.scriptId)||source.entities.some(e=>e.components.some(c=>c.type===behaviourType)),scriptEngine=scriptEngineReady(),scriptsNeeded=scriptsUsed||projectScripts().items.length>0;if(scriptsNeeded&&!scriptEngine){void loadScriptEngine();throw Error('The script engine is still loading. Press Play again in a moment.');}
  const writers=new Map<string,string>(),physicsCheck=compilePhysics(source.entities,writers),errors=[...validateScripts(source),...validateInteractions(catalog(source.entities),triggers(),actions()),...validateSpineAudio(source.entities,assets),...physicsCheck.errors,...validateMotion(source.entities,channels(),writers)];if(errors.length)throw Error(errors.join('\n'));clearAnimationPreview();clearTweenPreview();spine.reset();spineEvents.splice(0);animationEvents.splice(0);physicsEvents.splice(0);previews.stopAll();camera=viewport.captureCamera();runtimeScene=source;session=new RuntimeSession(source.entities.map(e=>({...structuredClone(e),components:e.components.filter(c=>!scene.definitions().get(c.type)?.editorOnly).map(c=>structuredClone(c))}))as RuntimeEntity[],world=>{const mixer=projectMixer();if(!transition||!runtimeGlobals){runtimeGlobals?.dispose();const globals=runtimeGlobals=new GlobalStore(projectGlobals());globals.changes$.subscribe(c=>{runtimeInteractions?.emit({type:'global.change',sourceId:c.id,silent:c.silent});publishLiveGlobals();});}if(!transition)runtimeCamera=idleCamera();else snapCamera(runtimeCamera);if(!transition||!runtimeLanguage){const table=projectStrings();runtimeLanguage=createLanguageStore(table,table.languages.some(l=>l.id===previewLanguage)?previewLanguage:table.defaultLanguage);}const globals=runtimeGlobals;inputDisposePending=false;if(!transition||!runtimeInput){runtimeInput?.detach();const input=new InputSession(projectInput(),{emit:event=>runtimeInteractions?.emit(event),setGlobal:(id,value)=>{try{runtimeGlobals?.set(id,value);}catch(error){notify(error);}}}),target=viewport!.app.canvas.parentElement!;runtimeInput={session:input,detach:input.attach(target,()=>useUi.getState().mode!=='edit'&&(preferences.get('input.requireCanvasFocus')!==true||target.contains(globalThis.document.activeElement)))};}const interactionContext:Omit<ActionContext,'silent'>&{physics:PhysicsControls}={globals,physics:physicsControls,time:()=>session?.time??0,setLanguage(id){runtimeLanguage?.setLanguage(id);},fade:(id,to,seconds,stopAfter)=>runtimeAudio?.fade(id,to,seconds,stopAfter),spawn:(target,x,y,near)=>spawnObject({id:target},x,y,near),destroy:id=>{session?.despawn([id]);},camera:{follow(id){runtimeCamera.followId=id;runtimeCamera.lookAt=null;},shake(amplitude,duration){runtimeCamera.shake={startedAt:session?.time??0,duration,amplitude};},zoom(value){runtimeCamera.zoom=value;},lookAt(x,y){runtimeCamera.lookAt={x,y};},view:()=>({...runtimeView,zoom:runtimeCamera.zoom??runtimeView.zoom})},storage:{write:values=>{previewSaves.set(saveKey(),{...values});},read:()=>previewSaves.get(saveKey())??null,clear:()=>{previewSaves.delete(saveKey());}},setData(id,patch){for(const e of world.entities as unknown as Entity[])for(const c of e.components)if(c.id===id){Object.assign(c.data as object,patch);return;}},setActive(id,value){const e=world.entities.find(e=>e.id===id);if(e)e.active=value;},changeScene(id){pendingScene=id;},addScene:id=>addSceneLive(id),crossFade:(id,name,seconds)=>{if(!runtimeAnimation)throw Error('Animation is not running');runtimeAnimation.crossFade(id,name,seconds);},removeScene:id=>removeSceneLive(id),invoke(service,method,id){const controller=service==='audio'?runtimeAudio:service==='tween'?runtimeTween:service==='animation'?runtimeAnimation:service==='timer'?runtimeTimers:undefined;if(!controller)throw Error('Interaction service is unavailable: '+service);controller[method](id);}};runtimeInteractions=new InteractionSession(()=>world.entities as unknown as Entity[],actions(),interactionContext,notify);runtimeScripts=null;scriptStartError=null;if(scriptsNeeded&&scriptEngine){try{const scripts=new ScriptSession(scriptEngine,projectScripts(),{...interactionContext,language:{current:()=>runtimeLanguage?.language??'',set:id=>{if(!runtimeLanguage)throw Error('This project has no localization');runtimeLanguage.setLanguage(id);},t:(key,values)=>runtimeLanguage?.text(key,{...runtimeGlobals?.snapshot(),...values as Record<string,string|number>})},audio:{play:id=>runtimeAudio?.play(id),stop:id=>runtimeAudio?.stop(id),fade:(id,to,s,stop)=>runtimeAudio?.fade(id,to,s,stop),setBus:(bus,v)=>runtimeAudio?.setBus(bus,v),bus:bus=>runtimeAudio?.bus(bus)??1,state:id=>runtimeAudio?.state(id)},animation:{play:(id,clip,fade)=>runtimeAnimation?.play(id,clip,fade),pause:id=>runtimeAnimation?.pause(id),resume:id=>runtimeAnimation?.resume(id),seekPlayer:(id,t)=>runtimeAnimation?.seekPlayer(id,t),setSpeed:(id,v)=>runtimeAnimation?.setSpeed(id,v),reverse:id=>runtimeAnimation?.reverse(id),state:id=>runtimeAnimation?.state(id)},achievements:{unlock:k=>liveAchievements().unlock(k),unlocked:k=>liveAchievements().unlocked(k),submit:(b,s,n)=>liveAchievements().submit(b,s,n),top:b=>liveAchievements().top(b),list:()=>liveAchievements().list()},dialogue:{name:id=>readLibrary(project.document.current.extensions[dialogueSection]).items.find(d=>d.id===id)?.name,start:id=>liveDialogue().start(id),advance:()=>liveDialogue().advance(),choose:i=>liveDialogue().choose(i),stop:()=>liveDialogue().stop(),view:()=>runtimeDialogue?.view()??null},navigation:{findPath:(...a)=>liveNavigation().findPath(...a),moveTo:(id,x,y)=>liveNavigation().moveTo(id,x,y),follow:(id,target)=>liveNavigation().follow(id,target),stop:id=>liveNavigation().stop(id),walkable:(x,y)=>liveNavigation().walkable(x,y),rebuild:()=>liveNavigation().rebuild(),state:id=>liveNavigation().state(id)},entities:()=>world.entities as unknown as Entity[],spawn:(name,x,y)=>spawnObject({name},x,y),destroy:id=>{session?.despawn([id]);},time:()=>session?.time??0,stage:stageSize(project.document.current),scene:{name:source.name,behaviour:sceneScript},standby:true,names:{globals:projectGlobals().items,scenes:project.document.current.scenes.map(x=>({id:x.id,name:x.name})),actions:projectInput().actions.map(x=>({id:x.id,name:x.name}))},log:scriptConsole.log},message=>{scriptConsole.log('error',message);notify(message);});runtimeScripts=scripts;attachDebugger(scripts);runtimeInteractions.observe(event=>scripts.observe(event),(type,id)=>scripts.listens(type,id));}catch(error){scriptStartError=error instanceof Error?error.message:String(error);}}// The session applies the mix itself (live bus gains, ducking, fades), so specs carry the source volume only.
 {const stage=stageSize(project.document.current);runtimeView={x:stage.width/2,y:stage.height/2,zoom:1,rotation:0};}runtimeAudio=new AudioSession(()=>world.entities as unknown as Entity[],source=>specFor(source),provider(),{mixer,listener:()=>({x:runtimeView.x,y:runtimeView.y})});runtimeAudioCleanup=runtimeAudio.subscribe(publishAudio);runtimeAudio.events$.subscribe(e=>{const silent=session?.paused??startPaused;if(e.kind==='ended')runtimeInteractions?.emit({type:'audio.ended',sourceId:e.key,silent});else{runtimeInteractions?.emit({type:'audio.beat',sourceId:e.key,event:'beat',silent});if(e.bar)runtimeInteractions?.emit({type:'audio.beat',sourceId:e.key,event:'bar',silent});}});runtimeTween=new TweenSession(()=>world.entities as unknown as Entity[],channels(),tweenProvider());runtimeAnimation=new AnimationSession(()=>world.entities as unknown as Entity[],channels(),tweenProvider(),{silent:()=>session?.paused??startPaused,event:event=>{if(event.kind==='complete')runtimeInteractions?.emit({type:'animation.complete',sourceId:event.playerId,silent:event.silent});if(event.kind==='marker'){runtimeInteractions?.emit({type:'animation.marker',sourceId:event.playerId,event:event.name,silent:event.silent});if(event.action&&!(event.silent&&event.action.service==='audio'))try{interactionContext.invoke(event.action.service,event.action.method,event.action.targetId);}catch(error){notify(error);}if(event.cue)runtimeInteractions?.runAction(event.cue,event.silent,event.ownerId);if(event.message)runtimeScripts?.broadcast(event.message,{marker:event.name});}animationEvents.push(event);if(animationEvents.length>50)animationEvents.shift();}});runtimePhysics=new PhysicsSession(()=>world.entities as unknown as Entity[],physics.settings,physicsProvider(),{bounds:()=>stageSize(project.document.current),silent:()=>session?.paused??startPaused,event:event=>{for(const [id,other] of [[event.a,event.b],[event.b,event.a]])runtimeInteractions?.emit({type:`physics.${event.phase}`,sourceId:id,event:other,silent:event.silent,...(event.contact?{data:event.contact}:{})});physicsEvents.push(event);if(physicsEvents.length>100)physicsEvents.shift();}});runtimeTimers=new TimerSession(()=>world.entities as unknown as Entity[],(id,silent)=>runtimeInteractions?.emit({type:'timer.done',sourceId:id,silent}),()=>session?.paused??startPaused);if(viewport)runtimeToasts=createAchievementToasts(viewport.app.canvas.parentElement!);runtimeAchievements=new AchievementSession({library:()=>readAchievements(project.document.current.extensions[achievementsSection]),store:previewAchievements,globals:()=>runtimeGlobals??undefined,emit:e=>runtimeInteractions?.emit(e),silent:()=>session?.paused??startPaused,unlocked:a=>runtimeToasts?.show(t('achievements.unlockedToast'),a.name,a.description)});runtimeDialogue=new DialogueSession({library:()=>readLibrary(project.document.current.extensions[dialogueSection]),globals:()=>runtimeGlobals??undefined,emit:e=>runtimeInteractions?.emit(e),silent:()=>session?.paused??startPaused,localize:key=>runtimeLanguage?.text(key,{...runtimeGlobals?.snapshot()})});if(viewport)runtimeDialogueBox=createDialogueBox(viewport.app.canvas.parentElement!,runtimeDialogue);runtimeNavigation=new NavigationSession({entities:()=>world.entities as unknown as Entity[],emit:e=>runtimeInteractions?.emit(e),silent:()=>session?.paused??startPaused,physics:()=>runtimePhysics?.controls});return[runtimePhysics.system,runtimeTween.system,runtimeAnimation.system,runtimeAudio.system,runtimeTimers.system,runtimeNavigation.system,runtimeAchievements.system,...(runtimeScripts?[runtimeScripts.system]:[])];},{paused:startPaused});if(scriptStartError){const message=scriptStartError;stop();throw Error(message);}if(runtimeTween?.errors.length||runtimeAnimation?.errors.length||runtimePhysics?.errors.length){const message=[...(runtimePhysics?.errors??[]),...(runtimeTween?.errors??[]),...(runtimeAnimation?.errors??[])].join('\n');stop();throw Error(message);}runtimeInteractions?.emit({type:'scene.start',sourceId:source.id,silent:startPaused});renderRuntime();publishAudio();useUi.getState().set({mode:startPaused?'paused':'playing'});}
 const studioUi:EditorModule={manifest:{id:'studio',version:'1.0.0',apiVersion:1,requires:{scene:'^1',pixi:'^1','project-ui':'^1',assets:'^1',assetpack:'^1',audio:'^1',howler:'^1',tween:'^1',gsap:'^1','tween-pixi':'^1',animation:'^1',physics:'^1',matter:'^1',spine:'^1','spine-audio':'^1',interactions:'^1','interaction-media':'^1',build:'^1','html-export':'^1',prefabs:'^1'}},activate(c){
  scene=c.get(sceneToken);assets=c.get(assetToken);const textureUrl=(id:string)=>{const asset=assets.get(id);return asset?.type==='pixi.texture'?assets.url(asset):undefined;};c.contribute(visualAdapters,'studio.flipbook',createFlipbookAdapter(textureUrl));for(const adapter of [...createObjectAdapters(textureUrl),createTilemapAdapter(textureUrl)])c.contribute(visualAdapters,`studio.${adapter.type}`,adapter);builder=c.get(buildToken);const BuildPanel=createBuildPanel({service:builder,targets:()=>host.entries(buildTargets).map(e=>e.value),useEditable,text:t,report:notify,start:id=>fileAction(async()=>{project.prepare(JSON.parse(serialize()));await builder.start(exportText(),id);})});c.contribute(panels,'studio.build',{titleKey:'panel.build',icon:'export',shortcut:'Alt+E',view:BuildPanel});physics=c.get(physicsToken);spine=c.get(spineToken);const prefabViews=createPrefabViews({service:c.get(prefabToken),useEditable,useSelection:()=>useUi(s=>s.selected),select,selectMany:ids=>selectMany(ids,false),text:t,report:notify,open:()=>useUi.getState().set({panel:'studio.prefabs'}),assetOptions:type=>assets.items.filter(a=>a.type===type).map(a=>({id:a.id,name:a.name}))});PrefabEditBar=prefabViews.EditBar;c.contribute(panels,'studio.prefabs',{titleKey:'panel.prefabs',icon:'prefab',shortcut:'Alt+F',view:prefabViews.Library});/** Live tilemap brush stroke shown before it is committed. */
  const previewTiles=(entityId:string,tiles:readonly number[]|null)=>{if(!viewport||session)return;const doc=scene.document.current,shown=tiles?{...doc,entities:doc.entities.map(e=>e.id!==entityId?e:{...e,components:e.components.map(c=>c.type==='pixi.tilemap'?{...c,data:{...(c.data as Record<string,Json>),tiles:[...tiles]}}:c)})}:doc;viewport.sync(shown,useUi.getState().selected);};
  /** Tile brush owned by the studio: survives closing Properties; ends on another selection, Preview or toggle. */
  let tileBrush:TileBrush={entityId:null,tile:0},brushVersion=0;const brushListeners=new Set<()=>void>();
  const setTileBrush=(next:TileBrush)=>{const painterChanged=next.entityId!==tileBrush.entityId;tileBrush=next;brushVersion++;for(const fn of brushListeners)fn();if(!painterChanged)return;if(!next.entityId){viewport?.setPainter(null);return;}
   let work:number[]=[],last:{x:number;y:number}|null=null;const entityId=next.entityId;
   viewport?.setPainter({entityId,paint(local,phase){const comp=scene.document.current.entities.find(e=>e.id===entityId)?.components.find(c=>c.type==='pixi.tilemap'&&c.version===1);if(!comp)return;const map=TilemapSchema.parse(comp.data);
    if(phase==='cancel'){previewTiles(entityId,null);last=null;return;}if(phase==='start'){work=[...map.tiles];last=local;}
    for(const index of cellsAlong(map,last??local,local))work[index]=tileBrush.tile;last=local;
    if(phase!=='end'){previewTiles(entityId,work);return;}previewTiles(entityId,null);if(work.some((v,i)=>v!==map.tiles[i]))try{const tiles=[...work];scene.document.transact('Paint tiles',d=>{const target=d.entities.find(e=>e.id===entityId)?.components.find(c=>c.id===comp.id);if(!target)throw Error('Tilemap missing');target.data={...TilemapSchema.parse(target.data),tiles};});}catch(error){notify(error);}}});};
  c.own(useUi.subscribe(s=>{if(tileBrush.entityId&&(s.selected!==tileBrush.entityId||s.mode!=='edit'))setTileBrush({...tileBrush,entityId:null});}));
  const TilemapInspector=createTilemapInspector({scene,useEditable,text:t,report:notify,useBrush:()=>{useSyncExternalStore(fn=>{brushListeners.add(fn);return()=>{brushListeners.delete(fn);};},()=>brushVersion);return tileBrush;},setBrush:setTileBrush,texture:id=>{const asset=assets.get(id),meta=TextureMetadataSchema.safeParse(asset?.metadata);return asset?.type==='pixi.texture'&&meta.success?{url:assets.url(asset),width:meta.data.width,height:meta.data.height}:undefined;}});
  const InteractionInspector=createInteractionInspector({scene,catalog,triggers,actions,useEditable,text:t,report:notify}),StateMachineInspector=createStateMachineInspector({scene,catalog,triggers,actions,useEditable,text:t,report:notify,useCurrent:useMachineState});const GraphPanel=createGraphPanel({scene,catalog,triggers,actions,useEditable,text:t,report:notify,useSelection:()=>useUi(s=>s.selected),useActivity:useGraphActivity});const BindingInspector=createBindingInspector({scene,assets,useEditable,text:t,report:notify});const spineViews=createSpineViews({scene,assets,service:spine,useEditable,text:t,report:notify,refresh:()=>{clearAnimationPreview();clearTweenPreview();viewport?.sync(scene.document.current,useUi.getState().selected);publishSpine();}});const physicsViews=createPhysicsViews({service:physics,scene,useEditable,text:t,report:notify});tweenBridge.scene=scene;const TweenInspector=createTweenInspector(tweenBridge);const animationViews=createAnimationViews({CueEditor:createCueEditor({actions,catalog:()=>catalog(),text:t}),scene,channels,provider:tweenProvider,useSelection:()=>useUi(s=>s.selected),useEditable,text:t,report:notify,open:()=>useUi.getState().set({panel:'studio.timeline'}),preview:previewAnimation,clear:clearAnimationPreview,onion:setOnionSettings});recordKeys=animationViews.record;recordingKeys=animationViews.isRecording;
  c.own(project.sceneDocument.subscribe(captureThumb));
  // Live edit: a script changed while the game runs replaces the running hooks (state kept).
  c.own(project.document.subscribe(()=>{if(!session||!runtimeScripts)return;const names=runtimeScripts.reload(projectScripts());if(names.length)scriptConsole.log('info',t('scripts.reloaded').replace('{names}',names.join(', ')));}));
  const Scenes=createProjectViews(project,{text:t,useEditable,report:notify,thumbnail:id=>sceneThumbs.get(id),subscribeThumbnails:l=>{thumbListeners.add(l);return()=>{thumbListeners.delete(l);};},run:work=>{if(session||useUi.getState().busy||assets.busy)throw Error('Stop Preview and finish file operations before editing scenes');drafts.flush();work();}});c.contribute(panels,'studio.scenes',{titleKey:'panel.scenes',icon:'scenes',shortcut:'Alt+S',view:Scenes,preferredWidth:360});
  /** Object clipboard. Text fields keep the normal clipboard; the payload is JSON so another editor window can paste it. */
  const CLIPBOARD_TYPE='application/x-pixi-editor+json';
  const clipboardBlocked=()=>editableFocus()||Boolean(globalThis.document.querySelector('[role="dialog"]:not([data-editor-panel]),[role="menu"]'))||Boolean(session)||useUi.getState().busy;
  const onCopy=(event:ClipboardEvent,cut=false)=>{const ids=useUi.getState().selection;if(clipboardBlocked()||!ids.length||!event.clipboardData)return;event.preventDefault();try{drafts.flush();const text=JSON.stringify(scene.copy(ids));event.clipboardData.setData(CLIPBOARD_TYPE,text);event.clipboardData.setData('text/plain',text);if(cut){scene.removeMany(ids);select(null);}}catch(error){notify(error);}};
  const onPaste=(event:ClipboardEvent)=>{if(clipboardBlocked()||!event.clipboardData)return;const text=event.clipboardData.getData(CLIPBOARD_TYPE)||event.clipboardData.getData('text/plain');let payload:unknown;try{payload=JSON.parse(text);}catch{return;}if(!EntityClipboardSchema.safeParse(payload).success)return;event.preventDefault();try{drafts.flush();const result=scene.paste(payload);selectMany(result.ids,false);if(result.unresolved)notify(`${result.unresolved} pasted reference${result.unresolved===1?'':'s'} point to objects that are not in this scene.`);}catch(error){notify(error);}};
  const copyListener=(e:ClipboardEvent)=>onCopy(e),cutListener=(e:ClipboardEvent)=>onCopy(e,true);
  globalThis.document.addEventListener('copy',copyListener);globalThis.document.addEventListener('cut',cutListener);globalThis.document.addEventListener('paste',onPaste);
  c.own(()=>{globalThis.document.removeEventListener('copy',copyListener);globalThis.document.removeEventListener('cut',cutListener);globalThis.document.removeEventListener('paste',onPaste);});
  /** Align/distribute the selected subtree roots by their rendered scene bounds; one undo step. */
  const alignSelection=(kind:AlignKind)=>{
   if(session||useUi.getState().busy||!viewport)return;drafts.flush();
   const ids=subtreeRoots(scene.document.current,useUi.getState().selection).filter(id=>!viewport?.positionLocked(id)),bounds=viewport.sceneBounds(ids),items=ids.flatMap(id=>{const b=bounds.get(id);return b?[{id,...b}]:[];});
   if(items.length<2||(kind.startsWith('distribute')&&items.length<3))return;
   const minX=Math.min(...items.map(b=>b.x)),maxX=Math.max(...items.map(b=>b.x+b.width)),minY=Math.min(...items.map(b=>b.y)),maxY=Math.max(...items.map(b=>b.y+b.height)),deltas=new Map<string,{x:number;y:number}>();
   if(kind==='distribute-h'||kind==='distribute-v'){
    const horizontal=kind==='distribute-h',sorted=[...items].sort((a,b)=>horizontal?a.x-b.x:a.y-b.y),span=horizontal?maxX-minX:maxY-minY,size=sorted.reduce((n,b)=>n+(horizontal?b.width:b.height),0),gap=(span-size)/(sorted.length-1);let cursor=horizontal?minX:minY;
    for(const b of sorted){const at=horizontal?b.x:b.y;deltas.set(b.id,horizontal?{x:cursor-at,y:0}:{x:0,y:cursor-at});cursor+=(horizontal?b.width:b.height)+gap;}
   }else for(const b of items)deltas.set(b.id,{left:{x:minX-b.x,y:0},hcenter:{x:(minX+maxX)/2-(b.x+b.width/2),y:0},right:{x:maxX-(b.x+b.width),y:0},top:{x:0,y:minY-b.y},vmiddle:{x:0,y:(minY+maxY)/2-(b.y+b.height/2)},bottom:{x:0,y:maxY-(b.y+b.height)}}[kind]);
   for(const [id,d] of deltas)if(Math.abs(d.x)<1e-6&&Math.abs(d.y)<1e-6)deltas.delete(id);
   if(deltas.size)scene.translateWorld(deltas);
  };
  const shaderViews=createShaderViews({project,scene,text:t,report:notify,useEditable,selection:()=>useUi.getState().selection,useSelection:()=>useUi(s=>s.selection),openPanel:()=>useUi.getState().set({panel:'studio.shader'})});
  {let shaders=project.document.current.extensions[shadersSection];c.own(project.document.subscribe(()=>{const next=project.document.current.extensions[shadersSection];if(next===shaders)return;shaders=next;if(!session)viewport?.sync(scene.document.current,useUi.getState().selected);}));}
  c.contribute(settings,'studio.liveEdit',{titleKey:'setting.liveEdit',descriptionKey:'setting.liveEditHelp',section:'setting.section.viewport',order:8,kind:'boolean',default:true});c.own(scene.document.subscribe(()=>{try{applyLiveEdit();}catch(error){notify(error);}}));
  for(const d of [navGridDefinition,navAgentDefinition])c.contribute(components,`studio.${d.type}`,d);for(const d of navigationTriggers)c.contribute(interactionTriggers,`studio.${d.type}`,d);for(const d of navigationActions(()=>runtimeNavigation?.controls))c.contribute(interactionActions,`studio.${d.type}`,d);c.contribute(sceneDecorators,'studio.navgrid',createNavGridDecorator());{const dialogues=()=>readLibrary(project.document.current.extensions[dialogueSection]);c.contribute(projectSections,'studio.dialogues',{key:dialogueSection,parse:v=>DialogueLibrarySchema.parse(v) as unknown as Json});for(const d of dialogueTriggers(dialogues))c.contribute(interactionTriggers,`studio.${d.type}`,d);for(const d of dialogueActions(dialogues,()=>runtimeDialogue??undefined))c.contribute(interactionActions,`studio.${d.type}`,d);c.contribute(panels,'studio.dialogue',{titleKey:'panel.dialogue',icon:'dialogue',shortcut:'Alt+D',preferredWidth:820,preferredHeight:620,view:createDialoguePanel({text:t,report:notify,useEditable,useProject:()=>{useSyncExternalStore(project.document.subscribe,()=>project.document.current);const root=project.document.current;return{library:dialogues(),globals:GlobalsSchema.parse(root.extensions[globalsSection]??defaultGlobals).items};},edit:(label,change)=>{try{project.document.transact(label,d=>{const lib=readLibrary(d.extensions[dialogueSection]);change(lib);d.extensions[dialogueSection]=DialogueLibrarySchema.parse(lib) as unknown as Json;});}catch(error){notify(error);}},createGlobals:()=>{try{return new GlobalStore(projectGlobals());}catch{return undefined;}}})});}for(const d of [lightingDefinition,lightDefinition])c.contribute(components,`studio.${d.type}`,d);c.contribute(sceneDecorators,'studio.lighting',createLightingDecorator());c.contribute(createItems,'studio.lighting',{titleKey:'create.lighting',category:'effects',icon:'sparkles',name:'Lighting',components:[{type:lightingType}]});c.contribute(createItems,'studio.light',{titleKey:'create.light',category:'effects',icon:'sparkles',name:'Light',components:[{type:lightType}]});c.contribute(createItems,'studio.navGrid',{titleKey:'create.navGrid',category:'logic',icon:'grid',name:'Nav Grid',components:[{type:navGridType,data:{width:stageSize(project.document.current).width,height:stageSize(project.document.current).height}}]});c.contribute(createItems,'studio.navAgent',{titleKey:'create.navAgent',category:'logic',icon:'logic',name:'Nav Agent',components:[{type:'pixi.shape',data:{kind:'ellipse',width:32,height:32,color:'#7cf3ff'}},{type:navAgentType}]});
  const NavAgentInspector=createNavAgentInspector({scene,useEditable,text:t,report:notify});
  const CameraInspector=createCameraInspector({scene,useEditable,stage:()=>stageSize(project.document.current),text:t,report:notify});
  const views=createSceneViews(scene,{
   viewScope:draftScope,
   useSelection:()=>useUi(s=>s.selected),select,useEditable:useLiveEditable,useStructureEditable:useEditable,report:notify,text:t,
   useSelectionSet:()=>useUi(s=>s.selection),selectMany,useDragging:()=>useSyncExternalStore(subscribeDrag,()=>canvasDrag$.value),useFlags:()=>({hidden:useUi(s=>s.hidden),locked:useUi(s=>s.locked)}),toggleFlag,
   align:kind=>alignSelection(kind),
   assetOptions:type=>assets.items.filter(a=>a.type===type).map(a=>({id:a.id,name:a.name})),
   entityExtra:entity=><prefabViews.EntityExtra entity={entity}/>,
   componentExtra(entity,component){
    if(component.type==='scene.transform2d'&&component.version===1)return <PivotPicker entity={entity}/>;
    if(['physics.boxCollider2d','physics.circleCollider2d','physics.capsuleCollider2d'].includes(component.type)&&component.version===1){const size=visualSize(entity);return <button className="fit-collider" disabled={!size} title={size?t('physics.fitHint'):t('physics.fitNone')} onClick={()=>{if(!size)return;try{drafts.flush();scene.document.transact('Fit collider',d=>{const c=d.entities.find(e=>e.id===entity.id)?.components.find(x=>x.id===component.id);if(!c)return;const data=c.data as Record<string,unknown>,round=(v:number)=>Math.round(v*100)/100;if(component.type==='physics.circleCollider2d')data.radius=round(Math.max(size.width,size.height)/2);else{data.width=round(size.width);data.height=round(size.height);}data.offsetX=round(size.offsetX);data.offsetY=round(size.offsetY);});}catch(error){notify(error);}}}>{t('physics.fit')}</button>;}
    if(component.type==='interactions.bindings'&&component.version===1)return <InteractionInspector component={component}/>;
    if(component.type===behaviourType&&component.version===1)return <scriptViews.ScriptInspector entityId={entity.id} component={component}/>;
    if(component.type==='interactions.stateMachine'&&component.version===1)return <StateMachineInspector component={component}/>;
    if(component.type==='interactions.graph'&&component.version===1)return <GraphSummary entity={entity} component={component} text={t} open={()=>useUi.getState().set({panel:'studio.graph'})}/>;
    if(component.type==='pixi.tilemap'&&component.version===1)return <TilemapInspector entity={entity} component={component}/>;
    if(component.type===cameraType&&component.version===1)return <CameraInspector entity={entity} component={component}/>;
    if(component.type===lightType&&component.version===1)return scene.document.current.entities.some(e=>e.components.some(c=>c.type===lightingType))?null:<p className="component-warning">{t('light.noLighting')}</p>;
    if(component.type===navAgentType&&component.version===1)return <NavAgentInspector entity={entity} component={component}/>;
    if(component.type==='pixi.shader'&&component.version===1)return <shaderViews.ShaderInspector entity={entity} component={component}/>;
    if(component.type==='pixi.screenSpace'&&component.version===1)return <p className={entity.parentId?'component-warning':'panel-empty'}>{t(entity.parentId?'screen.nested':'screen.help')}</p>;
    if(component.type==='spine-audio.binding'&&component.version===1)return <BindingInspector entity={entity} component={component}/>;
    if(component.type==='spine.renderer'&&component.version===1)return <spineViews.Inspector entity={entity} component={component}/>;
    if(component.type.startsWith('physics.')&&component.version===1)return <physicsViews.Extra entity={entity} component={component}/>;
    if(component.type==='animation.player'&&component.version===1)return <animationViews.Inspector component={component}/>;
    if(component.type==='tween.player'&&component.version===1)return <TweenInspector entity={entity} component={component}/>;
    if(component.type==='audio.source'&&component.version===1)return <SourceControls component={component}/>;
    if(component.type!=='pixi.sprite'||component.version!==1)return null;const p=SpriteSchema.parse(component.data),asset=assets.get(p.assetId),metadata=asset?TextureMetadataSchema.safeParse(asset.metadata):null;
    return <div className="sprite-preview">{asset?<><img src={assets.url(asset,'thumb.webp')} alt={asset.name}/><span>{asset.name}</span><button disabled={useUi.getState().mode!=='edit'||useUi.getState().busy||!metadata?.success} onClick={()=>{try{if(!metadata?.success)return;scene.document.transact('Use native size',d=>{const sprite=d.entities.find(e=>e.id===entity.id)?.components.find(c=>c.id===component.id);if(sprite)sprite.data={...p,width:metadata.data.width,height:metadata.data.height};});}catch(error){notify(error);}}}>{t('asset.nativeSize')}</button></>:<p className="component-warning">{t('asset.missingTexture')}</p>}</div>;
   },
  });
  const usageScopes=()=>[...project.document.current.scenes,...c.get(prefabToken).items.map(p=>({id:'prefab:'+p.id,name:'Prefab · '+p.name,entities:p.entities}))];
  const generationOf=(id:string)=>{const raw=project.document.current.extensions[generationsSection];return raw?GenerationsSchema.parse(raw).items.find(g=>g.assetId===id):undefined;};
  const Library=createAssetView(assets,{
   image:(a,epoch)=>a.type==='pixi.texture'?assets.url(a,'image.webp')+'?cache='+epoch:undefined,
   useUsage:()=>{const v=useSyncExternalStore(project.document.subscribe,()=>project.document.version);return useMemo(()=>assetUsage(usageScopes(),new Set(assets.items.map(a=>a.id))),[v]);},
   details:a=>{const g=generationOf(a.id),sheet=a.type==='pixi.texture'?<><TextureSheet asset={a}/><Cutout asset={a}/></>:null;return g?<>{sheet}<div className="asset-generation" data-testid="asset-generation"><small>{t('library.generatedWith')}</small><p>{g.prompt}</p><small>{[g.workflow,g.model,`seed ${g.seed}`,g.skill,g.loras?.map(l=>l.name).join(', ')].filter(Boolean).join(' · ')}</small></div></>:sheet;},
   references:()=>inspectAssetReferences([...project.document.current.scenes,...c.get(prefabToken).items.map(p=>({id:'prefab:'+p.id,name:'Prefab · '+p.name,entities:p.entities}))],assets.items,definitions()),
   useEditable,report:notify,text:t,importers:()=>host.entries(assetImporters),canUse:a=>['pixi.texture','audio.clip','spine.skeleton'].includes(a.type),placeholder:a=>a.type==='audio.clip'?'♪':a.type==='spine.skeleton'?'♧':'◇',extra:a=>a.type==='audio.clip'?<ClipControls asset={a}/>:a.type==='spine.skeleton'?<spineViews.AssetInfo asset={a}/>:null,
   use(asset){if(Date.now()>=suppressClickUntil)place(asset);},thumbnail:(a,epoch)=>a.type==='pixi.texture'?assets.url(a,'thumb.webp')+'?cache='+epoch:undefined,
   async rebuild(){const warnings=await assets.rebuild();viewport?.refreshAssets();if(warnings.length)notify(warnings.join('; '));},
  });
  libraryDrop=Library.dropOnFolder;
  c.contribute(panels,'studio.properties',{titleKey:'panel.properties',icon:'properties',shortcut:'Alt+P',view:views.Properties});
  c.contribute(panels,'studio.layers',{titleKey:'panel.layers',icon:'layers',shortcut:'Alt+L',view:views.Layers});
  /** Generated assets and how they were made, in one undo step. */
  const adoptGenerated=(records:readonly unknown[],info:Omit<import('@rewrite/ai-comfy').Generation,'assetId'>)=>{drafts.flush();const added=assets.adopt(records,info.kind==='audio'?'Generate sound':'Generate image',draft=>{const history=GenerationsSchema.parse(draft.extensions[generationsSection]??{version:1,items:[]});for(const r of records)history.items.push({...info,assetId:String((r as {id:string}).id)});draft.extensions[generationsSection]=history as unknown as Json;const ids=records.map(r=>String((r as {id:string}).id)),lib=draft.extensions[librarySection]?LibrarySchema.parse(draft.extensions[librarySection]):emptyAssetLibrary();draft.extensions[librarySection]=addToInbox(lib,ids,['generated',info.kind,...(info.purpose?[info.purpose]:[]),...(info.skill?[info.skill]:[])]) as unknown as Json;});return added.map(a=>a.id);};
  /** Skills and instructions for the local AI: the project's (a project section, undoable) and this computer's. */
  const machineSkills=(()=>{let value:Skills=emptySkills();try{const raw=localStorage.getItem('rewrite:skills');if(raw)value=SkillsSchema.parse(JSON.parse(raw));}catch{value=emptySkills();}const listeners=new Set<()=>void>();return{get:()=>value,set(next:Skills){value=SkillsSchema.parse(next);localStorage.setItem('rewrite:skills',JSON.stringify(value));for(const l of listeners)l();},subscribe(l:()=>void){listeners.add(l);return()=>{listeners.delete(l);};}};})();
  const projectSkills=():Skills=>{const raw=project.document.current.extensions[skillsSection];return raw?SkillsSchema.parse(raw):emptySkills();};
  const allSkills=()=>listSkills(projectSkills(),machineSkills.get());
  const useSkillSets=()=>{const version=useSyncExternalStore(project.document.subscribe,()=>project.document.version),machine=useSyncExternalStore(machineSkills.subscribe,machineSkills.get);return useMemo(()=>({project:projectSkills(),machine}),[version,machine]);};
  c.contribute(projectSections,'studio.skills',{key:skillsSection,parse:v=>SkillsSchema.parse(v) as Json});
  /** PNG with its plain background removed on this computer (generated sprites and frames). */
  const cutoutPng=async(bytes:Uint8Array<ArrayBuffer>)=>{const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();const data=ctx.getImageData(0,0,canvas.width,canvas.height),result=cutoutBackground(data.data,canvas.width,canvas.height,32);if(!result.removed)return bytes;data.data.set(result.pixels);ctx.putImageData(data,0,0);return new Uint8Array(await(await canvas.convertToBlob({type:'image/png'})).arrayBuffer());};
  /** LocalHub (AI panel): pairing, generation jobs and the assistant's chat when the connection uses the hub. */
  const hubConnection=():Connection=>{const v=preferences.get('ai-hub.connection');return v==='localhub'||v==='direct'?v:'auto';};
  const hubViews=createHubViews({port:window.platform.localhub,text:t,report:notify,useEditable,
   connection:hubConnection,setConnection:value=>preferences.set('ai-hub.connection',value),useConnection:()=>useSyncExternalStore(preferences.subscribe.bind(preferences),hubConnection),
   projectKey:()=>project.document.current.entrySceneId,useProjectKey:()=>useSyncExternalStore(project.document.subscribe,()=>project.document.current.entrySceneId),
   canImport:()=>!session&&useUi.getState().mode==='edit'&&!useUi.getState().busy&&!assets.busy,
   async selectedTexture(){const asset=textureOf(useUi.getState().selected);if(!asset)return null;const blob=await(await fetch(assets.url(asset))).blob(),bitmap=await createImageBitmap(blob),canvas=new OffscreenCanvas(bitmap.width,bitmap.height);canvas.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();return{name:asset.name,bytes:new Uint8Array(await(await canvas.convertToBlob({type:'image/png'})).arrayBuffer())};},
   useSelectedTextureName:()=>{useUi(s=>s.selected);useSyncExternalStore(project.document.subscribe,()=>project.document.version);return textureOf(useUi.getState().selected)?.name??null;},
   async selectedSound(){const asset=clipOf(useUi.getState().selected);if(!asset)return null;return{name:asset.name,bytes:new Uint8Array(await(await fetch(assets.url(asset))).arrayBuffer())};},
   useSelectedSoundName:()=>{useUi(s=>s.selected);useSyncExternalStore(project.document.subscribe,()=>project.document.version);return clipOf(useUi.getState().selected)?.name??null;},
   importBytes:(bytes,name,extension)=>window.platform.assets.importBytes(bytes,name,extension),adopt:(records,info)=>adoptGenerated(records,info),
   addToLibrary:records=>{drafts.flush();assets.adopt(records,'Import from LocalHub');return records.map(r=>String((r as {id:string}).id));},
   thumbnail:id=>{const asset=assets.get(id);return asset?assets.url(asset,'thumb.webp'):undefined;},assetName:id=>assets.get(id)?.name,
   place:id=>{const asset=assets.get(id);if(asset)place(asset);},
   placeAnimation:(id,sheet)=>{const asset=assets.get(id);if(!asset)throw Error('The sprite sheet is missing');placeSheet(asset,sheet);},
   applyToSelection:id=>{const selected=useUi.getState().selected,audio=assets.get(id)?.type==='audio.clip',type=audio?'audio.source':'pixi.sprite';if(!selected||!soundOf(selected)&&audio||!spriteOf(selected)&&!audio)throw Error(audio?'Select an object with a sound first':'Select a sprite first');drafts.flush();scene.setField(selected,type,'assetId',id);},
   useCanApply:()=>{const selected=useUi(s=>s.selected);useSyncExternalStore(project.document.subscribe,()=>project.document.version);return{image:Boolean(spriteOf(selected)),audio:Boolean(soundOf(selected))};},
   clipControls:id=>{const asset=assets.get(id);return asset?.type==='audio.clip'?<ClipControls asset={asset}/>:null;},
   cutout:cutoutPng,
   improvePrompt:(idea,kind,onStatus,signal,skill,brief)=>writePrompt(lmPort,lmUrl(),chatModel(),promptWriterMessages(idea,kind,[brief?`The asset is ${brief}.`:'',writerGuidance(projectSkills(),machineSkills.get(),skill)].filter(Boolean).join('\n')),onStatus,signal),
   useSkills:()=>{const {project:p,machine:m}=useSkillSets();return useMemo(()=>listSkills(p,m).map(toChoice),[p,m]);},
   useInbox:()=>{const v=useSyncExternalStore(project.document.subscribe,()=>project.document.version);return useMemo(()=>new Set(assets.items.filter(a=>entryOf(assets.library,a.id).inbox).map(a=>a.id)),[v]);},sendToLibrary:ids=>Library.send(ids),
   openJobs:()=>openAi('jobs'),
  });
  c.own(()=>hubViews.dispose());void hubViews.refresh();
  /** Requests go through LocalHub when the AI connection says so (or it is paired and set to Automatic). */
  const viaHub=()=>useHubFor(preferences.get('ai-hub.connection'),hubViews.status());
  const chatModel=()=>String(preferences.get(viaHub()?'ai-hub.model':'ai-lm.model'));
  /** The assistant, prompt writer, skill writer and translator talk to LM Studio directly or to the hub's chat. */
  const lmPort:LmPort={
   status:async url=>viaHub()?lmStatusOf(await window.platform.localhub.status()):window.platform.lm.status(url),
   chat:async(url,jobId,request)=>{if(!viaHub())return window.platform.lm.chat(url,jobId,request);try{return await window.platform.localhub.chat(jobId,request,hubViews.servers());}catch(error){const problem=decodeProblem(error);throw Error(problem.code==='error'?problem.message:explainProblem(problem));}},
   cancel:async jobId=>{await Promise.all([window.platform.lm.cancel(jobId),window.platform.localhub.cancel(jobId)]);},
   onDelta:callback=>{const a=window.platform.lm.onDelta(callback),b=window.platform.localhub.onDelta(callback);return()=>{a();b();};},
  };
  const lmUrl=()=>String(preferences.get('ai-lm.url'));
  /** ComfyUI image generation (main process, loopback only). */
  const spriteOf=(id:string|null)=>id?scene.document.current.entities.find(e=>e.id===id)?.components.find(c=>c.type==='pixi.sprite'&&c.version===1):undefined;
  const soundOf=(id:string|null)=>id?scene.document.current.entities.find(e=>e.id===id)?.components.find(c=>c.type==='audio.source'&&c.version===1):undefined;
  const clipOf=(id:string|null)=>{const sound=soundOf(id),asset=sound?assets.get(String((sound.data as {assetId?:unknown}).assetId??'')):undefined;return asset?.type==='audio.clip'?asset:undefined;};
  const textureOf=(id:string|null)=>{const sprite=spriteOf(id),asset=sprite?assets.get(SpriteSchema.parse(sprite.data).assetId):undefined;return asset?.type==='pixi.texture'?asset:undefined;};
  const GeneratePanel=createGeneratePanel({port:window.platform.comfy,url:()=>String(preferences.get('ai-comfy.url')),text:t,report:notify,useEditable,
   async selectedTexture(){const asset=textureOf(useUi.getState().selected);if(!asset)return null;const blob=await(await fetch(assets.url(asset))).blob(),bitmap=await createImageBitmap(blob),canvas=new OffscreenCanvas(bitmap.width,bitmap.height);canvas.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();return{name:asset.name,bytes:new Uint8Array(await(await canvas.convertToBlob({type:'image/png'})).arrayBuffer())};},
   useSelectedTextureName:()=>{useUi(s=>s.selected);useSyncExternalStore(project.document.subscribe,()=>project.document.version);return textureOf(useUi.getState().selected)?.name??null;},
   adopt:(records,info)=>adoptGenerated(records,info),improvePrompt:(idea,kind,onStatus,signal,skill,brief)=>writePrompt(lmPort,lmUrl(),chatModel(),promptWriterMessages(idea,kind,[brief?`The asset is ${brief}.`:'',writerGuidance(projectSkills(),machineSkills.get(),skill)].filter(Boolean).join('\n')),onStatus,signal),
   skills:()=>allSkills().map(toChoice),useSkills:()=>{const {project:p,machine:m}=useSkillSets();return useMemo(()=>listSkills(p,m).map(toChoice),[p,m]);},
   thumbnail:id=>{const asset=assets.get(id);return asset?assets.url(asset,'thumb.webp'):undefined;},assetName:id=>assets.get(id)?.name,
   place:id=>{const asset=assets.get(id);if(asset)place(asset);},
   placeAnimation:(id,sheet)=>{const asset=assets.get(id);if(!asset)throw Error('The sprite sheet is missing');placeSheet(asset,sheet);},
   applyToSelection:id=>{const selected=useUi.getState().selected,audio=assets.get(id)?.type==='audio.clip',type=audio?'audio.source':'pixi.sprite';if(!selected||!soundOf(selected)&&audio||!spriteOf(selected)&&!audio)throw Error(audio?'Select an object with a sound first':'Select a sprite first');drafts.flush();scene.setField(selected,type,'assetId',id);},
   useCanApply:()=>{const selected=useUi(s=>s.selected);useSyncExternalStore(project.document.subscribe,()=>project.document.version);return{image:Boolean(spriteOf(selected)),audio:Boolean(soundOf(selected))};},
   clipControls:id=>{const asset=assets.get(id);return asset?.type==='audio.clip'?<ClipControls asset={asset}/>:null;},
   loadWorkflows:()=>{try{const raw=JSON.parse(localStorage.getItem('rewrite:comfy-workflows')??'[]');return Array.isArray(raw)?raw.flatMap((w:unknown):WorkflowChoice[]=>{const v=w as WorkflowChoice;const parsed=ComfyWorkflowSchema.safeParse(v?.workflow);return parsed.success&&typeof v.id==='string'&&typeof v.name==='string'?[{id:v.id,name:v.name,workflow:parsed.data}]:[];}):[];}catch{return[];}},
   saveWorkflows:list=>{try{localStorage.setItem('rewrite:comfy-workflows',JSON.stringify(list.filter(w=>!w.builtIn)));}catch(error){notify(error);}},
   /** ComfyUI jobs live on this machine (all projects), each tagged with its project (entry scene ID). */
   loadJobs:()=>{try{const raw=JSON.parse(localStorage.getItem('rewrite:comfy-jobs')??'[]');return Array.isArray(raw)?raw.flatMap((j:unknown)=>{const p=ComfyJobSchema.safeParse(j);return p.success?[p.data]:[];}):[];}catch{return[];}},
   saveJobs:jobs=>{try{localStorage.setItem('rewrite:comfy-jobs',JSON.stringify(jobs));}catch(error){notify(error);}},
   projectKey:()=>project.document.current.entrySceneId,
   useProjectKey:()=>useSyncExternalStore(project.document.subscribe,()=>project.document.current.entrySceneId),
   canImport:()=>!session&&useUi.getState().mode==='edit'&&!useUi.getState().busy&&!assets.busy,
   openGenerate:()=>openAi('create'),
   useInbox:()=>{const v=useSyncExternalStore(project.document.subscribe,()=>project.document.version);return useMemo(()=>new Set(assets.items.filter(a=>entryOf(assets.library,a.id).inbox).map(a=>a.id)),[v]);},sendToLibrary:ids=>Library.send(ids),openJobs:()=>openAi('jobs'),
  });
  /** Behaviour scripts: Monaco editor panel and the Script component inspector. */
  const scriptViews=createScriptViews({text:t,report:notify,useEditable,useSourceEditable:()=>useUi(s=>!s.busy),
   useLibrary:()=>{useSyncExternalStore(project.document.subscribe,()=>project.document.version);return projectScripts();},library:projectScripts,
   change:(label,mutate)=>{drafts.flush();project.document.transact(label,d=>{const library=ScriptLibrarySchema.parse(d.extensions[scriptsSection]??emptyLibrary());mutate(library);d.extensions[scriptsSection]=ScriptLibrarySchema.parse(library);});},
   useSelection:()=>{const id=useUi(s=>s.selected);useSyncExternalStore(project.document.subscribe,()=>project.document.version);const e=id?scene.document.current.entities.find(x=>x.id===id):undefined;return e?{id:e.id,name:e.name,scripted:e.components.some(c=>c.type===behaviourType)}:null;},
   attach:scriptId=>{const id=useUi.getState().selected;if(!id)throw Error('Select an object first');drafts.flush();scene.document.transact('Add script',d=>{const e=d.entities.find(x=>x.id===id);if(!e)throw Error('Select an object first');if(e.components.some(c=>c.type===behaviourType))throw Error(`${e.name} already has a script`);e.components.push({id:crypto.randomUUID(),type:behaviourType,version:1,data:{scriptId,params:{}}});});},
   setBehaviour:(entityId,componentId,value)=>{drafts.flush();scene.document.transact('Edit script',d=>{const c=d.entities.find(x=>x.id===entityId)?.components.find(x=>x.id===componentId);if(c)c.data=value;});},
   open:()=>useUi.getState().set({panel:'studio.scripts'}),
   useEntities:()=>{useSyncExternalStore(project.document.subscribe,()=>project.document.version);const list=scene.document.current.entities;return useMemo(()=>list.map(e=>({id:e.id,name:e.name})),[list]);},
   useGlobals:()=>{useSyncExternalStore(project.document.subscribe,()=>project.document.version);return projectGlobals().items;},
   useScene:()=>{useSyncExternalStore(project.document.subscribe,()=>project.document.version);const current=scene.document.current;return useMemo(()=>({id:current.id,name:current.name}),[current.id,current.name]);},
  });
  c.own(project.document.subscribe(warmScripts));warmScripts();
  c.own(project.document.subscribe(applyGameLook));
  c.contribute(projectSections,'studio.render',{key:renderSettingsSection,parse:v=>RenderSettingsSchema.parse(v) as Json});
  const GameSettings=createGameSettings({text:t,report:notify,useEditable,
   useSettings:()=>{const version=useSyncExternalStore(project.document.subscribe,()=>project.document.version);return useMemo(()=>({settings:projectRender(),stage:stageSize(project.document.current)}),[version]);},
   write:(label,next,fromField)=>{if(!fromField)drafts.flush();project.document.transact(label,d=>{d.extensions[renderSettingsSection]=RenderSettingsSchema.parse(next) as Json;});},
   setStage:size=>{drafts.flush();project.setStage(size);},
  });
  c.contribute(settingsSections,'studio.game',{titleKey:'settings.game',view:GameSettings,keywords:['device','desktop','tablet','mobile','portrait','landscape','orientation','responsive','fit','pixi','pixijs','render','resolution','background','fps','ticker','scale','canvas','stage','size','webgpu','webgl','antialias','pixel']});c.contribute(settingsSections,'studio.mobile',{titleKey:'settings.mobile',view:createMobileSettings({project,useEditable,text:t,report:notify}),keywords:['mobile','android','ios','iphone','app id','bundle','capacitor','apk']});c.contribute(settingsSections,'studio.webapp',{titleKey:'settings.webapp',view:createWebAppSettings({project,useEditable,text:t,report:notify}),keywords:['pwa','web app','install','offline','manifest','service worker','home screen','itch']});
  c.contribute(panels,'studio.scripts',{titleKey:'panel.scripts',icon:'script',shortcut:'Alt+C',view:scriptViews.ScriptsPanel,preferredWidth:560});
  /** LM Studio assistant: edits the project through editor tools; a whole turn is one undo step. */
  const assistantTools=createEditorTools({project,scene,assets,definitions:()=>scene.definitions(),createItems:()=>host.entries(createItems),triggers,actions,catalog:()=>catalog(),selection:()=>useUi.getState().selection,select:ids=>selectMany(ids,false),text:t,busy:()=>Boolean(session)||useUi.getState().busy,
   preview:async action=>{await host.execute(action==='play'?'studio.play':'studio.stop');},
   useSkill:name=>{const k=findSkill(allSkills(),name);if(!k)throw Error(`Unknown skill "${name}". Skills: ${allSkills().map(x=>x.name).join(', ')}`);return skillDetails(k);},
   async generate(kind,prompt,options){const k=options.skill?findSkill(allSkills(),options.skill):undefined;if(options.skill&&!k)throw Error(`Unknown skill "${options.skill}"`);if(viaHub()){const ids=await hubViews.generateNow({kind,prompt,...options,preset:k?.generate,skill:k?.name});if(!ids.length)throw Error('Nothing was generated');return ids[0];}const {records,info}=await quickGenerate(window.platform.comfy,String(preferences.get('ai-comfy.url')),{kind,prompt,...options,preset:k?.generate,skill:k?.name});const ids=adoptGenerated(records,info);if(!ids.length)throw Error('Nothing was generated');return ids[0];}});
  // MCP: clients on this computer call the assistant's tools through the main process; each call is one undo step.
  c.contribute(settingsSections,'studio.mcp',{titleKey:'settings.mcp',view:createMcpSettings(t,notify),scope:'editor',keywords:['mcp','model context protocol','claude','cursor','agent','server','automation']});
  const offMcp=window.platform.mcp?.onRequest(async request=>{
   if(request.method==='list')return assistantTools.specs.map(x=>({name:x.function.name,description:x.function.description,inputSchema:x.function.parameters}));
   if(request.method==='rect'){const r=globalThis.document.querySelector('[data-testid="pixi-canvas"]')?.getBoundingClientRect();return r&&r.width>0?{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}:null;}
   const name=String(request.name);drafts.flush();const marker=project.document.historyLength;
   try{return await assistantTools.execute(name,request.args??{});}finally{try{project.document.squash(`MCP: ${name.replace(/_/g,' ')}`,marker);}catch(error){notify(error);}}
  });
  if(offMcp)c.own(offMcp);
  const AssistantPanel=createAssistantPanel({port:lmPort,url:lmUrl,model:chatModel,setModel:id=>preferences.set(viaHub()?'ai-hub.model':'ai-lm.model',id),text:t,report:notify,useEditable,tools:()=>assistantTools,thinking:()=>preferences.get('ai-lm.thinking')===true,
   context:pinned=>({stage:stageSize(project.document.current),project:project.document.current.name,...assistantGuidance(projectSkills(),machineSkills.get(),pinned)}),useSkillList:()=>{const {project:p,machine:m}=useSkillSets();return useMemo(()=>listSkills(p,m).filter(k=>!k.always).map(k=>({id:k.id,name:k.name,description:k.description})),[p,m]);},expand:message=>expandSkillMention(message,allSkills()).text,
   beginTurn:()=>{drafts.flush();return project.document.historyLength;},
   snapshot:()=>Object.assign(new Map(project.document.current.scenes.flatMap(s=>s.entities.map(e=>[e.id,{name:e.name,json:JSON.stringify(e)}]))),{project:structuredClone({scenes:project.document.current.scenes,extensions:project.document.current.extensions})}),
   diff:before=>{const was=(before as {project?:ProjectShape}).project;if(!was)return null;const now=project.document.current,label=(type:string)=>{const d=scene.definitions().get(type);return d?t(d.titleKey):type;};return projectDiff(was,{scenes:now.scenes,extensions:now.extensions},label);},
   turnVersion:()=>project.document.version,
   discard:version=>{if(useUi.getState().mode!=='edit'||useUi.getState().busy)throw Error('Stop Preview and finish file operations first');if(project.document.version!==version)throw Error(t('assistant.discardChanged'));drafts.flush();project.document.undo();},
   changes:before=>{const was=before as Map<string,{name:string;json:string}>,now=new Map(project.document.current.scenes.flatMap(s=>s.entities.map(e=>[e.id,{name:e.name,json:JSON.stringify(e)}]))),added=[...now].filter(([id])=>!was.has(id)).map(([,v])=>v.name),removed=[...was].filter(([id])=>!now.has(id)).map(([,v])=>v.name),changed=[...now].filter(([id,v])=>was.has(id)&&was.get(id)!.json!==v.json).map(([,v])=>v.name);if(!added.length&&!removed.length&&!changed.length)return null;const list=(sign:string,names:string[])=>names.length?`${sign} ${names.slice(0,6).join(', ')}${names.length>6?` +${names.length-6}`:''}`:'';return [t('assistant.changes'),[list('+',added),list('~',changed),list('−',removed)].filter(Boolean).join(' · ')].join(' ');},endTurn:(marker,label)=>{try{project.document.squash(label,marker);}catch(error){notify(error);}}});
  const SkillsPanel=createSkillsPanel({text:t,report:notify,useEditable,useSkills:useSkillSets,
   writeProject:(label,next)=>{drafts.flush();project.document.transact(label,d=>{d.extensions[skillsSection]=SkillsSchema.parse(next) as unknown as Json;});},
   writeMachine:next=>machineSkills.set(next),useLoras:GeneratePanel.useLoras,useWorkflows:GeneratePanel.useWorkflowNames,
   writeSkill:async(request,current,lists,onStatus,signal)=>{const context={...lists,skills:allSkills().map(k=>k.name),projectInstructions:projectSkills().instructions};return parseSkillReply(await writePrompt(lmPort,lmUrl(),chatModel(),skillWriterMessages(request,current,context),onStatus,signal),context);}});
  c.contribute(panels,'studio.skills',{titleKey:'panel.skills',icon:'skills',shortcut:'Alt+K',view:SkillsPanel,preferredWidth:400});
  /** One AI panel: assistant, generation and jobs over LocalHub or this Mac directly (⌥A create, ⌥J assistant, ⌥Q jobs). */
  const useViaHub=()=>{useSyncExternalStore(preferences.subscribe.bind(preferences),()=>preferences.get('ai-hub.connection'));const status=hubViews.useStatus();return useHubFor(preferences.get('ai-hub.connection'),status);};
  const AiPanel=createAiPanel({text:t,useHub:useViaHub,Connection:hubViews.Connection,ChatTools:hubViews.ChatTools,Assistant:AssistantPanel,Create:{hub:hubViews.Create,direct:GeneratePanel},Jobs:{hub:hubViews.Jobs,direct:GeneratePanel.Jobs},Files:{hub:hubViews.Files,direct:()=><p className="panel-empty" data-testid="hub-files-direct">{t('hub.files.direct')}</p>},
   useActiveJobs:hubViews.useActiveJobs});
  const openAi=(tab:'assistant'|'create'|'jobs'|'files')=>{AiPanel.setTab(tab);useUi.getState().set({panel:'studio.ai'});};
  c.contribute(panels,'studio.ai',{titleKey:'panel.ai',icon:'assistant',shortcut:'Alt+A',view:AiPanel,preferredWidth:400});
  const aiKeys:Record<string,'assistant'|'create'|'jobs'>={KeyA:'create',KeyJ:'assistant',KeyQ:'jobs'};
  const aiShortcut=(event:KeyboardEvent)=>{const tab=aiKeys[event.code];if(!tab||!event.altKey||event.metaKey||event.ctrlKey||event.shiftKey||event.repeat)return;const target=event.target instanceof HTMLElement?event.target:null;if(target?.closest('input,textarea,select,[contenteditable=true]')||document.querySelector('[role="dialog"]:not([data-editor-panel]),[role="menu"]'))return;
   AiPanel.setTab(tab);if(event.code!=='KeyA'){event.preventDefault();if(useUi.getState().panel!=='studio.ai')useUi.getState().set({panel:'studio.ai'});}};
  window.addEventListener('keydown',aiShortcut,true);c.own(()=>window.removeEventListener('keydown',aiShortcut,true));
  c.contribute(panels,'studio.library',{titleKey:'panel.library',icon:'library',shortcut:'Alt+B',view:Library,preferredWidth:760,preferredHeight:480,defaultDock:'bottom'});
  c.contribute(panels,'studio.physics',{titleKey:'panel.physics',icon:'physics',shortcut:'Alt+Y',view:physicsViews.Settings});c.contribute(projectSections,'studio.globals',{key:globalsSection,parse:v=>GlobalsSchema.parse(v) as Json});c.contribute(projectSections,'studio.shaders',{key:shadersSection,parse:v=>ShaderLibrarySchema.parse(v) as unknown as Json});c.contribute(projectSections,'studio.strings',{key:localizationSection,parse:v=>LocalizationSchema.parse(v) as Json});c.contribute(panels,'studio.localization',{titleKey:'panel.localization',icon:'localization',shortcut:'Alt+G',view:createLocalizationPanel({useSceneTexts:()=>{useSyncExternalStore(scene.document.subscribe,()=>scene.document.version);return useMemo(()=>scene.document.current.entities.flatMap(e=>e.components.filter(c=>(c.type==='pixi.text'||c.type==='pixi.bitmapText')&&c.version===1).flatMap(c=>{const text=String((c.data as {text?:unknown}).text??'');return text.trim()&&!text.includes('{')?[{componentId:c.id,object:e.name,text}]:[];})),[scene.document.version]);},
   localize:ids=>{if(session||useUi.getState().busy)throw Error('Stop Preview first');drafts.flush();const sceneId=project.activeSceneId;project.document.transact(ids.length>1?'Localize texts':'Localize text',p=>{let table=LocalizationSchema.parse(p.extensions[localizationSection]??defaultLocalization);const target=p.scenes.find(s=>s.id===sceneId);if(!target)throw Error('Scene missing');for(const e of target.entities)for(const c of e.components){if(!ids.includes(c.id))continue;const data=c.data as {text?:string};const made=localizeText(table,String(data.text??''),e.name);table=made.next;data.text=`{@${made.key}}`;}p.extensions[localizationSection]=table as unknown as Json;});},
   read:projectStrings,write:(next,label)=>{drafts.flush();project.document.transact(label??'Edit strings',p=>{p.extensions[localizationSection]=next as unknown as Json;});},
   importFiles:()=>window.platform.strings.import(),exportFiles:files=>window.platform.strings.export(files),
   translate:(request,progress,signal)=>{const skill=findSkill(allSkills(),'Game translation');return translateStrings(lmPort,lmUrl(),chatModel(),request,[projectSkills().instructions,skill?skillDetails(skill):''].filter(s=>s.trim()).join('\n\n'),p=>progress({phase:'running',...p}),signal);},subscribe:listener=>project.document.subscribe(listener),version:()=>project.document.version,useEditable,text:t,report:notify,previewLanguage:()=>previewLanguage,setPreviewLanguage:id=>{previewLanguage=id;}})});c.contribute(projectSections,'studio.mixer',{key:mixerSection,parse:v=>MixerSchema.parse(v) as Json});c.contribute(panels,'studio.mixer',{titleKey:'panel.mixer',icon:'mixer',shortcut:'Alt+M',view:createMixerPanel({live:()=>session&&runtimeAudio?runtimeAudio.levels():null,read:projectMixer,write:next=>{drafts.flush();project.document.transact('Edit mix',p=>{p.extensions[mixerSection]=next as unknown as Json;});},subscribe:listener=>project.document.subscribe(listener),version:()=>project.document.version,useEditable,text:t})});c.contribute(projectSections,'studio.input',{key:inputSection,parse:v=>InputMapSchema.parse(v) as Json});c.contribute(panels,'studio.input',{titleKey:'panel.input',icon:'input',shortcut:'Alt+I',view:createInputPanel({live:()=>session&&runtimeInput?runtimeInput.session:null,read:projectInput,write:next=>{drafts.flush();project.document.transact('Edit input map',p=>{p.extensions[inputSection]=next as unknown as Json;});},subscribe:listener=>project.document.subscribe(listener),version:()=>project.document.version,globals:()=>projectGlobals().items.filter(g=>g.type==='number'),useEditable,text:t,report:notify})});c.contribute(panels,'studio.globals',{titleKey:'panel.globals',icon:'globals',shortcut:'Alt+V',view:createGlobalsPanel({live:()=>session&&runtimeGlobals?{values:runtimeGlobals.values(),set:(id,v)=>{runtimeGlobals?.set(id,v);runtimeInteractions?.flush();}}:null,subscribeLive:l=>{liveGlobalsListeners.add(l);return()=>{liveGlobalsListeners.delete(l);};},liveVersion:()=>liveGlobalsVersion,read:projectGlobals,write:next=>{drafts.flush();project.document.transact('Edit globals',p=>{p.extensions[globalsSection]=next as unknown as Json;});},subscribe:listener=>project.document.subscribe(listener),version:()=>project.document.version,useEditable,text:t,report:notify})});
  const SoundLab=createSoundLab({text:t,report:notify,useEditable,add:async(bytes,name,place)=>{
   if(session)throw Error('Stop Preview first');const records=await window.platform.assets.importBytes(bytes,name,'wav'),at=viewport?.viewCenter()??{x:480,y:270};let placed:string|undefined;
   assets.adopt(records,place?'Add sound object':'Add sound',place?draft=>{const target=draft.scenes.find(s=>s.id===project.activeSceneId);if(!target)return;const e=makeEntity(name,Math.round(at.x),Math.round(at.y));e.components.push({id:crypto.randomUUID(),type:'audio.source',version:1,data:{...(audioSourceDefinition.defaults() as Record<string,Json>),assetId:(records[0] as {id:string}).id}});target.entities.push(e);placed=e.id;}:undefined);
   if(placed)select(placed);notify(t(place?'sfx.addedObject':'sfx.added').replace('{name}',name));}});
  c.contribute(panels,'studio.shader',{titleKey:'panel.shader',icon:'shader',shortcut:'Alt+H',view:shaderViews.ShaderPanel,preferredWidth:820,preferredHeight:520});
  c.contribute(settingsSections,'studio.plugins',{titleKey:'plugins.title',scope:'editor',keywords:['plugin','extension','eklenti'],view:()=><PluginSettings text={t} active={id=>host.states.get(id)}/>});
  {const achievements=()=>readAchievements(project.document.current.extensions[achievementsSection]);c.contribute(projectSections,'studio.achievements',{key:achievementsSection,parse:v=>AchievementsSchema.parse(v) as unknown as Json});for(const d of achievementTriggers(achievements))c.contribute(interactionTriggers,`studio.${d.type}`,d);for(const d of achievementActions(achievements,()=>runtimeAchievements??undefined))c.contribute(interactionActions,`studio.${d.type}`,d);c.contribute(panels,'studio.achievements',{titleKey:'panel.achievements',icon:'trophy',shortcut:'Alt+X',preferredWidth:760,preferredHeight:520,view:createAchievementsPanel({text:t,useEditable,useProject:()=>{useSyncExternalStore(project.document.subscribe,()=>project.document.current);return{library:achievements(),globals:GlobalsSchema.parse(project.document.current.extensions[globalsSection]??defaultGlobals).items};},edit:(label,change)=>{try{project.document.transact(label,d=>{const lib=readAchievements(d.extensions[achievementsSection]);change(lib);d.extensions[achievementsSection]=AchievementsSchema.parse(lib) as unknown as Json;});}catch(error){notify(error);}},resetPreview:()=>{previewAchievements.clear();notify(t('achievements.resetDone'));}})});}
  c.contribute(panels,'studio.git',{titleKey:'panel.git',icon:'git',shortcut:'Alt+W',preferredWidth:560,preferredHeight:560,view:createVersionControl({text:t,report:notify,useDirty:()=>useUi(s=>s.dirty),save:()=>saveProjectRef(),current:()=>project.document.current,open:result=>openStagedRef(result)})});
  c.contribute(panels,'studio.profiler',{titleKey:'panel.profiler',icon:'profiler',shortcut:'Alt+O',view:createProfilerPanel({text:t,recorder:profiler,report:notify}),preferredWidth:640,preferredHeight:460,defaultDock:'bottom'});
  c.contribute(panels,'studio.soundlab',{titleKey:'panel.soundLab',icon:'audio',shortcut:'Alt+U',view:SoundLab,preferredWidth:620,preferredHeight:520});
  c.contribute(panels,'studio.graph',{titleKey:'panel.graph',icon:'logic',shortcut:'Alt+N',view:GraphPanel,preferredWidth:980,preferredHeight:560,defaultDock:'bottom'});
  c.contribute(panels,'studio.timeline',{titleKey:'panel.timeline',icon:'animation',shortcut:'Alt+T',view:animationViews.Timeline,preferredWidth:950,preferredHeight:340,defaultDock:'bottom'});
  c.contribute(workspaces,'studio.canvas',{titleKey:'workspace.scene',icon:'box',view:Viewport});
  /** Toolbar Add menu: a module-contributed entity template at the centre of the view; one undo step. */
  c.contribute(commands,'studio.add',{titleKey:'command.add',parse:v=>z.string().min(1).parse(v),execute(input){
   if(session||useUi.getState().busy)return;const item=host.entries(createItems).find(e=>e.id===input)?.value;if(!item)throw Error(`Unknown item: ${String(input)}`);
   drafts.flush();for(const part of item.components){const unique=scene.definitions().get(part.type)?.uniqueInScene,existing=unique?scene.document.current.entities.find(e=>e.components.some(c=>c.type===part.type)):undefined;if(existing){select(existing.id);throw Error(t('scene.uniqueExists').replace('{name}',existing.name));}}
   const at=viewport?.viewCenter()??{x:480,y:270},entity=makeEntity(item.name,Math.round(at.x),Math.round(at.y));
   for(const part of item.components){const def=scene.definitions().get(part.type);if(!def)throw Error(`${t(item.titleKey)} needs the ${part.type} component`);entity.components.push({id:crypto.randomUUID(),type:part.type,version:def.version,data:def.parse({...(def.defaults() as Record<string,Json>),...part.data}) as Json});}
   scene.document.transact(`Add ${item.name}`,d=>{d.entities.push(entity);});select(entity.id);
  }});
  c.contribute(tools,'studio.add',{titleKey:'command.add',icon:'plus',command:'studio.add',group:'add'});
  c.own(preferences.subscribe(id=>{
   if(id==='physics.debugOutlines')physics.setDebug(preferences.get(id)===true);
   if(id==='pixi.smartGuides')viewport?.setGuides(preferences.get(id)===true);
   if(id==='pixi.rulers')viewport?.setRulers(preferences.get(id)!==false);
   if(id==='recovery.enabled'&&recoveryController&&recoveryController.state.enabled!==preferences.get(id))recoveryController.setEnabled(preferences.get(id)===true);
  }));
  const playback:Record<string,()=>void>={
   async play(){if(session||useUi.getState().busy)return;drafts.flush();useUi.getState().set({busy:true});const leases:typeof previewLeases=[];try{const ids=new Set(project.document.current.scenes.flatMap(s=>s.entities.flatMap(e=>e.components.filter(c=>c.type==='spine.renderer'&&c.version===1).map(c=>String((c.data as {assetId:string}).assetId)))));for(const id of ids){const lease=spine.resources.acquire(id);leases.push(lease);await lease.promise;}previewLeases=leases;useUi.getState().set({busy:false});transitionCount=0;transitionWindow=performance.now();startRuntime(scene.document.current);applyTransition();}catch(e){for(const lease of leases)lease.release();previewLeases=[];throw e;}finally{useUi.getState().set({busy:false});}},
   pause(){if(!session)return;if(session.paused){session.resume();useUi.getState().set({mode:'playing'});}else{session.pause();if(viewport)viewport.app.canvas.parentElement!.dataset.runtimeTime=String(session.time);useUi.getState().set({mode:'paused'});}},
   step(){session?.step();renderRuntime();applyTransition();},stop,
  };
  for(const [id,execute]of Object.entries(playback)){c.contribute(commands,`studio.${id}`,{titleKey:`command.${id}`,execute});c.contribute(tools,`studio.${id}`,{titleKey:`command.${id}`,icon:id,command:`studio.${id}`,group:'play'});}
  project.fresh(sample());
 }};
 function DragRoot({children}:{children:ReactNode}){
  const [externalDrop,setExternalDrop]=useState(false);
  const dropFiles=async(event:React.DragEvent)=>{if(!event.dataTransfer.types.includes('Files'))return;event.preventDefault();event.stopPropagation();setExternalDrop(false);if(session||useUi.getState().busy||assets.busy||document.querySelector('[role="dialog"]:not([data-editor-panel]),[role="alertdialog"]')){notify(t('library.dropBusy'));return;}const files=Array.from(event.dataTransfer.files);if(!files.length)return;if(files.length>64){notify(t('library.dropLimit'));return;}const target=event.target as HTMLElement,onCanvas=Boolean(target.closest('[data-testid="pixi-canvas"]')),point=viewport?.screenToScene(event.clientX,event.clientY),folder=target.closest('[data-folder]')?.getAttribute('data-folder')??target.closest('[data-import-folder]')?.getAttribute('data-import-folder'),generation=project.generation,before=new Set(assets.items.map(a=>a.id));try{drafts.flush();await assets.import('*',undefined,()=>window.platform.assets.drop(files));if(project.generation!==generation)return;const added=assets.items.filter(a=>!before.has(a.id));if(folder&&libraryDrop&&assets.library.folders.some(f=>f.id===folder))project.document.batch('File dropped assets',()=>{for(const asset of added)libraryDrop!(asset.id,folder);});if(onCanvas)for(const [i,asset]of added.entries())if(['pixi.texture','audio.clip','spine.skeleton'].includes(asset.type))place(asset,point?{x:point.x+i*24,y:point.y+i*24}:undefined);}catch(error){notify(error);}};

  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}),useSensor(KeyboardSensor)),[dragAsset,setDragAsset]=useState<AssetRecord|null>(null);
  /** While an asset is dragged (and just after the drop) floating panels stay open: the dragged card may leave the Library view and take focus with it. */
  const dragDone=()=>{setTimeout(()=>{delete document.body.dataset.assetDrag;},300);};
  const drop=(event:DragEndEvent)=>{setDragAsset(null);suppressClickUntil=Date.now()+250;dragDone();const over=String(event.over?.id??''),dragged=event.active.data.current?.assetId;if(over.startsWith('folder:')&&typeof dragged==='string'){libraryDrop?.(dragged,over.slice(7));return;}if(over!=='studio.canvas'||!viewport)return;const id=dragged,asset=typeof id==='string'?assets.get(id):undefined;if(!asset||!['pixi.texture','audio.clip','spine.skeleton'].includes(asset.type))return;const start=event.activatorEvent;let point: {x:number;y:number}|undefined;if(start instanceof MouseEvent)point=viewport.screenToScene(start.clientX+event.delta.x,start.clientY+event.delta.y);try{place(asset,point);}catch(error){notify(error);}};
  return <div className="desktop-drop-surface" onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';setExternalDrop(true);}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setExternalDrop(false);}} onDropCapture={event=>void dropFiles(event)}>{externalDrop&&<div className="external-drop-hint" role="status">{t('library.dropFiles')}</div>}<DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={e=>{document.body.dataset.assetDrag='true';setDragAsset(assets.get(String(e.active.data.current?.assetId))??null);}} onDragEnd={drop} onDragCancel={()=>{setDragAsset(null);suppressClickUntil=Date.now()+250;dragDone();}}>{children}{createPortal(<DragOverlay dropAnimation={null} style={{pointerEvents:'none'}}>{dragAsset&&<div className="asset-drag-preview">{dragAsset.type==='pixi.texture'?<img src={assets.url(dragAsset,'thumb.webp')} alt=""/>:<span>{dragAsset.type==='spine.skeleton'?'♧':'♪'}</span>}<span>{dragAsset.name}</span></div>}</DragOverlay>,document.body)}</DndContext></div>;
 }
 return{preferences,modules:[settingsModule,projectModule(definitions,()=>host.entries(projectSections).map(e=>e.value)),sceneModule(definitions,{owner:'project',get:c=>c.get(sceneDocumentToken)}),assetsModule(port),pixiModule,layoutModule,comfyModule,lmModule,hubModule,assetPackModule,audioModule,howlerModule,tweenModule,gsapModule,tweenPixiModule,animationModule,physicsModule({get:()=>preferences.stored('physics.debugOutlines')===true,set:value=>preferences.set('physics.debugOutlines',value)}),matterModule,spineModule,spineAudioModule,createInteractionsModule(()=>({triggers:triggers(),actions:actions()})),interactionMediaModule,scriptsModule,inputModule,buildModule(window.platform.build),htmlExportModule,prefabsModule,projectUi,recovery,studioUi],DragRoot,EditRoot};
}
export default function Studio(){
 const[ready,setReady]=useState<{host:ModuleHost;composition:ReturnType<typeof createStudio>}|null>(null),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;const host=new ModuleHost();void (async()=>{const startup=await window.platform.recovery.bootstrap();const info=await window.platform.assets.info(),hubState=await window.platform.hub.state();if(cancelled)return;const hubAtStartup=hubState.showAtStartup&&startup.copies.length===0;if(hubAtStartup)useUi.getState().set({hub:true});const port:AssetPort={sessionId:info.sessionId,rebuild:window.platform.assets.rebuild,inspect:window.platform.assets.inspect,import:window.platform.assets.import,importAny:window.platform.assets.importAny,cancel:window.platform.assets.cancel};const composition=createStudio(host,port,startup,hubAtStartup);const plugins=await loadPlugins(message=>notify(message));await host.start([...composition.modules,...plugins]);if(cancelled)await host.stop();else setReady({host,composition});})().catch(e=>setError(String(e)));return()=>{cancelled=true;void host.stop();};},[]);
 if(!ready)return error?<div role="alert">{error}</div>:null;const {DragRoot,EditRoot}=ready.composition;return <EditRoot><DragRoot><Shell host={ready.host} preferences={ready.composition.preferences}/></DragRoot></EditRoot>;
}
