import {expect, it} from 'vitest';
import {RenderSettingsSchema, defaultRenderSettings, renderResolution} from './contracts';

it('render settings: defaults match the earlier fixed values; resolution follows the device up to the cap', () => {
 expect(defaultRenderSettings()).toEqual({version: 1, background: '#20272d', resolution: 0, maxResolution: 2, antialias: true, renderer: 'webgl', scaleMode: 'fit', pixelArt: false, maxFPS: 0, minFPS: 10, debugOverlay: false});
 const auto = defaultRenderSettings();
 expect([renderResolution(auto, 1), renderResolution(auto, 3), renderResolution(auto, 0)]).toEqual([1, 2, 1]);
 expect(renderResolution({...auto, resolution: .5}, 3)).toBe(.5);
 expect(renderResolution({...auto, maxResolution: 3}, 3)).toBe(3);
 expect(() => RenderSettingsSchema.parse({version: 1, background: 'red'})).toThrow();
 expect(() => RenderSettingsSchema.parse({version: 1, maxFPS: 500})).toThrow();
});
it('resolves opt-in device/orientation presentation without changing legacy defaults or authored input',async()=>{const{resolvePresentation}=await import('./contracts'),base=defaultRenderSettings(),stage={width:960,height:540};expect(resolvePresentation(base,stage,{width:390,height:844}).stage).toBe(stage);const settings=RenderSettingsSchema.parse({...base,profiles:{mobile:{portrait:{width:390,height:844,scaleMode:'fill'},landscape:{width:844,height:390,scaleMode:'fit'}},tablet:{portrait:{width:768,height:1024,scaleMode:'stretch'}}}});expect(resolvePresentation(settings,stage,{width:390,height:844})).toMatchObject({device:'mobile',orientation:'portrait',overridden:true,stage:{width:390,height:844},settings:{scaleMode:'fill'}});expect(resolvePresentation(settings,stage,{width:800,height:1000})).toMatchObject({device:'tablet',stage:{width:768,height:1024}});expect(resolvePresentation(settings,stage,{width:1440,height:900})).toMatchObject({device:'desktop',overridden:false,stage});expect(resolvePresentation(settings,stage,{width:844,height:390})).toMatchObject({device:'mobile',orientation:'landscape',stage:{width:844,height:390}});expect(settings.scaleMode).toBe('fit');expect(()=>RenderSettingsSchema.parse({...base,profiles:{mobile:{portrait:{width:0,height:844,scaleMode:'fill'}}}})).toThrow();});
