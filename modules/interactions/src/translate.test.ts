import {expect, it} from 'vitest';
import {applyTranslations, missingTranslations, type Localization} from './localization';

const table: Localization = {version: 1, defaultLanguage: 'en', languages: [{id: 'en', name: 'English'}, {id: 'ru', name: 'Russian'}], entries: [
 {key: 'play', values: {en: 'Play'}, note: 'Main menu button'},
 {key: 'score', values: {en: 'Score: {{score}}', ru: 'Счёт: {{score}}'}},
 {key: 'coins_one', values: {en: '{{count}} coin'}}, {key: 'coins_other', values: {en: '{{count}} coins'}},
 {key: 'empty', values: {}},
]};

it('finds texts the language lacks, plural groups by the target plural categories', () => {
 const r = missingTranslations(table, 'ru');
 expect(r.items).toEqual([{key: 'play', text: 'Play', note: 'Main menu button'}]);
 expect(r.plurals).toEqual([{base: 'coins', forms: {one: '{{count}} coin', other: '{{count}} coins'}}]);
 expect(r.categories).toEqual(expect.arrayContaining(['one', 'few', 'many', 'other']));
 expect(r.from).toEqual({id: 'en', name: 'English'}); expect(r.to).toEqual({id: 'ru', name: 'Russian'});
});
it('writes translations marked for review and refuses ones whose placeholders changed', () => {
 const request = missingTranslations(table, 'ru');
 const out = applyTranslations(table, request, {play: 'Играть', coins_one: '{{count}} монета', coins_few: '{{count}} монеты', coins_many: '{{count}} монет', coins_other: '{{amount}} монеты'});
 expect(out.written).toBe(4); expect(out.refused).toEqual(['coins_other']);
 expect(out.table.entries.find(e => e.key === 'play')).toEqual({key: 'play', values: {en: 'Play', ru: 'Играть'}, note: 'Main menu button', review: ['ru']});
 expect(out.table.entries.find(e => e.key === 'coins_few')).toEqual({key: 'coins_few', values: {ru: '{{count}} монеты'}, review: ['ru']});
});
