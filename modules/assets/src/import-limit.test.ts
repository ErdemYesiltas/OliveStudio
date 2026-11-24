import {expect, it} from 'vitest';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ImportPathsSchema, importFileLimit} from './contracts';
import {AssetSession} from './session.node';

it('uses one import limit in the automation schema with an actionable message', () => {
 expect(importFileLimit).toBe(16);
 expect(ImportPathsSchema.safeParse(Array.from({length: 16}, (_, i) => `/a/${i}.png`)).success).toBe(true);
 const over = ImportPathsSchema.safeParse(Array.from({length: 17}, (_, i) => `/a/${i}.png`));
 expect(over.success).toBe(false); expect(over.error?.issues[0].message).toBe('Import accepts 1 to 16 files per request (got 17); split the list into batches of 16');
 expect(ImportPathsSchema.safeParse([]).success).toBe(false);
});

it('refuses an over-limit or partly invalid request before importing anything', async () => {
 const root = await mkdtemp(join(tmpdir(), 'import-limit-'));
 let built = 0, session: AssetSession | undefined;
 try {
  const files = await Promise.all(Array.from({length: 17}, async (_, i) => { const file = join(root, `f${i}.bin`); await writeFile(file, `data ${i}`); return file; }));
  await writeFile(join(root, 'bad.txt'), 'x');
  session = await AssetSession.create(join(root, 'sessions'), [{id: 'test', assetType: 'test.data', extensions: ['bin']}], async () => { built++; return {metadata: {}, files: []}; });
  await expect(session.importFiles(files, 'test')).rejects.toThrow('got 17');
  await expect(session.importFiles([files[0], join(root, 'bad.txt')], 'test')).rejects.toThrow('Unsupported source extension');
  await expect(session.importFiles([files[0], join(root, 'missing.bin')], 'test')).rejects.toThrow();
  expect(built).toBe(0);
  expect((await session.importFiles(files.slice(0, 16), 'test'))).toHaveLength(16);
  expect(built).toBe(16);
 } finally { await session?.dispose(); await rm(root, {recursive: true, force: true}); }
});

it('rolls back staged source files and records without deleting earlier imports',async()=>{
 const root=await mkdtemp(join(tmpdir(),'import-lease-'));
 let session:AssetSession|undefined;
 try{
  const file=join(root,'a.bin');await writeFile(file,'original');
  session=await AssetSession.create(join(root,'sessions'),[{id:'test',assetType:'test.data',extensions:['bin']}],async()=>({metadata:{},files:[]}));
  const [old]=await session.importFiles([file],'test');
  const rollback=await session.importLease();
  await writeFile(file,'replacement');await session.importFiles([file],'test',old);
  const {readdir}=await import('node:fs/promises');
  expect(await readdir(join(session.root,'sources'))).toHaveLength(2);
  await rollback();await rollback();
  expect(await readdir(join(session.root,'sources'))).toHaveLength(1);
  expect(await session.inspect({extensions:{'assets.registry':{version:1,items:[old]}}})).toMatchObject([{source:'ready'}]);
 }finally{await session?.dispose();await rm(root,{recursive:true,force:true});}
});
