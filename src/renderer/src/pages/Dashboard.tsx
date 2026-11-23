import { createSignal, For, Show, untrack } from 'solid-js';
import { Activity, HardDrive, Plus, RefreshCw, Server } from 'lucide-solid';
import type { RemoteQuota, RemoteSummary } from '@shared/types';
import { MountDrawer } from '../components/MountDrawer';
import { MountLedger, Prerequisites } from '../components/MountLedger';
import { ProviderIcon } from '../components/ProviderIcon';
import { Quota } from '../components/Quota';
import { RemoteDrawer } from '../components/RemoteDrawer';
import { SetupGuide } from '../components/SetupGuide';
import { Empty, Feedback, PageHeader, SectionHeader, sentenceCase, StatusDot } from '../components/ui';
import { useAction } from '../lib/actions';
import { formatBytes, formatSpeed, formatTime } from '../lib/format';
import { daemonSourceLabel } from '../lib/onboarding';
import { providerName, storageProvider } from '../lib/remotes';
import type { PageProps } from '../store';

function Telemetry(props: PageProps) {
  const daemon = () => props.store.snapshot()?.daemon;
  const stats = () => props.store.snapshot()?.stats;
  const action = useAction();
  const busy = () => daemon()?.state === 'starting' || action.pending();
  const source = () => {
    const current = daemon();
    return current ? daemonSourceLabel(current) : 'rclone engine';
  };
  return (
    <div class="telemetry">
      <div class="telemetry-metrics">
        <div class="telemetry-unit">
          <Server size={19} />
          <div><strong class="row"><StatusDot state={daemon()?.state ?? 'stopped'} />rclone {daemon()?.state ?? 'stopped'}</strong>
            <span>{source()}</span></div>
        </div>
        <div class="telemetry-unit"><Activity size={19} /><div><strong>{formatSpeed(stats()?.speed ?? null)}</strong>
          <span>{stats()?.transferring.length ?? 0} active / {formatBytes(stats()?.bytes ?? null)} transferred</span></div></div>
        <div class="telemetry-unit"><span class="chip">Bandwidth cap: {stats()?.bwLimit ?? 'off'}</span></div>
      </div>
      <div class="actions telemetry-actions">
        <Show when={daemon()?.state !== 'running' && daemon()?.mode !== 'attached'}>
          <button class="button" type="button" disabled={busy()} onClick={() => void action.run(window.api.startDaemon)}>Start</button>
        </Show>
        <Show when={daemon()?.state === 'running'}>
          <button class="button" type="button" disabled={busy()} onClick={() => void action.run(window.api.stopDaemon)}>Stop</button>
        </Show>
        <button class="button" type="button" disabled={busy()} onClick={() => void action.run(window.api.restartDaemon)}>
          {daemon()?.mode === 'attached' && daemon()?.state !== 'running' ? 'Reconnect' : 'Restart'}
        </button>
      </div>
      <Show when={daemon()?.error && !action.error()}>{(error) => <p class="banner error" role="alert">{error()}</p>}</Show>
      <Feedback action={action} />
    </div>
  );
}

function StorageRow(props: { remote: RemoteSummary; remotes: readonly RemoteSummary[] }) {
  const [quota, setQuota] = createSignal<RemoteQuota>();
  const action = useAction();
  return (
    <div class="compact-ledger">
      <div class="ledger-heading">
        <div class="row">
          <ProviderIcon type={props.remote.type} />
          <strong>{props.remote.name}</strong>
          <Show when={props.remote.isCrypt}><span class="chip encrypted">Encrypted</span></Show>
        </div>
        <Show when={!quota()}><button type="button" class="text-button" disabled={action.pending()} onClick={() => void action.run(async () => {
          setQuota(await untrack(() => window.api.quota(props.remote.name)));
        })}>{action.pending() ? 'Loading…' : 'Check quota'}</button></Show>
      </div>
      <Show when={props.remote.config.remote} fallback={<span class="secondary">{providerName(props.remote.type)}</span>}>
        {(target) => <span class="row path secondary selectable">
          <ProviderIcon type={storageProvider(props.remote, props.remotes)} size="sm" />{target()}
        </span>}
      </Show>
      <Show when={quota()}>{(value) => <Quota value={value()} label={`${props.remote.name} storage used`} />}</Show>
      <Feedback action={action} />
    </div>
  );
}

export function Dashboard(props: PageProps) {
  const [drawer, setDrawer] = createSignal<'mount' | 'remote'>();
  const remotes = () => props.store.snapshot()?.remotes ?? [];
  const connected = () => props.store.snapshot()?.daemon.state === 'running';
  const transfers = () => props.store.snapshot()?.stats?.transferring ?? [];
  const runs = () => props.store.snapshot()?.jobRuns.slice(0, 3);
  return (
    <>
      <PageHeader title="Dashboard">
        <button type="button" class="button" disabled={props.store.refreshing()} onClick={() => void props.store.refresh()}><RefreshCw size={15} /> Refresh</button>
      </PageHeader>
      <Telemetry store={props.store} navigate={props.navigate} />
      <SetupGuide store={props.store} navigate={props.navigate} addRemote={() => setDrawer('remote')} addMount={() => setDrawer('mount')} />
      <Prerequisites store={props.store} navigate={props.navigate} />
      <MountLedger store={props.store} navigate={props.navigate} add={() => setDrawer('mount')} />
      <div class="dashboard-split">
        <section class="panel">
          <SectionHeader title="Remotes and storage">
            <button type="button" class="text-button" onClick={() => props.navigate('Remotes')}>View remotes</button>
          </SectionHeader>
          <For each={remotes().map(({ name }) => name)} fallback={
            <Show when={connected()} fallback={<Empty>Connect to rclone to see configured remotes.</Empty>}>
              <div class="empty-action">
                <span>{props.store.snapshot()?.dataError ? 'Remote status is temporarily unavailable.' : 'No remotes connected yet.'}</span>
                <button type="button" class="button" onClick={() => setDrawer('remote')}><Plus size={14} /> Add remote</button>
              </div>
            </Show>
          }>{(name) => (
            <StorageRow remote={remotes().find((remote) => remote.name === name)!} remotes={remotes()} />
          )}</For>
        </section>
        <section class="panel">
          <SectionHeader title="Transfer activity"><button type="button" class="text-button" onClick={() => props.navigate('Transfers')}>View transfers</button></SectionHeader>
          <For each={transfers()}>{(item) => (
            <div class="compact-ledger"><div class="row"><Activity size={15} /><strong class="path">{item.name}</strong></div>
              <span class="secondary numeric">{formatSpeed(item.speed)} / {formatBytes(item.bytes)} transferred</span></div>
          )}</For>
          <h3 class="ledger-subhead">Recent job runs</h3>
          <For each={runs()} fallback={<Empty>No job runs yet.</Empty>}>{(run) => (
            <div class="compact-ledger"><div class="row"><HardDrive size={15} /><strong>{props.store.settings().jobs.find(({ id }) => id === run.jobId)?.name ?? 'Deleted job'}</strong>
              <span class="chip">{sentenceCase(run.state)}</span></div><span class="secondary">{formatTime(run.startedAt)}</span></div>
          )}</For>
        </section>
      </div>
      <Show when={drawer() === 'mount'}><MountDrawer remotes={remotes()} cache={props.store.settings().daemon.defaultVfsCacheMode}
        connected={connected()} close={() => setDrawer(undefined)} /></Show>
      <Show when={drawer() === 'remote'}><RemoteDrawer store={props.store} close={() => setDrawer(undefined)} /></Show>
    </>
  );
}
