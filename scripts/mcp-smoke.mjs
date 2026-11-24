// MCP server: off by default; Settings turns it on; a client on this computer initializes over Streamable HTTP, lists
// the assistant's tools plus screenshot, adds an object (one undo step), reads the state and takes a PNG; requests
// without the token or from a foreign origin are refused; the stdio bridge (the app's own binary in node mode) works
// the same way; a new token locks the old one out; turning the server off closes the port.
import {_electron as electron, expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/editor-desktop/package.json'));
const temp = await mkdtemp(join(tmpdir(), 'rewrite-mcp-'));
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
let app, bridge;

try {
 app = await electron.launch({executablePath: process.env.REWRITE_EXECUTABLE || require('electron'), args: [...(process.env.REWRITE_EXECUTABLE ? [] : [join(root, 'apps/editor-desktop/out/main/index.js')]), '--no-hub', `--user-data-dir=${join(temp, 'user')}`], env});
 const page = await app.firstWindow();
 page.setDefaultTimeout(15000);
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await expect(page.getByTestId('pixi-canvas')).toHaveAttribute('data-ready', 'true', {timeout: 30000});
 const menu = label => app.evaluate(({Menu}, text) => Menu.getApplicationMenu().items.flatMap(m => m.submenu?.items ?? []).find(i => i.label === text).click(), label);

 // Settings → MCP server: off by default, one switch turns it on.
 await menu('Settings…');
 const dialog = page.getByTestId('settings-dialog'), section = dialog.getByRole('region', {name: 'MCP server', exact: true});
 await dialog.getByRole('navigation', {name: 'Settings sections', exact: true}).getByRole('button', {name: 'MCP server', exact: true}).click();
 await expect(section.getByTestId('mcp-status')).toContainText('Off');
 await section.getByRole('switch', {name: 'Run the MCP server', exact: true}).check();
 await expect(section.getByTestId('mcp-settings')).toHaveAttribute('data-running', 'true');
 await expect(section.getByTestId('mcp-status')).toContainText('Running at http://127.0.0.1:');
 await expect(section.locator('[data-setup="claude-code"] pre')).toContainText('claude mcp add --transport http olivestudio');
 await expect(section.locator('[data-setup="claude-code"] pre')).not.toContainText((await page.evaluate(() => window.platform.mcp.status())).token);
 const status = await page.evaluate(() => window.platform.mcp.status());
 await page.keyboard.press('Escape');
 console.log('PASS Settings → MCP server is off by default, turns on with one switch and shows client setups with the token hidden');

 // Streamable HTTP with JSON replies.
 let id = 0;
 const post = (body, headers = {}) => fetch(status.url, {method: 'POST', body: JSON.stringify(body), headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${status.token}`, ...headers}});
 const rpc = async (method, params, headers) => { const res = await post({jsonrpc: '2.0', id: ++id, method, params}, headers); expect(res.status).toBe(200); return res.json(); };
 expect((await post({jsonrpc: '2.0', id: 0, method: 'ping'}, {Authorization: 'Bearer wrong'})).status).toBe(401);
 expect((await post({jsonrpc: '2.0', id: 0, method: 'ping'}, {Origin: 'https://evil.example'})).status).toBe(403);
 const init = await post({jsonrpc: '2.0', id: ++id, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'smoke', version: '1'}}});
 expect(init.headers.get('mcp-session-id')).toBeTruthy();
 expect((await init.json()).result).toMatchObject({protocolVersion: '2025-06-18', serverInfo: {name: 'olivestudio'}, capabilities: {tools: {}}});
 expect((await post({jsonrpc: '2.0', method: 'notifications/initialized'})).status).toBe(202);
 const tools = (await rpc('tools/list')).result.tools.map(t => t.name);
 for (const name of ['get_editor_state', 'add_object', 'set_fields', 'add_rule', 'set_global', 'screenshot']) expect(tools).toContain(name);
 const added = await rpc('tools/call', {name: 'add_object', arguments: {item: 'pixi.star', name: 'MCP star', x: 480, y: 270}});
 expect(added.result.isError).toBe(false);
 await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(1);
 const state = JSON.parse((await rpc('tools/call', {name: 'get_editor_state', arguments: {}})).result.content[0].text);
 expect(state.objects.map(o => o.name)).toContain('MCP star');
 const missing = await rpc('tools/call', {name: 'set_fields', arguments: {objectId: 'No such object', component: 'pixi.shape', values: {color: '#000000'}}});
 expect(missing.result.isError).toBe(true);
 const shot = await rpc('tools/call', {name: 'screenshot', arguments: {}});
 expect(shot.result.content[0]).toMatchObject({type: 'image', mimeType: 'image/png'});
 expect(Buffer.from(shot.result.content[0].data, 'base64').subarray(1, 4).toString()).toBe('PNG');
 await menu('Settings…');await dialog.getByRole('navigation',{name:'Settings sections',exact:true}).getByRole('button',{name:'MCP server',exact:true}).click();await section.getByRole('button',{name:'Show token',exact:true}).click();
 const protectedShot=await rpc('tools/call',{name:'screenshot',arguments:{area:'window'}});expect(protectedShot.result.isError).toBe(true);expect(protectedShot.result.content[0].text).toContain('Hide revealed credentials');await section.getByRole('button',{name:'Hide token',exact:true}).click();expect((await rpc('tools/call',{name:'screenshot',arguments:{area:'window'}})).result.content[0].type).toBe('image');await page.keyboard.press('Escape');
 await menu('Undo');
 await expect(page.getByLabel('Unsaved changes', {exact: true})).toHaveCount(0);
 expect(JSON.parse((await rpc('tools/call', {name: 'get_editor_state', arguments: {}})).result.content[0].text).objects.map(o => o.name)).not.toContain('MCP star');
 console.log('PASS HTTP client: initialize, tools/list (assistant tools + screenshot), add_object as one undo step, errors as tool results, PNG screenshot; no token → 401, foreign origin → 403');

 // stdio bridge: exactly the command Settings shows for Claude Desktop-style clients.
 bridge = spawn(status.stdio.command, status.stdio.args, {env: {...env, ...status.stdio.env}, stdio: ['pipe', 'pipe', 'inherit']});
 const lines = [];
 let buffer = '';
 bridge.stdout.on('data', chunk => { buffer += chunk; let at; while ((at = buffer.indexOf('\n')) >= 0) { lines.push(JSON.parse(buffer.slice(0, at))); buffer = buffer.slice(at + 1); } });
 bridge.stdin.write(JSON.stringify({jsonrpc: '2.0', id: 'a', method: 'initialize', params: {protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 'stdio', version: '1'}}}) + '\n');
 await expect.poll(() => lines.find(l => l.id === 'a'), {timeout: 20000}).toBeTruthy();
 bridge.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');
 bridge.stdin.write(JSON.stringify({jsonrpc: '2.0', id: 'b', method: 'tools/call', params: {name: 'add_object', arguments: {item: 'pixi.circle', name: 'Stdio ball', x: 200, y: 200}}}) + '\n');
 await expect.poll(() => lines.find(l => l.id === 'b'), {timeout: 20000}).toBeTruthy();
 expect(lines.find(l => l.id === 'a').result.protocolVersion).toBe('2025-03-26');
 expect(lines.find(l => l.id === 'b').result.isError).toBe(false);
 await page.getByRole('button', {name: 'Layers', exact: true}).click();
 await expect(page.getByRole('button', {name: 'Select Stdio ball', exact: true})).toBeVisible();
 await page.keyboard.press('Escape');
 console.log('PASS stdio bridge: the shown command (app binary in node mode + mcp-stdio.js) forwards JSON-RPC lines to the editor');

 // A new token locks the old one out; turning the server off closes the port (the bridge then explains why).
 const renewed = await page.evaluate(() => window.platform.mcp.configure({regenerate: true}));
 expect(renewed.token).not.toBe(status.token);
 expect((await post({jsonrpc: '2.0', id: 0, method: 'ping'})).status).toBe(401);
 await page.evaluate(() => window.platform.mcp.configure({enabled: false}));
 await expect(fetch(status.url, {method: 'POST', body: '{}'})).rejects.toThrow();
 bridge.stdin.write(JSON.stringify({jsonrpc: '2.0', id: 'c', method: 'ping'}) + '\n');
 await expect.poll(() => lines.find(l => l.id === 'c')).toBeTruthy();
 expect(lines.find(l => l.id === 'c').error.message).toContain('MCP server is off');
 expect(errors).toEqual([]);
 console.log('PASS a new token locks out the old one; turning the server off closes the port and the bridge reports it');
} catch (error) {
 await mkdir(join(root, 'outputs'), {recursive: true});
 const page = app ? await app.firstWindow().catch(() => null) : null;
 await page?.screenshot({path: join(root, 'outputs/mcp-failure.png')}).catch(() => {});
 throw error;
} finally {
 bridge?.kill();
 if (app) {
  await app.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {});
  await app.close().catch(() => {});
 }
 await rm(temp, {recursive: true, force: true, maxRetries: 3});
}
