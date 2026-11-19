// Copies the verified end-to-end HTML export into www/ and injects the spike probe.
// Produce the export with: REWRITE_RETAIN_DEMO=1 node scripts/example-smoke.mjs (from rewrite/).
import {createHash} from 'node:crypto';
import {cp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rewrite = resolve(here, '../..');
const args = process.argv.slice(2);
const loop = args.includes('--loop');
const from = resolve(args.find(a => !a.startsWith('--')) ?? join(rewrite, 'outputs/example-html'));
const www = join(here, 'www');
const expected = JSON.parse(await readFile(join(rewrite, 'examples/end-to-end/expected-export.json'), 'utf8'));
const actual = createHash('sha256').update(await readFile(join(from, 'project.json'))).digest('hex');
if (actual !== expected.projectJsonSha256) throw Error(`${from} is not the end-to-end example export (project.json ${actual})`);
await rm(www, {recursive: true, force: true});
await cp(from, www, {recursive: true});
await cp(join(here, 'probe.js'), join(www, 'probe.js'));
if (loop) {
  // Spike-only variant after the hash check: the first scene's clip loops, so a backgrounded app has audible audio to pause.
  const bundle = JSON.parse(await readFile(join(www, 'project.json'), 'utf8'));
  const source = bundle.project.scenes[0].entities.flatMap(e => e.components).find(c => c.type === 'audio.source');
  source.data.loop = true;
  await writeFile(join(www, 'project.json'), JSON.stringify(bundle));
}
const index = join(www, 'index.html');
const html = await readFile(index, 'utf8');
if (!html.includes('<title>')) throw Error('Unexpected player index.html');
await writeFile(index, html.replace('<title>', '<script src="./probe.js"></script><title>'));
console.log(`www/ ← ${from} (project.json ${actual.slice(0, 12)}…) + probe.js${loop ? ' + looping clip variant' : ''}`);
