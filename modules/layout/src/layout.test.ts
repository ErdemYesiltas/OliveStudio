import {expect, it} from 'vitest';
import {LayoutContainerSchema, LayoutItemSchema, containerDefaults, containerStyle, itemDefaults, itemStyle, layoutContainerDefinition, layoutItemDefinition, layoutManaged} from './contracts';

it('defaults parse and every field maps to data', () => {
 for (const d of [layoutContainerDefinition, layoutItemDefinition]) {
  expect(d.parse(d.defaults())).toEqual(d.defaults());
  expect(d.fields.every(f => f.key in (d.defaults() as object))).toBe(true);
 }
 expect(() => LayoutContainerSchema.parse({...containerDefaults, direction: 'diagonal'})).toThrow();
 expect(() => LayoutItemSchema.parse({...itemDefaults, extra: 1})).toThrow();
});

it('maps container data to @pixi/layout styles', () => {
 expect(containerStyle({...containerDefaults, width: 0, wrap: true, backgroundAlpha: 0, clip: true})).toMatchObject({width: 'auto', height: 160, flexWrap: 'wrap', backgroundColor: undefined, overflow: 'hidden'});
 expect(containerStyle({...containerDefaults, background: '#102030', backgroundAlpha: 0.5}).backgroundColor).toBe('#10203080');
 expect(containerStyle({...containerDefaults, borderWidth: 0}).borderColor).toBeUndefined();
});

it('sizes items from content unless overridden; transforms never enter the box', () => {
 expect(itemStyle(itemDefaults, {width: 100.004, height: 0})).toMatchObject({isLeaf: true, width: 100, height: 1, objectFit: 'none', flexShrink: 1});
 expect(itemStyle({...itemDefaults, width: 40, grow: 2, alignSelf: 'stretch'}, {width: 100, height: 50})).toMatchObject({width: 40, height: 50, flexGrow: 2, alignSelf: 'stretch'});
});

it('locks only direct children of layout containers', () => {
 const c = (type: string) => ({type, version: 1, data: null});
 const entities = [
  {id: 'row', parentId: null, components: [c('layout.container')]}, {id: 'a', parentId: 'row', components: []},
  {id: 'a1', parentId: 'a', components: []}, {id: 'free', parentId: null, components: []},
 ];
 expect([...layoutManaged(entities)]).toEqual(['a']);
});

it('absolute items and percent sizes map to Yoga styles; older items default to flow', () => {
 expect(LayoutItemSchema.parse({grow: 0, shrink: 1, alignSelf: 'auto', margin: 0, width: 0, height: 0, fit: 'none'})).toMatchObject({position: 'flow', widthUnit: 'px'});
 expect(itemStyle({...itemDefaults, position: 'absolute', left: 10, top: -4, width: 50, widthUnit: '%'}, {width: 30, height: 20})).toMatchObject({position: 'absolute', left: 10, top: -4, width: '50%', height: 20});
 expect(itemStyle(itemDefaults, {width: 30, height: 20})).not.toHaveProperty('position');
});

it('mirrors rows in right-to-left languages (row ↔ row-reverse); columns stay', async () => {
 const {containerStyle, containerDefaults} = await import('./contracts');
 expect(containerStyle({...containerDefaults, direction: 'row'}, true).flexDirection).toBe('row-reverse');
 expect(containerStyle({...containerDefaults, direction: 'row-reverse'}, true).flexDirection).toBe('row');
 expect(containerStyle({...containerDefaults, direction: 'column'}, true).flexDirection).toBe('column');
 expect(containerStyle({...containerDefaults, direction: 'row'}).flexDirection).toBe('row');
});
