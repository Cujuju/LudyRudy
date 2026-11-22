import { Show } from 'solid-js';
import { Cloud, FolderOpen, HardDrive, LockKeyhole, Plug } from 'lucide-solid';
import type { RemoteSummary } from '@shared/types';

export function VolumeConduit(props: { mountPoint?: string; spec: string; remote?: RemoteSummary }) {
  return (
    <div class="conduit">
      <div class="conduit-node">
        <Show when={props.mountPoint} fallback={<FolderOpen size={16} aria-hidden="true" />}><HardDrive size={16} aria-hidden="true" /></Show>
        <div><span>{props.mountPoint ? 'Local mount' : 'Remote path'}</span><strong class="path selectable">{props.mountPoint || props.spec}</strong></div>
      </div>
      <span class="conduit-rail" aria-hidden="true" />
      <div class="conduit-node conduit-cipher" classList={{ encrypted: !!props.remote?.isCrypt }}>
        <Show when={props.remote?.isCrypt} fallback={<Plug size={16} aria-hidden="true" />}><LockKeyhole size={16} aria-hidden="true" /></Show>
        <div><strong>{props.remote?.isCrypt ? 'Encrypted' : 'Direct'}</strong>
          <Show when={props.remote?.isCrypt}><span>{props.remote?.filenameEncryption ?? 'Standard'} filenames</span></Show>
        </div>
      </div>
      <span class="conduit-rail" aria-hidden="true" />
      <div class="conduit-node">
        <Cloud size={16} aria-hidden="true" />
        <div><span>{props.remote?.isCrypt ? 'Storage target' : 'Storage remote'}</span>
          <strong class="path selectable">{props.remote?.isCrypt ? props.remote.config.remote || 'Unavailable' : props.spec}</strong>
        </div>
      </div>
    </div>
  );
}
