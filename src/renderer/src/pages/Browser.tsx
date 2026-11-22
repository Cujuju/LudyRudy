import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { ChevronUp, File, Folder } from 'lucide-solid';
import { Empty, PageHeader } from '../components/ui';
import { formatBytes, formatTime } from '../lib/format';
import type { PageProps } from '../store';

export function Browser(props: PageProps) {
  const [selection, setSelection] = createSignal('');
  const [path, setPath] = createSignal('');
  const remotes = () => props.store.snapshot()?.remotes ?? [];
  const remote = createMemo(() => remotes().some(({ name }) => name === selection()) ? selection() : remotes()[0]?.name ?? '');
  const attached = createMemo(() => props.store.snapshot()?.daemon.attached === true);
  const request = createMemo(() => attached() && remote() ? { remote: remote(), path: path() } : false);
  const [entries] = createResource(request, async ({ remote, path }) => {
    try {
      return { request: { remote, path }, items: await window.api.browse(remote, path), error: '' };
    } catch (error) {
      return { request: { remote, path }, items: [], error: (error as Error).message };
    }
  });
  const listing = () => {
    const result = entries();
    return result?.request.remote === remote() && result.request.path === path() ? result : undefined;
  };

  return (
    <>
      <PageHeader title="Browser" />
      <Show when={attached() && remotes().length} fallback={<Empty>Connect to rclone to browse a configured remote.</Empty>}>
        <div class="row browser-toolbar">
          <label for="remote-select">Remote</label>
          <select id="remote-select" onChange={(event) => {
            setPath('');
            setSelection(event.currentTarget.value);
          }}>
            <For each={remotes()}>{(item) => <option value={item.name} selected={item.name === remote()}>{item.name}</option>}</For>
          </select>
          <button type="button" class="button" aria-label="Parent folder" disabled={!path()} onClick={() => setPath(path().split('/').slice(0, -1).join('/'))}>
            <ChevronUp size={16} /> Up
          </button>
          <span class="secondary selectable">{remote()}:{path()}</span>
        </div>
        <section class="card section">
          <Show when={!entries.loading} fallback={<p role="status">Loading files…</p>}>
            <Show when={listing()?.error} fallback={
              <For each={listing()?.items} fallback={<Empty>This folder is empty.</Empty>}>
                {(entry) => (
                  <div class="list-row" data-entry={entry.path}>
                    <Show when={entry.isDir} fallback={<span class="row"><File size={16} />{entry.name}</span>}>
                      <button type="button" class="text-button row" onClick={() => setPath(entry.path)}><Folder size={16} />{entry.name}</button>
                    </Show>
                    <span class="secondary">{entry.isDir ? 'Folder' : formatBytes(entry.size)}</span>
                    <span class="secondary">{formatTime(entry.modTime)}</span>
                  </div>
                )}
              </For>
            }>{(error) => <p class="danger-text" role="alert">{error()}</p>}</Show>
          </Show>
        </section>
      </Show>
    </>
  );
}
