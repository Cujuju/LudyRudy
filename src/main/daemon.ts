import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppSnapshot } from '@shared/ipc';
import type { LogLine, PrereqStatus } from '@shared/types';
import { argument, resolveRclone } from './paths';
import { RcloneClient, remoteFs } from './rcloneClient';
import { getSettings } from './settingsStore';

const LOG_CAPACITY = 200;
const BINARY_PROBE_TIMEOUT_MS = 3_000;

function localVersion(path: string | null): Promise<string | null> {
  if (!path) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(path, ['version'], { encoding: 'utf8', timeout: BINARY_PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : /^rclone (v\S+)/m.exec(stdout)?.[1] ?? null);
    });
  });
}

function mountBackend(): PrereqStatus['mountBackend'] {
  const detection = {
    darwin: { name: 'macFUSE', paths: ['/Library/Filesystems/macfuse.fs', '/Library/Filesystems/osxfuse.fs'], installUrl: 'https://macfuse.io/' },
    linux: { name: 'FUSE', paths: ['/dev/fuse'], installUrl: 'https://rclone.org/commands/rclone_mount/' },
    win32: { name: 'WinFsp', paths: [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
      .filter((dir): dir is string => !!dir).map((dir) => join(dir, 'WinFsp', 'bin')), installUrl: 'https://winfsp.dev/' },
  };
  const platform = process.platform;
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    return { available: false, name: 'FUSE', details: 'Unsupported platform', installUrl: '' };
  }
  const { name, paths, installUrl } = detection[platform];
  const available = paths.some(existsSync);
  return { available, name, details: available ? 'Detected on this computer' : 'Missing from standard locations', installUrl };
}

const log = (level: LogLine['level'], message: string): LogLine => ({ ts: new Date().toISOString(), level, message, source: 'app' });
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

export function openDaemon() {
  const { daemon: config, mounts: profiles } = getSettings();
  const binary = resolveRclone(config.binaryPath);
  const endpoint = argument('--rclone-endpoint') ?? config.endpoint;
  let client: RcloneClient | undefined;
  let setupError: string | null = null;
  try {
    if (endpoint) client = new RcloneClient(endpoint, argument('--rclone-auth'));
  } catch (error) {
    setupError = describe(error);
  }
  let snapshot: AppSnapshot = {
    daemon: {
      state: setupError ? 'error' : client ? 'starting' : 'stopped',
      endpoint: client?.endpoint ?? null, pid: null, version: null,
      ...binary, configPath: config.configPath || null, configEncrypted: null, attached: false, error: setupError,
    },
    prereqs: {
      platform: process.platform, rcloneInstalled: binary.binaryPath !== null,
      rcloneVersion: null, rclonePath: binary.binaryPath, mountBackend: mountBackend(),
    },
    remotes: [], mounts: [], stats: null, dataError: null,
    logs: [setupError ? log('error', setupError) : log('info', client ? 'Connecting to rclone.' : 'No rclone endpoint configured.')],
  };
  let inFlight: Promise<AppSnapshot> | undefined;
  const probe = localVersion(binary.binaryPath).then((version) => {
    snapshot = { ...snapshot, prereqs: { ...snapshot.prereqs, rcloneVersion: version } };
  });

  async function collect(rc: RcloneClient): Promise<AppSnapshot> {
    const errorBefore = snapshot.daemon.error;
    try {
      const { version, os } = await rc.call('core/version');
      if (typeof version !== 'string' || !version) throw new Error('rclone returned no version.');
      const [remotes, mounts, stats, pid, paths] = await Promise.allSettled([
        rc.listRemotes(os === 'windows'), rc.mounts(os === 'windows'), rc.stats(), rc.call('core/pid'), rc.call('config/paths'),
      ]);
      const errors = [remotes, mounts, stats].flatMap((result) => result.status === 'rejected' ? [describe(result.reason)] : []);
      const dataError = errors.length ? errors.join(' ') : null;
      let logs = snapshot.logs;
      if (!snapshot.daemon.attached) logs = [log('info', `Attached to rclone ${version}.`), ...logs];
      if (dataError && dataError !== snapshot.dataError) logs = [log('warn', dataError), ...logs];
      snapshot = {
        ...snapshot, logs: logs.slice(0, LOG_CAPACITY), dataError,
        daemon: { ...snapshot.daemon, state: 'running', version, attached: true, error: null,
          pid: pid.status === 'fulfilled' ? pid.value.pid : null,
          configPath: paths.status === 'fulfilled' ? paths.value.config : config.configPath || null },
        remotes: remotes.status === 'fulfilled' ? remotes.value : snapshot.remotes,
        mounts: mounts.status === 'fulfilled' ? mounts.value.map((mount) => ({
          ...mount, profileId: profiles.find((profile) => profile.mountPoint === mount.mountPoint && remoteFs(profile.remote, profile.remotePath) === mount.fs)?.id ?? null,
        })) : snapshot.mounts,
        stats: stats.status === 'fulfilled' ? stats.value : snapshot.stats,
      };
    } catch (error) {
      const message = describe(error);
      snapshot = {
        ...snapshot, daemon: { ...snapshot.daemon, state: 'error', pid: null, attached: false, error: message },
        logs: message === errorBefore ? snapshot.logs : [log('error', message), ...snapshot.logs].slice(0, LOG_CAPACITY),
      };
    }
    return snapshot;
  }

  return {
    current: () => snapshot,
    refresh() {
      inFlight ??= Promise.all([probe, client ? collect(client) : null])
        .then(() => snapshot).finally(() => { inFlight = undefined; });
      return inFlight;
    },
    forRemote(name: unknown): RcloneClient {
      if (!client || !snapshot.daemon.attached) throw new Error('Connect to rclone first.');
      if (typeof name !== 'string' || !snapshot.remotes.some((remote) => remote.name === name)) throw new Error('Unknown rclone remote.');
      return client;
    },
  };
}
