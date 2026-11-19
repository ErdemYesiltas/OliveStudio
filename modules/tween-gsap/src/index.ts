import {gsap} from 'gsap';
import {providers,type EditorModule} from '@rewrite/sdk';
import {tweenProviders,type TweenProvider} from '@rewrite/tween/contracts';
const easing={linear:'none','quad.in':'power1.in','quad.out':'power1.out','quad.inOut':'power1.inOut','cubic.in':'power2.in','cubic.out':'power2.out','cubic.inOut':'power2.inOut','sine.inOut':'sine.inOut'};
export const gsapProvider:TweenProvider={id:'gsap',create(spec){
 const model:Record<string,number>={},from:Record<string,number>={},to:Record<string,number>={};
 // Track IDs are data keys only; GSAP reserved variable names never enter the property map.
 for(const[i,track]of spec.tracks.entries()){const key=`v${i}`;model[key]=from[key]=track.from;to[key]=track.to;}
 const tween=gsap.fromTo(model,from,{...to,duration:spec.duration,repeat:spec.repeat,yoyo:spec.yoyo,ease:easing[spec.ease],paused:true,immediateRender:false,lazy:false,overwrite:false});let dead=false;
 return{sample(time){if(dead)throw Error('Tween sampler is disposed');if(!Number.isFinite(time)||time<0)throw Error('Tween time must be finite and nonnegative');tween.totalTime(Math.max(0,time-spec.delay),true);if(time<=spec.delay)Object.assign(model,from);return Object.fromEntries(spec.tracks.map((t,i)=>[t.id,model[`v${i}`]]));},dispose(){if(dead)return;dead=true;tween.kill();}};
}};
export const gsapModule:EditorModule={manifest:{id:'gsap',version:'1.0.0',apiVersion:1,requires:{tween:'^1'},entries:{runtime:'@rewrite/tween-gsap'}},activate(c){c.contribute(tweenProviders,'gsap.adapter',gsapProvider);c.contribute(providers,'gsap.descriptor',{id:'gsap',service:'tween',version:'1.0.0',capabilities:['numeric-channels','seek','repeat','yoyo'],targets:['html','macos'],runtimeEntry:'@rewrite/tween-gsap'});}};
