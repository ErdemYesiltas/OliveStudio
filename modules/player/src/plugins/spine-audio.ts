import {dispatchSpineAudio} from '@rewrite/spine-audio';
import type {SpineEvent} from '@rewrite/spine/contracts';
import type {PlayerPlugin} from '../plugin';
export default{id:'spine-audio',create(c){return{event(e){const audio=c.controllers.get('audio');if(e.type==='spine'&&audio)dispatchSpineAudio(e.value as SpineEvent,c.entities(),audio);},dispose(){}};}}satisfies PlayerPlugin;
