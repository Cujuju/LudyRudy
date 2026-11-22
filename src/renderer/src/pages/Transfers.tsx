import { For, Show } from 'solid-js';
import { Empty, Metric, PageHeader } from '../components/ui';
import { formatBytes, formatDuration, formatSpeed } from '../lib/format';
import type { PageProps } from '../store';

export function Transfers(props: PageProps) {
  return (
    <>
      <PageHeader title="Transfers" />
      <Show when={props.store.snapshot()?.stats} fallback={<Empty>Transfer statistics are unavailable.</Empty>}>{(stats) => (
        <>
          <dl class="metrics">
            <Metric label="Transferred">{formatBytes(stats().bytes)}</Metric>
            <Metric label="Speed">{formatSpeed(stats().speed)}</Metric>
            <Metric label="Remaining time">{formatDuration(stats().eta)}</Metric>
            <Metric label="Errors">{stats().errors}</Metric>
          </dl>
          <section class="card section">
            <h2>Active transfers</h2>
            <p class="secondary">{stats().transfers} of {stats().totalTransfers} complete · Bandwidth {stats().bwLimit ?? '—'}</p>
            <For each={stats().transferring} fallback={<Empty>No active transfers.</Empty>}>
              {(item) => (
                <div class="list-row" data-transfer={item.name}>
                  <strong>{item.name}</strong><span>{formatBytes(item.bytes)} / {formatBytes(item.size)}</span><span>{formatSpeed(item.speed)}</span>
                </div>
              )}
            </For>
          </section>
        </>
      )}</Show>
    </>
  );
}
