import { createMemo, createSignal, For, Show, untrack } from 'solid-js';
import { Clipboard, Pause, Play } from 'lucide-solid';
import type { LogLine } from '@shared/types';
import { Empty, Feedback, PageHeader, Segmented, sentenceCase } from '../components/ui';
import { useAction } from '../lib/actions';
import { formatTime } from '../lib/format';
import type { PageProps } from '../store';

const LEVELS = ['all', 'info', 'warn', 'error'] as const;
const SOURCES = ['all', 'rclone', 'app'] as const;

export function Logs(props: PageProps) {
  const [level, setLevel] = createSignal<typeof LEVELS[number]>('all');
  const [source, setSource] = createSignal<typeof SOURCES[number]>('all');
  const [search, setSearch] = createSignal('');
  const [paused, setPaused] = createSignal<LogLine[]>();
  const [cleared, setCleared] = createSignal<LogLine>();
  const action = useAction();
  const lines = () => paused() ?? props.store.logs();
  const visible = createMemo(() => {
    const all = lines();
    const index = all.indexOf(cleared()!);
    const remaining = index < 0 ? all : all.slice(0, index);
    return remaining.filter((line) => (level() === 'all' || level() === line.level) &&
      (source() === 'all' || source() === line.source) && line.message.toLowerCase().includes(search().toLowerCase()));
  });
  return (
    <div class="logs-layout">
      <PageHeader title="Logs" description="Inspect recent events from the app and rclone.">
        <span class="chip" classList={{ positive: !paused() }}>{paused() ? 'Paused' : 'Live'}</span>
      </PageHeader>
      <div class="log-toolbar">
        <Segmented label="Log level" options={LEVELS} value={level()} onChange={setLevel} />
        <label class="row">Source<select value={source()} onChange={(event) => {
          const selected = SOURCES.find((item) => item === event.currentTarget.value);
          if (selected) setSource(selected);
        }}><option value="all">All</option><option value="rclone">rclone</option><option value="app">App</option></select></label>
        <input type="search" placeholder="Search logs" aria-label="Search logs" value={search()} onInput={(event) => setSearch(event.currentTarget.value)} />
        <div class="actions">
          <button type="button" class="button" onClick={() => setPaused(paused() ? undefined : props.store.logs())}>
            <Show when={paused()} fallback={<><Pause size={14} /> Pause</>}><Play size={14} /> Resume</Show>
          </button>
          <button type="button" class="button" disabled={!visible().length || action.pending()} onClick={() => void action.run(
            () => untrack(() => navigator.clipboard.writeText(visible().map((line) => `${line.ts}\t${line.level}\t${line.source}\t${line.message}`).join('\n'))), 'Visible logs copied.')}>
            <Clipboard size={14} /> Copy visible
          </button>
          <button type="button" class="button quiet" disabled={!visible().length} onClick={() => setCleared(lines()[0])}>Clear view</button>
        </div>
      </div>
      <Feedback action={action} />
      <section class="log-view selectable" aria-label="Recent log entries" tabindex="0">
        <For each={visible()} fallback={<Empty>No log entries in this view.</Empty>}>{(line) => (
          <div class="log-line">
            <time dateTime={line.ts}>{formatTime(line.ts)}</time>
            <span data-level={line.level}>{sentenceCase(line.level)}</span>
            <span>{line.source === 'app' ? 'App' : 'rclone'}</span>
            <span>{line.message}</span>
          </div>
        )}</For>
      </section>
    </div>
  );
}
