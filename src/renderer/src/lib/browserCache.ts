import type { RemoteEntry, RemoteQuota } from '@shared/types';

export const DIRECTORY_FRESH_MS = 60_000;
export const QUOTA_FRESH_MS = 5 * 60_000;
export const MAX_CACHED_DIRECTORIES = 200;

interface CacheRecord<T> {
  value: T;
  fetchedAt: number;
}

export interface BrowserCacheOptions {
  now?: () => number;
  directoryFreshMs?: number;
  quotaFreshMs?: number;
  maxDirectories?: number;
}

const dirKey = (remote: string, path: string) => `${remote}\0${path}`;

export function parentRemotePath(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, '');
  const slash = trimmed.lastIndexOf('/');
  return slash < 0 ? '' : trimmed.slice(0, slash);
}

export function createBrowserCache(options: BrowserCacheOptions = {}) {
  const now = options.now ?? Date.now;
  const directoryFreshMs = options.directoryFreshMs ?? DIRECTORY_FRESH_MS;
  const quotaFreshMs = options.quotaFreshMs ?? QUOTA_FRESH_MS;
  const maxDirectories = options.maxDirectories ?? MAX_CACHED_DIRECTORIES;

  const directories = new Map<string, CacheRecord<RemoteEntry[]>>();
  const pendingDirs = new Map<string, Promise<RemoteEntry[]>>();
  const quotas = new Map<string, CacheRecord<RemoteQuota>>();
  const pendingQuotas = new Map<string, Promise<RemoteQuota>>();
  const dirVersions = new Map<string, number>();
  const quotaVersions = new Map<string, number>();
  let globalVersion = 0;

  const versionOf = (map: Map<string, number>, key: string) => `${globalVersion}:${map.get(key) ?? 0}`;
  const bump = (map: Map<string, number>, key: string) => { map.set(key, (map.get(key) ?? 0) + 1); };

  function touchDirectory(key: string, record: CacheRecord<RemoteEntry[]>): void {
    directories.delete(key);
    directories.set(key, record);
    while (directories.size > maxDirectories) {
      const oldest = directories.keys().next().value;
      if (oldest === undefined) break;
      directories.delete(oldest);
    }
  }

  function peekDirectory(remote: string, path: string): { items: RemoteEntry[]; fresh: boolean } | undefined {
    const key = dirKey(remote, path);
    const record = directories.get(key);
    if (!record) return undefined;
    touchDirectory(key, record);
    return { items: record.value, fresh: now() - record.fetchedAt < directoryFreshMs };
  }

  function loadDirectory(remote: string, path: string, fetcher: () => Promise<RemoteEntry[]>, opts?: { force?: boolean }): Promise<RemoteEntry[]> {
    const key = dirKey(remote, path);
    if (!opts?.force) {
      const cached = peekDirectory(remote, path);
      if (cached?.fresh) return Promise.resolve(cached.items);
      const inflight = pendingDirs.get(key);
      if (inflight) return inflight;
    }
    const version = versionOf(dirVersions, key);
    const request = fetcher().then((items) => {
      if (versionOf(dirVersions, key) === version) touchDirectory(key, { value: items, fetchedAt: now() });
      return items;
    }).finally(() => {
      if (pendingDirs.get(key) === request) pendingDirs.delete(key);
    });
    pendingDirs.set(key, request);
    return request;
  }

  function invalidateDirectory(remote: string, path: string): void {
    const key = dirKey(remote, path);
    directories.delete(key);
    pendingDirs.delete(key);
    bump(dirVersions, key);
  }

  function invalidatePrefix(remote: string, prefix: string): void {
    const normalized = prefix.replace(/^\/+|\/+$/g, '');
    const exact = dirKey(remote, normalized);
    const childPrefix = normalized ? `${exact}/` : `${remote}\0`;
    for (const key of [...directories.keys(), ...pendingDirs.keys()]) {
      if (key === exact || key.startsWith(childPrefix)) {
        directories.delete(key);
        pendingDirs.delete(key);
        bump(dirVersions, key);
      }
    }
  }

  function peekQuota(remote: string): { value: RemoteQuota; fresh: boolean } | undefined {
    const record = quotas.get(remote);
    if (!record) return undefined;
    return { value: record.value, fresh: now() - record.fetchedAt < quotaFreshMs };
  }

  function loadQuota(remote: string, fetcher: () => Promise<RemoteQuota>, opts?: { force?: boolean }): Promise<RemoteQuota> {
    if (!opts?.force) {
      const cached = peekQuota(remote);
      if (cached?.fresh) return Promise.resolve(cached.value);
      const inflight = pendingQuotas.get(remote);
      if (inflight) return inflight;
    }
    const version = versionOf(quotaVersions, remote);
    const request = fetcher().then((value) => {
      if (versionOf(quotaVersions, remote) === version) quotas.set(remote, { value, fetchedAt: now() });
      return value;
    }).finally(() => {
      if (pendingQuotas.get(remote) === request) pendingQuotas.delete(remote);
    });
    pendingQuotas.set(remote, request);
    return request;
  }

  function invalidateQuota(remote: string): void {
    quotas.delete(remote);
    pendingQuotas.delete(remote);
    bump(quotaVersions, remote);
  }

  function clear(): void {
    globalVersion += 1;
    directories.clear();
    pendingDirs.clear();
    quotas.clear();
    pendingQuotas.clear();
    dirVersions.clear();
    quotaVersions.clear();
  }

  return {
    peekDirectory,
    loadDirectory,
    invalidateDirectory,
    invalidatePrefix,
    peekQuota,
    loadQuota,
    invalidateQuota,
    clear,
  };
}

export type BrowserCache = ReturnType<typeof createBrowserCache>;
