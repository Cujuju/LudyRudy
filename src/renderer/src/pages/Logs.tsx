import { For } from 'solid-js';
import { Empty, PageHeader } from '../components/ui';
import { formatTime } from '../lib/format';
import type { PageProps } from '../store';

export function Logs(props: PageProps) {
  return (
    <>
      <PageHeader title="Logs" />
      <section class="card section selectable" aria-label="Recent log entries">
        <For each={props.store.snapshot()?.logs} fallback={<Empty>No recent log entries.</Empty>}>
          {(line) => (
            <div class="list-row log-row">
              <time dateTime={line.ts} class="secondary">{formatTime(line.ts)}</time>
              <span class="chip" data-level={line.level}>{line.level}</span>
              <span>{line.message}</span>
            </div>
          )}
        </For>
      </section>
    </>
  );
}
