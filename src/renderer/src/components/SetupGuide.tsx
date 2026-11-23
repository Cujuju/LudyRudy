import { createMemo, createSignal, Index, Show } from 'solid-js';
import { Check, ExternalLink } from 'lucide-solid';
import type { OnboardingAction, OnboardingStep } from '../lib/onboarding';
import { deriveOnboarding } from '../lib/onboarding';
import { readView, writeView } from '../lib/persisted';
import { useAction } from '../lib/actions';
import type { PageProps } from '../store';
import { Feedback, SectionHeader } from './ui';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

export function SetupGuide(props: PageProps & { addRemote: () => void; addMount: () => void }) {
  const action = useAction();
  const [dismissed, setDismissed] = createSignal(readView('setupGuideDismissed', false, isBoolean));
  const model = createMemo(() => {
    const snapshot = props.store.snapshot();
    return snapshot ? deriveOnboarding(snapshot, props.store.settings().mounts.length) : undefined;
  });
  const visible = () => !!model()?.show && !(model()?.canDismiss && dismissed());
  const installUrl = () => props.store.snapshot()?.prereqs.mountBackend.installUrl ?? '';

  function dismiss(): void {
    writeView('setupGuideDismissed', setDismissed(true));
  }

  function trigger(kind: OnboardingAction): void {
    switch (kind) {
      case 'open-settings':
        props.navigate('Settings');
        break;
      case 'add-remote':
        props.addRemote();
        break;
      case 'new-mount':
        props.addMount();
        break;
      case 'install-mount-backend': {
        const url = installUrl();
        if (url) void action.run(() => window.api.openExternal(url));
        break;
      }
      case 'open-browser':
        props.navigate('Browser');
        break;
    }
  }

  function stepButtonClass(step: OnboardingStep): string {
    return step.state === 'current' || step.state === 'attention' ? 'button primary' : 'button';
  }

  return (
    <Show when={visible()}>
      <section class="panel setup-guide" aria-label="Get started with ludyRudy">
        <SectionHeader title="Get started with ludyRudy">
          <div class="actions">
            <span class="secondary">{model()!.canDismiss ? 'Create a mount or browse files' : 'Connect a remote to begin'}</span>
            <Show when={model()!.canDismiss}>
              <button type="button" class="text-button" onClick={dismiss}>Dismiss</button>
            </Show>
          </div>
        </SectionHeader>
        <div class="setup-intro">
          <p class="secondary">
            ludyRudy runs a local rclone engine in the background to connect cloud accounts, encrypt vaults, and mount them as drives.
          </p>
        </div>
        <ol class="setup-steps">
          <Index each={model()!.steps}>{(step, index) => (
            <li class="setup-step" data-state={step().state}>
              <span class="setup-marker" aria-hidden="true">
                <Show when={step().state === 'done'} fallback={index + 1}><Check size={14} /></Show>
              </span>
              <div class="setup-copy">
                <strong>{step().title}</strong>
                <p class="secondary">{step().detail}</p>
              </div>
              <Show when={step().action}>{(cta) => (
                <button type="button" class={stepButtonClass(step())} disabled={action.pending()}
                  onClick={() => trigger(cta().kind)}>
                  {cta().label}
                  <Show when={cta().kind === 'install-mount-backend'}><ExternalLink size={13} /></Show>
                </button>
              )}</Show>
            </li>
          )}</Index>
        </ol>
        <Feedback action={action} />
      </section>
    </Show>
  );
}
