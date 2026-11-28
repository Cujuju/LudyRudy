import { describe, expect, it, vi } from 'vitest';
import type { RemoteEntry, RemoteQuota } from '@shared/types';
import { editedRemotePath, parentRemotePath, remotePath } from '@shared/remotePath';
import { createBrowserCache } from './browserCache';

const entry = (name: string): RemoteEntry => ({
  path: name, name, size: 128, mimeType: 'text/plain', modTime: '2026-01-01T00:00:00Z', isDir: false,
});

const quota = (used: number): RemoteQuota => ({
  total: 1000, used, free: 1000 - used, trashed: 0, other: 0,
});

describe('browserCache', () => {
  it('preserves unchanged parent segments when a textarea normalizes carriage returns', () => {
    expect(editedRemotePath('a\n/b\n//./new', 'a\r\n/b\r/old', 'darwin')).toBe('a\r\n/b\r/new');
    expect(editedRemotePath('other/b\n/new', 'a\r\n/b\r/old', 'darwin')).toBe('other/b\n/new');
    expect(editedRemotePath('a\n/child', 'a\r\n/', 'darwin')).toBe('a\r\n/child');
  });
  it('invalidates canonical paths without treating literal backslashes as separators', async () => {
    const cache = createBrowserCache();
    const backslash = 'parent/with\\slash';
    await cache.loadDirectory('drive', backslash, async () => []);
    await cache.loadDirectory('drive', 'parent/with/slash', async () => []);
    expect(cache.peekDirectory('drive', 'parent//./with\\slash/')).toBeDefined();
    cache.invalidatePrefix('drive', 'parent//./with\\slash/');
    expect(cache.peekDirectory('drive', backslash)).toBeUndefined();
    expect(cache.peekDirectory('drive', 'parent/with/slash')).toBeDefined();
  });

  it('preserves POSIX literals and guards relative path traversal and the root', () => {
    const literal = 'a/with\\slash\r\n.txt';
    expect(remotePath(literal, false, 'darwin')).toBe(literal);
    expect(() => remotePath(literal, false, 'win32')).toThrow('Invalid remote path');
    expect(() => remotePath(literal, false, null)).toThrow('Invalid remote path');
    expect(() => remotePath('/a')).toThrow('Invalid remote path');
    expect(() => remotePath('a/../b')).toThrow('Invalid remote path');
    expect(() => remotePath('a/\0')).toThrow('Invalid remote path');
    expect(remotePath('././', true)).toBe('');
    expect(() => remotePath('././')).toThrow('below the remote root');
  });

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

  it('keeps a forced refresh result when superseded requests complete later', async () => {
    const cache = createBrowserCache();
    let resolveListing!: (value: RemoteEntry[]) => void;
    let resolveQuota!: (value: RemoteQuota) => void;

    const listing = cache.loadDirectory('drive', '', () => new Promise((resolve) => { resolveListing = resolve; }));
    const capacity = cache.loadQuota('drive', () => new Promise((resolve) => { resolveQuota = resolve; }));
    await Promise.all([
      cache.loadDirectory('drive', '', async () => [entry('new.txt')], { force: true }),
      cache.loadQuota('drive', async () => quota(500), { force: true }),
    ]);
    resolveListing([entry('old.txt')]);
    resolveQuota(quota(250));
    await Promise.all([listing, capacity]);

    expect(cache.peekDirectory('drive', '')?.items).toEqual([entry('new.txt')]);
    expect(cache.peekQuota('drive')?.value).toEqual(quota(500));
  });

  it.each(['success', 'failure'])('keeps the forced request pending after the older request settles (%s)', async (outcome) => {
    const cache = createBrowserCache();
    let resolveOld!: (value: RemoteEntry[]) => void;
    let resolveNew!: (value: RemoteEntry[]) => void;
    let rejectNew!: (error: Error) => void;
    const old = cache.loadDirectory('drive', '', () => new Promise((resolve) => { resolveOld = resolve; }));
    const forced = cache.loadDirectory('drive', '', () => new Promise((resolve, reject) => {
      resolveNew = resolve;
      rejectNew = reject;
    }), { force: true });
    resolveOld([entry('old.txt')]);
    await old;
    expect(cache.peekDirectory('drive', '')).toBeUndefined();
    expect(cache.loadDirectory('drive', '', async () => [])).toBe(forced);

    if (outcome === 'failure') {
      rejectNew(new Error('Listing failed'));
      await expect(forced).rejects.toThrow('Listing failed');
      expect(cache.peekDirectory('drive', '')).toBeUndefined();
    } else {
      resolveNew([entry('new.txt')]);
      await forced;
      expect(cache.peekDirectory('drive', '')?.items).toEqual([entry('new.txt')]);
    }
  });

  it.each(['targeted', 'clear'])('does not cache pending directory or quota data after %s invalidation', async (mode) => {
    const cache = createBrowserCache();
    const listing = cache.loadDirectory('drive', 'docs/nested', async () => [entry('old.txt')]);
    const capacity = cache.loadQuota('drive', async () => quota(100));
    if (mode === 'clear') cache.clear();
    else {
      cache.invalidatePrefix('drive', 'docs');
      cache.invalidateQuota('drive');
    }
    await Promise.all([listing, capacity]);
    expect(cache.peekDirectory('drive', 'docs/nested')).toBeUndefined();
    expect(cache.peekQuota('drive')).toBeUndefined();
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
    expect(parentRemotePath('a//./b/')).toBe('a');
  });
});
