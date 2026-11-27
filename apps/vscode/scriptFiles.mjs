import * as vscode from 'vscode';

export const scriptScheme = 'olive-project-script';

export function registerScriptFiles(context) {
  const files = new Map();
  const changes = new vscode.EventEmitter();
  const lookup = uri => {
    const entry = files.get(uri.toString());
    const script = entry?.session.project?.scripts.items.find(item => item.id === entry.id);
    if (!script) throw vscode.FileSystemError.FileNotFound(uri);
    return { entry, script };
  };
  const immutable = () => { throw vscode.FileSystemError.NoPermissions('Use the Scripts view to manage project scripts.'); };
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
    if (document.uri.scheme === scriptScheme) files.delete(document.uri.toString());
  }));
  context.subscriptions.push(changes, vscode.workspace.registerFileSystemProvider(scriptScheme, {
    onDidChangeFile: changes.event,
    watch: () => new vscode.Disposable(() => {}),
    stat(uri) {
      const { entry, script } = lookup(uri);
      return { type: vscode.FileType.File, ctime: entry.created, mtime: entry.modified, size: Buffer.byteLength(script.source) };
    },
    readFile(uri) {
      const { entry, script } = lookup(uri);
      entry.base = script.source;
      return Buffer.from(script.source, 'utf8');
    },
    async writeFile(uri, bytes) {
      const { entry, script } = lookup(uri);
      const source = Buffer.from(bytes).toString('utf8');
      if (source === script.source) return;
      if (entry.base !== script.source) throw vscode.FileSystemError.Unavailable('The project script changed in another editor.');
      await entry.session.change((project, model) => {
        const existing = project.scripts.items.find(item => item.id === script.id);
        if (!existing || existing.source !== entry.base) throw vscode.FileSystemError.Unavailable('The project script changed in another editor.');
        const compiled = model.compileScript(source, existing.name);
        const { error: _error, ...previous } = existing;
        const updated = { ...previous, source, ...compiled };
        return { ...project, version: 2, scripts: { ...project.scripts,
          items: project.scripts.items.map(item => item.id === script.id ? updated : item) } };
      });
      entry.base = source;
      entry.modified = Date.now();
    },
    readDirectory: () => [],
    createDirectory: immutable,
    delete: immutable,
    rename: immutable,
  }, { isCaseSensitive: true }));

  return async (session, id) => {
    const script = session.project.scripts.items.find(item => item.id === id);
    if (!script) return;
    const folder = Buffer.from(session.uri.toString()).toString('base64url');
    const uri = vscode.Uri.from({ scheme: scriptScheme, path: `/${folder}/${id}/${script.name.replace(/[/:\\]/g, '_')}.ts` });
    const key = uri.toString();
    const now = Date.now();
    const entry = files.get(key);
    if (!entry) files.set(key, { session, id, created: now, modified: now, base: script.source });
    else {
      entry.session = session;
      if (entry.base !== script.source) {
        entry.modified = now;
        changes.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      }
    }
    return vscode.window.showTextDocument(uri, { preview: false });
  };
}
