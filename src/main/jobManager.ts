import { randomUUID } from 'node:crypto';
import type { SyncJob, SyncJobRun } from '@shared/types';
import type { Notify } from './mountManager';
import { daemonPath, isDaemonAbsolute, isWindowsDrivePath } from './daemonPaths';
import { remoteFs, validRemoteName, type RcloneClient } from './rcloneClient';

const RECENT_RUN_LIMIT = 50;

interface JobContext {
  client: () => RcloneClient;
  isCurrentClient: (client: RcloneClient) => boolean;
  platform: () => string | null;
  hasRemote: (name: string) => boolean;
  jobs: () => SyncJob[];
  save: (jobs: SyncJob[]) => void;
  notify: Notify;
  change: () => void;
}

interface ActiveRun {
  client: RcloneClient;
  executeId?: string;
  job: SyncJob;
  run: SyncJobRun;
  stopRequested: boolean;
}

function normalizeTarget(target: unknown, platform: string | null, hasRemote: JobContext['hasRemote']): string {
  if (typeof target !== 'string' || /[\r\n\0]/.test(target)) throw new Error('Invalid job path.');
  if (isDaemonAbsolute(target, platform)) {
    const paths = daemonPath(platform);
    const normalized = paths.normalize(target);
    return normalized === paths.parse(normalized).root || !normalized.endsWith(paths.sep) ? normalized : normalized.slice(0, -1);
  }
  const colon = target.indexOf(':');
  const remote = target.slice(0, colon);
  if (colon < 0 || !validRemoteName(remote, !platform || platform === 'win32')
    || (isWindowsDrivePath(target) && !hasRemote(remote))) {
    throw new Error('Use an absolute path on the daemon host or a configured remote path.');
  }
  return remoteFs(remote, target.slice(colon + 1));
}

export function openJobManager(context: JobContext) {
  const active = new Set<ActiveRun>();
  const starting = new Set<string>();
  let recent: SyncJobRun[] = [];
  let polling: Promise<void> | undefined;

  function jobFor(id: string): SyncJob {
    const job = context.jobs().find((entry) => entry.id === id);
    if (!job) throw new Error('Unknown sync job.');
    return job;
  }

  function complete(entry: ActiveRun, state: SyncJobRun['state'], error: string | null): void {
    if (!active.delete(entry)) return;
    recent = [{ ...entry.run, state, error, finishedAt: new Date().toISOString() }, ...recent].slice(0, RECENT_RUN_LIMIT);
    if (state === 'finished') context.notify('jobCompleted', 'Job completed', entry.job.name);
    if (state === 'failed') context.notify('jobFailed', 'Job failed', entry.job.name);
    context.change();
  }

  function checkCurrentClient(entry: ActiveRun): boolean {
    if (context.isCurrentClient(entry.client)) return true;
    complete(entry, 'unknown', 'The rclone connection ended before the job result was known.');
    return false;
  }

  async function pollRun(entry: ActiveRun): Promise<void> {
    if (!checkCurrentClient(entry)) return;
    try {
      const status = await entry.client.call('job/status', { jobid: entry.run.rcloneJobId });
      if (!checkCurrentClient(entry)) return;
      if (entry.executeId && status.executeId !== entry.executeId) {
        complete(entry, 'failed', 'The rclone daemon restarted.');
      } else if (status.finished) {
        const state = status.success ? 'finished' : entry.stopRequested ? 'stopped' : 'failed';
        complete(entry, state, state === 'failed' ? 'rclone reported a job failure.' : null);
      } else if (entry.run.state === 'reconnecting') {
        entry.run = { ...entry.run, state: 'running', error: null };
        context.change();
      }
    } catch {
      if (!checkCurrentClient(entry)) return;
      const status = await entry.client.call('job/list').catch(() => null);
      if (!checkCurrentClient(entry)) return;
      if (entry.executeId && status && typeof status.executeId === 'string') {
        if (status.executeId !== entry.executeId) {
          complete(entry, 'failed', 'The rclone daemon restarted.');
          return;
        }
        if (!status.jobids.includes(entry.run.rcloneJobId)) {
          complete(entry, 'unknown', 'rclone no longer has this job’s result.');
          return;
        }
      }
      if (entry.run.state !== 'reconnecting') {
        entry.run = { ...entry.run, state: 'reconnecting', error: 'Waiting for rclone job status.' };
        context.change();
      }
    }
  }

  return {
    list: context.jobs,
    runs: () => [...[...active].reverse().map(({ run }) => run), ...recent],
    save(draft: Omit<SyncJob, 'id'> & { id?: string }): SyncJob {
      if (!draft || !['copy', 'sync'].includes(draft.mode) || typeof draft.name !== 'string' || !draft.name.trim()) throw new Error('Invalid sync job.');
      if (draft.id !== undefined) jobFor(draft.id);
      const platform = context.platform();
      const source = normalizeTarget(draft.source, platform, context.hasRemote);
      const destination = normalizeTarget(draft.destination, platform, context.hasRemote);
      if (source === destination) throw new Error('The source and destination are the same.');
      const job = { ...draft, id: draft.id ?? randomUUID(), source, destination };
      context.save([...context.jobs().filter(({ id }) => id !== job.id), job]);
      return jobFor(job.id);
    },
    delete(id: string): void {
      jobFor(id);
      context.save(context.jobs().filter((job) => job.id !== id));
    },
    async runJob(id: string, options?: { dryRun?: boolean }): Promise<SyncJobRun> {
      const job = jobFor(id);
      if (!job.enabled) throw new Error('This sync job is disabled.');
      if (options?.dryRun !== undefined && typeof options.dryRun !== 'boolean') throw new Error('Invalid dry-run value.');
      const rc = context.client();
      const platform = context.platform();
      const srcFs = normalizeTarget(job.source, platform, context.hasRemote);
      const dstFs = normalizeTarget(job.destination, platform, context.hasRemote);
      if (srcFs === dstFs) throw new Error('The source and destination are the same.');
      const dryRun = options?.dryRun ?? job.dryRunDefault;
      if (starting.has(id) || [...active].some((entry) => entry.run.jobId === id && entry.client === rc)) {
        throw new Error('This sync job is already running.');
      }
      starting.add(id);
      try {
        const { jobid, executeId } = await rc.call(job.mode === 'sync' ? 'sync/sync' : 'sync/copy', {
          srcFs, dstFs, _async: true, _config: { DryRun: dryRun }, _filter: { ExcludeRule: job.excludes },
        });
        const run: SyncJobRun = { jobId: id, rcloneJobId: jobid, dryRun, state: 'running', startedAt: new Date().toISOString(), finishedAt: null, error: null };
        active.add({ job, run, client: rc, executeId, stopRequested: false });
        context.change();
        return run;
      } finally {
        starting.delete(id);
      }
    },
    async stopJob(id: number): Promise<void> {
      const rc = context.client();
      const entry = [...active].find(({ client, run }) => client === rc && run.rcloneJobId === id);
      if (!entry) throw new Error('Unknown running job.');
      const { executeId, finished } = await rc.call('job/status', { jobid: id });
      if (entry.executeId && entry.executeId !== executeId) throw new Error('The rclone daemon restarted.');
      if (finished) {
        await pollRun(entry);
        return;
      }
      entry.stopRequested = true;
      try { await rc.call('job/stop', { jobid: id }); } catch (error) { entry.stopRequested = false; throw error; }
    },
    poll() {
      polling ??= Promise.all([...active].map(pollRun)).then(() => undefined).finally(() => { polling = undefined; });
      return polling;
    },
  };
}
