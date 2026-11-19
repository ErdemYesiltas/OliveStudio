import {expect, it} from 'vitest';
import {mkdir, mkdtemp, readdir, rm, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AssetSession, sweepSessions} from './session.node';

it('removes sessions of ended editors and old ownerless ones, keeps live ones and other folders', async () => {
 const parent = await mkdtemp(join(tmpdir(), 'sweep-'));
 try {
  const make = async (name: string, pid?: number, ageMs = 0) => { const dir = join(parent, name); await mkdir(dir); if (pid !== undefined) await writeFile(join(dir, 'owner.json'), JSON.stringify({pid})); const at = new Date(Date.now() - ageMs); await utimes(dir, at, at); };
  await make('session-dead', 111); await make('session-live', 222); await make('session-mine', process.pid);
  await make('session-legacyold', undefined, 8 * 86400000); await make('session-legacynew', undefined, 2 * 86400000); await make('other', 111);
  const live = await AssetSession.create(parent, [], async () => { throw Error('unused'); });
  expect(await sweepSessions(parent, {alive: pid => pid === 222})).toBe(2);
  expect((await readdir(parent)).sort()).toEqual(['other', 'session-legacynew', 'session-live', 'session-mine', live.root.split('/').pop()!].sort());
  await live.dispose();
  expect(await sweepSessions(join(parent, 'missing'))).toBe(0);
 } finally { await rm(parent, {recursive: true, force: true}); }
});
