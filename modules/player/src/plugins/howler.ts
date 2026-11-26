import {Howl,Howler} from 'howler';
import {createSceneAudio,MixerSchema,defaultMixer,mixerSection} from '@rewrite/audio';
import {howlerProvider} from '@rewrite/audio-howler';
import type {PlayerPlugin} from '../plugin';
export default{id:'howler',create(c){return{unlock(){const probe=new Howl({src:['data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA=='],preload:false});const result=Howler.ctx?.resume();probe.unload();return result;},systems(){const mixer=MixerSchema.parse(c.bundle.project.extensions[mixerSection]??defaultMixer),audio=createSceneAudio(c.entities,howlerProvider,{
 asset:c.assets.get,url:(asset,file)=>c.assets.url(asset,file),mixer,listener:c.view,silent:()=>c.simulation.paused,emit:c.emit,
 });c.controllers.set('audio',audio);return[audio.system];},dispose(){}};}}satisfies PlayerPlugin;
