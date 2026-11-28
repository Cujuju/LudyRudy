import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { ActiveMount, CompletedTransfer, RemoteParameters, RemoteEntry, RemoteQuota, RemoteSummary, TransferStats, MountProfile } from '@shared/types';
import { isWindowsDrivePath } from './daemonPaths';
import { fileSystemDiagnostic, rcFailureDiagnostic } from './rcloneErrors';
import { decodeRcResponse, type RcItem, type RcResponse } from './rcloneResponses';

export type { RcItem } from './rcloneResponses';
export interface ObservedMount { source: string; view: ActiveMount }
type NoParams = Record<string, never>;
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
interface RcConfig {
  name: string;
  parameters: RemoteParameters;
  opt: { obscure: boolean; nonInteractive?: boolean; continue?: boolean; state?: string; result?: string };
}
interface RcSync { srcFs: string; dstFs: string; _async: true; _config: { DryRun: boolean }; _filter: { ExcludeRule: string[] } }
type VfsTarget = { fs?: string };
type VfsPaths = VfsTarget & Record<string, string | boolean | undefined>;

interface RcRequests {
  'rc/noop': Record<string, unknown>;
  'core/version': NoParams;
  'core/pid': NoParams;
  'core/quit': NoParams;
  'core/stats': NoParams;
  'core/stats-reset': NoParams;
  'core/transferred': NoParams;
  'core/bwlimit': { rate?: string };
  'config/listremotes': NoParams;
  'config/dump': NoParams;
  'config/get': { name: string };
  'config/paths': NoParams;
  'config/providers': NoParams;
  'config/create': RcConfig & { type: string };
  'config/update': RcConfig;
  'config/delete': { name: string };
  'mount/listmounts': NoParams;
  'mount/types': NoParams;
  'mount/mount': RcMountOptions;
  'mount/unmount': { mountPoint: string };
  'mount/unmountall': NoParams;
  'vfs/list': NoParams;
  'vfs/stats': VfsTarget;
  'vfs/refresh': VfsPaths;
  'vfs/forget': VfsPaths;
  'operations/list': RcListRequest;
  'operations/about': { fs: string };
  'operations/stat': RcFile;
  'operations/mkdir': RcFile;
  'operations/deletefile': RcFile;
  'operations/purge': RcFile;
  'operations/copyfile': RcCopyFile;
  'operations/movefile': RcCopyFile;
  'sync/move': { srcFs: string; dstFs: string; createEmptySrcDirs: boolean; deleteEmptySrcDirs: boolean; _config?: typeof NO_CLOBBER };
  'sync/copy': RcSync;
  'sync/sync': RcSync;
  'job/list': NoParams;
  'job/status': { jobid: number };
  'job/stop': { jobid: number };
}

const REQUEST_TIMEOUT_MS = 5_000;
const REMOTE_OPERATION_TIMEOUT_MS = 30_000;
const REMOTE_OPERATIONS = new Set<keyof RcRequests>([
  'operations/stat', 'operations/list', 'operations/about', 'operations/mkdir', 'operations/deletefile', 'vfs/refresh',
]);
const FILE_MUTATION_TIMEOUT_MS = 30 * 60_000;
const FILE_MUTATIONS = new Set<keyof RcRequests>(['sync/move', 'operations/copyfile', 'operations/movefile', 'operations/purge']);
const MOUNT_TIMEOUT_MS = 60_000;
const SAFE_CONFIG_KEYS = ['type', 'provider', 'region', 'filename_encryption', 'directory_name_encryption'];
const REMOTE_NAME = '[\\p{L}\\p{N}_.+@]+(?:[ -]+[\\p{L}\\p{N}_.+@-]+)*';
const VALID_REMOTE_NAME = new RegExp(`^(?:${REMOTE_NAME})$(?![\\s\\S])`, 'u');
export const validRemoteName = (name: unknown, windows: boolean): name is string => typeof name === 'string' && VALID_REMOTE_NAME.test(name)
  && !(windows && /^[a-z]$/i.test(name));
const PLAIN_TARGET = new RegExp(`^(${REMOTE_NAME}):`, 'u');
const INLINE_TARGET = new RegExp(`^(:?${REMOTE_NAME})[,:]`, 'u');

export function describeFs(fs: string, windows: boolean): { remote: string | null; path: string | null; display: string } {
  if (windows && isWindowsDrivePath(fs)) return { remote: null, path: fs, display: fs };
  const remote = PLAIN_TARGET.exec(fs)?.[1];
  if (remote) return { remote, path: fs.slice(remote.length + 1), display: fs };
  // Inline connection strings can carry passwords and OAuth tokens in their overrides.
  const inline = INLINE_TARGET.exec(fs)?.[1];
  if (inline || fs.startsWith(':')) return { remote: inline ?? null, path: null, display: inline ?? 'Inline backend' };
  return { remote: null, path: fs || null, display: fs };
}
export const remoteFs = (remote: string, path = '') => `${remote}:${path}`;

export class RcloneHttpError extends Error {
  constructor(method: string, readonly status: number, diagnostic?: string) {
    super(diagnostic ?? `rclone ${method} returned HTTP ${status}.`);
  }
}

export class RcloneClient {
  readonly endpoint: string;
  private readonly headers: Headers;
  private readonly mountKey = randomBytes(32);

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

  async call<K extends keyof RcRequests>(method: K, ...args: {} extends RcRequests[K] ? [RcRequests[K]?] : [RcRequests[K]]): Promise<RcResponse<K>> {
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
      const noClobber = !!params && '_config' in params && params._config === NO_CLOBBER;
      throw new RcloneHttpError(method, response.status, await rcFailureDiagnostic(method, response, noClobber));
    }
    return decodeRcResponse(method, await response.json().catch(() => null));
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
    const fsDisplay = (value: string | null | undefined) => value ? describeFs(value, windows).display : null;
    return { bytes, totalBytes, speed, eta, transfers, totalTransfers, checks, errors,
      transferring: (stats.transferring ?? []).map(({ name, bytes, size, speed, eta, srcFs, dstFs }) => ({
        name, size, bytes: bytes ?? 0, speed: speed ?? 0, eta: eta ?? null, srcFs: fsDisplay(srcFs), dstFs: fsDisplay(dstFs),
      })),
      bwLimit: limit.rate, bwLimitTx: limit.bytesPerSecondTx, bwLimitRx: limit.bytesPerSecondRx };
  }

  async observeMounts(windows: boolean): Promise<ObservedMount[]> {
    const { mountPoints } = await this.call('mount/listmounts');
    return (mountPoints ?? []).map(({ Fs, MountPoint, MountedOn }) => ({
      source: Fs,
      view: {
        id: createHmac('sha256', this.mountKey).update(JSON.stringify([Fs, MountPoint, MountedOn])).digest('hex'),
        profileId: null, fs: describeFs(Fs, windows).display, mountPoint: MountPoint, mountedOn: MountedOn ?? null, status: 'mounted',
      },
    }));
  }

  async mounts(windows = false): Promise<ActiveMount[]> {
    return (await this.observeMounts(windows)).map(({ view }) => view);
  }

  async mountTypes(): Promise<string[]> {
    const { mountTypes } = await this.call('mount/types');
    return mountTypes ?? [];
  }

  async refreshVfs(fs: string, directory: string, recursive: boolean): Promise<void> {
    const { result } = await this.call('vfs/refresh', { fs, ...(directory ? { dir: directory } : {}), recursive: String(recursive) });
    const outcome = Object.hasOwn(result, directory) ? result[directory] : undefined;
    if (outcome !== 'OK') {
      throw new Error(fileSystemDiagnostic(outcome) ?? 'rclone could not refresh the mount cache.');
    }
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
