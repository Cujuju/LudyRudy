import type { RemoteSummary } from '@shared/types';

export { providerName } from '@shared/providers';

export function remoteOptions(remotes: readonly RemoteSummary[]) {
  return remotes.map(({ name, isCrypt }) => ({ value: name, label: isCrypt ? `${name} (encrypted)` : name }));
}
