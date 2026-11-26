import {expect, it} from 'vitest';
import {gameChannels} from './contracts';

it('exported games animate skew and flipped scale like the editor', () => {
 const byProperty = Object.fromEntries(gameChannels.filter(c => c.componentType === 'scene.transform2d').map(c => [c.property, c]));
 expect(Object.keys(byProperty)).toEqual(['x', 'y', 'rotation', 'scaleX', 'scaleY', 'skewX', 'skewY']);
 expect(byProperty.scaleX).toMatchObject({min: -100, max: 100, nonZero: true});
 expect(byProperty.skewY).toMatchObject({min: -89, max: 89, defaultValue: 0});
});

it('supports the editor audio source channels at export and at runtime', () => {
 const audio=gameChannels.filter(channel=>channel.componentType==='audio.source');
 expect(audio).toMatchObject([
  {property:'volume',min:0,max:1,defaultValue:1},
  {property:'rate',min:.25,max:4,defaultValue:1},
 ]);
});
