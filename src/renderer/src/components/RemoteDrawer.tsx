import { createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js';
import type { AuthSession, ProviderInfo, RemoteParameters, RemoteSummary } from '@shared/types';
import { useAction } from '../lib/actions';
import { providerName } from '../lib/remotes';
import type { AppStore } from '../store';
import { ProviderIcon } from './ProviderIcon';
import { Drawer, Empty, Feedback, FormActions, SecretInput, Select, Toggle } from './ui';

function isSecret(option: Record<string, unknown>) {
  return option.IsPassword === true || /secret|password|token|pass$|private_key/i.test(String(option.Name));
}

function isBooleanOption(option: Record<string, unknown>) {
  return option.Type === 'bool' || typeof option.Default === 'boolean';
}

function requiresValue(option: Record<string, unknown>) {
  return option.Required === true && (option.Default === undefined || option.Default === '');
}

function choiceExamples(option: Record<string, unknown>) {
  return option.Exclusive === true && Array.isArray(option.Examples) && !isSecret(option) && !isBooleanOption(option)
    ? option.Examples as { Value: string; Help: string }[] : [];
}

function ProviderOption(props: {
  option: Record<string, unknown>; value: RemoteParameters[string] | undefined; edit: boolean; update: (value: string | boolean) => void;
}) {
  const name = () => String(props.option.Name);
  const initial = () => props.option.Default;
  const value = () => props.value ?? (props.edit ? undefined : initial());
  const required = () => !props.edit && requiresValue(props.option);
  const examples = () => choiceExamples(props.option);
  const selected = () => examples().some((example) => example.Value === String(value() ?? '')) ? String(value()) : '';
  return (
    <div class="field">
      <Show when={isSecret(props.option)} fallback={
        <Show when={!isBooleanOption(props.option)} fallback={
          <Toggle label={name()} checked={value() === true || value() === 'true'} onChange={props.update} />
        }>
          <label class="field">{name()}
            <Show when={examples().length} fallback={
              <input required={required()} value={String(value() ?? '')} onInput={(event) => props.update(event.currentTarget.value)} />
            }>
              <Select label={name()} value={selected()} onChange={props.update}
                options={[{ value: '', label: 'Select an option' }, ...examples().map(({ Value, Help }) => ({
                  value: Value, label: Help ? `${Value} / ${Help.split('\n')[0]}` : Value,
                }))]} />
            </Show>
          </label>
        </Show>
      }>
        <SecretInput label={name()} value={String(props.value ?? '')} required={required()}
          placeholder={props.edit ? 'Leave blank to keep the saved value' : undefined} onInput={props.update} />
      </Show>
      <Show when={typeof props.option.Help === 'string' && props.option.Help}>
        <small class="secondary">{String(props.option.Help).split('\n\n')[0]}</small>
      </Show>
    </div>
  );
}

export function RemoteDrawer(props: { store: AppStore; remote?: RemoteSummary; close: () => void }) {
  const [providers, setProviders] = createSignal<ProviderInfo[]>([]);
  const [name, setName] = createSignal(untrack(() => props.remote?.name ?? ''));
  const [kind, setKind] = createSignal(untrack(() => props.remote?.type ?? ''));
  const [parameters, setParameters] = createSignal<RemoteParameters>({});
  const values = createMemo(() => ({ ...props.remote?.config, ...parameters() }));
  const [search, setSearch] = createSignal('');
  const [session, setSession] = createSignal<AuthSession>();
  const lookup = useAction();
  const authAction = useAction();
  const saveAction = useAction();
  const busy = () => saveAction.pending();
  const provider = () => providers().find((item) => item.name === kind());
  const auth = () => {
    const current = props.store.auth();
    return current?.id === session()?.id ? current ?? session() : session();
  };
  const authActive = () => auth()?.state === 'starting' || auth()?.state === 'awaiting';
  const authComplete = () => auth()?.state === 'completed';
  const matches = createMemo(() => {
    const term = search().trim().toLowerCase();
    return providers().filter((item) => [providerName(item.name), item.name, item.description].some((value) => value.toLowerCase().includes(term)));
  });
  const fields = createMemo(() => (provider()?.options ?? []).filter((option) => option.Name !== 'token'
    && (typeof option.Provider !== 'string' || !option.Provider || !values().provider
      || option.Provider.startsWith('!') && !option.Provider.slice(1).split(',').includes(String(values().provider))
      || option.Provider.split(',').includes(String(values().provider)))));
  const common = createMemo(() => fields().filter((option) => option.Advanced !== true || option.Required === true));
  const advanced = createMemo(() => fields().filter((option) => option.Advanced === true && option.Required !== true));
  const providerOptions = createMemo(() => {
    const options = matches().map((item) => ({ value: item.name, label: `${providerName(item.name)} / ${item.description}` }));
    const selected = provider();
    if (selected && !options.some(({ value }) => value === selected.name)) {
      options.push({ value: selected.name, label: providerName(selected.name) });
    }
    return options;
  });
  const missingRequiredChoice = () => !props.remote && fields().some((option) => {
    if (!requiresValue(option)) return false;
    const choices = choiceExamples(option);
    const value = String(values()[String(option.Name)] ?? '');
    return choices.length > 0 && (!value || !choices.some((example) => example.Value === value));
  });
  const cannotSave = () => !provider() || authActive() || authAction.pending() || missingRequiredChoice()
    || (!!provider()?.isOAuth && !props.remote && !authComplete());

  function load() {
    void lookup.run(async () => setProviders(await window.api.listProviders()));
  }
  onMount(load);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    const id = session()?.id;
    if (id) void window.api.cancelAuth(id).catch((error: unknown) => console.error('Could not close authorization.', error));
  });

  async function authorize() {
    await authAction.run(async () => {
      const previous = untrack(session)?.id;
      if (previous) await window.api.cancelAuth(previous);
      const next = await window.api.startAuth(untrack(kind));
      if (disposed) await window.api.cancelAuth(next.id);
      else setSession(next);
    });
  }

  function select(value: string) {
    if (value === kind()) return;
    setKind(value);
    setParameters({});
    authAction.clear();
  }

  function change(option: string, value: string | boolean) {
    setParameters((values) => ({ ...values, [option]: value }));
  }

  async function save() {
    if (cannotSave()) return;
    if (await saveAction.run(() => untrack(() => {
      const cleaned = Object.fromEntries(fields().flatMap((option) => {
        const key = String(option.Name);
        const value = parameters()[key];
        return Object.hasOwn(parameters(), key) && (value !== '' || !isSecret(option)) ? [[key, value]] : [];
      })) as RemoteParameters;
      const id = authComplete() ? auth()?.id : undefined;
      const draft = { name: name().trim(), type: kind(), parameters: cleaned, ...(id ? { authSessionId: id } : {}) };
      return props.remote ? window.api.updateRemote(draft) : window.api.createRemote(draft);
    }))) props.close();
  }

  return (
    <Drawer title={props.remote ? 'Edit remote' : 'Add remote'} description="Configure a storage provider for rclone." busy={busy()} close={props.close}>
      <form class="form-stack" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy()}>
          <label class="field">Remote name<input value={name()} readonly={!!props.remote} required onInput={(event) => setName(event.currentTarget.value)} /></label>
          <Show when={!props.remote} fallback={
            <p class="row secondary"><ProviderIcon type={kind()} />Provider: {providerName(kind())}</p>
          }>
            <label class="field">Find a provider<input type="search" placeholder="Search all providers" value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)} /></label>
            <Show when={!search().trim() && matches().some((item) => item.popular)}>
              <div class="provider-picker" role="group" aria-label="Popular providers">
                <For each={matches().filter((item) => item.popular)}>{(item) => (
                  <button type="button" class="button" aria-pressed={kind() === item.name} disabled={authActive() || authComplete() || authAction.pending()}
                    onClick={() => select(item.name)}><ProviderIcon type={item.name} size="sm" />{providerName(item.name)}</button>
                )}</For>
              </div>
            </Show>
            <label class="field">
              <span class="row">Provider<Show when={kind()}>{(type) => <ProviderIcon type={type()} />}</Show></span>
              <Select label="Provider" value={kind()} options={providerOptions()} placeholder="Choose a provider"
                disabled={authActive() || authComplete() || authAction.pending()} onChange={select} />
            </label>
          </Show>
          <Show when={lookup.pending()}><Empty>Loading providers…</Empty></Show>
          <Show when={lookup.error()}><button type="button" class="button" onClick={load}>Retry loading providers</button></Show>
          <Feedback action={lookup} />
          <Show when={provider()?.isOAuth}>
            <section class="auth-panel">
              <strong>Connect your account</strong>
              <Show when={auth()?.state === 'starting'}><p role="status">Waiting for the authorization link…</p></Show>
              <Show when={auth()?.url}>{(url) => (
                <>
                  <p class="path selectable">{url()}</p>
                  <div class="actions">
                    <button class="button primary" type="button" disabled={authAction.pending()} onClick={() => void authAction.run(() => untrack(() => window.api.openAuth(auth()!.id)))}>Open browser</button>
                    <button class="button" type="button" disabled={authAction.pending()} onClick={() => void authAction.run(() => untrack(() => navigator.clipboard.writeText(url())), 'Link copied.')}>Copy link</button>
                  </div>
                </>
              )}</Show>
              <Show when={authComplete()}><p class="positive-text" role="status">Authorized</p></Show>
              <Show when={auth()?.error}>{(error) => <p class="danger-text" role="alert">{error()}</p>}</Show>
              <Show when={authActive() || authComplete()} fallback={
                <button class="button" type="button" disabled={authAction.pending()} onClick={() => void authorize()}>{props.remote ? 'Reconnect account' : 'Authorize'}</button>
              }>
                <button class="button" type="button" disabled={authAction.pending()} onClick={() => void authAction.run(() => untrack(() => window.api.cancelAuth(auth()!.id)))}>Cancel authorization</button>
              </Show>
              <Feedback action={authAction} />
            </section>
          </Show>
          <For each={common()}>{(option) => (
            <ProviderOption option={option} value={values()[String(option.Name)]} edit={!!props.remote} update={(value) => change(String(option.Name), value)} />
          )}</For>
          <Show when={advanced().length}>
            <details class="advanced"><summary>Advanced options</summary>
              <div class="form-stack">
                <For each={advanced()}>{(option) => (
                  <ProviderOption option={option} value={values()[String(option.Name)]} edit={!!props.remote} update={(value) => change(String(option.Name), value)} />
                )}</For>
              </div>
            </details>
          </Show>
        </fieldset>
        <Feedback action={saveAction} />
        <FormActions label={props.remote ? 'Save remote' : 'Add remote'} close={props.close} busy={busy()}
          disabled={cannotSave()} />
      </form>
    </Drawer>
  );
}
