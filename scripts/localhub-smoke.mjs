import {freePort} from './helpers/mcp-fixture.mjs';
// LocalHub in the AI panel against a fake hub (self-signed HTTPS, pinned): pairing (wrong code, wrong certificate —
// nothing reaches that server — then the right invite), generation as hub jobs (sprite with hints and cut-out, edit of
// the selected sprite, sound, a voice line answered as Ogg and imported as WAV, sprite sheet and video animations
// reviewed and packed, a video remix, cancel), the assistant chatting through the hub (tools, generate_asset, hub MCP
// tools), a permission change and a revoked device from the event stream, and the direct connection.
import {_electron as electron, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {X509Certificate} from 'node:crypto';
import {createServer} from 'node:https';
import {mkdtemp, readFile, rm,mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-localhub-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;

// PNG and WAV without libraries ---------------------------------------------------------------------------------------
const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
function png(width, height, pixel) {
 const raw = Buffer.alloc((width * 4 + 1) * height);
 for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
 const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 6;
 return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** A subject on a plain white background (the cut-out removes the white). */
const sprite = (w, h, color) => png(w, h, (x, y) => (x - w / 2) ** 2 + (y - h / 2) ** 2 < (Math.min(w, h) / 3) ** 2 ? [...color, 255] : [255, 255, 255, 255]);
const palette = [[220, 40, 40], [40, 180, 60], [40, 80, 220], [230, 190, 30], [160, 60, 200], [30, 190, 190], [240, 120, 20], [90, 90, 90]];
const sheet = (columns, rows, cell) => png(columns * cell, rows * cell, (x, y) => { const i = Math.floor(y / cell) * columns + Math.floor(x / cell), cx = x % cell - cell / 2, cy = y % cell - cell / 2; return cx * cx + cy * cy < (cell / 3) ** 2 ? [...palette[i % palette.length], 255] : [255, 255, 255, 255]; });
function wav(seconds = 0.5, rate = 22050) {
 const n = Math.round(seconds * rate), data = Buffer.alloc(n * 2);
 for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 440) * 12000), i * 2);
 const head = Buffer.alloc(44); head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
 return Buffer.concat([head, data]);
}

// Fake LocalHub --------------------------------------------------------------------------------------------------------
function certificate(dir) {
 execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=LocalHub', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], {stdio: 'ignore'});
 const cert = readFileSync(join(dir, 'cert.pem'));
 return {key: readFileSync(join(dir, 'key.pem')), cert, fingerprint: new X509Certificate(cert).fingerprint256.replace(/:/g, '').toLowerCase()};
}
const TOKEN = 'T'.repeat(43);
const hub = {requests: [], scopes: ['chat', 'image.create', 'image.edit', 'audio.create', 'audio.speech', 'video.create', 'video.edit', 'mcp:files'], jobs: new Map(), files: new Map(), streams: new Set(), slow: false, video: null, seq: 0};
const models = [['lmstudio/fake-qwen', ['chat']], ['comfyui/sdxl', ['image.create']], ['comfyui/flux-edit', ['image.edit']], ['comfyui/stable-audio', ['audio.create']], ['comfyui/kokoro', ['audio.speech']], ['comfyui/wan', ['video.create', 'video.edit']]];
const json = (res, status, body) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(body)); };
const fail = (res, status, code, message) => json(res, status, {error: {code, message}});
const emit = (event, data) => { for (const s of hub.streams) s.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
const file = (bytes, mime, filename, source = 'job') => { const id = `file-${++hub.seq}`; hub.files.set(id, {id, object: 'file', bytes: bytes.length, filename, mime_type: mime, purpose: source === 'job' ? 'output' : 'reference', source, created_at: Math.floor(Date.now() / 1000) + hub.seq, data: bytes}); return id; };
/** A job that queues, runs with a preview and finishes with `outputs()` (unless cancelled or slow). */
function job(capability, model, outputs, kind = 'job') {
 const id = `job-${++hub.seq}`, j = {id, object: 'job', status: 'queued', capability, model, output_file_ids: [], created_at: Math.floor(Date.now() / 1000), queue_position: 1, kind};
 hub.jobs.set(id, j);
 const update = patch => { if (j.status === 'cancelled') return; Object.assign(j, patch); emit('job', j); };
 setTimeout(() => update({status: 'in_progress', progress: 0.5, current_node: 'KSampler 10/20', eta_seconds: 3, has_preview: true, queue_position: undefined}), 300);
 if (!hub.slow) setTimeout(() => update({status: 'completed', progress: 1, has_preview: false, output_file_ids: outputs()}), 1200);
 return j;
}
const asVideo = j => ({id: j.id, object: 'video', status: j.status === 'cancelled' ? 'failed' : j.status, progress: Math.round((j.progress ?? 0) * 100), created_at: j.created_at, model: j.model, ...(j.output_file_ids[0] ? {file_id: j.output_file_ids[0]} : {})});
function multipartFields(body, type) {
 const boundary = /boundary=(.+)$/.exec(type)?.[1], out = {};
 for (const part of body.toString('latin1').split(`--${boundary}`)) { const name = /name="([^"]+)"/.exec(part)?.[1]; if (!name) continue; const value = part.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''); out[name] = /filename=/.test(part) ? {file: true, bytes: value.length, filename: /filename="([^"]*)"/.exec(part)[1], type: /Content-Type: ([^\r\n]+)/i.exec(part)?.[1] ?? '', data: Buffer.from(value, 'latin1')} : value; }
 return out;
}
const chatReply = (res, body) => {
 res.writeHead(200, {'Content-Type': 'text/event-stream'});
 const send = v => res.write(`data: ${JSON.stringify(v)}\n\n`), done = () => res.end('data: [DONE]\n\n');
 const text = value => { for (const part of value.match(/.{1,10}/g)) send({choices: [{delta: {content: part}}]}); send({choices: [{delta: {}, finish_reason: 'stop'}]}); done(); };
 const calls = list => { list.forEach((c, i) => send({choices: [{delta: {tool_calls: [{index: i, id: `call_${i}`, function: {name: c.name, arguments: JSON.stringify(c.args)}}]}}]})); send({choices: [{delta: {}, finish_reason: 'tool_calls'}]}); done(); };
 if (!body.tools) return text('glowing hub crystal, game sprite, plain background');
 const last = body.messages.at(-1), user = [...body.messages].reverse().find(m => m.role === 'user')?.content ?? '';
 if (last.role === 'user' && /hub star/.test(last.content)) return calls([{name: 'add_object', args: {item: 'pixi.star', name: 'Hub star', x: 200, y: 150}}]);
 if (last.role === 'user' && /coin/.test(last.content)) return calls([{name: 'generate_asset', args: {kind: 'image', prompt: 'gold coin', width: 256, height: 256}}]);
 if(last.role==='tool'&&/coin/.test(user)){const value=JSON.parse(last.content);if(value.ok&&value.result?.id&&['running','awaiting_approval'].includes(value.result.state))return calls([{name:'automation__job',args:{id:value.result.id,waitMs:2000}}]);return text(value.ok&&value.result?.state!=='failed'?'Made a coin through LocalHub.':`Failed: ${value.error??value.result?.error?.message}`);}
 if (last.role === 'tool') return text('Added a star through LocalHub.');
 return text('OK');
};
let app, server, decoy;
try {
 const {key, cert, fingerprint} = certificate(temp);
 server = createServer({key, cert}, (req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
   const body = Buffer.concat(chunks), url = new URL(req.url, 'https://hub'), path = url.pathname;
   const entry = {method: req.method, path, auth: req.headers.authorization ?? '', prefer: req.headers.prefer ?? '', type: req.headers['content-type'] ?? ''};
   try { entry.json = body.length && /json/.test(entry.type) ? JSON.parse(body.toString()) : undefined; } catch { /* not JSON */ }
   if (/multipart/.test(entry.type)) entry.fields = multipartFields(body, entry.type);
   hub.requests.push(entry);
   if (path === '/v2/hub') return json(res, 200, {service: 'localhub', version: '0.1.0', protocolVersion: 2, id: 'hub-fake', name: 'Fake Hub'});
   if (path === '/v2/pair' && req.method === 'POST') {
    if (entry.json.code !== '123456') return fail(res, 401, 'wrong_code', 'Wrong pairing code');
    return json(res, 200, {deviceID: 'device-1', token: TOKEN, scopes: (entry.json.scopes ?? []).filter(s => hub.scopes.includes(s))});
   }
   if (entry.auth !== `Bearer ${TOKEN}`) return fail(res, 401, 'unauthorized', 'Unknown device');
   if (path === '/v2/session' && req.method === 'GET') return json(res, 200, {deviceID: 'device-1', name: 'OliveStudio', app: 'olive-studio', scopes: hub.scopes});
   if (path === '/v2/session' && req.method === 'DELETE') { res.writeHead(204); return res.end(); }
   if (path === '/v1/models') return json(res, 200, {object: 'list', data: models.map(([id, capabilities]) => ({id, object: 'model', owned_by: 'local', provider: id.split('/')[0], upstream_id: id, capabilities, ...(id.startsWith('lmstudio') ? {loaded: true} : {})}))});
   if (path === '/v2/integrations') return json(res, 200, [{id: 'lmstudio', name: 'LM Studio', kind: 'openai', state: 'running', capabilities: ['chat']}, {id: 'comfyui', name: 'ComfyUI', kind: 'comfyui', state: 'running', capabilities: ['image.create'], detail: '12.0 GB free'}]);
   if (path === '/v2/mcp/servers') return json(res, 200, [{id: 'files', transport: 'stdio', allowedTools: ['read_file']}]);
   if (path === '/v2/events') { res.writeHead(200, {'Content-Type': 'text/event-stream'}); res.write(': ping\n\n'); hub.streams.add(res); res.on('close', () => hub.streams.delete(res)); return; }
   if (path === '/v1/chat/completions') return chatReply(res, entry.json);
   if (path === '/v1/images/generations') {
    if (!hub.scopes.includes('image.create')) return fail(res, 403, 'forbidden', 'Device may not use image.create');
    const sheetGrid = /sprite sheet of (\d+) animation frames.*?(\d+)x(\d+) grid/.exec(entry.json.prompt);
    const j = job('image.create', entry.json.model ?? 'comfyui/sdxl', () => [file(sheetGrid ? sheet(Number(sheetGrid[2]), Number(sheetGrid[3]), 64) : sprite(96, 96, [40, 160, 220]), 'image/png', 'out.png')]);
    return json(res, entry.prefer.includes('respond-async') ? 202 : 200, j);
   }
   if (path === '/v1/images/edits') return json(res, 202, job('image.edit', 'comfyui/flux-edit', () => [file(sprite(96, 96, [200, 60, 60]), 'image/webp' === 'x' ? 'image/webp' : 'image/png', 'edit.png')]));
   if (path === '/v1/audio/generations') return json(res, 202, job('audio.create', 'comfyui/stable-audio', () => [file(wav(), 'audio/wav', 'sound.wav')]));
   if (path === '/v1/audio/speech') { res.writeHead(200, {'Content-Type': 'audio/ogg'}); return res.end(wav(0.4)); }
   const meta = f => { const {data: _data, ...rest} = f; return rest; };
   if (path === '/v1/files' && req.method === 'POST') { const f = entry.fields.file; return json(res, 200, meta(hub.files.get(file(f.data, f.type, f.filename, 'upload')))); }
   if (path === '/v1/files' && req.method === 'GET') return json(res, 200, {object: 'list', data: [...hub.files.values()].map(meta)});
   if (path === '/v1/videos' && req.method === 'POST') return json(res, 200, asVideo(job('video.create', 'comfyui/wan', () => [file(hub.video ?? Buffer.alloc(0), 'video/webm', 'clip.webm')], 'video')));
   let m = /^\/v1\/videos\/([\w-]+)\/remix$/.exec(path);
   if (m) return json(res, 200, asVideo(job('video.edit', 'comfyui/wan', () => [file(hub.video ?? Buffer.alloc(0), 'video/webm', 'remix.webm')], 'video')));
   m = /^\/v1\/jobs\/([\w-]+)(\/cancel|\/preview)?$/.exec(path);
   if (m) {
    const j = hub.jobs.get(m[1]);
    if (!j) return fail(res, 404, 'not_found', 'No such job');
    if (m[2] === '/cancel') { j.status = 'cancelled'; emit('job', j); return json(res, 200, j); }
    if (m[2] === '/preview') { if (!j.has_preview) return fail(res, 404, 'not_found', 'No preview'); res.writeHead(200, {'Content-Type': 'image/png'}); return res.end(sprite(32, 32, [0, 0, 0])); }
    return json(res, 200, j);
   }
   m = /^\/v1\/files\/([\w-]+)(\/content)?$/.exec(path);
   if (m && req.method === 'DELETE') { hub.files.delete(m[1]); res.writeHead(204); return res.end(); }
   if (m) { const f = hub.files.get(m[1]); if (!f) return fail(res, 404, 'not_found', 'No such file'); if (m[2]) { res.writeHead(200, {'Content-Type': f.mime_type}); return res.end(f.data); } return json(res, 200, meta(f)); }
   fail(res, 404, 'not_found', `No route ${path}`);
  });
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const port = server.address().port, invite = code => `localhub://pair?v=2&u=https://127.0.0.1:${port}&fp=${fingerprint}&c=${code}&id=hub-fake&n=Fake%20Hub`;
 // A second hub with another certificate: the pin check must refuse it before any HTTP byte.
 const other = certificate(await mkdtemp(join(tmpdir(), 'rewrite-localhub-decoy-'))), decoyRequests = [];
 decoy = createServer({key: other.key, cert: other.cert}, (req, res) => { decoyRequests.push(req.url); res.end('{}'); });
 await new Promise(r => decoy.listen(0, '127.0.0.1', r));

 const mcpPort=await freePort(),mcpToken='localhub-mcp-test-token-0123456789abcdef';await mkdir(join(temp,'user'),{recursive:true});await writeFile(join(temp,'user','mcp.json'),JSON.stringify({enabled:true,port:mcpPort,token:mcpToken}));
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', '--localhub-memory', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);
 const projectFile = join(temp, 'hub.pixieditor');
 const save = async () => { await app.evaluate(({dialog}, target) => { dialog.showSaveDialog = async () => ({canceled: false, filePath: target}); }, projectFile); await menu('Save'); await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0); await expect.poll(() => readFile(projectFile, 'utf8').then(() => true, () => false)).toBe(true); return JSON.parse(await readFile(projectFile, 'utf8')); };
 const assetCount = async () => (await save()).extensions['assets.registry']?.items.length ?? 0;
 const tab = name => panel.getByRole('tab', {name, exact: true}).click();

 // Unpaired: the AI panel offers pairing and the direct Generate view.
 await page.keyboard.press('Alt+KeyA');
 const panel = page.getByTestId('ai-panel');
 await expect(panel).toHaveAttribute('data-tab', 'create');
 await expect(panel).toHaveAttribute('data-connection', 'direct');
 await expect(panel.getByTestId('hub-pair')).not.toHaveAttribute('open');
 await expect(panel.getByTestId('generate-panel')).toBeVisible();
 await panel.getByText('Connect LocalHub…', {exact: true}).click();
 const inviteBox = panel.getByRole('textbox', {name: 'Invite', exact: true}), pairButton = panel.getByTestId('hub-pair').getByRole('button', {name: 'Pair', exact: true}).first();
 // Wrong code, then a hub whose certificate does not match the invite (no request reaches it).
 await inviteBox.fill(invite('000000')); await pairButton.click();
 await expect(panel.getByTestId('hub-pair-error')).toContainText('Wrong pairing code');
 await inviteBox.fill(`localhub://pair?v=2&u=https://127.0.0.1:${decoy.address().port}&fp=${fingerprint}&c=123456`); await pairButton.click();
 await expect(panel.getByTestId('hub-pair-error')).toContainText('certificate changed');
 expect(decoyRequests).toEqual([]);
 // Pair: the token stays in the main process; the panel switches to LocalHub (Automatic).
 await inviteBox.fill(invite('123456')); await pairButton.click();
 await expect(panel.getByTestId('hub-connection')).toHaveAttribute('data-online', 'true');
 await expect(panel.getByTestId('hub-status')).toContainText('Fake Hub');
 await expect(panel).toHaveAttribute('data-connection', 'localhub');
 const pairRequest = hub.requests.find(r => r.path === '/v2/pair' && r.json.code === '123456');
 expect(pairRequest.json).toMatchObject({app: 'olive-studio', scopes: ['chat', 'image.create', 'image.edit', 'audio.create', 'audio.edit', 'audio.speech', 'video.create', 'video.edit']});
 expect(pairRequest.auth).toBe('');
 expect(await page.evaluate(token => document.documentElement.outerHTML.includes(token) || JSON.stringify(localStorage).includes(token), TOKEN)).toBe(false);
 await expect.poll(() => hub.streams.size).toBe(1);

 // Sprite: hint + size + random seed; a job with progress; the result lands in the Library without its white background.
 const create = panel.getByTestId('hub-create');
 await expect(create).toBeVisible();
 await expect(create.getByRole('combobox', {name: 'Model', exact: true}).locator('option')).toHaveText(["Mac's default", 'comfyui/sdxl']);
 const prompt = create.getByRole('textbox', {name: 'Prompt', exact: true});
 await prompt.fill('blue slime');
 await create.getByRole('combobox', {name: 'Size', exact: true}).selectOption({label: '1:1 · 512×512'});
 const before = await assetCount();
 await create.getByTestId('hub-generate').click();
 await expect(create.getByTestId('jobs-summary')).toContainText('1 running');
 await expect(panel.locator('.ai-badge')).toHaveText('1');
 await expect(create.locator('.generate-result[data-kind="image"]')).toHaveCount(1, {timeout: 20000});
 const sent = hub.requests.find(r => r.path === '/v1/images/generations');
 expect(sent.prefer).toContain('respond-async');
 expect(sent.json).toMatchObject({prompt: 'blue slime, single game sprite, centered, full view, plain flat background', size: '512x512', negative_prompt: 'blurry, low quality, watermark, text'});
 expect(sent.json.model).toBeUndefined();
 expect(Number.isInteger(sent.json.seed)).toBe(true);
 await panel.screenshot({path: join(root, 'outputs/localhub-create.png')});
 let saved = await save();
 expect(saved.extensions['assets.registry'].items.length).toBe(before + 1);
 expect(saved.extensions['ai-comfy.generations'].items.at(-1)).toMatchObject({workflow: 'LocalHub · image.create', purpose: 'image.sprite', kind: 'image'});
 // Cut-out: the corner of the imported image is transparent.
 const corner = await page.evaluate(async () => { const img = document.querySelector('.generate-result[data-kind="image"] img'); const bmp = await createImageBitmap(await (await fetch(img.src)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return x.getImageData(1, 1, 1, 1).data[3]; });
 expect(corner).toBe(0);

 // Place it, select it and edit it (the sprite goes to the hub as a multipart image).
 await create.locator('.generate-result[data-kind="image"]').getByRole('button', {name: /^Place /}).click();
 await create.getByRole('radio', {name: 'Edit selected', exact: true}).click();
 await expect(create.getByTestId('generate-input-image')).toContainText('Input image: blue-slime');
 await prompt.fill('make it red');
 await create.getByTestId('hub-generate').click();
 await expect(create.locator('.generate-result[data-kind="image"]')).toHaveCount(2, {timeout: 20000});
 const edit = hub.requests.find(r => r.path === '/v1/images/edits');
 expect(edit.fields).toMatchObject({prompt: 'make it red', strength: '0.6'});
 expect(edit.fields.image.file).toBe(true);
 expect(edit.prefer).toContain('respond-async');

 // Sound effect, then a voice line answered as Ogg: decoded and imported as WAV.
 await create.getByRole('tab', {name: 'Audio', exact: true}).click();
 await prompt.fill('coin pickup');
 await create.getByTestId('hub-generate').click();
 await expect(create.locator('.generate-result[data-kind="audio"]')).toHaveCount(1, {timeout: 20000});
 expect(hub.requests.find(r => r.path === '/v1/audio/generations').json).toMatchObject({seconds: 2, prompt: 'coin pickup, short game sound effect, clean, no music'});
 await create.getByRole('radio', {name: 'Voice line', exact: true}).click();
 await create.getByRole('textbox', {name: 'Line to speak', exact: true}).fill('Welcome, traveller.');
 await create.getByRole('textbox', {name: 'Voice', exact: true}).fill('alloy');
 await create.getByTestId('hub-generate').click();
 await expect(create.locator('.generate-result[data-kind="audio"]')).toHaveCount(2, {timeout: 20000});
 expect(hub.requests.find(r => r.path === '/v1/audio/speech').json).toEqual({input: 'Welcome, traveller.', voice: 'alloy'});
 saved = await save();
 expect(saved.extensions['assets.registry'].items.filter(a => a.type === 'audio.clip').map(a => a.metadata?.format)).toEqual(['wav', 'wav']);

 // Sprite sheet: the hub returns one grid image; the job waits for review, frames are packed into an Animated sprite.
 await create.getByRole('tab', {name: 'Image', exact: true}).click();
 await create.getByRole('radio', {name: 'Sprite sheet', exact: true}).click();
 await create.getByRole('spinbutton', {name: 'Frames', exact: true}).fill('8');
 await create.getByRole('spinbutton', {name: 'Columns', exact: true}).fill('4');
 await prompt.fill('bouncing ball');
 await create.getByTestId('hub-generate').click();
 await tab('Jobs');
 const jobs = panel.getByTestId('hub-jobs'), sheetJob = jobs.locator('[data-job][data-kind="animation"]').first();
 await expect(sheetJob).toHaveAttribute('data-state', 'completed', {timeout: 20000});
 await expect(sheetJob.getByTestId('job-state')).toHaveText('Ready to review');
 await sheetJob.getByRole('button', {name: /^Review frames/}).click();
 await tab('Create');
 const frames = panel.getByTestId('animation-frames');
 await expect(frames.locator('.generate-frame')).toHaveCount(8);
 await frames.getByRole('checkbox', {name: 'Use frame 8', exact: true}).uncheck();
 await frames.getByRole('button', {name: 'Create animation', exact: true}).click();
 await expect(frames).toHaveCount(0);
 saved = await save();
 const flip = saved.scenes.flatMap(s => s.entities).flatMap(e => e.components).filter(c => c.type === 'pixi.flipbook');
 expect(flip.at(-1).data).toMatchObject({frames: 7, columns: 4});

 // Video: recorded in the page (no ffmpeg needed), decoded to frames, packed; then remixed on the hub.
 hub.video = Buffer.from(await page.evaluate(async () => {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; const ctx = canvas.getContext('2d');
  const recorder = new MediaRecorder(canvas.captureStream(20), {mimeType: 'video/webm;codecs=vp8'}), parts = [];
  recorder.ondataavailable = e => parts.push(e.data); const stopped = new Promise(r => { recorder.onstop = r; });
  recorder.start(); for (let i = 0; i < 16; i++) { ctx.fillStyle = `hsl(${i * 22}, 80%, 50%)`; ctx.fillRect(0, 0, 64, 64); await new Promise(r => setTimeout(r, 60)); } recorder.stop(); await stopped;
  return [...new Uint8Array(await new Blob(parts, {type: 'video/webm'}).arrayBuffer())];
 }));
 await create.getByRole('tab', {name: 'Video', exact: true}).click();
 await create.getByRole('radio', {name: 'Effect', exact: true}).click();
 await create.getByRole('spinbutton', {name: 'Frames', exact: true}).fill('6');
 await prompt.fill('magic sparkle');
 await create.getByTestId('hub-generate').click();
 expect(hub.requests.find(r => r.path === '/v1/videos').json).toMatchObject({seconds: '1'});
 await tab('Jobs');
 const videoJob = jobs.locator('[data-job][data-kind="animation"]').first();
 await expect(videoJob).toHaveAttribute('data-state', 'completed', {timeout: 20000});
 await videoJob.getByRole('button', {name: /^Create animation/}).click();
 await expect(videoJob).toHaveAttribute('data-state', 'imported', {timeout: 20000});
 saved = await save();
 expect(saved.scenes.flatMap(s => s.entities).flatMap(e => e.components).filter(c => c.type === 'pixi.flipbook').at(-1).data).toMatchObject({frames: 6});
 await videoJob.getByRole('button', {name: /^Remix /}).click();
 await videoJob.getByRole('textbox', {name: 'What to change in the video', exact: true}).fill('slower');
 await videoJob.getByRole('button', {name: 'Remix', exact: true}).click();
 await expect.poll(() => hub.requests.some(r => /\/v1\/videos\/job-\d+\/remix$/.test(r.path) && r.json.prompt === 'slower')).toBe(true);
 await expect(jobs.locator('[data-job]').filter({hasText: '-remix'})).toHaveCount(1);

 // Cancel a slow job: it goes to the hub and the row says Cancelled; a live preview shows while it runs.
 hub.slow = true;
 await tab('Create');
 await create.getByRole('tab', {name: 'Image', exact: true}).click();
 await create.getByRole('radio', {name: 'Icon', exact: true}).click();
 await prompt.fill('slow shield');
 await create.getByTestId('hub-generate').click();
 await tab('Jobs');
 const slowJob = jobs.locator('[data-job]').filter({hasText: 'slow-shield'});
 await expect(slowJob).toHaveAttribute('data-state', 'in_progress');
 await expect(slowJob.getByTestId('job-state')).toContainText('50% · KSampler 10/20');
 await expect(slowJob.getByTestId('job-preview')).toBeVisible();
 await slowJob.getByRole('button', {name: /^Cancel /}).click();
 await expect(slowJob).toHaveAttribute('data-state', 'cancelled');
 expect(hub.requests.some(r => /\/cancel$/.test(r.path))).toBe(true);
 hub.slow = false;

 // Files: generated outputs and uploads on the hub; preview, add to the Library, make an animation from a video,
 // upload (refused types never leave the editor), delete with a confirming second click.
 await tab('Files');
 const filesTab = panel.getByTestId('hub-files'), rows = filesTab.locator('[data-file]');
 await expect(rows).toHaveCount(hub.files.size);
 await expect(filesTab.getByTestId('hub-files-usage')).toContainText(`${hub.files.size} files`);
 await filesTab.getByRole('combobox', {name: 'Show', exact: true}).selectOption('video');
 const videoRow = rows.first();
 await expect(videoRow).toHaveAttribute('data-kind', 'video');
 await videoRow.getByRole('button', {name: /^Preview /}).click();
 await expect(videoRow.getByTestId('file-preview')).toBeVisible();
 const flips = async () => (await save()).scenes.flatMap(s => s.entities).flatMap(e => e.components).filter(c => c.type === 'pixi.flipbook').length;
 const flipsBefore = await flips();
 await videoRow.getByRole('button', {name: /^Make animation /}).click();
 const fileFrames = filesTab.getByTestId('animation-frames');
 await expect(fileFrames.locator('.generate-frame')).toHaveCount(8);
 await fileFrames.getByRole('button', {name: 'Create animation', exact: true}).click();
 await expect(fileFrames).toHaveCount(0);
 expect(await flips()).toBe(flipsBefore + 1);
 await filesTab.getByRole('combobox', {name: 'Show', exact: true}).selectOption('image');
 const imageRow = rows.first();
 const assetsBefore = await assetCount();
 await imageRow.getByRole('button', {name: /^Add to Library /}).click();
 await expect(imageRow.getByTestId('file-imported')).toBeVisible();
 expect(await assetCount()).toBe(assetsBefore + 1);
 await filesTab.getByRole('combobox', {name: 'Show', exact: true}).selectOption('all');
 const uploadsBefore = hub.requests.filter(r => r.path === '/v1/files' && r.method === 'POST').length;
 await filesTab.getByLabel('Upload file…', {exact: true}).setInputFiles({name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ')});
 await filesTab.getByLabel('Upload file…', {exact: true}).setInputFiles({name: 'level notes.txt', mimeType: 'text/plain', buffer: Buffer.from('boss at the end')});
 const notes = rows.filter({hasText: 'level notes.txt'});
 await expect(notes).toHaveAttribute('data-source', 'upload');
 const uploads = hub.requests.filter(r => r.path === '/v1/files' && r.method === 'POST');
 expect(uploads.length).toBe(uploadsBefore + 1);
 expect(uploads.at(-1).fields).toMatchObject({purpose: 'reference', file: {filename: 'level notes.txt', type: 'text/plain'}});
 await notes.getByRole('button', {name: 'Delete level notes.txt', exact: true}).click();
 await notes.getByRole('button', {name: 'Delete from the hub? level notes.txt', exact: true}).click();
 await expect(notes).toHaveCount(0);
 expect(hub.requests.some(r => r.method === 'DELETE' && /^\/v1\/files\/file-\d+$/.test(r.path))).toBe(true);
 await panel.screenshot({path: join(root, 'outputs/localhub-files.png')});

 // Assistant through the hub: hub chat models, tools run in the editor, generate_asset makes a hub job.
 await page.keyboard.press('Escape');
 await page.keyboard.press('Alt+KeyJ');
 await expect(panel).toHaveAttribute('data-tab', 'assistant');
 const assistant = panel.getByTestId('assistant-panel'), log = assistant.getByRole('log');
 await expect(assistant).toHaveAttribute('data-online', 'true');
 await expect(assistant.getByRole('combobox', {name: 'Model', exact: true})).toHaveValue('lmstudio/fake-qwen');
 const message = assistant.getByRole('textbox', {name: 'Message', exact: true});
 await message.fill('Add a hub star'); await message.press('Enter');
 await expect(log.locator('[data-kind="assistant"]').last()).toHaveText('Added a star through LocalHub.', {timeout: 30000});
 const chat = hub.requests.filter(r => r.path === '/v1/chat/completions' && r.json.tools);
 expect(chat[0].json).toMatchObject({model: 'lmstudio/fake-qwen', stream: true, tool_choice: 'auto'});
 expect(chat[0].json.mcp_servers).toBeUndefined();
 // Hub MCP tools are offered for the chat and sent with the next request.
 await panel.getByTestId('hub-tools').getByRole('checkbox', {name: 'Hub tools files', exact: true}).check();
 await message.fill('make a coin'); await message.press('Enter');
 await expect(log.locator('[data-kind="assistant"]').last()).toHaveText('Made a coin through LocalHub.', {timeout: 30000});
 expect(hub.requests.filter(r => r.path === '/v1/chat/completions' && r.json.tools).at(-2).json.mcp_servers).toEqual(['files']);
 expect(hub.requests.filter(r => r.path === '/v1/images/generations').at(-1).json).toMatchObject({prompt: 'gold coin', size: '256x256'});
 saved = await save();
 expect(saved.scenes.flatMap(s => s.entities).map(e => e.name)).toContain('Hub star');

 // MCP Files adapters use this same pinned Hub connection, conversion/import and upload/delete services.
 await page.keyboard.press('Escape');
 await app.evaluate(({dialog,Menu},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});Menu.getApplicationMenu().items.flatMap(m=>m.submenu?.items??[]).find(i=>i.label==='Settings…').click();},temp);
 const mcpSettings=page.getByTestId('settings-dialog');await mcpSettings.getByRole('navigation',{name:'Settings sections',exact:true}).getByRole('button',{name:'MCP server',exact:true}).click();await mcpSettings.getByRole('button',{name:'Allow folder',exact:true}).click();await page.keyboard.press('Escape');
 let mcpSeq=0;const mcp=async(name,args={})=>{const response=await fetch(`http://127.0.0.1:${mcpPort}/mcp`,{method:'POST',headers:{Authorization:`Bearer ${mcpToken}`,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++mcpSeq,method:'tools/call',params:{name,arguments:args}})});const reply=await response.json();expect(reply.result.isError,JSON.stringify(reply)).toBe(false);return JSON.parse(reply.result.content[0].text);};
 const done=async(handle,approve=false)=>{if(approve)await page.getByRole('button',{name:'Approve',exact:true}).click();await expect.poll(async()=>{const state=await mcp('automation.job',{id:handle.id,waitMs:1000});if(state.state==='failed')throw Error(JSON.stringify(state.error));return state.state;},{timeout:30000}).toBe('complete');return(await mcp('automation.job',{id:handle.id})).result;};
 const listing=await mcp('hub-files.list',{limit:100});expect(listing.items.length).toBeGreaterThan(0);const image=listing.items.find(f=>f.mime==='image/png'),video=listing.items.find(f=>f.mime.startsWith('video/'));
 expect((await done(await mcp('hub-files.import',{id:image.id}))).assetIds).toHaveLength(1);const sheetResult=await done(await mcp('hub-files.animate',{id:video.id,frames:4,fps:10}));expect(sheetResult.layout).toMatchObject({frames:4,fps:10});expect(sheetResult.assetIds).toHaveLength(1);
 const uploadPath=join(temp,'mcp-upload.txt');await writeFile(uploadPath,'MCP Files fixture');const uploaded=await done(await mcp('hub-files.upload',{path:uploadPath}),true);expect(uploaded.filename).toBe('mcp-upload.txt');const rejectedDelete=await mcp('hub-files.delete',{id:uploaded.id});await page.getByRole('button',{name:'Reject',exact:true}).click();expect((await mcp('automation.job',{id:rejectedDelete.id})).state).toBe('cancelled');expect((await mcp('hub-files.list',{query:'mcp-upload'})).total).toBe(1);await done(await mcp('hub-files.delete',{id:uploaded.id}),true);expect((await mcp('hub-files.list',{query:'mcp-upload'})).total).toBe(0);
 console.log('PASS MCP Hub Files: pinned native list/import/video-to-sheet, scoped approved upload, rejected/approved delete; shared UI services');
 await page.keyboard.press('Alt+KeyA');

 // The Mac takes image.create away (event: session): the Create tab says so.
 hub.scopes = hub.scopes.filter(s => s !== 'image.create');
 emit('session', {scopes: hub.scopes});
 await tab('Create');
 await create.getByRole('radio', {name: 'Sprite', exact: true}).click();
 await expect(create.getByTestId('hub-unavailable')).toContainText('LocalHub › Devices');
 await expect(create.getByTestId('hub-generate')).toBeDisabled();
 await expect(panel.getByTestId('hub-missing')).toContainText('image.create');

 // Direct connection: the ComfyUI Generate view, with the hub still paired.
 await panel.getByRole('combobox', {name: 'Connection', exact: true}).selectOption({label: 'This computer (ComfyUI + LM Studio)'});
 await expect(panel).toHaveAttribute('data-connection', 'direct');
 await expect(panel.getByTestId('generate-panel')).toBeVisible();
 await tab('Files');
 await expect(panel.getByTestId('hub-files-direct')).toBeVisible();
 await tab('Create');
 await panel.getByRole('combobox', {name: 'Connection', exact: true}).selectOption({label: 'Automatic (LocalHub when paired)'});
 await expect(panel).toHaveAttribute('data-connection', 'localhub');

 // The device is removed on the Mac (event: revoked): back to pairing.
 emit('revoked', {});
 await expect(panel.getByTestId('hub-pair')).toBeVisible();
 await expect(panel).toHaveAttribute('data-connection', 'direct');
 // Pair again, then the Mac goes away: Disconnect still forgets the session here.
 await panel.getByText('Connect LocalHub…', {exact: true}).click();
 await inviteBox.fill(invite('123456')); await pairButton.click();
 await expect(panel.getByTestId('hub-connection')).toHaveAttribute('data-online', 'true');
 for (const s of hub.streams) s.destroy();
 server.closeAllConnections(); await new Promise(r => server.close(r));
 await panel.getByTestId('hub-status').getByRole('button', {name: 'Disconnect', exact: true}).click();
 await expect(panel.getByTestId('hub-pair')).toBeVisible();
 await expect(panel.getByTestId('hub-connection')).toHaveAttribute('data-paired', 'false');
 await panel.screenshot({path: join(root, 'outputs/localhub-panel.png')});
 expect(errors).toEqual([]);
 console.log('PASS LocalHub: pairing (wrong code, pin mismatch), sprite/edit/sound/voice/sheet/video jobs, remix, cancel, assistant + MCP, permission change, revoke, direct');
} catch (error) { console.error('requests:', hub.requests.map(r => `${r.method} ${r.path}`).join(' | ')); throw error; } finally {
 // MCP import/animation checks leave unsaved test edits. Discard them explicitly rather than leaving a native
 // confirmation dialog blocking Playwright's app.close (only this isolated temporary profile is affected).
 await app?.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});}).catch(()=>{});
 await app?.close().catch(() => {});
 for (const s of hub.streams) s.end();
 server?.closeAllConnections?.(); server?.close(); decoy?.close();
 await rm(temp, {recursive: true, force: true});
}
