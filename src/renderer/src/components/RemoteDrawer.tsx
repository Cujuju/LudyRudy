import { createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js';
import type { AuthSession, ProviderOptionSpec, RemoteEditorData, RemoteParameters, RemoteSummary } from '@shared/types';
import { useAction } from '../lib/actions';
import {
  type EndpointOptions,
  groupProviderOptions,
  optionChoiceExamples,
  optionValue,
  providerVariant,
  requiresOptionValue,
  visibleProviderOptions,
} from '../lib/remoteOptions';
import { providerName } from '../lib/remotes';
import type { AppStore } from '../store';
import { ProviderCatalogDialog } from './ProviderCatalogDialog';
import { ProviderIcon } from './ProviderIcon';
import { RemoteConfigStep, useRemoteConfiguration } from './RemoteConfigStep';
import { Drawer, Empty, Feedback, FormActions, SecretInput, Select, Toggle } from './ui';

const KEEP_SAVED_VALUE = 'Leave blank to keep the saved value';

function EndpointRow(props: {
  endpoint: EndpointOptions;
  values: RemoteParameters;
  edit: boolean;
  update: (option: string, value: string) => void;
}) {
  const value = (option: ProviderOptionSpec) => String(optionValue(option, props.values) ?? '');
  const required = (option: ProviderOptionSpec) => !props.edit && requiresOptionValue(option);
  const placeholder = (option: ProviderOptionSpec) => props.edit && option.sensitive ? KEEP_SAVED_VALUE : undefined;
  return (
    <div class="endpoint-row" role="group" aria-label="Connection address">
      <label class="field">
        <span>User</span>
        <input required={required(props.endpoint.user)} value={value(props.endpoint.user)} placeholder={placeholder(props.endpoint.user)}
          onInput={(event) => props.update('user', event.currentTarget.value)} />
      </label>
      <span class="endpoint-sep" aria-hidden="true">@</span>
      <label class="field">
        <span>Host</span>
        <input class="path" required={required(props.endpoint.host)} value={value(props.endpoint.host)} placeholder={placeholder(props.endpoint.host)}
          onInput={(event) => props.update('host', event.currentTarget.value)} />
      </label>
      <span class="endpoint-sep" aria-hidden="true">:</span>
      <label class="field">
        <span>Port</span>
        <input class="numeric" inputMode="numeric" required={required(props.endpoint.port)} value={value(props.endpoint.port)} placeholder={placeholder(props.endpoint.port)}
          onInput={(event) => props.update('port', event.currentTarget.value)} />
      </label>
    </div>
  );
}

function ProviderOption(props: {
  option: ProviderOptionSpec; values: RemoteParameters; variant: string; edit: boolean; update: (value: string | boolean) => void;
}) {
  const name = () => props.option.name;
  const value = () => optionValue(props.option, props.values);
  const text = () => String(value() ?? '');
  const required = () => !props.edit && requiresOptionValue(props.option);
  const examples = () => optionChoiceExamples(props.option, props.variant);
  const placeholder = () => props.edit && props.option.sensitive ? KEEP_SAVED_VALUE : undefined;
  return (
    <div class="field">
      <Show when={props.option.input === 'password'} fallback={
        <Show when={props.option.input !== 'boolean'} fallback={
          <Toggle label={name()} checked={/^(?:1|t|true)$/i.test(text())} onChange={props.update} />
        }>
          <label class="field">{name()}
            <Show when={examples().length} fallback={
              <input required={required()} value={text()} placeholder={placeholder()} onInput={(event) => props.update(event.currentTarget.value)} />
            }>
              <Select label={name()} value={text()} onChange={props.update}
                options={[{ value: '', label: 'Select an option' },
                  ...(text() && !examples().some(({ value }) => value === text()) ? [{ value: text(), label: text() }] : []),
                  ...examples().map(({ value, help }) => ({
                    value, label: help ? `${value} / ${help.split('\n')[0]}` : value,
                  }))]} />
            </Show>
          </label>
        </Show>
      }>
        <SecretInput label={name()} value={text()} required={required()} placeholder={placeholder()} onInput={props.update} />
      </Show>
      <Show when={props.option.help}>
        <small class="secondary">{props.option.help?.split('\n\n')[0]}</small>
      </Show>
    </div>
  );
}

export function RemoteDrawer(props: { store: AppStore; remote?: RemoteSummary; close: () => void }) {
  const [editor, setEditor] = createSignal<RemoteEditorData>({ providers: [], values: {} });
  const providers = () => editor().providers;
  const [name, setName] = createSignal(untrack(() => props.remote?.name ?? ''));
  const [kind, setKind] = createSignal(untrack(() => props.remote?.type ?? ''));
  const [parameters, setParameters] = createSignal<RemoteParameters>({});
  const values = createMemo(() => ({ ...editor().values, ...parameters() }));
  const [catalogOpen, setCatalogOpen] = createSignal(false);
  let moreProviders: HTMLButtonElement | undefined;
  const [session, setSession] = createSignal<AuthSession>();
  const lookup = useAction();
  const authAction = useAction();
  const { action: saveAction, configuration, setConfiguration, save: writeConfig } = useRemoteConfiguration(() => props.close());
  const busy = () => saveAction.pending();
  const provider = () => providers().find((item) => item.name === kind());
  const auth = () => {
    const selected = session();
    const current = props.store.auth();
    if (selected?.provider !== kind()) return undefined;
    return current?.id === selected?.id ? current ?? selected : selected;
  };
  const authActive = () => auth()?.state === 'starting' || auth()?.state === 'awaiting';
  const authComplete = () => auth()?.state === 'completed';
  const popular = createMemo(() => providers().filter((item) => item.popular));
  const hasMore = createMemo(() => providers().some((item) => !item.popular));
  const selectedExtra = createMemo(() => {
    const current = provider();
    return current && !current.popular ? current : undefined;
  });
  const options = createMemo(() => provider()?.options ?? []);
  const variant = createMemo(() => providerVariant(options(), values()));
  const fields = createMemo(() => visibleProviderOptions(options(), variant()));
  const grouped = createMemo(() => groupProviderOptions(fields()));
  const endpoint = () => grouped().endpoint;
  const common = () => grouped().common;
  const advanced = () => grouped().advanced;
  const missingRequiredChoice = () => !props.remote && fields().some((option) => {
    if (!requiresOptionValue(option)) return false;
    const choices = optionChoiceExamples(option, variant());
    const value = String(optionValue(option, values()) ?? '');
    return choices.length > 0 && (!value || !choices.some((example) => example.value === value));
  });
  const cannotSave = () => !!configuration() || !provider() || authActive() || authAction.pending() || missingRequiredChoice()
    || (!!provider()?.isOAuth && !props.remote && !authComplete());

  function load() {
    void lookup.run(async () => {
      const remote = untrack(() => props.remote);
      const data = await window.api.remoteEditor(remote ? { name: remote.name, type: remote.type } : undefined);
      setEditor(data);
      setConfiguration(data.configuration);
    });
  }
  onMount(load);
  let disposed = false;
  let supersededAuth: Promise<void> | undefined;
  onCleanup(() => {
    disposed = true;
    const id = session()?.id;
    if (id) void window.api.cancelAuth(id).catch((error: unknown) => console.error('Could not close authorization.', error));
  });

  async function authorize() {
    await authAction.run(async () => {
      const before = untrack(parameters);
      const request = untrack(() => ({ type: kind(), name: props.remote?.name, parameters: draftParameters() }));
      const previous = untrack(session)?.id;
      if (previous) await window.api.cancelAuth(previous);
      await supersededAuth;
      if (disposed || untrack(parameters) !== before) return;
      const next = await window.api.startAuth(request);
      if (disposed || untrack(parameters) !== before) await window.api.cancelAuth(next.id);
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
    const id = session()?.id;
    if (id) {
      setSession(undefined);
      supersededAuth = window.api.cancelAuth(id).catch((error: unknown) => console.error('Could not close authorization.', error));
    }
  }

  function draftParameters(): RemoteParameters {
    const changes = parameters();
    return Object.fromEntries(fields().flatMap((option) => {
      const key = option.name;
      const value = changes[key];
      return Object.hasOwn(changes, key) && value !== undefined && (value !== '' || !option.sensitive) ? [[key, value]] : [];
    }));
  }

  async function save() {
    if (cannotSave()) return;
    await writeConfig(() => untrack(() => {
      const id = authComplete() ? auth()?.id : undefined;
      const draft = { name: name().trim(), type: kind(), parameters: draftParameters(), ...(id ? { authSessionId: id } : {}) };
      return props.remote ? window.api.updateRemote(draft) : window.api.createRemote(draft);
    }));
  }

  return (
    <Drawer title={props.remote ? 'Edit remote' : 'Add remote'} description="Configure a storage provider for rclone." busy={busy()} close={props.close}>
      <form class="form-stack" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy() || !!configuration()}>
          <label class="field">Remote name<input value={name()} readonly={!!props.remote} required onInput={(event) => setName(event.currentTarget.value)} /></label>
          <Show when={!props.remote} fallback={
            <p class="row secondary"><ProviderIcon type={kind()} />Provider: {providerName(kind())}</p>
          }>
            <div class="field">
              <span>Provider</span>
              <Show when={popular().length || hasMore()}>
                <div class="provider-picker" role="group" aria-label="Popular providers">
                  <For each={popular()}>{(item) => (
                    <button type="button" class="button" aria-pressed={kind() === item.name} disabled={authActive() || authComplete() || authAction.pending()}
                      onClick={() => select(item.name)}><ProviderIcon type={item.name} size="sm" />{providerName(item.name)}</button>
                  )}</For>
                  <Show when={selectedExtra()}>{(item) => (
                    <button type="button" class="button" aria-pressed="true" disabled={authActive() || authComplete() || authAction.pending()}
                      onClick={() => setCatalogOpen(true)}><ProviderIcon type={item().name} size="sm" />{providerName(item().name)}</button>
                  )}</Show>
                  <Show when={hasMore()}>
                    <button ref={moreProviders} type="button" class="button" disabled={authActive() || authComplete() || authAction.pending()}
                      onClick={() => setCatalogOpen(true)}>More…</button>
                  </Show>
                </div>
              </Show>
            </div>
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
          <Show when={endpoint()}>{(trio) => (
            <EndpointRow endpoint={trio()} values={values()} edit={!!props.remote} update={change} />
          )}</Show>
          <For each={common()}>{(option) => (
            <ProviderOption option={option} values={values()} variant={variant()} edit={!!props.remote} update={(value) => change(option.name, value)} />
          )}</For>
          <Show when={advanced().length}>
            <details class="advanced"><summary>Advanced options</summary>
              <div class="form-stack">
                <For each={advanced()}>{(option) => (
                  <ProviderOption option={option} values={values()} variant={variant()} edit={!!props.remote} update={(value) => change(option.name, value)} />
                )}</For>
              </div>
            </details>
          </Show>
        </fieldset>
        <Show when={configuration()} fallback={
          <>
            <Feedback action={saveAction} />
            <FormActions label={props.remote ? 'Save remote' : 'Add remote'} close={props.close} busy={busy()} disabled={cannotSave()} />
          </>
        }>{(step) => <RemoteConfigStep configuration={step()} action={saveAction} save={writeConfig} close={props.close}
          edit={props.remote ? () => { saveAction.clear(); setConfiguration(undefined); } : undefined} />}</Show>
      </form>
      <Show when={catalogOpen()}>
        <ProviderCatalogDialog providers={providers()} selected={kind()} focusFallback={() => moreProviders}
          select={(next) => { select(next); setCatalogOpen(false); }} close={() => setCatalogOpen(false)} />
      </Show>
    </Drawer>
  );
}
