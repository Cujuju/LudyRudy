import { randomUUID } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { parse } from 'node:path';
import type { MountProfile } from '@shared/types';
import { VFS_CACHE_MODES } from '@shared/types';
import type { NoticeKind } from '@shared/notice';
import { validateOptionMap } from '@shared/mountOptions';
import { mountPrerequisitesMet, mountTypeAdvertised } from '@shared/mountCapabilities';
import { isDaemonAbsolute } from './daemonPaths';
import { mountIdentity, mountPath } from './mountIdentity';
import { remoteFs, validRemoteName, type RcMountOptions, type RcloneClient } from './rcloneClient';
import { createSerialQueue } from './serialQueue';

export type Notify = (kind: NoticeKind, title: string, body: string) => void;

interface MountContext {
  client: () => RcloneClient;
  profiles: () => MountProfile[];
  save: (profiles: MountProfile[]) => void;
  defaults: () => MountProfile['vfsCacheMode'];
  managed: () => boolean;
  mountBackendAvailable: () => boolean;
  platform: () => string | null;
  notify: Notify;
  reveal: (path: string) => Promise<string>;
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
      let path = mountPath(profile.mountPoint, platform);
      const { remotes } = await rc.call('config/listremotes');
      if (!remotes?.includes(profile.remote)) throw new Error('Unknown rclone remote.');
      const identity = mountIdentity({ platform, local });
      if (local && !windows) {
        if (!context.managed() || rc !== context.client()) throw new Error('The rclone daemon changed during mount setup.');
        await mkdir(path, { recursive: true });
        const resolved = await realpath(path);
        if (!(await stat(resolved)).isDirectory() || resolved === parse(resolved).root) throw new Error('Invalid mount directory.');
        path = resolved;
      }
      const options = mountOptions({ ...profile, mountPoint: path });
      const mounts = await rc.observeMounts(windows);
      const matching = await identity.atPoint(mounts, path);
      if (rc !== context.client()) throw new Error('The rclone daemon changed during mount setup.');
      if (matching.length) {
        const [active] = matching;
        if (matching.length === 1 && active?.source === identity.source(profile)) return active.view.mountPoint;
        throw new Error('Another filesystem already uses that mount point.');
      }
      if (windows && mounts.some(({ view }) => identity.checkPoint(view.mountPoint)?.toLowerCase() === path.toLowerCase())) {
        throw new Error('A mount already uses a path that differs only in letter case.');
      }
      if (!mountTypeAdvertised(options.mountType, await rc.mountTypes())) throw new Error('This mount type is unavailable in the daemon.');
      if (!mountPrerequisitesMet(options.mountType, platform, local, context.mountBackendAvailable())) {
        throw new Error('This mount type requires a local mount backend. Choose an available type or install its prerequisites.');
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
    unmount(id: string): Promise<void> {
      return serialize(async () => {
        const rc = context.client();
        const mount = (await rc.mounts(context.platform() === 'win32')).find((entry) => entry.id === id);
        if (!mount || rc !== context.client()) throw new Error('The active mount changed. Refresh and try again.');
        await rc.call('mount/unmount', { mountPoint: mount.mountPoint });
      });
    },
    unmountAll: () => serialize(async () => { await context.client().call('mount/unmountall'); }),
    async revealMount(id: string): Promise<void> {
      if (!context.managed()) throw new Error('Open this mount point on the rclone host.');
      const rc = context.client();
      const platform = context.platform();
      const mount = (await rc.mounts(platform === 'win32')).find((entry) => entry.id === id);
      if (!mount) throw new Error('Unknown mount point.');
      const point = mountPath(mount.mountPoint, platform);
      if (!context.managed() || rc !== context.client()) throw new Error('The rclone connection changed.');
      const shellPath = isDaemonAbsolute(mount.mountPoint, platform) ? mount.mountPoint : point;
      if (await context.reveal(shellPath)) throw new Error('Could not open the mount point.');
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
