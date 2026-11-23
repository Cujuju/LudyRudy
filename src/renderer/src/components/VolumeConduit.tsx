import { Show } from 'solid-js';
import { Plug } from 'lucide-solid';
import type { RemoteSummary } from '@shared/types';
import { storageProvider } from '../lib/remotes';
import { ProviderIcon } from './ProviderIcon';

export function VolumeConduit(props: { mountPoint?: string; spec: string; remote?: RemoteSummary; remotes: readonly RemoteSummary[] }) {
  return (
    <div class="conduit">
      <div class="conduit-node">
        <ProviderIcon type={props.mountPoint ? 'local' : props.remote?.type ?? 'local'} />
        <div><span>{props.mountPoint ? 'Local mount' : 'Remote path'}</span><strong class="path selectable">{props.mountPoint || props.spec}</strong></div>
      </div>
      <span class="conduit-rail" aria-hidden="true" />
      <div class="conduit-node conduit-cipher" classList={{ encrypted: !!props.remote?.isCrypt }}>
        <Show when={props.remote?.isCrypt} fallback={<Plug size={16} aria-hidden="true" />}><ProviderIcon type="crypt" /></Show>
        <div><strong>{props.remote?.isCrypt ? 'Encrypted' : 'Direct'}</strong>
          <Show when={props.remote?.isCrypt}><span>{props.remote?.filenameEncryption ?? 'Standard'} filenames</span></Show>
        </div>
      </div>
      <span class="conduit-rail" aria-hidden="true" />
      <div class="conduit-node">
        <ProviderIcon type={storageProvider(props.remote, props.remotes)} />
        <div><span>{props.remote?.isCrypt ? 'Storage target' : 'Storage remote'}</span>
          <strong class="path selectable">{props.remote?.isCrypt ? props.remote.config.remote || 'Unavailable' : props.spec}</strong>
        </div>
      </div>
    </div>
  );
}
