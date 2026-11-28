import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { AppSnapshot } from '@shared/ipc';
import { LOG_CAPACITY, type LogLine } from '@shared/types';
import { streamDaemonLogs } from './daemonLog';
import { argument, profileFile, resolveRclone } from './paths';
import { localVersion, mountBackend } from './prereqs';
import { RcloneClient, remoteFs, validRemoteName } from './rcloneClient';
import { getSettings, readConfigPassword } from './settingsStore';
import { createSerialQueue } from './serialQueue';

const ATTACHED_AUTH_ENV = 'LUDYRUDY_RCLONE_AUTH';
const attachedAuthFromEnvironment = process.env[ATTACHED_AUTH_ENV];
delete process.env[ATTACHED_AUTH_ENV];

const LOOPBACK = '127.0.0.1';
const RC_CREDENTIAL_BYTES = 32;
const START_TIMEOUT_MS = 8_000;
const START_RETRY_MS = 100;
const EXIT_TIMEOUT_MS = 1_500;
const ENCRYPTED_CONFIG_MARKER = 'RCLONE_ENCRYPT_V0:';
const CONFIG_HEADER_BYTES = 256;

export function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, LOOPBACK, () => {
      const address = server.address();
      server.close((error) => {
        if (error || !address || typeof address === 'string') reject(error ?? new Error('Could not allocate a daemon port.'));
        else resolve(address.port);
      });
    });
  });
}

export async function configEncrypted(path: string): Promise<boolean> {
  const file = await open(path, 'r').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (!file) return false;
  try {
    const bytes = Buffer.alloc(CONFIG_HEADER_BYTES);
    const { bytesRead } = await file.read(bytes);
    return bytes.toString('utf8', 0, bytesRead).split(/\r?\n/).includes(ENCRYPTED_CONFIG_MARKER);
  } finally {
    await file.close();
  }
}

export function managedPaths(config = getSettings().daemon) {
  return { configPath: config.configPath || profileFile('rclone.conf'), cacheDir: config.defaultCacheDir || profileFile('cache') };
}

interface Hooks {
  log?: (entry: LogLine) => void;
  change?: () => void;
  crashed?: () => void;
  ready?: () => void;
}

interface ManagedProcess {
  child: ChildProcess;
  finished: boolean;
  ready: boolean;
  closed: Promise<void>;
}

function waitForExit(process: ManagedProcess): Promise<void> {
  const timeout = new AbortController();
  return Promise.race([process.closed, delay(EXIT_TIMEOUT_MS, undefined, { signal: timeout.signal })])
    .finally(() => timeout.abort());
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'An unexpected rclone error occurred.';

export function openDaemon(hooks: Hooks = {}) {
  const configuredEndpoint = () => argument('--rclone-endpoint') ?? (getSettings().daemon.endpoint || undefined);
  const binary = resolveRclone(getSettings().daemon.binaryPath);
  let snapshot: AppSnapshot = {
    daemon: {
      state: 'stopped', mode: configuredEndpoint() === undefined ? 'managed' : 'attached',
      hostPlatform: configuredEndpoint() === undefined ? process.platform : null,
      endpoint: null, pid: null, version: null, ...binary,
      configPath: null, configEncrypted: null, attached: false, error: null,
    },
    prereqs: {
      platform: process.platform, rcloneInstalled: !!binary.binaryPath,
      rcloneVersion: null, rclonePath: binary.binaryPath, mountBackend: mountBackend(),
    },
    remotes: [], remoteRevision: 0, mounts: [], stats: null, dataError: null, logs: [], jobRuns: [],
  };
  let rc: RcloneClient | undefined;
  let managed: ManagedProcess | undefined;
  let remoteFingerprint: string | undefined;
  let inventoryEpoch = 0;
  let inventoryInvalidated = false;
  let refreshRequest: Promise<AppSnapshot> | undefined;
  const serialize = createSerialQueue();
  const probe = (path: string | null) => {
    void localVersion(path).then((version) => {
      if (snapshot.prereqs.rclonePath === path) snapshot = { ...snapshot, prereqs: { ...snapshot.prereqs, rcloneVersion: version } };
    });
  };
  if (snapshot.daemon.mode === 'managed') probe(binary.binaryPath);

  function append(entry: LogLine): void {
    snapshot = { ...snapshot, logs: [entry, ...snapshot.logs].slice(0, LOG_CAPACITY) };
    hooks.log?.(entry);
  }

  function status(patch: Partial<AppSnapshot['daemon']>): void {
    snapshot = { ...snapshot, daemon: { ...snapshot.daemon, ...patch } };
    hooks.change?.();
  }

  function disconnected(state: 'stopped' | 'error', error: string | null): void {
    snapshot = { ...snapshot, remotes: [], mounts: [], stats: null, dataError: null };
    status({ state, attached: false, pid: null, error, hostPlatform: snapshot.daemon.mode === 'managed' ? process.platform : null });
    if (error) append({ ts: new Date().toISOString(), level: 'error', message: error, source: 'app' });
  }

  async function collect(client: RcloneClient): Promise<AppSnapshot> {
    const epoch = inventoryEpoch;
    try {
      const { version, os } = await client.call('core/version');
      if (typeof version !== 'string' || !version) throw new Error('rclone returned no version.');
      const hostPlatform = snapshot.daemon.mode === 'managed' ? process.platform
        : os === 'windows' ? 'win32' : typeof os === 'string' && /^[a-z][a-z0-9]*$/.test(os) ? os : null;
      const [remotes, mounts, stats, pid, paths] = await Promise.allSettled([
        client.remoteInventory(hostPlatform === 'win32'), client.mounts(hostPlatform === 'win32'), client.stats(hostPlatform === 'win32'),
        client.call('core/pid'), client.call('config/paths'),
      ]);
      if (client !== rc) return snapshot;
      if (epoch !== inventoryEpoch) return refreshRequest ?? snapshot;
      const errors = [remotes, mounts, stats].flatMap((result) => result.status === 'rejected' ? [errorMessage(result.reason)] : []);
      const profiles = getSettings().mounts;
      const wasRunning = snapshot.daemon.state === 'running';
      const attached = snapshot.daemon.mode === 'attached';
      const child = managed;
      const firstReady = child !== undefined && !child.ready;
      if (!wasRunning) append({
        ts: new Date().toISOString(), level: 'info', source: 'app',
        message: attached ? 'Attached to rclone.' : firstReady ? 'Started managed rclone.' : 'Reconnected to managed rclone.',
      });
      const invalidated = inventoryInvalidated;
      inventoryInvalidated = false;
      const inventoryChanged = remotes.status === 'fulfilled' && remotes.value.fingerprint !== remoteFingerprint;
      if (remotes.status === 'fulfilled') remoteFingerprint = remotes.value.fingerprint;
      snapshot = {
        ...snapshot, dataError: errors.length ? errors.join(' ') : null,
        remoteRevision: snapshot.remoteRevision + Number(invalidated || inventoryChanged),
        remotes: remotes.status === 'fulfilled' ? remotes.value.remotes : invalidated ? [] : snapshot.remotes,
        mounts: mounts.status === 'fulfilled' ? mounts.value.map((mount) => ({
          ...mount, profileId: profiles.find((profile) => profile.mountPoint === mount.mountPoint && remoteFs(profile.remote, profile.remotePath) === mount.fs)?.id ?? null,
        })) : snapshot.mounts,
        stats: stats.status === 'fulfilled' ? stats.value : snapshot.stats,
      };
      status({
        state: 'running', version: /^v[\w.+-]+$/.test(version) ? version : null, attached, hostPlatform, error: null,
        pid: pid.status === 'fulfilled' ? pid.value.pid : managed?.child.pid ?? null,
        configPath: paths.status === 'fulfilled' ? paths.value.config : snapshot.daemon.configPath,
      });
      if (firstReady) {
        child.ready = true;
        hooks.ready?.();
      }
    } catch (error) {
      if (client === rc && epoch !== inventoryEpoch) return refreshRequest ?? snapshot;
      if (client === rc && snapshot.daemon.error !== errorMessage(error)) disconnected('error', errorMessage(error));
    }
    return snapshot;
  }

  function launch(path: string, args: string[], env: NodeJS.ProcessEnv, secrets: readonly string[] = []): ManagedProcess {
    const child = spawn(path, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const process: ManagedProcess = { child, finished: false, ready: false, closed: Promise.resolve() };
    process.closed = new Promise((resolve) => {
      child.on('error', () => {
        append({ ts: new Date().toISOString(), level: 'error', source: 'app', message: 'Could not run the rclone process.' });
      });
      child.once('close', () => {
        process.finished = true;
        resolve();
        if (managed !== process) return;
        managed = undefined;
        rc = undefined;
        refreshRequest = undefined;
        const started = snapshot.daemon.state !== 'starting';
        disconnected('error', started ? 'The managed rclone process exited unexpectedly.' : 'The managed rclone process exited during startup.');
        if (started) hooks.crashed?.();
      });
    });
    streamDaemonLogs(child.stdout, append, secrets);
    streamDaemonLogs(child.stderr, append, secrets);
    return process;
  }

  async function stop(): Promise<void> {
    const client = rc;
    const process = managed;
    rc = undefined;
    managed = undefined;
    refreshRequest = undefined;
    disconnected('stopped', null);
    status({ endpoint: null, version: null });
    if (!process || process.finished) return;
    if (client) {
      await client.call('mount/unmountall').catch((error: unknown) => {
        append({ ts: new Date().toISOString(), level: 'warn', source: 'app', message: errorMessage(error) });
      });
      await client.call('core/quit').catch(() => { /* The process can close the HTTP connection while quitting. */ });
      await waitForExit(process);
    }
    if (!process.finished) {
      process.child.kill('SIGTERM');
      await waitForExit(process);
    }
    if (!process.finished) {
      process.child.kill('SIGKILL');
      await waitForExit(process);
    }
    if (!process.finished) {
      managed = process;
      throw new Error('The rclone process did not exit.');
    }
  }

  async function start(): Promise<void> {
    if (rc || managed) return;
    const endpoint = configuredEndpoint();
    const config = getSettings().daemon;
    const binary = resolveRclone(config.binaryPath);
    snapshot = {
      ...snapshot,
      prereqs: { ...snapshot.prereqs, rcloneInstalled: !!binary.binaryPath, rclonePath: binary.binaryPath, mountBackend: mountBackend() },
    };
    if (endpoint === undefined) probe(binary.binaryPath);
    status({ state: 'starting', mode: endpoint === undefined ? 'managed' : 'attached', ...binary, error: null,
      hostPlatform: endpoint === undefined ? process.platform : null,
      configEncrypted: null, configPath: config.configPath || null });
    try {
      if (endpoint !== undefined) {
        const auth = attachedAuthFromEnvironment ?? argument('--rclone-auth');
        if (auth !== undefined && argument('--rclone-endpoint') === undefined) {
          throw new Error('Attached rclone credentials require an explicit --rclone-endpoint.');
        }
        rc = new RcloneClient(endpoint, auth);
        status({ endpoint: rc.endpoint });
        await collect(rc);
        return;
      }
      if (!binary.binaryPath) {
        throw new Error(config.binaryPath ? 'The custom rclone executable is unavailable.' : 'The rclone executable could not be found.');
      }
      const { cacheDir, configPath } = managedPaths(config);
      await Promise.all([mkdir(dirname(configPath), { recursive: true }), mkdir(cacheDir, { recursive: true })]);
      const encrypted = await configEncrypted(configPath);
      status({ configPath, configEncrypted: encrypted });
      const password = encrypted ? await readConfigPassword(configPath) : null;
      if (encrypted && !password) throw new Error('The rclone config requires its encryption password.');
      const user = randomBytes(RC_CREDENTIAL_BYTES).toString('hex');
      const pass = randomBytes(RC_CREDENTIAL_BYTES).toString('hex');
      const address = `${LOOPBACK}:${await availablePort()}`;
      const env = { ...process.env, RCLONE_RC_USER: user, RCLONE_RC_PASS: pass, RCLONE_CONFIG_PASS: password ?? '' };
      const client = new RcloneClient(`http://${address}`, `${user}:${pass}`);
      const secrets = [user, pass, ...(password ? [password] : [])];
      const child = launch(binary.binaryPath, ['rcd', '--rc-addr', address, '--config', configPath,
        '--cache-dir', cacheDir, '--use-json-log', '--log-level', 'INFO', '--ask-password=false', '--rc-no-auth=false'], env, secrets);
      managed = child;
      status({ endpoint: client.endpoint });
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (!child.finished && Date.now() < deadline) {
        const ready = await client.call('core/version').then(() => true, () => false);
        if (child.finished) break;
        if (ready) {
          // Force the first config load before accepting mutations.
          await client.call('config/listremotes');
          if (child.finished) break;
          if (config.bwLimit !== 'off') await client.call('core/bwlimit', { rate: config.bwLimit });
          if (child.finished) break;
          rc = client;
          await collect(client);
          return;
        }
        await delay(START_RETRY_MS);
      }
      throw new Error(child.finished ? 'The managed rclone process exited during startup.' : 'The managed rclone daemon did not become ready.');
    } catch (error) {
      await stop();
      disconnected('error', errorMessage(error));
      throw error;
    }
  }

  return {
    current: () => snapshot,
    async refreshLocal(): Promise<void> {
      const config = getSettings().daemon;
      const local = resolveRclone(config.binaryPath);
      const backend = mountBackend();
      const version = await localVersion(local.binaryPath);
      const path = managedPaths(config).configPath;
      const encrypted = configuredEndpoint() === undefined ? await configEncrypted(path) : null;
      const next = getSettings().daemon;
      if (next.binaryPath !== config.binaryPath || next.configPath !== config.configPath || next.endpoint !== config.endpoint) return;
      snapshot = { ...snapshot, prereqs: {
        ...snapshot.prereqs, rcloneInstalled: !!local.binaryPath, rclonePath: local.binaryPath, rcloneVersion: version, mountBackend: backend,
      } };
      if (!rc && !managed && snapshot.daemon.state !== 'starting') status({ ...local, configPath: encrypted === null ? null : path, configEncrypted: encrypted });
    },
    isCurrentClient: (client: RcloneClient) => rc === client,
    client(): RcloneClient {
      if (!rc || snapshot.daemon.state !== 'running') throw new Error('Connect to rclone first.');
      return rc;
    },
    forRemote(name: unknown): RcloneClient {
      if (!validRemoteName(name, snapshot.daemon.hostPlatform === 'win32')
        || !snapshot.remotes.some((remote) => remote.name === name)) throw new Error('Unknown rclone remote.');
      return this.client();
    },
    refresh() {
      if (!rc || snapshot.daemon.state === 'starting') return Promise.resolve(snapshot);
      if (!refreshRequest) {
        const request = collect(rc).finally(() => { if (refreshRequest === request) refreshRequest = undefined; });
        refreshRequest = request;
      }
      return refreshRequest;
    },
    invalidateRemoteInventory(): void {
      if (!rc || snapshot.daemon.state === 'starting') return;
      inventoryEpoch += 1;
      refreshRequest = undefined;
      inventoryInvalidated = true;
    },
    start: () => serialize(start),
    stop: () => serialize(stop),
    restart: () => serialize(async () => { await stop(); await start(); }),
    whileStopped: (action: () => Promise<void>, beforeStop?: (running: boolean) => void) => serialize(async () => {
      const running = !!managed;
      beforeStop?.(running);
      await stop();
      try {
        await action();
        const { configPath } = managedPaths();
        status({ configPath, configEncrypted: await configEncrypted(configPath) });
      } finally {
        if (running) await start();
      }
    }),
  };
}

export type RcloneSupervisor = ReturnType<typeof openDaemon>;
