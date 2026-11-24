import {useEffect, useState,type ComponentType} from 'react';
import {Copy, Eye, EyeOff, RefreshCw} from 'lucide-react';

/** Copy-ready setups for the common MCP clients, from the server's status. */
export function mcpSetups(s: McpStatus) {
 const http = `claude mcp add --transport http olivestudio ${s.url} --header "Authorization: Bearer ${s.token}"`;
 const stdio = JSON.stringify({mcpServers: {'olivestudio': {command: s.stdio.command, args: s.stdio.args, env: s.stdio.env}}}, null, 2);
 const remote = JSON.stringify({mcpServers: {'olivestudio': {type: 'http', url: s.url, headers: {Authorization: `Bearer ${s.token}`}}}}, null, 2);
 return {http, stdio, remote};
}

/**
 * Settings → MCP server: lets MCP clients (Claude Code, Claude Desktop, Cursor…) on this computer drive the editor
 * with the assistant's tools. Off by default; loopback only, behind a token.
 */
export function createMcpSettings(t: (key: string) => string, report: (error: unknown) => void,Activity?:ComponentType) {
 return function McpSettings() {
  const [roots,setRoots]=useState<string[]>([]);
  useEffect(()=>{void window.platform.automation?.roots().then(setRoots,report);},[]);
  const [status, setStatus] = useState<McpStatus | null>(null), [show, setShow] = useState(false), [copied, setCopied] = useState('');
  /** The switch follows a click at once; the server's answer then settles it (or reverts it on failure). */
  const [enabling, setEnabling] = useState<boolean | null>(null);
  useEffect(() => { let live = true; const load = () => { void window.platform.mcp.status().then(s => { if (live) setStatus(s); }, report); }; load(); const timer = setInterval(load, 2000); return () => { live = false; clearInterval(timer); }; }, []);
  const configure = (patch: Parameters<typeof window.platform.mcp.configure>[0]) => { if (patch.enabled !== undefined) setEnabling(patch.enabled); void window.platform.mcp.configure(patch).then(setStatus, report).finally(() => { if (patch.enabled !== undefined) setEnabling(null); }); };
  const copy = (key: string, text: string) => { void navigator.clipboard.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(''), 1500); }, report); };
  if (!status) return <p className="panel-empty">{t('mcp.loading')}</p>;
  const setups = mcpSetups(status), mask = (text: string) => show ? text : text.split(status.token).join('•'.repeat(12));
  const block = (key: string, title: string, text: string) => <div className="mcp-setup" data-setup={key}>
   <div className="mcp-setup-head"><strong>{title}</strong><button aria-label={`${t('mcp.copy')} ${title}`} onClick={() => copy(key, text)}><Copy size={13}/>{copied === key ? t('mcp.copied') : t('mcp.copy')}</button></div>
   <pre data-revealed-secret={show?true:undefined}>{mask(text)}</pre>
  </div>;
  return <div className="mcp-settings" data-testid="mcp-settings" data-running={status.running}>
   <p className="mcp-help">{t('mcp.help')}</p>
   <label className="mcp-row"><input type="checkbox" role="switch" aria-label={t('mcp.enabled')} checked={enabling ?? status.enabled} onChange={e => configure({enabled: e.target.checked})}/>{t('mcp.enabled')}</label>
   <p className={`mcp-status${status.running ? ' running' : ''}`} role="status" data-testid="mcp-status">
    <span className={status.running ? 'status-dot online' : 'status-dot'} aria-hidden="true"/>
    {status.error ? status.error : status.running ? t('mcp.running').replace('{url}', status.url) : t('mcp.off')}
    {status.running && status.lastCall ? ` · ${t('mcp.lastCall').replace('{time}', new Date(status.lastCall).toLocaleTimeString())}` : ''}
   </p>
   <label className="mcp-row"><span>{t('mcp.port')}</span><input type="number" aria-label={t('mcp.port')} min={1024} max={65535} key={status.port} defaultValue={status.port} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={e => { const port = Number(e.currentTarget.value); if (Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== status.port) configure({port}); else e.currentTarget.value = String(status.port); }}/></label>
   <div className="mcp-row"><span>{t('mcp.token')}</span><code data-testid="mcp-token" data-revealed-secret={show?true:undefined}>{show ? status.token : '•'.repeat(24)}</code>
    <button aria-label={show ? t('mcp.hideToken') : t('mcp.showToken')} title={show ? t('mcp.hideToken') : t('mcp.showToken')} onClick={() => setShow(v => !v)}>{show ? <EyeOff size={14}/> : <Eye size={14}/>}</button>
    <button aria-label={t('mcp.newToken')} title={t('mcp.newTokenHint')} onClick={() => configure({regenerate: true})}><RefreshCw size={14}/></button>
   </div>
   {block('claude-code', t('mcp.setup.claudeCode'), setups.http)}
   {block('http-json', t('mcp.setup.http'), setups.remote)}
   {block('stdio', t('mcp.setup.stdio'), setups.stdio)}
   <label className="mcp-row"><input type="checkbox" role="switch" aria-label={t('mcp.qaMode')} checked={status.qaMode} onChange={e => configure({qaMode: e.target.checked})}/>{t('mcp.qaMode')}</label>
   <p className="mcp-help">{t('mcp.qaModeHelp')}</p>
   <section><h3>{t('automation.folders')}</h3><p>{t('automation.foldersHelp')}</p><ul>{roots.map(root=><li key={root}><code>{root}</code> <button aria-label={`${t('automation.revoke')} ${root}`} onClick={()=>{void window.platform.automation.revoke(root).then(setRoots,report);}}>{t('automation.revoke')}</button></li>)}</ul><button onClick={()=>{void window.platform.automation.grant().then(setRoots,report);}}>{t('automation.allowFolder')}</button></section>
   {Activity&&<Activity/>}
   <small className="mcp-help">{t('mcp.security')}</small>
  </div>;
 };
}
