import { Show } from 'solid-js';
import { Copy, Minus, Square, X } from 'lucide-solid';
import { APP_NAME } from '@shared/app';
import { isMac } from '../lib/platform';

export function TitleBar(props: { maximized: boolean }) {
  return (
    <header class="titlebar" classList={{ mac: isMac }}>
      <div class="brand">
        <img src="./icon.png" srcset="./icon@2x.png 2x" alt="" width="18" height="18" />
        <span>{APP_NAME}</span>
      </div>
      <Show when={!isMac}>
        <div class="window-controls">
          <button type="button" aria-label="Minimize" onClick={() => window.api.minimize()}><Minus size={15} /></button>
          <button type="button" aria-label={props.maximized ? 'Restore' : 'Maximize'} onClick={() => window.api.toggleMaximize()}>
            <Show when={props.maximized} fallback={<Square size={13} />}><Copy size={13} /></Show>
          </button>
          <button type="button" class="window-close" aria-label="Close" onClick={() => window.api.closeWindow()}><X size={16} /></button>
        </div>
      </Show>
    </header>
  );
}
