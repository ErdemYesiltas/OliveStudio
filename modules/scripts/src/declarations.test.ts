import {expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import ts from 'typescript';
import {apiDeclarations, globalsDeclaration} from './contracts';
// The editor shows scripts against apiDeclarations (Monaco), but compiling only strips types, so a declaration that
// rejects valid code (a bundled example's script) slips through every other test. This compiles the Hub examples'
// scripts against the declarations with the editor's compiler options.
it('type-checks every Hub example script against the editor declarations', () => {
 const root = resolve(__dirname, '../../..'), dir = join(__dirname, '__declarations__');
 const catalog = JSON.parse(readFileSync(join(root, 'examples/catalog.json'), 'utf8')) as {examples: {id: string; file: string}[]};
 // The editor's own options (views.tsx: Monaco's typescriptDefaults), so this flags exactly what the editor would underline.
 const options: ts.CompilerOptions = {noEmit: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Node10, lib: ['lib.es2020.d.ts'], strict: false, noImplicitAny: false, isolatedModules: true, types: [], skipLibCheck: true};
 const base = ts.createCompilerHost(options), problems: string[] = [];let scripts = 0;
 // One program per project, as in the editor: the API, that project's typed globals, its scripts.
 for (const e of catalog.examples) {
  const project = JSON.parse(readFileSync(join(root, 'examples', e.file), 'utf8')) as {extensions: Record<string, {items?: {name: string; source: string; type?: string; initial?: unknown}[]}>};
  const items = project.extensions['scripts.library']?.items ?? [];
  if (!items.length) continue;
  const files = new Map<string, string>([[join(dir, 'api.d.ts'), apiDeclarations], [join(dir, 'globals.d.ts'), globalsDeclaration((project.extensions['interactions.globals']?.items ?? []) as {name: string; type: string; initial?: unknown}[])]]);
  for (const [k, s] of items.entries()) files.set(join(dir, `${e.id}-${k}.ts`), `// ${e.id}: ${s.name}\n${s.source}`);
  scripts += items.length;
  const host: ts.CompilerHost = {...base, getSourceFile: (name, version, ...rest) => files.has(name) ? ts.createSourceFile(name, files.get(name)!, version) : base.getSourceFile(name, version, ...rest), fileExists: name => files.has(name) || base.fileExists(name), readFile: name => files.get(name) ?? base.readFile(name)};
  for (const d of ts.getPreEmitDiagnostics(ts.createProgram([...files.keys()], options, host))) problems.push(`${d.file ? d.file.fileName.slice(dir.length + 1) : ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
 }
 expect(scripts).toBeGreaterThan(10);
 expect(problems).toEqual([]);
}, 60000);
