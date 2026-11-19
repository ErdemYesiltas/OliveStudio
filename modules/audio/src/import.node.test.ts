import {expect,it,afterEach} from 'vitest';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AssetSession} from '@rewrite/assets/node';
import {buildAudio} from './import.node';
import {audioImporter} from './contracts';
import {wav} from './test-fixtures';
const roots:string[]=[],sessions:AssetSession[]=[];
afterEach(async()=>{for(const s of sessions.splice(0))await s.dispose();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function setup(){const root=await mkdtemp(join(tmpdir(),'audio-import-'));roots.push(root);const session=await AssetSession.create(root,[audioImporter],job=>buildAudio(job));sessions.push(session);return{root,session};}
it('imports PCM WAV, exposes metadata and reopens from source-only sidecars',async()=>{const{root,session}=await setup(),file=join(root,'tone.wav');await writeFile(file,wav());const[a]=await session.importFiles([file],audioImporter.id);expect(a.metadata).toMatchObject({format:'wav',duration:1,sampleRate:22050,channels:1});expect((await session.read(a.id,a.revision,'audio.wav'))?.mime).toBe('audio/wav');const target=join(root,'project.pixieditor'),project={extensions:{'assets.registry':{version:1,items:[a]}}};await session.persist(target,project);const copy=(await setup()).session;await copy.restore(target,project);expect(copy.warnings).toEqual([]);expect(await copy.read(a.id,a.revision,'audio.wav')).not.toBeNull();});
it('parses real MP3 metadata and preserves GUID when reimporting a WAV as MP3',async()=>{const{root,session}=await setup(),file=join(root,'tone.wav'),mp3=join(root,'tone.mp3');await writeFile(file,wav());await writeFile(mp3,await readFile(new URL('../testdata/tone.mp3',import.meta.url)));const[a]=await session.importFiles([file],audioImporter.id),[b]=await session.importFiles([mp3],audioImporter.id,a);expect(b.id).toBe(a.id);expect(b.metadata).toMatchObject({format:'mp3',channels:1});expect(await session.read(b.id,b.revision,'audio.mp3')).not.toBeNull();expect(await session.read(a.id,a.revision,'audio.wav')).not.toBeNull();});
it('rejects disguised, truncated and unsupported audio without accepting records',async()=>{const{root,session}=await setup();for(const[name,bytes]of [['bad.wav',Buffer.from('not audio')],['false.mp3',wav()],['truncated.wav',wav().subarray(0,20)]]as const){const file=join(root,name);await writeFile(file,bytes);await expect(session.importFiles([file],audioImporter.id)).rejects.toThrow();}});
