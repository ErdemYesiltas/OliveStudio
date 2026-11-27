import * as vscode from 'vscode';
import { createHash } from 'node:crypto';

export const sectionScheme = 'olive-project-section';
const json = value => JSON.stringify(value ?? null, null, 2) + '\n';

export function registerSectionFiles(context) {
  const files = new Map();
  const changes = new vscode.EventEmitter();
  const lookup = uri => {
    const entry = files.get(uri.toString());
    if (!entry?.session.project) throw vscode.FileSystemError.FileNotFound(uri);
    return entry;
  };
  const immutable = () => { throw vscode.FileSystemError.NoPermissions('Manage this section from its project view.'); };
  context.subscriptions.push(changes, vscode.workspace.onDidCloseTextDocument(document => {
    if (document.uri.scheme === sectionScheme) files.delete(document.uri.toString());
  }));
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider(sectionScheme, {
    onDidChangeFile: changes.event,
    watch: () => new vscode.Disposable(() => {}),
    stat(uri) {
      const entry = lookup(uri);
      return { type: vscode.FileType.File, ctime: entry.created, mtime: entry.modified,
        size: Buffer.byteLength(entry.serialize(entry.read(entry.session.project))) };
    },
    readFile(uri) {
      const entry = lookup(uri);
      entry.base = entry.serialize(entry.read(entry.session.project));
      return Buffer.from(entry.base);
    },
    async writeFile(uri, bytes) {
      const entry = lookup(uri);
      const source = Buffer.from(bytes).toString('utf8');
      const next = entry.parse(source);
      const matches = project => entry.base === entry.serialize(entry.read(project));
      await entry.session.change((project, model) => {
        if (!matches(project)) throw vscode.FileSystemError.Unavailable('This project section changed. Close and reopen the section before editing it again.');
        return entry.write(project, next, model);
      });
      entry.base = entry.serialize(entry.read(entry.session.project));
      entry.modified = Date.now();
    },
    readDirectory: () => [],
    createDirectory: immutable,
    delete: immutable,
    rename: immutable,
  }, { isCaseSensitive: true }));

  return async (session, { id, title, read, write, raw = false }) => {
    const project = Buffer.from(session.uri.toString()).toString('base64url');
    const section = createHash('sha256').update(id).digest('hex').slice(0, 16);
    const filename = title.replace(/[\/:]/g, '_') + (raw ? '.glsl' : '.json');
    const serialize = raw ? String : json;
    const parse = raw ? String : JSON.parse;
    const uri = vscode.Uri.from({ scheme: sectionScheme, path: `/${project}/${section}/${filename}` });
    const key = uri.toString();
    const entry = files.get(key);
    if (!entry) {
      const now = Date.now();
      files.set(key, { session, read, write, serialize, parse, created: now, modified: now, base: serialize(read(session.project)) });
    } else {
      Object.assign(entry, { session, read, write });
      if (entry.base !== serialize(read(session.project)) && !vscode.workspace.textDocuments.some(doc => doc.uri.toString() === key && doc.isDirty)) {
        entry.modified = Date.now();
        changes.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      }
    }
    return vscode.window.showTextDocument(uri, { preview: false });
  };
}
