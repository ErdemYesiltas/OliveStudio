import type {GlobalStore,LanguageStore} from '@rewrite/interactions';
import type {ScriptHost} from './session';

type ServiceName='physics'|'navigation'|'achievements'|'dialogue'|'audio'|'animation';
type Controls=Required<Pick<ScriptHost,ServiceName>>;
type Providers={ [Name in ServiceName]:()=>Controls[Name]|undefined };

/** Resolve a service at the point of use, after all scene systems have been constructed. */
export function connectScriptServices(providers:Providers):Controls{
 const requireService=<Name extends ServiceName>(name:Name,message:string):Controls[Name]=>{
  const provider=providers[name]();
  if(!provider)throw Error(message);
  return provider;
 };
 const physics=()=>requireService('physics','Physics is not running in this scene');
 const navigation=()=>requireService('navigation','Navigation is not running in this scene (add a Nav Grid)');
 const achievements=()=>requireService('achievements','Achievements are unavailable');
 const dialogue=()=>requireService('dialogue','Dialogues are unavailable');
 const audio=()=>requireService('audio','Audio is unavailable');
 const animation=()=>requireService('animation','Timelines are unavailable');
 return {
  physics:{
   setVelocity:(id,x,y)=>physics().setVelocity(id,x,y),
   setAngularVelocity:(id,d)=>physics().setAngularVelocity(id,d),
   applyForce:(id,x,y)=>physics().applyForce(id,x,y),
   applyImpulse:(id,x,y)=>physics().applyImpulse(id,x,y),
   teleport:(id,x,y)=>physics().teleport(id,x,y),body:id=>physics().body(id),
   gravity:()=>physics().gravity(),setGravity:(x,y)=>physics().setGravity(x,y),
   raycast:(...args)=>physics().raycast(...args),
   objectsAt:(x,y)=>physics().objectsAt(x,y),objectsIn:(...args)=>physics().objectsIn(...args),
  },
  navigation:{
   findPath:(...args)=>navigation().findPath(...args),moveTo:(id,x,y)=>navigation().moveTo(id,x,y),
   follow:(id,target)=>navigation().follow(id,target),stop:id=>navigation().stop(id),
   walkable:(x,y)=>navigation().walkable(x,y),rebuild:()=>navigation().rebuild(),state:id=>navigation().state(id),
  },
  achievements:{
   unlock:key=>achievements().unlock(key),unlocked:key=>achievements().unlocked(key),
   submit:(board,score,name)=>achievements().submit(board,score,name),top:board=>achievements().top(board),
   list:()=>achievements().list(),
  },
  dialogue:{
   name:id=>providers.dialogue()?.name?.(id),start:id=>dialogue().start(id),
   advance:()=>dialogue().advance(),choose:index=>dialogue().choose(index),stop:()=>dialogue().stop(),
   view:()=>providers.dialogue()?.view()??null,
  },
  audio:{
   play:id=>audio().play(id),stop:id=>audio().stop(id),
   fade:(id,to,seconds,stop)=>audio().fade(id,to,seconds,stop),
   setBus:(bus,gain)=>audio().setBus(bus,gain),bus:bus=>audio().bus(bus),state:id=>audio().state(id),
  },
  animation:{
   play:(id,clip,fade)=>animation().play(id,clip,fade),pause:id=>animation().pause(id),resume:id=>animation().resume(id),
   seekPlayer:(id,time)=>animation().seekPlayer(id,time),setSpeed:(id,speed)=>animation().setSpeed(id,speed),
   reverse:id=>animation().reverse(id),state:id=>animation().state(id),
  },
 };
}

export function scriptLanguage(language:()=>LanguageStore|undefined,globals:()=>GlobalStore|undefined):NonNullable<ScriptHost['language']>{
 return {
  current:()=>language()?.language??'',
  set(id){
   const store=language();
   if(!store)throw Error('This game has no localization');
   store.setLanguage(id);
  },
  t:(key,values)=>language()?.text(key,{...globals()?.snapshot(),...values as Record<string,string|number>}),
 };
}
