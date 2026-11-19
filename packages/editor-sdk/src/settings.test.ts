import {expect, it, vi} from 'vitest';
import {SettingsStore, readSetting, type SettingDefinition} from './index';

const defs = new Map<string, SettingDefinition>([
 ['a.flag', {titleKey: 'flag', kind: 'boolean', default: false}],
 ['a.volume', {titleKey: 'volume', kind: 'number', default: 25, min: 0, max: 100, step: 5}],
 ['a.step', {titleKey: 'step', kind: 'enum', default: '32', options: [{value: '16', titleKey: '16'}, {value: '32', titleKey: '32'}]}],
]);
const memory = (initial: string | null = null) => { let value = initial; return {read: () => value, write: (next: string) => { value = next; }, get: () => value}; };

it('validates values by kind and falls back to defaults', () => {
 expect(readSetting(defs.get('a.flag')!, 'yes')).toBe(false);
 expect(readSetting(defs.get('a.volume')!, 47)).toBe(45);
 expect(readSetting(defs.get('a.volume')!, 400)).toBe(100);
 expect(readSetting(defs.get('a.volume')!, Number.NaN)).toBe(25);
 expect(readSetting(defs.get('a.step')!, '64')).toBe('32');
});

it('persists changes, notifies once per real change and resets', () => {
 const storage = memory(), store = new SettingsStore(() => defs, storage), seen = vi.fn();
 store.subscribe(seen);
 store.set('a.flag', true); store.set('a.flag', true); store.set('a.step', '16');
 expect(seen.mock.calls).toEqual([['a.flag'], ['a.step']]);
 expect(JSON.parse(storage.get()!)).toEqual({'a.flag': true, 'a.step': '16'});
 expect(new SettingsStore(() => defs, storage).get('a.step')).toBe('16');
 store.reset('a.flag'); expect(store.get('a.flag')).toBe(false); expect(store.isDefault('a.flag')).toBe(true);
 store.reset(); expect(storage.get()).toBe('{}');
 expect(seen.mock.calls.slice(2)).toEqual([['a.flag'], ['a.step']]);
 expect(() => store.get('b.missing')).toThrow('Unknown setting');
});

it('keeps values of absent modules, survives corrupt storage and imports legacy values once', () => {
 const storage = memory('{"gone.module":1,"a.flag":true}'), store = new SettingsStore(() => defs, storage);
 store.set('a.step', '16');
 expect(JSON.parse(storage.get()!)['gone.module']).toBe(1);
 expect(new SettingsStore(() => defs, memory('{oops')).get('a.flag')).toBe(false);
 store.seed('a.flag', false); expect(store.get('a.flag')).toBe(true);
 store.seed('a.volume', 50); expect(store.get('a.volume')).toBe(50); expect(store.stored('a.volume')).toBe(50);
});
