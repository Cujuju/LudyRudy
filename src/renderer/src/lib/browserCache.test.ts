import { describe, expect, it, vi } from 'vitest';
import type { RemoteEntry, RemoteQuota } from '@shared/types';
import { createBrowserCache, parentRemotePath } from './browserCache';

const entry = (name: string): RemoteEntry => ({
  path: name, name, size: 128, mimeType: 'text/plain', modTime: '2026-01-01T00:00:00Z', isDir: false,
});

const quota = (used: number): RemoteQuota => ({
  total: 1000, used, free: 1000 - used, trashed: 0, other: 0,
});

describe('browserCache', () => {
  it('returns fresh cached listings without re-fetching and marks them stale after TTL', async () => {
    let clock = 1_000;
    const cache = createBrowserCache({ now: () => clock, directoryFreshMs: 10_000 });
    const fetchDir = vi.fn(async () => [entry('a.txt')]);

    await expect(cache.loadDirectory('drive', '', fetchDir)).resolves.toEqual([entry('a.txt')]);
    expect(cache.peekDirectory('drive', '')).toEqual({ items: [entry('a.txt')], fresh: true });
    await expect(cache.loadDirectory('drive', '', fetchDir)).resolves.toEqual([entry('a.txt')]);
    expect(fetchDir).toHaveBeenCalledTimes(1);

    clock += 10_000;
    expect(cache.peekDirectory('drive', '')).toEqual({ items: [entry('a.txt')], fresh: false });
    await cache.loadDirectory('drive', '', fetchDir);
    expect(fetchDir).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent requests for the same directory', async () => {
    let resolveFetch!: (items: RemoteEntry[]) => void;
    const fetchDir = vi.fn(() => new Promise<RemoteEntry[]>((resolve) => { resolveFetch = resolve; }));
    const cache = createBrowserCache();

    const first = cache.loadDirectory('drive', 'docs', fetchDir);
    const second = cache.loadDirectory('drive', 'docs', fetchDir);
    expect(fetchDir).toHaveBeenCalledTimes(1);

    resolveFetch([entry('docs/spec.md')]);
    await expect(Promise.all([first, second])).resolves.toEqual([[entry('docs/spec.md')], [entry('docs/spec.md')]]);
  });

  it('prevents an invalidated in-flight fetch from repopulating stale data', async () => {
    let resolveStale!: (items: RemoteEntry[]) => void;
    const cache = createBrowserCache();
    const inflight = cache.loadDirectory('drive', 'docs', () => new Promise((resolve) => { resolveStale = resolve; }));

    cache.invalidateDirectory('drive', 'docs');
    resolveStale([entry('docs/old.txt')]);
    await inflight;

    expect(cache.peekDirectory('drive', 'docs')).toBeUndefined();
  });

  it('invalidates nested subdirectories by prefix and evicts least-recently-used entries', async () => {
    const cache = createBrowserCache({ maxDirectories: 2 });
    await cache.loadDirectory('drive', 'a', async () => [entry('a/1')]);
    await cache.loadDirectory('drive', 'a/sub', async () => [entry('a/sub/2')]);
    expect(cache.peekDirectory('drive', 'a')?.fresh).toBe(true);
    await cache.loadDirectory('drive', 'b', async () => [entry('b/3')]);

    // 'a/sub' was least recently used and evicted when 'b' was inserted.
    expect(cache.peekDirectory('drive', 'a/sub')).toBeUndefined();
    expect(cache.peekDirectory('drive', 'a')).toBeDefined();
    expect(cache.peekDirectory('drive', 'b')).toBeDefined();

    cache.invalidatePrefix('drive', 'a');
    expect(cache.peekDirectory('drive', 'a')).toBeUndefined();
    expect(cache.peekDirectory('drive', 'b')).toBeDefined();
  });

  it('caches and invalidates remote quota independently and clears everything on reset', async () => {
    let clock = 500;
    const cache = createBrowserCache({ now: () => clock, quotaFreshMs: 30_000 });
    const fetchQuota = vi.fn(async () => quota(250));

    await expect(cache.loadQuota('drive', fetchQuota)).resolves.toEqual(quota(250));
    await expect(cache.loadQuota('drive', fetchQuota)).resolves.toEqual(quota(250));
    expect(fetchQuota).toHaveBeenCalledTimes(1);

    cache.clear();
    expect(cache.peekQuota('drive')).toBeUndefined();
  });

  it('computes parent paths for remote invalidation', () => {
    expect(parentRemotePath('')).toBe('');
    expect(parentRemotePath('top')).toBe('');
    expect(parentRemotePath('a/b/c')).toBe('a/b');
    expect(parentRemotePath('/a/b/')).toBe('a');
  });
});
