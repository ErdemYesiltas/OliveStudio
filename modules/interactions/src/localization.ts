import {z} from 'zod';
import i18next, {type i18n} from 'i18next';

/**
 * Project string table, run by i18next: languages and keyed texts (one `translation` namespace per language, flat keys;
 * dots are part of a key). Text components show `{@key}` in the current language; `{@key:name}` passes a number global
 * as `count` for plural forms (`key_one`, `key_other`… by the language's plural rules). Texts can use `{{name}}`
 * (game globals), `$t(otherKey)` nesting and i18next formatting. Missing texts fall back through the language chain
 * (pt-BR → pt) to the default language, then to the template itself. The `language.set` action switches at runtime.
 */
export const localizationSection = 'interactions.strings';
export const LanguageIdSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, 'Use a language code such as en, tr or pt-BR');
export const StringKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]{0,63}$/, 'Keys use letters, digits, _ and . and start with a letter');
export const LocalizationSchema = z.object({
 version: z.literal(1), defaultLanguage: LanguageIdSchema,
 languages: z.array(z.object({id: LanguageIdSchema, name: z.string().trim().min(1).max(60),
  /** Writing direction; absent: from the language code (ar, he, fa, ur… are right-to-left). */
  direction: z.enum(['ltr', 'rtl']).optional()}).strict()).min(1).max(64),
 entries: z.array(z.object({key: StringKeySchema, values: z.record(z.string(), z.string().max(10000)),
  /** Languages whose text was machine-translated and not reviewed yet (cleared when edited or approved). */
  review: z.array(LanguageIdSchema).max(64).optional(),
  /** Context for translators (where and how the text is used). */
  note: z.string().max(500).optional()}).strict()).max(5000),
}).strict().superRefine((v, c) => {
 const ids = new Set(v.languages.map(l => l.id));
 if (ids.size !== v.languages.length) c.addIssue({code: 'custom', message: 'Language codes must be unique'});
 if (!ids.has(v.defaultLanguage)) c.addIssue({code: 'custom', message: 'The default language must be in the list'});
 if (new Set(v.entries.map(e => e.key)).size !== v.entries.length) c.addIssue({code: 'custom', message: 'String keys must be unique'});
 if (v.entries.some(e => [...Object.keys(e.values), ...e.review ?? []].some(id => !ids.has(id)))) c.addIssue({code: 'custom', message: 'A string uses a language that is not in the list'});
});
export type Localization = z.infer<typeof LocalizationSchema>;
export const defaultLocalization: Localization = {version: 1, defaultLanguage: 'en', languages: [{id: 'en', name: 'English'}], entries: []};

/** Languages written right to left (base codes). */
export const rtlLanguages: ReadonlySet<string> = new Set(['ar', 'arc', 'azb', 'bal', 'ckb', 'dv', 'fa', 'glk', 'he', 'iw', 'ji', 'ks', 'lrc', 'mzn', 'nqo', 'ps', 'sd', 'syr', 'ug', 'ur', 'yi']);
/** The writing direction a language code implies (script subtags win: az-Arab is right to left, ku-Latn left to right). */
export function codeDirection(id: string): 'ltr' | 'rtl' {
 const parts = id.split('-'), script = parts.slice(1).find(p => /^[A-Za-z]{4}$/.test(p))?.toLowerCase();
 if (script) return ['arab', 'hebr', 'syrc', 'thaa', 'nkoo', 'adlm', 'rohg', 'mand', 'samr'].includes(script) ? 'rtl' : 'ltr';
 return rtlLanguages.has(parts[0].toLowerCase()) ? 'rtl' : 'ltr';
}
/** A table language's writing direction: its own setting, else from its code. */
export function languageDirection(table: Localization, id: string): 'ltr' | 'rtl' { return table.languages.find(l => l.id === id)?.direction ?? codeDirection(id); }
/** Best project language for a list of preferred locales (e.g. `navigator.languages`): exact, then base language. */
export function matchLanguage(table: Localization, preferred: readonly string[]): string {
 const ids = table.languages.map(l => l.id);
 for (const want of preferred) {
  const exact = ids.find(id => id.toLowerCase() === want.toLowerCase());
  if (exact) return exact;
  const base = ids.find(id => id.split('-')[0] === want.split('-')[0].toLowerCase());
  if (base) return base;
 }
 return table.defaultLanguage;
}
/** Interpolation values for a text: game globals by name, and `count` for plural forms. */
export type TextValues = Record<string, unknown>;
export interface LanguageStore {readonly language: string; /** Writing direction of the current language. */readonly direction: 'ltr' | 'rtl'; setLanguage(id: string): void; text(key: string, values?: TextValues): string | undefined; readonly i18n: i18n}
/** i18next resources of a table: `{lng: {translation: {key: text}}}` (empty texts are left out so they fall back). */
export function toResources(table: Localization) {
 const out: Record<string, {translation: Record<string, string>}> = Object.fromEntries(table.languages.map(l => [l.id, {translation: {}}]));
 for (const e of table.entries) for (const [lng, text] of Object.entries(e.values)) if (text) out[lng].translation[e.key] = text;
 return out;
}
/** A synchronous i18next instance for a table (no backend, no detection: the host picks the language). */
export function createI18n(table: Localization, lng = table.defaultLanguage): i18n {
 const instance = i18next.createInstance();
 void instance.init({resources: toResources(table), lng, fallbackLng: [table.defaultLanguage], keySeparator: false, nsSeparator: false, initAsync: false, returnEmptyString: false, returnNull: false, interpolation: {escapeValue: false}});
 return instance;
}
/** Runtime language state; `changed` lets the host re-render texts. */
export function createLanguageStore(input: Localization, initial = input.defaultLanguage, changed: () => void = () => {}): LanguageStore {
 const table = LocalizationSchema.parse(input), language = table.languages.some(l => l.id === initial) ? initial : table.defaultLanguage, i18n = createI18n(table, language);
 return {
  i18n,
  get language() { return i18n.language; },
  get direction() { return languageDirection(table, i18n.language); },
  setLanguage(id) { if (!table.languages.some(l => l.id === id)) throw Error(`Unknown language: ${id}`); if (id === i18n.language) return; void i18n.changeLanguage(id); changed(); },
  text(key, values) { return i18n.exists(key, values) ? i18n.t(key, values) : undefined; },
 };
}

/** Plural categories a language needs (`one`, `few`, `many`, `other`…), from the platform's plural rules. */
export const pluralCategories = (lng: string): string[] => { try { return [...new Intl.PluralRules(lng).resolvedOptions().pluralCategories]; } catch { return ['one', 'other']; } };
const pluralSuffix = /_(zero|one|two|few|many|other)$/;
/** `coins_one` → `coins` (the key a text uses), else the key itself. */
export const baseKey = (key: string) => key.replace(pluralSuffix, '');
/** `{{name}}` placeholders and `$t(key)` nestings of a text (a translation must keep them). */
export const placeholders = (text: string) => [...text.matchAll(/\{\{\s*([^}]+?)\s*\}\}|\$t\(([^)]+)\)/g)].map(m => m[0].replace(/\s+/g, '')).sort();
/** One i18next resource file (flat keys) for a language. */
export function toI18nextJson(table: Localization, lng: string): Record<string, string> {
 return Object.fromEntries(table.entries.filter(e => e.values[lng]).map(e => [e.key, e.values[lng]]));
}
/** Language name in English for a code (`tr` → `Turkish`). */
export const languageName = (id: string) => { try { return new Intl.DisplayNames(['en'], {type: 'language'}).of(id) ?? id.toUpperCase(); } catch { return id.toUpperCase(); } };
/**
 * Merges an i18next resource file (flat or nested; nested keys are joined with dots) into the table: the language is
 * added when missing, existing texts are replaced, keys the table cannot hold are reported. Imported texts are reviewed.
 */
export function mergeI18nextJson(input: Localization, lng: string, json: unknown): {table: Localization; added: number; updated: number; skipped: string[]} {
 LanguageIdSchema.parse(lng);
 if (!json || typeof json !== 'object' || Array.isArray(json)) throw Error(`${lng}: an i18next file is a JSON object`);
 const table = structuredClone(LocalizationSchema.parse(input)), flat: [string, unknown][] = [], skipped: string[] = [];
 const walk = (value: Record<string, unknown>, prefix: string, depth: number) => { for (const [k, v] of Object.entries(value)) { const key = prefix ? `${prefix}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v) && depth < 8) walk(v as Record<string, unknown>, key, depth + 1); else flat.push([key, v]); } };
 walk(json as Record<string, unknown>, '', 0);
 if (!table.languages.some(l => l.id === lng)) table.languages.push({id: lng, name: languageName(lng)});
 let added = 0, updated = 0;
 for (const [key, value] of flat) {
  if (typeof value !== 'string' || !StringKeySchema.safeParse(key).success || value.length > 10000) { skipped.push(key); continue; }
  let entry = table.entries.find(e => e.key === key);
  if (!entry) { if (table.entries.length >= 5000) { skipped.push(key); continue; } entry = {key, values: {}}; table.entries.push(entry); added++; } else if (entry.values[lng] !== value) updated++;
  entry.values[lng] = value;
  if (entry.review) { entry.review = entry.review.filter(id => id !== lng); if (!entry.review.length) delete entry.review; }
 }
 return {table: LocalizationSchema.parse(table), added, updated, skipped};
}
/** The language of an i18next file: `tr.json`, or the folder of `tr/translation.json`. */
export function fileLanguage(file: {name: string; folder?: string}) {
 const stem = file.name.replace(/\.json$/i, '');
 const id = LanguageIdSchema.safeParse(stem).success ? stem : file.folder && LanguageIdSchema.safeParse(file.folder).success ? file.folder : undefined;
 if (!id) throw Error(`${file.name}: name the file after its language (tr.json, pt-BR.json) or put it in a language folder (tr/translation.json)`);
 return id;
}

/** What the translator gets: single texts and plural groups (source forms by category, target categories wanted). */
export interface TranslateRequest {from:{id:string;name:string};to:{id:string;name:string};items:{key:string;text:string;note?:string}[];plurals:{base:string;forms:Record<string,string>;note?:string}[];categories:string[]}
export interface TranslateProgress {phase:'running'|'done'|'failed'|'cancelled';done:number;total:number;message?:string}
/** Texts of the default language that `to` lacks (plural groups need every plural category of `to`). */
export function missingTranslations(table:Localization,to:string):TranslateRequest{
 const src=table.defaultLanguage,name=(id:string)=>table.languages.find(l=>l.id===id)?.name??id,categories=pluralCategories(to);
 const items:TranslateRequest['items']=[],groups=new Map<string,{forms:Record<string,string>;note?:string}>();
 for(const e of table.entries){
  const text=e.values[src];if(!text)continue;
  const base=baseKey(e.key);
  if(base!==e.key){const g=groups.get(base)??{forms:{}};g.forms[e.key.slice(base.length+1)]=text;g.note??=e.note;groups.set(base,g);continue;}
  if(!e.values[to])items.push({key:e.key,text,...(e.note?{note:e.note}:{})});
 }
 const value=(key:string)=>table.entries.find(e=>e.key===key)?.values[to];
 const plurals=[...groups].filter(([base])=>categories.some(c=>!value(`${base}_${c}`))).map(([base,g])=>({base,forms:g.forms,...(g.note?{note:g.note}:{})}));
 return {from:{id:src,name:name(src)},to:{id:to,name:name(to)},items,plurals,categories};
}
/** Writes translations into the table, marked for review; a text that lost or changed its placeholders is refused. */
export function applyTranslations(input:Localization,request:TranslateRequest,result:Record<string,string>):{table:Localization;written:number;refused:string[]}{
 const table=structuredClone(input),to=request.to.id,refused:string[]=[];let written=0;
 const same=(a:string,b:string)=>JSON.stringify(placeholders(a).filter(p=>p!=='{{count}}'))===JSON.stringify(placeholders(b).filter(p=>p!=='{{count}}'));
 const put=(key:string,text:string,source:string)=>{
  if(!text.trim()||!same(source,text)||!StringKeySchema.safeParse(key).success){refused.push(key);return;}
  let entry=table.entries.find(e=>e.key===key);
  if(!entry){entry={key,values:{}};table.entries.push(entry);}
  entry.values[to]=text;entry.review=[...new Set([...entry.review??[],to])];written++;
 };
 for(const item of request.items){const text=result[item.key];if(text!==undefined)put(item.key,text,item.text);else refused.push(item.key);}
 for(const group of request.plurals)for(const c of request.categories){const key=`${group.base}_${c}`;if(table.entries.find(e=>e.key===key)?.values[to])continue;const text=result[key];if(text!==undefined)put(key,text,group.forms.other??Object.values(group.forms)[0]??'');else refused.push(key);}
 return {table:LocalizationSchema.parse(table),written,refused};
}

/** Letters without a decomposed form (Turkish dotless i, German sharp s…) mapped before stripping accents. */
const FOLD: Record<string, string> = {'ı': 'i', 'İ': 'i', 'ß': 'ss', 'ø': 'o', 'Ø': 'o', 'æ': 'ae', 'Æ': 'ae', 'ł': 'l', 'Ł': 'l', 'đ': 'd', 'Đ': 'd'};
const slug = (s: string, words: number) => s.replace(/[ıİßøØæÆłŁđĐ]/g, c => FOLD[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, words).join('_');
/**
 * Moves a plain scene text into the table: reuses the key whose default-language text is the same, else adds one
 * named after the object and the first words (`play_button.start_game`, made unique). Returns the table and the key
 * for `{@key}`.
 */
export function localizeText(table: Localization, text: string, objectName: string): {next: Localization; key: string} {
 const value = text.trim();
 if (!value) throw Error('The text is empty');
 const same = table.entries.find(e => e.values[table.defaultLanguage] === value);
 if (same) return {next: table, key: same.key};
 const keys = new Set(table.entries.map(e => e.key));
 let base = [slug(objectName, 3), slug(value, 4)].filter(Boolean).join('.').slice(0, 56) || 'text';
 if (!/^[A-Za-z_]/.test(base)) base = 't_' + base;
 let key = base;
 for (let n = 2; keys.has(key); n++) key = `${base}_${n}`;
 StringKeySchema.parse(key);
 const next = structuredClone(table);
 next.entries.push({key, values: {[table.defaultLanguage]: value}});
 return {next: LocalizationSchema.parse(next), key};
}
