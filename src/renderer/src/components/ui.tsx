import { createSignal, createUniqueId, For, onCleanup, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createEscapeOwner } from '@cujuju/solidjs-hooks';
import { Flyout } from '@cujuju/solidjs-select-flyout';
import { Eye, EyeOff, Search, X } from 'lucide-solid';
import type { DaemonStatus } from '@shared/types';
import { useAction } from '../lib/actions';

export function PageHeader(props: { title: string; description?: string; children?: JSX.Element }) {
  return <header class="page-header"><div><h1>{props.title}</h1><Show when={props.description}><p class="secondary">{props.description}</p></Show></div>{props.children}</header>;
}

export function SectionHeader(props: { title: string; children?: JSX.Element }) {
  return <header class="section-header"><h2>{props.title}</h2>{props.children}</header>;
}

export function Empty(props: { children: JSX.Element }) {
  return <p class="empty">{props.children}</p>;
}

export function StatusDot(props: { state: DaemonStatus['state'] }) {
  return <span class="status-dot" data-state={props.state} aria-hidden="true" />;
}

export function Feedback(props: { action: ReturnType<typeof useAction> }) {
  return (
    <Show when={props.action.message()}>
      <div class="banner" classList={{ error: props.action.error(), success: !props.action.error() }} role={props.action.error() ? 'alert' : 'status'}>
        {props.action.message()}
        <button type="button" class="icon-button" aria-label="Dismiss message" onClick={() => props.action.clear()}><X size={14} /></button>
      </div>
    </Show>
  );
}

export function Confirm(props: { label: string; question: string; icon?: JSX.Element; disabled?: boolean; action: () => Promise<unknown> }) {
  const [armed, setArmed] = createSignal(false);
  const status = useAction();

  async function confirm() {
    if (await status.run(props.action)) setArmed(false);
  }

  return (
    <Show when={armed()} fallback={
      <Show when={props.icon} fallback={
        <button type="button" class="button quiet danger-text" disabled={props.disabled} onClick={() => setArmed(true)}>{props.label}</button>
      }>
        <button type="button" class="icon-button danger-text" aria-label={props.label} title={props.label} disabled={props.disabled} onClick={() => setArmed(true)}>{props.icon}</button>
      </Show>
    }>
      <div class="confirm" role="group" aria-label={props.question}>
        <span>{props.question}</span>
        <button type="button" class="button" disabled={status.pending()} onClick={() => { status.clear(); setArmed(false); }}>Cancel</button>
        <button type="button" class="button danger" disabled={status.pending() || props.disabled} onClick={() => void confirm()}>{props.label}</button>
        <Feedback action={status} />
      </div>
    </Show>
  );
}

export function Drawer(props: { title: string; description?: string; busy?: boolean; close: () => void; children: JSX.Element }) {
  let panel!: HTMLDialogElement;
  let pressedBackdrop = false;
  const root = document.getElementById('root');
  const previousFocus = document.activeElement;
  const wasInert = root?.inert ?? false;
  const dismiss = () => { if (!props.busy) props.close(); };
  createEscapeOwner({ open: () => true, onDismiss: dismiss });
  onCleanup(() => {
    if (root) root.inert = wasInert;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  });
  return (
    <Portal ref={() => {
      if (root) root.inert = true;
      panel.tabIndex = -1;
      panel.focus();
    }}>
      <div class="drawer-backdrop" onPointerDown={(event) => { pressedBackdrop = event.target === event.currentTarget; }}
        onClick={(event) => { if (pressedBackdrop && event.target === event.currentTarget) dismiss(); }}>
        <dialog ref={panel} open class="drawer" role="dialog" aria-modal="true" aria-label={props.title}>
          <div class="drawer-inner">
            <header class="section-header">
              <div><h2>{props.title}</h2><Show when={props.description}><p class="secondary">{props.description}</p></Show></div>
              <button type="button" class="icon-button" aria-label="Close drawer" disabled={props.busy} onClick={dismiss}><X size={18} /></button>
            </header>
            {props.children}
          </div>
        </dialog>
      </div>
    </Portal>
  );
}

export function blurActiveElement() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

export function Select<T extends string>(props: {
  id?: string; label: string; value: T; options: readonly { value: T; label: string; disabled?: boolean; icon?: () => JSX.Element }[];
  placeholder?: string; disabled?: boolean; onChange: (value: T) => void;
}) {
  return <Flyout id={props.id} ariaLabel={props.label} surface="plain" class="select-flyout"
    value={props.value} options={[...props.options]} placeholder={props.placeholder} disabled={props.disabled}
    onChange={(value) => {
      const option = props.options.find((option) => option.value === value);
      if (option && !option.disabled) props.onChange(option.value);
    }} />;
}

export function Toggle(props: { label: string; hideLabel?: boolean; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label class="setting-row">
      <Show when={!props.hideLabel}><span>{props.label}</span></Show>
      <input class="toggle" type="checkbox" role="switch" aria-label={props.hideLabel ? props.label : undefined}
        checked={props.checked} disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.checked)} />
    </label>
  );
}

export const sentenceCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function Segmented<T extends string>(props: {
  label: string; options: readonly T[]; value: T; disabled?: boolean; onChange: (value: T) => void;
}) {
  return (
    <div class="segmented" role="group" aria-label={props.label}>
      <For each={props.options}>{(option) => (
        <button type="button" aria-pressed={props.value === option} disabled={props.disabled}
          onClick={() => props.onChange(option)}>{sentenceCase(option)}</button>
      )}</For>
    </div>
  );
}

export function Progress(props: { label: string; value: number; total: number }) {
  return <progress aria-label={props.label} max={props.total > 0 ? props.total : 1}
    value={Math.max(0, Math.min(props.value, props.total))} />;
}

export function FormActions(props: { label: string; close: () => void; busy: boolean; disabled?: boolean }) {
  return (
    <footer class="form-actions">
      <button type="button" class="button" disabled={props.busy} onClick={() => props.close()}>Cancel</button>
      <button type="submit" class="button primary" disabled={props.busy || props.disabled}>{props.busy ? 'Working…' : props.label}</button>
    </footer>
  );
}

export function SecretInput(props: { label: string; value: string; required?: boolean; placeholder?: string; onInput: (value: string) => void; children?: JSX.Element }) {
  const id = createUniqueId();
  const [revealed, setRevealed] = createSignal(false);
  const toggleLabel = () => `${revealed() ? 'Hide' : 'Show'} ${props.label.toLowerCase()}`;
  return (
    <div class="field">
      <label for={id}>{props.label}</label>
      <div class="input-group">
        <input id={id} type={revealed() ? 'text' : 'password'} autocomplete="off" spellcheck={false} required={props.required}
          placeholder={props.placeholder} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
        <button type="button" class="input-inline-btn" aria-label={toggleLabel()} title={toggleLabel()} onClick={() => setRevealed(!revealed())}>
          <Show when={revealed()} fallback={<Eye size={15} aria-hidden="true" />}><EyeOff size={15} aria-hidden="true" /></Show>
        </button>
        {props.children}
      </div>
    </div>
  );
}

export function SearchField(props: { label: string; value: string; onInput: (value: string) => void }) {
  return (
    <div class="search-field">
      <Search size={14} aria-hidden="true" />
      <input type="search" aria-label={props.label} placeholder={props.label} value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)} />
    </div>
  );
}
