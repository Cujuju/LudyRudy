import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createEscapeOwner } from '@cujuju/solidjs-hooks';
import { X } from 'lucide-solid';
import type { ProviderInfo } from '@shared/types';
import { providerName } from '../lib/remotes';
import { ProviderIcon } from './ProviderIcon';
import { Empty } from './ui';

export function ProviderCatalogDialog(props: {
  providers: readonly ProviderInfo[];
  selected: string;
  select: (name: string) => void;
  close: () => void;
}) {
  const [filter, setFilter] = createSignal('');
  let searchInput!: HTMLInputElement;
  let pressedBackdrop = false;
  const previousFocus = document.activeElement;
  createEscapeOwner({ open: () => true, onDismiss: () => props.close() });
  onCleanup(() => {
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  });

  const sorted = createMemo(() => [...props.providers].sort((a, b) =>
    providerName(a.name).localeCompare(providerName(b.name), undefined, { sensitivity: 'base' }),
  ));
  const visible = createMemo(() => {
    const term = filter().trim().toLowerCase();
    if (!term) return sorted();
    return sorted().filter((item) =>
      [providerName(item.name), item.name, item.description].some((text) => text.toLowerCase().includes(term)),
    );
  });

  return (
    <Portal ref={() => searchInput?.focus()}>
      <div class="modal-backdrop" onPointerDown={(event) => { pressedBackdrop = event.target === event.currentTarget; }}
        onClick={(event) => { if (pressedBackdrop && event.target === event.currentTarget) props.close(); }}>
        <dialog open class="modal-dialog" role="dialog" aria-modal="true" aria-label="All storage providers">
          <header class="section-header">
            <div>
              <h2>All storage providers</h2>
              <p class="secondary">{props.providers.length} providers available in rclone.</p>
            </div>
            <button type="button" class="icon-button" aria-label="Close provider list" onClick={() => props.close()}><X size={18} /></button>
          </header>
          <div class="modal-search">
            <input ref={searchInput} type="search" aria-label="Filter providers" placeholder="Filter providers…"
              value={filter()} onInput={(event) => setFilter(event.currentTarget.value)} />
          </div>
          <div class="provider-catalog-list" role="listbox" aria-label="Storage providers">
            <For each={visible()} fallback={<Empty>No matching providers.</Empty>}>{(item) => (
              <button type="button" class="provider-catalog-item" aria-pressed={props.selected === item.name}
                onClick={() => props.select(item.name)}>
                <ProviderIcon type={item.name} size="sm" />
                <span class="provider-catalog-copy">
                  <strong>{providerName(item.name)}</strong>
                  <Show when={item.description && item.description.toLowerCase() !== providerName(item.name).toLowerCase()}>
                    <span class="secondary">{item.description}</span>
                  </Show>
                </span>
              </button>
            )}</For>
          </div>
        </dialog>
      </div>
    </Portal>
  );
}
