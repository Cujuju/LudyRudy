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
  focusFallback: () => HTMLElement | undefined;
}) {
  const [filter, setFilter] = createSignal('');
  let searchInput!: HTMLInputElement;
  let dialog!: HTMLDialogElement;
  let pressedBackdrop = false;
  const previousFocus = document.activeElement;
  const outsideDialog = (event: MouseEvent) => {
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom);
  };
  createEscapeOwner({ open: () => true, onDismiss: () => props.close() });
  onCleanup(() => {
    dialog?.close();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    else props.focusFallback()?.focus();
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
    <Portal ref={() => { dialog.showModal(); searchInput.focus(); }}>
      <dialog ref={dialog} class="modal-dialog" aria-label="All storage providers"
        onCancel={(event) => { event.preventDefault(); props.close(); }}
        onPointerDown={(event) => { pressedBackdrop = outsideDialog(event); }}
        onClick={(event) => { if (pressedBackdrop && outsideDialog(event)) props.close(); }}>
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
        <div class="provider-catalog-list" role="group" aria-label="Storage providers">
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
    </Portal>
  );
}
