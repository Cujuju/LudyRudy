import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncJob } from '@shared/types';
import { openJobManager } from './jobManager';
import { RcloneClient } from './rcloneClient';

const draft: SyncJob = {
  id: 'backup', name: 'Backup', mode: 'sync', source: 'drive:photos', destination: 'vault:backup',
  excludes: ['*.tmp'], dryRunDefault: true, enabled: true,
};

function fixture(initial: SyncJob[] = [draft]) {
  const status = { finished: false, success: false, executeId: 'daemon' };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
    switch (new URL(String(input)).pathname) {
      case '/sync/sync':
      case '/sync/copy': return Response.json({ jobid: 16, executeId: 'daemon' });
      case '/job/status': return Response.json({ ...status, error: crypto.randomUUID() });
      case '/job/stop': status.finished = true; return Response.json({});
      default: return Response.json({}, { status: 404 });
    }
  });
  vi.stubGlobal('fetch', fetch);
  let jobs = initial;
  const notify = vi.fn();
  const change = vi.fn();
  const rc = new RcloneClient('http://localhost:5572');
  const manager = openJobManager({ client: () => rc, jobs: () => jobs, save: (value) => { jobs = value; }, notify, change });
  return { manager, fetch, status, notify, change };
}

afterEach(() => vi.unstubAllGlobals());

describe('JobManager', () => {
  it('persists job changes and rejects malformed or identical endpoints', () => {
    const { manager } = fixture([]);
    const { id: _, ...input } = draft;
    expect(() => manager.save({ ...input, destination: ':s3,token=x:' })).toThrow('configured remote path');
    expect(() => manager.save({ ...input, destination: input.source })).toThrow('same');
    const job = manager.save(input);
    expect(manager.save({ ...job, mode: 'copy' }).mode).toBe('copy');
    manager.delete(job.id);
    expect(manager.list()).toEqual([]);
  });

  it('dispatches async jobs, polls status and emits one completion notice', async () => {
    const { manager, fetch, status, notify, change } = fixture();
    await expect(manager.runJob(draft.id)).resolves.toMatchObject({ dryRun: true, state: 'running', rcloneJobId: 16 });
    await expect(manager.runJob(draft.id)).rejects.toThrow('already running');
    const [url, opts] = fetch.mock.lastCall!;
    expect(new URL(String(url)).pathname).toBe('/sync/sync');
    expect(JSON.parse(String(opts?.body))).toEqual({
      srcFs: draft.source, dstFs: draft.destination, _async: true, _config: { DryRun: true }, _filter: { ExcludeRule: draft.excludes },
    });
    await manager.poll();
    expect(manager.runs()[0]?.state).toBe('running');
    status.finished = status.success = true;
    await manager.poll();
    await manager.poll();
    expect(manager.runs()[0]).toMatchObject({ state: 'finished', error: null, finishedAt: expect.any(String) });
    expect(notify).toHaveBeenCalledExactlyOnceWith('jobCompleted', 'Job completed', 'Backup');
    expect(change).toHaveBeenCalledTimes(2);
  });

  it('stops a running copy and uses the explicit dry-run override', async () => {
    const { manager, fetch, notify } = fixture([{ ...draft, mode: 'copy' }]);
    await manager.runJob(draft.id, { dryRun: false });
    expect(new URL(String(fetch.mock.lastCall?.[0])).pathname).toBe('/sync/copy');
    expect(manager.runs()[0]?.dryRun).toBe(false);
    await manager.stopJob(16);
    expect(new URL(String(fetch.mock.lastCall?.[0])).pathname).toBe('/job/stop');
    await manager.poll();
    expect(manager.runs()[0]?.state).toBe('stopped');
    expect(notify).not.toHaveBeenCalled();
  });

  it('emits a safe failure when the daemon instance changes', async () => {
    const { manager, status, notify } = fixture();
    await manager.runJob(draft.id);
    status.executeId = 'other';
    await expect(manager.stopJob(16)).rejects.toThrow('restarted');
    await manager.poll();
    expect(manager.runs()[0]).toMatchObject({ state: 'failed', error: 'The rclone daemon restarted.' });
    expect(notify).toHaveBeenCalledExactlyOnceWith('jobFailed', 'Job failed', 'Backup');
  });
});
