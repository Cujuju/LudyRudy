import { describe, expect, it } from 'vitest';
import type { AppSnapshot } from '@shared/ipc';
import type { RemoteSummary } from '@shared/types';
import { daemonSourceLabel, deriveOnboarding } from './onboarding';

const snapshot: AppSnapshot = {
  remoteRevision: 0,
  daemon: {
    state: 'running', endpoint: null, pid: null, version: 'v1.73.0', binaryPath: null,
    binarySource: 'bundled', configPath: null, configEncrypted: null, attached: false, mode: 'managed', hostPlatform: 'win32', error: null,
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
      canDismiss: false,
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

  it('stays active after adding a remote when no mounts exist yet', () => {
    const model = deriveOnboarding({ ...snapshot, remotes: [remote] }, 0);
    expect(model.show).toBe(true);
    expect(model.canDismiss).toBe(true);
    expect(model.steps[1]).toMatchObject({ state: 'done', detail: '1 remote configured.' });
    expect(model.steps[2]).toMatchObject({
      state: 'current',
      action: { kind: 'new-mount', label: 'New mount' },
    });
  });

  it('hides once a remote and a mount profile or active mount exist', () => {
    expect(deriveOnboarding({ ...snapshot, remotes: [remote] }, 1)).toEqual({ show: false, canDismiss: false, steps: [] });
    expect(deriveOnboarding({
      ...snapshot,
      remotes: [remote],
      mounts: [{ profileId: null, fs: 'drive:', mountPoint: 'Z:\\', mountedOn: null, status: 'mounted' }],
    }, 0)).toEqual({ show: false, canDismiss: false, steps: [] });
  });

  it.each(['stopped', 'starting', 'error'] as const)('hides the guide while the managed engine is %s', (state) => {
    const daemon = { ...snapshot.daemon, state, version: null };
    expect(deriveOnboarding({ ...snapshot, daemon })).toEqual({ show: false, canDismiss: false, steps: [] });
  });

  it('hides the guide when remotes could not be loaded', () => {
    expect(deriveOnboarding({ ...snapshot, dataError: 'Failed to list remotes.' })).toEqual({ show: false, canDismiss: false, steps: [] });
  });

  it.each(['stopped', 'starting', 'error'] as const)('offers settings when the managed binary is missing while %s', (state) => {
    const daemon = { ...snapshot.daemon, state, binarySource: 'missing', error: 'rclone unavailable' } as const;
    const model = deriveOnboarding({ ...snapshot, daemon });
    expect(model.show).toBe(true);
    expect(model.steps[0]).toMatchObject({
      state: 'attention', detail: 'No rclone binary was found. Choose an rclone executable in Settings.',
      action: { kind: 'open-settings', label: 'Open settings' },
    });
    expect(model.steps[1]).toMatchObject({
      state: 'upcoming', detail: 'Start the rclone engine first, then connect a cloud storage provider.',
    });
  });

  it.each([
    ['stopped', null],
    ['error', 'Could not reach the external daemon.'],
  ] as const)('hides the guide while the external daemon is %s', (state, error) => {
    const daemon = { ...snapshot.daemon, mode: 'attached', attached: true, binarySource: 'missing', state, error } as const;
    expect(deriveOnboarding({ ...snapshot, daemon })).toEqual({ show: false, canDismiss: false, steps: [] });
  });

  it('offers the mount backend installer when a remote exists without a mount backend', () => {
    const mountBackend = { ...snapshot.prereqs.mountBackend, available: false };
    const prereqs = { ...snapshot.prereqs, mountBackend };
    const model = deriveOnboarding({ ...snapshot, prereqs, remotes: [remote] }, 0);
    expect(model.steps[2]).toMatchObject({
      state: 'current',
      action: { kind: 'install-mount-backend', label: 'Install WinFsp' },
    });
  });

  it('falls back to Open browser when a remote exists and no mount installer URL is available', () => {
    const mountBackend = { ...snapshot.prereqs.mountBackend, available: false, installUrl: '' };
    const prereqs = { ...snapshot.prereqs, mountBackend };
    const model = deriveOnboarding({ ...snapshot, prereqs, remotes: [remote] }, 0);
    expect(model.steps[2]).toMatchObject({
      state: 'current',
      action: { kind: 'open-browser', label: 'Open browser' },
    });
  });
});
