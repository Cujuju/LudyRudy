import { createSignal, Show } from 'solid-js';
import type { MountProfile } from '@shared/types';
import { MountDrawer } from '../components/MountDrawer';
import { MountLedger, Prerequisites } from '../components/MountLedger';
import { Confirm, PageHeader } from '../components/ui';
import type { PageProps } from '../store';

export function Mounts(props: PageProps) {
  const [drawer, setDrawer] = createSignal<MountProfile | 'new'>();
  return (
    <>
      <PageHeader title="Mounts" description="Manage where cloud storage appears on this computer.">
        <Show when={props.store.snapshot()?.mounts.length}>
          <Confirm label="Unmount all" question="Unmount every active drive?" action={() => window.api.unmountAll()} />
        </Show>
      </PageHeader>
      <Prerequisites store={props.store} navigate={props.navigate} mountingOnly />
      <MountLedger store={props.store} navigate={props.navigate} detailed edit={setDrawer} add={() => setDrawer('new')} />
      <Show when={drawer()} keyed>{(profile) => (
        <MountDrawer profile={profile === 'new' ? undefined : profile} remotes={props.store.snapshot()?.remotes ?? []}
          cache={props.store.settings().daemon.defaultVfsCacheMode} connected={props.store.snapshot()?.daemon.state === 'running'} close={() => setDrawer(undefined)} />
      )}</Show>
    </>
  );
}
