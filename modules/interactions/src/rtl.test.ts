import {expect, it} from 'vitest';
import {LocalizationSchema, codeDirection, createLanguageStore, languageDirection} from './index';

it('derives writing direction from the code (script subtags win) and lets a language override it', () => {
 expect(['ar', 'he', 'fa', 'ur', 'ar-EG', 'az-Arab', 'yi'].map(codeDirection)).toEqual(Array(7).fill('rtl'));
 expect(['en', 'tr', 'pt-BR', 'ku-Latn', 'zh', 'ja'].map(codeDirection)).toEqual(Array(6).fill('ltr'));
 const table = LocalizationSchema.parse({version: 1, defaultLanguage: 'en', languages: [{id: 'en', name: 'English'}, {id: 'ar', name: 'Arabic'}, {id: 'ku', name: 'Kurdish', direction: 'rtl'}], entries: [{key: 'hi', values: {en: 'Hello', ar: 'مرحبا'}}]});
 expect(['en', 'ar', 'ku'].map(id => languageDirection(table, id))).toEqual(['ltr', 'rtl', 'rtl']);
 expect(() => LocalizationSchema.parse({...table, languages: [{id: 'en', name: 'English', direction: 'up'}]})).toThrow();
 const changes: string[] = [], store = createLanguageStore(table, 'en', () => changes.push(store.direction));
 expect(store.direction).toBe('ltr');
 store.setLanguage('ar');
 expect([store.direction, store.text('hi')]).toEqual(['rtl', 'مرحبا']);
 expect(changes).toEqual(['rtl']);
});
