import { Show } from 'solid-js';
import type { RemoteQuota } from '@shared/types';
import { formatBytes } from '../lib/format';
import { Progress } from './ui';

export function Quota(props: { value: RemoteQuota; label?: string }) {
  const valid = () => props.value.total !== null && props.value.total > 0 && props.value.used !== null;
  return (
    <div class="quota">
      <Show when={valid()} fallback={
        <span class="secondary">{props.value.free !== null ? `${formatBytes(props.value.free)} free` : 'Storage quota unavailable'}</span>
      }>
        <div class="quota-caption"><span>{formatBytes(props.value.used)} used</span><span>{formatBytes(props.value.total)} total</span></div>
        <Progress label={props.label ?? 'Storage used'} value={props.value.used!} total={props.value.total!} />
      </Show>
    </div>
  );
}
