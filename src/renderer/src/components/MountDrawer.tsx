import { createMemo, createSignal, createUniqueId, For, Match, onMount, Show, Switch, untrack } from 'solid-js';
import { createStore, produce, unwrap } from 'solid-js/store';
import { FolderOpen } from 'lucide-solid';
import { CACHE_AGE_PRESETS, CACHE_SIZE_PRESETS, MOUNT_OPTION_CATALOG, type MountOption, type MountOptionMap, type MountOptionValue } from '@shared/mountOptions';
import { VFS_CACHE_MODES, type MountProfile, type RemoteSummary } from '@shared/types';
import { useAction } from '../lib/actions';
import { Drawer, Feedback, FormActions, Segmented, Toggle } from './ui';

type MountDraft = Parameters<typeof window.api.saveMountProfile>[0];
const OPTION_GROUPS = [
  { key: 'mount', label: 'Mount options' },
  { key: 'vfs', label: 'VFS options' },
] as const;
const TRISTATE_VALUES = ['true', 'false'] as const;
const CUSTOM_PRESET = 'custom';

function CachePicker(props: {
  label: string; presets: readonly { value: string; label: string }[]; value: string; placeholder: string;
  onChange: (value: string) => void;
}) {
  const id = createUniqueId();
  const [custom, setCustom] = createSignal(untrack(() => !props.presets.some(({ value }) => value === props.value)));
  return (
    <div class="field">
      <label for={id}>{props.label}</label>
      <select id={id} value={custom() ? CUSTOM_PRESET : props.value} onChange={(event) => {
        const selected = event.currentTarget.value;
        setCustom(selected === CUSTOM_PRESET);
        props.onChange(selected === CUSTOM_PRESET ? '' : selected);
      }}>
        <For each={props.presets}>{(preset) => <option value={preset.value}>{preset.label}</option>}</For>
        <option value={CUSTOM_PRESET}>Custom…</option>
      </select>
      <Show when={custom()}>
        <input aria-label={`Custom ${props.label.toLowerCase()}`} required placeholder={props.placeholder} value={props.value}
          onInput={(event) => props.onChange(event.currentTarget.value)} />
      </Show>
    </div>
  );
}

function isDecimalInteger(option: MountOption): boolean {
  return option.type === 'int' && option.format !== 'octal';
}

function initialOptionValue(option: MountOption): MountOptionValue {
  if (option.type === 'bool') return true;
  if (option.type === 'tristate') return 'true';
  if (option.format === 'id') return '';
  return isDecimalInteger(option) ? Number(option.defaultValue) : option.defaultValue;
}

function OptionEditor(props: { option: MountOption; value: MountOptionValue | undefined; onChange: (value: MountOptionValue) => void }) {
  const integer = () => isDecimalInteger(props.option);
  return (
    <Switch>
      <Match when={props.option.type === 'bool'}>
        <Toggle label={props.option.flag} hideLabel checked={props.value === true} onChange={props.onChange} />
      </Match>
      <Match when={props.option.type === 'tristate'}>
        <Segmented label={props.option.flag} options={TRISTATE_VALUES} value={props.value === 'false' ? 'false' : 'true'} onChange={props.onChange} />
      </Match>
      <Match when={true}>
        <input aria-label={props.option.flag} class="path" type={integer() ? 'number' : 'text'}
          min={integer() ? 0 : undefined} required={props.option.type !== 'string'}
          inputmode={props.option.format === 'octal' ? 'numeric' : undefined}
          placeholder={String(props.option.defaultValue)} value={String(props.value ?? '')}
          onInput={(event) => props.onChange(integer() && event.currentTarget.value !== '' ? event.currentTarget.valueAsNumber : event.currentTarget.value)} />
      </Match>
    </Switch>
  );
}

function AdvancedOptions(props: {
  mount?: MountOptionMap; vfs?: MountOptionMap;
  onChange: (option: MountOption, value: MountOptionValue | undefined) => void;
}) {
  const id = createUniqueId();
  const platform = window.api.platform;
  const value = (option: MountOption) => props[option.group]?.[option.key];
  const active = createMemo(() => MOUNT_OPTION_CATALOG.filter((option) => value(option) !== undefined));
  const available = createMemo(() => MOUNT_OPTION_CATALOG.filter((option) =>
    value(option) !== undefined || option.platforms === 'all' || option.platforms.some((system) => system === platform)));
  return (
    <div class="field">
      <label for={id}>Advanced options</label>
      <div class="input-group">
        <select id={id} onChange={(event) => {
          const select = event.currentTarget;
          const option = available().find(({ flag }) => flag === select.value);
          select.value = '';
          if (option && value(option) === undefined) props.onChange(option, initialOptionValue(option));
        }}>
          <option value="" disabled selected>Add a mount or VFS option…</option>
          <For each={OPTION_GROUPS}>{(group) => (
            <optgroup label={group.label}>
              <For each={available().filter((option) => option.group === group.key)}>{(option) => (
                <option value={option.flag} disabled={value(option) !== undefined}>{option.flag} — {option.description}</option>
              )}</For>
            </optgroup>
          )}</For>
        </select>
      </div>
      <Show when={active().length}>
        <ul class="flag-list">
          <For each={active()}>{(option) => (
            <li class="flag-row">
              <span><code class="path">{option.flag}</code><small class="secondary">{option.description}</small></span>
              <div class="row">
                <OptionEditor option={option} value={value(option)} onChange={(next) => props.onChange(option, next)} />
                <button type="button" class="icon-button" aria-label={`Remove ${option.flag}`} onClick={() => props.onChange(option, undefined)}>×</button>
              </div>
            </li>
          )}</For>
        </ul>
      </Show>
    </div>
  );
}

export function mountDraft(name: string, remote: string, cache: MountProfile['vfsCacheMode']): MountDraft {
  return { name, remote, remotePath: '', mountPoint: '', vfsCacheMode: cache, vfsCacheMaxAge: '', vfsCacheMaxSize: '',
    autoMount: false, readOnly: false, extraFlags: [] };
}

export function MountDrawer(props: {
  profile?: MountProfile; remote?: string; remotes: RemoteSummary[]; cache: MountProfile['vfsCacheMode']; connected: boolean; close: () => void;
}) {
  const [draft, setDraft] = createStore(untrack(() => {
    const initial = props.profile ?? mountDraft(props.remote ?? '', props.remote ?? props.remotes[0]?.name ?? '', props.cache);
    return { ...initial, mountOpts: { ...initial.mountOpts }, vfsOpts: { ...initial.vfsOpts } };
  }));
  const [flags, setFlags] = createSignal(untrack(() => draft.extraFlags.join('\n')));
  const showRawFlags = untrack(() => draft.extraFlags.length > 0);
  const [types, setTypes] = createSignal<string[]>([]);
  const action = useAction();
  const lookup = useAction();
  const mountPointId = createUniqueId();
  const mountPointHint = window.api.platform === 'win32' ? 'e.g. X:\\ or C:\\Mounts\\vault' : 'e.g. /mnt/vault';
  onMount(() => {
    if (props.connected) void lookup.run(async () => setTypes(await window.api.mountTypes()));
  });

  async function save() {
    if (await action.run(() => untrack(() => window.api.saveMountProfile({ ...unwrap(draft), name: draft.name.trim(),
      extraFlags: flags().split('\n').map((flag) => flag.trim()).filter(Boolean) })))) props.close();
  }

  function changeOption(option: MountOption, value: MountOptionValue | undefined) {
    const field = option.group === 'mount' ? 'mountOpts' : 'vfsOpts';
    setDraft(field, produce((options) => {
      if (value === undefined) delete options[option.key];
      else options[option.key] = value;
    }));
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
          <div class="field">
            <label for={mountPointId}>Mount point</label>
            <div class="input-group">
              <input id={mountPointId} class="path" placeholder={mountPointHint} required value={draft.mountPoint}
                onInput={(event) => setDraft('mountPoint', event.currentTarget.value)} />
              <button type="button" class="button input-addon" aria-label="Choose folder" disabled={lookup.pending()} onClick={() => void lookup.run(async () => {
                const path = await window.api.pickDirectory();
                if (path) setDraft('mountPoint', path);
              })}><FolderOpen size={14} aria-hidden="true" /> Browse</button>
            </div>
          </div>
          <div class="setting-row"><span>VFS cache mode</span>
            <Segmented label="VFS cache mode" options={VFS_CACHE_MODES} value={draft.vfsCacheMode ?? 'off'} onChange={(value) => setDraft('vfsCacheMode', value)} />
          </div>
          <div class="form-columns">
            <CachePicker label="Cache max size" presets={CACHE_SIZE_PRESETS} placeholder="e.g. 10G" value={draft.vfsCacheMaxSize}
              onChange={(value) => setDraft('vfsCacheMaxSize', value)} />
            <CachePicker label="Cache max age" presets={CACHE_AGE_PRESETS} placeholder="e.g. 24h" value={draft.vfsCacheMaxAge}
              onChange={(value) => setDraft('vfsCacheMaxAge', value)} />
          </div>
          <Toggle label="Read-only" checked={draft.readOnly} onChange={(value) => setDraft('readOnly', value)} />
          <Toggle label="Mount at daemon startup" checked={draft.autoMount} onChange={(value) => setDraft('autoMount', value)} />
          <label class="field">Mount type<select value={draft.mountType ?? ''} onChange={(event) => setDraft('mountType', event.currentTarget.value || undefined)}>
            <option value="">Daemon default</option>
            <For each={types()}>{(type) => <option value={type}>{type}</option>}</For>
            <option value={draft.mountType} hidden={!draft.mountType || types().includes(draft.mountType)}>{draft.mountType}</option>
          </select></label>
          <AdvancedOptions mount={draft.mountOpts} vfs={draft.vfsOpts} onChange={changeOption} />
          <details class="advanced" open={showRawFlags}>
            <summary>Raw FUSE / WinFsp flags</summary>
            <label class="field">Extra flags<textarea placeholder="One flag per line" value={flags()} onInput={(event) => setFlags(event.currentTarget.value)} /></label>
          </details>
        </fieldset>
        <Feedback action={lookup} />
        <Feedback action={action} />
        <FormActions label="Save profile" busy={action.pending()} disabled={lookup.pending()} close={props.close} />
      </form>
    </Drawer>
  );
}
