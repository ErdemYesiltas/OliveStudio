import {type EditorModule} from '@rewrite/sdk';
import {tweenChannels} from '@rewrite/tween/contracts';
export const tweenPixiModule:EditorModule={manifest:{id:'tween-pixi',version:'1.0.0',apiVersion:1,requires:{tween:'^1',pixi:'^1'}},activate(c){for(const type of ['pixi.shape','pixi.text','pixi.bitmapText','pixi.sprite'])c.contribute(tweenChannels,`tween-pixi.${type}.alpha`,{componentType:type,version:1,property:'alpha',titleKey:'field.alpha',min:0,max:1,defaultValue:1});}};
