export function getByPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
    source,
  );
}
