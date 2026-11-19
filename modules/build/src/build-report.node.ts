import {readdir, readFile, stat, writeFile} from 'node:fs/promises';
import {join, relative, sep} from 'node:path';
import {deflateRawSync} from 'node:zlib';

export interface SizeReport {total: number; groups: {label: string; bytes: number; files: number}[]; largest: {path: string; bytes: number}[]}

async function files(dir: string, base = dir): Promise<{path: string; bytes: number}[]> {
 const out: {path: string; bytes: number}[] = [];
 for (const entry of await readdir(dir, {withFileTypes: true})) {
  const full = join(dir, entry.name);
  if (entry.isDirectory()) out.push(...await files(full, base));
  else if (entry.isFile()) out.push({path: relative(base, full).split(sep).join('/'), bytes: (await stat(full)).size});
 }
 return out;
}

/** What a build is made of: page, engine and runtimes, the game's assets, the project data, everything else. */
export function groupOf(path: string): string {
 if (/^(assets|game-assets|www\/(assets|game-assets))\//.test(path) && !/\.(js|mjs|wasm)$/.test(path)) return 'Game assets';
 if (/\.(js|mjs|wasm)$/.test(path)) return 'Engine and runtimes';
 if (/(^|\/)project\.json$/.test(path)) return 'Project data';
 if (/(^|\/)index\.html$|\.css$/.test(path)) return 'Page';
 return 'Other';
}

export async function sizeReport(dir: string): Promise<SizeReport> {
 const list = await files(dir), groups = new Map<string, {bytes: number; files: number}>();
 for (const f of list) { const g = groups.get(groupOf(f.path)) ?? {bytes: 0, files: 0}; g.bytes += f.bytes; g.files++; groups.set(groupOf(f.path), g); }
 return {
  total: list.reduce((n, f) => n + f.bytes, 0),
  groups: ['Engine and runtimes', 'Game assets', 'Project data', 'Page', 'Other'].flatMap(label => groups.has(label) ? [{label, ...groups.get(label)!}] : []),
  largest: [...list].sort((a, b) => b.bytes - a.bytes).slice(0, 5),
 };
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (data: Uint8Array) => { let c = 0xffffffff; for (const b of data) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/**
 * A ZIP of a folder with its files at the root (what itch.io and most web hosts expect): deflated entries, UTF-8 names,
 * no extra fields. Small enough to keep a dependency out of the build.
 */
export async function zipFolder(dir: string, out: string): Promise<{files: number; bytes: number}> {
 const list = (await files(dir)).sort((a, b) => a.path.localeCompare(b.path)), chunks: Buffer[] = [], central: Buffer[] = [];
 let offset = 0;
 for (const f of list) {
  const data = await readFile(join(dir, f.path)), packed = deflateRawSync(data, {level: 9}), useDeflate = packed.length < data.length, body = useDeflate ? packed : data;
  const name = Buffer.from(f.path, 'utf8'), crc = crc32(data), method = useDeflate ? 8 : 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8); local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
  const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(method, 10); entry.writeUInt32LE(0, 12); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
  chunks.push(local, name, body); central.push(entry, name); offset += 30 + name.length + body.length;
 }
 const directory = Buffer.concat(central), end = Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(list.length, 8); end.writeUInt16LE(list.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
 const zip = Buffer.concat([...chunks, directory, end]);
 await writeFile(out, zip);
 return {files: list.length, bytes: zip.length};
}
