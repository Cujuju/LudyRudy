import { describe, expect, it } from 'vitest';
import type { AppSnapshot } from '@shared/ipc';
import type { RemoteSummary } from '@shared/types';
import { daemonSourceLabel, deriveOnboarding } from './onboarding';

const snapshot: AppSnapshot = {
  daemon: {
    state: 'running', endpoint: null, pid: null, version: 'v1.73.0', binaryPath: null,
    binarySource: 'bundled', configPath: null, configEncrypted: null, attached: false, mode: 'managed', error: null,
  },
  prereqs: {
    platform: 'win32', rcloneInstalled: true, rcloneVersion: null, rclonePath: null,
    mountBackend: { available: true, name: 'WinFsp', details: '', installUrl: 'https://winfsp.dev/' },
  },
  remotes: [], mounts: [], stats: null, logs: [], dataError: null, jobRuns: [],
};

const remote: RemoteSummary = {
  name: 'drive', type: 'drive', isCrypt: false, targetRemote: null, targetPath: null,
  filenameEncryption: null, directoryNameEncryption: null, config: {},
};

describe('daemonSourceLabel', () => {
  it.each([
    ['bundled', 'Bundled rclone v1.73.0'],
    ['path', 'System rclone (PATH) v1.73.0'],
    ['override', 'Custom rclone v1.73.0'],
    ['missing', 'rclone binary missing'],
  ] as const)('labels the managed %s source', (binarySource, label) => {
    expect(daemonSourceLabel({ ...snapshot.daemon, binarySource })).toBe(label);
  });

  it('labels the external daemon regardless of the local binary source', () => {
    const daemon = { ...snapshot.daemon, mode: 'attached', binarySource: 'missing' } as const;
    expect(daemonSourceLabel(daemon)).toBe('External rclone daemon v1.73.0');
    expect(daemonSourceLabel({ ...daemon, version: null })).toBe('External rclone daemon');
  });
});

describe('deriveOnboarding', () => {
  it('guides a connected first-time user to add a remote', () => {
    expect(deriveOnboarding(snapshot)).toEqual({
      show: true,
      steps: [
        {
          id: 'engine', title: 'rclone engine', state: 'done',
          detail: 'Bundled rclone v1.73.0 is running in the background.',
        },
        {
          id: 'remote', title: 'Connect a cloud remote', state: 'current',
          detail: 'Link Google Drive, S3, Dropbox, SFTP, or any rclone storage provider.',
          action: { kind: 'add-remote', label: 'Add remote' },
        },
        {
          id: 'use', title: 'Mount a drive or browse files', state: 'upcoming',
          detail: 'After adding a remote, wrap it with client-side encryption, browse files, or mount it as a local drive.',
        },
      ],
    });
  });

  it.each(['stopped', 'starting', 'error'] as const)('hides the guide while the managed engine is %s', (state) => {
    const daemon = { ...snapshot.daemon, state, version: null };
    expect(deriveOnboarding({ ...snapshot, daemon })).toEqual({ show: false, steps: [] });
  });

  it('hides the guide when remotes could not be loaded', () => {
    expect(deriveOnboarding({ ...snapshot, dataError: 'Failed to list remotes.' })).toEqual({ show: false, steps: [] });
  });

  it.each(['stopped', 'starting', 'error'] as const)('offers settings when the managed binary is missing and the engine is %s', (state) => {
    const daemon = { ...snapshot.daemon, state, binarySource: 'missing', version: null } as const;
    const model = deriveOnboarding({ ...snapshot, daemon });
    expect(model.show).toBe(true);
    const [engine, connect] = model.steps;
    expect(engine).toMatchObject({
      state: 'attention', detail: 'No rclone binary was found. Choose an rclone executable in Settings.',
      action: { kind: 'open-settings', label: 'Open settings' },
    });
    expect(connect).toMatchObject({
      state: 'upcoming', detail: 'Start the rclone engine first, then connect a cloud storage provider.',
    });
  });

  it.each([
    ['stopped', null],
    ['error', 'Could not reach the external daemon.'],
  ] as const)('hides the guide while the external daemon is %s', (state, error) => {
    const daemon = { ...snapshot.daemon, mode: 'attached', attached: true, binarySource: 'missing', state, error } as const;
    expect(deriveOnboarding({ ...snapshot, daemon })).toEqual({ show: false, steps: [] });
  });

  it('hides the guide once a remote is configured', () => {
    expect(deriveOnboarding({ ...snapshot, remotes: [remote] })).toEqual({ show: false, steps: [] });
  });

  it('offers a mount backend installer for a local daemon', () => {
    const mountBackend = { ...snapshot.prereqs.mountBackend, available: false };
    const prereqs = { ...snapshot.prereqs, mountBackend };
    expect(deriveOnboarding({ ...snapshot, prereqs }).steps[2]).toMatchObject({
      state: 'upcoming',
      detail: 'Browse files or wrap a remote with encryption anytime. Install WinFsp to mount remotes as local drives.',
      action: { kind: 'install-mount-backend', label: 'Install WinFsp' },
    });
  });

  it.each([
    [true, 'https://winfsp.dev/'],
    [false, ''],
  ] as const)('omits the installer when attached is %s and the installer URL is %j', (attached, installUrl) => {
    const daemon = { ...snapshot.daemon, attached, mode: attached ? 'attached' : 'managed' } as const;
    const mountBackend = { ...snapshot.prereqs.mountBackend, available: false, installUrl };
    const prereqs = { ...snapshot.prereqs, mountBackend };
    const use = deriveOnboarding({ ...snapshot, daemon, prereqs }).steps[2];
    expect(use).toMatchObject({ id: 'use', state: 'upcoming' });
    expect(use?.action).toBeUndefined();
  });
});
