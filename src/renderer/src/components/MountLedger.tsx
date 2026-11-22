import { For, Show, untrack } from 'solid-js';
import { Activity, ExternalLink, HardDrive, Plus } from 'lucide-solid';
import type { ActiveMount, MountProfile } from '@shared/types';
import type { PageProps } from '../store';
import { useAction } from '../lib/actions';
import { formatSpeed } from '../lib/format';
import { Confirm, Empty, Feedback, SectionHeader } from './ui';
import { VolumeConduit } from './VolumeConduit';

type MountProps = PageProps & { detailed?: boolean; edit?: (profile: MountProfile) => void; add: () => void };

function parseSpec(value: string | null | undefined): { remote: string; path: string } | null {
  if (!value) return null;
  const colon = value.indexOf(':');
  if (colon <= 0) return null;
  return { remote: value.slice(0, colon), path: value.slice(colon + 1).replace(/^\/+|\/+$/g, '') };
}

function matchesMount(transferFs: string | null | undefined, mountSpec: string): boolean {
  const transfer = parseSpec(transferFs);
  const mount = parseSpec(mountSpec);
  if (!transfer || !mount || transfer.remote !== mount.remote) return false;
  return !mount.path || transfer.path === mount.path || transfer.path.startsWith(`${mount.path}/`);
}

export function Prerequisites(props: PageProps & { mountingOnly?: boolean }) {
  const action = useAction();
  const prereqs = () => props.store.snapshot()?.prereqs;
  const backend = () => prereqs()?.mountBackend;
  const binaryMissing = () => !props.mountingOnly && prereqs()?.rcloneInstalled === false;
  const backendMissing = () => backend()?.available === false;
  return (
    <Show when={prereqs()}>
      <div class="prerequisites" classList={{ warning: binaryMissing() || backendMissing() }}>
        <div>
          <strong>{binaryMissing() || backendMissing() ? 'Local setup' : 'Local prerequisites ready'}</strong>
          <p class="secondary">{[
            !props.mountingOnly && (binaryMissing() ? 'rclone binary missing' : 'rclone installed'),
            backendMissing() ? `${backend()?.name} missing` : `${backend()?.name} detected`,
          ].filter(Boolean).join('. ')}.</p>
        </div>
        <div class="actions">
          <Show when={backendMissing() && backend()?.installUrl}><button type="button" class="button" disabled={action.pending()}
            onClick={() => void action.run(() => untrack(() => window.api.openExternal(backend()!.installUrl)))}>Install {backend()?.name} <ExternalLink size={13} /></button></Show>
          <Show when={binaryMissing() || backendMissing()}><button type="button" class="button" onClick={() => props.navigate('Settings')}>Settings</button></Show>
        </div>
        <Feedback action={action} />
      </div>
    </Show>
  );
}

function MountRow(props: MountProps & { profile?: MountProfile; external?: ActiveMount }) {
  const action = useAction();
  const mount = () => props.external ?? props.store.snapshot()?.mounts.find(({ profileId }) => profileId === props.profile?.id);
  const path = () => mount()?.mountPoint ?? props.profile?.mountPoint ?? '';
  const spec = () => mount()?.fs ?? `${props.profile?.remote}:${props.profile?.remotePath}`;
  const remote = () => props.store.snapshot()?.remotes.find(({ name }) => name === (props.profile?.remote ?? spec().split(':')[0]));
  const activeTransfers = () => (props.store.snapshot()?.stats?.transferring ?? []).filter(
    (item) => matchesMount(item.srcFs, spec()) || matchesMount(item.dstFs, spec()),
  );
  const transferSpeed = () => activeTransfers().reduce((sum, item) => sum + item.speed, 0);
  const canMount = () => props.store.snapshot()?.daemon.state === 'running' && !!remote()
    && (props.store.snapshot()?.daemon.attached || props.store.snapshot()?.prereqs.mountBackend.available);
  return (
    <article class="ledger-row" classList={{ 'compact-mount': !props.detailed }} data-mount={props.profile?.id}>
      <div class="ledger-heading">
        <div class="row"><HardDrive size={17} /><strong>{props.profile?.name ?? 'External mount'}</strong>
          <Show when={props.detailed}><span class="chip" classList={{ positive: !!mount() }}>{mount() ? 'Mounted' : 'Unmounted'}</span></Show>
          <Show when={activeTransfers().length}>
            <button type="button" class="transfer-pill" onClick={() => props.navigate('Transfers')}>
              <Activity size={13} aria-hidden="true" /> {activeTransfers().length} active <span>{formatSpeed(transferSpeed())}</span>
            </button>
          </Show>
        </div>
        <Show when={props.profile}>{(profile) => (
          <div class="actions secondary">{profile().vfsCacheMode} VFS cache
            <Show when={props.detailed}>
              <Show when={profile().vfsCacheMaxSize}><span>{profile().vfsCacheMaxSize} max</span></Show>
              <Show when={profile().vfsCacheMaxAge}><span>{profile().vfsCacheMaxAge} max age</span></Show>
              <Show when={profile().autoMount}><span class="chip">Auto-mount</span></Show>
              <Show when={profile().readOnly}><span class="chip">Read-only</span></Show>
            </Show>
          </div>
        )}</Show>
      </div>
      <VolumeConduit mountPoint={path()} spec={spec()} remote={remote()} />
      <div class="actions mount-actions">
        <Show when={mount()} fallback={<button type="button" class="button" disabled={action.pending() || !canMount()}
          onClick={() => void action.run(() => untrack(() => window.api.mountProfile(props.profile!.id)), 'Drive mounted.')}>Mount drive</button>}>
          <button type="button" class="button" disabled={action.pending()} onClick={() => void action.run(() => untrack(() => window.api.unmount(path())), 'Drive unmounted.')}>Unmount</button>
          <button type="button" class="button quiet" disabled={action.pending()} onClick={() => void action.run(() => untrack(() => window.api.revealMount(path())))}>Open folder</button>
        </Show>
        <Show when={props.detailed && props.profile}>{(profile) => (
          <>
            <Show when={mount()}><button type="button" class="button quiet" disabled={action.pending()} onClick={() => void action.run(
              () => untrack(() => window.api.vfsRefresh(profile().remote, profile().remotePath)), 'VFS cache refreshed.')}>Refresh VFS cache</button></Show>
            <button type="button" class="button quiet" disabled={action.pending()} onClick={() => props.edit?.(profile())}>Edit</button>
            <div class="action-danger"><Confirm label="Delete profile" question={mount() ? 'Delete the profile? The drive will stay mounted.' : 'Delete this mount profile?'}
              disabled={action.pending()} action={() => window.api.deleteMountProfile(profile().id)} /></div>
          </>
        )}</Show>
      </div>
      <Feedback action={action} />
    </article>
  );
}

export function MountLedger(props: MountProps) {
  const external = () => props.store.snapshot()?.mounts.filter(({ profileId }) => !profileId) ?? [];
  const connected = () => props.store.snapshot()?.daemon.state === 'running';
  const dataError = () => !!props.store.snapshot()?.dataError;
  const hasRemotes = () => (props.store.snapshot()?.remotes.length ?? 0) > 0;
  const emptyRemotes = () => connected() && !dataError() && !hasRemotes();
  return (
    <>
      <section class="panel">
        <SectionHeader title={props.detailed ? 'Saved mount profiles' : 'Active drive bay'}>
          <button type="button" class="button primary" disabled={!hasRemotes()}
            title={hasRemotes() ? undefined : emptyRemotes() ? 'Connect a remote first.' : dataError() ? 'Remote list could not be verified.' : 'Connect to rclone first.'}
            onClick={() => props.add()}><Plus size={15} />{props.detailed ? 'New mount profile' : 'New mount'}</button>
        </SectionHeader>
        <For each={props.store.settings().mounts.map(({ id }) => id)} fallback={<Empty>
          {emptyRemotes() ? 'Connect a remote before creating a mount profile.' : connected() && dataError() && !hasRemotes() ? 'Some rclone data could not be loaded.' : 'No saved mount profiles.'}
        </Empty>}>{(id) => (
          <MountRow store={props.store} navigate={props.navigate} detailed={props.detailed} edit={props.edit} add={props.add}
            profile={props.store.settings().mounts.find((profile) => profile.id === id)} />
        )}</For>
        <Show when={!props.detailed}><For each={external()}>{(mount) => (
          <MountRow store={props.store} navigate={props.navigate} edit={props.edit} add={props.add} external={mount} />
        )}</For></Show>
      </section>
      <Show when={props.detailed && external().length}>
        <section class="panel">
          <SectionHeader title="External active mounts" />
          <For each={external()}>{(mount) => (
            <MountRow store={props.store} navigate={props.navigate} edit={props.edit} add={props.add} external={mount} />
          )}</For>
        </section>
      </Show>
    </>
  );
}
