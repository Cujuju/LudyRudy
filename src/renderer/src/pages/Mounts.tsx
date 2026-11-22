import { For } from 'solid-js';
import { Empty, PageHeader } from '../components/ui';
import type { PageProps } from '../store';

export function Mounts(props: PageProps) {
  const backend = () => props.store.snapshot()?.prereqs.mountBackend;
  return (
    <>
      <PageHeader title="Mounts" />
      <section class="card section">
        <h2>Local mount support</h2>
        <p class="secondary">{backend()?.name} · {backend()?.details}</p>
      </section>
      <section class="card section">
        <h2>Active mounts</h2>
        <For each={props.store.snapshot()?.mounts} fallback={<Empty>No active mounts.</Empty>}>
          {(mount) => <div class="list-row"><strong>{mount.mountPoint}</strong><span class="secondary">{mount.fs}</span><span class="chip">{mount.status}</span></div>}
        </For>
      </section>
      <section class="card section">
        <h2>Saved profiles</h2>
        <For each={props.store.settings().mounts} fallback={<Empty>No saved mount profiles.</Empty>}>
          {(profile) => <div class="list-row"><strong>{profile.name || profile.id}</strong><span class="secondary">{profile.remote}:{profile.remotePath}</span><span>{profile.mountPoint}</span></div>}
        </For>
      </section>
    </>
  );
}
