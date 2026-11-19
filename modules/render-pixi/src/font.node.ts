import {readFile, mkdir, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import type {BuildJob, BuildResult} from '@rewrite/assets/node';
import {FontMetadataSchema, fontFile, fontFormats} from './contracts';

/** Signatures by container: TrueType (0x00010000 or 'true'), OpenType CFF ('OTTO'), WOFF, WOFF2. */
const signatures: Record<typeof fontFormats[number], readonly string[]> = {ttf: ['00010000', '74727565'], otf: ['4f54544f', '00010000'], woff: ['774f4646'], woff2: ['774f4632']};
/** Fonts are copied unchanged after signature and checksum checks; no subsetting or conversion. */
export async function buildFont(job: BuildJob): Promise<BuildResult> {
 const {asset} = job, format = asset.source.extension as typeof fontFormats[number];
 if (job.importerId !== 'pixi.fonts' || asset.type !== 'font.face' || !fontFormats.includes(format)) throw Error('Unsupported font job');
 const bytes = await readFile(join(job.root, 'sources', `${asset.id}-${asset.revision}.${format}`));
 if (bytes.length !== asset.source.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.revision) throw Error('Font source checksum mismatch');
 if (bytes.length < 12 || bytes.length > 10 * 1024 * 1024) throw Error('Fonts must be between 12 bytes and 10 MB');
 if (!signatures[format].includes(bytes.subarray(0, 4).toString('hex'))) throw Error(`This file is not a valid ${format.toUpperCase()} font`);
 const metadata = FontMetadataSchema.parse({format, processedBytes: bytes.length, pipeline: 'font-original-v1'});
 const directory = join(job.root, 'cache', `${asset.id}-${asset.revision}`), name = fontFile(format), temporary = join(directory, `.${randomUUID()}.tmp`);
 await mkdir(directory, {recursive: true}); await writeFile(temporary, bytes); await rename(temporary, join(directory, name));
 return {metadata, files: [{name, mime: `font/${format}`}]};
}
