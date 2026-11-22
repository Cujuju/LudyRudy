import { createSignal, For, onMount, Show, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import { VFS_CACHE_MODES, type MountProfile, type RemoteSummary } from '@shared/types';
import { useAction } from '../lib/actions';
import { Drawer, Feedback, FormActions, Segmented, Toggle } from './ui';

type MountDraft = Parameters<typeof window.api.saveMountProfile>[0];

export function mountDraft(name: string, remote: string, cache: MountProfile['vfsCacheMode']): MountDraft {
  return { name, remote, remotePath: '', mountPoint: '', vfsCacheMode: cache, vfsCacheMaxAge: '', vfsCacheMaxSize: '',
    autoMount: false, readOnly: false, extraFlags: [] };
}

export function MountDrawer(props: {
  profile?: MountProfile; remote?: string; remotes: RemoteSummary[]; cache: MountProfile['vfsCacheMode']; connected: boolean; close: () => void;
}) {
  const [draft, setDraft] = createStore<MountDraft>(untrack(() => props.profile ? { ...props.profile } :
    mountDraft(props.remote ?? '', props.remote ?? props.remotes[0]?.name ?? '', props.cache)));
  const [flags, setFlags] = createSignal(untrack(() => draft.extraFlags.join('\n')));
  const [types, setTypes] = createSignal<string[]>([]);
  const action = useAction();
  const lookup = useAction();
  onMount(() => {
    if (props.connected) void lookup.run(async () => setTypes(await window.api.mountTypes()));
  });

  async function save() {
    if (await action.run(() => untrack(() => window.api.saveMountProfile({ ...draft, name: draft.name.trim(),
      extraFlags: flags().split('\n').map((flag) => flag.trim()).filter(Boolean) })))) props.close();
  }

  return (
    <Drawer title={props.profile ? 'Edit mount profile' : 'New mount profile'} description="Connect a remote folder to a local drive."
      busy={action.pending()} close={props.close}>
      <form class="form-stack" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={action.pending()}>
          <label class="field">Profile name<input required value={draft.name} onInput={(event) => setDraft('name', event.currentTarget.value)} /></label>
          <label class="field">Remote<select required value={draft.remote} onChange={(event) => setDraft('remote', event.currentTarget.value)}>
            <option value="" selected={!draft.remote}>Select a remote</option>
            <For each={props.remotes}>{(remote) => <option value={remote.name} selected={draft.remote === remote.name}>{remote.name}{remote.isCrypt ? ' (encrypted)' : ''}</option>}</For>
            <Show when={draft.remote && !props.remotes.some(({ name }) => name === draft.remote)}>
              <option value={draft.remote} selected>{draft.remote} (unavailable)</option>
            </Show>
          </select></label>
          <label class="field">Remote subfolder<input class="path" placeholder="Remote root" value={draft.remotePath} onInput={(event) => setDraft('remotePath', event.currentTarget.value)} /></label>
          <label class="field">Mount point<input class="path" required value={draft.mountPoint} onInput={(event) => setDraft('mountPoint', event.currentTarget.value)} /></label>
          <button type="button" class="button" disabled={lookup.pending()} onClick={() => void lookup.run(async () => {
            const path = await window.api.pickDirectory();
            if (path) setDraft('mountPoint', path);
          })}>Choose folder</button>
          <div class="field">VFS cache mode
            <Segmented label="VFS cache mode" options={VFS_CACHE_MODES} value={draft.vfsCacheMode ?? 'off'} onChange={(value) => setDraft('vfsCacheMode', value)} />
          </div>
          <div class="form-columns">
            <label class="field">Cache max size<input placeholder="e.g. 10G" value={draft.vfsCacheMaxSize} onInput={(event) => setDraft('vfsCacheMaxSize', event.currentTarget.value)} /></label>
            <label class="field">Cache max age<input placeholder="e.g. 24h" value={draft.vfsCacheMaxAge} onInput={(event) => setDraft('vfsCacheMaxAge', event.currentTarget.value)} /></label>
          </div>
          <Toggle label="Read-only" checked={draft.readOnly} onChange={(value) => setDraft('readOnly', value)} />
          <Toggle label="Mount at daemon startup" checked={draft.autoMount} onChange={(value) => setDraft('autoMount', value)} />
          <label class="field">Mount type<select value={draft.mountType ?? ''} onChange={(event) => setDraft('mountType', event.currentTarget.value || undefined)}>
            <option value="">Daemon default</option>
            <For each={types()}>{(type) => <option value={type}>{type}</option>}</For>
            <option value={draft.mountType} hidden={!draft.mountType || types().includes(draft.mountType)}>{draft.mountType}</option>
          </select></label>
          <label class="field">Extra flags<textarea placeholder="One flag per line" value={flags()} onInput={(event) => setFlags(event.currentTarget.value)} /></label>
        </fieldset>
        <Feedback action={lookup} />
        <Feedback action={action} />
        <FormActions label="Save profile" busy={action.pending()} disabled={lookup.pending()} close={props.close} />
      </form>
    </Drawer>
  );
}
