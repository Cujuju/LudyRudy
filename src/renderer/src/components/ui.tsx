import { createSignal, createUniqueId, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
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

export function Confirm(props: { label: string; question: string; disabled?: boolean; action: () => Promise<unknown> }) {
  const [armed, setArmed] = createSignal(false);
  const status = useAction();

  async function confirm() {
    if (await status.run(props.action)) setArmed(false);
  }

  return (
    <Show when={armed()} fallback={<button type="button" class="button quiet danger-text" disabled={props.disabled} onClick={() => setArmed(true)}>{props.label}</button>}>
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
  let dialog!: HTMLDialogElement;
  let pressedBackdrop = false;
  onMount(() => dialog.showModal());
  onCleanup(() => dialog.close());
  return (
    <dialog ref={dialog} class="drawer" aria-label={props.title} onCancel={(event) => {
      event.preventDefault();
      if (!props.busy) props.close();
    }} onPointerDown={(event) => { pressedBackdrop = event.target === dialog; }}
    onClick={(event) => { if (pressedBackdrop && event.target === dialog && !props.busy) props.close(); }}>
      <div class="drawer-inner">
        <header class="section-header">
          <div><h2>{props.title}</h2><Show when={props.description}><p class="secondary">{props.description}</p></Show></div>
          <button type="button" class="icon-button" aria-label="Close drawer" disabled={props.busy} onClick={() => props.close()}><X size={18} /></button>
        </header>
        {props.children}
      </div>
    </dialog>
  );
}

export function Toggle(props: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label class="setting-row">
      <span>{props.label}</span>
      <input class="toggle" type="checkbox" role="switch" checked={props.checked} disabled={props.disabled}
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
