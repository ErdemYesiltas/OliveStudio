import {audioTweenChannels} from '@rewrite/audio/contracts';
import {spineTweenChannel} from '@rewrite/spine/contracts';
import {transformTweenChannels,type TweenChannel} from '@rewrite/tween/contracts';
import {pixiTweenChannels} from '@olivestudio/engine/contracts';

export const gameChannels:readonly TweenChannel[]=[
 ...transformTweenChannels,...pixiTweenChannels,...audioTweenChannels,spineTweenChannel,
];
