import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { ActiveMount, CompletedTransfer, RemoteParameters, RemoteEntry, RemoteQuota, RemoteSummary, TransferStats, MountProfile } from '@shared/types';

export interface RcItem {
  Path: string;
  Name: string;
  Size: number;
  MimeType?: string;
  ModTime?: string;
  IsDir: boolean;
  ID?: string;
  Tier?: string;
  Encrypted?: string;
}
interface RcMount { Fs: string; MountPoint: string; MountedOn?: string }
interface RcStats extends Omit<TransferStats, 'bwLimit' | 'bwLimitTx' | 'bwLimitRx' | 'transferring'> { transferring?: TransferStats['transferring'] }
type ConfigDump = Record<string, Record<string, string>>;
type NoParams = Record<string, never>;

type RcResult = Record<string, unknown>;
export interface RcFile { fs: string; remote: string }
export interface RcListRequest extends RcFile { _config?: { UseServerModTime?: boolean }; opt?: { showEncrypted: boolean } }
// Force a transfer comparison so equal existing files also count as conflicts.
export const NO_CLOBBER = { Immutable: true, IgnoreTimes: true } as const;
export interface RcCopyFile { srcFs: string; srcRemote: string; dstFs: string; dstRemote: string; _config?: typeof NO_CLOBBER }
export interface RcMountOptions {
  fs: string;
  mountPoint: string;
  mountType?: string;
  mountOpt?: Record<string, string | boolean | number | string[]>;
  vfsOpt?: Record<string, string | boolean | number> & {
    CacheMode: MountProfile['vfsCacheMode']; CacheMaxSize?: string; CacheMaxAge?: string; ReadOnly: boolean;
  };
}
interface RcConfig { name: string; parameters: RemoteParameters; opt: { obscure: boolean; nonInteractive?: boolean } }
interface RcSync { srcFs: string; dstFs: string; _async: true; _config: { DryRun: boolean }; _filter: { ExcludeRule: string[] } }
interface RcJobStatus { executeId?: string; finished: boolean; success: boolean; error?: string }
interface RcTransfer { name: string; size: number; bytes: number; checked: boolean; started_at: string; completed_at: string; error?: string }
type VfsTarget = { fs?: string };
type VfsPaths = VfsTarget & Record<string, string | boolean | undefined>;

interface RcMethods {
  'rc/noop': [RcResult, RcResult];
  'core/version': [NoParams, { version: string; os?: string }];
  'core/pid': [NoParams, { pid: number }];
  'core/quit': [NoParams, RcResult];
  'core/stats': [NoParams, RcStats];
  'core/stats-reset': [NoParams, RcResult];
  'core/transferred': [NoParams, { transferred: RcTransfer[] | null }];
  'core/bwlimit': [{ rate?: string }, { rate: string; bytesPerSecondTx?: number; bytesPerSecondRx?: number }];
  'config/listremotes': [NoParams, { remotes: string[] | null }];
  'config/dump': [NoParams, ConfigDump];
  'config/paths': [NoParams, { config: string; cache?: string }];
  'config/providers': [NoParams, { providers: Record<string, unknown>[] }];
  'config/create': [RcConfig & { type: string }, RcResult];
  'config/update': [RcConfig, RcResult];
  'config/delete': [{ name: string }, RcResult];
  'mount/listmounts': [NoParams, { mountPoints: RcMount[] | null }];
  'mount/types': [NoParams, { mountTypes: string[] | null }];
  'mount/mount': [RcMountOptions, { mountPoint: string }];
  'mount/unmount': [{ mountPoint: string }, RcResult];
  'mount/unmountall': [NoParams, RcResult];
  'vfs/list': [NoParams, { vfses: string[] | null }];
  'vfs/stats': [VfsTarget, RcResult];
  'vfs/refresh': [VfsPaths, RcResult];
  'vfs/forget': [VfsPaths, RcResult];
  'operations/list': [RcListRequest, { list: RcItem[] | null }];
  'operations/about': [{ fs: string }, Partial<RemoteQuota>];
  'operations/stat': [RcFile, { item: RcItem | null }];
  'operations/mkdir': [RcFile, RcResult];
  'operations/deletefile': [RcFile, RcResult];
  'operations/purge': [RcFile, RcResult];
  'operations/copyfile': [RcCopyFile, RcResult];
  'operations/movefile': [RcCopyFile, RcResult];
  'sync/move': [{ srcFs: string; dstFs: string; createEmptySrcDirs: boolean; deleteEmptySrcDirs: boolean; _config?: typeof NO_CLOBBER }, RcResult];
  'sync/copy': [RcSync, { jobid: number; executeId?: string }];
  'sync/sync': [RcSync, { jobid: number; executeId?: string }];
  'job/list': [NoParams, { jobids: number[]; executeId?: string }];
  'job/status': [{ jobid: number }, RcJobStatus];
  'job/stop': [{ jobid: number }, RcResult];
}

const REQUEST_TIMEOUT_MS = 5_000;
const REMOTE_OPERATION_TIMEOUT_MS = 30_000;
const REMOTE_OPERATIONS = new Set<keyof RcMethods>([
  'operations/stat', 'operations/list', 'operations/about', 'operations/mkdir', 'operations/deletefile', 'vfs/refresh',
]);
const FILE_MUTATION_TIMEOUT_MS = 30 * 60_000;
const FILE_MUTATIONS = new Set<keyof RcMethods>(['sync/move', 'operations/copyfile', 'operations/movefile', 'operations/purge']);
const MOUNT_TIMEOUT_MS = 60_000;
const SAFE_CONFIG_KEYS = ['type', 'provider', 'region', 'filename_encryption', 'directory_name_encryption'];
const REMOTE_NAME = '[\\p{L}\\p{N}_.+@]+(?:[ -]+[\\p{L}\\p{N}_.+@-]+)*';
const VALID_REMOTE_NAME = new RegExp(`^(?:${REMOTE_NAME})$(?![\\s\\S])`, 'u');
export const validRemoteName = (name: unknown): name is string => typeof name === 'string' && VALID_REMOTE_NAME.test(name)
  && !(process.platform === 'win32' && /^[a-z]$/i.test(name));
const PLAIN_TARGET = new RegExp(`^(${REMOTE_NAME}):`, 'u');
const INLINE_TARGET = new RegExp(`^(:?${REMOTE_NAME})[,:]`, 'u');
const DRIVE_PATH = /^[a-z]:[\\/]/i;

export function describeFs(fs: string, windows: boolean): { remote: string | null; path: string | null; display: string } {
  if (windows && DRIVE_PATH.test(fs)) return { remote: null, path: fs, display: fs };
  const remote = PLAIN_TARGET.exec(fs)?.[1];
  if (remote) return { remote, path: fs.slice(remote.length + 1), display: fs };
  // Inline connection strings can carry passwords and OAuth tokens in their overrides.
  const inline = INLINE_TARGET.exec(fs)?.[1];
  if (inline || fs.startsWith(':')) return { remote: inline ?? null, path: null, display: inline ?? 'Inline backend' };
  return { remote: null, path: fs || null, display: fs };
}
export const remoteFs = (remote: string, path = '') => `${remote}:${path}`;

export class RcloneHttpError extends Error {
  constructor(method: string, readonly status: number) {
    super(`rclone ${method} returned HTTP ${status}.`);
  }
}

export class RcloneClient {
  readonly endpoint: string;
  private readonly headers: Headers;

  constructor(endpoint: string, auth?: string) {
    const url = URL.parse(endpoint);
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Use an HTTP(S) rclone endpoint without embedded credentials, query, or fragment.');
    }
    if (auth !== undefined) {
      if (auth.indexOf(':') < 1) throw new Error('rclone credentials require a username and password separated by a colon.');
      const host = url.hostname;
      const loopback = host === 'localhost' || host === '[::1]' || (isIP(host) === 4 && host.startsWith('127.'));
      if (url.protocol === 'http:' && !loopback) throw new Error('Use HTTPS for authenticated rclone endpoints outside loopback.');
    }
    url.pathname = url.pathname.replace(/\/*$/, '/');
    this.endpoint = url.href;
    this.headers = new Headers({ 'Content-Type': 'application/json' });
    if (auth) this.headers.set('Authorization', `Basic ${Buffer.from(auth).toString('base64')}`);
  }

  async call<K extends keyof RcMethods>(method: K, ...args: {} extends RcMethods[K][0] ? [RcMethods[K][0]?] : [RcMethods[K][0]]): Promise<RcMethods[K][1]> {
    const timeout = FILE_MUTATIONS.has(method)
      ? FILE_MUTATION_TIMEOUT_MS
      : method === 'mount/mount'
        ? MOUNT_TIMEOUT_MS
        : REMOTE_OPERATIONS.has(method)
          ? REMOTE_OPERATION_TIMEOUT_MS
          : REQUEST_TIMEOUT_MS;
    const signal = AbortSignal.timeout(timeout);
    const response = await fetch(new URL(method, this.endpoint), {
      method: 'POST', headers: this.headers, signal, redirect: 'error', body: JSON.stringify(args[0] ?? {}),
    }).catch(() => {
      throw new Error(signal.aborted ? `rclone ${method} timed out.` : `Could not reach rclone for ${method}.`);
    });
    if (!response.ok) {
      const params = args[0];
      if (response.status === 500 && params && '_config' in params && params._config === NO_CLOBBER) {
        const result: unknown = await response.json().catch(() => null);
        if (result && typeof result === 'object' && 'error' in result &&
          (result.error === 'immutable file modified' || result.error === 'is a directory not a file' ||
            result.error === 'is a file not a directory')) throw new Error('The destination already exists.');
      } else await response.body?.cancel();
      throw new RcloneHttpError(method, response.status);
    }
    const data: unknown = await response.json().catch(() => null);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`rclone ${method} returned invalid JSON data.`);
    }
    return data as RcMethods[K][1];
  }

  async listRemotes(windows = false): Promise<RemoteSummary[]> {
    return (await this.remoteInventory(windows)).remotes;
  }

  async remoteInventory(windows = false): Promise<{ remotes: RemoteSummary[]; fingerprint: string }> {
    const [{ remotes }, dump] = await Promise.all([this.call('config/listremotes'), this.call('config/dump')]);
    const names = remotes ?? [];
    const rawConfig = (name: string) => Object.hasOwn(dump, name) ? dump[name] ?? {} : {};
    const inventory = [...names].sort().map((name) => {
      const raw = rawConfig(name);
      return [name, Object.keys(raw).sort().map((key) => [key, raw[key]])];
    });
    // Keep the config fingerprint in main; the renderer receives only a revision counter.
    const fingerprint = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
    const summaries = names.map((name) => {
      const raw = rawConfig(name);
      const config = Object.fromEntries(SAFE_CONFIG_KEYS.flatMap((key) => typeof raw[key] === 'string' ? [[key, raw[key]]] : []));
      const isCrypt = config.type === 'crypt';
      const target = describeFs(isCrypt && typeof raw.remote === 'string' ? raw.remote : '', windows);
      if (target.display) config.remote = target.display;
      return {
        name, type: config.type ?? 'unknown', isCrypt,
        targetRemote: target.remote, targetPath: target.path,
        filenameEncryption: isCrypt ? config.filename_encryption ?? 'standard' : null,
        directoryNameEncryption: isCrypt ? !/^(?:false|f|0)$/i.test(config.directory_name_encryption ?? '') : null,
        config,
      };
    });
    return { remotes: summaries, fingerprint };
  }

  async stats(windows = false): Promise<TransferStats> {
    const [stats, limit] = await Promise.all([this.call('core/stats'), this.call('core/bwlimit')]);
    const { bytes, totalBytes, speed, eta, transfers, totalTransfers, checks, errors } = stats;
    const fsDisplay = (value: unknown) => typeof value === 'string' && value ? describeFs(value, windows).display : null;
    return { bytes, totalBytes, speed, eta, transfers, totalTransfers, checks, errors,
      transferring: (stats.transferring ?? []).map(({ name, bytes, size, speed, eta, srcFs, dstFs }) => ({
        name, bytes, size, speed, eta, srcFs: fsDisplay(srcFs), dstFs: fsDisplay(dstFs),
      })),
      bwLimit: limit.rate, bwLimitTx: limit.bytesPerSecondTx, bwLimitRx: limit.bytesPerSecondRx };
  }

  async mounts(windows = false): Promise<ActiveMount[]> {
    const { mountPoints } = await this.call('mount/listmounts');
    return (mountPoints ?? []).map(({ Fs, MountPoint, MountedOn }) => ({
      profileId: null, fs: describeFs(Fs, windows).display, mountPoint: MountPoint, mountedOn: MountedOn ?? null, status: 'mounted',
    }));
  }

  async list(remote: string, path: string, showEncrypted = false): Promise<RemoteEntry[]> {
    const { list } = await this.call('operations/list', {
      fs: remoteFs(remote), remote: path, _config: { UseServerModTime: true },
      ...(showEncrypted ? { opt: { showEncrypted } } : {}),
    });
    return (list ?? []).map(toRemoteEntry);
  }

  async stat(remote: string, path: string): Promise<RemoteEntry | null> {
    const { item } = await this.call('operations/stat', { fs: remoteFs(remote), remote: path });
    return item ? toRemoteEntry(item) : null;
  }

  async requireMissingDestination(remote: string, path: string): Promise<void> {
    if (await this.stat(remote, path)) throw new Error('The destination already exists.');
  }

  async transferred(): Promise<CompletedTransfer[]> {
    const { transferred } = await this.call('core/transferred');
    return (transferred ?? []).map(({ name, size, bytes, checked, started_at, completed_at, error }) => ({
      name, size, bytes, checked, startedAt: started_at, completedAt: completed_at, failed: !!error,
    }));
  }

  async quota(remote: string): Promise<RemoteQuota> {
    const { total, used, free, trashed, other } = await this.call('operations/about', { fs: remoteFs(remote) });
    return { total: total ?? null, used: used ?? null, free: free ?? null, trashed: trashed ?? null, other: other ?? null };
  }
}

function toRemoteEntry(item: RcItem): RemoteEntry {
  return {
    path: item.Path, name: item.Name, size: item.Size, mimeType: item.MimeType ?? '',
    modTime: item.ModTime ?? '', isDir: item.IsDir,
    ...(item.ID ? { id: item.ID } : {}),
    ...(item.Tier ? { tier: item.Tier } : {}),
    ...(item.Encrypted ? { encrypted: item.Encrypted } : {}),
  };
}
