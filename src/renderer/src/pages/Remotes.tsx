import { createSignal, For, Show, untrack } from 'solid-js';
import { LockKeyhole, Plus } from 'lucide-solid';
import type { RemoteSummary } from '@shared/types';
import { CryptDrawer } from '../components/CryptDrawer';
import { MountDrawer } from '../components/MountDrawer';
import { ProviderIcon } from '../components/ProviderIcon';
import { RemoteDrawer } from '../components/RemoteDrawer';
import { Confirm, Empty, Feedback, PageHeader, SectionHeader } from '../components/ui';
import { VolumeConduit } from '../components/VolumeConduit';
import { providerName } from '../lib/remotes';
import { useAction } from '../lib/actions';
import type { PageProps } from '../store';

type DrawerState = { kind: 'add' } | { kind: 'edit'; remote: RemoteSummary } | { kind: 'crypt'; target?: string } | { kind: 'mount'; remote: string };

function RemoteRow(props: PageProps & { remote: RemoteSummary; open: (drawer: DrawerState) => void }) {
  const action = useAction();
  const name = () => props.remote.name;
  return (
    <article class="ledger-row" classList={{ 'direct-remote': !props.remote.isCrypt }}>
      <div class="ledger-heading">
        <div class="row">
          <ProviderIcon type={props.remote.type} />
          <strong>{name()}</strong><span class="chip" classList={{ encrypted: props.remote.isCrypt }}>
            {props.remote.isCrypt ? 'Encrypted' : providerName(props.remote.type)}</span>
        </div>
        <Show when={props.remote.isCrypt}><span class="secondary">Directory names {props.remote.directoryNameEncryption ? 'encrypted' : 'visible'}</span></Show>
      </div>
      <Show when={props.remote.isCrypt}>
        <VolumeConduit spec={`${name()}:`} remote={props.remote} remotes={props.store.snapshot()?.remotes ?? []} />
      </Show>
      <div class="actions remote-actions">
        <button type="button" class="button" onClick={() => {
          props.store.setBrowserTarget({ remote: name(), path: '' });
          props.navigate('Browser');
        }}>Browse</button>
        <button type="button" class="button" onClick={() => props.open({ kind: 'mount', remote: name() })}>Mount</button>
        <button type="button" class="button quiet" disabled={action.pending()} onClick={() => void action.run(() => untrack(() => window.api.testRemote(name())), 'Connection passed.')}>Test connection</button>
        <button type="button" class="button quiet" onClick={() => props.open({ kind: 'edit', remote: props.remote })}>Edit</button>
        <div class="action-danger"><Confirm label="Delete" question={`Delete ${name()} from rclone configuration?`} disabled={action.pending()}
          action={() => window.api.deleteRemote(name())} /></div>
      </div>
      <Feedback action={action} />
    </article>
  );
}

export function Remotes(props: PageProps) {
  const [drawer, setDrawer] = createSignal<DrawerState>();
  const remotes = () => props.store.snapshot()?.remotes ?? [];
  const connected = () => props.store.snapshot()?.daemon.state === 'running';
  const close = () => setDrawer(undefined);
  return (
    <>
      <PageHeader title="Remotes" description="Manage cloud connections and the vaults backed by them.">
        <div class="actions">
          <button class="button" type="button" disabled={!remotes().length} onClick={() => setDrawer({ kind: 'crypt' })}><LockKeyhole size={16} /> Wrap with encryption</button>
          <button class="button primary" type="button" disabled={!connected()} onClick={() => setDrawer({ kind: 'add' })}><Plus size={16} /> Add remote</button>
        </div>
      </PageHeader>
      <For each={[true, false]}>{(encrypted) => (
        <section class="panel">
          <SectionHeader title={encrypted ? 'Encrypted vaults' : 'Cloud remotes'} />
          <For each={remotes().filter((remote) => remote.isCrypt === encrypted).map(({ name }) => name)} fallback={<Empty>
            {!connected() ? 'Connect to rclone to see configured remotes.' : encrypted ? 'No encrypted vaults.' : 'No cloud remotes.'}
          </Empty>}>{(name) => (
            <RemoteRow store={props.store} navigate={props.navigate} remote={remotes().find((item) => item.name === name)!} open={setDrawer} />
          )}</For>
        </section>
      )}</For>
      <Show when={drawer()} keyed>{(current) => {
        switch (current.kind) {
          case 'add': return <RemoteDrawer store={props.store} close={close} />;
          case 'edit': return <RemoteDrawer store={props.store} remote={current.remote} close={close} />;
          case 'crypt': return <CryptDrawer remotes={remotes()} target={current.target} close={close} saved={(remote, mount) => {
            if (mount) setDrawer({ kind: 'mount', remote });
            else close();
          }} />;
          case 'mount': return <MountDrawer remote={current.remote} remotes={remotes()} cache={props.store.settings().daemon.defaultVfsCacheMode}
            connected={connected()} close={close} />;
        }
      }}</Show>
    </>
  );
}
