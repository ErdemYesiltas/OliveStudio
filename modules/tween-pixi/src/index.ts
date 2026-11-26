import {type EditorModule} from '@rewrite/sdk';
import {pixiTweenChannels} from '@rewrite/render-pixi/contracts';
import {tweenChannels} from '@rewrite/tween/contracts';
export const tweenPixiModule:EditorModule={manifest:{id:'tween-pixi',version:'1.0.0',apiVersion:1,requires:{tween:'^1',pixi:'^1'}},activate(c){for(const channel of pixiTweenChannels)c.contribute(tweenChannels,`tween-pixi.${channel.componentType}.alpha`,channel);}};
