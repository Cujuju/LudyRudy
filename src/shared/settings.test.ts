import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_UPDATE_INSTALL_MINUTE, normalizeSettings, UPDATE_INSTALL_MODES } from './settings';

describe('normalizeSettings', () => {
  it('creates fresh defaults for an invalid or missing profile', () => {
    const settings = normalizeSettings(null);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.mounts).not.toBe(DEFAULT_SETTINGS.mounts);
    expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it('preserves valid preferences and normalizes partially saved profiles and jobs', () => {
    const settings = normalizeSettings({
      general: { theme: 'tonal', closeToTray: true, minimizeToTray: 'false' },
      daemon: { endpoint: 'http://localhost:5572' },
      notifications: { style: 'drip', daemonErrors: false },
      mounts: [null, { id: 'vault', remote: 'gdrive-vault', mountPoint: '/mnt/vault', vfsCacheMode: 'invalid', extraFlags: ['--read-only', 42] }],
      jobs: [{ id: 'backup', source: '/local', destination: 'gdrive-vault:', mode: 'sync' }, { id: 'incomplete' }],
    });
    expect(settings.general).toMatchObject({ theme: 'tonal', closeToTray: true, minimizeToTray: false });
    expect(settings.daemon.endpoint).toBe('http://localhost:5572');
    expect(settings.notifications).toMatchObject({ style: 'drip', daemonErrors: false });
    expect(settings.mounts).toMatchObject([{ id: 'vault', vfsCacheMode: 'off', extraFlags: ['--read-only'] }]);
    expect(settings.jobs).toMatchObject([{ id: 'backup', mode: 'sync', dryRunDefault: true }]);
    expect(normalizeSettings(settings)).toEqual(settings);
  });

  it('discards invalid advanced entries while preserving valid and legacy mount options', () => {
    const settings = normalizeSettings({
      mounts: [{
        id: 'vault', remote: 'gdrive-vault', mountPoint: '/mnt/vault', extraFlags: ['-o', 'ro'],
        mountOpts: { CaseInsensitive: 'true', NoAppleDouble: false, Daemon: true, VolumeName: 'a\nb' },
        vfsOpts: { PollInterval: '30s', ChunkStreams: 3, CacheMode: 'full', HandleCaching: false },
      }],
    });
    expect(settings.mounts[0]).toMatchObject({ extraFlags: ['-o', 'ro'] });
    expect(settings.mounts[0]?.mountOpts).toEqual({ CaseInsensitive: 'true', NoAppleDouble: false });
    expect(settings.mounts[0]?.vfsOpts).toEqual({ PollInterval: '30s', ChunkStreams: 3 });
    expect(normalizeSettings(settings)).toEqual(settings);
  });

  it('normalizes update preferences, channels, install modes, and scheduled minutes', () => {
    expect(normalizeSettings({}).updates).toEqual({
      autoCheck: true,
      autoInstall: 'off',
      installMinute: DEFAULT_UPDATE_INSTALL_MINUTE,
      channel: 'stable',
    });
    expect(normalizeSettings({ updates: { autoCheck: false, channel: 'nightly' } }).updates).toMatchObject({ autoCheck: false, channel: 'nightly' });
    expect(normalizeSettings({ updates: { channel: 'beta' } }).updates.channel).toBe('stable');
    for (const autoInstall of UPDATE_INSTALL_MODES) {
      expect(normalizeSettings({ updates: { autoInstall } }).updates.autoInstall).toBe(autoInstall);
    }
    expect(normalizeSettings({ updates: { autoInstall: 'invalid', installMinute: '03:00' } }).updates).toMatchObject({
      autoInstall: 'off',
      installMinute: DEFAULT_UPDATE_INSTALL_MINUTE,
    });
    expect(normalizeSettings({ updates: { installMinute: -1 } }).updates.installMinute).toBe(0);
    expect(normalizeSettings({ updates: { installMinute: 1440 } }).updates.installMinute).toBe(1439);
    expect(normalizeSettings({ updates: { installMinute: 180.6 } }).updates.installMinute).toBe(181);
  });
});
