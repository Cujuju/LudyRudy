import type { ActiveMount, RemoteEntry, RemoteQuota, RemoteSummary, TransferStats } from '@shared/types';

export interface RcItem { Path: string; Name: string; Size: number; MimeType?: string; ModTime?: string; IsDir: boolean }
interface RcMount { Fs: string; MountPoint: string; MountedOn?: string }
interface RcStats extends Omit<TransferStats, 'bwLimit' | 'transferring'> { transferring?: TransferStats['transferring'] }
type ConfigDump = Record<string, Record<string, string>>;
type NoParams = Record<string, never>;

interface RcMethods {
  'rc/noop': [Record<string, unknown>, Record<string, unknown>];
  'core/version': [NoParams, { version: string; os?: string }];
  'core/pid': [NoParams, { pid: number }];
  'core/stats': [NoParams, RcStats];
  'core/transferred': [NoParams, { transferred: unknown[] }];
  'core/bwlimit': [{ rate?: string }, { rate: string }];
  'config/listremotes': [NoParams, { remotes: string[] | null }];
  'config/dump': [NoParams, ConfigDump];
  'config/paths': [NoParams, { config: string }];
  'config/providers': [NoParams, { providers: Record<string, unknown>[] }];
  'mount/listmounts': [NoParams, { mountPoints: RcMount[] }];
  'mount/mount': [{ fs: string; mountPoint: string }, { mountPoint: string }];
  'mount/unmount': [{ mountPoint: string }, Record<string, never>];
  'operations/list': [{ fs: string; remote: string }, { list: RcItem[] | null }];
  'operations/about': [{ fs: string }, Partial<RemoteQuota>];
  'job/list': [NoParams, { jobids: number[] }];
}

const REQUEST_TIMEOUT_MS = 5_000;
const SAFE_CONFIG_KEYS = ['type', 'provider', 'region', 'filename_encryption', 'directory_name_encryption'];
const REMOTE_NAME = '[\\p{L}\\p{N}_.+@]+(?:[ -]+[\\p{L}\\p{N}_.+@-]+)*';
const PLAIN_TARGET = new RegExp(`^(${REMOTE_NAME}):`, 'u');
const INLINE_TARGET = new RegExp(`^(:?${REMOTE_NAME})[,:]`, 'u');
const DRIVE_PATH = /^[a-z]:[\\/]/i;

function describeFs(fs: string, windows: boolean): { remote: string | null; path: string | null; display: string } {
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
    if (auth && auth.indexOf(':') < 1) throw new Error('--rclone-auth requires user:password.');
    url.pathname = url.pathname.replace(/\/*$/, '/');
    this.endpoint = url.href;
    this.headers = new Headers({ 'Content-Type': 'application/json' });
    if (auth) this.headers.set('Authorization', `Basic ${Buffer.from(auth).toString('base64')}`);
  }

  async call<K extends keyof RcMethods>(method: K, ...args: {} extends RcMethods[K][0] ? [RcMethods[K][0]?] : [RcMethods[K][0]]): Promise<RcMethods[K][1]> {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetch(new URL(method, this.endpoint), {
      method: 'POST', headers: this.headers, signal, redirect: 'error', body: JSON.stringify(args[0] ?? {}),
    }).catch(() => {
      throw new Error(signal.aborted ? `rclone ${method} timed out.` : `Could not reach rclone for ${method}.`);
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new RcloneHttpError(method, response.status);
    }
    const data: unknown = await response.json().catch(() => null);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`rclone ${method} returned invalid JSON data.`);
    }
    return data as RcMethods[K][1];
  }

  async listRemotes(windows = false): Promise<RemoteSummary[]> {
    const [{ remotes }, dump] = await Promise.all([this.call('config/listremotes'), this.call('config/dump')]);
    return (remotes ?? []).map((name) => {
      const raw = Object.hasOwn(dump, name) ? dump[name] ?? {} : {};
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
  }

  async stats(): Promise<TransferStats> {
    const [stats, limit] = await Promise.all([this.call('core/stats'), this.call('core/bwlimit')]);
    const { bytes, totalBytes, speed, eta, transfers, totalTransfers, checks, errors } = stats;
    return { bytes, totalBytes, speed, eta, transfers, totalTransfers, checks, errors,
      transferring: (stats.transferring ?? []).map(({ name, bytes, size, speed, eta }) => ({ name, bytes, size, speed, eta })),
      bwLimit: limit.rate };
  }

  async mounts(windows = false): Promise<ActiveMount[]> {
    const { mountPoints } = await this.call('mount/listmounts');
    return mountPoints.map(({ Fs, MountPoint, MountedOn }) => ({
      profileId: null, fs: describeFs(Fs, windows).display, mountPoint: MountPoint, mountedOn: MountedOn ?? null, status: 'mounted',
    }));
  }

  async list(remote: string, path: string): Promise<RemoteEntry[]> {
    const { list } = await this.call('operations/list', { fs: remoteFs(remote), remote: path });
    return (list ?? []).map((item) => ({
      path: item.Path, name: item.Name, size: item.Size, mimeType: item.MimeType ?? '',
      modTime: item.ModTime ?? '', isDir: item.IsDir,
    }));
  }

  async quota(remote: string): Promise<RemoteQuota> {
    const { total, used, free, trashed, other } = await this.call('operations/about', { fs: remoteFs(remote) });
    return { total: total ?? null, used: used ?? null, free: free ?? null, trashed: trashed ?? null, other: other ?? null };
  }
}
