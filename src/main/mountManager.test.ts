import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { MountProfile } from '@shared/types';
import { openMountManager, mountOptions } from './mountManager';
import { RcloneClient } from './rcloneClient';

const draft: MountProfile = {
  id: 'vault', name: 'Vault', remote: 'vault', remotePath: 'subdir', mountPoint: resolve('out/test-mount'),
  autoMount: true, vfsCacheMode: 'writes', vfsCacheMaxSize: '2G', vfsCacheMaxAge: '12h', readOnly: true,
  extraFlags: ['-o', 'ro'], mountType: 'cmount',
};

function fixture(initial: MountProfile[], managed = false) {
  const active = new Map<string, { Fs: string; MountPoint: string }>();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, opts) => {
    const args = JSON.parse(String(opts?.body));
    switch (new URL(String(input)).pathname) {
      case '/config/listremotes': return Response.json({ remotes: ['vault'] });
      case '/mount/listmounts': return Response.json({ mountPoints: [...active.values()] });
      case '/mount/types': return Response.json({ mountTypes: ['cmount'] });
      case '/mount/mount':
        active.set(args.mountPoint, { Fs: args.fs, MountPoint: args.mountPoint });
        return Response.json({ mountPoint: args.mountPoint });
      case '/mount/unmount': active.delete(args.mountPoint); return Response.json({});
      case '/mount/unmountall': active.clear(); return Response.json({});
      default: return Response.json({}, { status: 404 });
    }
  });
  vi.stubGlobal('fetch', fetch);
  let profiles = initial;
  const notify = vi.fn();
  const reveal = vi.fn().mockResolvedValue('');
  const rc = new RcloneClient('http://localhost:5572');
  const mounts = openMountManager({
    client: () => rc, profiles: () => profiles, save: (next) => { profiles = next; },
    managed: () => managed, notify, reveal, defaults: () => 'full',
  });
  return { mounts, fetch, notify, reveal, active };
}

afterEach(() => vi.unstubAllGlobals());

describe('MountManager', () => {
  it('maps vfs and mount settings to the rclone option names', () => {
    expect(mountOptions(draft)).toEqual({
      fs: 'vault:subdir', mountPoint: draft.mountPoint, mountType: 'cmount', mountOpt: { ExtraFlags: ['-o', 'ro'] },
      vfsOpt: { CacheMode: 'writes', CacheMaxSize: '2G', CacheMaxAge: '12h', ReadOnly: true },
    });
  });

  it('saves advanced options and sends their typed values to mount/mount', async () => {
    const { mounts, fetch } = fixture([draft]);
    const profile = mounts.save({
      ...draft,
      mountOpts: { VolumeName: 'Test volume', CaseInsensitive: 'false', DirectIO: true },
      vfsOpts: { HandleCaching: '6s', ChunkSize: '128Mi', ChunkStreams: 3, DirPerms: '0755', CaseInsensitive: true },
    });
    expect(profile.mountOpts?.CaseInsensitive).toBe('false');
    await mounts.mountProfile(profile.id);
    expect(String(fetch.mock.lastCall?.[0])).toBe('http://localhost:5572/mount/mount');
    expect(JSON.parse(String(fetch.mock.lastCall?.[1]?.body))).toEqual({
      fs: 'vault:subdir', mountPoint: draft.mountPoint, mountType: 'cmount',
      mountOpt: { ExtraFlags: ['-o', 'ro'], VolumeName: 'Test volume', CaseInsensitive: false, DirectIO: true },
      vfsOpt: {
        CacheMode: 'writes', CacheMaxSize: '2G', CacheMaxAge: '12h', ReadOnly: true,
        HandleCaching: '6s', ChunkSize: '128Mi', ChunkStreams: 3, DirPerms: '0755', CaseInsensitive: true,
      },
    });
  });

  it.each<Partial<Pick<MountProfile, 'mountOpts' | 'vfsOpts'>>>([
    { mountOpts: { ExtraFlags: 'shadowed' } },
    { vfsOpts: { ReadOnly: false } },
    { mountOpts: { Daemon: true } },
    { vfsOpts: { DirectIO: true } },
    { mountOpts: { debug_fuse: true } },
    { mountOpts: { DirectIO: 'true' } },
    { mountOpts: { CaseInsensitive: 'unset' } },
    { mountOpts: { VolumeName: 'test\x00name' } },
    { vfsOpts: { ChunkStreams: 1.5 } },
    { vfsOpts: { UID: -1 } },
    { vfsOpts: { DirPerms: '999' } },
    { vfsOpts: { HandleCaching: 'soon' } },
    { vfsOpts: { ChunkSize: 'lots' } },
  ])('rejects invalid overrides at save and RC serialization (%j)', (invalid) => {
    const { mounts } = fixture([draft]);
    const profile = { ...draft, ...invalid };
    expect(() => mounts.save(profile)).toThrow(/option|Invalid value/);
    expect(() => mountOptions(profile)).toThrow(/option|Invalid value/);
    expect(mounts.list()).toEqual([draft]);
  });

  it('creates and updates profiles, and restricts paths used to reveal a mount', async () => {
    const { mounts, reveal } = fixture([]);
    const { id: _, ...withoutId } = draft;
    expect(() => mounts.save({ ...withoutId, mountPoint: 'relative' })).toThrow('absolute mount point');
    const profile = mounts.save({ ...withoutId, vfsCacheMode: undefined });
    expect(profile.vfsCacheMode).toBe('full');
    expect(mounts.save({ ...profile, name: 'New name' }).name).toBe('New name');
    await expect(mounts.revealMount(resolve('out/other'))).rejects.toThrow('Unknown mount point');
    await mounts.revealMount(profile.mountPoint);
    expect(reveal).toHaveBeenCalledWith(profile.mountPoint);
    mounts.delete(profile.id);
    expect(mounts.list()).toEqual([]);
  });

  it('validates remote existence and reports mount failures', async () => {
    const { mounts, notify } = fixture([{ ...draft, remote: 'missing' }]);
    await expect(mounts.mountProfile(draft.id)).rejects.toThrow('Unknown rclone remote');
    expect(notify).toHaveBeenCalledWith('mountFailed', 'Mount failed', 'Vault');
  });

  it('skips auto-mount on attached mode, but supports explicit mount and unmount', async () => {
    const { mounts, fetch, active } = fixture([draft]);
    await mounts.autoMount();
    expect(fetch).not.toHaveBeenCalled();
    await expect(mounts.mountProfile(draft.id)).resolves.toBe(draft.mountPoint);
    await mounts.unmount(draft.mountPoint);
    expect(active.size).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('creates missing managed directories, auto-mounts once, and supports unmount all', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.mount-test-'));
    try {
      const mountPoint = join(directory, 'vault');
      const { mounts, notify, active } = fixture([{ ...draft, mountPoint }], true);
      await mounts.autoMount();
      await mounts.autoMount();
      expect((await stat(mountPoint)).isDirectory()).toBe(true);
      expect(active.size).toBe(1);
      expect(notify).toHaveBeenCalledExactlyOnceWith('mountReady', 'Mount ready', 'Vault');
      await mounts.unmountAll();
      expect(active.size).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
