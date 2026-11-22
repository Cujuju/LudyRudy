import { Show } from 'solid-js';
import { RefreshCw } from 'lucide-solid';
import { Metric, PageHeader, StatusDot } from '../components/ui';
import { formatBytes, formatSpeed } from '../lib/format';
import type { PageProps } from '../store';

export function Dashboard(props: PageProps) {
  const snapshot = () => props.store.snapshot();
  const daemon = () => snapshot()?.daemon;
  return (
    <>
      <PageHeader title="Dashboard">
        <button type="button" class="button" disabled={props.store.refreshing()} onClick={() => void props.store.refresh()}>
          <RefreshCw size={15} /> Refresh
        </button>
      </PageHeader>
      <Show when={snapshot()}>{(data) => (
        <>
          <dl class="metrics">
            <Metric label="Remotes">{data().remotes.length}</Metric>
            <Metric label="Active mounts">{data().mounts.length}</Metric>
            <Metric label="Transferred">{formatBytes(data().stats?.bytes ?? null)}</Metric>
            <Metric label="Transfer speed">{formatSpeed(data().stats?.speed ?? null)}</Metric>
          </dl>
          <section class="card section">
            <h2>rclone daemon</h2>
            <div class="row"><StatusDot state={daemon()?.state ?? 'stopped'} /><strong class="state-name">{daemon()?.state}</strong>
              <span class="secondary">{daemon()?.attached ? 'Attached daemon' : ''}</span>
            </div>
            <Show when={daemon()?.error}>{(error) => <p class="danger-text" role="alert">{error()}</p>}</Show>
            <Show when={daemon()?.state === 'stopped'}><p class="secondary">No rclone endpoint configured.</p></Show>
            <dl class="properties">
              <dt>Version</dt><dd>{daemon()?.version ?? '—'}</dd>
              <dt>Endpoint</dt><dd>{daemon()?.endpoint ?? '—'}</dd>
              <dt>Config file</dt><dd>{daemon()?.configPath ?? '—'}</dd>
              <dt>Local binary</dt><dd>{daemon()?.binaryPath ?? 'Unavailable'}</dd>
              <dt>Local version</dt><dd>{data().prereqs.rcloneVersion ?? '—'}</dd>
            </dl>
          </section>
        </>
      )}</Show>
    </>
  );
}
