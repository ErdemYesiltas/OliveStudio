import {expect, it} from 'vitest';
import {screenSpace, screenOffset, screenSpaceType} from './screen';

it('puts only top-level objects on the screen layer and keeps them at their anchor on other screen sizes', () => {
 const hud = {parentId: null, components: [{type: screenSpaceType, version: 1, data: {anchor: 'top-right'}}]};
 expect(screenSpace(hud)).toEqual({anchor: 'top-right'});
 expect(screenSpace({...hud, parentId: 'p'})).toBeUndefined();
 expect(screenSpace({parentId: null, components: []})).toBeUndefined();
 expect(screenSpace({parentId: null, components: [{type: screenSpaceType, version: 1, data: {}}]})).toEqual({anchor: 'top-left'});
 const authored = {width: 960, height: 540}, wide = {width: 1280, height: 720};
 expect(screenOffset('top-left', wide, authored)).toEqual({x: 0, y: 0});
 expect(screenOffset('top-right', wide, authored)).toEqual({x: 320, y: 0});
 expect(screenOffset('bottom', wide, authored)).toEqual({x: 160, y: 180});
 expect(screenOffset('center', wide, authored)).toEqual({x: 160, y: 90});
 expect(screenOffset('bottom-right', authored, authored)).toEqual({x: 0, y: 0});
});
