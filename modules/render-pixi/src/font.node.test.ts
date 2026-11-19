import {expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildFont} from './font.node';

async function job(bytes: Buffer, extension: string) {
 const root = await mkdtemp(join(tmpdir(), 'font-')), id = randomUUID(), revision = createHash('sha256').update(bytes).digest('hex');
 await mkdir(join(root, 'sources'), {recursive: true});
 await writeFile(join(root, 'sources', `${id}-${revision}.${extension}`), bytes);
 return {root, importerId: 'pixi.fonts', asset: {id, name: 'Font', type: 'font.face', revision, source: {extension, bytes: bytes.length}, metadata: {}}};
}
it('copies fonts with a valid container signature and rejects others', async () => {
 const woff2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60, 1)]);
 const ok = await job(woff2, 'woff2');
 const result = await buildFont(ok);
 expect(result).toMatchObject({metadata: {format: 'woff2', processedBytes: 64}, files: [{name: 'font.woff2', mime: 'font/woff2'}]});
 expect(await readFile(join(ok.root, 'cache', `${ok.asset.id}-${ok.asset.revision}`, 'font.woff2'))).toEqual(woff2);
 const fake = await job(Buffer.concat([Buffer.from('PNG!'), Buffer.alloc(60)]), 'ttf');
 await expect(buildFont(fake)).rejects.toThrow('not a valid TTF font');
 const mislabelled = await job(woff2, 'woff');
 await expect(buildFont(mislabelled)).rejects.toThrow('not a valid WOFF font');
 for (const j of [ok, fake, mislabelled]) await rm(j.root, {recursive: true, force: true});
});
