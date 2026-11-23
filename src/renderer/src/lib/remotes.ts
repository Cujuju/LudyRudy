import type { RemoteSummary } from '@shared/types';

export { providerName } from '@shared/providers';

export function remoteOptions(remotes: readonly RemoteSummary[]) {
  return remotes.map(({ name, isCrypt }) => ({ value: name, label: isCrypt ? `${name} (encrypted)` : name }));
}

export function storageProvider(remote: RemoteSummary | undefined, remotes: readonly RemoteSummary[]): string {
  const visited = new Set<string>();
  while (remote?.isCrypt) {
    if (visited.has(remote.name)) return 'unknown';
    visited.add(remote.name);

    const target = remote.targetRemote;
    if (!target) return remote.targetPath === null ? 'unknown' : 'local';
    if (target.startsWith(':')) return target.slice(1);
    remote = remotes.find(({ name }) => name === target);
  }
  return remote?.type ?? 'unknown';
}
