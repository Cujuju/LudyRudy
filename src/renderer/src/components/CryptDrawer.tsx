import { For, Show, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Copy } from 'lucide-solid';
import type { CryptDraft, RemoteSummary } from '@shared/types';
import { useAction } from '../lib/actions';
import { Drawer, Feedback, FormActions, SecretInput, Segmented, Toggle } from './ui';

const CIPHER_MODES = ['standard', 'obfuscate', 'off'] as const;
const VAULT_SECRET_BITS = 256;

export function CryptDrawer(props: { remotes: RemoteSummary[]; target?: string; close: () => void; saved: (remote: string, mount: boolean) => void }) {
  const [draft, setDraft] = createStore<CryptDraft & { mount: boolean }>({
    name: '', targetRemote: untrack(() => props.target ?? props.remotes[0]?.name ?? ''), targetPath: '', password: '', salt: '',
    filenameEncryption: 'standard', directoryNameEncryption: true, mount: false,
  });
  const action = useAction();
  const tools = useAction();

  async function save() {
    const { mount, ...vault } = draft;
    vault.name = vault.name.trim();
    if (await action.run(() => window.api.createCryptRemote(vault))) props.saved(vault.name, mount);
  }

  function generate(key: 'password' | 'salt') {
    void tools.run(async () => setDraft(key, await window.api.generateSecret(VAULT_SECRET_BITS)));
  }

  return (
    <Drawer title="Wrap with encryption" description="Create a vault backed by an existing remote." busy={action.pending()} close={props.close}>
      <form class="form-stack" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={action.pending()}>
          <label class="field">Storage remote<select required value={draft.targetRemote} onChange={(event) => setDraft('targetRemote', event.currentTarget.value)}>
            <option value="" selected={!draft.targetRemote}>Choose a remote</option>
            <For each={props.remotes}>{(remote) => <option value={remote.name} selected={draft.targetRemote === remote.name}>{remote.name}{remote.isCrypt ? ' (encrypted)' : ''}</option>}</For>
          </select></label>
          <label class="field">Storage subfolder<input class="path" placeholder="Remote root" value={draft.targetPath}
            onInput={(event) => setDraft('targetPath', event.currentTarget.value)} /></label>
          <label class="field">Vault name<input required value={draft.name} onInput={(event) => setDraft('name', event.currentTarget.value)} /></label>
          <SecretInput label="Vault password" value={draft.password} required onInput={(value) => setDraft('password', value)}>
            <button type="button" class="button input-addon" aria-label="Generate password" title={`Generate ${VAULT_SECRET_BITS}-bit password`}
              disabled={tools.pending()} onClick={() => generate('password')}>Generate</button>
            <button type="button" class="button input-addon" aria-label="Copy password" title="Copy password"
              disabled={!draft.password || tools.pending()} onClick={() => void tools.run(
                () => untrack(() => navigator.clipboard.writeText(draft.password)), 'Password copied.')}><Copy size={14} aria-hidden="true" /></button>
          </SecretInput>
          <SecretInput label="Salt (optional)" value={draft.salt ?? ''} onInput={(value) => setDraft('salt', value)}>
            <button type="button" class="button input-addon" aria-label="Generate salt" title={`Generate ${VAULT_SECRET_BITS}-bit salt`}
              disabled={tools.pending()} onClick={() => generate('salt')}>Generate</button>
            <button type="button" class="button input-addon" aria-label="Copy salt" title="Copy salt"
              disabled={!draft.salt || tools.pending()} onClick={() => void tools.run(
                () => untrack(() => navigator.clipboard.writeText(draft.salt ?? '')), 'Salt copied.')}><Copy size={14} aria-hidden="true" /></button>
          </SecretInput>
          <p class="banner">Save the password and any salt somewhere safe. You’ll need them to recover the vault.</p>
          <div class="setting-row"><span>Filename encryption</span>
            <Segmented label="Filename encryption" options={CIPHER_MODES} value={draft.filenameEncryption} onChange={(value) => setDraft('filenameEncryption', value)} />
          </div>
          <Toggle label="Encrypt directory names" checked={draft.directoryNameEncryption} onChange={(value) => setDraft('directoryNameEncryption', value)} />
          <Toggle label="Also create mount profile" checked={draft.mount} onChange={(value) => setDraft('mount', value)} />
          <Show when={draft.mount}><p class="secondary">Choose the local mount point after creating the vault.</p></Show>
        </fieldset>
        <Feedback action={tools} />
        <Feedback action={action} />
        <FormActions label="Create vault" busy={action.pending()} disabled={tools.pending()} close={props.close} />
      </form>
    </Drawer>
  );
}
