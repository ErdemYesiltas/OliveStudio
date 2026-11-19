import {expect, it} from 'vitest';
import {createLanguageStore, fileLanguage, formatTemplate, mergeI18nextJson, placeholders, pluralCategories, toI18nextJson, LocalizationSchema, type Localization} from './index';

const table: Localization = {version: 1, defaultLanguage: 'en', languages: [{id: 'en', name: 'English'}, {id: 'tr', name: 'Turkish'}, {id: 'pt', name: 'Portuguese'}, {id: 'pt-BR', name: 'Portuguese (Brazil)'}], entries: [
 {key: 'title', values: {en: 'Hello', tr: 'Merhaba', pt: 'Olá'}},
 {key: 'score', values: {en: 'Score: {{score}}', tr: 'Puan: {{score}}'}},
 {key: 'coins_one', values: {en: '{{count}} coin', tr: '{{count}} altın'}},
 {key: 'coins_other', values: {en: '{{count}} coins', tr: '{{count}} altın'}},
 {key: 'menu.play', values: {en: 'Play $t(title)'}},
]};

it('runs the table on i18next: interpolation, plurals, nesting and the language fallback chain', () => {
 const store = createLanguageStore(table, 'tr');
 expect(store.text('title')).toBe('Merhaba');
 expect(store.text('score', {score: 12})).toBe('Puan: 12');
 expect(store.text('coins', {count: 3})).toBe('3 altın');
 expect(store.text('menu.play')).toBe('Play Merhaba');
 expect(store.text('missing')).toBeUndefined();
 store.setLanguage('en');
 expect(store.text('coins', {count: 1})).toBe('1 coin'); expect(store.text('coins', {count: 5})).toBe('5 coins');
 store.setLanguage('pt-BR');
 expect(store.text('title')).toBe('Olá');
 expect(store.text('score', {score: 3})).toBe('Score: 3');
 expect(() => store.setLanguage('de')).toThrow('Unknown language');
});
it('formats {@key}, {@key:count} and {variable} templates', () => {
 const store = createLanguageStore(table), vars: Record<string, number> = {coins: 2, score: 40};
 const localize = (key: string, count?: number) => store.text(key, {...vars, ...(count === undefined ? {} : {count})});
 expect(formatTemplate('{@coins:coins} · {@score} · {score}', n => vars[n], localize)).toBe('2 coins · Score: 40 · 40');
 expect(formatTemplate('{@nope}', n => vars[n], localize)).toBe('{@nope}');
});
it('reads and writes i18next resource files', () => {
 expect(toI18nextJson(table, 'tr')).toEqual({title: 'Merhaba', score: 'Puan: {{score}}', coins_one: '{{count}} altın', coins_other: '{{count}} altın'});
 const first = mergeI18nextJson({...table, entries: table.entries.map(e => e.key === 'title' ? {...e, review: ['tr']} : e)}, 'tr', {title: 'Selam', menu: {play: 'Oyna'}, 'bad key': 'x', n: 1});
 expect(first).toMatchObject({added: 0, updated: 2, skipped: ['bad key', 'n']});
 expect(first.table.entries.find(e => e.key === 'title')).toEqual({key: 'title', values: {en: 'Hello', tr: 'Selam', pt: 'Olá'}});
 const added = mergeI18nextJson(table, 'de', {title: 'Hallo'});
 expect(added.table.languages.at(-1)).toEqual({id: 'de', name: 'German'}); expect(added.added).toBe(0);
 expect(fileLanguage({name: 'pt-BR.json'})).toBe('pt-BR'); expect(fileLanguage({name: 'translation.json', folder: 'tr'})).toBe('tr');
 expect(() => fileLanguage({name: 'strings.json', folder: 'locales'})).toThrow('name the file after its language');
 expect(() => LocalizationSchema.parse({...table, entries: [{key: 'a', values: {}, review: ['xx']}]})).toThrow('not in the list');
});
it('knows plural categories and placeholders', () => {
 expect(pluralCategories('en')).toEqual(['one', 'other']);
 expect(pluralCategories('ru')).toEqual(expect.arrayContaining(['one', 'few', 'many', 'other']));
 expect(placeholders('Hi {{ name }}, $t(title) {{count}}')).toEqual(['$t(title)', '{{count}}', '{{name}}']);
});

it('turns a plain scene text into a key: object + first words, unique, reusing an existing identical text', async () => {
 const {localizeText, defaultLocalization} = await import('./localization');
 const a = localizeText(defaultLocalization, 'Start the game!', 'Play Button');
 expect(a.key).toBe('play_button.start_the_game');
 expect(a.next.entries).toEqual([{key: 'play_button.start_the_game', values: {en: 'Start the game!'}}]);
 expect(localizeText(a.next, 'Start the game!', 'Other').key).toBe('play_button.start_the_game');
 const b = localizeText(a.next, 'Start the game now', 'Play Button');
 expect(b.key).toBe('play_button.start_the_game_now');
 const c = localizeText({...a.next, entries: [...a.next.entries, {key: 'play_button.ok', values: {en: 'x'}}]}, 'OK', 'Play Button');
 expect(c.key).toBe('play_button.ok_2');
 expect(localizeText(defaultLocalization, 'Çıkış', '3D').key).toBe('t_3d.cikis');
 expect(() => localizeText(defaultLocalization, '  ', 'X')).toThrow();
});
