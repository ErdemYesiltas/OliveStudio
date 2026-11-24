import {it,expect} from 'vitest';
import {presetPanels} from './workspace-presets';
it('lays out installed semantic panel roles and omits unavailable modules',()=>{const entries=['layers','properties','library','animation','scenes','script'].map(icon=>({id:'contributed.'+icon,value:{icon}}));expect(presetPanels(entries,'designer')).toEqual([{id:'contributed.layers',side:'left'},{id:'contributed.properties',side:'right'},{id:'contributed.library',side:'below'}]);expect(presetPanels(entries,'animator').at(-1)?.id).toBe('contributed.animation');expect(presetPanels(entries,'developer').at(-1)?.id).toBe('contributed.script');expect(presetPanels(entries,'canvas')).toEqual([]);expect(presetPanels([],'designer')).toEqual([]);});


it('tabs related Studio panels together and places Inspector at the right edge',()=>{
 const entries=['layers','properties','library','prefab','console','scenes'].map(icon=>({id:icon,value:{icon}}));
 expect(presetPanels(entries,'studio')).toEqual([
  {id:'library',side:'below'},
  {id:'prefab',side:'below',tabWith:'library'},
  {id:'console',side:'below',tabWith:'library'},
  {id:'layers',side:'left'},
  {id:'scenes',side:'left',tabWith:'layers'},
  {id:'properties',side:'right',edge:true},
 ]);
 expect(presetPanels(entries.filter(e=>e.id!=='library'),'studio')).toContainEqual({id:'console',side:'below',tabWith:'prefab'});
});
