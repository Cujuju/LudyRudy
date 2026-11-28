import { realpath } from 'node:fs/promises';
import type { ActiveMount, MountProfile } from '@shared/types';
import { daemonPath, isDaemonAbsolute } from './daemonPaths';
import type { ObservedMount } from './rcloneClient';

const DRIVE_ROOT = /^[a-z]:[\\/]?$/i;
type MountHost = { platform: string | null; local: boolean };

function pointKey(path: string, platform: string | null): string | undefined {
  if (platform === 'win32' && DRIVE_ROOT.test(path)) return path[0]?.toUpperCase() + ':\\';
  if (!isDaemonAbsolute(path, platform)) return undefined;
  const paths = daemonPath(platform);
  const normalized = paths.normalize(path);
  return normalized === paths.parse(normalized).root || !normalized.endsWith(paths.sep) ? normalized : normalized.slice(0, -1);
}

export function mountPath(path: unknown, platform: string | null): string {
  if (typeof path !== 'string' || path.includes('\0')) throw new Error('Invalid mount point.');
  if (!platform) throw new Error('Connect to rclone to verify the mount point on its host.');
  const normalized = pointKey(path, platform);
  if (!normalized) throw new Error('Use an absolute mount point on the rclone host.');
  if (normalized === daemonPath(platform).parse(normalized).root && !(platform === 'win32' && DRIVE_ROOT.test(path))) {
    throw new Error('The filesystem root cannot be used as a mount point.');
  }
  return normalized;
}

export function mountIdentity({ platform, local }: MountHost) {
  const resolved = new Map<string, Promise<string | undefined>>();
  const canonical = (path: string) => {
    let lookup = resolved.get(path);
    if (!lookup) {
      lookup = realpath(path).catch(() => undefined);
      resolved.set(path, lookup);
    }
    return lookup;
  };
  const samePoint = async (a: string, b: string): Promise<boolean> => {
    const from = pointKey(a, platform);
    const to = pointKey(b, platform);
    if (!from || !to) return false;
    const separator = platform === 'win32' ? /[\\/]/ : '/';
    if (a === b || (from === to && !a.split(separator).includes('..') && !b.split(separator).includes('..'))) return true;
    if (!local) return false;
    const [first, second] = await Promise.all([canonical(a), canonical(b)]);
    return first !== undefined && first === second;
  };
  const source = (profile: MountProfile) => {
    const path = platform === 'win32' ? profile.remotePath.replaceAll('\\', '/') : profile.remotePath;
    return `${profile.remote}:${path}`;
  };
  async function atPoint(mounts: ObservedMount[], path: string): Promise<ObservedMount[]> {
    const matches = await Promise.all(mounts.map(async (mount) => await samePoint(mount.view.mountPoint, path) ? mount : null));
    return matches.filter((mount) => mount !== null);
  }
  return { atPoint, source, checkPoint: (path: string) => pointKey(path, platform) };
}

export async function associateMounts(mounts: ObservedMount[], profiles: MountProfile[], host: MountHost): Promise<ActiveMount[]> {
  const identity = mountIdentity(host);
  const sources = new Set(mounts.map((mount) => mount.source));
  const associations = new Map<ObservedMount, string[]>();
  const profilesWithActiveSource = profiles.filter((profile) => sources.has(identity.source(profile)));
  await Promise.all(profilesWithActiveSource.map(async (profile) => {
    const [match, extra] = await identity.atPoint(mounts, profile.mountPoint);
    if (!match || extra || match.source !== identity.source(profile)) return;
    const owners = associations.get(match) ?? [];
    owners.push(profile.id);
    associations.set(match, owners);
  }));
  return mounts.map((mount) => {
    const owners = associations.get(mount);
    return { ...mount.view, profileId: owners?.length === 1 ? owners[0]! : null };
  });
}
