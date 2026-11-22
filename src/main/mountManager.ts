import { randomUUID } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, normalize, parse } from 'node:path';
import type { MountProfile } from '@shared/types';
import { VFS_CACHE_MODES } from '@shared/types';
import type { NoticeKind } from '@shared/notice';
import { remoteFs, type RcMountOptions, type RcloneClient } from './rcloneClient';
import { requireRemoteName } from './remoteService';

export type Notify = (kind: NoticeKind, title: string, body: string) => void;

interface MountContext {
  client: () => RcloneClient;
  profiles: () => MountProfile[];
  save: (profiles: MountProfile[]) => void;
  defaults: () => MountProfile['vfsCacheMode'];
  managed: () => boolean;
  notify: Notify;
  reveal: (path: string) => Promise<string>;
}

function mountPath(path: unknown): string {
  if (typeof path !== 'string' || path.includes('\0')) throw new Error('Invalid mount point.');
  if (process.platform === 'win32' && /^[a-z]:[\\/]?$/i.test(path)) return path.slice(0, 2).toUpperCase() + '\\';
  if (!isAbsolute(path)) throw new Error('Use an absolute mount point.');
  const normalized = normalize(path).replace(/[\\/]+$/, '');
  if (!normalized || normalized === parse(path).root.replace(/[\\/]+$/, '')) throw new Error('The filesystem root cannot be used as a mount point.');
  return normalized;
}

export function mountOptions(profile: MountProfile): RcMountOptions {
  return {
    fs: remoteFs(profile.remote, profile.remotePath), mountPoint: profile.mountPoint,
    ...(profile.mountType ? { mountType: profile.mountType } : {}),
    mountOpt: { ExtraFlags: profile.extraFlags },
    vfsOpt: {
      CacheMode: profile.vfsCacheMode, ReadOnly: profile.readOnly,
      ...(profile.vfsCacheMaxSize ? { CacheMaxSize: profile.vfsCacheMaxSize } : {}),
      ...(profile.vfsCacheMaxAge ? { CacheMaxAge: profile.vfsCacheMaxAge } : {}),
    },
  };
}

export function openMountManager(context: MountContext) {
  let operation = Promise.resolve();
  function serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = operation.then(action);
    operation = next.then(() => undefined, () => undefined);
    return next;
  }

  function profileFor(id: string): MountProfile {
    const profile = context.profiles().find((entry) => entry.id === id);
    if (!profile) throw new Error('Unknown mount profile.');
    return profile;
  }

  async function mount(id: string): Promise<string> {
    const profile = profileFor(id);
    try {
      requireRemoteName(profile.remote);
      const path = mountPath(profile.mountPoint);
      const rc = context.client();
      const { remotes } = await rc.call('config/listremotes');
      if (!remotes?.includes(profile.remote)) throw new Error('Unknown rclone remote.');
      if (context.managed() && process.platform !== 'win32') {
        await mkdir(path, { recursive: true });
        const resolved = await realpath(path);
        if (!(await stat(resolved)).isDirectory() || resolved === parse(resolved).root) throw new Error('Invalid mount directory.');
      }
      const options = mountOptions({ ...profile, mountPoint: path });
      const active = (await rc.mounts(process.platform === 'win32')).find((entry) => entry.mountPoint === path);
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
      requireRemoteName(draft?.remote);
      if (typeof draft.name !== 'string' || !draft.name.trim() || typeof draft.remotePath !== 'string' ||
        (draft.vfsCacheMode !== undefined && !VFS_CACHE_MODES.includes(draft.vfsCacheMode))) throw new Error('Invalid mount profile.');
      if (draft.id !== undefined) profileFor(draft.id);
      const mountPoint = mountPath(draft.mountPoint);
      if (context.profiles().some((entry) => entry.id !== draft.id && mountPath(entry.mountPoint) === mountPoint)) {
        throw new Error('A profile already uses that mount point.');
      }
      const profile = { ...draft, id: draft.id ?? randomUUID(), mountPoint, vfsCacheMode: draft.vfsCacheMode ?? context.defaults() };
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
        if (typeof path !== 'string' || !(await rc.mounts(process.platform === 'win32')).some((mount) => mount.mountPoint === path)) {
          throw new Error('Unknown active mount point.');
        }
        await rc.call('mount/unmount', { mountPoint: path });
      });
    },
    unmountAll: () => serialize(async () => { await context.client().call('mount/unmountall'); }),
    async revealMount(path: string): Promise<void> {
      if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Use an absolute mount point.');
      const saved = context.profiles().some(({ mountPoint }) => mountPoint === path);
      if (!saved && !(await context.client().mounts(process.platform === 'win32')).some(({ mountPoint }) => mountPoint === path)) {
        throw new Error('Unknown mount point.');
      }
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
