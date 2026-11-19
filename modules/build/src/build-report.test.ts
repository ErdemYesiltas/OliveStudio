import {expect, it} from 'vitest';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {groupOf, sizeReport, zipFolder} from './build-report.node';

it('groups a build by what it is made of and zips it with the files at the root', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'build-report-'));
 try {
  await mkdir(join(dir, 'assets/hero'), {recursive: true});
  await writeFile(join(dir, 'index.html'), '<title>x</title>');
  await writeFile(join(dir, 'player-abc.js'), 'x'.repeat(5000));
  await writeFile(join(dir, 'project.json'), '{}');
  await writeFile(join(dir, 'assets/hero/image.webp'), Buffer.alloc(900, 7));
  expect(groupOf('www/assets/a/b.png')).toBe('Game assets');
  expect(groupOf('www/project.json')).toBe('Project data');
  const report = await sizeReport(dir);
  expect(report.total).toBe(16 + 5000 + 2 + 900);
  expect(report.groups.map(g => [g.label, g.bytes])).toEqual([['Engine and runtimes', 5000], ['Game assets', 900], ['Project data', 2], ['Page', 16]]);
  expect(report.largest[0]).toEqual({path: 'player-abc.js', bytes: 5000});
  const out = join(dir, '..', `zip-${Date.now()}.zip`);
  const zipped = await zipFolder(dir, out);
  expect(zipped.files).toBe(4);
  expect(zipped.bytes).toBeLessThan(report.total);
  const listing = execFileSync('unzip', ['-Z1', out], {encoding: 'utf8'}).trim().split('\n').sort();
  expect(listing).toEqual(['assets/hero/image.webp', 'index.html', 'player-abc.js', 'project.json']);
  expect(execFileSync('unzip', ['-p', out, 'player-abc.js'], {encoding: 'utf8'})).toBe('x'.repeat(5000));
  execFileSync('unzip', ['-tq', out]);
  await rm(out, {force: true});
 } finally { await rm(dir, {recursive: true, force: true}); }
});
