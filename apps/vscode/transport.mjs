// VS Code webview messages use JSON. Preserve byte arrays for LocalHub and asset drops.
export function encode(value) {
  return JSON.stringify(value, (_key, item) => {
    if (item === undefined && _key === '') return null;
    if (!(item instanceof Uint8Array)) return item;
    let binary = '';
    for (let offset = 0; offset < item.length; offset += 0x8000) {
      binary += String.fromCharCode(...item.subarray(offset, offset + 0x8000));
    }
    return { oliveBytes: btoa(binary) };
  });
}

export function decode(value) {
  return JSON.parse(value, (_key, item) => item && typeof item.oliveBytes === 'string' && Object.keys(item).length === 1
    ? Uint8Array.from(atob(item.oliveBytes), char => char.charCodeAt(0)) : item);
}
