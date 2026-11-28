import { randomUUID } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { parse } from 'node:path';
import type { MountProfile } from '@shared/types';
import { VFS_CACHE_MODES } from '@shared/types';
import type { NoticeKind } from '@shared/notice';
import { validateOptionMap } from '@shared/mountOptions';
import { daemonPath, isDaemonAbsolute } from './daemonPaths';
import { remoteFs, validRemoteName, type RcMountOptions, type RcloneClient } from './rcloneClient';
import { createSerialQueue } from './serialQueue';

export type Notify = (kind: NoticeKind, title: string, body: string) => void;

interface MountContext {
  client: () => RcloneClient;
  profiles: () => MountProfile[];
  save: (profiles: MountProfile[]) => void;
  defaults: () => MountProfile['vfsCacheMode'];
  managed: () => boolean;
  platform: () => string | null;
  notify: Notify;
  reveal: (path: string) => Promise<string>;
}

function mountPath(path: unknown, platform: string | null): string {
  if (typeof path !== 'string' || path.includes('\0')) throw new Error('Invalid mount point.');
  if (!platform) throw new Error('Connect to rclone to verify the mount point on its host.');
  if (platform === 'win32' && /^[a-z]:[\\/]?$/i.test(path)) return path.slice(0, 2).toUpperCase() + '\\';
  if (!isDaemonAbsolute(path, platform)) throw new Error('Use an absolute mount point on the rclone host.');
  const paths = daemonPath(platform);
  const trimSeparator = (value: string) => value.endsWith(paths.sep) ? value.slice(0, -1) : value;
  const normalized = paths.normalize(path);
  if (trimSeparator(normalized) === trimSeparator(paths.parse(normalized).root)) {
    throw new Error('The filesystem root cannot be used as a mount point.');
  }
  return trimSeparator(normalized);
}

export function mountOptions(profile: MountProfile): RcMountOptions {
  const mountOpt = validateOptionMap('mount', profile.mountOpts);
  // rclone's nested JSON tristate accepts booleans. An omitted key inherits the daemon default.
  if (typeof mountOpt?.CaseInsensitive === 'string') mountOpt.CaseInsensitive = mountOpt.CaseInsensitive === 'true';
  return {
    fs: remoteFs(profile.remote, profile.remotePath), mountPoint: profile.mountPoint,
    ...(profile.mountType ? { mountType: profile.mountType } : {}),
    mountOpt: { ...mountOpt, ExtraFlags: profile.extraFlags },
    vfsOpt: {
      ...validateOptionMap('vfs', profile.vfsOpts),
      CacheMode: profile.vfsCacheMode, ReadOnly: profile.readOnly,
      ...(profile.vfsCacheMaxSize ? { CacheMaxSize: profile.vfsCacheMaxSize } : {}),
      ...(profile.vfsCacheMaxAge ? { CacheMaxAge: profile.vfsCacheMaxAge } : {}),
    },
  };
}

export function openMountManager(context: MountContext) {
  const serialize = createSerialQueue();

  function profileFor(id: string): MountProfile {
    const profile = context.profiles().find((entry) => entry.id === id);
    if (!profile) throw new Error('Unknown mount profile.');
    return profile;
  }

  async function mount(id: string): Promise<string> {
    const profile = profileFor(id);
    try {
      const rc = context.client();
      const platform = context.platform();
      const windows = platform === 'win32';
      const local = context.managed();
      if (!validRemoteName(profile.remote, windows)) throw new Error('Invalid rclone remote name.');
      const path = mountPath(profile.mountPoint, platform);
      const { remotes } = await rc.call('config/listremotes');
      if (!remotes?.includes(profile.remote)) throw new Error('Unknown rclone remote.');
      const options = mountOptions({ ...profile, mountPoint: path });
      if (local && !windows) {
        if (!context.managed() || rc !== context.client()) throw new Error('The rclone daemon changed during mount setup.');
        await mkdir(path, { recursive: true });
        const resolved = await realpath(path);
        if (!(await stat(resolved)).isDirectory() || resolved === parse(resolved).root) throw new Error('Invalid mount directory.');
      }
      const active = (await rc.mounts(windows)).find((entry) => entry.mountPoint === path);
      if (active) {
        if (active.fs === options.fs) return active.mountPoint;
        throw new Error('Another filesystem already uses that mount point.');
      }
      if (options.mountType) {
        const { mountTypes } = await rc.call('mount/types');
        if (!mountTypes?.includes(options.mountType)) throw new Error('This mount type is unavailable in the daemon.');
      }
      if (rc !== context.client()) throw new Error('The rclone daemon changed during mount setup.');
      const { mountPoint } = await rc.call('mount/mount', options);
      context.notify('mountReady', 'Mount ready', profile.name);
      return mountPoint;
    } catch (error) {
      context.notify('mountFailed', 'Mount failed', profile.name);
      throw error;
    }
  }

  return {
    list: context.profiles,
    save(draft: Omit<MountProfile, 'id' | 'vfsCacheMode'> & Partial<Pick<MountProfile, 'id' | 'vfsCacheMode'>>): MountProfile {
      const platform = context.platform();
      if (!validRemoteName(draft?.remote, platform === 'win32')) throw new Error('Invalid rclone remote name.');
      if (typeof draft.name !== 'string' || !draft.name.trim() || typeof draft.remotePath !== 'string' ||
        (draft.vfsCacheMode !== undefined && !VFS_CACHE_MODES.includes(draft.vfsCacheMode))) throw new Error('Invalid mount profile.');
      if (draft.id !== undefined) profileFor(draft.id);
      const mountPoint = mountPath(draft.mountPoint, platform);
      if (context.profiles().some((entry) => {
        if (entry.id === draft.id) return false;
        try { return mountPath(entry.mountPoint, platform) === mountPoint; } catch { return false; }
      })) {
        throw new Error('A profile already uses that mount point.');
      }
      const profile = {
        ...draft, id: draft.id ?? randomUUID(), mountPoint, vfsCacheMode: draft.vfsCacheMode ?? context.defaults(),
        mountOpts: validateOptionMap('mount', draft.mountOpts), vfsOpts: validateOptionMap('vfs', draft.vfsOpts),
      };
      context.save([...context.profiles().filter(({ id }) => id !== profile.id), profile]);
      return profileFor(profile.id);
    },
    delete(id: string): void {
      profileFor(id);
      context.save(context.profiles().filter((profile) => profile.id !== id));
    },
    mountProfile: (id: string) => serialize(() => mount(id)),
    unmount(path: string): Promise<void> {
      return serialize(async () => {
        const rc = context.client();
        if (typeof path !== 'string' || !(await rc.mounts(context.platform() === 'win32')).some((mount) => mount.mountPoint === path)) {
          throw new Error('Unknown active mount point.');
        }
        await rc.call('mount/unmount', { mountPoint: path });
      });
    },
    unmountAll: () => serialize(async () => { await context.client().call('mount/unmountall'); }),
    async revealMount(path: string): Promise<void> {
      if (!context.managed()) throw new Error('Open this mount point on the rclone host.');
      if (typeof path !== 'string' || !isDaemonAbsolute(path, context.platform())) throw new Error('Use an absolute mount point.');
      const rc = context.client();
      if (!(await rc.mounts(context.platform() === 'win32')).some(({ mountPoint }) => mountPoint === path)) {
        throw new Error('Unknown mount point.');
      }
      if (!context.managed() || rc !== context.client()) throw new Error('The rclone connection changed.');
      if (await context.reveal(path)) throw new Error('Could not open the mount point.');
    },
    async autoMount(): Promise<void> {
      if (!context.managed()) return;
      const rc = context.client();
      for (const { id } of context.profiles().filter((profile) => profile.autoMount)) {
        await serialize(async () => {
          if (context.client() === rc) await mount(id);
        }).catch(() => { /* Individual mount failures are reported by mount(). */ });
      }
    },
  };
}
