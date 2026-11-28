import type { RemoteEntry, RemoteQuota } from '@shared/types';
import { remotePath } from '@shared/remotePath';

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

const dirKey = (remote: string, path: string) => `${remote}\0${remotePath(path, true)}`;

function createResourceCache<T>(now: () => number, freshMs: number, maxEntries = Infinity) {
  const records = new Map<string, CacheRecord<T>>();
  const pending = new Map<string, Promise<T>>();

  function remember(key: string, record: CacheRecord<T>): void {
    records.delete(key);
    records.set(key, record);
    while (records.size > maxEntries) {
      const oldest = records.keys().next().value;
      if (oldest === undefined) break;
      records.delete(oldest);
    }
  }

  function peek(key: string) {
    const record = records.get(key);
    if (!record) return undefined;
    remember(key, record);
    return { value: record.value, fresh: now() - record.fetchedAt < freshMs };
  }

  function load(key: string, fetcher: () => Promise<T>, opts?: { force?: boolean }): Promise<T> {
    if (!opts?.force) {
      const cached = peek(key);
      if (cached?.fresh) return Promise.resolve(cached.value);
      const inflight = pending.get(key);
      if (inflight) return inflight;
    }
    const request = fetcher().then((value) => {
      if (pending.get(key) === request) remember(key, { value, fetchedAt: now() });
      return value;
    }).finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
    pending.set(key, request);
    return request;
  }

  function invalidate(key: string): void {
    records.delete(key);
    pending.delete(key);
  }

  return {
    peek, load, invalidate,
    invalidateMatching(matches: (key: string) => boolean): void {
      for (const key of [...records.keys(), ...pending.keys()]) {
        if (matches(key)) invalidate(key);
      }
    },
    clear(): void {
      records.clear();
      pending.clear();
    },
  };
}

export function createBrowserCache(options: BrowserCacheOptions = {}) {
  const now = options.now ?? Date.now;
  const directories = createResourceCache<RemoteEntry[]>(now, options.directoryFreshMs ?? DIRECTORY_FRESH_MS,
    options.maxDirectories ?? MAX_CACHED_DIRECTORIES);
  const quotas = createResourceCache<RemoteQuota>(now, options.quotaFreshMs ?? QUOTA_FRESH_MS);

  return {
    peekDirectory(remote: string, path: string) {
      const record = directories.peek(dirKey(remote, path));
      return record && { items: record.value, fresh: record.fresh };
    },
    loadDirectory(remote: string, path: string, fetcher: () => Promise<RemoteEntry[]>, opts?: { force?: boolean }) {
      return directories.load(dirKey(remote, path), fetcher, opts);
    },
    invalidateDirectory(remote: string, path: string): void {
      directories.invalidate(dirKey(remote, path));
    },
    invalidatePrefix(remote: string, prefix: string): void {
      const exact = dirKey(remote, prefix);
      const childPrefix = exact === `${remote}\0` ? exact : `${exact}/`;
      directories.invalidateMatching((key) => key === exact || key.startsWith(childPrefix));
    },
    peekQuota: quotas.peek,
    loadQuota: quotas.load,
    invalidateQuota: quotas.invalidate,
    clear(): void {
      directories.clear();
      quotas.clear();
    },
  };
}

export type BrowserCache = ReturnType<typeof createBrowserCache>;
