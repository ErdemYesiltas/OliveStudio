import {pickModel, stripThinking, type LmPort, type Message} from './contracts';

/** Texts to translate (single keys and plural groups), as the Localization panel sends them. */
export interface TranslationJob {
 from: {id: string; name: string}; to: {id: string; name: string};
 items: {key: string; text: string; note?: string}[];
 plurals: {base: string; forms: Record<string, string>; note?: string}[];
 /** Plural categories of the target language (`one`, `few`, `many`, `other`…). */
 categories: string[];
}
type Batch = {items: TranslationJob['items']; plurals: TranslationJob['plurals']};

/** Prompt for one batch: JSON in, JSON out, placeholders kept, one key per target plural category. */
export function translationMessages(job: TranslationJob, batch: Batch, guidance = ''): Message[] {
 const source: Record<string, unknown> = {};
 for (const item of batch.items) source[item.key] = item.note ? {text: item.text, note: item.note} : item.text;
 for (const group of batch.plurals) source[group.base] = {plural: group.forms, ...(group.note ? {note: group.note} : {})};
 const keys = [...batch.items.map(i => i.key), ...batch.plurals.flatMap(g => job.categories.map(c => `${g.base}_${c}`))];
 return [
  {role: 'system', content: [
   `You translate a video game's texts from ${job.from.name} (${job.from.id}) to ${job.to.name} (${job.to.id}).`,
   'Reply with one JSON object only (no code fence, no comments) whose keys are exactly the requested keys and whose values are the translations.',
   'Keep {{placeholders}}, $t(...) references and HTML-like tags exactly as written; translate the words around them.',
   'Write natural, short game interface language; keep the tone. A "note" explains where a text is used; never translate the note.',
   `Plural entries give the source forms by plural category; return one key per ${job.to.name} category: <key>_${job.categories.join(`, <key>_`)}, each using {{count}} where the number belongs.`,
   ...(guidance.trim() ? ['', 'Follow these instructions (project, translation skill):', guidance.trim()] : []),
  ].join('\n')},
  {role: 'user', content: `Requested keys: ${JSON.stringify(keys)}\nSource texts:\n${JSON.stringify(source, null, 1)}`},
 ];
}
/** The JSON object in a reply (code fences and thinking removed); string values of the requested keys only. */
export function parseTranslation(content: string, keys: readonly string[]): Record<string, string> {
 const text = stripThinking(content).replace(/```(?:json)?/gi, ''), start = text.indexOf('{'), end = text.lastIndexOf('}');
 if (start < 0 || end <= start) throw Error('The model did not reply with a JSON object');
 let parsed: unknown;
 try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { throw Error('The model replied with invalid JSON'); }
 if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('The model did not reply with a JSON object');
 const out: Record<string, string> = {};
 for (const key of keys) { const v = (parsed as Record<string, unknown>)[key]; if (typeof v === 'string' && v.trim()) out[key] = v.trim(); }
 return out;
}
/** Splits a job into batches of about `size` source texts (a plural group counts as one). */
export function batches(job: TranslationJob, size = 20): Batch[] {
 const all: ({item: TranslationJob['items'][number]} | {plural: TranslationJob['plurals'][number]})[] = [...job.items.map(item => ({item})), ...job.plurals.map(plural => ({plural}))], out: Batch[] = [];
 for (let i = 0; i < all.length; i += size) { const part = all.slice(i, i + size); out.push({items: part.flatMap(p => 'item' in p ? [p.item] : []), plurals: part.flatMap(p => 'plural' in p ? [p.plural] : [])}); }
 return out;
}

/**
 * Translates with the local LM Studio model, batch by batch (thinking off, low temperature). Keys the model leaves out
 * are simply missing from the result; the caller checks placeholders and marks everything for review.
 */
export async function translateStrings(port: LmPort, url: string, preferred: string, job: TranslationJob, guidance: string,
 onProgress: (p: {done: number; total: number}) => void, signal: AbortSignal): Promise<Record<string, string>> {
 const status = await port.status(url);
 if (!status.online) throw Error('LM Studio is not running on this computer. Start its server (Developer → Start server) and try again.');
 const model = pickModel(status.models, preferred);
 if (!model) throw Error('LM Studio has no language model');
 const total = job.items.length + job.plurals.length, result: Record<string, string> = {};
 let done = 0;
 onProgress({done, total});
 for (const batch of batches(job)) {
  if (signal.aborted) throw Error('Cancelled');
  const id = crypto.randomUUID(), cancel = () => { void port.cancel(id); };
  signal.addEventListener('abort', cancel, {once: true});
  try {
   const reply = await port.chat(url, id, {model, messages: translationMessages(job, batch, guidance), temperature: 0.2, maxTokens: 6000, reasoning: 'none'});
   Object.assign(result, parseTranslation(reply.content, [...batch.items.map(i => i.key), ...batch.plurals.flatMap(g => job.categories.map(c => `${g.base}_${c}`))]));
  } catch (error) { if (signal.aborted) throw Error('Cancelled'); throw error; }
  finally { signal.removeEventListener('abort', cancel); }
  done += batch.items.length + batch.plurals.length;
  onProgress({done, total});
 }
 return result;
}
