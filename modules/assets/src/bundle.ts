import {z} from 'zod';

/**
 * Asset bundle manifest (version 1): textures, sprite sheets with frame size and named animation ranges, and sounds,
 * described next to their files. Paths are relative to the manifest and may not leave its folder tree. Importing a
 * bundle again replaces assets of the same name and type in place (same IDs, so scenes keep their references).
 */
export const sheetsSection = 'assets.sheets';
const RelativeFile = z.string().trim().min(1).max(300).refine(v => !/^([/\\]|[A-Za-z]:)/.test(v) && !v.includes('\\') && !v.split('/').some(p => p === '..' || p === '.' || p === ''), 'Use a path relative to the manifest, inside its folder (no "..", absolute paths or backslashes)');
const Name = z.string().trim().min(1).max(120);
const AnimationName = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/, 'Animation names use letters, digits, _ and - and start with a letter');
export const AnimationRangeSchema = z.object({from: z.number().int().min(0).max(4095), to: z.number().int().min(0).max(4095), fps: z.number().min(0.1).max(120).default(12), loop: z.boolean().default(true)}).strict().refine(v => v.to >= v.from, 'An animation range ends at or after its first frame');
export const BundleManifestSchema = z.object({
 version: z.literal(1),
 name: Name.optional(),
 textures: z.array(z.object({file: RelativeFile, name: Name.optional()}).strict()).max(200).default([]),
 sheets: z.array(z.object({file: RelativeFile, name: Name.optional(), frameWidth: z.number().int().min(1).max(4096), frameHeight: z.number().int().min(1).max(4096), frames: z.number().int().min(1).max(4096).optional(), animations: z.record(AnimationName, AnimationRangeSchema).refine(v => Object.keys(v).length <= 64, 'At most 64 animations per sheet').default({})}).strict()).max(100).default([]),
 sounds: z.array(z.object({file: RelativeFile, name: Name.optional()}).strict()).max(200).default([]),
}).strict().superRefine((m, c) => {
 const total = m.textures.length + m.sheets.length + m.sounds.length;
 if (!total) c.addIssue({code: 'custom', message: 'The manifest lists no files'});
 if (total > 300) c.addIssue({code: 'custom', message: 'A bundle lists at most 300 files'});
 const images = [...m.textures, ...m.sheets].map(e => e.name ?? stem(e.file)), sounds = m.sounds.map(e => e.name ?? stem(e.file));
 for (const [kind, names] of [['image', images], ['sound', sounds]] as const) { const dup = names.find((n, i) => names.indexOf(n) !== i); if (dup) c.addIssue({code: 'custom', message: `Two ${kind}s are named "${dup}" (names identify assets on reimport)`}); }
});
export type BundleManifest = z.infer<typeof BundleManifestSchema>;
/** The asset name an entry gets: its name, else the file name without extension. */
export const stem = (file: string) => (file.split('/').pop() ?? file).replace(/\.[^.]+$/, '').slice(0, 120) || 'Asset';

export const SheetSchema = z.object({frameWidth: z.number().int().min(1).max(4096), frameHeight: z.number().int().min(1).max(4096), columns: z.number().int().min(1).max(64), rows: z.number().int().min(1).max(64), frames: z.number().int().min(1).max(4096), animations: z.record(AnimationName, AnimationRangeSchema)}).strict();
export const SheetsSchema = z.object({version: z.literal(1), sheets: z.record(z.uuid(), SheetSchema)}).strict();
export type Sheet = z.infer<typeof SheetSchema>;

/** A sheet's grid from the image size: the image must divide into whole frames (at most 64 × 64) and ranges must fit. */
export function sheetGeometry(entry: BundleManifest['sheets'][number], size: {width?: unknown; height?: unknown}): {sheet?: Sheet; errors: string[]} {
 const width = Number(size.width), height = Number(size.height), label = entry.name ?? stem(entry.file), errors: string[] = [];
 if (!Number.isFinite(width) || !Number.isFinite(height)) return {errors: [`${label}: the image size is unknown`]};
 if (width % entry.frameWidth || height % entry.frameHeight) errors.push(`${label}: ${width}×${height} px does not divide into ${entry.frameWidth}×${entry.frameHeight} px frames`);
 const columns = Math.floor(width / entry.frameWidth), rows = Math.floor(height / entry.frameHeight);
 if (columns < 1 || rows < 1 || columns > 64 || rows > 64) errors.push(`${label}: a sheet has 1 to 64 columns and rows (this one: ${columns} × ${rows})`);
 const frames = entry.frames ?? columns * rows;
 if (frames > columns * rows) errors.push(`${label}: ${frames} frames do not fit a ${columns} × ${rows} grid`);
 for (const [name, range] of Object.entries(entry.animations)) if (range.to >= frames) errors.push(`${label}: animation ${name} ends at frame ${range.to}, but the sheet has frames 0–${frames - 1}`);
 return errors.length ? {errors} : {sheet: SheetSchema.parse({frameWidth: entry.frameWidth, frameHeight: entry.frameHeight, columns, rows, frames, animations: entry.animations}), errors};
}
/** Flipbook component data playing one named range of a sheet (size: one frame). */
export function flipbookData(assetId: string, sheet: Sheet, animation: string) {
 const range = sheet.animations[animation]; if (!range) throw Error(`No animation named ${animation}`);
 return {assetId, columns: sheet.columns, rows: sheet.rows, start: range.from, frames: range.to - range.from + 1, fps: range.fps, loop: range.loop, autoplay: true, width: sheet.frameWidth, height: sheet.frameHeight, anchorX: 0.5, anchorY: 0.5, alpha: 1};
}

/** Match by the manifest's unique image name as well as path: one image may define several grids. */
export function importedSheets(manifest:BundleManifest,entries:readonly {kind:string;file:string;name:string;asset:{id:string;metadata:unknown}}[]){
 const sheets=new Map<string,Sheet>(),errors:string[]=[];
 for(const sheet of manifest.sheets){const entry=entries.find(e=>e.kind==='sheet'&&e.file===sheet.file&&e.name===(sheet.name??stem(sheet.file)));if(!entry)throw Error(`${sheet.file}: missing sheet ${sheet.name??stem(sheet.file)} from import`);const g=sheetGeometry(sheet,entry.asset.metadata as {width?:unknown;height?:unknown});if(g.sheet)sheets.set(entry.asset.id,g.sheet);errors.push(...g.errors);}
 if(errors.length)throw Error(`Bundle refused, nothing was added: ${errors.join('; ')}`);
 return sheets;
}
