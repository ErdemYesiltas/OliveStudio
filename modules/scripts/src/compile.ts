import {transform} from 'sucrase';

/**
 * TypeScript → the sandbox's JavaScript (CommonJS exports). Types are stripped, not checked (the editor shows type
 * errors); line numbers are preserved so runtime errors point at the source line. Imports are refused: a script only
 * sees the `game` API.
 */
export function compileScript(source: string, name = 'script'): {code: string; error?: string} {
 const imports = /^\s*import\s[^;]*?from\s|^\s*import\s*['"]|\brequire\s*\(/m.exec(source);
 if (imports) return {code: '', error: `${name}: line ${source.slice(0, imports.index).split('\n').length + (imports[0].startsWith('\n') ? 1 : 0)}: scripts cannot import modules; use the game API`};
 try {
  return {code: transform(source, {transforms: ['typescript', 'imports'], filePath: `${name}.ts`, production: true, disableESTransforms: true}).code};
 } catch (error) {
  const message = error instanceof Error ? error.message : String(error), at = /\((\d+):(\d+)\)/.exec(message);
  return {code: '', error: `${name}: ${at ? `line ${at[1]}: ` : ''}${message.replace(/\s*\(\d+:\d+\)\s*$/, '')}`};
 }
}

/** For each line (1-based index − 1): whether it starts in code, not inside a string, template literal or block comment. */
export function codeLineStarts(source: string): boolean[] {
 const starts = [true];
 let mode: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
 const braces: number[] = [];
 for (let i = 0; i < source.length; i++) {
  const c = source[i], n = source[i + 1];
  if (c === '\n') { if (mode === 'line') mode = 'code'; if (mode === 'single' || mode === 'double') mode = 'code'; starts.push(mode === 'code'); continue; }
  if (mode === 'code') {
   if (c === '/' && n === '/') { mode = 'line'; i++; } else if (c === '/' && n === '*') { mode = 'block'; i++; }
   else if (c === "'") mode = 'single'; else if (c === '"') mode = 'double'; else if (c === '`') mode = 'template';
   else if (c === '{') { if (braces.length) braces[braces.length - 1]++; }
   else if (c === '}') { if (braces.length) { if (braces[braces.length - 1] === 0) { braces.pop(); mode = 'template'; } else braces[braces.length - 1]--; } }
  } else if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i++; } }
  else if (mode === 'single' || mode === 'double') { if (c === '\\') i++; else if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"')) mode = 'code'; }
  else if (mode === 'template') { if (c === '\\') i++; else if (c === '`') mode = 'code'; else if (c === '$' && n === '{') { braces.push(0); mode = 'code'; i++; } }
 }
 return starts;
}
const identifier = /^[A-Za-z_$][\w$]*$/;
/** The binding targets of `a = 1, {b, c} = d, [e] = f` (left of each top-level `=`). */
function declarators(list: string): string[] {
 const out: string[] = []; let depth = 0, start = 0, inTarget = true;
 for (let i = 0; i <= list.length; i++) {
  const c = list[i];
  if (c === '(' || c === '{' || c === '[') depth++; else if (c === ')' || c === '}' || c === ']') depth--;
  if (depth === 0 && inTarget && (c === '=' && list[i + 1] !== '>' || c === ',' || c === undefined)) { out.push(list.slice(start, i)); inTarget = c === ','; start = i + 1; continue; }
  if (depth === 0 && !inTarget && c === ',') { inTarget = true; start = i + 1; }
 }
 return out.map(t => t.trim()).filter(Boolean);
}
/** Names declared up to a line (parameters, const/let/var, loop and catch variables): the locals a breakpoint shows. */
export function namesBefore(source: string, line: number): string[] {
 const text = source.split('\n').slice(0, line).join('\n'), names = new Set<string>();
 const add = (list: string) => { for (const part of list.replace(/[{}[\]]/g, ',').split(',')) { const name = part.split(/[:=]/)[0].replace(/^\.\.\./, '').trim(); if (identifier.test(name)) names.add(name); } };
 for (const m of text.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) add(m[1].replace(/:\s*[^,]+/g, ''));
 for (const m of text.matchAll(/\(([^()]*)\)\s*(?::\s*[^=]+)?=>/g)) add(m[1].replace(/:\s*[^,]+/g, ''));
 for (const m of text.matchAll(/\b(?:const|let|var)\s+([^;\n]+)/g)) for (const target of declarators(m[1])) add(target);
 for (const m of text.matchAll(/\bcatch\s*\(\s*([\w$]+)/g)) names.add(m[1]);
 return [...names].filter(n => !['self', 'game', 'globals', 'param', 'rx'].includes(n) || n === 'self').slice(0, 30);
}
/**
 * The script compiled with a debugger call at the start of each requested line that starts in code: the call can
 * read that line's scope (`eval` in a closure there). Lines where a call would not be valid are dropped.
 */
export function instrumentScript(source: string, name: string, scriptId: string, lines: readonly number[]): {code: string; lines: number[]; error?: string} {
 const starts = codeLineStarts(source), rows = source.split('\n');
 const candidates = [...new Set(lines)].filter(l => l >= 1 && l <= rows.length && starts[l - 1] && rows[l - 1].trim() && !/^\s*(\/\/|\*|\/\*)/.test(rows[l - 1])).sort((a, b) => a - b);
 const build = (keep: readonly number[]) => rows.map((row, i) => keep.includes(i + 1) ? row.replace(/^(\s*)/, `$1__bp(${JSON.stringify(scriptId)}, ${i + 1}, (__e) => eval(__e), ${JSON.stringify(namesBefore(source, i + 1))}); `) : row).join('\n');
 let keep = candidates.filter(l => !compileScript(build([l]), name).error);
 let result = compileScript(build(keep), name);
 if (result.error) { keep = []; result = compileScript(source, name); }
 return {code: result.code, lines: keep, ...(result.error ? {error: result.error} : {})};
}
