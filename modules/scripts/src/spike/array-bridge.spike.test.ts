import {expect, it} from 'vitest';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {loadScriptEngine} from '../session';
import {runBridge, type BridgeMethod} from './array-bridge';
// The bridge spike's Node run (timings vary by machine, so it only runs on request): SPIKE=1 pnpm vitest run modules/scripts/src/spike
// Writes outputs/spike-bridge/node.json. The Chrome run is scripts/fixtures/spike-bridge-chrome.mjs.
it.skipIf(!process.env.SPIKE)('measures getting particle data out of a script per frame', async () => {
 const engine = await loadScriptEngine(), results = [];
 for (const count of [1000, 4000]) for (const method of ['compute', 'json', 'buffer', 'calls'] as BridgeMethod[]) results.push(runBridge(engine, method, count));
 const sums = new Set(results.filter(r => r.method !== 'compute' && r.count === 4000).map(r => r.checksum));
 expect(sums.size).toBe(1);
 const dir = resolve(__dirname, '../../../../outputs/spike-bridge'); await mkdir(dir, {recursive: true});
 await writeFile(join(dir, 'node.json'), JSON.stringify({node: process.version, results}, null, 1) + '\n');
 console.table(results);
}, 120000);
