import { createMemo, createResource, createSignal, For, Index, Show, untrack } from 'solid-js';
import { Activity, Gauge, Plus, RotateCcw } from 'lucide-solid';
import type { SyncJob, SyncJobRun } from '@shared/types';
import { JobDrawer } from '../components/JobDrawer';
import { Confirm, Empty, Feedback, PageHeader, Progress, SectionHeader, Segmented, sentenceCase } from '../components/ui';
import { errorMessage, useAction } from '../lib/actions';
import { formatBytes, formatDuration, formatSpeed, formatTime } from '../lib/format';
import type { PageProps } from '../store';

const BANDWIDTH_PRESETS = ['off', '5M', '25M', '100M'] as const;

function Throughput(props: PageProps) {
  const stats = () => props.store.snapshot()?.stats;
  const action = useAction();
  const [rate, setRate] = createSignal('');
  const limit = (value: string) => window.api.bandwidthLimit(value);
  return (
    <div class="telemetry transfer-telemetry">
      <div class="telemetry-unit"><Activity size={19} /><div><strong>{formatSpeed(stats()?.speed ?? null)}</strong><span>Transfer speed</span></div></div>
      <div class="telemetry-unit"><div><strong>{formatBytes(stats()?.bytes ?? null)}</strong><span>Transferred</span></div></div>
      <div class="telemetry-unit"><div><strong>{stats()?.errors ?? 'Unavailable'}</strong><span>Errors</span></div></div>
      <button type="button" class="button" disabled={!stats() || action.pending()} onClick={() => void action.run(window.api.resetStats, 'Transfer stats reset.')}>
        <RotateCcw size={14} /> Reset stats
      </button>
      <div class="bandwidth-controls">
        <div class="row"><Gauge size={17} /> <strong>Bandwidth limit</strong><span class="chip">{stats()?.bwLimit ?? 'Unavailable'}</span></div>
        <Segmented label="Bandwidth presets" options={BANDWIDTH_PRESETS} value={stats()?.bwLimit ?? ''} disabled={!stats() || action.pending()}
          onChange={(value) => void action.run(() => limit(value))} />
        <form class="row" onSubmit={(event) => {
          event.preventDefault();
          if (rate().trim()) void action.run(() => untrack(() => limit(rate().trim())));
        }}>
          <input aria-label="Custom bandwidth rate" placeholder="e.g. 10M" value={rate()} onInput={(event) => setRate(event.currentTarget.value)} />
          <button type="submit" class="button" disabled={!stats() || !rate().trim() || action.pending()}>Apply</button>
        </form>
      </div>
      <Feedback action={action} />
    </div>
  );
}

function RunBadge(props: { run: SyncJobRun }) {
  return <span class="chip" classList={{ positive: props.run.state === 'finished', 'danger-text': props.run.state === 'failed', encrypted: props.run.state === 'running' }}>
    {sentenceCase(props.run.state)}{props.run.dryRun ? ' (dry run)' : ''}
  </span>;
}

function JobRow(props: PageProps & { job: SyncJob; onEdit: () => void }) {
  const action = useAction();
  const latest = () => props.store.snapshot()?.jobRuns.find((run) => run.jobId === props.job.id);
  const running = () => latest()?.state === 'running' ? latest() : undefined;
  const disabled = () => !props.job.enabled || action.pending() || props.store.snapshot()?.daemon.state !== 'running';
  const run = (dryRun: boolean) => window.api.runJob(props.job.id, { dryRun });
  return (
    <article class="ledger-row">
      <div class="ledger-heading">
        <div class="row"><strong>{props.job.name}</strong><span class="chip">{sentenceCase(props.job.mode)}</span>
          <Show when={!props.job.enabled}><span class="chip">Disabled</span></Show></div>
        <Show when={latest()} fallback={<span class="secondary">Never run</span>}>{(item) => <RunBadge run={item()} />}</Show>
      </div>
      <div class="job-route">
        <div><span>Source</span><strong class="path selectable">{props.job.source}</strong></div>
        <div><span>Destination</span><strong class="path selectable">{props.job.destination}</strong></div>
      </div>
      <div class="actions job-actions">
        <Show when={running()} fallback={
          <>
            <button type="button" class="button" disabled={disabled()} onClick={() => void action.run(() => untrack(() => run(true)))}>Run dry run</button>
            <Show when={props.job.mode === 'sync'} fallback={<button type="button" class="button" disabled={disabled()}
              onClick={() => void action.run(() => untrack(() => run(false)))}>Run now</button>}>
              <Confirm label="Run now" question="Run this sync? It can delete files from the destination." disabled={disabled()} action={() => run(false)} />
            </Show>
          </>
        }>{(item) => <button type="button" class="button" disabled={action.pending()}
          onClick={() => void action.run(() => untrack(() => window.api.stopJob(item().rcloneJobId)))}>Stop</button>}</Show>
        <button type="button" class="button quiet" disabled={!!running() || action.pending()} onClick={() => props.onEdit()}>Edit</button>
        <Confirm label="Delete job" question="Delete this saved job?" disabled={!!running() || action.pending()} action={() => window.api.deleteJob(props.job.id)} />
        <span class="secondary">{props.job.excludes.length} {props.job.excludes.length === 1 ? 'exclude' : 'excludes'}{props.job.dryRunDefault ? ' / Dry run by default' : ''}</span>
      </div>
      <Feedback action={action} />
    </article>
  );
}

export function Transfers(props: PageProps) {
  const [drawer, setDrawer] = createSignal<SyncJob | 'new'>();
  const stats = () => props.store.snapshot()?.stats;
  const jobs = () => props.store.settings().jobs;
  const completedSource = createMemo(() => stats() ? `${stats()?.transfers}:${stats()?.checks}:${stats()?.errors}` : false);
  const [completed] = createResource(completedSource, async () => {
    try {
      return { items: await window.api.completedTransfers(), error: '' };
    } catch (cause) {
      return { items: [], error: errorMessage(cause) };
    }
  });

  return (
    <>
      <PageHeader title="Transfers" description="Track throughput and run saved copy or sync jobs." />
      <Throughput store={props.store} navigate={props.navigate} />
      <section class="panel">
        <SectionHeader title="Active transfers"><span class="chip numeric">{stats()?.transferring.length ?? 0} active</span></SectionHeader>
        <Index each={stats()?.transferring} fallback={<Empty>No active transfers.</Empty>}>{(item) => (
          <article class="ledger-row transfer-row">
            <div class="ledger-heading"><strong class="path selectable">{item().name}</strong><span class="numeric">{formatSpeed(item().speed)}</span></div>
            <Progress label={item().name} value={item().bytes} total={item().size} />
            <div class="ledger-heading secondary numeric"><span>{formatBytes(item().bytes)} of {formatBytes(item().size)}</span><span>ETA {formatDuration(item().eta)}</span></div>
          </article>
        )}</Index>
      </section>
      <section class="panel">
        <SectionHeader title="Sync and copy jobs">
          <button type="button" class="button primary" onClick={() => setDrawer('new')}><Plus size={15} /> New job</button>
        </SectionHeader>
        <For each={jobs().map(({ id }) => id)} fallback={<Empty>No saved jobs.</Empty>}>{(id) => (
          <JobRow store={props.store} navigate={props.navigate} job={jobs().find((job) => job.id === id)!}
            onEdit={() => setDrawer(jobs().find((job) => job.id === id))} />
        )}</For>
      </section>
      <div class="history-split">
        <section class="panel">
          <SectionHeader title="Recent completed transfers" />
          <Show when={stats()} fallback={<Empty>Connect to rclone to view completed transfers.</Empty>}>
            <Show when={completed()?.error}>{(error) => <p class="banner error" role="alert">{error()}</p>}</Show>
            <For each={completed()?.items} fallback={<Empty>{completed.loading ? 'Loading history…' : 'No completed transfers.'}</Empty>}>{(item) => (
              <div class="compact-ledger"><strong class="path">{item.name}</strong>
                <span class="secondary numeric">{item.failed ? 'Failed / ' : ''}{formatBytes(item.bytes)} / {formatTime(item.completedAt)}</span></div>
            )}</For>
          </Show>
        </section>
        <section class="panel">
          <SectionHeader title="Recent job runs" />
          <For each={props.store.snapshot()?.jobRuns} fallback={<Empty>No job runs yet.</Empty>}>{(run) => (
            <div class="compact-ledger">
              <div class="ledger-heading"><strong>{jobs().find((job) => job.id === run.jobId)?.name ?? 'Deleted job'}</strong><RunBadge run={run} /></div>
              <span class="secondary">{formatTime(run.finishedAt ?? run.startedAt)}</span>
              <Show when={run.error}><span class="danger-text">{run.error}</span></Show>
            </div>
          )}</For>
        </section>
      </div>
      <Show when={drawer()} keyed>{(job) => <JobDrawer job={job === 'new' ? undefined : job} attached={props.store.snapshot()?.daemon.mode === 'attached'} close={() => setDrawer(undefined)} />}</Show>
    </>
  );
}
