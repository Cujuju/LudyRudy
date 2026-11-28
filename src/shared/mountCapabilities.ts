import type { DaemonStatus } from './types';

export const NFS_MOUNT = 'nfsmount';
const DEFAULT_MOUNT_TYPES = new Set(['mount', 'cmount', 'mount2']);

export function mountTypeAdvertised(type: string | undefined, types: readonly string[]): boolean {
  return type ? types.includes(type) : types.some((entry) => DEFAULT_MOUNT_TYPES.has(entry));
}

export function mountPrerequisitesMet(type: string | undefined, platform: string | null, local: boolean, backendAvailable: boolean): boolean {
  return !local || backendAvailable || (platform === 'darwin' && type === NFS_MOUNT);
}

export function mountTypeAvailable(daemon: DaemonStatus | undefined, backendAvailable: boolean, type?: string): boolean {
  return !!daemon?.mountTypes && mountTypeAdvertised(type, daemon.mountTypes)
    && mountPrerequisitesMet(type, daemon.hostPlatform, daemon.mode === 'managed', backendAvailable);
}

export function defaultProfileMountType(daemon: DaemonStatus | undefined, backendAvailable: boolean): string | undefined {
  if (mountTypeAvailable(daemon, backendAvailable)) return undefined;
  return daemon?.mountTypes?.find((type) => mountTypeAvailable(daemon, backendAvailable, type));
}
