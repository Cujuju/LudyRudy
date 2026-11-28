import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, stat, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { MountProfile } from '@shared/types';
import { openMountManager, mountOptions } from './mountManager';
import { associateMounts } from './mountIdentity';
import { RcloneClient } from './rcloneClient';

const draft: MountProfile = {
  id: 'vault', name: 'Vault', remote: 'vault', remotePath: 'subdir', mountPoint: resolve('out/test-mount'),
  autoMount: true, vfsCacheMode: 'writes', vfsCacheMaxSize: '2G', vfsCacheMaxAge: '12h', readOnly: true,
  extraFlags: ['-o', 'ro'], mountType: 'cmount',
};

function fixture(initial: MountProfile[], managed = false, platform: string = process.platform, backendAvailable = true, types = ['cmount']) {
  const active = new Map<string, { Fs: string; MountPoint: string }>();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, opts) => {
    const args = JSON.parse(String(opts?.body));
    switch (new URL(String(input)).pathname) {
      case '/config/listremotes': return Response.json({ remotes: ['vault'] });
      case '/mount/listmounts': return Response.json({ mountPoints: [...active.values()] });
      case '/mount/types': return Response.json({ mountTypes: types });
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
    managed: () => managed, platform: () => platform, mountBackendAvailable: () => backendAvailable,
    notify, reveal, defaults: () => 'full',
  });
  return { mounts, fetch, notify, reveal, active, rc };
}

afterEach(() => vi.unstubAllGlobals());

describe('MountManager', () => {
  it.skipIf(process.platform === 'win32')('mounts advertised NFS on managed macOS without FUSE while blocking FUSE mount types', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.mount-test-'));
    try {
      const mountPoint = join(directory, 'vault');
      const profile = { ...draft, mountPoint, mountType: 'nfsmount' };
      const { mounts, active, fetch } = fixture([profile], true, 'darwin', false, ['cmount', 'nfsmount']);
      await expect(mounts.mountProfile(profile.id)).resolves.toBe(await realpath(directory) + '/vault');
      expect(JSON.parse(String(fetch.mock.lastCall?.[1]?.body))).toMatchObject({ mountType: 'nfsmount' });
      active.clear();
      mounts.save({ ...profile, mountType: 'cmount' });
      await expect(mounts.mountProfile(profile.id)).rejects.toThrow('requires a local mount backend');
      expect(active.size).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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
    const { mounts, reveal, active, rc } = fixture([], true);
    const { id: _, ...withoutId } = draft;
    expect(() => mounts.save({ ...withoutId, mountPoint: 'relative' })).toThrow('absolute mount point');
    const profile = mounts.save({ ...withoutId, vfsCacheMode: undefined });
    expect(profile.vfsCacheMode).toBe('full');
    expect(mounts.save({ ...profile, name: 'New name' }).name).toBe('New name');
    await expect(mounts.revealMount(resolve('out/other'))).rejects.toThrow('Unknown mount point');
    await expect(mounts.revealMount(profile.mountPoint)).rejects.toThrow('Unknown mount point');
    active.set(profile.mountPoint, { Fs: 'vault:subdir', MountPoint: profile.mountPoint });
    await mounts.revealMount((await rc.mounts())[0]!.id);
    expect(reveal).toHaveBeenCalledWith(profile.mountPoint);
    mounts.delete(profile.id);
    expect(mounts.list()).toEqual([]);
  });

  it('passes an attached Windows mount point through the daemon without touching the local shell', async () => {
    const { mounts, reveal, fetch } = fixture([], false, 'win32');
    const profile = mounts.save({ ...draft, id: undefined, mountPoint: 'x:' });
    expect(profile.mountPoint).toBe('X:\\');
    await expect(mounts.mountProfile(profile.id)).resolves.toBe('X:\\');
    expect(JSON.parse(String(fetch.mock.lastCall?.[1]?.body))).toMatchObject({ mountPoint: 'X:\\' });
    await expect(mounts.revealMount(profile.mountPoint)).rejects.toThrow('rclone host');
    expect(reveal).not.toHaveBeenCalled();
  });

  it.each(['C:/foo/..', '//server/share', '//server/share/'])('rejects Windows filesystem roots after normalization (%s)', (mountPoint) => {
    const { mounts } = fixture([], false, 'win32');
    expect(() => mounts.save({ ...draft, id: undefined, mountPoint })).toThrow('filesystem root');
  });

  it('saves a Windows profile alongside an existing POSIX profile', () => {
    const { mounts } = fixture([{ ...draft, mountPoint: '/mnt/vault' }], false, 'win32');
    expect(mounts.save({ ...draft, id: undefined, mountPoint: 'X:' }).mountPoint).toBe('X:\\');
    expect(mounts.list()).toHaveLength(2);
  });

  it('blocks local reveal even when an attached mount point matches an existing desktop directory', async () => {
    const path = process.cwd();
    const { mounts, fetch, reveal } = fixture([{ ...draft, mountPoint: path }]);
    await expect(mounts.revealMount(path)).rejects.toThrow('rclone host');
    expect(fetch).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });

  it('validates remote existence and reports mount failures', async () => {
    const { mounts, notify } = fixture([{ ...draft, remote: 'missing' }]);
    await expect(mounts.mountProfile(draft.id)).rejects.toThrow('Unknown rclone remote');
    expect(notify).toHaveBeenCalledWith('mountFailed', 'Mount failed', 'Vault');
  });

  it.each(['current', 'legacy'])('skips attached auto-mount and supports explicit mount and unmount (%s response)', async (response) => {
    const { mounts, fetch, notify, active, rc } = fixture([draft]);
    if (response === 'legacy') {
      const respond = fetch.getMockImplementation()!;
      fetch.mockImplementation(async (url, init) => {
        const result = await respond(url, init);
        return new URL(String(url)).pathname === '/mount/mount' ? Response.json({}) : result;
      });
    }
    await mounts.autoMount();
    expect(fetch).not.toHaveBeenCalled();
    await expect(mounts.mountProfile(draft.id)).resolves.toBe(draft.mountPoint);
    expect(notify).toHaveBeenCalledWith('mountReady', 'Mount ready', 'Vault');
    await mounts.unmount((await rc.mounts())[0]!.id);
    expect(active.size).toBe(0);
  });

  it('matches equivalent Windows drive paths only when the filesystem also matches', async () => {
    const profile = { ...draft, mountPoint: 'X:\\' };
    const { mounts, active, rc } = fixture([profile], false, 'win32');
    active.set('x:', { MountPoint: 'x:', Fs: 'vault:subdir' });
    const observed = await rc.observeMounts(true);
    await expect(associateMounts(observed, [profile], { platform: 'win32', local: false }))
      .resolves.toMatchObject([{ profileId: profile.id }]);
    await expect(mounts.mountProfile(profile.id)).resolves.toBe('x:');
    active.set('x:', { MountPoint: 'x:', Fs: 'other:subdir' });
    await expect(associateMounts(await rc.observeMounts(true), [profile], { platform: 'win32', local: false }))
      .resolves.toMatchObject([{ profileId: null }]);
    await expect(mounts.mountProfile(profile.id)).rejects.toThrow('Another filesystem');
    await expect(mounts.unmount(observed[0]!.view.id)).rejects.toThrow('The active mount changed');
    expect(active.has('x:')).toBe(true);
  });

  it('opens a managed Windows drive-letter mount as an absolute drive root', async () => {
    const { mounts, active, reveal, rc } = fixture([], true, 'win32');
    active.set('x:', { Fs: 'vault:subdir', MountPoint: 'x:' });
    await mounts.revealMount((await rc.mounts(true))[0]!.id);
    expect(reveal).toHaveBeenCalledWith('X:\\');
  });

  it.each(['vault:subdir', 'other:subdir'])('leaves equivalent active destinations unassociated even with source %s', async (source) => {
    const profile = { ...draft, mountPoint: 'X:\\' };
    const { mounts, active, rc } = fixture([profile], false, 'win32');
    active.set('x:', { MountPoint: 'x:', Fs: 'vault:subdir' });
    active.set('X:\\', { MountPoint: 'X:\\', Fs: source });
    await expect(associateMounts(await rc.observeMounts(true), [profile], { platform: 'win32', local: false }))
      .resolves.toMatchObject([{ profileId: null, mountPoint: 'x:' }, { profileId: null, mountPoint: 'X:\\' }]);
    await expect(mounts.mountProfile(profile.id)).rejects.toThrow('Another filesystem');
  });

  it.skipIf(process.platform === 'win32')('uses the resolved local path for new mounts and associates directory aliases', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.mount-test-'));
    try {
      const target = join(directory, 'target');
      const alias = join(directory, 'alias');
      await mkdir(target);
      await symlink(target, alias);
      const actual = await realpath(target);
      const profile = { ...draft, mountPoint: alias };
      const { mounts, active, rc, notify } = fixture([profile], true);
      await expect(mounts.mountProfile(profile.id)).resolves.toBe(actual);
      expect(active.has(actual)).toBe(true);
      const observed = await rc.observeMounts(false);
      await expect(associateMounts(observed, [profile], { platform: process.platform, local: true }))
        .resolves.toMatchObject([{ profileId: profile.id }]);
      await expect(associateMounts(observed, [profile], { platform: process.platform, local: false }))
        .resolves.toMatchObject([{ profileId: null }]);
      await expect(mounts.mountProfile(profile.id)).resolves.toBe(actual);
      expect(notify).toHaveBeenCalledExactlyOnceWith('mountReady', 'Mount ready', profile.name);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
