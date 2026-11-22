import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';

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
});
