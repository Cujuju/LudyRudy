import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch, untrack } from 'solid-js';
import AnchoredPopover from '@cujuju/solidjs-anchored-popover';
import { GlassMenu } from '@cujuju/solidjs-glass-menu';
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Download, File, FileArchive, FileCode,
  FileImage, FileMusic, FileSpreadsheet, FileText, FileVideoCamera, Folder, FolderPlus,
  Pencil, Presentation, RefreshCw, Settings, Trash2, Upload,
} from 'lucide-solid';
import type { RemoteEntry, RemoteQuota } from '@shared/types';
import { editedRemotePath, parentRemotePath } from '@shared/remotePath';
import { ProviderIcon } from '../components/ProviderIcon';
import { Quota } from '../components/Quota';
import { Confirm, Drawer, Empty, Feedback, FormActions, PageHeader, SearchField, Select } from '../components/ui';
import { errorMessage, useAction } from '../lib/actions';
import {
  BROWSER_COLUMNS, classifyEntry, DEFAULT_BROWSER_COLUMNS, isBrowserColumnList, nextSort, sortEntries,
  type BrowserColumnKey, type FileKind, type SortKey, type SortState,
} from '../lib/fileTypes';
import { formatBytes, formatTime } from '../lib/format';
import { readView, writeView } from '../lib/persisted';
import type { PageProps } from '../store';

type Edit = { label: string; initial: string; submit: (path: string) => Promise<void> };

function EntryIcon(props: { kind: FileKind }) {
  return (
    <Switch fallback={<File size={16} class="entry-icon" data-kind={props.kind} aria-hidden="true" />}>
      <Match when={props.kind === 'folder'}><Folder size={16} class="entry-icon" data-kind="folder" aria-hidden="true" /></Match>
      <Match when={props.kind === 'image'}><FileImage size={16} class="entry-icon" data-kind="image" aria-hidden="true" /></Match>
      <Match when={props.kind === 'video'}><FileVideoCamera size={16} class="entry-icon" data-kind="video" aria-hidden="true" /></Match>
      <Match when={props.kind === 'audio'}><FileMusic size={16} class="entry-icon" data-kind="audio" aria-hidden="true" /></Match>
      <Match when={props.kind === 'spreadsheet'}><FileSpreadsheet size={16} class="entry-icon" data-kind="spreadsheet" aria-hidden="true" /></Match>
      <Match when={props.kind === 'presentation'}><Presentation size={16} class="entry-icon" data-kind="presentation" aria-hidden="true" /></Match>
      <Match when={props.kind === 'code'}><FileCode size={16} class="entry-icon" data-kind="code" aria-hidden="true" /></Match>
      <Match when={props.kind === 'archive'}><FileArchive size={16} class="entry-icon" data-kind="archive" aria-hidden="true" /></Match>
      <Match when={props.kind === 'pdf' || props.kind === 'document' || props.kind === 'text'}>
        <FileText size={16} class="entry-icon" data-kind={props.kind} aria-hidden="true" />
      </Match>
    </Switch>
  );
}

function SortHeader(props: { label: string; sortKey: SortKey; sort: SortState; onSort: (key: SortKey) => void }) {
  const active = () => props.sort.key === props.sortKey;
  const ariaSort = () => (active() ? (props.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
  return (
    <th aria-sort={ariaSort()}>
      <button type="button" class="sort-button" data-active={active()} onClick={() => props.onSort(props.sortKey)}>
        {props.label}
        <Show when={active()} fallback={<ArrowUpDown size={13} class="sort-icon" aria-hidden="true" />}>
          <Show when={props.sort.direction === 'asc'} fallback={<ArrowDown size={13} class="sort-icon" aria-hidden="true" />}>
            <ArrowUp size={13} class="sort-icon" aria-hidden="true" />
          </Show>
        </Show>
      </button>
    </th>
  );
}

function PathDialog(props: { edit: Edit; platform: string | null; close: () => void }) {
  const action = useAction();
  let input!: HTMLTextAreaElement;
  return (
    <Drawer title={props.edit.label} busy={action.pending()} close={props.close}>
      <form class="form-stack" onSubmit={(event) => {
        event.preventDefault();
        void action.run(() => untrack(() => {
          return props.edit.submit(editedRemotePath(input.value, props.edit.initial, props.platform));
        })).then((ok) => { if (ok) props.close(); });
      }}>
        <label class="field">Path on this remote<textarea ref={input} class="path" rows={2} required value={props.edit.initial}
          disabled={action.pending()} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} /></label>
        <Feedback action={action} />
        <FormActions label={props.edit.label} close={props.close} busy={action.pending()} />
      </form>
    </Drawer>
  );
}

function EntryCell(props: { col: BrowserColumnKey; entry: RemoteEntry; typeLabel: string }) {
  return (
    <Switch>
      <Match when={props.col === 'type'}><td class="secondary nowrap">{props.typeLabel}</td></Match>
      <Match when={props.col === 'size'}><td class="secondary numeric nowrap">{props.entry.isDir ? '—' : formatBytes(props.entry.size)}</td></Match>
      <Match when={props.col === 'modTime'}><td class="secondary numeric nowrap">{formatTime(props.entry.modTime)}</td></Match>
      <Match when={props.col === 'mimeType'}><td class="secondary path nowrap">{props.entry.mimeType || '—'}</td></Match>
      <Match when={props.col === 'id'}><td class="secondary path nowrap">{props.entry.id || '—'}</td></Match>
      <Match when={props.col === 'tier'}><td class="secondary nowrap">{props.entry.tier || '—'}</td></Match>
      <Match when={props.col === 'encrypted'}><td class="secondary path nowrap">{props.entry.encrypted || '—'}</td></Match>
    </Switch>
  );
}

function ColumnPicker(props: { visible: readonly BrowserColumnKey[]; onToggle: (key: BrowserColumnKey) => void; onReset: () => void }) {
  const [open, setOpen] = createSignal(false);
  const [anchor, setAnchor] = createSignal<HTMLElement | null>(null);
  return (
    <>
      <button ref={setAnchor} type="button" class="icon-button column-picker-trigger" aria-label="Configure columns" title="Configure columns" aria-haspopup="dialog" aria-expanded={open()} onClick={() => setOpen((v) => !v)}>
        <Settings size={15} aria-hidden="true" />
      </button>
      <AnchoredPopover open={open} anchor={anchor} onDismiss={() => setOpen(false)} placement="below-end">
        <GlassMenu class="column-picker-panel" surface="plain" tabIndex={-1}>
          <div class="column-picker" role="group" aria-label="Visible columns">
            <div class="column-picker-header">
              <span>Columns</span>
              <button type="button" class="text-button" onClick={() => props.onReset()}>Reset</button>
            </div>
            <For each={BROWSER_COLUMNS}>{(col) => (
              <label class="column-picker-row">
                <input type="checkbox" checked={props.visible.includes(col.key)} onChange={() => props.onToggle(col.key)} />
                <span>{col.label}</span>
              </label>
            )}</For>
          </div>
        </GlassMenu>
      </AnchoredPopover>
    </>
  );
}

export function Browser(props: PageProps) {
  return <Show when={props.store.browserSession()} keyed><BrowserSession {...props} /></Show>;
}

function BrowserSession(props: PageProps) {
  const [filter, setFilter] = createSignal('');
  const [sort, setSort] = createSignal<SortState>({ key: 'name', direction: 'asc' });
  const [columns, setColumns] = createSignal<BrowserColumnKey[]>(
    readView('browser.columns', [...DEFAULT_BROWSER_COLUMNS], isBrowserColumnList),
  );
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
  const cache = untrack(() => props.store.browserCache);
  const session = untrack(() => props.store.browserSession());
  const sameSession = () => untrack(() => props.store.browserSession()) === session;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    listingSeq += 1;
    quotaSeq += 1;
  });
  type ListingState = { target: { remote: string; path: string }; items: RemoteEntry[]; loading: boolean; error: string };
  type QuotaState = { name: string; value: RemoteQuota | null; loading: boolean; error: string };
  const [entries, setEntries] = createSignal<ListingState>();
  const [quota, setQuota] = createSignal<QuotaState>();
  let listingSeq = 0;
  let quotaSeq = 0;

  async function loadListing(target: { remote: string; path: string }, force = false): Promise<void> {
    const seq = ++listingSeq;
    try {
      const cached = force ? undefined : cache.peekDirectory(target.remote, target.path);
      if (cached) {
        setEntries({ target, items: cached.items, loading: !cached.fresh, error: '' });
        if (cached.fresh) return;
      } else {
        const prev = untrack(entries);
        const keep = prev?.target.remote === target.remote && prev.target.path === target.path ? prev.items : [];
        setEntries({ target, items: keep, loading: true, error: '' });
      }
      const items = await cache.loadDirectory(
        target.remote, target.path, () => window.api.browse(target.remote, target.path), { force: force || !!cached },
      );
      if (seq === listingSeq) setEntries({ target, items, loading: false, error: '' });
    } catch (cause) {
      if (seq !== listingSeq) return;
      const prev = untrack(entries);
      const keep = prev?.target.remote === target.remote && prev.target.path === target.path ? prev.items : [];
      setEntries({ target, items: keep, loading: false, error: errorMessage(cause) });
    }
  }

  async function loadQuota(name: string, force = false): Promise<void> {
    const seq = ++quotaSeq;
    const cached = force ? undefined : cache.peekQuota(name);
    if (cached) {
      setQuota({ name, value: cached.value, loading: !cached.fresh, error: '' });
      if (cached.fresh) return;
    } else {
      const prev = untrack(quota);
      setQuota({ name, value: prev?.name === name ? prev.value : null, loading: true, error: '' });
    }
    try {
      const value = await cache.loadQuota(name, () => window.api.quota(name), { force: force || !!cached });
      if (seq === quotaSeq) setQuota({ name, value, loading: false, error: '' });
    } catch (cause) {
      if (seq !== quotaSeq) return;
      const prev = untrack(quota);
      setQuota({ name, value: prev?.name === name ? prev.value : null, loading: false, error: errorMessage(cause) });
    }
  }

  createEffect(() => {
    const target = request();
    if (!target) {
      listingSeq += 1;
      setEntries(undefined);
      return;
    }
    void loadListing(target);
  });

  const quotaSource = createMemo(() => connected() && selection());
  createEffect(() => {
    const name = quotaSource();
    if (!name) {
      quotaSeq += 1;
      setQuota(undefined);
      return;
    }
    void loadQuota(name);
  });

  const currentQuota = () => quota()?.name === selection() ? quota() : undefined;
  const current = () => {
    const state = entries();
    const target = request();
    return state && target && state.target.remote === target.remote && state.target.path === target.path ? state : undefined;
  };
  const listingLoading = () => current()?.loading ?? false;
  const items = createMemo(() => current()?.items);
  const sorted = createMemo(() => sortEntries(items() ?? [], sort()));
  const filtered = createMemo(() => {
    const query = filter().toLowerCase();
    return query ? sorted().filter((entry) => entry.name.toLowerCase().includes(query)) : sorted();
  });
  const activeColumns = createMemo(() => BROWSER_COLUMNS.filter((col) => columns().includes(col.key)));
  const toggleSort = (key: SortKey) => setSort((prev) => nextSort(prev, key));
  const toggleColumn = (key: BrowserColumnKey) => {
    const next = columns().includes(key) ? columns().filter((k) => k !== key) : [...columns(), key];
    setColumns(next);
    writeView('browser.columns', next);
    if (!next.includes(key) && sort().key === key) setSort({ key: 'name', direction: 'asc' });
  };
  const resetColumns = () => {
    const next = [...DEFAULT_BROWSER_COLUMNS];
    setColumns(next);
    writeView('browser.columns', next);
    if (sort().key !== 'name' && !next.includes(sort().key as BrowserColumnKey)) setSort({ key: 'name', direction: 'asc' });
  };
  const parts = createMemo(() => path().split('/').filter(Boolean));
  const go = (name: string, next: string) => {
    action.clear();
    setFilter('');
    props.store.setBrowserTarget({ remote: name, path: next });
  };
  const refresh = async (withQuota = true) => {
    if (disposed || !sameSession()) return;
    const target = untrack(request);
    if (!target) return;
    if (withQuota) void loadQuota(target.remote, true);
    await loadListing(target, true);
  };

  function newFolder() {
    const name = selection();
    const directory = path();
    setEdit({ label: 'Create folder', initial: directory ? directory + '/' : '', submit: async (target) => {
      await window.api.mkdir(name, target);
      if (!sameSession()) return;
      cache.invalidateDirectory(name, directory);
      cache.invalidateDirectory(name, parentRemotePath(target));
      await refresh(false);
    } });
  }

  function rename(entry: RemoteEntry) {
    const name = selection();
    const from = entry.path;
    setEdit({ label: 'Rename or move', initial: from, submit: async (target) => {
      if (from === target) return;
      try {
        if (entry.isDir) await window.api.moveDirectory(name, from, target);
        else await window.api.moveFile(name, from, name, target);
      } finally {
        if (sameSession()) {
          if (entry.isDir) {
            cache.invalidatePrefix(name, from);
            cache.invalidatePrefix(name, target);
          }
          cache.invalidateDirectory(name, parentRemotePath(from));
          cache.invalidateDirectory(name, parentRemotePath(target));
          await refresh(false);
        }
      }
    } });
  }

  async function remove(entry: RemoteEntry) {
    const name = selection();
    const target = entry.path;
    await (entry.isDir ? window.api.purge(name, target) : window.api.deleteFile(name, target));
    if (!sameSession()) return;
    if (entry.isDir) cache.invalidatePrefix(name, target);
    cache.invalidateDirectory(name, parentRemotePath(target));
    cache.invalidateQuota(name);
    await refresh(true);
  }

  return (
    <>
      <PageHeader title="Browser" description="Work with files and folders on a configured remote." />
      <Show when={connected() && selection()} fallback={<Empty>Connect to rclone and add a remote to browse files.</Empty>}>
        <section class="panel file-panel">
          <div class="file-toolbar">
            <label class="row">Remote
              <Select label="Remote" value={selection()} options={remotes().map((item) => ({
                value: item.name,
                label: item.isCrypt ? `${item.name} (encrypted)` : item.name,
                icon: () => <ProviderIcon type={item.type} size="sm" />,
              }))}
                onChange={(value) => go(value, '')} />
            </label>
            <div class="actions">
              <SearchField label="Filter filenames" value={filter()} onInput={setFilter} />
              <button type="button" class="button" onClick={newFolder}><FolderPlus size={15} /> New folder</button>
              <button type="button" class="button" disabled={!nativeTransfers() || action.pending()}
                title={nativeTransfers() ? undefined : 'File uploads require the managed daemon.'} onClick={() => void action.run(async () => {
                  const name = untrack(selection);
                  const dir = untrack(path);
                  const { uploaded, skipped, failure } = await window.api.uploadFiles(name, dir);
                  if (sameSession() && (uploaded.length || failure)) {
                    cache.invalidateDirectory(name, dir);
                    cache.invalidateQuota(name);
                    await refresh(true);
                  }
                  if (failure) throw new Error([
                    `Stopped at ${failure.file}. ${failure.message}`,
                    uploaded.length && `Uploaded ${uploaded.join(', ')}.`,
                    skipped?.length && `Skipped ${skipped.join(', ')}.`,
                  ].filter(Boolean).join(' '));
                })}><Upload size={15} /> Upload files</button>
              <button type="button" class="button" disabled={listingLoading() || action.pending()} onClick={() => void action.run(() => refresh(true))}><RefreshCw size={15} /> Refresh</button>
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
            <ColumnPicker visible={columns()} onToggle={toggleColumn} onReset={resetColumns} />
          </nav>
          <div class="table-scroll">
            <table class="file-table" aria-label="Remote files">
              <thead>
                <tr>
                  <SortHeader label="Name" sortKey="name" sort={sort()} onSort={toggleSort} />
                  <For each={activeColumns()}>{(col) => (
                    <SortHeader label={col.label} sortKey={col.key} sort={sort()} onSort={toggleSort} />
                  )}</For>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <For each={filtered()}>{(entry) => {
                  const info = classifyEntry(entry);
                  return (
                    <tr data-entry={entry.path}>
                      <td>
                        <Show when={entry.isDir} fallback={<span class="row"><EntryIcon kind={info.kind} />{entry.name}</span>}>
                          <button type="button" class="text-button row" onClick={() => go(selection(), entry.path)}>
                            <EntryIcon kind={info.kind} />{entry.name}
                          </button>
                        </Show>
                      </td>
                      <For each={activeColumns()}>{(col) => (
                        <EntryCell col={col.key} entry={entry} typeLabel={info.label} />
                      )}</For>
                      <td><div class="actions">
                        <Show when={!entry.isDir}>
                          <button type="button" class="icon-button" aria-label="Download"
                            disabled={!nativeTransfers() || action.pending()}
                            title={nativeTransfers() ? 'Download' : 'File downloads require the managed daemon.'}
                            onClick={() => void action.run(() => untrack(() => window.api.downloadFile(selection(), entry.path, entry.name)))}>
                            <Download size={15} aria-hidden="true" />
                          </button>
                        </Show>
                        <button type="button" class="icon-button" aria-label="Rename or move" title="Rename or move" onClick={() => rename(entry)}>
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                        <Confirm label="Delete" icon={<Trash2 size={15} aria-hidden="true" />}
                          question={entry.isDir ? `Delete ${entry.name} and everything inside it?` : `Delete ${entry.name}?`}
                          action={() => remove(entry)} />
                      </div></td>
                    </tr>
                  );
                }}</For>
              </tbody>
            </table>
          </div>
          <Show when={listingLoading() && !current()?.items.length}><p class="empty" role="status">Loading files…</p></Show>
          <Show when={current()?.error}>{(error) => <p class="banner error" role="alert">{error()}</p>}</Show>
          <Show when={current() && !current()?.error && !listingLoading() && !filtered().length}><Empty>{filter() ? 'No matching files.' : 'This folder is empty.'}</Empty></Show>
          <Feedback action={action} />
          <footer class="file-footer">
            <span>{filtered().length} {filtered().length === 1 ? 'item' : 'items'}</span>
            <span>{remote()?.isCrypt ? 'Encrypted' : 'Direct remote'}</span>
            <Show when={currentQuota()?.value} fallback={<span class="secondary" title={currentQuota()?.error}>{currentQuota()?.loading ? 'Loading quota…' : 'Storage quota unavailable'}</span>}>
              {(value) => <Quota value={value()} />}
            </Show>
          </footer>
        </section>
      </Show>
      <Show when={edit()} keyed>{(item) => <PathDialog edit={item} platform={props.store.snapshot()?.daemon.hostPlatform ?? null}
        close={() => setEdit(undefined)} />}</Show>
    </>
  );
}
