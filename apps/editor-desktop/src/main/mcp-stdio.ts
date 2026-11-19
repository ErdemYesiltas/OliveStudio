import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';

/**
 * stdio ⇄ HTTP bridge for MCP clients that start a command (Claude Desktop, Cursor…). Run with the editor's own binary:
 * `ELECTRON_RUN_AS_NODE=1 "<OliveStudio>" <this file> --config <userData>/mcp.json`. It forwards each JSON-RPC
 * line to the running editor's MCP server (port and token from the config, read per message so changes apply).
 */
const at = process.argv.indexOf('--config'), configPath = at > 0 ? process.argv[at + 1] : process.env.PIXI_EDITOR_MCP_CONFIG;
let session: string | undefined;
const write = (value: unknown) => { process.stdout.write(`${JSON.stringify(value)}\n`); };
const ids = (line: string): (string | number)[] => { try { const v = JSON.parse(line) as unknown; return (Array.isArray(v) ? v : [v]).flatMap(m => { const id = (m as {id?: unknown})?.id; return typeof id === 'string' || typeof id === 'number' ? [id] : []; }); } catch { return []; } };
const fail = (line: string, message: string) => { for (const id of ids(line)) write({jsonrpc: '2.0', id, error: {code: -32000, message}}); };
createInterface({input: process.stdin}).on('line', line => {
 if (!line.trim()) return;
 void (async () => {
  let config: {enabled?: boolean; port?: number; token?: string};
  try { config = JSON.parse(readFileSync(configPath ?? '', 'utf8')) as typeof config; } catch { return fail(line, 'OliveStudio MCP settings not found: open the editor once and turn on Settings → MCP server'); }
  if (!config.enabled) return fail(line, 'The OliveStudio MCP server is off: turn it on in Settings → MCP server');
  try {
   const res = await fetch(`http://127.0.0.1:${config.port}/mcp`, {method: 'POST', body: line, headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${config.token}`, ...(session ? {'Mcp-Session-Id': session} : {})}});
   session = res.headers.get('mcp-session-id') ?? session;
   if (res.status === 202) return;
   const text = await res.text();
   if (!res.ok) return fail(line, `OliveStudio answered ${res.status}: ${text.slice(0, 200)}`);
   process.stdout.write(`${text}\n`);
  } catch { fail(line, 'OliveStudio is not running (start it and keep the MCP server on)'); }
 })();
});
