import { For, Show } from 'solid-js';
import { Cloud, LockKeyhole } from 'lucide-solid';
import { Empty, PageHeader } from '../components/ui';
import type { PageProps } from '../store';

export function Remotes(props: PageProps) {
  return (
    <>
      <PageHeader title="Remotes" />
      <For each={props.store.snapshot()?.remotes} fallback={<Empty>No remotes available.</Empty>}>
        {(remote) => (
          <article class="card remote-card" data-remote={remote.name}>
            <div class="remote-icon">
              <Show when={remote.isCrypt} fallback={<Cloud size={20} />}><LockKeyhole size={19} /></Show>
            </div>
            <div class="remote-main">
              <h2>{remote.name}</h2>
              <Show when={remote.isCrypt}>
                <p class="secondary">Target <span class="selectable">{remote.config.remote ?? '—'}</span></p>
                <p class="secondary">Filename encryption {remote.filenameEncryption} · Directory names {remote.directoryNameEncryption ? 'encrypted' : 'visible'}</p>
              </Show>
            </div>
            <span class="chip" classList={{ encrypted: remote.isCrypt }}>{remote.isCrypt ? 'Encrypted' : remote.type}</span>
          </article>
        )}
      </For>
    </>
  );
}
