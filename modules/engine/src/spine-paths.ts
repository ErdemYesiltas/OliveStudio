export function spineRelativePath(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[:{}\u0000-\u001f]/.test(value)) return;
  const path = value.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/$/, '');
  if (path && path.split('/').every(part => part && part !== '.' && part !== '..' && part.length <= 255)) return path;
}
