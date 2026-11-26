import {createSceneMotion} from '@rewrite/animation';
import {gsapProvider} from '@rewrite/tween-gsap';
import {gameChannels} from '../contracts';
import type {PlayerPlugin} from '../plugin';

export default {id:'gsap',create(c){
 let motion:ReturnType<typeof createSceneMotion>|undefined;
 return {
  systems(){
   motion=createSceneMotion(c.entities,gameChannels,gsapProvider,{
    silent:()=>c.simulation.paused,
    emit:c.emit,
    invoke:c.invoke,
    cue:(action,silent,owner)=>c.act?.(action,silent,owner),
    message:(message,data)=>c.publish({type:'script.message',value:{message,data}}),
    report:error=>c.report(String(error)),
   });
   c.controllers.set('tween',motion.tween);
   c.controllers.set('animation',motion.animation);
   return [motion.tween.system,motion.animation.system];
  },
  errors:()=>motion?[...motion.tween.errors,...motion.animation.errors]:[],
  clear(){motion=undefined;},
  dispose(){},
 };
}} satisfies PlayerPlugin;
