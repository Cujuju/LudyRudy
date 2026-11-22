import { createMemo, createResource, createSignal, For, Show, untrack } from 'solid-js';
import { VFS_CACHE_MODES } from '@shared/types';
import type { AppSettings } from '@shared/settings';
import type { AppStore } from '../store';
import { errorMessage, useAction } from '../lib/actions';
import { Confirm, Feedback, SectionHeader, SecretInput, Segmented, Toggle } from './ui';

function LocationSetting(props: {
  label: string; value: string; placeholder?: string; save: (value: string) => Promise<unknown>;
  chooseLabel?: string; choose?: () => Promise<string | null>;
}) {
  const [draft, setDraft] = createSignal<string>();
  const action = useAction();
  const value = () => draft() ?? props.value;
  async function save(path: string) {
    if (await action.run(() => untrack(() => props.save(path.trim())), 'Saved.')) setDraft(undefined);
  }
  return (
    <form class="setting-form" onSubmit={(event) => { event.preventDefault(); void save(value()); }}>
      <label class="field">{props.label}
        <input class="path" value={value()} placeholder={props.placeholder} disabled={action.pending()} onInput={(event) => setDraft(event.currentTarget.value)} />
      </label>
      <div class="actions">
        <button type="submit" class="button" disabled={value() === props.value || action.pending()}>Save</button>
        <Show when={props.choose}>{(choose) => (
          <button type="button" class="button" disabled={action.pending()} onClick={() => void action.run(async () => {
            const location = await untrack(() => choose()());
            if (location) {
              setDraft(location);
              await untrack(() => props.save(location));
              setDraft(undefined);
            }
          })}>{props.chooseLabel}</button>
        )}</Show>
        <button type="button" class="button quiet" disabled={!value() || action.pending()} onClick={() => void save('')}>Clear</button>
      </div>
      <Feedback action={action} />
    </form>
  );
}

function ConfigEncryption(props: { store: AppStore }) {
  const [password, setPassword] = createSignal('');
  const [removing, setRemoving] = createSignal(false);
  const action = useAction();
  const daemon = () => props.store.snapshot()?.daemon;
  const encrypted = () => daemon()?.configEncrypted;
  const managed = createMemo(() => daemon()?.mode === 'managed');
  const managedPath = createMemo(() => managed() ? props.store.settings().daemon.configPath || '(default)' : false);
  const [stored, passwordActions] = createResource(managedPath, async () => {
    try {
      return { present: await window.api.hasConfigPassword(), error: '' };
    } catch (cause) {
      return { present: false, error: errorMessage(cause) };
    }
  });
  const locked = () => encrypted() === true && (!stored()?.present || !!daemon()?.error?.toLowerCase().includes('config'));
  const label = () => locked() ? 'Unlock config' : encrypted() ? 'Change password' : 'Set password';

  async function change(value: string | null) {
    await window.api.setConfigPassword(value);
    setPassword('');
    await passwordActions.refetch();
  }

  async function removeEncryption() {
    if (action.pending() || removing()) return;
    setRemoving(true);
    try {
      await change(null);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section class="panel">
      <SectionHeader title="rclone.conf encryption"><span class="chip" classList={{ encrypted: !!encrypted() }}>
        {daemon()?.mode === 'attached' ? 'External config' : encrypted() ? locked() ? 'Locked' : 'Encrypted' : encrypted() === false ? 'Unencrypted' : 'Unknown'}
      </span></SectionHeader>
      <div class="settings-body">
        <Show when={daemon()?.mode === 'managed'} fallback={<p class="secondary">Manage config encryption on the host running rclone.</p>}>
          <p class="secondary">ludyRudy keeps the password in your operating system’s credential store.</p>
          <Show when={stored()?.error}>{(error) => <p class="banner error" role="alert">{error()}</p>}</Show>
          <form class="form-stack" onSubmit={(event) => {
            event.preventDefault();
            const unlocking = locked();
            if (!removing()) void action.run(() => untrack(() => change(password())), unlocking ? 'Config unlocked. Start the daemon when ready.' : 'Config encryption updated.');
          }}>
            <SecretInput label={locked() ? 'Existing config password' : 'New config password'} required value={password()} onInput={setPassword} />
            <div class="actions">
              <button type="submit" class="button primary" disabled={action.pending() || removing() || stored.loading || !password().trim() || !daemon()?.binaryPath}>{label()}</button>
              <Show when={encrypted() && !locked()}>
                <Confirm label="Remove encryption" question="Remove password protection from rclone.conf?" disabled={action.pending()}
                  action={removeEncryption} />
              </Show>
            </div>
          </form>
          <Feedback action={action} />
        </Show>
      </div>
    </section>
  );
}

export function DaemonSettings(props: { store: AppStore }) {
  const config = () => props.store.settings().daemon;
  const snapshot = () => props.store.snapshot();
  const daemon = () => snapshot()?.daemon;
  const action = useAction();
  const change = (patch: Partial<AppSettings['daemon']>) => window.api.updateDaemon(patch);
  return (
    <>
      <section class="panel">
        <SectionHeader title="Daemon settings" />
        <div class="settings-body">
          <div class="setting-row"><div><strong>Local rclone binary</strong><p class="path secondary selectable">{snapshot()?.prereqs.rclonePath ?? 'Binary not found'}</p></div>
            <div class="actions"><span class="chip">{daemon()?.binarySource ?? 'Unknown'}</span>
              <Show when={snapshot()?.prereqs.rcloneVersion}><span class="chip">{snapshot()?.prereqs.rcloneVersion}</span></Show></div></div>
          <LocationSetting label="Custom binary path" value={config().binaryPath} placeholder="Use the bundled or installed binary"
            chooseLabel="Choose binary" choose={window.api.pickRcloneBinary} save={(binaryPath) => change({ binaryPath })} />
          <Toggle label="Auto-start daemon" checked={config().autoStart} disabled={action.pending()} onChange={(autoStart) => void action.run(() => change({ autoStart }))} />
          <div class="setting-row"><span>Default VFS cache mode</span>
            <Segmented label="Default VFS cache mode" options={VFS_CACHE_MODES} value={config().defaultVfsCacheMode}
              disabled={action.pending()} onChange={(defaultVfsCacheMode) => void action.run(() => change({ defaultVfsCacheMode }))} />
          </div>
          <LocationSetting label="Default cache directory" value={config().defaultCacheDir} placeholder="Use the app cache directory"
            chooseLabel="Choose folder" choose={window.api.pickDirectory} save={(defaultCacheDir) => change({ defaultCacheDir })} />
          <LocationSetting label="External endpoint override" value={config().endpoint} placeholder="Use the managed daemon"
            save={(endpoint) => change({ endpoint })} />
          <p class="secondary">Restart rclone to apply daemon changes.</p>
          <div class="actions">
            <For each={['config', 'cache', 'data'] as const}>{(kind) => (
              <button type="button" class="button" disabled={action.pending()} onClick={() => void action.run(() => window.api.openPath(kind))}>Open {kind} folder</button>
            )}</For>
          </div>
          <Feedback action={action} />
        </div>
      </section>
      <ConfigEncryption store={props.store} />
    </>
  );
}
