import { createMemo, createResource, createSignal, For, Show, untrack } from 'solid-js';
import { ChevronRight, File, Folder, FolderPlus, LockKeyhole, RefreshCw, Upload } from 'lucide-solid';
import type { RemoteEntry } from '@shared/types';
import { Quota } from '../components/Quota';
import { Confirm, Drawer, Empty, Feedback, FormActions, PageHeader, SearchField, Select } from '../components/ui';
import { errorMessage, useAction } from '../lib/actions';
import { formatBytes, formatTime } from '../lib/format';
import { remoteOptions } from '../lib/remotes';
import type { PageProps } from '../store';

type Edit = { label: string; initial: string; submit: (path: string) => Promise<void> };

function PathDialog(props: { edit: Edit; close: () => void }) {
  const action = useAction();
  let input!: HTMLInputElement;
  return (
    <Drawer title={props.edit.label} busy={action.pending()} close={props.close}>
      <form class="form-stack" onSubmit={(event) => {
        event.preventDefault();
        void action.run(() => untrack(() => props.edit.submit(input.value))).then((ok) => { if (ok) props.close(); });
      }}>
        <label class="field">Path on this remote<input ref={input} class="path" required value={props.edit.initial} disabled={action.pending()} /></label>
        <Feedback action={action} />
        <FormActions label={props.edit.label} close={props.close} busy={action.pending()} />
      </form>
    </Drawer>
  );
}

export function Browser(props: PageProps) {
  const [filter, setFilter] = createSignal('');
  const [edit, setEdit] = createSignal<Edit>();
  const action = useAction();
  const remotes = () => props.store.snapshot()?.remotes ?? [];
  const connected = createMemo(() => props.store.snapshot()?.daemon.state === 'running');
  const nativeTransfers = () => props.store.snapshot()?.daemon.mode === 'managed';
  const selection = createMemo(() => {
    const target = props.store.browserTarget();
    return remotes().some(({ name }) => name === target?.remote) ? target?.remote ?? '' : remotes()[0]?.name ?? '';
  });
  const path = createMemo(() => props.store.browserTarget()?.remote === selection() ? props.store.browserTarget()?.path ?? '' : '');
  const remote = () => remotes().find(({ name }) => name === selection());
  const request = createMemo(() => connected() && selection() ? { remote: selection(), path: path() } : false);
  const [entries, listing] = createResource(request, async (target) => {
    try {
      return { target, items: await window.api.browse(target.remote, target.path), error: '' };
    } catch (cause) {
      return { target, items: [], error: errorMessage(cause) };
    }
  });
  const quotaSource = createMemo(() => connected() && selection());
  const [quota, quotaActions] = createResource(quotaSource, async (name) => {
    try {
      return { name, value: await window.api.quota(name), error: '' };
    } catch (cause) {
      return { name, value: null, error: errorMessage(cause) };
    }
  });
  const currentQuota = () => quota()?.name === selection() ? quota() : undefined;
  const current = () => entries()?.target === request() ? entries() : undefined;
  const filtered = createMemo(() => (current()?.items ?? []).filter((entry) => entry.name.toLowerCase().includes(filter().toLowerCase()))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true })));
  const parts = createMemo(() => path().split('/').filter(Boolean));
  const go = (name: string, next: string) => {
    action.clear();
    setFilter('');
    props.store.setBrowserTarget({ remote: name, path: next });
  };
  const refresh = async () => { await Promise.all([listing.refetch(), quotaActions.refetch()]); };

  function newFolder() {
    const name = selection();
    const directory = path();
    setEdit({ label: 'Create folder', initial: directory ? directory + '/' : '', submit: async (target) => {
      await window.api.mkdir(name, target);
      await refresh();
    } });
  }

  function rename(entry: RemoteEntry) {
    const name = selection();
    const from = entry.path;
    setEdit({ label: 'Rename or move', initial: from, submit: async (target) => {
      if (from === target) return;
      if (entry.isDir) {
        await window.api.moveDirectory(name, from, target);
      } else {
        if (await window.api.stat(name, target)) throw new Error('The destination already exists.');
        await window.api.moveFile(name, from, name, target);
      }
      await refresh();
    } });
  }

  async function remove(entry: RemoteEntry) {
    const name = selection();
    const target = entry.path;
    await (entry.isDir ? window.api.purge(name, target) : window.api.deleteFile(name, target));
    await refresh();
  }

  return (
    <>
      <PageHeader title="Browser" description="Work with files and folders on a configured remote." />
      <Show when={connected() && selection()} fallback={<Empty>Connect to rclone and add a remote to browse files.</Empty>}>
        <section class="panel file-panel">
          <div class="file-toolbar">
            <label class="row">Remote<Select label="Remote" value={selection()} options={remoteOptions(remotes())}
              onChange={(value) => go(value, '')} /></label>
            <div class="actions">
              <SearchField label="Filter filenames" value={filter()} onInput={setFilter} />
              <button type="button" class="button" onClick={newFolder}><FolderPlus size={15} /> New folder</button>
              <button type="button" class="button" disabled={!nativeTransfers() || action.pending()}
                title={nativeTransfers() ? undefined : 'File uploads require the managed daemon.'} onClick={() => void action.run(async () => {
                  const count = await untrack(() => window.api.uploadFiles(selection(), path()));
                  if (count) await refresh();
                })}><Upload size={15} /> Upload files</button>
              <button type="button" class="button" disabled={entries.loading || action.pending()} onClick={() => void action.run(refresh)}><RefreshCw size={15} /> Refresh</button>
            </div>
          </div>
          <nav class="breadcrumbs path" aria-label="Remote folder path">
            <button type="button" class="text-button" aria-current={!path() ? 'location' : undefined} onClick={() => go(selection(), '')}>{selection()}:</button>
            <For each={parts()}>{(part, index) => (
              <div class="row"><ChevronRight size={13} />
                <button type="button" class="text-button" aria-current={index() === parts().length - 1 ? 'location' : undefined}
                  onClick={() => go(selection(), parts().slice(0, index() + 1).join('/'))}>{part}</button>
              </div>
            )}</For>
          </nav>
          <div class="table-scroll">
            <table class="file-table" aria-label="Remote files">
              <thead><tr><th>Name</th><th>Size</th><th>Modified</th><th>Actions</th></tr></thead>
              <tbody>
                <For each={filtered()}>{(entry) => (
                  <tr data-entry={entry.path}>
                    <td>
                      <Show when={entry.isDir} fallback={<span class="row"><File size={16} />{entry.name}</span>}>
                        <button type="button" class="text-button row" onClick={() => go(selection(), entry.path)}><Folder size={16} />{entry.name}</button>
                      </Show>
                    </td>
                    <td class="secondary numeric">{entry.isDir ? 'Folder' : formatBytes(entry.size)}</td>
                    <td class="secondary numeric">{formatTime(entry.modTime)}</td>
                    <td><div class="actions">
                      <Show when={!entry.isDir}><button type="button" class="button quiet" disabled={!nativeTransfers() || action.pending()}
                        title={nativeTransfers() ? undefined : 'File downloads require the managed daemon.'}
                        onClick={() => void action.run(() => untrack(() => window.api.downloadFile(selection(), entry.path, entry.name)))}>Download</button></Show>
                      <button type="button" class="button quiet" onClick={() => rename(entry)}>Rename or move</button>
                      <Confirm label="Delete" question={entry.isDir ? `Delete ${entry.name} and everything inside it?` : `Delete ${entry.name}?`} action={() => remove(entry)} />
                    </div></td>
                  </tr>
                )}</For>
              </tbody>
            </table>
          </div>
          <Show when={entries.loading}><p class="empty" role="status">Loading files…</p></Show>
          <Show when={current()?.error}>{(error) => <p class="banner error" role="alert">{error()}</p>}</Show>
          <Show when={current() && !current()?.error && !entries.loading && !filtered().length}><Empty>{filter() ? 'No matching files.' : 'This folder is empty.'}</Empty></Show>
          <Feedback action={action} />
          <footer class="file-footer">
            <span>{filtered().length} {filtered().length === 1 ? 'item' : 'items'}</span>
            <span class="row"><Show when={remote()?.isCrypt}><LockKeyhole size={14} /></Show>{remote()?.isCrypt ? 'Encrypted' : 'Direct remote'}</span>
            <Show when={currentQuota()?.value} fallback={<span class="secondary" title={currentQuota()?.error}>{quota.loading ? 'Loading quota…' : 'Storage quota unavailable'}</span>}>
              {(value) => <Quota value={value()} />}
            </Show>
          </footer>
        </section>
      </Show>
      <Show when={edit()} keyed>{(item) => <PathDialog edit={item} close={() => setEdit(undefined)} />}</Show>
    </>
  );
}
