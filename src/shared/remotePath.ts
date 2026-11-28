export function remotePath(value: unknown, allowRoot = false, platform?: string | null): string {
  if (typeof value !== 'string' || value.includes('\0') || value.startsWith('/')
    || ((platform === 'win32' || platform === null) && value.includes('\\'))) {
    throw new Error('Invalid remote path.');
  }
  const segments = value.split('/');
  if (segments.includes('..')) throw new Error('Invalid remote path.');
  const path = segments.filter((part) => part && part !== '.').join('/');
  if (!path && !allowRoot) throw new Error('Select a file or directory below the remote root.');
  return path;
}

export function parentRemotePath(value: string): string {
  const path = remotePath(value, true);
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

export function editedRemotePath(value: string, initial: string, platform: string | null): string {
  const edited = remotePath(value, false, platform).split('/');
  const original = remotePath(initial, true, platform).split('/');
  for (const [index, part] of original.entries()) {
    if (edited[index] !== part.replace(/\r\n?/g, '\n')) break;
    edited[index] = part;
  }
  return edited.join('/');
}
